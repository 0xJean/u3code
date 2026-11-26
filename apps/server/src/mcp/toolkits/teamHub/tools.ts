import {
  CockpitOverview,
  OrchestratorMcpFailure,
  TeamHubPublishPulseResult,
  TeamHubReviewQueueResult,
  TrimmedNonEmptyString,
} from "@t3tools/contracts";
import { ProjectMemory, PulseBlocker, WorkHealth } from "@u3code/hub-contracts";
import * as Schema from "effect/Schema";
import { Tool, Toolkit } from "effect/ai";

import * as ThreadManagementService from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TeamHubService from "../../../teamHub/TeamHubService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";

const shared = {
  failure: OrchestratorMcpFailure,
  failureMode: "return" as const,
  dependencies: [
    McpInvocationContext.McpInvocationContext,
    ThreadManagementService.ThreadManagementService,
    TeamHubService.TeamHubService,
  ],
};

const TeamHubGetContextTool = Tool.make("team_hub_get_context", {
  ...shared,
  description:
    "Read Team Hub project context: active work items, metrics, living project memory, and locked owner directives.",
  parameters: Schema.Struct({
    workspaceId: Schema.optionalKey(
      TrimmedNonEmptyString.annotate({ description: "Defaults to the user's first workspace." }),
    ),
    projectId: Schema.optionalKey(
      TrimmedNonEmptyString.annotate({
        description: "Defaults to the workspace's active project.",
      }),
    ),
  }),
  success: Schema.Struct({
    connected: Schema.Boolean,
    workspaceId: Schema.NullOr(Schema.String),
    overview: Schema.NullOr(CockpitOverview),
    memory: Schema.NullOr(ProjectMemory),
  }),
})
  .annotate(Tool.Title, "Read Team Hub context & memory")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const TeamHubGetReviewQueueTool = Tool.make("team_hub_get_review_queue", {
  ...shared,
  description:
    "List Team Hub pull request triage buckets (bot_blocked, ready_for_human_review, ci_blocked, orphan).",
  parameters: Schema.Struct({
    workspaceId: Schema.optionalKey(TrimmedNonEmptyString),
    bucket: Schema.optionalKey(TrimmedNonEmptyString),
    repo: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  success: TeamHubReviewQueueResult,
})
  .annotate(Tool.Title, "List Team Hub review queue")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const TeamHubPublishPulseTool = Tool.make("team_hub_publish_pulse", {
  ...shared,
  description:
    "Publish a structured progress pulse (summary, decisions, blockers, next step) for a Team Hub work item.",
  parameters: Schema.Struct({
    workItemId: TrimmedNonEmptyString,
    health: Schema.optionalKey(WorkHealth),
    doneSummary: TrimmedNonEmptyString,
    decisions: Schema.optionalKey(Schema.Array(Schema.String)),
    blockers: Schema.optionalKey(Schema.Array(PulseBlocker)),
    nextStep: Schema.optionalKey(Schema.String),
    progressedAcIds: Schema.optionalKey(Schema.Array(Schema.String)),
  }),
  success: TeamHubPublishPulseResult,
})
  .annotate(Tool.Title, "Publish Team Hub pulse")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const TeamHubToolkit = Toolkit.make(
  TeamHubGetContextTool,
  TeamHubGetReviewQueueTool,
  TeamHubPublishPulseTool,
);
