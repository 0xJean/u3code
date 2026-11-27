import { and, eq, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import {
  DEFAULT_REPO_POLICY,
  createWorkflowConfigFromPreset,
  type NotifierDriverKind,
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
import type { NotifierChannelSecretConfig } from "../notifiers/index.ts";
import type { HubPluginRegistry } from "../plugins/index.ts";
import { encryptSecretJson, newId } from "../utils/crypto.ts";

export function createWorkspaceRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly pluginRegistry?: HubPluginRegistry;
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
    const inserted = await deps.db
      .insert(workspaces)
      .values({
        id,
        slug,
        name,
        settings: body.settings ?? {},
      })
      .returning();

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

    const inserted = await deps.db
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

    const inserted = await deps.db
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

  return app;
}
