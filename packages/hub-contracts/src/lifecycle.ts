import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import type { CockpitWorkItemCard, WorkItem, WorkItemPriority, WorkItemType } from "./cockpit.ts";
import { AgileHorizon } from "./workflow.ts";

export const DesignTier = Schema.Literals(["small", "medium", "large", "cross_repo"]);
export type DesignTier = typeof DesignTier.Type;

export const BranchTopology = Schema.Literals(["dual_trunk", "single_trunk"]);
export type BranchTopology = typeof BranchTopology.Type;

export const ArtifactStatus = Schema.Literals(["none", "draft", "approved"]);
export type ArtifactStatus = typeof ArtifactStatus.Type;

export const PipelinePhase = Schema.Literals([
  "intake",
  "prd",
  "prototype",
  "dev",
  "review",
  "release",
  "done",
]);
export type PipelinePhase = typeof PipelinePhase.Type;

export const WorkItemLifecycleMeta = Schema.Struct({
  plannedStartAt: Schema.NullOr(Schema.String),
  dueAt: Schema.NullOr(Schema.String),
  prdStatus: ArtifactStatus,
  prototypeStatus: ArtifactStatus,
  prototypeUrl: Schema.NullOr(Schema.String),
  designTier: DesignTier,
  designDocPath: Schema.NullOr(Schema.String),
  githubIssueNumber: Schema.NullOr(Schema.Int),
  githubIssueUrl: Schema.NullOr(Schema.String),
  githubLabels: Schema.Array(Schema.String),
  branchTopology: BranchTopology,
  branchName: Schema.NullOr(Schema.String),
  targetBranch: Schema.NullOr(Schema.String),
  cycleId: Schema.NullOr(Schema.String),
  milestoneId: Schema.NullOr(Schema.String),
  roadmapHorizon: Schema.NullOr(AgileHorizon),
  storyPoints: Schema.NullOr(Schema.Int),
});
export type WorkItemLifecycleMeta = typeof WorkItemLifecycleMeta.Type;

export interface PrMergeStrategyRecommendation {
  readonly method: "squash" | "merge_commit";
  readonly ruleLabel: string;
  readonly isBackMerge: boolean;
  readonly isFreezeBranch: boolean;
}

export interface WorkItemSchedule {
  readonly startDate: string;
  readonly dueDate: string;
  readonly isEstimated: boolean;
  readonly isOverdue: boolean;
}

const DESIGN_TIERS = new Set<DesignTier>(["small", "medium", "large", "cross_repo"]);
const BRANCH_TOPOLOGIES = new Set<BranchTopology>(["dual_trunk", "single_trunk"]);
const ARTIFACT_STATUSES = new Set<ArtifactStatus>(["none", "draft", "approved"]);
const AGILE_HORIZONS = new Set<AgileHorizon>(["now", "next", "later"]);

const DONE_STAGES = new Set(["done", "released", "closed", "shipped", "cancelled"]);
const RELEASE_STAGES = new Set(["staging", "release", "ready_to_release", "deploy"]);
const REVIEW_STAGES = new Set(["review", "in_review", "qa", "code_review"]);
const DEV_STAGES = new Set(["implement", "implementation", "in_progress", "dev", "development"]);
const PROTOTYPE_STAGES = new Set(["proto", "prototype"]);
const PRD_STAGES = new Set(["prd", "spec"]);

const PRIORITY_DURATION_DAYS: Record<WorkItemPriority, number> = {
  p0: 2,
  p1: 5,
  p2: 8,
  p3: 12,
};

const ISO_DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;
const GITHUB_ISSUE_URL_NUMBER_PATTERN = /\/issues\/(\d+)(?:[/?#]|$)/i;

function isDesignTier(value: unknown): value is DesignTier {
  return typeof value === "string" && DESIGN_TIERS.has(value as DesignTier);
}

function isBranchTopology(value: unknown): value is BranchTopology {
  return typeof value === "string" && BRANCH_TOPOLOGIES.has(value as BranchTopology);
}

function isArtifactStatus(value: unknown): value is ArtifactStatus {
  return typeof value === "string" && ARTIFACT_STATUSES.has(value as ArtifactStatus);
}

function isAgileHorizon(value: unknown): value is AgileHorizon {
  return typeof value === "string" && AGILE_HORIZONS.has(value as AgileHorizon);
}

function readTrimmedStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readPositiveIntOrNull(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) return null;
    const parsed = Number(trimmed);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function readStoryPointsOrNull(value: unknown): number | null {
  const parsed = readPositiveIntOrNull(value);
  return parsed !== null && parsed <= 100 ? parsed : null;
}

function cleanStringList(values: readonly unknown[]): string[] {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const item of values) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    cleaned.push(trimmed);
  }
  return cleaned;
}

function normalizeIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const prefixMatch = ISO_DATE_PREFIX_PATTERN.exec(trimmed);
  if (prefixMatch) {
    const year = Number(prefixMatch[1]);
    const month = Number(prefixMatch[2]);
    const day = Number(prefixMatch[3]);
    const candidate = DateTime.make({ year, month, day });
    if (Option.isSome(candidate)) {
      const parts = DateTime.toPartsUtc(candidate.value);
      if (parts.year === year && parts.month === month && parts.day === day) {
        return `${prefixMatch[1]}-${prefixMatch[2]}-${prefixMatch[3]}`;
      }
    }
    return null;
  }

  const parsed = DateTime.make(trimmed);
  if (Option.isNone(parsed)) return null;
  return DateTime.formatIsoDateUtc(parsed.value);
}

function addUtcDays(isoDate: string, deltaDays: number): string {
  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  const base = DateTime.makeUnsafe({
    year: Number(yearStr),
    month: Number(monthStr),
    day: Number(dayStr),
  });
  return DateTime.formatIsoDateUtc(DateTime.add(base, { days: deltaDays }));
}

export function standardGitHubLabels(itemType: WorkItemType, priority: WorkItemPriority): string[] {
  const typeLabel =
    itemType === "bug"
      ? "type:bug"
      : itemType === "security" && priority === "p0"
        ? "type:hotfix"
        : "type:feature";
  return [typeLabel, `priority:${priority}`];
}

export function readWorkItemLifecycle(
  workItem: Pick<
    WorkItem,
    "itemType" | "priority" | "code" | "title" | "specMarkdown" | "previewUrls" | "attributes"
  >,
): WorkItemLifecycleMeta {
  const attrs = workItem.attributes ?? {};
  const plannedStartAt = readTrimmedStringOrNull(attrs.plannedStartAt);
  const dueAt = readTrimmedStringOrNull(attrs.dueAt);

  const firstPreviewUrl =
    workItem.previewUrls
      .map((url) => readTrimmedStringOrNull(url))
      .find((url): url is string => url !== null) ?? null;
  const prototypeUrl = readTrimmedStringOrNull(attrs.prototypeUrl) ?? firstPreviewUrl;

  const prdStatus: ArtifactStatus = isArtifactStatus(attrs.prdStatus)
    ? attrs.prdStatus
    : workItem.specMarkdown.trim().length > 40
      ? "draft"
      : "none";

  const prototypeStatus: ArtifactStatus = isArtifactStatus(attrs.prototypeStatus)
    ? attrs.prototypeStatus
    : workItem.previewUrls.length > 0 || prototypeUrl !== null
      ? "draft"
      : "none";

  const designTier: DesignTier = isDesignTier(attrs.designTier)
    ? attrs.designTier
    : workItem.itemType === "feature" || workItem.itemType === "refactor"
      ? "medium"
      : "small";

  const designDocPath = readTrimmedStringOrNull(attrs.designDocPath);
  const githubIssueUrl = readTrimmedStringOrNull(attrs.githubIssueUrl);

  let githubIssueNumber = readPositiveIntOrNull(attrs.githubIssueNumber);
  if (attrs.githubIssueNumber === undefined && githubIssueNumber === null && githubIssueUrl) {
    const urlMatch = GITHUB_ISSUE_URL_NUMBER_PATTERN.exec(githubIssueUrl);
    if (urlMatch?.[1]) {
      githubIssueNumber = readPositiveIntOrNull(urlMatch[1]);
    }
  }

  const githubLabels = Array.isArray(attrs.githubLabels)
    ? cleanStringList(attrs.githubLabels)
    : standardGitHubLabels(workItem.itemType, workItem.priority);

  const branchTopology: BranchTopology = isBranchTopology(attrs.branchTopology)
    ? attrs.branchTopology
    : "dual_trunk";
  const branchName = readTrimmedStringOrNull(attrs.branchName);
  const targetBranch = readTrimmedStringOrNull(attrs.targetBranch);
  const cycleId = readTrimmedStringOrNull(attrs.cycleId);
  const milestoneId = readTrimmedStringOrNull(attrs.milestoneId);
  const roadmapHorizon: AgileHorizon | null = isAgileHorizon(attrs.roadmapHorizon)
    ? attrs.roadmapHorizon
    : null;
  const storyPoints = readStoryPointsOrNull(attrs.storyPoints);

  return {
    plannedStartAt,
    dueAt,
    prdStatus,
    prototypeStatus,
    prototypeUrl,
    designTier,
    designDocPath,
    githubIssueNumber,
    githubIssueUrl,
    githubLabels,
    branchTopology,
    branchName,
    targetBranch,
    cycleId,
    milestoneId,
    roadmapHorizon,
    storyPoints,
  };
}

