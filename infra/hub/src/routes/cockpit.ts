import { desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import type {
  CockpitOverview,
  CockpitWorkItemCard,
  DigestTriggerType,
} from "@u3code/hub-contracts";
import {
  createAuthMiddleware,
  getAuthUser,
  getUserWorkspaceRoles,
  type HubAuthVariables,
} from "../auth/middleware.ts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import {
  changeRequests,
  cockpitDigests,
  gateApprovals,
  projectRepos,
  projects,
  pulses,
  workItems,
} from "../db/schema.ts";
import { generateAndPersistDigest, type DigestSynthesizer } from "../memory/engine.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

export function createCockpitRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
  readonly synthesizer?: DigestSynthesizer;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  app.use("*", createAuthMiddleware(deps.db, deps.config));

  app.get("/overview", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.query("workspaceId");
    const projectId = c.req.query("projectId") ?? null;
    if (!workspaceId) {
      return c.json({ error: "workspaceId query parameter is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const workspaceProjects = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));

    const selectedProject = projectId
      ? (workspaceProjects.find((p) => p.id === projectId) ?? null)
      : null;
    const scopedProjectIds = selectedProject
      ? [selectedProject.id]
      : workspaceProjects.map((p) => p.id);

    const repos =
      scopedProjectIds.length > 0
        ? await deps.db
            .select()
            .from(projectRepos)
            .where(inArray(projectRepos.projectId, scopedProjectIds))
        : [];

    const items =
      scopedProjectIds.length > 0
        ? await deps.db
            .select()
            .from(workItems)
            .where(inArray(workItems.projectId, scopedProjectIds))
            .orderBy(desc(workItems.updatedAt))
        : [];

    const repoNames = repos.map((r) => r.repoFullName);
    const crs =
      repoNames.length > 0
        ? await deps.db
            .select()
            .from(changeRequests)
            .where(inArray(changeRequests.repoFullName, repoNames))
            .orderBy(desc(changeRequests.updatedAt))
        : [];

    const workItemIds = items.map((i) => i.id);
    const allPulses =
      workItemIds.length > 0
        ? await deps.db
            .select()
            .from(pulses)
            .where(inArray(pulses.workItemId, workItemIds))
            .orderBy(desc(pulses.createdAt))
        : [];

    const allApprovals =
      workItemIds.length > 0
        ? await deps.db
            .select()
            .from(gateApprovals)
            .where(inArray(gateApprovals.targetId, workItemIds))
        : [];

    const latestPulseByItem = new Map<string, (typeof allPulses)[number]>();
    for (const p of allPulses) {
      if (!latestPulseByItem.has(p.workItemId)) {
        latestPulseByItem.set(p.workItemId, p);
      }
    }

    const crsByItem = new Map<string, Array<(typeof crs)[number]>>();
    const orphanChangeRequests: Array<(typeof crs)[number]> = [];
    for (const cr of crs) {
      if (cr.workItemId) {
        const list = crsByItem.get(cr.workItemId) ?? [];
        list.push(cr);
        crsByItem.set(cr.workItemId, list);
      } else if (cr.state === "open") {
        orphanChangeRequests.push(cr);
      }
    }

    const approvalsByItem = new Map<string, Array<(typeof allApprovals)[number]>>();
    for (const ap of allApprovals) {
      if (ap.targetType !== "work_item") continue;
      const list = approvalsByItem.get(ap.targetId) ?? [];
      list.push(ap);
      approvalsByItem.set(ap.targetId, list);
    }

    const cards: CockpitWorkItemCard[] = items.map((item) => {
      const verifiedCount = item.checklistItems.filter((ci) => ci.verified).length;
      return {
        workItem: item as CockpitWorkItemCard["workItem"],
        latestPulse: (latestPulseByItem.get(item.id) ?? null) as CockpitWorkItemCard["latestPulse"],
        changeRequests: (crsByItem.get(item.id) ?? []) as CockpitWorkItemCard["changeRequests"],
        gateApprovals: (approvalsByItem.get(item.id) ?? []) as CockpitWorkItemCard["gateApprovals"],
        checklistVerifiedCount: verifiedCount,
        checklistTotalCount: item.checklistItems.length,
      };
    });

    const openCrs = crs.filter((cr) => cr.state === "open");
    const overview: CockpitOverview = {
      workspaceId,
      project: selectedProject as CockpitOverview["project"],
      projects: workspaceProjects as CockpitOverview["projects"],
      repos: repos as CockpitOverview["repos"],
      metrics: {
        activeWorkItems: items.filter((i) => i.stage !== "done" && i.stage !== "cancelled").length,
        blockedWorkItems: items.filter((i) => i.health === "blocked").length,
        atRiskWorkItems: items.filter((i) => i.health === "at_risk").length,
        botBlockedChangeRequests: openCrs.filter((cr) => cr.triageBucket === "bot_blocked").length,
        readyForHumanReviewCount: openCrs.filter(
          (cr) => cr.triageBucket === "ready_for_human_review",
        ).length,
        orphanChangeRequests: orphanChangeRequests.length,
        oversizedChangeRequests: openCrs.filter((cr) => cr.isOversized).length,
      },
      cards,
      orphanChangeRequests: orphanChangeRequests as CockpitOverview["orphanChangeRequests"],
      generatedAt: new Date().toISOString(),
    };

    return c.json(overview);
  });

  app.get("/review-queue", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.query("workspaceId");
    const bucket = c.req.query("bucket");
    const repoFilter = c.req.query("repo");
    if (!workspaceId) {
      return c.json({ error: "workspaceId query parameter is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const workspaceProjects = await deps.db
      .select({ id: projects.id })
      .from(projects)
      .where(eq(projects.workspaceId, workspaceId));
    const projectIds = workspaceProjects.map((p) => p.id);
    if (projectIds.length === 0) {
      return c.json({ items: [], grouped: {} });
    }

    const repos = await deps.db
      .select()
      .from(projectRepos)
      .where(inArray(projectRepos.projectId, projectIds));
    const repoNames = repos
      .map((r) => r.repoFullName)
      .filter((name) => !repoFilter || name === repoFilter);

    if (repoNames.length === 0) {
      return c.json({ items: [], grouped: {} });
    }

    const allCrs = await deps.db
      .select()
      .from(changeRequests)
      .where(inArray(changeRequests.repoFullName, repoNames))
      .orderBy(desc(changeRequests.updatedAt));

    const filtered = allCrs.filter((cr) => {
      if (bucket) return cr.triageBucket === bucket;
      return cr.state === "open" || cr.triageBucket === "auto_merged_integration";
    });

    const grouped: Record<string, Array<(typeof allCrs)[number]>> = {
      bot_blocked: [],
      ready_for_human_review: [],
      ci_blocked: [],
      orphan: [],
      auto_merged_integration: [],
    };
    for (const cr of filtered) {
      const list = grouped[cr.triageBucket];
      if (list) list.push(cr);
    }

    return c.json({ items: filtered, grouped });
  });

  app.get("/digests", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.query("workspaceId");
    if (!workspaceId) {
      return c.json({ error: "workspaceId query parameter is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const rows = await deps.db
      .select()
      .from(cockpitDigests)
      .where(eq(cockpitDigests.workspaceId, workspaceId))
      .orderBy(desc(cockpitDigests.createdAt))
      .limit(20);
    return c.json({ digests: rows });
  });

  app.post("/digests/generate", async (c) => {
    const user = getAuthUser(c);
    const body = (await c.req.json()) as {
      readonly workspaceId?: string;
      readonly projectId?: string | null;
      readonly triggerType?: DigestTriggerType;
      readonly periodHours?: number;
    };
    if (!body.workspaceId) {
      return c.json({ error: "workspaceId is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, body.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const result = await generateAndPersistDigest(
      {
        db: deps.db,
        config: deps.config,
        broker: deps.broker,
        notifier: deps.notifier,
        ...(deps.synthesizer ? { synthesizer: deps.synthesizer } : {}),
      },
      {
        workspaceId: body.workspaceId,
        projectId: body.projectId ?? null,
        triggerType: body.triggerType ?? "manual",
        ...(body.periodHours !== undefined ? { periodHours: body.periodHours } : {}),
        actorUserId: user.id,
      },
    );

    return c.json(result, 201);
  });

  return app;
}
