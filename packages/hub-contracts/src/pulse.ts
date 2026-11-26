import * as Schema from "effect/Schema";
import { IsoTimestamp } from "./auth.ts";

export const PulseSourceType = Schema.Literals([
  "human_thread",
  "system_merge",
  "system_review_block",
  "runner",
]);
export type PulseSourceType = typeof PulseSourceType.Type;

export const WorkHealth = Schema.Literals(["on_track", "at_risk", "blocked"]);
export type WorkHealth = typeof WorkHealth.Type;

export const PulseBlocker = Schema.Struct({
  text: Schema.String,
  needsAttentionRoles: Schema.optional(Schema.Array(Schema.String)),
});
export type PulseBlocker = typeof PulseBlocker.Type;

export const Pulse = Schema.Struct({
  id: Schema.String,
  workItemId: Schema.String,
  sourceType: PulseSourceType,
  authorUserId: Schema.NullOr(Schema.String),
  runnerId: Schema.NullOr(Schema.String),
  sourceThreadId: Schema.NullOr(Schema.String),
  repoFullName: Schema.NullOr(Schema.String),
  stageAtTime: Schema.String,
  health: WorkHealth,
  doneSummary: Schema.String,
  decisions: Schema.Array(Schema.String),
  blockers: Schema.Array(PulseBlocker),
  nextStep: Schema.String,
  progressedAcIds: Schema.Array(Schema.String),
  createdAt: IsoTimestamp,
});
export type Pulse = typeof Pulse.Type;

export const PulseCreateInput = Schema.Struct({
  sourceType: Schema.optional(PulseSourceType),
  sourceThreadId: Schema.optional(Schema.NullOr(Schema.String)),
  repoFullName: Schema.optional(Schema.NullOr(Schema.String)),
  stageAtTime: Schema.optional(Schema.String),
  health: Schema.optional(WorkHealth),
  doneSummary: Schema.String,
  decisions: Schema.optional(Schema.Array(Schema.String)),
  blockers: Schema.optional(Schema.Array(PulseBlocker)),
  nextStep: Schema.optional(Schema.String),
  progressedAcIds: Schema.optional(Schema.Array(Schema.String)),
});
export type PulseCreateInput = typeof PulseCreateInput.Type;

export const PulseDraft = Schema.Struct({
  workItemId: Schema.NullOr(Schema.String),
  workItemCode: Schema.NullOr(Schema.String),
  health: WorkHealth,
  doneSummary: Schema.String,
  decisions: Schema.Array(Schema.String),
  blockers: Schema.Array(PulseBlocker),
  nextStep: Schema.String,
  progressedAcIds: Schema.Array(Schema.String),
});
export type PulseDraft = typeof PulseDraft.Type;