export function buildLifecycleAttributesPatch(
  patch: Partial<WorkItemLifecycleMeta>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (patch.plannedStartAt !== undefined) {
    result.plannedStartAt =
      patch.plannedStartAt === null ? null : readTrimmedStringOrNull(patch.plannedStartAt);
  }
  if (patch.dueAt !== undefined) {
    result.dueAt = patch.dueAt === null ? null : readTrimmedStringOrNull(patch.dueAt);
  }
  if (patch.prdStatus !== undefined && isArtifactStatus(patch.prdStatus)) {
    result.prdStatus = patch.prdStatus;
  }
  if (patch.prototypeStatus !== undefined && isArtifactStatus(patch.prototypeStatus)) {
    result.prototypeStatus = patch.prototypeStatus;
  }
  if (patch.prototypeUrl !== undefined) {
    result.prototypeUrl =
      patch.prototypeUrl === null ? null : readTrimmedStringOrNull(patch.prototypeUrl);
  }
  if (patch.designTier !== undefined && isDesignTier(patch.designTier)) {
    result.designTier = patch.designTier;
  }
  if (patch.designDocPath !== undefined) {
    result.designDocPath =
      patch.designDocPath === null ? null : readTrimmedStringOrNull(patch.designDocPath);
  }
  if (patch.githubIssueNumber !== undefined) {
    result.githubIssueNumber =
      patch.githubIssueNumber === null ? null : readPositiveIntOrNull(patch.githubIssueNumber);
  }
  if (patch.githubIssueUrl !== undefined) {
    result.githubIssueUrl =
      patch.githubIssueUrl === null ? null : readTrimmedStringOrNull(patch.githubIssueUrl);
  }
  if (patch.githubLabels !== undefined) {
    result.githubLabels = cleanStringList(patch.githubLabels);
  }
  if (patch.branchTopology !== undefined && isBranchTopology(patch.branchTopology)) {
    result.branchTopology = patch.branchTopology;
  }
  if (patch.branchName !== undefined) {
    result.branchName =
      patch.branchName === null ? null : readTrimmedStringOrNull(patch.branchName);
  }
  if (patch.targetBranch !== undefined) {
    result.targetBranch =
      patch.targetBranch === null ? null : readTrimmedStringOrNull(patch.targetBranch);
  }
  if (patch.cycleId !== undefined) {
    result.cycleId = patch.cycleId === null ? null : readTrimmedStringOrNull(patch.cycleId);
  }
  if (patch.milestoneId !== undefined) {
    result.milestoneId =
      patch.milestoneId === null ? null : readTrimmedStringOrNull(patch.milestoneId);
  }
  if (patch.roadmapHorizon !== undefined) {
    result.roadmapHorizon =
      patch.roadmapHorizon === null
        ? null
        : isAgileHorizon(patch.roadmapHorizon)
          ? patch.roadmapHorizon
          : null;
  }
  if (patch.storyPoints !== undefined) {
    result.storyPoints =
      patch.storyPoints === null ? null : readStoryPointsOrNull(patch.storyPoints);
  }

  return result;
}

export function suggestWorkItemBranchName(input: {
  readonly itemType: WorkItemType;
  readonly priority: WorkItemPriority;
  readonly code: string;
  readonly title: string;
  readonly githubIssueNumber?: number | null;
}): string {
  const prefix =
    input.priority === "p0" && (input.itemType === "bug" || input.itemType === "security")
      ? "hotfix"
      : input.itemType === "bug"
        ? "fix"
        : input.itemType === "refactor"
          ? "refactor"
          : input.itemType === "chore"
            ? "chore"
            : "feat";

  const issueNo = readPositiveIntOrNull(input.githubIssueNumber);
  const idPart =
    issueNo !== null
      ? String(issueNo)
      : input.code
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9-]+/g, "-")
          .replace(/^-+|-+$/g, "") || "item";

  const slug = input.title
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36)
    .replace(/-+$/g, "");

  return slug ? `${prefix}/${idPart}-${slug}` : `${prefix}/${idPart}`;
}

