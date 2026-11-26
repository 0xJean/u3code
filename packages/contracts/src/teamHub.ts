import * as Schema from "effect/Schema";
import {
  ChangeRequestAudit,
  ChecklistItem,
  CockpitDigest,
  CockpitOverview,
  DigestTriggerType,
  ForgeKind,
  GateApproval,
  GateApprovalStatus,
  HubAuthMe,
  HubUser,
  HubWsEvent,
  NotificationChannelSummary,
  NotificationEventKind,
  NotificationHandles,
  NotifierDriverKind,
  Project,
  ProjectDirective,
  ProjectMemory,
  ProjectRepo,
  Pulse,
  PulseCreateInput,
  PulseDraft,
  ReleaseCard,
  ReleaseStatus,
  RepoPolicy,
  WorkHealth,
  WorkItem,
  WorkItemPriority,
  WorkItemType,
  WorkspaceMember,
} from "@u3code/hub-contracts";
import { ThreadId, TrimmedNonEmptyString } from "./baseSchemas.ts";

export class TeamHubError extends Schema.TaggedError<TeamHubError>()("TeamHubError", {
  message: Schema.String,
  statusCode: Schema.optional(Schema.Int),
}) {}

export const TeamHubStatusResult = Schema.Struct({
  connected: Schema.Boolean,
  hubUrl: Schema.NullOr(Schema.String),
  me: Schema.NullOr(HubAuthMe),
});
export type TeamHubStatusResult = typeof TeamHubStatusResult.Type;

export const TeamHubConnectLocalInput = Schema.Struct({
  hubUrl: TrimmedNonEmptyString,
  username: TrimmedNonEmptyString,
  displayName: Schema.optional(TrimmedNonEmptyString),
});
export type TeamHubConnectLocalInput = typeof TeamHubConnectLocalInput.Type;

export const TeamHubConnectTokensInput = Schema.Struct({
  hubUrl: TrimmedNonEmptyString,
  accessToken: TrimmedNonEmptyString,
  refreshToken: TrimmedNonEmptyString,
});
export type TeamHubConnectTokensInput = typeof TeamHubConnectTokensInput.Type;

export const TeamHubOverviewInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TeamHubOverviewInput = typeof TeamHubOverviewInput.Type;

export const TeamHubReviewQueueInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  bucket: Schema.optional(Schema.String),
  repo: Schema.optional(Schema.String),
});
export type TeamHubReviewQueueInput = typeof TeamHubReviewQueueInput.Type;

export const TeamHubReviewQueueResult = Schema.Struct({
  items: Schema.Array(ChangeRequestAudit),
  grouped: Schema.Record(Schema.String, Schema.Array(ChangeRequestAudit)),
});
export type TeamHubReviewQueueResult = typeof TeamHubReviewQueueResult.Type;

export const TeamHubDigestsInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
});
export type TeamHubDigestsInput = typeof TeamHubDigestsInput.Type;

export const TeamHubDigestsResult = Schema.Struct({
  digests: Schema.Array(CockpitDigest),
});
export type TeamHubDigestsResult = typeof TeamHubDigestsResult.Type;

export const TeamHubGenerateDigestInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  triggerType: Schema.optional(DigestTriggerType),
  periodHours: Schema.optional(Schema.Int),
});
export type TeamHubGenerateDigestInput = typeof TeamHubGenerateDigestInput.Type;

export const TeamHubGenerateDigestResult = Schema.Struct({
  digest: CockpitDigest,
  updatedMemory: Schema.NullOr(ProjectMemory),
});
export type TeamHubGenerateDigestResult = typeof TeamHubGenerateDigestResult.Type;

export const TeamHubMemoryInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
});
export type TeamHubMemoryInput = typeof TeamHubMemoryInput.Type;

export const TeamHubMemoryResult = Schema.Struct({
  memory: Schema.NullOr(ProjectMemory),
});
export type TeamHubMemoryResult = typeof TeamHubMemoryResult.Type;

export const TeamHubUpdateDirectivesInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  directives: Schema.Array(ProjectDirective),
});
export type TeamHubUpdateDirectivesInput = typeof TeamHubUpdateDirectivesInput.Type;

export const TeamHubCreateWorkItemInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  title: TrimmedNonEmptyString,
  itemType: Schema.optional(WorkItemType),
  priority: Schema.optional(WorkItemPriority),
  stage: Schema.optional(Schema.String),
  specMarkdown: Schema.optional(Schema.String),
  checklistItems: Schema.optional(Schema.Array(ChecklistItem)),
});
export type TeamHubCreateWorkItemInput = typeof TeamHubCreateWorkItemInput.Type;

export const TeamHubWorkItemResult = Schema.Struct({
  workItem: WorkItem,
});
export type TeamHubWorkItemResult = typeof TeamHubWorkItemResult.Type;

export const TeamHubUpdateWorkItemInput = Schema.Struct({
  workItemId: TrimmedNonEmptyString,
  title: Schema.optional(TrimmedNonEmptyString),
  stage: Schema.optional(Schema.String),
  health: Schema.optional(WorkHealth),
  specMarkdown: Schema.optional(Schema.String),
  checklistItems: Schema.optional(Schema.Array(ChecklistItem)),
});
export type TeamHubUpdateWorkItemInput = typeof TeamHubUpdateWorkItemInput.Type;

export const TeamHubApproveGateInput = Schema.Struct({
  targetType: Schema.Literals(["work_item", "release"]),
  targetId: TrimmedNonEmptyString,
  gateKey: TrimmedNonEmptyString,
  status: GateApprovalStatus,
  note: Schema.optional(Schema.String),
});
export type TeamHubApproveGateInput = typeof TeamHubApproveGateInput.Type;

export const TeamHubApproveGateResult = Schema.Struct({
  approval: GateApproval,
});
export type TeamHubApproveGateResult = typeof TeamHubApproveGateResult.Type;

export const TeamHubPublishPulseInput = Schema.Struct({
  workItemId: TrimmedNonEmptyString,
  pulse: PulseCreateInput,
});
export type TeamHubPublishPulseInput = typeof TeamHubPublishPulseInput.Type;

export const TeamHubPublishPulseResult = Schema.Struct({
  pulse: Pulse,
});
export type TeamHubPublishPulseResult = typeof TeamHubPublishPulseResult.Type;

export const TeamHubExtractPulseDraftInput = Schema.Struct({
  threadId: ThreadId,
  threadTitle: Schema.String,
  branchName: Schema.optional(Schema.NullOr(Schema.String)),
  recentExcerpts: Schema.optional(Schema.Array(Schema.String)),
});
export type TeamHubExtractPulseDraftInput = typeof TeamHubExtractPulseDraftInput.Type;

export const TeamHubCreateWorkspaceInput = Schema.Struct({
  slug: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
});
export type TeamHubCreateWorkspaceInput = typeof TeamHubCreateWorkspaceInput.Type;

export const TeamHubCreateWorkspaceResult = Schema.Struct({
  workspace: Schema.Struct({
    id: Schema.String,
    slug: Schema.String,
    name: Schema.String,
    createdAt: Schema.String,
  }),
});
export type TeamHubCreateWorkspaceResult = typeof TeamHubCreateWorkspaceResult.Type;

export const TeamHubCreateProjectInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  key: TrimmedNonEmptyString,
  name: TrimmedNonEmptyString,
  description: Schema.optional(Schema.String),
  preset: Schema.optional(Schema.Literals(["lean", "full-delivery"])),
});
export type TeamHubCreateProjectInput = typeof TeamHubCreateProjectInput.Type;

export const TeamHubCreateProjectResult = Schema.Struct({
  project: Project,
});
export type TeamHubCreateProjectResult = typeof TeamHubCreateProjectResult.Type;

export const TeamHubAddProjectRepoInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  forgeKind: Schema.optional(ForgeKind),
  repoFullName: TrimmedNonEmptyString,
  tags: Schema.optional(Schema.Array(Schema.String)),
  repoPolicy: Schema.optional(RepoPolicy),
});
export type TeamHubAddProjectRepoInput = typeof TeamHubAddProjectRepoInput.Type;

export const TeamHubAddProjectRepoResult = Schema.Struct({
  repo: ProjectRepo,
});
export type TeamHubAddProjectRepoResult = typeof TeamHubAddProjectRepoResult.Type;

export const TeamHubListNotificationChannelsInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
});
export type TeamHubListNotificationChannelsInput = typeof TeamHubListNotificationChannelsInput.Type;

export const TeamHubListNotificationChannelsResult = Schema.Struct({
  channels: Schema.Array(NotificationChannelSummary),
});
export type TeamHubListNotificationChannelsResult =
  typeof TeamHubListNotificationChannelsResult.Type;

export const TeamHubCreateNotificationChannelInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  driver: NotifierDriverKind,
  name: TrimmedNonEmptyString,
  events: Schema.optional(Schema.Array(NotificationEventKind)),
  webhookUrl: TrimmedNonEmptyString,
  secret: Schema.optional(Schema.String),
});
export type TeamHubCreateNotificationChannelInput =
  typeof TeamHubCreateNotificationChannelInput.Type;

export const TeamHubCreateNotificationChannelResult = Schema.Struct({
  channel: NotificationChannelSummary,
});
export type TeamHubCreateNotificationChannelResult =
  typeof TeamHubCreateNotificationChannelResult.Type;

export const TeamHubUpdateProfileInput = Schema.Struct({
  displayName: Schema.optional(TrimmedNonEmptyString),
  primaryVcsLogin: Schema.optional(Schema.NullOr(Schema.String)),
  notificationHandles: Schema.optional(NotificationHandles),
});
export type TeamHubUpdateProfileInput = typeof TeamHubUpdateProfileInput.Type;

export const TeamHubUpdateProfileResult = Schema.Struct({
  user: HubUser,
});
export type TeamHubUpdateProfileResult = typeof TeamHubUpdateProfileResult.Type;

export const TeamHubListMembersInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
});
export type TeamHubListMembersInput = typeof TeamHubListMembersInput.Type;

export const TeamHubListMembersResult = Schema.Struct({
  members: Schema.Array(WorkspaceMember),
});
export type TeamHubListMembersResult = typeof TeamHubListMembersResult.Type;

export const TeamHubUpdateMemberRolesInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
  userId: TrimmedNonEmptyString,
  roles: Schema.Array(TrimmedNonEmptyString),
});
export type TeamHubUpdateMemberRolesInput = typeof TeamHubUpdateMemberRolesInput.Type;

export const TeamHubUpdateMemberRolesResult = Schema.Struct({
  workspaceId: Schema.String,
  userId: Schema.String,
  roles: Schema.Array(Schema.String),
});
export type TeamHubUpdateMemberRolesResult = typeof TeamHubUpdateMemberRolesResult.Type;

export const TeamHubListReleasesInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
});
export type TeamHubListReleasesInput = typeof TeamHubListReleasesInput.Type;

export const TeamHubListReleasesResult = Schema.Struct({
  releases: Schema.Array(ReleaseCard),
});
export type TeamHubListReleasesResult = typeof TeamHubListReleasesResult.Type;

export const TeamHubCreateReleaseInput = Schema.Struct({
  projectId: TrimmedNonEmptyString,
  versionLabel: TrimmedNonEmptyString,
  repoSnapshots: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  rollbackPlan: Schema.optional(Schema.String),
  releaseNotesMd: Schema.optional(Schema.String),
  workItemIds: Schema.optional(Schema.Array(Schema.String)),
});
export type TeamHubCreateReleaseInput = typeof TeamHubCreateReleaseInput.Type;

export const TeamHubUpdateReleaseInput = Schema.Struct({
  releaseId: TrimmedNonEmptyString,
  status: Schema.optional(ReleaseStatus),
  repoSnapshots: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
  rollbackPlan: Schema.optional(Schema.String),
  releaseNotesMd: Schema.optional(Schema.String),
});
export type TeamHubUpdateReleaseInput = typeof TeamHubUpdateReleaseInput.Type;

export const TeamHubReleaseResult = Schema.Struct({
  release: ReleaseCard,
});
export type TeamHubReleaseResult = typeof TeamHubReleaseResult.Type;

export const TeamHubSubscribeEventsInput = Schema.Struct({
  workspaceId: TrimmedNonEmptyString,
});
export type TeamHubSubscribeEventsInput = typeof TeamHubSubscribeEventsInput.Type;

export { CockpitOverview, HubWsEvent, PulseDraft };
