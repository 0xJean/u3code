import * as Schema from "effect/Schema";
import { IsoTimestamp } from "./auth.ts";
import { Pulse, WorkHealth } from "./pulse.ts";
import { BranchRole, RepoPolicy, WorkflowConfig } from "./workflow.ts";

export const ForgeKind = Schema.Literals(["github", "gitlab"]);
export type ForgeKind = typeof ForgeKind.Type;

export const ProjectStatus = Schema.Literals(["active", "paused", "archived"]);
export type ProjectStatus = typeof ProjectStatus.Type;

export const Project = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  key: Schema.String,
  name: Schema.String,
  description: Schema.String,
  status: ProjectStatus,
  workflowConfig: WorkflowConfig,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Project = typeof Project.Type;

export const ProjectRepo = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  forgeKind: ForgeKind,
  repoFullName: Schema.String,
  tags: Schema.Array(Schema.String),
  repoPolicy: RepoPolicy,
  createdAt: IsoTimestamp,
});
export type ProjectRepo = typeof ProjectRepo.Type;

export const WorkItemType = Schema.Literals(["feature", "refactor", "bug", "chore", "security"]);
export type WorkItemType = typeof WorkItemType.Type;

export const WorkItemPriority = Schema.Literals(["p0", "p1", "p2", "p3"]);
export type WorkItemPriority = typeof WorkItemPriority.Type;

export const AssigneeType = Schema.Literals(["unassigned", "human", "runner"]);
export type AssigneeType = typeof AssigneeType.Type;

export const ChecklistItem = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  repoFullName: Schema.optional(Schema.NullOr(Schema.String)),
  testRef: Schema.optional(Schema.NullOr(Schema.String)),
  verified: Schema.Boolean,
  verifiedBy: Schema.optional(Schema.NullOr(Schema.String)),
  verifiedAt: Schema.optional(Schema.NullOr(IsoTimestamp)),
});
export type ChecklistItem = typeof ChecklistItem.Type;

export const WorkItemLink = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  linkType: Schema.Literals(["change_request", "issue", "branch", "preview", "local_thread"]),
  repoFullName: Schema.NullOr(Schema.String),
  externalId: Schema.String,
  url: Schema.NullOr(Schema.String),
  title: Schema.NullOr(Schema.String),
  metadata: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: IsoTimestamp,
});
export type WorkItemLink = typeof WorkItemLink.Type;

export const WorkItem = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  seqNo: Schema.Int,
  code: Schema.String,
  title: Schema.String,
  itemType: WorkItemType,
  priority: WorkItemPriority,
  stage: Schema.String,
  health: WorkHealth,
  assigneeType: AssigneeType,
  assigneeUserId: Schema.NullOr(Schema.String),
  assigneeRunnerId: Schema.NullOr(Schema.String),
  specMarkdown: Schema.String,
  specUrl: Schema.NullOr(Schema.String),
  previewUrls: Schema.Array(Schema.String),
  checklistItems: Schema.Array(ChecklistItem),
  attributes: Schema.Record(Schema.String, Schema.Unknown),
  createdBy: Schema.String,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type WorkItem = typeof WorkItem.Type;

export const AutomatedReviewFinding = Schema.Struct({
  reviewerName: Schema.String,
  state: Schema.String,
  riskLevel: Schema.optional(Schema.Literals(["low", "medium", "high", "unknown"])),
  bodyExcerpt: Schema.String,
  url: Schema.optional(Schema.String),
  updatedAt: IsoTimestamp,
});
export type AutomatedReviewFinding = typeof AutomatedReviewFinding.Type;

export const AutomatedReviewSummary = Schema.Struct({
  status: Schema.Literals(["pending", "pass", "blocking", "auto_merged", "skipped"]),
  blockingCount: Schema.Int,
  reviewers: Schema.Array(AutomatedReviewFinding),
});
export type AutomatedReviewSummary = typeof AutomatedReviewSummary.Type;

export const QualitySignalValue = Schema.Struct({
  key: Schema.String,
  label: Schema.optional(Schema.String),
  value: Schema.NullOr(Schema.Number),
  minValue: Schema.optional(Schema.Number),
  maxValue: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.String),
  passed: Schema.NullOr(Schema.Boolean),
  rawSummary: Schema.optional(Schema.String),
});
export type QualitySignalValue = typeof QualitySignalValue.Type;

