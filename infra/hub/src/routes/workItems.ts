import { and, asc, desc, eq, max } from "drizzle-orm";
import { Hono } from "hono";
import {
  resolveLatestGateApprovals,
  type ChecklistItem,
  type GateApproval,
  type ProjectDirective,
  type PulseCreateInput,
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
  changeRequests,
  gateApprovals,
  projectMemories,
  projects,
  pulses,
  releases,
  users,
  workItems,
} from "../db/schema.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import { newId } from "../utils/crypto.ts";
import { computeTriageBucket } from "../webhooks/github.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";
import { appendBoardMessage, deriveUserBoardHandle } from "./board.ts";

const VALID_ASSIGNEE_TYPES = new Set<"unassigned" | "human" | "runner">([
  "unassigned",
  "human",
  "runner",
]);

export function createWorkItemRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  app.use("*", createAuthMiddleware(deps.db, deps.config));

  app.post("/projects/:projectId/work-items", async (c) => {
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

    const body = (await c.req.json()) as {
      readonly title?: string;
      readonly itemType?: string;
      readonly priority?: string;
      readonly stage?: string;
      readonly specMarkdown?: string;
      readonly specUrl?: string | null;
      readonly previewUrls?: string[];
      readonly checklistItems?: ChecklistItem[];
      readonly attributes?: Record<string, unknown>;
      readonly assigneeType?: "unassigned" | "human" | "runner";
      readonly assigneeUserId?: string | null;
      readonly assigneeRunnerId?: string | null;
    };

    const title = body.title?.trim();
    if (!title) return c.json({ error: "title is required." }, 400);
    if (body.assigneeType !== undefined && !VALID_ASSIGNEE_TYPES.has(body.assigneeType)) {
      return c.json({ error: `Invalid assigneeType '${String(body.assigneeType)}'.` }, 400);
    }

    const assigneeType =
      body.assigneeType ??
      (body.assigneeUserId ? "human" : body.assigneeRunnerId ? "runner" : "unassigned");
    const assigneeUserId = assigneeType === "human" ? (body.assigneeUserId ?? null) : null;
    const assigneeRunnerId = assigneeType === "runner" ? (body.assigneeRunnerId ?? null) : null;

    const maxSeqRows = await deps.db
      .select({ maxSeq: max(workItems.seqNo) })
      .from(workItems)
      .where(eq(workItems.projectId, projectId));
    const seqNo = (maxSeqRows[0]?.maxSeq ?? 0) + 1;
    const code = `${project.key}-${seqNo}`;
    const defaultStage = project.workflowConfig.stages[0]?.id ?? "backlog";
    const stage = body.stage?.trim() || defaultStage;

    const inserted = await deps.db
      .insert(workItems)
      .values({
        id: newId("wi"),
        projectId,
        seqNo,
        code,
        title,
        itemType: body.itemType ?? "feature",
        priority: body.priority ?? "p1",
        stage,
        assigneeType,
        assigneeUserId,
        assigneeRunnerId,
        specMarkdown: body.specMarkdown ?? "",
        specUrl: body.specUrl ?? null,
        previewUrls: body.previewUrls ?? [],
        checklistItems: body.checklistItems ?? [],
        attributes: body.attributes ?? {},
        createdBy: user.id,
      })
      .returning();

    const item = inserted[0]!;
    deps.broker.broadcast({
      type: "work_item.changed",
      workspaceId: project.workspaceId,
      projectId,
      workItemId: item.id,
      stage: item.stage,
      health: item.health as "on_track" | "at_risk" | "blocked",
    });

    return c.json({ workItem: item }, 201);
  });

  app.patch("/work-items/:workItemId", async (c) => {
    const user = getAuthUser(c);
    const workItemId = c.req.param("workItemId");
    const rows = await deps.db
      .select({ item: workItems, project: projects })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(eq(workItems.id, workItemId))
      .limit(1);
    const found = rows[0];
    if (!found) return c.json({ error: "Work item not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, found.project.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const body = (await c.req.json()) as {
      readonly title?: string;
      readonly stage?: string;
      readonly health?: "on_track" | "at_risk" | "blocked";
      readonly specMarkdown?: string;
      readonly specUrl?: string | null;
      readonly previewUrls?: string[];
      readonly checklistItems?: ChecklistItem[];
      readonly attributes?: Record<string, unknown>;
      readonly assigneeType?: "unassigned" | "human" | "runner";
      readonly assigneeUserId?: string | null;
      readonly assigneeRunnerId?: string | null;
    };

    // Enforce required gates configured before entering the target stage (latest status per gate wins).
    if (body.stage && body.stage !== found.item.stage) {
      const requiredGates = found.project.workflowConfig.gates.filter(
        (g) => g.beforeStage === body.stage && !g.optional,
      );
      if (requiredGates.length > 0) {
        const approvals = await deps.db
          .select()
          .from(gateApprovals)
          .where(
            and(eq(gateApprovals.targetType, "work_item"), eq(gateApprovals.targetId, workItemId)),
          )
          .orderBy(asc(gateApprovals.createdAt));
        const latestByGate = resolveLatestGateApprovals(approvals as ReadonlyArray<GateApproval>);
        const missing = requiredGates.filter((g) => latestByGate.get(g.key)?.status !== "approved");
        if (missing.length > 0) {
          return c.json(
            {
              error: `Cannot move to '${body.stage}': missing required gate approval(s).`,
              missingGates: missing.map((g) => ({ key: g.key, label: g.label })),
            },
            409,
          );
        }
      }
    }

    if (body.assigneeType !== undefined && !VALID_ASSIGNEE_TYPES.has(body.assigneeType)) {
      return c.json({ error: `Invalid assigneeType '${String(body.assigneeType)}'.` }, 400);
    }

    const hasAssigneePatch =
      body.assigneeType !== undefined ||
      body.assigneeUserId !== undefined ||
      body.assigneeRunnerId !== undefined;
    let assigneePatch: {
      assigneeType?: "unassigned" | "human" | "runner";
      assigneeUserId?: string | null;
      assigneeRunnerId?: string | null;
    } = {};
    if (hasAssigneePatch) {
      const resolvedType =
        body.assigneeType ??
        (body.assigneeUserId !== undefined && body.assigneeUserId !== null
          ? "human"
          : body.assigneeRunnerId !== undefined && body.assigneeRunnerId !== null
            ? "runner"
            : (found.item.assigneeType as "unassigned" | "human" | "runner"));
      assigneePatch = {
        assigneeType: resolvedType,
        assigneeUserId:
          resolvedType === "human"
            ? body.assigneeUserId !== undefined
              ? body.assigneeUserId
              : found.item.assigneeUserId
            : null,
        assigneeRunnerId:
          resolvedType === "runner"
            ? body.assigneeRunnerId !== undefined
              ? body.assigneeRunnerId
              : found.item.assigneeRunnerId
            : null,
      };
    }

    const updated = await deps.db
      .update(workItems)
      .set({
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.stage !== undefined ? { stage: body.stage } : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
        ...(body.specMarkdown !== undefined ? { specMarkdown: body.specMarkdown } : {}),
        ...(body.specUrl !== undefined ? { specUrl: body.specUrl } : {}),
        ...(body.previewUrls !== undefined ? { previewUrls: body.previewUrls } : {}),
        ...(body.checklistItems !== undefined ? { checklistItems: body.checklistItems } : {}),
        ...(body.attributes !== undefined
          ? { attributes: { ...found.item.attributes, ...body.attributes } }
          : {}),
        ...assigneePatch,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(workItems.id, workItemId))
      .returning();

    const next = updated[0]!;
    deps.broker.broadcast({
      type: "work_item.changed",
      workspaceId: found.project.workspaceId,
      projectId: found.project.id,
      workItemId: next.id,
      stage: next.stage,
      health: next.health as "on_track" | "at_risk" | "blocked",
    });

    const assigneeChanged =
      next.assigneeType !== found.item.assigneeType ||
      next.assigneeUserId !== found.item.assigneeUserId ||
      next.assigneeRunnerId !== found.item.assigneeRunnerId;

    if (assigneeChanged && next.assigneeType !== "unassigned") {
      let assigneeHandle: string | null = null;
      if (next.assigneeType === "human" && next.assigneeUserId) {
        const targetRows = await deps.db
          .select()
          .from(users)
          .where(eq(users.id, next.assigneeUserId))
          .limit(1);
        const targetUser = targetRows[0];
        if (targetUser) {
          assigneeHandle = deriveUserBoardHandle(targetUser);
        }
      } else if (next.assigneeType === "runner" && next.assigneeRunnerId) {
        const normalizedRunner = next.assigneeRunnerId.trim().replace(/^@+/, "").toLowerCase();
        assigneeHandle = normalizedRunner || null;
      }

      if (assigneeHandle) {
        await appendBoardMessage(
          { db: deps.db, broker: deps.broker },
          {
            workspaceId: found.project.workspaceId,
            projectId: found.project.id,
            kind: "handoff",
            authorType: "human",
            authorUserId: user.id,
            authorHandle: deriveUserBoardHandle(user),
            authorDisplayName: user.displayName,
            body: `@${assigneeHandle} assigned to ${next.code} (${next.title})`,
            mentions: [assigneeHandle],
            workItemId: next.id,
            workItemCode: next.code,
          },
        );
      }
    }

    return c.json({ workItem: next });
  });

  app.post("/work-items/:workItemId/pulses", async (c) => {
    const user = getAuthUser(c);
    const workItemId = c.req.param("workItemId");
    const rows = await deps.db
      .select({ item: workItems, project: projects })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(eq(workItems.id, workItemId))
      .limit(1);
    const found = rows[0];
    if (!found) return c.json({ error: "Work item not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, found.project.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const body = (await c.req.json()) as PulseCreateInput;
    if (!body.doneSummary?.trim()) {
      return c.json({ error: "doneSummary is required." }, 400);
    }

    const blockers = body.blockers ?? [];
    const health =
      body.health ??
      (blockers.length > 0 ? "blocked" : (found.item.health as "on_track" | "at_risk" | "blocked"));
    const pulseId = newId("pls");

    const inserted = await deps.db
      .insert(pulses)
      .values({
        id: pulseId,
        workItemId,
        sourceType: body.sourceType ?? "human_thread",
        authorUserId: user.id,
        sourceThreadId: body.sourceThreadId ?? null,
        repoFullName: body.repoFullName ?? null,
        stageAtTime: body.stageAtTime ?? found.item.stage,
        health,
        doneSummary: body.doneSummary.trim(),
        decisions: [...(body.decisions ?? [])],
        blockers: blockers.map((b) => ({
          text: b.text,
          ...(b.needsAttentionRoles ? { needsAttentionRoles: [...b.needsAttentionRoles] } : {}),
        })),
        nextStep: body.nextStep?.trim() ?? "",
        progressedAcIds: [...(body.progressedAcIds ?? [])],
      })
      .returning();

    await deps.db
      .update(workItems)
      .set({ health, updatedAt: new Date().toISOString() })
      .where(eq(workItems.id, workItemId));

    deps.broker.broadcast({
      type: "pulse.created",
      workspaceId: found.project.workspaceId,
      projectId: found.project.id,
      workItemId,
      pulseId,
      hasBlocker: blockers.length > 0,
    });

    const pulseAuthorType =
      body.sourceType === "runner"
        ? "agent"
        : body.sourceType === "system_merge"
          ? "system"
          : "human";
    const pulseSummaryParts = [
      `${found.item.code} (${health.replaceAll("_", " ")}): ${body.doneSummary.trim()}`,
      ...(blockers.length > 0 ? [`Blockers: ${blockers.map((b) => b.text).join("; ")}`] : []),
      ...(body.nextStep?.trim() ? [`Next: ${body.nextStep.trim()}`] : []),
    ];
    await appendBoardMessage(
      { db: deps.db, broker: deps.broker },
      {
        workspaceId: found.project.workspaceId,
        projectId: found.project.id,
        kind: "pulse",
        authorType: pulseAuthorType,
        authorUserId: user.id,
        authorHandle: deriveUserBoardHandle(user),
        authorDisplayName: user.displayName,
        body: pulseSummaryParts.join(" · "),
        workItemId: found.item.id,
        workItemCode: found.item.code,
      },
    );

    if (blockers.length > 0) {
      const mentionRoles = [
        ...new Set(blockers.flatMap((b) => b.needsAttentionRoles ?? ["owner"])),
      ];
      await deps.notifier.dispatch(
        found.project.workspaceId,
        found.project.id,
        {
          event: "blocker.needs_attention",
          title: `[${found.item.code}] Blocker Reported: ${found.item.title}`,
          severity: "warning",
          summary: `${user.displayName} synced a pulse with ${blockers.length} blocker(s).`,
          bullets: blockers.map((b) => b.text),
        },
        { roles: mentionRoles },
      );
    }

    return c.json({ pulse: inserted[0] }, 201);
  });

  app.get("/work-items/:workItemId", async (c) => {
    const user = getAuthUser(c);
    const workItemId = c.req.param("workItemId");
    const rows = await deps.db
      .select({ item: workItems, project: projects })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(eq(workItems.id, workItemId))
      .limit(1);
    const found = rows[0];
    if (!found) return c.json({ error: "Work item not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, found.project.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const [pulseRows, crRows, approvalRows] = await Promise.all([
      deps.db
        .select()
        .from(pulses)
        .where(eq(pulses.workItemId, workItemId))
        .orderBy(desc(pulses.createdAt)),
      deps.db
        .select()
        .from(changeRequests)
        .where(eq(changeRequests.workItemId, workItemId))
        .orderBy(desc(changeRequests.updatedAt)),
      deps.db
        .select()
        .from(gateApprovals)
        .where(
          and(eq(gateApprovals.targetType, "work_item"), eq(gateApprovals.targetId, workItemId)),
        )
        .orderBy(asc(gateApprovals.createdAt)),
    ]);

    return c.json({
      workItem: found.item,
      pulses: pulseRows,
      changeRequests: crRows,
      gateApprovals: approvalRows,
    });
  });

  app.post("/change-requests/:changeRequestId/link", async (c) => {
    const user = getAuthUser(c);
    const changeRequestId = c.req.param("changeRequestId");
    const crRows = await deps.db
      .select()
      .from(changeRequests)
      .where(eq(changeRequests.id, changeRequestId))
      .limit(1);
    const existing = crRows[0];
    if (!existing) return c.json({ error: "Change request not found." }, 404);

    const body = (await c.req.json()) as { readonly workItemId?: string | null };
    let workspaceId: string | null = null;
    let projectId: string | null = null;

    if (body.workItemId) {
      const wiRows = await deps.db
        .select({ item: workItems, project: projects })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, body.workItemId))
        .limit(1);
      const foundWi = wiRows[0];
      if (!foundWi) return c.json({ error: "Work item not found." }, 404);
      const roles = await getUserWorkspaceRoles(deps.db, foundWi.project.workspaceId, user.id);
      if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);
      workspaceId = foundWi.project.workspaceId;
      projectId = foundWi.project.id;
    }

    const nextWorkItemId = body.workItemId ?? null;
    const nextBucket = computeTriageBucket({
      state: existing.state,
      baseBranchRole: existing.baseBranchRole as "integration" | "release" | "other",
      workItemId: nextWorkItemId,
      automatedReview: existing.automatedReview,
      qualitySignals: existing.qualitySignals,
      humanReviewState: existing.humanReviewState,
    });

    const updated = await deps.db
      .update(changeRequests)
      .set({
        workItemId: nextWorkItemId,
        triageBucket: nextBucket,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(changeRequests.id, changeRequestId))
      .returning();

    const changeRequest = updated[0]!;
    if (workspaceId) {
      deps.broker.broadcast({
        type: "change_request.updated",
        workspaceId,
        projectId,
        repoFullName: changeRequest.repoFullName,
        number: changeRequest.number,
        triageBucket: nextBucket,
        blockingCount: changeRequest.automatedReview.blockingCount,
      });
    }

    return c.json({ changeRequest });
  });

  app.get("/work-items/:workItemId/pulses", async (c) => {
    const user = getAuthUser(c);
    const workItemId = c.req.param("workItemId");
    const rows = await deps.db
      .select({ project: projects })
      .from(workItems)
      .innerJoin(projects, eq(workItems.projectId, projects.id))
      .where(eq(workItems.id, workItemId))
      .limit(1);
    const found = rows[0];
    if (!found) return c.json({ error: "Work item not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, found.project.workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    const list = await deps.db
      .select()
      .from(pulses)
      .where(eq(pulses.workItemId, workItemId))
      .orderBy(desc(pulses.createdAt));
    return c.json({ pulses: list });
  });

  app.post("/gates/approve", async (c) => {
    const user = getAuthUser(c);
    const body = (await c.req.json()) as {
      readonly targetType?: "work_item" | "release";
      readonly targetId?: string;
      readonly gateKey?: string;
      readonly status?: "approved" | "rejected" | "revoked";
      readonly note?: string;
      readonly evidenceUrls?: string[];
    };

    if (!body.targetType || !body.targetId || !body.gateKey || !body.status) {
      return c.json({ error: "targetType, targetId, gateKey, and status are required." }, 400);
    }

    let project: typeof projects.$inferSelect | undefined;
    let matchedWorkItem: typeof workItems.$inferSelect | undefined;
    let targetLabel = body.targetId;
    if (body.targetType === "work_item") {
      const r = await deps.db
        .select({ item: workItems, project: projects })
        .from(workItems)
        .innerJoin(projects, eq(workItems.projectId, projects.id))
        .where(eq(workItems.id, body.targetId))
        .limit(1);
      project = r[0]?.project;
      matchedWorkItem = r[0]?.item;
      if (matchedWorkItem) targetLabel = `[${matchedWorkItem.code}] ${matchedWorkItem.title}`;
    } else {
      const r = await deps.db
        .select({ release: releases, project: projects })
        .from(releases)
        .innerJoin(projects, eq(releases.projectId, projects.id))
        .where(eq(releases.id, body.targetId))
        .limit(1);
      project = r[0]?.project;
      if (r[0]?.release) targetLabel = `Release ${r[0].release.versionLabel}`;
    }

    if (!project) return c.json({ error: "Gate target not found." }, 404);

    const roles = await getUserWorkspaceRoles(deps.db, project.workspaceId, user.id);
    const gateRule = project.workflowConfig.gates.find((g) => g.key === body.gateKey);
    const requiredRoles = gateRule?.requiredRoles ?? ["owner"];

    if (!hasAnyRole(roles, requiredRoles)) {
      return c.json(
        { error: `Gate '${body.gateKey}' requires one of roles: ${requiredRoles.join(", ")}.` },
        403,
      );
    }

    const noteText = body.note?.trim() ?? "";
    const inserted = await deps.db
      .insert(gateApprovals)
      .values({
        id: newId("gat"),
        targetType: body.targetType,
        targetId: body.targetId,
        gateKey: body.gateKey,
        status: body.status,
        approvedBy: user.id,
        note: noteText,
        evidenceUrls: body.evidenceUrls ?? [],
      })
      .returning();

    deps.broker.broadcast({
      type: "gate.updated",
      workspaceId: project.workspaceId,
      targetType: body.targetType,
      targetId: body.targetId,
      gateKey: body.gateKey,
      status: body.status,
    });

    if (body.targetType === "work_item" && matchedWorkItem) {
      const gateLabel = gateRule?.label ?? body.gateKey;
      const decisionLabel =
        body.status === "approved"
          ? "Approved"
          : body.status === "rejected"
            ? "Rejected"
            : "Revoked";
      await appendBoardMessage(
        { db: deps.db, broker: deps.broker },
        {
          workspaceId: project.workspaceId,
          projectId: project.id,
          kind: "review",
          authorType: "human",
          authorUserId: user.id,
          authorHandle: deriveUserBoardHandle(user),
          authorDisplayName: user.displayName,
          body: `${decisionLabel} gate '${gateLabel}' on ${matchedWorkItem.code} (${matchedWorkItem.title})${noteText ? `: ${noteText}` : ""}`,
          workItemId: matchedWorkItem.id,
          workItemCode: matchedWorkItem.code,
        },
      );
    }

    if (body.status === "rejected") {
      const gateLabel = gateRule?.label ?? body.gateKey;
      await deps.notifier.dispatch(
        project.workspaceId,
        project.id,
        {
          event: "blocker.needs_attention",
          title: `Gate Rejected (${gateLabel}): ${targetLabel}`,
          severity: "warning",
          summary: `${user.displayName} rejected gate '${gateLabel}' on ${targetLabel}.`,
          bullets: [noteText ? `Reason: ${noteText}` : "No rejection note provided."],
        },
        { roles: ["owner"] },
      );
    }

    return c.json({ approval: inserted[0] }, 201);
  });

  app.get("/projects/:projectId/memory", async (c) => {
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

    const memRows = await deps.db
      .select()
      .from(projectMemories)
      .where(eq(projectMemories.projectId, projectId))
      .limit(1);
    return c.json({ memory: memRows[0] ?? null });
  });

  app.put("/projects/:projectId/memory/directives", async (c) => {
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
    if (!hasAnyRole(roles, ["owner", "pm", "security"])) {
      return c.json({ error: "Requires owner, pm, or security role to update directives." }, 403);
    }

    const body = (await c.req.json()) as { readonly directives?: ProjectDirective[] };
    const existing = await deps.db
      .select()
      .from(projectMemories)
      .where(eq(projectMemories.projectId, projectId))
      .limit(1);

    const nowIso = new Date().toISOString();
    const nextDirectives = body.directives ?? [];
    if (existing[0]) {
      const updated = await deps.db
        .update(projectMemories)
        .set({
          directives: nextDirectives,
          version: existing[0].version + 1,
          updatedBy: user.id,
          updatedAt: nowIso,
        })
        .where(eq(projectMemories.id, existing[0].id))
        .returning();
      return c.json({ memory: updated[0] });
    }

    const created = await deps.db
      .insert(projectMemories)
      .values({
        id: newId("mem"),
        projectId,
        directives: nextDirectives,
        updatedBy: user.id,
        updatedAt: nowIso,
      })
      .returning();
    return c.json({ memory: created[0] }, 201);
  });

  return app;
}
