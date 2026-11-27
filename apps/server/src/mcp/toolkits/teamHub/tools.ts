import {
  CockpitOverview,
  OrchestratorMcpFailure,
  TeamHubListBoardMessagesResult,
  TeamHubPostBoardMessageResult,
  TeamHubPublishPulseResult,
  TeamHubReviewQueueResult,
  TeamHubWorkItemResult,
  TrimmedNonEmptyString,
  WorkItemDetail,
} from "@t3tools/contracts";
import {
  AssigneeType,
  ChecklistItem,
  ProjectMemory,
  PulseBlocker,
  TeamBoardAuthorType,
  TeamBoardMessageKind,
  WorkHealth,
} from "@u3code/hub-contracts";
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

const TeamHubGetWorkItemTool = Tool.make("team_hub_get_work_item", {
  ...shared,
  description:
    "Read a Team Hub work item's spec, acceptance criteria, gate approvals, linked PRs, and pulses.",
  parameters: Schema.Struct({
    workItemId: TrimmedNonEmptyString,
  }),
  success: WorkItemDetail,
})
  .annotate(Tool.Title, "Read Team Hub work item details")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const TeamHubUpdateWorkItemTool = Tool.make("team_hub_update_work_item", {
  ...shared,
  description:
    "Update a Team Hub work item's title, stage, health, spec, preview URLs, lifecycle attributes, assignee, or acceptance criteria (subject to workflow gates).",
  parameters: Schema.Struct({
    workItemId: TrimmedNonEmptyString,
    title: Schema.optionalKey(TrimmedNonEmptyString),
    stage: Schema.optionalKey(TrimmedNonEmptyString),
    health: Schema.optionalKey(WorkHealth),
    specMarkdown: Schema.optionalKey(Schema.String),
    specUrl: Schema.optionalKey(Schema.NullOr(Schema.String)),
    previewUrls: Schema.optionalKey(Schema.Array(Schema.String)),
    checklistItems: Schema.optionalKey(Schema.Array(ChecklistItem)),
    attributes: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Json).annotate({
        description:
          "Partial lifecycle attributes patch merged into existing attributes (e.g. plannedStartAt, dueAt, prdStatus, prototypeStatus, prototypeUrl, designTier, designDocPath, githubIssueNumber, githubIssueUrl, githubLabels, branchTopology, branchName, targetBranch).",
      }),
    ),
    assigneeType: Schema.optionalKey(AssigneeType),
    assigneeUserId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    assigneeRunnerId: Schema.optionalKey(Schema.NullOr(Schema.String)),
    verifyAcIds: Schema.optionalKey(
      Schema.Array(TrimmedNonEmptyString).annotate({
        description: "Mark matching checklist item IDs verified without rewriting the whole list.",
      }),
    ),
  }),
  success: TeamHubWorkItemResult,
})
  .annotate(Tool.Title, "Update Team Hub work item")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

const HubBoardReadTool = Tool.make("hub_board_read", {
  ...shared,
  description:
    "Read chronological messages from the Team Hub Collaboration Board (supports optional projectId, since sequence cursor, and limit).",
  parameters: Schema.Struct({
    workspaceId: Schema.optionalKey(
      TrimmedNonEmptyString.annotate({ description: "Defaults to the user's first workspace." }),
    ),
    projectId: Schema.optionalKey(TrimmedNonEmptyString),
    since: Schema.optionalKey(
      Schema.Int.annotate({
        description: "Return messages with sequence number greater than this value.",
      }),
    ),
    limit: Schema.optionalKey(
      Schema.Int.annotate({ description: "Maximum number of messages to return (1-200)." }),
    ),
  }),
  success: TeamHubListBoardMessagesResult,
})
  .annotate(Tool.Title, "Read Team Hub Collaboration Board")
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, true)
  .annotate(Tool.OpenWorld, true);

const HubBoardPostTool = Tool.make("hub_board_post", {
  ...shared,
  description:
    "Post a message, handoff, or status update to the Team Hub Collaboration Board with optional @mentions and linked work item or pull request metadata.",
  parameters: Schema.Struct({
    workspaceId: Schema.optionalKey(
      TrimmedNonEmptyString.annotate({ description: "Defaults to the user's first workspace." }),
    ),
    projectId: Schema.optionalKey(TrimmedNonEmptyString),
    kind: Schema.optionalKey(TeamBoardMessageKind),
    authorType: Schema.optionalKey(TeamBoardAuthorType),
    authorHandle: Schema.optionalKey(TrimmedNonEmptyString),
    authorDisplayName: Schema.optionalKey(TrimmedNonEmptyString),
    body: TrimmedNonEmptyString,
    mentions: Schema.optionalKey(Schema.Array(TrimmedNonEmptyString)),
    workItemId: Schema.optionalKey(TrimmedNonEmptyString),
    workItemCode: Schema.optionalKey(TrimmedNonEmptyString),
    changeRequestId: Schema.optionalKey(TrimmedNonEmptyString),
    changeRequestRef: Schema.optionalKey(TrimmedNonEmptyString),
  }),
  success: TeamHubPostBoardMessageResult,
})
  .annotate(Tool.Title, "Post to Team Hub Collaboration Board")
  .annotate(Tool.Readonly, false)
  .annotate(Tool.Destructive, false)
  .annotate(Tool.Idempotent, false)
  .annotate(Tool.OpenWorld, true);

export const TeamHubToolkit = Toolkit.make(
  TeamHubGetContextTool,
  TeamHubGetReviewQueueTool,
  TeamHubGetWorkItemTool,
  TeamHubUpdateWorkItemTool,
  TeamHubPublishPulseTool,
  HubBoardReadTool,
  HubBoardPostTool,
);
