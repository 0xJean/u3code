import { and, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  DEFAULT_REPO_POLICY,
  createWorkflowConfigFromPreset,
  type AgileHorizon,
  type CycleStatus,
  type MilestoneStatus,
  type MilestoneTone,
  type NotifierDriverKind,
  type ProjectCycle,
  type ProjectMilestone,
  type RepoPolicy,
  type WorkflowConfig,
} from "@u3code/hub-contracts";
import {
  createAuthMiddleware,
  getAuthUser,
  getUserWorkspaceRoles,
  hasAnyRole,
  type HubAuthVariables,
} from "../auth/middleware.ts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import {
  notificationChannels,
  projectMemories,
  projectRepos,
  projects,
  users,
  workspaceMemberships,
  workspaces,
} from "../db/schema.ts";
import type { NotificationDispatcher, NotifierChannelSecretConfig } from "../notifiers/index.ts";
import type { HubPluginRegistry } from "../plugins/index.ts";
import { encryptSecretJson, newId } from "../utils/crypto.ts";
import { syncGitHubOpenPullRequests } from "../webhooks/syncGithub.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

const VALID_CYCLE_STATUSES = new Set<CycleStatus>(["upcoming", "active", "completed"]);
const VALID_AGILE_HORIZONS = new Set<AgileHorizon>(["now", "next", "later"]);
const VALID_MILESTONE_STATUSES = new Set<MilestoneStatus>([
  "planned",
  "active",
  "completed",
  "paused",
]);
const VALID_MILESTONE_TONES = new Set<MilestoneTone>([
  "primary",
  "info",
  "success",
  "warning",
  "violet",
]);

function sanitizeProjectCycles(
  rawCycles: unknown,
):
  | { readonly ok: true; readonly cycles: ProjectCycle[] }
  | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(rawCycles)) {
    return { ok: false, error: "cycles must be an array." };
  }
  const seenIds = new Set<string>();
  const cycles: ProjectCycle[] = [];
  for (const item of rawCycles) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Each cycle must be an object." };
    }
    const raw = item as Record<string, unknown>;
    const id =
      typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : newId("cyc");
    if (seenIds.has(id)) {
      return { ok: false, error: `Duplicate cycle id '${id}'.` };
    }
    seenIds.add(id);

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      return { ok: false, error: "Each cycle requires a non-empty name." };
    }

    const number = raw.number;
    if (typeof number !== "number" || !Number.isInteger(number) || number < 1) {
      return { ok: false, error: `Cycle '${name}' requires a positive integer number.` };
    }

    const startDate = typeof raw.startDate === "string" ? raw.startDate.trim() : "";
    const endDate = typeof raw.endDate === "string" ? raw.endDate.trim() : "";
    if (!startDate || !endDate) {
      return { ok: false, error: `Cycle '${name}' requires startDate and endDate.` };
    }
    if (endDate < startDate) {
      return { ok: false, error: `Cycle '${name}' endDate cannot be earlier than startDate.` };
    }

    const status = raw.status;
    if (typeof status !== "string" || !VALID_CYCLE_STATUSES.has(status as CycleStatus)) {
      return { ok: false, error: `Cycle '${name}' has invalid status '${String(status)}'.` };
    }

    let capacityPoints: number | null | undefined;
    if (raw.capacityPoints !== undefined) {
      if (raw.capacityPoints === null) {
        capacityPoints = null;
      } else if (
        typeof raw.capacityPoints === "number" &&
        Number.isInteger(raw.capacityPoints) &&
        raw.capacityPoints >= 0
      ) {
        capacityPoints = raw.capacityPoints;
      } else {
        return {
          ok: false,
          error: `Cycle '${name}' capacityPoints must be a non-negative integer or null.`,
        };
      }
    }

    let completedPoints: number | null | undefined;
    if (raw.completedPoints !== undefined) {
      if (raw.completedPoints === null) {
        completedPoints = null;
      } else if (
        typeof raw.completedPoints === "number" &&
        Number.isInteger(raw.completedPoints) &&
        raw.completedPoints >= 0
      ) {
        completedPoints = raw.completedPoints;
      } else {
        return {
          ok: false,
          error: `Cycle '${name}' completedPoints must be a non-negative integer or null.`,
        };
      }
    }

    let completedAt: string | null | undefined;
    if (raw.completedAt !== undefined) {
      if (raw.completedAt === null) {
        completedAt = null;
      } else if (typeof raw.completedAt === "string") {
        const trimmed = raw.completedAt.trim();
        completedAt = trimmed.length > 0 ? trimmed : null;
      } else {
        return { ok: false, error: `Cycle '${name}' completedAt must be a string or null.` };
      }
    }

    const goal = typeof raw.goal === "string" ? raw.goal.trim() : "";

    cycles.push({
      id,
      number,
      name,
      ...(goal.length > 0 ? { goal } : {}),
      startDate,
      endDate,
      status: status as CycleStatus,
      ...(capacityPoints !== undefined ? { capacityPoints } : {}),
      ...(completedPoints !== undefined ? { completedPoints } : {}),
      ...(completedAt !== undefined ? { completedAt } : {}),
    });
  }
  return { ok: true, cycles };
}