export function recommendPrMergeStrategy(input: {
  readonly headBranch: string;
  readonly baseBranch: string;
  readonly topology?: BranchTopology;
}): PrMergeStrategyRecommendation {
  const head = input.headBranch.trim();
  const base = input.baseBranch.trim();
  const isBaseDev = base === "dev" || base === "develop";
  const isBaseMain = base === "main" || base === "master";
  const isHeadRelease = head.startsWith("release/");
  const isHeadHotfix = head.startsWith("hotfix/");
  const isHeadSync = head.startsWith("sync/");
  const isHeadMain = head === "main" || head === "master";
  const isHeadDev = head === "dev" || head === "develop";

  // Back-merges into dev must preserve commit ancestry to avoid divergent history.
  if (isBaseDev && (isHeadMain || isHeadRelease || isHeadSync)) {
    return {
      method: "merge_commit",
      ruleLabel: "Merge commit (preserve ancestry)",
      isBackMerge: true,
      isFreezeBranch: isHeadRelease,
    };
  }

  if (
    isBaseMain &&
    (isHeadRelease || isHeadHotfix || (isHeadDev && input.topology !== "single_trunk"))
  ) {
    return {
      method: "merge_commit",
      ruleLabel: "Merge commit (release/hotfix -> main)",
      isBackMerge: false,
      isFreezeBranch: isHeadRelease,
    };
  }

  return {
    method: "squash",
    ruleLabel: "Squash merge (task branch)",
    isBackMerge: false,
    isFreezeBranch: base.startsWith("release/"),
  };
}

export function deriveWorkItemPipelinePhase(
  card: Pick<CockpitWorkItemCard, "workItem" | "changeRequests">,
): PipelinePhase {
  const stage = card.workItem.stage.trim().toLowerCase();

  if (DONE_STAGES.has(stage)) return "done";
  if (RELEASE_STAGES.has(stage)) return "release";

  const hasOpenPr = card.changeRequests.some((cr) => cr.state === "open");
  if (REVIEW_STAGES.has(stage) || hasOpenPr) return "review";
  if (DEV_STAGES.has(stage)) return "dev";

  const lifecycle = readWorkItemLifecycle(card.workItem);
  if (
    PROTOTYPE_STAGES.has(stage) ||
    lifecycle.prototypeStatus !== "none" ||
    card.workItem.previewUrls.length > 0
  ) {
    return "prototype";
  }

  if (
    PRD_STAGES.has(stage) ||
    lifecycle.prdStatus !== "none" ||
    card.workItem.specMarkdown.trim().length > 40
  ) {
    return "prd";
  }

  return "intake";
}

export function resolveWorkItemSchedule(
  workItem: Pick<WorkItem, "createdAt" | "updatedAt" | "stage" | "priority" | "attributes">,
  nowIso?: string,
): WorkItemSchedule {
  const today = normalizeIsoDate(nowIso) ?? DateTime.formatIsoDateUtc(DateTime.nowUnsafe());
  const createdDay =
    normalizeIsoDate(workItem.createdAt) ?? normalizeIsoDate(workItem.updatedAt) ?? today;
  const durationDays = PRIORITY_DURATION_DAYS[workItem.priority] ?? 5;

  const plannedStart = normalizeIsoDate(workItem.attributes?.plannedStartAt);
  const plannedDue = normalizeIsoDate(workItem.attributes?.dueAt);

  let startDate: string;
  let dueDate: string;
  let isEstimated: boolean;

  if (plannedStart && plannedDue) {
    startDate = plannedStart;
    dueDate = plannedDue < plannedStart ? plannedStart : plannedDue;
    isEstimated = false;
  } else if (plannedStart) {
    startDate = plannedStart;
    dueDate = addUtcDays(plannedStart, durationDays);
    isEstimated = true;
  } else if (plannedDue) {
    startDate = createdDay <= plannedDue ? createdDay : addUtcDays(plannedDue, -durationDays);
    dueDate = plannedDue;
    isEstimated = true;
  } else {
    startDate = createdDay;
    dueDate = addUtcDays(createdDay, durationDays);
    isEstimated = true;
  }

  const isDone = DONE_STAGES.has(workItem.stage.trim().toLowerCase());
  const isOverdue = !isDone && dueDate < today;

  return {
    startDate,
    dueDate,
    isEstimated,
    isOverdue,
  };
}
