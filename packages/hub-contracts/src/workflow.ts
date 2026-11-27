import * as Schema from "effect/Schema";

export const WorkflowPresetKind = Schema.String;
export type WorkflowPresetKind = typeof WorkflowPresetKind.Type;

export const WorkflowStage = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  category: Schema.Literals(["backlog", "active", "review", "release", "done", "cancelled"]),
});
export type WorkflowStage = typeof WorkflowStage.Type;

export const GateRule = Schema.Struct({
  key: Schema.String,
  label: Schema.String,
  requiredRoles: Schema.Array(Schema.String),
  beforeStage: Schema.String,
  optional: Schema.optional(Schema.Boolean),
});
export type GateRule = typeof GateRule.Type;

export const ProgressLedgerRef = Schema.Struct({
  repoFullName: Schema.String,
  path: Schema.String,
  label: Schema.optional(Schema.String),
});
export type ProgressLedgerRef = typeof ProgressLedgerRef.Type;

export const CockpitPromptSlot = Schema.Literals([
  "prd",
  "prototype",
  "issue_dispatch",
  "dev_branch",
  "pr_audit",
  "pr_fix",
  "repo_governance",
]);
export type CockpitPromptSlot = typeof CockpitPromptSlot.Type;

export const COCKPIT_PROMPT_SLOTS: ReadonlyArray<CockpitPromptSlot> = [
  "prd",
  "prototype",
  "issue_dispatch",
  "dev_branch",
  "pr_audit",
  "pr_fix",
  "repo_governance",
];

export const WorkflowConfig = Schema.Struct({
  preset: WorkflowPresetKind,
  stages: Schema.Array(WorkflowStage),
  gates: Schema.Array(GateRule),
  progressLedgers: Schema.optional(Schema.Array(ProgressLedgerRef)),
  promptTemplates: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type WorkflowConfig = typeof WorkflowConfig.Type;

export const BranchRole = Schema.Literals(["integration", "release", "other"]);
export type BranchRole = typeof BranchRole.Type;

export const BranchMergePolicy = Schema.Literals(["auto_on_low_risk", "manual"]);
export type BranchMergePolicy = typeof BranchMergePolicy.Type;

export const BranchPolicy = Schema.Struct({
  name: Schema.String,
  role: BranchRole,
  mergePolicy: BranchMergePolicy,
});
export type BranchPolicy = typeof BranchPolicy.Type;

export const AutomatedReviewerRule = Schema.Struct({
  name: Schema.String,
  botLogins: Schema.Array(Schema.String),
  checkNames: Schema.optional(Schema.Array(Schema.String)),
  blockingStates: Schema.Array(Schema.String),
});
export type AutomatedReviewerRule = typeof AutomatedReviewerRule.Type;

export const QualitySignalRule = Schema.Struct({
  key: Schema.String,
  label: Schema.optional(Schema.String),
  checkName: Schema.String,
  /** Regex with capture group 1 extracting a numeric metric (e.g. coverage percentage). */
  pattern: Schema.String,
  minValue: Schema.optional(Schema.Number),
  maxValue: Schema.optional(Schema.Number),
  unit: Schema.optional(Schema.String),
});
export type QualitySignalRule = typeof QualitySignalRule.Type;

export const RepoPolicy = Schema.Struct({
  branches: Schema.Array(BranchPolicy),
  automatedReviewers: Schema.Array(AutomatedReviewerRule),
  qualitySignals: Schema.Array(QualitySignalRule),
  maxPrChangedLines: Schema.optional(Schema.Int),
  environments: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});
export type RepoPolicy = typeof RepoPolicy.Type;

export const WORKFLOW_PRESETS: Record<"lean" | "full-delivery", WorkflowConfig> = {
  lean: {
    preset: "lean",
    stages: [
      { id: "backlog", label: "Backlog", category: "backlog" },
      { id: "in_progress", label: "In Progress", category: "active" },
      { id: "review", label: "Review", category: "review" },
      { id: "done", label: "Done", category: "done" },
    ],
    gates: [],
    progressLedgers: [],
  },
  "full-delivery": {
    preset: "full-delivery",
    stages: [
      { id: "scoping", label: "Scoping", category: "backlog" },
      { id: "prd", label: "PRD", category: "backlog" },
      { id: "proto", label: "Prototype", category: "active" },
      { id: "dev", label: "Development", category: "active" },
      { id: "qa", label: "QA", category: "review" },
      { id: "review", label: "Final Review", category: "review" },
      { id: "staging", label: "Staging", category: "release" },
      { id: "done", label: "Released", category: "done" },
    ],
    gates: [
      {
        key: "spec_freeze",
        label: "Spec & AC Freeze",
        requiredRoles: ["pm", "owner"],
        beforeStage: "dev",
      },
      {
        key: "contract_freeze",
        label: "API Contract Freeze",
        requiredRoles: ["dev", "owner"],
        beforeStage: "dev",
        optional: true,
      },
      {
        key: "qa_ac_pass",
        label: "QA AC Verification",
        requiredRoles: ["qa", "owner"],
        beforeStage: "staging",
      },
      {
        key: "security_clear",
        label: "Security Sign-off",
        requiredRoles: ["security", "owner"],
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
};

export const DEFAULT_REPO_POLICY: RepoPolicy = {
  branches: [{ name: "main", role: "release", mergePolicy: "manual" }],
  automatedReviewers: [],
  qualitySignals: [],
  maxPrChangedLines: 500,
  environments: { staging: "staging", production: "production" },
};

export function createWorkflowConfigFromPreset(
  preset: "lean" | "full-delivery",
  overrides?: Partial<WorkflowConfig>,
): WorkflowConfig {
  const base = WORKFLOW_PRESETS[preset];
  return {
    preset: overrides?.preset ?? base.preset,
    stages: overrides?.stages ? [...overrides.stages] : base.stages.map((s) => ({ ...s })),
    gates: overrides?.gates
      ? [...overrides.gates]
      : base.gates.map((g) => ({ ...g, requiredRoles: [...g.requiredRoles] })),
    progressLedgers: overrides?.progressLedgers
      ? [...overrides.progressLedgers]
      : [...(base.progressLedgers ?? [])],
    ...(overrides?.promptTemplates ? { promptTemplates: { ...overrides.promptTemplates } } : {}),
  };
}
