import * as Schema from "effect/Schema";
import { IsoTimestamp } from "./auth.ts";

export const ArchitectureDecision = Schema.Struct({
  id: Schema.String,
  date: Schema.String,
  repoFullName: Schema.NullOr(Schema.String),
  summary: Schema.String,
  rationale: Schema.String,
  sourceRef: Schema.NullOr(Schema.String),
});
export type ArchitectureDecision = typeof ArchitectureDecision.Type;

export const ModuleProgressEntry = Schema.Struct({
  name: Schema.String,
  repoFullName: Schema.NullOr(Schema.String),
  status: Schema.Literals(["planned", "in_progress", "blocked", "completed"]),
  progressPct: Schema.optional(Schema.Number),
  notes: Schema.String,
  ownerVcsLogin: Schema.NullOr(Schema.String),
});
export type ModuleProgressEntry = typeof ModuleProgressEntry.Type;

export const RecurringRisk = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  severity: Schema.Literals(["low", "medium", "high"]),
  occurrences: Schema.Int,
  mitigation: Schema.String,
  active: Schema.Boolean,
});
export type RecurringRisk = typeof RecurringRisk.Type;

export const ProjectDirective = Schema.Struct({
  id: Schema.String,
  text: Schema.String,
  createdBy: Schema.String,
  createdAt: IsoTimestamp,
  active: Schema.Boolean,
});
export type ProjectDirective = typeof ProjectDirective.Type;

export const ProjectMemory = Schema.Struct({
  id: Schema.String,
  projectId: Schema.String,
  version: Schema.Int,
  architectureDecisions: Schema.Array(ArchitectureDecision),
  moduleMap: Schema.Array(ModuleProgressEntry),
  recurringRisks: Schema.Array(RecurringRisk),
  directives: Schema.Array(ProjectDirective),
  updatedBy: Schema.NullOr(Schema.String),
  updatedAt: IsoTimestamp,
});
export type ProjectMemory = typeof ProjectMemory.Type;

export const ProjectMemoryUpdateInput = Schema.Struct({
  architectureDecisions: Schema.optional(Schema.Array(ArchitectureDecision)),
  moduleMap: Schema.optional(Schema.Array(ModuleProgressEntry)),
  recurringRisks: Schema.optional(Schema.Array(RecurringRisk)),
  directives: Schema.optional(Schema.Array(ProjectDirective)),
});
export type ProjectMemoryUpdateInput = typeof ProjectMemoryUpdateInput.Type;

export const DigestTriggerType = Schema.Literals(["scheduled", "manual", "release"]);
export type DigestTriggerType = typeof DigestTriggerType.Type;

export const CockpitDigest = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  triggerType: DigestTriggerType,
  periodStart: IsoTimestamp,
  periodEnd: IsoTimestamp,
  markdownBody: Schema.String,
  structuredJson: Schema.Record(Schema.String, Schema.Unknown),
  createdAt: IsoTimestamp,
});
export type CockpitDigest = typeof CockpitDigest.Type;