function sanitizeProjectMilestones(
  rawMilestones: unknown,
):
  | { readonly ok: true; readonly milestones: ProjectMilestone[] }
  | { readonly ok: false; readonly error: string } {
  if (!Array.isArray(rawMilestones)) {
    return { ok: false, error: "milestones must be an array." };
  }
  const seenIds = new Set<string>();
  const milestones: ProjectMilestone[] = [];
  for (const item of rawMilestones) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: "Each milestone must be an object." };
    }
    const raw = item as Record<string, unknown>;
    const id =
      typeof raw.id === "string" && raw.id.trim().length > 0 ? raw.id.trim() : newId("mls");
    if (seenIds.has(id)) {
      return { ok: false, error: `Duplicate milestone id '${id}'.` };
    }
    seenIds.add(id);

    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    if (!name) {
      return { ok: false, error: "Each milestone requires a non-empty name." };
    }

    const horizon = raw.horizon;
    if (typeof horizon !== "string" || !VALID_AGILE_HORIZONS.has(horizon as AgileHorizon)) {
      return { ok: false, error: `Milestone '${name}' has invalid horizon '${String(horizon)}'.` };
    }

    const status = raw.status;
    if (typeof status !== "string" || !VALID_MILESTONE_STATUSES.has(status as MilestoneStatus)) {
      return { ok: false, error: `Milestone '${name}' has invalid status '${String(status)}'.` };
    }

    let colorTone: MilestoneTone | undefined;
    if (raw.colorTone !== undefined) {
      if (
        typeof raw.colorTone !== "string" ||
        !VALID_MILESTONE_TONES.has(raw.colorTone as MilestoneTone)
      ) {
        return {
          ok: false,
          error: `Milestone '${name}' has invalid colorTone '${String(raw.colorTone)}'.`,
        };
      }
      colorTone = raw.colorTone as MilestoneTone;
    }

    let targetDate: string | null | undefined;
    if (raw.targetDate !== undefined) {
      if (raw.targetDate === null) {
        targetDate = null;
      } else if (typeof raw.targetDate === "string") {
        const trimmed = raw.targetDate.trim();
        targetDate = trimmed.length > 0 ? trimmed : null;
      } else {
        return { ok: false, error: `Milestone '${name}' targetDate must be a string or null.` };
      }
    }

    const description = typeof raw.description === "string" ? raw.description.trim() : "";
    const createdAt = typeof raw.createdAt === "string" ? raw.createdAt.trim() : "";

    milestones.push({
      id,
      name,
      ...(description.length > 0 ? { description } : {}),
      horizon: horizon as AgileHorizon,
      status: status as MilestoneStatus,
      ...(targetDate !== undefined ? { targetDate } : {}),
      ...(colorTone !== undefined ? { colorTone } : {}),
      ...(createdAt.length > 0 ? { createdAt } : {}),
    });
  }
  return { ok: true, milestones };
}

function isPgUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { readonly code?: unknown; readonly cause?: unknown };
  if (candidate.code === "23505") return true;
  if (candidate.cause && typeof candidate.cause === "object") {
    return (candidate.cause as { readonly code?: unknown }).code === "23505";
  }
  return false;
}

export function createWorkspaceRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
  readonly pluginRegistry?: HubPluginRegistry;
  readonly fetchImpl?: typeof fetch;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  app.use("*", createAuthMiddleware(deps.db, deps.config));

  app.post("/workspaces", async (c) => {
    const user = getAuthUser(c);
    const body = (await c.req.json()) as {
      readonly slug?: string;
      readonly name?: string;
      readonly settings?: Record<string, unknown>;
    };
    const slug = body.slug?.trim().toLowerCase();
    const name = body.name?.trim();
    if (!slug || !name) {
      return c.json({ error: "slug and name are required." }, 400);
    }

    const id = newId("ws");
    let inserted: Array<typeof workspaces.$inferSelect>;
    try {
      inserted = await deps.db
        .insert(workspaces)
        .values({
          id,
          slug,
          name,
          settings: body.settings ?? {},
        })
        .returning();
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        return c.json(
          { error: `Workspace slug '${slug}' already exists. Choose a different slug.` },
          409,
        );
      }
      throw error;
    }

    await deps.db.insert(workspaceMemberships).values({
      workspaceId: id,
      userId: user.id,
      roles: ["owner"],
    });

    return c.json({ workspace: inserted[0] }, 201);
  });

  app.get("/workspaces/:workspaceId/members", async (c) => {
    const actor = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const actorRoles = await getUserWorkspaceRoles(deps.db, workspaceId, actor.id);
    if (actorRoles.length === 0) {
      return c.json({ error: "Not a member of this workspace." }, 403);
    }

    const rows = await deps.db
      .select({
        userId: users.id,
        displayName: users.displayName,
        email: users.email,
        avatarUrl: users.avatarUrl,
        primaryVcsLogin: users.primaryVcsLogin,
        notificationHandles: users.notificationHandles,
        roles: workspaceMemberships.roles,
        joinedAt: workspaceMemberships.joinedAt,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(workspaceMemberships.userId, users.id))
      .where(eq(workspaceMemberships.workspaceId, workspaceId));

    return c.json({ members: rows });
  });

  app.post("/workspaces/:workspaceId/members", async (c) => {
    const actor = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const actorRoles = await getUserWorkspaceRoles(deps.db, workspaceId, actor.id);
    if (!hasAnyRole(actorRoles, ["owner"])) {
      return c.json({ error: "Only workspace owners can add members." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly identifier?: string;
      readonly roles?: string[];
    };
    const identifier = body.identifier?.trim().toLowerCase();
    if (!identifier) {
      return c.json({ error: "identifier (GitHub login, email, or user ID) is required." }, 400);
    }

    const matchedUsers = await deps.db
      .select()
      .from(users)
      .where(
        or(
          eq(users.id, body.identifier!.trim()),
          sql`lower(${users.primaryVcsLogin}) = ${identifier}`,
          sql`lower(${users.email}) = ${identifier}`,
        ),
      )
      .limit(1);
    const targetUser = matchedUsers[0];
    if (!targetUser) {
      return c.json(
        {
          error:
            "User not found. Ask your teammate to sign in to this Hub once before adding them.",
        },
        404,
      );
    }

    const roles = (body.roles ?? ["dev"]).map((r) => r.trim()).filter((r) => r.length > 0);
    const finalRoles = roles.length > 0 ? roles : ["dev"];

    const inserted = await deps.db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: targetUser.id, roles: finalRoles })
      .onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { roles: finalRoles },
      })
      .returning();

    return c.json(
      {
        member: {
          userId: targetUser.id,
          displayName: targetUser.displayName,
          email: targetUser.email,
          avatarUrl: targetUser.avatarUrl,
          primaryVcsLogin: targetUser.primaryVcsLogin,
          notificationHandles: targetUser.notificationHandles,
          roles: inserted[0]!.roles,
          joinedAt: inserted[0]!.joinedAt,
        },
      },
      201,
    );
  });

  app.put("/workspaces/:workspaceId/members/:userId", async (c) => {
    const actor = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const targetUserId = c.req.param("userId");

    const actorRoles = await getUserWorkspaceRoles(deps.db, workspaceId, actor.id);
    if (!hasAnyRole(actorRoles, ["owner"])) {
      return c.json({ error: "Only workspace owners can manage member roles." }, 403);
    }

    const body = (await c.req.json()) as { readonly roles?: string[] };
    const roles = body.roles?.filter((r) => r.trim().length > 0) ?? ["member"];

    await deps.db
      .insert(workspaceMemberships)
      .values({ workspaceId, userId: targetUserId, roles })
      .onConflictDoUpdate({
        target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
        set: { roles },
      });

    return c.json({ workspaceId, userId: targetUserId, roles });
  });

  app.post("/workspaces/:workspaceId/projects", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "pm"])) {
      return c.json({ error: "Requires owner or pm role to create a project." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly key?: string;
      readonly name?: string;
      readonly description?: string;
      readonly preset?: string;
      readonly workflowConfig?: WorkflowConfig;
    };

    const key = body.key?.trim().toUpperCase();
    const name = body.name?.trim();
    if (!key || !name) {
      return c.json({ error: "key and name are required." }, 400);
    }

    const presetName = body.preset?.trim() || "lean";
    const resolvedFromPlugin = deps.pluginRegistry?.resolveWorkflowPreset(presetName) ?? null;
    const workflowConfig =
      body.workflowConfig ??
      resolvedFromPlugin ??
      createWorkflowConfigFromPreset(presetName === "full-delivery" ? "full-delivery" : "lean");
    const projectId = newId("prj");

    let inserted: Array<typeof projects.$inferSelect>;
    try {
      inserted = await deps.db
        .insert(projects)
        .values({
          id: projectId,
          workspaceId,
          key,
          name,
          description: body.description?.trim() ?? "",
          workflowConfig,
        })
        .returning();
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        return c.json(
          {
            error: `Project key '${key}' already exists in this workspace. Choose a unique short key (for example, TAB, WEB, or API).`,
          },
          409,
        );
      }
      throw error;
    }

    await deps.db.insert(projectMemories).values({
      id: newId("mem"),
      projectId,
      updatedBy: user.id,
    });

    return c.json({ project: inserted[0] }, 201);
  });

  app.get("/workspaces/:workspaceId/projects", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) {
      return c.json({ error: "Not a member of this workspace." }, 403);
    }

    const rows = await deps.db.select().from(projects).where(eq(projects.workspaceId, workspaceId));
    return c.json({ projects: rows });
  });

  app.put("/projects/:projectId/prompts", async (c) => {
    const user = getAuthUser(c);
    const projectId = c.req.param("projectId");
    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) return c.json({ error: "Project not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "pm", "dev"])) {
      return c.json({ error: "Requires owner, pm, or dev role to manage prompt templates." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly promptTemplates?: Record<string, string>;
    };
    const nextTemplates: Record<string, string> = {};
    for (const [slot, value] of Object.entries(body.promptTemplates ?? {})) {
      const key = slot.trim();
      if (!key || typeof value !== "string") continue;
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        nextTemplates[key] = trimmed;
      }
    }

    const nextWorkflowConfig: WorkflowConfig = {
      ...project.workflowConfig,
      promptTemplates: nextTemplates,
    };

    const updated = await deps.db
      .update(projects)
      .set({
        workflowConfig: nextWorkflowConfig,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    return c.json({ project: updated[0] });
  });

  app.put("/projects/:projectId/planning", async (c) => {
    const user = getAuthUser(c);
    const projectId = c.req.param("projectId");
    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) return c.json({ error: "Project not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "pm", "dev"])) {
      return c.json({ error: "Requires owner, pm, or dev role to manage project planning." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly cycles?: unknown;
      readonly milestones?: unknown;
    };

    let nextCycles: ProjectCycle[] | undefined;
    if (body.cycles !== undefined) {
      const sanitized = sanitizeProjectCycles(body.cycles);
      if (!sanitized.ok) {
        return c.json({ error: sanitized.error }, 400);
      }
      nextCycles = sanitized.cycles;
    }

    let nextMilestones: ProjectMilestone[] | undefined;
    if (body.milestones !== undefined) {
      const sanitized = sanitizeProjectMilestones(body.milestones);
      if (!sanitized.ok) {
        return c.json({ error: sanitized.error }, 400);
      }
      nextMilestones = sanitized.milestones;
    }

    const nextWorkflowConfig: WorkflowConfig = {
      ...project.workflowConfig,
      ...(nextCycles !== undefined ? { cycles: nextCycles } : {}),
      ...(nextMilestones !== undefined ? { milestones: nextMilestones } : {}),
    };

    const updated = await deps.db
      .update(projects)
      .set({
        workflowConfig: nextWorkflowConfig,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, projectId))
      .returning();

    return c.json({ project: updated[0] });
  });

  app.post("/projects/:projectId/repos", async (c) => {
    const user = getAuthUser(c);
    const projectId = c.req.param("projectId");
    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) return c.json({ error: "Project not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to configure repositories." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly forgeKind?: "github" | "gitlab";
      readonly repoFullName?: string;
      readonly tags?: string[];
      readonly repoPolicy?: RepoPolicy;
    };
    const repoFullName = body.repoFullName?.trim();
    if (!repoFullName) {
      return c.json({ error: "repoFullName is required (e.g. org/repo)." }, 400);
    }

    let inserted: Array<typeof projectRepos.$inferSelect>;
    try {
      inserted = await deps.db
        .insert(projectRepos)
        .values({
          id: newId("rep"),
          projectId,
          forgeKind: body.forgeKind ?? "github",
          repoFullName,
          tags: body.tags ?? [],
          repoPolicy: body.repoPolicy ?? DEFAULT_REPO_POLICY,
        })
        .returning();
    } catch (error) {
      if (isPgUniqueViolation(error)) {
        return c.json(
          { error: `Repository '${repoFullName}' is already linked to this project.` },
          409,
        );
      }
      throw error;
    }

    return c.json({ repo: inserted[0] }, 201);
  });

  app.delete("/projects/:projectId/repos/:repoId", async (c) => {
    const user = getAuthUser(c);
    const projectId = c.req.param("projectId");
    const repoId = c.req.param("repoId");
    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) return c.json({ error: "Project not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to remove repositories." }, 403);
    }

    await deps.db
      .delete(projectRepos)
      .where(and(eq(projectRepos.id, repoId), eq(projectRepos.projectId, projectId)));
    return c.json({ ok: true });
  });

  app.post("/projects/:projectId/repos/:repoId/sync", async (c) => {
    const user = getAuthUser(c);
    const projectId = c.req.param("projectId");
    const repoId = c.req.param("repoId");
    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1);
    const project = projectRows[0];
    if (!project) return c.json({ error: "Project not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    try {
      const result = await syncGitHubOpenPullRequests(
        {
          db: deps.db,
          config: deps.config,
          broker: deps.broker,
          ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
        },
        { projectId, repoId },
      );
      return c.json(result);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to sync repository PRs." },
        502,
      );
    }
  });

  app.post("/workspaces/:workspaceId/notification-channels", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to configure notifications." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly projectId?: string | null;
      readonly driver?: NotifierDriverKind;
      readonly name?: string;
      readonly events?: string[];
      readonly config?: NotifierChannelSecretConfig;
    };
    if (!body.driver || !body.name || !body.config?.webhookUrl) {
      return c.json({ error: "driver, name, and config.webhookUrl are required." }, 400);
    }

    const inserted = await deps.db
      .insert(notificationChannels)
      .values({
        id: newId("ntf"),
        workspaceId,
        projectId: body.projectId ?? null,
        driver: body.driver,
        name: body.name.trim(),
        events: body.events ?? ["digest.ready", "pr.bot_blocked", "release.ready"],
        configEncrypted: encryptSecretJson(deps.config.encryptionKey, body.config),
      })
      .returning({
        id: notificationChannels.id,
        workspaceId: notificationChannels.workspaceId,
        projectId: notificationChannels.projectId,
        driver: notificationChannels.driver,
        name: notificationChannels.name,
        events: notificationChannels.events,
        isEnabled: notificationChannels.isEnabled,
        createdAt: notificationChannels.createdAt,
      });

    return c.json({ channel: inserted[0] }, 201);
  });

  app.get("/workspaces/:workspaceId/notification-channels", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) {
      return c.json({ error: "Not a member of this workspace." }, 403);
    }

    const rows = await deps.db
      .select({
        id: notificationChannels.id,
        workspaceId: notificationChannels.workspaceId,
        projectId: notificationChannels.projectId,
        driver: notificationChannels.driver,
        name: notificationChannels.name,
        events: notificationChannels.events,
        isEnabled: notificationChannels.isEnabled,
        createdAt: notificationChannels.createdAt,
      })
      .from(notificationChannels)
      .where(and(eq(notificationChannels.workspaceId, workspaceId)));

    return c.json({ channels: rows });
  });

  app.patch("/workspaces/:workspaceId/notification-channels/:channelId", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const channelId = c.req.param("channelId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to update notification channels." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly isEnabled?: boolean;
      readonly name?: string;
      readonly events?: string[];
    };

    const updated = await deps.db
      .update(notificationChannels)
      .set({
        ...(body.isEnabled !== undefined ? { isEnabled: body.isEnabled } : {}),
        ...(body.name !== undefined ? { name: body.name.trim() } : {}),
        ...(body.events !== undefined ? { events: body.events } : {}),
      })
      .where(
        and(
          eq(notificationChannels.id, channelId),
          eq(notificationChannels.workspaceId, workspaceId),
        ),
      )
      .returning({
        id: notificationChannels.id,
        workspaceId: notificationChannels.workspaceId,
        projectId: notificationChannels.projectId,
        driver: notificationChannels.driver,
        name: notificationChannels.name,
        events: notificationChannels.events,
        isEnabled: notificationChannels.isEnabled,
        createdAt: notificationChannels.createdAt,
      });

    if (!updated[0]) return c.json({ error: "Notification channel not found." }, 404);
    return c.json({ channel: updated[0] });
  });

  app.delete("/workspaces/:workspaceId/notification-channels/:channelId", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const channelId = c.req.param("channelId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to delete notification channels." }, 403);
    }

    await deps.db
      .delete(notificationChannels)
      .where(
        and(
          eq(notificationChannels.id, channelId),
          eq(notificationChannels.workspaceId, workspaceId),
        ),
      );
    return c.json({ ok: true });
  });

  app.post("/workspaces/:workspaceId/notification-channels/:channelId/test", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.param("workspaceId");
    const channelId = c.req.param("channelId");
    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops"])) {
      return c.json({ error: "Requires owner or ops role to test notification channels." }, 403);
    }

    try {
      const result = await deps.notifier.sendTestChannel({
        workspaceId,
        channelId,
        actorDisplayName: user.displayName,
        actorHandles: user.notificationHandles,
      });
      return c.json(result);
    } catch (error) {
      return c.json(
        {
          error: error instanceof Error ? error.message : "Failed to send test notification.",
        },
        502,
      );
    }
  });

  return app;
}