export const QualitySignalsSnapshot = Schema.Struct({
  ciStatus: Schema.Literals(["pending", "success", "failure"]),
  signals: Schema.Record(Schema.String, QualitySignalValue),
});
export type QualitySignalsSnapshot = typeof QualitySignalsSnapshot.Type;

export const TriageBucket = Schema.Literals([
  "bot_blocked",
  "ready_for_human_review",
  "auto_merged_integration",
  "ci_blocked",
  "orphan",
  "draft",
  "merged",
]);
export type TriageBucket = typeof TriageBucket.Type;

export const ChangeRequestAudit = Schema.Struct({
  id: Schema.String,
  forgeKind: ForgeKind,
  repoFullName: Schema.String,
  number: Schema.Int,
  workItemId: Schema.NullOr(Schema.String),
  title: Schema.String,
  url: Schema.String,
  headBranch: Schema.String,
  baseBranch: Schema.String,
  baseBranchRole: BranchRole,
  headSha: Schema.String,
  authorVcsLogin: Schema.String,
  state: Schema.Literals(["open", "draft", "merged", "closed"]),
  additions: Schema.Int,
  deletions: Schema.Int,
  isOversized: Schema.Boolean,
  automatedReview: AutomatedReviewSummary,
  qualitySignals: QualitySignalsSnapshot,
  humanReviewState: Schema.Literals(["pending", "approved", "changes_requested"]),
  triageBucket: TriageBucket,
  mergedAt: Schema.NullOr(IsoTimestamp),
  updatedAt: IsoTimestamp,
});
export type ChangeRequestAudit = typeof ChangeRequestAudit.Type;

export const GateApprovalStatus = Schema.Literals(["approved", "rejected", "revoked"]);
export type GateApprovalStatus = typeof GateApprovalStatus.Type;

export const GateApproval = Schema.Struct({
  id: Schema.String,
  targetType: Schema.Literals(["work_item", "release"]),
  targetId: Schema.String,
  gateKey: Schema.String,
  status: GateApprovalStatus,
  approvedBy: Schema.String,
  note: Schema.String,
  evidenceUrls: Schema.Array(Schema.String),
  createdAt: IsoTimestamp,
});
export type GateApproval = typeof GateApproval.Type;

export const ReleaseStatus = Schema.Literals([
  "planning",
  "staging",
  "ready",
  "released",
  "rolled_back",
]);
export type ReleaseStatus = typeof ReleaseStatus.Type;

export const Release = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  versionLabel: Schema.String,
  status: ReleaseStatus,
  repoSnapshots: Schema.Record(Schema.String, Schema.Unknown),
  rollbackPlan: Schema.String,
  releaseNotesMd: Schema.String,
  createdBy: Schema.String,
  releasedAt: Schema.NullOr(IsoTimestamp),
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type Release = typeof Release.Type;

export const CockpitWorkItemCard = Schema.Struct({
  workItem: WorkItem,
  latestPulse: Schema.NullOr(Pulse),
  changeRequests: Schema.Array(ChangeRequestAudit),
  gateApprovals: Schema.Array(GateApproval),
  checklistVerifiedCount: Schema.Int,
  checklistTotalCount: Schema.Int,
});
export type CockpitWorkItemCard = typeof CockpitWorkItemCard.Type;

export const CockpitMetrics = Schema.Struct({
  activeWorkItems: Schema.Int,
  blockedWorkItems: Schema.Int,
  atRiskWorkItems: Schema.Int,
  botBlockedChangeRequests: Schema.Int,
  readyForHumanReviewCount: Schema.Int,
  orphanChangeRequests: Schema.Int,
  oversizedChangeRequests: Schema.Int,
});
export type CockpitMetrics = typeof CockpitMetrics.Type;

export const CockpitOverview = Schema.Struct({
  workspaceId: Schema.String,
  project: Schema.NullOr(Project),
  projects: Schema.Array(Project),
  repos: Schema.Array(ProjectRepo),
  metrics: CockpitMetrics,
  cards: Schema.Array(CockpitWorkItemCard),
  orphanChangeRequests: Schema.Array(ChangeRequestAudit),
  generatedAt: IsoTimestamp,
});
export type CockpitOverview = typeof CockpitOverview.Type;
