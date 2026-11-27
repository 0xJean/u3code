import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";
import {
  isGateCurrentlyApproved,
  type GateApproval,
  type ReleaseStatus,
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
import { gateApprovals, projects, releaseItems, releases } from "../db/schema.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import { newId } from "../utils/crypto.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

export function createReleaseRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  app.use("*", createAuthMiddleware(deps.db, deps.config));

  app.get("/projects/:projectId/releases", async (c) => {
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
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const releaseRows = await deps.db
      .select()
      .from(releases)
      .where(eq(releases.projectId, projectId))
      .orderBy(desc(releases.createdAt));

    const releaseIds = releaseRows.map((r) => r.id);
    const [approvalRows, itemRows] =
      releaseIds.length > 0
        ? await Promise.all([
            deps.db
              .select()
              .from(gateApprovals)
              .where(
                and(
                  eq(gateApprovals.targetType, "release"),
                  inArray(gateApprovals.targetId, releaseIds),
                ),
              )
              .orderBy(asc(gateApprovals.createdAt)),
            deps.db.select().from(releaseItems).where(inArray(releaseItems.releaseId, releaseIds)),
          ])
        : [[], []];

    const cards = releaseRows.map((release) => ({
      release,
      workItemIds: itemRows
        .filter((item) => item.releaseId === release.id)
        .map((item) => item.workItemId),
      gateApprovals: approvalRows.filter((a) => a.targetId === release.id),
    }));

    return c.json({ releases: cards });
  });

  app.post("/projects/:projectId/releases", async (c) => {
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
    if (!hasAnyRole(roles, ["owner", "ops", "pm"])) {
      return c.json({ error: "Requires owner, ops, or pm role to create a release." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly versionLabel?: string;
      readonly repoSnapshots?: Record<string, unknown>;
      readonly rollbackPlan?: string;
      readonly releaseNotesMd?: string;
      readonly workItemIds?: string[];
    };
    const versionLabel = body.versionLabel?.trim();
    if (!versionLabel) {
      return c.json({ error: "versionLabel is required." }, 400);
    }

    const releaseId = newId("rel");
    const inserted = await deps.db
      .insert(releases)
      .values({
        id: releaseId,
        projectId,
        versionLabel,
        status: "planning",
        repoSnapshots: body.repoSnapshots ?? {},
        rollbackPlan: body.rollbackPlan?.trim() ?? "",
        releaseNotesMd: body.releaseNotesMd?.trim() ?? "",
        createdBy: user.id,
      })
      .returning();

    const release = inserted[0]!;
    const workItemIds = [...new Set(body.workItemIds ?? [])].filter((id) => id.length > 0);
    if (workItemIds.length > 0) {
      await deps.db.insert(releaseItems).values(
        workItemIds.map((workItemId) => ({
          releaseId: release.id,
          workItemId,
        })),
      );
    }

    deps.broker.broadcast({
      type: "release.updated",
      workspaceId: project.workspaceId,
      projectId,
      releaseId: release.id,
      versionLabel: release.versionLabel,
      status: release.status as ReleaseStatus,
    });

    return c.json({ release: { release, workItemIds, gateApprovals: [] } }, 201);
  });

  app.patch("/releases/:releaseId", async (c) => {
    const user = getAuthUser(c);
    const releaseId = c.req.param("releaseId");
    const rows = await deps.db.select().from(releases).where(eq(releases.id, releaseId)).limit(1);
    const existing = rows[0];
    if (!existing) return c.json({ error: "Release not found." }, 404);

    const projectRows = await deps.db
      .select()
      .from(projects)
      .where(eq(projects.id, existing.projectId))
      .limit(1);
    const project = projectRows[0]!;

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    if (!hasAnyRole(roles, ["owner", "ops", "pm", "qa", "security"])) {
      return c.json({ error: "Insufficient role to update release." }, 403);
    }

    const body = (await c.req.json()) as {
      readonly status?: ReleaseStatus;
      readonly repoSnapshots?: Record<string, unknown>;
      readonly rollbackPlan?: string;
      readonly releaseNotesMd?: string;
    };

    if (body.status === "released") {
      // Enforce prod_go gate before marking production released when the project defines prod_go.
      const hasProdGoRule = project.workflowConfig.gates.some(
        (g) => g.key === "prod_go" && !g.optional,
      );
      if (hasProdGoRule) {
        const approvals = await deps.db
          .select()
          .from(gateApprovals)
          .where(
            and(
              eq(gateApprovals.targetType, "release"),
              eq(gateApprovals.targetId, releaseId),
              eq(gateApprovals.gateKey, "prod_go"),
            ),
          )
          .orderBy(asc(gateApprovals.createdAt));
        const approved = isGateCurrentlyApproved(
          approvals as ReadonlyArray<GateApproval>,
          "prod_go",
        );
        if (!approved) {
          return c.json(
            {
              error: "Missing required gate approval before production release: prod_go",
              missingGates: ["prod_go"],
            },
            409,
          );
        }
      }
    }

    const nowIso = new Date().toISOString();
    const updated = await deps.db
      .update(releases)
      .set({
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.repoSnapshots !== undefined ? { repoSnapshots: body.repoSnapshots } : {}),
        ...(body.rollbackPlan !== undefined ? { rollbackPlan: body.rollbackPlan } : {}),
        ...(body.releaseNotesMd !== undefined ? { releaseNotesMd: body.releaseNotesMd } : {}),
        ...(body.status === "released" && !existing.releasedAt ? { releasedAt: nowIso } : {}),
        updatedAt: nowIso,
      })
      .where(eq(releases.id, releaseId))
      .returning();

    const release = updated[0]!;
    const [approvals, items] = await Promise.all([
      deps.db
        .select()
        .from(gateApprovals)
        .where(and(eq(gateApprovals.targetType, "release"), eq(gateApprovals.targetId, releaseId)))
        .orderBy(asc(gateApprovals.createdAt)),
      deps.db.select().from(releaseItems).where(eq(releaseItems.releaseId, releaseId)),
    ]);

    deps.broker.broadcast({
      type: "release.updated",
      workspaceId: project.workspaceId,
      projectId: project.id,
      releaseId: release.id,
      versionLabel: release.versionLabel,
      status: release.status as ReleaseStatus,
    });

    if (body.status === "ready") {
      void deps.notifier.dispatch(
        project.workspaceId,
        project.id,
        {
          event: "release.ready",
          title: `Release Ready: ${project.key} ${release.versionLabel}`,
          severity: "info",
          summary: `Release ${release.versionLabel} is ready for final Go/No-Go sign-off.`,
          bullets: [
            `Project: ${project.name}`,
            ...(release.rollbackPlan
              ? [`Rollback plan: ${release.rollbackPlan.slice(0, 140)}`]
              : []),
          ],
        },
        { roles: ["owner"] },
      );
    }

    return c.json({
      release: {
        release,
        workItemIds: items.map((i) => i.workItemId),
        gateApprovals: approvals,
      },
    });
  });

  return app;
}
