import { WORKFLOW_PRESETS } from "@u3code/hub-contracts";
import { defineHubPlugin } from "../types.ts";

export const coreWorkflowsPlugin = defineHubPlugin({
  id: "core-workflows",
  name: "Core Workflow Presets",
  version: "1.0.0",
  description: "Built-in general-purpose Lean and Full Delivery workflow presets.",
  builtin: true,
  register(ctx) {
    ctx.registerWorkflowPreset({
      id: "full-delivery",
      label: "Full Delivery (Scoping -> PRD -> Dev -> QA -> Review -> Staging -> Done)",
      description:
        "Multi-stage cross-repository delivery with Spec Freeze, QA AC, Security, and Production Go/No-Go gates.",
      workflowConfig: WORKFLOW_PRESETS["full-delivery"],
    });
    ctx.registerWorkflowPreset({
      id: "lean",
      label: "Lean (Backlog -> In Progress -> Review -> Done)",
      description: "Minimal 4-stage board without mandatory gate approvals.",
      workflowConfig: WORKFLOW_PRESETS.lean,
    });
  },
});
