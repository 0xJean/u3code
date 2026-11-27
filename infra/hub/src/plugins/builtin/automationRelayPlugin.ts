import * as NodeCrypto from "node:crypto";
import { Hono } from "hono";
import type { HubWsEvent } from "@u3code/hub-contracts";
import { defineHubPlugin } from "../types.ts";

export function isActionableAutomationEvent(event: HubWsEvent): string | null {
  if (event.type === "change_request.updated" && event.triageBucket === "bot_blocked") {
    return "pr.bot_blocked";
  }
  if (event.type === "gate.updated" && event.status === "rejected") {
    return "gate.rejected";
  }
  if (event.type === "pulse.created" && event.hasBlocker) {
    return "pulse.blocker_reported";
  }
  if (event.type === "release.updated" && event.status === "ready") {
    return "release.ready";
  }
  return null;
}

export const automationRelayPlugin = defineHubPlugin({
  id: "automation-relay",
  name: "Workflow Automation Relay",
  version: "1.0.0",
  description:
    "Forwards actionable Hub lifecycle events (bot-blocked PRs, gate rejections, blockers) to T3 Code Workflows or external automation webhooks, and provides a dual-branch bot-gated preset.",
  builtin: true,
  register(ctx) {
    let relayedCount = 0;
    let lastRelayedTrigger: string | null = null;

    ctx.registerWorkflowPreset({
      id: "dual-branch-bot-gated",
      label: "Dual-Branch Bot-Gated (Scoping -> Dev -> Review -> Staging -> Done)",
      description:
        "Streamlined multi-repo preset suited for integration-branch auto-merge with automated bot review and QA + Go/No-Go gates.",
      workflowConfig: {
        preset: "dual-branch-bot-gated",
        stages: [
          { id: "scoping", label: "Scoping", category: "backlog" },
          { id: "dev", label: "Development", category: "active" },
          { id: "review", label: "Review", category: "review" },
          { id: "staging", label: "Staging", category: "release" },
          { id: "done", label: "Released", category: "done" },
        ],
        gates: [
          {
            key: "qa_ac_pass",
            label: "QA AC Verification",
            requiredRoles: ["qa", "owner"],
            beforeStage: "staging",
          },
          {
            key: "prod_go",
            label: "Production Go/No-Go",
            requiredRoles: ["owner"],
            beforeStage: "done",
          },
        ],
        progressLedgers: [],
      },
    });

    const relayEvent = async (event: HubWsEvent) => {
      const trigger = isActionableAutomationEvent(event);
      if (!trigger || !ctx.config.automationWebhookUrl) return;

      const body = JSON.stringify({
        trigger,
        source: "u3code-hub",
        event,
        sentAt: new Date().toISOString(),
      });
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "X-U3Code-Event": trigger,
      };
      if (ctx.config.automationWebhookSecret) {
        const sig = NodeCrypto.createHmac("sha256", ctx.config.automationWebhookSecret)
          .update(body)
          .digest("hex");
        headers["X-U3Code-Signature-256"] = `sha256=${sig}`;
      }

      const res = await ctx.fetchImpl(ctx.config.automationWebhookUrl, {
        method: "POST",
        headers,
        body,
      });
      if (res.ok) {
        relayedCount += 1;
        lastRelayedTrigger = trigger;
      }
    };

    ctx.onEvent("change_request.updated", relayEvent);
    ctx.onEvent("gate.updated", relayEvent);
    ctx.onEvent("pulse.created", relayEvent);
    ctx.onEvent("release.updated", relayEvent);

    const statusApp = new Hono();
    statusApp.get("/", (c) =>
      c.json({
        configured: ctx.config.automationWebhookUrl !== null,
        relayedCount,
        lastRelayedTrigger,
      }),
    );
    ctx.registerRoute("status", statusApp);
  },
});
