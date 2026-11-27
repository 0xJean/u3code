import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { getUserWorkspaceRoles, hasAnyRole } from "../../auth/middleware.ts";
import { gateApprovals, projects, releases, users, workItems } from "../../db/schema.ts";
import { LarkNotifierDriver } from "../../notifiers/index.ts";
import { newId } from "../../utils/crypto.ts";
import { defineHubPlugin } from "../types.ts";

interface LarkCardActionPayload {
  readonly type?: string;
  readonly challenge?: string;
  readonly token?: string;
  readonly open_id?: string;
  readonly operator?: { readonly open_id?: string };
  readonly action?: {
    readonly value?: {
      readonly action?: string;
      readonly targetType?: "work_item" | "release";
      readonly targetId?: string;
      readonly gateKey?: string;
      readonly status?: "approved" | "rejected";
      readonly note?: string;
    };
  };
}

export const larkPlugin = defineHubPlugin({
  id: "lark",
  name: "Lark / Feishu Connector",
  version: "1.0.0",
  description:
    "Sends interactive Lark cards with @mentions and handles interactive card gate approval callbacks.",
  builtin: true,
  register(ctx) {
    ctx.registerNotifier(new LarkNotifierDriver(ctx.fetchImpl));

    const callbackApp = new Hono();
    callbackApp.post("/", async (c) => {
      const body = (await c.req.json()) as LarkCardActionPayload;

      // Support Lark event / card callback URL verification handshake.
      if (body.challenge) {
        if (ctx.config.larkVerificationToken && body.token !== ctx.config.larkVerificationToken) {
          return c.json({ error: "Invalid verification token." }, 401);
        }
        return c.json({ challenge: body.challenge });
      }

      if (ctx.config.larkVerificationToken && body.token !== ctx.config.larkVerificationToken) {
        return c.json({ error: "Invalid verification token." }, 401);
      }

      const openId = (body.open_id ?? body.operator?.open_id ?? "").trim();
      const val = body.action?.value;
      if (!openId || !val || val.action !== "gate_decision") {
        return c.json({ error: "Unsupported Lark callback payload." }, 400);
      }
      if (!val.targetType || !val.targetId || !val.gateKey || !val.status) {
        return c.json({ error: "Missing gate decision fields in card action." }, 400);
      }

      const allUsers = await ctx.db.select().from(users);
      const actor = allUsers.find((u) => u.notificationHandles.lark?.trim() === openId);
      if (!actor) {
        return c.json(
          { error: "No Hub user matched this Lark open_id. Bind it in Cockpit Setup -> Profile." },
          403,
        );
      }

      let project: typeof projects.$inferSelect | undefined;
      if (val.targetType === "work_item") {
        const rows = await ctx.db
          .select({ project: projects })
          .from(workItems)
          .innerJoin(projects, eq(workItems.projectId, projects.id))
          .where(eq(workItems.id, val.targetId))
          .limit(1);
        project = rows[0]?.project;
      } else {
        const rows = await ctx.db
          .select({ project: projects })
          .from(releases)
          .innerJoin(projects, eq(releases.projectId, projects.id))
          .where(eq(releases.id, val.targetId))
          .limit(1);
        project = rows[0]?.project;
      }

      if (!project) {
        return c.json({ error: "Gate target not found." }, 404);
      }

      const roles = await getUserWorkspaceRoles(ctx.db, project.workspaceId, actor.id);
      const gateRule = project.workflowConfig.gates.find((g) => g.key === val.gateKey);
      const requiredRoles = gateRule?.requiredRoles ?? ["owner"];
      if (!hasAnyRole(roles, requiredRoles)) {
        return c.json(
          { error: `Gate '${val.gateKey}' requires one of roles: ${requiredRoles.join(", ")}.` },
          403,
        );
      }

      const inserted = await ctx.db
        .insert(gateApprovals)
        .values({
          id: newId("gat"),
          targetType: val.targetType,
          targetId: val.targetId,
          gateKey: val.gateKey,
          status: val.status,
          approvedBy: actor.id,
          note: val.note?.trim() || "Submitted via Lark interactive card",
          evidenceUrls: [],
        })
        .returning();

      ctx.broker.broadcast({
        type: "gate.updated",
        workspaceId: project.workspaceId,
        targetType: val.targetType,
        targetId: val.targetId,
        gateKey: val.gateKey,
        status: val.status,
      });

      return c.json({ ok: true, approval: inserted[0] });
    });

    ctx.registerRoute("callback", callbackApp);
  },
});
