import type { EnvironmentId } from "@t3tools/contracts";
import {
  buildLifecycleAttributesPatch,
  computeMilestoneProgress,
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  type AgileHorizon,
  type CockpitWorkItemCard,
  type MilestoneStatus,
  type MilestoneTone,
  type PipelinePhase,
  type Project,
  type ProjectMilestone,
  type WorkflowStage,
} from "@u3code/hub-contracts";
import { T, useGT, useLocale, Var } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  Columns3Icon,
  CompassIcon,
  FlagIcon,
  LayersIcon,
  ListIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { Fragment, useState } from "react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "~/components/ui/alert-dialog";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "~/components/ui/dialog";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectGroup,
  SelectGroupLabel,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn, randomUUID } from "~/lib/utils";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitArtifactIcon,
  CockpitIllustration,
  CockpitStageArtworkIcon,
  CockpitStudioBanner,
} from "./CockpitArtwork";
import {
  CockpitFieldLabel,
  CockpitIconBadge,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitIconBadgeTone,
  type CockpitTone,
} from "./CockpitPrimitives";
import {
  CockpitSwarmAvatar,
  isWorkItemDoneStage,
  type CockpitTeamMember,
} from "./CockpitSwarmAvatar";
import { formatCockpitCommandError } from "./cockpitError";

export interface CockpitRoadmapViewProps {
  readonly environmentId: EnvironmentId;
  readonly project: Project | null;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly stages: ReadonlyArray<WorkflowStage>;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenIntakeForMilestone: (milestoneId: string | null, horizon: AgileHorizon) => void;
  readonly onRefresh: () => void;
}

type RoadmapViewMode = "columns" | "list";
type RoadmapStatusFilter = "all" | MilestoneStatus;

interface MilestoneFormDraft {
  readonly editingId: string | null;
  readonly name: string;
  readonly description: string;
  readonly horizon: AgileHorizon;
  readonly status: MilestoneStatus;
  readonly targetDate: string;
  readonly colorTone: MilestoneTone;
}

const HORIZONS: ReadonlyArray<AgileHorizon> = ["now", "next", "later"];
const MILESTONE_STATUSES: ReadonlyArray<MilestoneStatus> = [
  "planned",
  "active",
  "completed",
  "paused",
];
const MILESTONE_TONES: ReadonlyArray<MilestoneTone> = [
  "primary",
  "info",
  "success",
  "warning",
  "violet",
];
const UNASSIGNED_SELECT_VALUE = "__unassigned__";
const CARD_PREVIEW_LIMIT = 4;
const ISO_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})/;

const HORIZON_ORDER: Record<AgileHorizon, number> = {
  now: 0,
  next: 1,
  later: 2,
};

const HORIZON_COLUMN_ACCENT_CLASS: Record<AgileHorizon, string> = {
  now: "border-t-primary/65",
  next: "border-t-info/65",
  later: "border-t-guest/65",
};

const HORIZON_PILL_CLASS: Record<AgileHorizon, string> = {
  now: "border-primary/30 bg-primary/10 text-primary",
  next: "border-info/30 bg-info/10 text-info-foreground",
  later: "border-guest/30 bg-guest/12 text-guest-foreground",
};

const TONE_SWATCH_DOT_CLASS: Record<MilestoneTone, string> = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  violet: "bg-guest",
};

const TONE_SWATCH_ACTIVE_CLASS: Record<MilestoneTone, string> = {
  primary: "border-primary bg-primary/12 text-primary",
  info: "border-info bg-info/12 text-info-foreground",
  success: "border-success bg-success/12 text-success-foreground",
  warning: "border-warning bg-warning/12 text-warning-foreground",
  violet: "border-guest bg-guest/14 text-guest-foreground",
};

const TONE_PROGRESS_FILL_CLASS: Record<MilestoneTone, string> = {
  primary: "bg-primary",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  violet: "bg-guest",
};

function getTodayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function addUtcDaysToIso(isoDate: string, deltaDays: number): string {
  const match = ISO_DATE_PATTERN.exec(isoDate);
  if (!match) return isoDate;
  const ms = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]) + Math.trunc(deltaDays),
  );
  const next = new Date(ms);
  const year = String(next.getUTCFullYear()).padStart(4, "0");
  const month = String(next.getUTCMonth() + 1).padStart(2, "0");
  const day = String(next.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatMilestoneDate(
  isoDate: string | null | undefined,
  locale: string,
  todayIso: string,
): string | null {
  if (!isoDate) return null;
  const match = ISO_DATE_PATTERN.exec(isoDate.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const currentYear = Number(todayIso.slice(0, 4));
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat(locale || undefined, {
    month: "short",
    day: "numeric",
    ...(year !== currentYear ? { year: "numeric" } : {}),
    timeZone: "UTC",
  }).format(date);
}

function createMilestoneId(): string {
  return `ms_${randomUUID().slice(0, 8)}`;
}

function defaultToneForHorizon(horizon: AgileHorizon): MilestoneTone {
  switch (horizon) {
    case "now":
      return "primary";
    case "next":
      return "info";
    case "later":
      return "violet";
  }
}

function defaultStatusForHorizon(horizon: AgileHorizon): MilestoneStatus {
  return horizon === "now" ? "active" : "planned";
}

function horizonBadgeTone(horizon: AgileHorizon): CockpitIconBadgeTone {
  switch (horizon) {
    case "now":
      return "primary";
    case "next":
      return "info";
    case "later":
      return "violet";
  }
}

function horizonLabel(horizon: AgileHorizon, gt: ReturnType<typeof useGT>): string {
  switch (horizon) {
    case "now":
      return gt("Now", { $context: "roadmap horizon, active delivery period" });
    case "next":
      return gt("Next", { $context: "roadmap horizon, upcoming discovery period" });
    case "later":
      return gt("Later", { $context: "roadmap horizon, future strategic period" });
  }
}

function horizonSubtitle(horizon: AgileHorizon, gt: ReturnType<typeof useGT>): string {
  switch (horizon) {
    case "now":
      return gt("Scoped & actively shipping in cycles");
    case "next":
      return gt("Discovery, AI PRD & interactive prototyping");
    case "later":
      return gt("Future quarters, R&D & long-term bets");
  }
}

function horizonEmptyCopy(horizon: AgileHorizon, gt: ReturnType<typeof useGT>): string {
  switch (horizon) {
    case "now":
      return gt("No active delivery milestones yet. Add a phase or promote one from Next.");
    case "next":
      return gt("No upcoming discovery phases yet. Queue PRD & prototype milestones here.");
    case "later":
      return gt("No future strategic bets yet. Park longer-term initiatives here.");
  }
}

function milestoneStatusLabel(status: MilestoneStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "active":
      return gt("Active", { $context: "milestone status" });
    case "planned":
      return gt("Planned", { $context: "milestone status" });
    case "completed":
      return gt("Completed", { $context: "milestone status" });
    case "paused":
      return gt("Paused", { $context: "milestone status" });
  }
}

function milestoneStatusBadgeVariant(
  status: MilestoneStatus,
): "success" | "info" | "secondary" | "warning" {
  switch (status) {
    case "active":
      return "info";
    case "planned":
      return "secondary";
    case "completed":
      return "success";
    case "paused":
      return "warning";
  }
}

function milestoneStatusDotTone(status: MilestoneStatus): CockpitTone {
  switch (status) {
    case "active":
      return "info";
    case "planned":
      return "neutral";
    case "completed":
      return "success";
    case "paused":
      return "warning";
  }
}

function milestoneToneLabel(tone: MilestoneTone, gt: ReturnType<typeof useGT>): string {
  switch (tone) {
    case "primary":
      return gt("Primary", { $context: "milestone accent color tone" });
    case "info":
      return gt("Blue", { $context: "milestone accent color tone" });
    case "success":
      return gt("Green", { $context: "milestone accent color tone" });
    case "warning":
      return gt("Amber", { $context: "milestone accent color tone" });
    case "violet":
      return gt("Violet", { $context: "milestone accent color tone" });
  }
}

function pipelinePhaseShortLabel(phase: PipelinePhase, gt: ReturnType<typeof useGT>): string {
  switch (phase) {
    case "intake":
      return gt("Intake");
    case "prd":
      return gt("PRD");
    case "prototype":
      return gt("Proto");
    case "dev":
      return gt("Dev");
    case "review":
      return gt("Review");
    case "release":
      return gt("Release");
    case "done":
      return gt("Done", { $context: "pipeline phase" });
  }
}

function pipelinePhaseDotTone(phase: PipelinePhase): CockpitTone {
  switch (phase) {
    case "done":
      return "success";
    case "release":
      return "success";
    case "review":
      return "warning";
    case "dev":
      return "info";
    case "prototype":
      return "info";
    case "prd":
      return "info";
    case "intake":
      return "neutral";
  }
}

function priorityWeight(priority: string): number {
  switch (priority.toLowerCase()) {
    case "p0":
      return 0;
    case "p1":
      return 1;
    case "p2":
      return 2;
    case "p3":
      return 3;
    default:
      return 4;
  }
}

function sortWorkItemCards(cards: ReadonlyArray<CockpitWorkItemCard>): CockpitWorkItemCard[] {
  return [...cards].toSorted((left, right) => {
    const leftDone = isWorkItemDoneStage(left.workItem.stage) ? 1 : 0;
    const rightDone = isWorkItemDoneStage(right.workItem.stage) ? 1 : 0;
    if (leftDone !== rightDone) return leftDone - rightDone;

    const leftHealth =
      left.workItem.health === "blocked" ? 0 : left.workItem.health === "at_risk" ? 1 : 2;
    const rightHealth =
      right.workItem.health === "blocked" ? 0 : right.workItem.health === "at_risk" ? 1 : 2;
    if (leftHealth !== rightHealth) return leftHealth - rightHealth;

    const priorityDiff =
      priorityWeight(left.workItem.priority) - priorityWeight(right.workItem.priority);
    if (priorityDiff !== 0) return priorityDiff;

    return right.workItem.updatedAt.localeCompare(left.workItem.updatedAt);
  });
}

function sortMilestones(milestones: ReadonlyArray<ProjectMilestone>): ProjectMilestone[] {
  return [...milestones].toSorted((left, right) => {
    const horizonDiff = HORIZON_ORDER[left.horizon] - HORIZON_ORDER[right.horizon];
    if (horizonDiff !== 0) return horizonDiff;

    const leftCompleted = left.status === "completed" ? 1 : 0;
    const rightCompleted = right.status === "completed" ? 1 : 0;
    if (leftCompleted !== rightCompleted) return leftCompleted - rightCompleted;

    if (left.targetDate && right.targetDate && left.targetDate !== right.targetDate) {
      return left.targetDate.localeCompare(right.targetDate);
    }
    if (left.targetDate && !right.targetDate) return -1;
    if (!left.targetDate && right.targetDate) return 1;

    return left.name.localeCompare(right.name);
  });
}

function resolveCardAssignee(
  card: CockpitWorkItemCard,
  roster: ReadonlyArray<CockpitTeamMember>,
): CockpitTeamMember | null {
  if (card.workItem.assigneeType === "human" && card.workItem.assigneeUserId) {
    return roster.find((member) => member.id === card.workItem.assigneeUserId) ?? null;
  }
  if (card.workItem.assigneeType === "runner" && card.workItem.assigneeRunnerId) {
    const normalized = card.workItem.assigneeRunnerId.trim().toLowerCase().replace(/^@+/, "");
    return roster.find((member) => member.handle === normalized) ?? null;
  }
  return null;
}

function renderHorizonIcon(horizon: AgileHorizon) {
  switch (horizon) {
    case "now":
      return <CockpitStageArtworkIcon stage="dev" />;
    case "next":
      return <CockpitStageArtworkIcon stage="prd" />;
    case "later":
      return <CompassIcon />;
  }
}

function MilestoneProgressStrip({
  milestone,
  cards,
  todayIso,
  compact = false,
}: {
  readonly milestone: ProjectMilestone;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly todayIso: string;
  readonly compact?: boolean;
}) {
  const gt = useGT();
  const progress = computeMilestoneProgress(milestone, cards, todayIso);
  const tone = milestone.colorTone ?? defaultToneForHorizon(milestone.horizon);
  const clampedPct = Math.max(0, Math.min(100, progress.completionPct));
  const fillClass =
    clampedPct >= 100 || milestone.status === "completed"
      ? "bg-success"
      : TONE_PROGRESS_FILL_CLASS[tone];
  const hasRisk = progress.blockedItems > 0 || progress.overdueItems > 0;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
        <div className="flex items-center gap-1.5 text-muted-foreground tabular-nums">
          <span className="font-medium text-foreground">
            {gt("{total, plural, one {{done}/{total} item} other {{done}/{total} items}}", {
              done: progress.doneItems,
              total: progress.totalItems,
            })}
          </span>
          <span aria-hidden className="opacity-35">
            ·
          </span>
          <span className="font-mono font-semibold text-foreground">{clampedPct}%</span>
        </div>

        <div className="flex items-center gap-2 tabular-nums">
          {progress.totalPoints > 0 ? (
            <span className="font-mono text-2xs text-muted-foreground">
              <T>
                <Var>{progress.donePoints}</Var>/<Var>{progress.totalPoints}</Var> pt
              </T>
            </span>
          ) : null}
          {hasRisk ? (
            <span className="inline-flex items-center gap-1 font-medium text-destructive">
              <CockpitStatusDot ring tone="error" />
              {progress.blockedItems > 0 ? (
                <T>
                  <Var>{progress.blockedItems}</Var> blocked
                </T>
              ) : (
                <T>
                  <Var>{progress.overdueItems}</Var> overdue
                </T>
              )}
            </span>
          ) : null}
        </div>
      </div>

      <div
        aria-label={gt("Milestone completion {pct}%", { pct: clampedPct })}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={clampedPct}
        className="h-1 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
      >
        <div
          className={cn("h-full rounded-full transition-[width] duration-300", fillClass)}
          style={{ width: `${clampedPct}%` }}
        />
      </div>

      {!compact && progress.totalItems > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/25 px-1.5 py-0.5 text-3xs tabular-nums",
              progress.prdCount > 0 ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <CockpitStatusDot tone={progress.prdCount > 0 ? "info" : "neutral"} />
            <T>PRD</T>
            <span className="font-mono font-medium">{progress.prdCount}</span>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/25 px-1.5 py-0.5 text-3xs tabular-nums",
              progress.devCount > 0 ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <CockpitStatusDot tone={progress.devCount > 0 ? "info" : "neutral"} />
            <T>Dev</T>
            <span className="font-mono font-medium">{progress.devCount}</span>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/25 px-1.5 py-0.5 text-3xs tabular-nums",
              progress.reviewCount > 0 ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <CockpitStatusDot tone={progress.reviewCount > 0 ? "warning" : "neutral"} />
            <T>Review</T>
            <span className="font-mono font-medium">{progress.reviewCount}</span>
          </span>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/25 px-1.5 py-0.5 text-3xs tabular-nums",
              progress.doneItems > 0 ? "text-foreground" : "text-muted-foreground/60",
            )}
          >
            <CockpitStatusDot tone={progress.doneItems > 0 ? "success" : "neutral"} />
            <T>Done</T>
            <span className="font-mono font-medium">{progress.doneItems}</span>
          </span>
        </div>
      ) : null}
    </div>
  );
}

function LinkedWorkItemRow({
  card,
  roster,
  stageLabelById,
  unlinking,
  onOpenWorkItem,
  onUnlinkWorkItem,
}: {
  readonly card: CockpitWorkItemCard;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly stageLabelById: ReadonlyMap<string, string>;
  readonly unlinking: boolean;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onUnlinkWorkItem: (card: CockpitWorkItemCard) => void;
}) {
  const gt = useGT();
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const phase = deriveWorkItemPipelinePhase(card);
  const done = isWorkItemDoneStage(card.workItem.stage);
  const assignee = resolveCardAssignee(card, roster);
  const stageLabel = stageLabelById.get(card.workItem.stage) ?? pipelinePhaseShortLabel(phase, gt);

  return (
    <div className="group flex items-center gap-1.5 rounded-lg border border-transparent px-2 py-1.5 transition-colors hover:border-border/45 hover:bg-accent/35">
      <button
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        type="button"
        onClick={() => onOpenWorkItem(card.workItem.id)}
      >
        <CockpitPriorityDot priority={card.workItem.priority} showLabel={false} />
        <CockpitArtifactIcon
          className="size-3.5 shrink-0 text-muted-foreground"
          kind={card.workItem.itemType}
        />
        <span className="shrink-0 font-mono text-2xs text-muted-foreground">
          {card.workItem.code}
        </span>
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs leading-snug",
            done ? "text-muted-foreground line-through" : "text-foreground",
          )}
        >
          {card.workItem.title}
        </span>
        {lifecycle.storyPoints !== null ? (
          <span className="shrink-0 rounded border border-border/50 bg-muted/40 px-1 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
            <T>
              <Var>{lifecycle.storyPoints}</Var> pt
            </T>
          </span>
        ) : null}
        <span className="hidden shrink-0 items-center gap-1 text-3xs text-muted-foreground sm:inline-flex">
          <CockpitStatusDot tone={pipelinePhaseDotTone(phase)} />
          <span className="max-w-18 truncate">{stageLabel}</span>
        </span>
        {assignee ? (
          <CockpitSwarmAvatar
            displayName={assignee.displayName}
            handle={assignee.handle}
            kind={assignee.kind}
            size="sm"
          />
        ) : null}
      </button>

      <Button
        aria-label={gt("Remove {code} from milestone", { code: card.workItem.code })}
        disabled={unlinking}
        size="icon-tiny"
        title={gt("Move back to unassigned backlog")}
        variant="ghost-muted"
        onClick={() => onUnlinkWorkItem(card)}
      >
        <XIcon />
      </Button>
    </div>
  );
}

function MilestoneBoardCard({
  milestone,
  allCards,
  linkedCards,
  roster,
  stageLabelById,
  todayIso,
  locale,
  expanded,
  savingPlanning,
  mutatingWorkItemId,
  onToggleExpand,
  onOpenWorkItem,
  onOpenIntakeForMilestone,
  onEditMilestone,
  onDeleteMilestone,
  onShiftHorizon,
  onUnlinkWorkItem,
}: {
  readonly milestone: ProjectMilestone;
  readonly allCards: ReadonlyArray<CockpitWorkItemCard>;
  readonly linkedCards: ReadonlyArray<CockpitWorkItemCard>;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly stageLabelById: ReadonlyMap<string, string>;
  readonly todayIso: string;
  readonly locale: string;
  readonly expanded: boolean;
  readonly savingPlanning: boolean;
  readonly mutatingWorkItemId: string | null;
  readonly onToggleExpand: (milestoneId: string) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenIntakeForMilestone: (milestoneId: string | null, horizon: AgileHorizon) => void;
  readonly onEditMilestone: (milestone: ProjectMilestone) => void;
  readonly onDeleteMilestone: (milestone: ProjectMilestone) => void;
  readonly onShiftHorizon: (milestone: ProjectMilestone, nextHorizon: AgileHorizon) => void;
  readonly onUnlinkWorkItem: (card: CockpitWorkItemCard) => void;
}) {
  const gt = useGT();
  const tone = milestone.colorTone ?? defaultToneForHorizon(milestone.horizon);
  const formattedTargetDate = formatMilestoneDate(milestone.targetDate, locale, todayIso);
  const isTargetPastDue =
    Boolean(milestone.targetDate) &&
    milestone.status !== "completed" &&
    (milestone.targetDate ?? "") < todayIso;
  const visibleCards = expanded ? linkedCards : linkedCards.slice(0, CARD_PREVIEW_LIMIT);
  const hiddenCount = Math.max(0, linkedCards.length - CARD_PREVIEW_LIMIT);

  return (
    <article className="flex flex-col gap-3 rounded-xl border border-border/60 bg-linear-to-b from-card/90 to-card/50 p-4 shadow-xs/5 ring-1 ring-inset ring-foreground/4">
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          <CockpitIconBadge size="sm" tone={tone}>
            <FlagIcon />
          </CockpitIconBadge>
          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="text-sm font-semibold leading-snug text-foreground wrap-anywhere">
              {milestone.name}
            </h3>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge size="sm" variant={milestoneStatusBadgeVariant(milestone.status)}>
                <CockpitStatusDot tone={milestoneStatusDotTone(milestone.status)} />
                {milestoneStatusLabel(milestone.status, gt)}
              </Badge>
              {formattedTargetDate ? (
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-3xs tabular-nums",
                    isTargetPastDue
                      ? "border-destructive/30 bg-destructive/8 text-destructive"
                      : "border-border/50 bg-muted/30 text-muted-foreground",
                  )}
                >
                  <CalendarIcon className="size-2.5 shrink-0" />
                  {formattedTargetDate}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <Button
            aria-label={gt("Edit {name}", { name: milestone.name })}
            size="icon-xs"
            variant="ghost-muted"
            onClick={() => onEditMilestone(milestone)}
          >
            <PencilIcon />
          </Button>
          <Button
            aria-label={gt("Delete {name}", { name: milestone.name })}
            size="icon-xs"
            variant="ghost-destructive"
            onClick={() => onDeleteMilestone(milestone)}
          >
            <Trash2Icon />
          </Button>
        </div>
      </div>

      {milestone.description?.trim() ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {milestone.description}
        </p>
      ) : null}

      <MilestoneProgressStrip cards={allCards} milestone={milestone} todayIso={todayIso} />

      <div className="space-y-1 border-t border-border/45 pt-2.5">
        {visibleCards.length > 0 ? (
          <div className="space-y-0.5">
            {visibleCards.map((card) => (
              <LinkedWorkItemRow
                key={card.workItem.id}
                card={card}
                roster={roster}
                stageLabelById={stageLabelById}
                unlinking={mutatingWorkItemId === card.workItem.id}
                onOpenWorkItem={onOpenWorkItem}
                onUnlinkWorkItem={onUnlinkWorkItem}
              />
            ))}
            {hiddenCount > 0 ? (
              <div className="pt-1">
                <Button
                  size="micro"
                  variant="ghost-muted"
                  onClick={() => onToggleExpand(milestone.id)}
                >
                  {expanded ? (
                    <T>Show fewer</T>
                  ) : (
                    <T>
                      +<Var>{hiddenCount}</Var> more
                    </T>
                  )}
                </Button>
              </div>
            ) : null}
          </div>
        ) : (
          <p className="px-1 py-1 text-xs text-muted-foreground/75">
            <T>No linked work items yet.</T>
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/45 pt-2.5">
        <Button
          size="xs"
          variant="outline"
          onClick={() => onOpenIntakeForMilestone(milestone.id, milestone.horizon)}
        >
          <PlusIcon />
          <T>Add Work Item</T>
        </Button>

        <div className="flex flex-wrap items-center gap-1">
          {milestone.horizon === "now" ? (
            <Button
              disabled={savingPlanning}
              size="micro"
              variant="ghost-muted"
              onClick={() => onShiftHorizon(milestone, "next")}
            >
              <T>Move to Next</T>
              <ArrowRightIcon />
            </Button>
          ) : null}

          {milestone.horizon === "next" ? (
            <>
              <Button
                disabled={savingPlanning}
                size="micro"
                variant="ghost"
                onClick={() => onShiftHorizon(milestone, "now")}
              >
                <ArrowLeftIcon />
                <T>Promote to Now</T>
              </Button>
              <Button
                disabled={savingPlanning}
                size="micro"
                variant="ghost-muted"
                onClick={() => onShiftHorizon(milestone, "later")}
              >
                <T>Defer to Later</T>
                <ArrowRightIcon />
              </Button>
            </>
          ) : null}

          {milestone.horizon === "later" ? (
            <>
              <Button
                disabled={savingPlanning}
                size="micro"
                variant="ghost"
                onClick={() => onShiftHorizon(milestone, "now")}
              >
                <ChevronsLeftIcon />
                <T>Promote to Now</T>
              </Button>
              <Button
                disabled={savingPlanning}
                size="micro"
                variant="ghost-muted"
                onClick={() => onShiftHorizon(milestone, "next")}
              >
                <ArrowLeftIcon />
                <T>Move to Next</T>
              </Button>
            </>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function MilestoneListTable({
  milestones,
  allCards,
  cardsByMilestoneId,
  roster,
  stageLabelById,
  todayIso,
  locale,
  expandedMilestoneIds,
  savingPlanning,
  mutatingWorkItemId,
  onToggleExpand,
  onOpenWorkItem,
  onOpenIntakeForMilestone,
  onEditMilestone,
  onDeleteMilestone,
  onShiftHorizon,
  onUnlinkWorkItem,
}: {
  readonly milestones: ReadonlyArray<ProjectMilestone>;
  readonly allCards: ReadonlyArray<CockpitWorkItemCard>;
  readonly cardsByMilestoneId: ReadonlyMap<string, ReadonlyArray<CockpitWorkItemCard>>;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly stageLabelById: ReadonlyMap<string, string>;
  readonly todayIso: string;
  readonly locale: string;
  readonly expandedMilestoneIds: ReadonlySet<string>;
  readonly savingPlanning: boolean;
  readonly mutatingWorkItemId: string | null;
  readonly onToggleExpand: (milestoneId: string) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenIntakeForMilestone: (milestoneId: string | null, horizon: AgileHorizon) => void;
  readonly onEditMilestone: (milestone: ProjectMilestone) => void;
  readonly onDeleteMilestone: (milestone: ProjectMilestone) => void;
  readonly onShiftHorizon: (milestone: ProjectMilestone, nextHorizon: AgileHorizon) => void;
  readonly onUnlinkWorkItem: (card: CockpitWorkItemCard) => void;
}) {
  const gt = useGT();

  if (milestones.length === 0) {
    return (
      <CockpitSurface padding="lg" variant="grouped">
        <p className="text-center text-xs text-muted-foreground">
          <T>No milestones match the active filter.</T>
        </p>
      </CockpitSurface>
    );
  }

  return (
    <CockpitSurface className="overflow-hidden" variant="grouped">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-border/55 bg-muted/20 text-2xs font-medium text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">
                <T>Milestone / Phase</T>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <T>Horizon</T>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <T>Status</T>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <T>Target Date</T>
              </th>
              <th className="px-3 py-2.5 font-medium">
                <T>Pipeline</T>
              </th>
              <th className="w-56 px-3 py-2.5 font-medium">
                <T>Progress</T>
              </th>
              <th className="px-4 py-2.5 text-right font-medium">
                <T>Actions</T>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/45">
            {milestones.map((milestone) => {
              const linkedCards = cardsByMilestoneId.get(milestone.id) ?? [];
              const progress = computeMilestoneProgress(milestone, allCards, todayIso);
              const tone = milestone.colorTone ?? defaultToneForHorizon(milestone.horizon);
              const formattedDate = formatMilestoneDate(milestone.targetDate, locale, todayIso);
              const isPastDue =
                Boolean(milestone.targetDate) &&
                milestone.status !== "completed" &&
                (milestone.targetDate ?? "") < todayIso;
              const isExpanded = expandedMilestoneIds.has(milestone.id);

              return (
                <Fragment key={milestone.id}>
                  <tr className="transition-colors hover:bg-accent/25">
                    <td className="px-4 py-3 align-top">
                      <div className="flex items-start gap-2.5">
                        <Button
                          aria-expanded={isExpanded}
                          aria-label={
                            isExpanded
                              ? gt("Collapse {name}", { name: milestone.name })
                              : gt("Expand {name}", { name: milestone.name })
                          }
                          size="icon-tiny"
                          variant="ghost-muted"
                          onClick={() => onToggleExpand(milestone.id)}
                        >
                          {isExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
                        </Button>
                        <CockpitIconBadge size="sm" tone={tone}>
                          <FlagIcon />
                        </CockpitIconBadge>
                        <div className="min-w-0 space-y-0.5">
                          <div className="font-semibold text-foreground">{milestone.name}</div>
                          {milestone.description?.trim() ? (
                            <p className="line-clamp-1 max-w-sm text-2xs text-muted-foreground">
                              {milestone.description}
                            </p>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-col items-start gap-1">
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md border px-2 py-0.5 text-2xs font-medium",
                            HORIZON_PILL_CLASS[milestone.horizon],
                          )}
                        >
                          {horizonLabel(milestone.horizon, gt)}
                        </span>
                        <div className="flex items-center gap-0.5">
                          {milestone.horizon !== "now" ? (
                            <Button
                              disabled={savingPlanning}
                              size="micro"
                              variant="ghost-muted"
                              onClick={() =>
                                onShiftHorizon(
                                  milestone,
                                  milestone.horizon === "later" ? "next" : "now",
                                )
                              }
                            >
                              <ArrowLeftIcon />
                              {horizonLabel(milestone.horizon === "later" ? "next" : "now", gt)}
                            </Button>
                          ) : null}
                          {milestone.horizon !== "later" ? (
                            <Button
                              disabled={savingPlanning}
                              size="micro"
                              variant="ghost-muted"
                              onClick={() =>
                                onShiftHorizon(
                                  milestone,
                                  milestone.horizon === "now" ? "next" : "later",
                                )
                              }
                            >
                              {horizonLabel(milestone.horizon === "now" ? "next" : "later", gt)}
                              <ArrowRightIcon />
                            </Button>
                          ) : null}
                        </div>
                      </div>
                    </td>

                    <td className="px-3 py-3 align-top">
                      <Badge size="sm" variant={milestoneStatusBadgeVariant(milestone.status)}>
                        <CockpitStatusDot tone={milestoneStatusDotTone(milestone.status)} />
                        {milestoneStatusLabel(milestone.status, gt)}
                      </Badge>
                    </td>

                    <td className="px-3 py-3 align-top font-mono text-2xs tabular-nums">
                      {formattedDate ? (
                        <span
                          className={isPastDue ? "font-medium text-destructive" : "text-foreground"}
                        >
                          {formattedDate}
                        </span>
                      ) : (
                        <span className="font-sans text-muted-foreground/60">
                          <T>No date</T>
                        </span>
                      )}
                    </td>

                    <td className="px-3 py-3 align-top">
                      <div className="flex flex-wrap items-center gap-1.5 font-mono text-3xs tabular-nums text-muted-foreground">
                        <span>
                          <T>
                            PRD <Var>{progress.prdCount}</Var>
                          </T>
                        </span>
                        <span aria-hidden className="opacity-35">
                          ·
                        </span>
                        <span>
                          <T>
                            Dev <Var>{progress.devCount}</Var>
                          </T>
                        </span>
                        <span aria-hidden className="opacity-35">
                          ·
                        </span>
                        <span>
                          <T>
                            Review <Var>{progress.reviewCount}</Var>
                          </T>
                        </span>
                        <span aria-hidden className="opacity-35">
                          ·
                        </span>
                        <span className="text-success-foreground">
                          <T>
                            Done <Var>{progress.doneItems}</Var>
                          </T>
                        </span>
                      </div>
                    </td>

                    <td className="px-3 py-3 align-top">
                      <MilestoneProgressStrip
                        cards={allCards}
                        compact
                        milestone={milestone}
                        todayIso={todayIso}
                      />
                    </td>

                    <td className="px-4 py-3 text-right align-top">
                      <div className="inline-flex items-center justify-end gap-1">
                        <Button
                          size="xs"
                          variant="outline"
                          onClick={() => onOpenIntakeForMilestone(milestone.id, milestone.horizon)}
                        >
                          <PlusIcon />
                          <T>Item</T>
                        </Button>
                        <Button
                          aria-label={gt("Edit {name}", { name: milestone.name })}
                          size="icon-xs"
                          variant="ghost-muted"
                          onClick={() => onEditMilestone(milestone)}
                        >
                          <PencilIcon />
                        </Button>
                        <Button
                          aria-label={gt("Delete {name}", { name: milestone.name })}
                          size="icon-xs"
                          variant="ghost-destructive"
                          onClick={() => onDeleteMilestone(milestone)}
                        >
                          <Trash2Icon />
                        </Button>
                      </div>
                    </td>
                  </tr>

                  {isExpanded ? (
                    <tr className="bg-muted/10">
                      <td className="px-4 py-3" colSpan={7}>
                        <div className="space-y-2 pl-7">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-2xs font-medium text-muted-foreground">
                              {gt(
                                "{count, plural, one {{count} linked work item} other {{count} linked work items}}",
                                { count: linkedCards.length },
                              )}
                            </span>
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={() =>
                                onOpenIntakeForMilestone(milestone.id, milestone.horizon)
                              }
                            >
                              <PlusIcon />
                              <T>Add Work Item</T>
                            </Button>
                          </div>
                          {linkedCards.length > 0 ? (
                            <div className="grid gap-1 md:grid-cols-2">
                              {linkedCards.map((card) => (
                                <LinkedWorkItemRow
                                  key={card.workItem.id}
                                  card={card}
                                  roster={roster}
                                  stageLabelById={stageLabelById}
                                  unlinking={mutatingWorkItemId === card.workItem.id}
                                  onOpenWorkItem={onOpenWorkItem}
                                  onUnlinkWorkItem={onUnlinkWorkItem}
                                />
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground">
                              <T>No work items linked to this milestone yet.</T>
                            </p>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </CockpitSurface>
  );
}

function UnassignedBacklogStrip({
  unassignedCards,
  milestones,
  milestonesByHorizon,
  roster,
  stageLabelById,
  collapsed,
  assigningWorkItemId,
  onToggleCollapse,
  onOpenWorkItem,
  onAssignToMilestone,
  onOpenCreateMilestone,
  onOpenIntake,
}: {
  readonly unassignedCards: ReadonlyArray<CockpitWorkItemCard>;
  readonly milestones: ReadonlyArray<ProjectMilestone>;
  readonly milestonesByHorizon: Record<AgileHorizon, ReadonlyArray<ProjectMilestone>>;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly stageLabelById: ReadonlyMap<string, string>;
  readonly collapsed: boolean;
  readonly assigningWorkItemId: string | null;
  readonly onToggleCollapse: () => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onAssignToMilestone: (card: CockpitWorkItemCard, milestoneId: string) => void;
  readonly onOpenCreateMilestone: (horizon: AgileHorizon) => void;
  readonly onOpenIntake: () => void;
}) {
  const gt = useGT();

  let unassignedPoints = 0;
  for (const card of unassignedCards) {
    const lifecycle = readWorkItemLifecycle(card.workItem);
    unassignedPoints += lifecycle.storyPoints ?? 0;
  }

  return (
    <section className="space-y-2.5">
      <CockpitSectionHeader
        action={
          <div className="flex items-center gap-1.5">
            {unassignedPoints > 0 ? (
              <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                {gt("{count, plural, one {{count} pt} other {{count} pts}}", {
                  count: unassignedPoints,
                })}
              </span>
            ) : null}
            <Button size="xs" variant="ghost" onClick={onOpenIntake}>
              <PlusIcon />
              <T>New Backlog Item</T>
            </Button>
            <Button
              aria-expanded={!collapsed}
              size="xs"
              variant="ghost-muted"
              onClick={onToggleCollapse}
            >
              {collapsed ? <ChevronRightIcon /> : <ChevronDownIcon />}
              {collapsed ? <T>Expand</T> : <T>Collapse</T>}
            </Button>
          </div>
        }
        count={unassignedCards.length}
        icon={<LayersIcon />}
        title={<T>Unassigned Horizon Backlog</T>}
      />

      {!collapsed ? (
        unassignedCards.length === 0 ? (
          <CockpitSurface padding="md" variant="subtle">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-2">
                <CockpitStatusDot tone="success" />
                <T>All project work items are mapped to a roadmap milestone.</T>
              </span>
              <Button size="xs" variant="outline" onClick={onOpenIntake}>
                <PlusIcon />
                <T>Capture New Idea</T>
              </Button>
            </div>
          </CockpitSurface>
        ) : (
          <CockpitSurface divided variant="grouped">
            {unassignedCards.map((card) => {
              const lifecycle = readWorkItemLifecycle(card.workItem);
              const phase = deriveWorkItemPipelinePhase(card);
              const done = isWorkItemDoneStage(card.workItem.stage);
              const assignee = resolveCardAssignee(card, roster);
              const stageLabel =
                stageLabelById.get(card.workItem.stage) ?? pipelinePhaseShortLabel(phase, gt);
              const isAssigning = assigningWorkItemId === card.workItem.id;

              return (
                <CockpitSurfaceRow
                  key={card.workItem.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                  density="compact"
                  interactive
                >
                  <button
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    type="button"
                    onClick={() => onOpenWorkItem(card.workItem.id)}
                  >
                    <CockpitPriorityDot priority={card.workItem.priority} />
                    <CockpitArtifactIcon
                      className="size-3.5 shrink-0 text-muted-foreground"
                      kind={card.workItem.itemType}
                    />
                    <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                      {card.workItem.code}
                    </span>
                    <span
                      className={cn(
                        "min-w-0 flex-1 truncate text-xs font-medium",
                        done ? "text-muted-foreground line-through" : "text-foreground",
                      )}
                    >
                      {card.workItem.title}
                    </span>
                    {lifecycle.roadmapHorizon ? (
                      <span
                        className={cn(
                          "hidden shrink-0 rounded border px-1.5 py-0.5 text-3xs font-medium sm:inline-flex",
                          HORIZON_PILL_CLASS[lifecycle.roadmapHorizon],
                        )}
                      >
                        {horizonLabel(lifecycle.roadmapHorizon, gt)}
                      </span>
                    ) : null}
                    {lifecycle.storyPoints !== null ? (
                      <span className="shrink-0 rounded border border-border/50 bg-muted/40 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
                        <T>
                          <Var>{lifecycle.storyPoints}</Var> pt
                        </T>
                      </span>
                    ) : null}
                    <Badge size="sm" variant="outline">
                      {stageLabel}
                    </Badge>
                    {assignee ? (
                      <CockpitSwarmAvatar
                        displayName={assignee.displayName}
                        handle={assignee.handle}
                        kind={assignee.kind}
                        size="sm"
                      />
                    ) : null}
                  </button>

                  {milestones.length > 0 ? (
                    <div className="w-48 shrink-0">
                      <Select
                        disabled={isAssigning}
                        value={UNASSIGNED_SELECT_VALUE}
                        onValueChange={(nextValue) => {
                          if (
                            typeof nextValue === "string" &&
                            nextValue !== UNASSIGNED_SELECT_VALUE
                          ) {
                            onAssignToMilestone(card, nextValue);
                          }
                        }}
                      >
                        <SelectTrigger
                          aria-label={gt("Assign {code} to a milestone", {
                            code: card.workItem.code,
                          })}
                          size="xs"
                        >
                          <SelectValue>
                            <span className="text-muted-foreground">
                              {isAssigning ? <T>Assigning...</T> : <T>Assign milestone...</T>}
                            </span>
                          </SelectValue>
                        </SelectTrigger>
                        <SelectPopup align="end">
                          <SelectItem value={UNASSIGNED_SELECT_VALUE}>
                            <T>Unassigned</T>
                          </SelectItem>
                          {HORIZONS.map((horizon) => {
                            const groupItems = milestonesByHorizon[horizon];
                            if (groupItems.length === 0) return null;
                            return (
                              <SelectGroup key={horizon}>
                                <SelectGroupLabel>{horizonLabel(horizon, gt)}</SelectGroupLabel>
                                {groupItems.map((milestone) => (
                                  <SelectItem key={milestone.id} value={milestone.id}>
                                    {milestone.name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            );
                          })}
                        </SelectPopup>
                      </Select>
                    </div>
                  ) : (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => onOpenCreateMilestone("now")}
                    >
                      <PlusIcon />
                      <T>Create Milestone</T>
                    </Button>
                  )}
                </CockpitSurfaceRow>
              );
            })}
          </CockpitSurface>
        )
      ) : null}
    </section>
  );
}

function MilestoneFormDialog({
  open,
  draft,
  saving,
  onOpenChange,
  onDraftChange,
  onSubmit,
}: {
  readonly open: boolean;
  readonly draft: MilestoneFormDraft;
  readonly saving: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onDraftChange: (patch: Partial<MilestoneFormDraft>) => void;
  readonly onSubmit: () => void;
}) {
  const gt = useGT();
  const isEditing = draft.editingId !== null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="max-w-xl">
        <DialogHeader>
          <div className="flex items-start gap-3 pr-8">
            <CockpitIconBadge size="lg" tone={draft.colorTone}>
              <FlagIcon />
            </CockpitIconBadge>
            <div className="min-w-0 flex-1 space-y-1">
              <DialogTitle>
                {isEditing ? <T>Edit Milestone / Phase</T> : <T>New Milestone / Phase</T>}
              </DialogTitle>
              <DialogDescription>
                <T>
                  Define a product phase, assign its strategic horizon, and track rolled-up
                  discovery and delivery progress automatically.
                </T>
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <DialogPanel>
            <div className="space-y-4">
              <div>
                <CockpitFieldLabel htmlFor="roadmap-ms-name">
                  <T>Milestone Name</T>
                </CockpitFieldLabel>
                <Input
                  id="roadmap-ms-name"
                  placeholder={gt("e.g. Phase 1 · Core Foundation")}
                  value={draft.name}
                  onChange={(event) => onDraftChange({ name: event.target.value })}
                />
              </div>

              <div>
                <CockpitFieldLabel htmlFor="roadmap-ms-goal">
                  <T>Outcome Goal / Description</T>
                </CockpitFieldLabel>
                <Textarea
                  id="roadmap-ms-goal"
                  placeholder={gt("What user outcome or release milestone does this phase unlock?")}
                  rows={3}
                  value={draft.description}
                  onChange={(event) => onDraftChange({ description: event.target.value })}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <CockpitFieldLabel htmlFor="roadmap-ms-horizon">
                    <T>Strategic Horizon</T>
                  </CockpitFieldLabel>
                  <Select
                    value={draft.horizon}
                    onValueChange={(value) => {
                      if (value === "now" || value === "next" || value === "later") {
                        onDraftChange({ horizon: value });
                      }
                    }}
                  >
                    <SelectTrigger id="roadmap-ms-horizon" size="sm">
                      <SelectValue>{horizonLabel(draft.horizon, gt)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {HORIZONS.map((horizon) => (
                        <SelectItem key={horizon} value={horizon}>
                          <div className="flex flex-col">
                            <span>{horizonLabel(horizon, gt)}</span>
                            <span className="text-2xs text-muted-foreground">
                              {horizonSubtitle(horizon, gt)}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="roadmap-ms-status">
                    <T>Status</T>
                  </CockpitFieldLabel>
                  <Select
                    value={draft.status}
                    onValueChange={(value) => {
                      if (
                        value === "planned" ||
                        value === "active" ||
                        value === "completed" ||
                        value === "paused"
                      ) {
                        onDraftChange({ status: value });
                      }
                    }}
                  >
                    <SelectTrigger id="roadmap-ms-status" size="sm">
                      <SelectValue>{milestoneStatusLabel(draft.status, gt)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {MILESTONE_STATUSES.map((status) => (
                        <SelectItem key={status} value={status}>
                          <span className="inline-flex items-center gap-2">
                            <CockpitStatusDot tone={milestoneStatusDotTone(status)} />
                            <span>{milestoneStatusLabel(status, gt)}</span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <label
                      className="block text-xs font-medium text-muted-foreground"
                      htmlFor="roadmap-ms-target-date"
                    >
                      <T>Target Date</T>
                    </label>
                    {draft.targetDate ? (
                      <Button
                        size="micro"
                        variant="ghost-muted"
                        onClick={() => onDraftChange({ targetDate: "" })}
                      >
                        <T>Clear</T>
                      </Button>
                    ) : null}
                  </div>
                  <Input
                    id="roadmap-ms-target-date"
                    size="sm"
                    type="date"
                    value={draft.targetDate}
                    onChange={(event) => onDraftChange({ targetDate: event.target.value })}
                  />
                </div>

                <div>
                  <CockpitFieldLabel>
                    <T>Accent Tone</T>
                  </CockpitFieldLabel>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {MILESTONE_TONES.map((tone) => {
                      const active = draft.colorTone === tone;
                      return (
                        <button
                          key={tone}
                          aria-pressed={active}
                          className={cn(
                            "inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            active
                              ? TONE_SWATCH_ACTIVE_CLASS[tone]
                              : "border-border/60 bg-background/60 text-muted-foreground hover:border-border hover:text-foreground",
                          )}
                          type="button"
                          onClick={() => onDraftChange({ colorTone: tone })}
                        >
                          <span
                            aria-hidden
                            className={cn("size-2 rounded-full", TONE_SWATCH_DOT_CLASS[tone])}
                          />
                          <span>{milestoneToneLabel(tone, gt)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button disabled={saving || !draft.name.trim()} type="submit">
              {saving ? (
                <T>Saving...</T>
              ) : isEditing ? (
                <T>Save Changes</T>
              ) : (
                <T>Create Milestone</T>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  );
}

export function CockpitRoadmapView({
  environmentId,
  project,
  cards,
  stages,
  roster,
  onOpenWorkItem,
  onOpenIntakeForMilestone,
  onRefresh,
}: CockpitRoadmapViewProps) {
  const gt = useGT();
  const locale = useLocale();
  const [viewMode, setViewMode] = useState<RoadmapViewMode>("columns");
  const [statusFilter, setStatusFilter] = useState<RoadmapStatusFilter>("all");
  const [expandedMilestoneIds, setExpandedMilestoneIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [unassignedCollapsed, setUnassignedCollapsed] = useState(false);
  const [savingPlanning, setSavingPlanning] = useState(false);
  const [mutatingWorkItemId, setMutatingWorkItemId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formDraft, setFormDraft] = useState<MilestoneFormDraft>({
    editingId: null,
    name: "",
    description: "",
    horizon: "now",
    status: "active",
    targetDate: "",
    colorTone: "primary",
  });
  const [deleteTarget, setDeleteTarget] = useState<ProjectMilestone | null>(null);

  const updateProjectPlanning = useAtomCommand(teamHubEnvironment.updateProjectPlanning, {
    reportFailure: false,
  });
  const updateWorkItem = useAtomCommand(teamHubEnvironment.updateWorkItem, {
    reportFailure: false,
  });

  if (!project) {
    return (
      <CockpitSurface variant="grouped">
        <Empty>
          <EmptyMedia>
            <CockpitIllustration kind="empty_work_items" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>Select a project first</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Choose or create a project to plan Now, Next, and Later horizons and track
                development milestones.
              </T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CockpitSurface>
    );
  }

  const todayIso = getTodayIsoDate();
  const rawMilestones = project.workflowConfig.milestones ?? [];
  const milestones = sortMilestones(rawMilestones);
  const milestoneById = new Map<string, ProjectMilestone>();
  for (const milestone of milestones) {
    milestoneById.set(milestone.id, milestone);
  }

  const stageLabelById = new Map<string, string>();
  for (const stage of stages) {
    stageLabelById.set(stage.id, stage.label);
  }

  const cardsByMilestoneId = new Map<string, CockpitWorkItemCard[]>();
  const unassignedRawCards: CockpitWorkItemCard[] = [];
  let linkedItemsCount = 0;
  let totalRoadmapPoints = 0;
  let doneRoadmapPoints = 0;

  for (const card of cards) {
    const lifecycle = readWorkItemLifecycle(card.workItem);
    const points = lifecycle.storyPoints ?? 0;
    totalRoadmapPoints += points;
    if (isWorkItemDoneStage(card.workItem.stage)) {
      doneRoadmapPoints += points;
    }

    if (lifecycle.milestoneId && milestoneById.has(lifecycle.milestoneId)) {
      linkedItemsCount += 1;
      const bucket = cardsByMilestoneId.get(lifecycle.milestoneId);
      if (bucket) {
        bucket.push(card);
      } else {
        cardsByMilestoneId.set(lifecycle.milestoneId, [card]);
      }
    } else {
      unassignedRawCards.push(card);
    }
  }

  const sortedCardsByMilestoneId = new Map<string, ReadonlyArray<CockpitWorkItemCard>>();
  for (const [milestoneId, items] of cardsByMilestoneId.entries()) {
    sortedCardsByMilestoneId.set(milestoneId, sortWorkItemCards(items));
  }
  const unassignedCards = sortWorkItemCards(unassignedRawCards);

  const visibleMilestones =
    statusFilter === "all"
      ? milestones
      : milestones.filter((milestone) => milestone.status === statusFilter);

  const milestonesByHorizon: Record<AgileHorizon, ProjectMilestone[]> = {
    now: [],
    next: [],
    later: [],
  };
  for (const milestone of milestones) {
    milestonesByHorizon[milestone.horizon].push(milestone);
  }

  const visibleMilestonesByHorizon: Record<AgileHorizon, ProjectMilestone[]> = {
    now: [],
    next: [],
    later: [],
  };
  for (const milestone of visibleMilestones) {
    visibleMilestonesByHorizon[milestone.horizon].push(milestone);
  }

  const activeMilestonesCount = milestones.filter((m) => m.status === "active").length;

  const persistMilestones = async (
    nextMilestones: ReadonlyArray<ProjectMilestone>,
    successMessage: string,
  ): Promise<boolean> => {
    setSavingPlanning(true);
    const res = await updateProjectPlanning({
      environmentId,
      input: {
        projectId: project.id,
        milestones: [...nextMilestones],
      },
    });
    setSavingPlanning(false);

    if (res._tag === "Success") {
      toastManager.add({ title: successMessage, type: "success" });
      onRefresh();
      return true;
    }

    toastManager.add({
      title: formatCockpitCommandError(res, gt("Failed to update project roadmap.")),
      type: "error",
    });
    return false;
  };

  const openCreateDialog = (horizon: AgileHorizon) => {
    setFormDraft({
      editingId: null,
      name: "",
      description: "",
      horizon,
      status: defaultStatusForHorizon(horizon),
      targetDate: "",
      colorTone: defaultToneForHorizon(horizon),
    });
    setDialogOpen(true);
  };

  const openEditDialog = (milestone: ProjectMilestone) => {
    setFormDraft({
      editingId: milestone.id,
      name: milestone.name,
      description: milestone.description ?? "",
      horizon: milestone.horizon,
      status: milestone.status,
      targetDate: milestone.targetDate ?? "",
      colorTone: milestone.colorTone ?? defaultToneForHorizon(milestone.horizon),
    });
    setDialogOpen(true);
  };

  const handleBootstrapPhases = async () => {
    const nowIso = new Date().toISOString();
    const starterMilestones: ProjectMilestone[] = [
      {
        id: createMilestoneId(),
        name: gt("Phase 1 · Core Foundation"),
        description: gt("Ship core end-to-end user flows and stabilize baseline quality."),
        horizon: "now",
        status: "active",
        targetDate: addUtcDaysToIso(todayIso, 28),
        colorTone: "primary",
        createdAt: nowIso,
      },
      {
        id: createMilestoneId(),
        name: gt("Phase 2 · Workflow & UX Polish"),
        description: gt("Draft AI PRDs, validate interactive prototypes, and refine workflows."),
        horizon: "next",
        status: "planned",
        targetDate: addUtcDaysToIso(todayIso, 56),
        colorTone: "info",
        createdAt: nowIso,
      },
      {
        id: createMilestoneId(),
        name: gt("Phase 3 · Scale & Ecosystem"),
        description: gt("Explore platform integrations, performance scale, and long-term bets."),
        horizon: "later",
        status: "planned",
        targetDate: addUtcDaysToIso(todayIso, 90),
        colorTone: "violet",
        createdAt: nowIso,
      },
    ];
    await persistMilestones(starterMilestones, gt("Starter roadmap phases created"));
  };

  const handleSaveMilestoneForm = async () => {
    const trimmedName = formDraft.name.trim();
    if (!trimmedName) return;
    const trimmedDescription = formDraft.description.trim();
    const trimmedDate = formDraft.targetDate.trim();
    const existing = formDraft.editingId ? milestoneById.get(formDraft.editingId) : undefined;

    const savedMilestone: ProjectMilestone = {
      id: existing?.id ?? createMilestoneId(),
      name: trimmedName,
      ...(trimmedDescription ? { description: trimmedDescription } : {}),
      horizon: formDraft.horizon,
      status: formDraft.status,
      targetDate: trimmedDate || null,
      colorTone: formDraft.colorTone,
      createdAt: existing?.createdAt ?? new Date().toISOString(),
    };

    const nextMilestones = existing
      ? rawMilestones.map((item) => (item.id === existing.id ? savedMilestone : item))
      : [...rawMilestones, savedMilestone];

    const ok = await persistMilestones(
      nextMilestones,
      existing ? gt("Milestone updated") : gt("Milestone created"),
    );
    if (ok) {
      setDialogOpen(false);
    }
  };

  const handleConfirmDeleteMilestone = async () => {
    if (!deleteTarget) return;
    const targetName = deleteTarget.name;
    const nextMilestones = rawMilestones.filter((item) => item.id !== deleteTarget.id);
    const ok = await persistMilestones(
      nextMilestones,
      gt("Deleted milestone {name}", { name: targetName }),
    );
    if (ok) {
      setDeleteTarget(null);
    }
  };

  const handleShiftHorizon = async (milestone: ProjectMilestone, nextHorizon: AgileHorizon) => {
    if (milestone.horizon === nextHorizon) return;
    const nextMilestones = rawMilestones.map((item) =>
      item.id === milestone.id ? { ...item, horizon: nextHorizon } : item,
    );
    await persistMilestones(
      nextMilestones,
      gt("Moved {name} to {horizon}", {
        name: milestone.name,
        horizon: horizonLabel(nextHorizon, gt),
      }),
    );
  };

  const handleAssignItemToMilestone = async (
    card: CockpitWorkItemCard,
    targetMilestoneId: string,
  ) => {
    const targetMilestone = milestoneById.get(targetMilestoneId);
    if (!targetMilestone) return;

    setMutatingWorkItemId(card.workItem.id);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId: card.workItem.id,
        attributes: buildLifecycleAttributesPatch({
          milestoneId: targetMilestone.id,
          roadmapHorizon: targetMilestone.horizon,
        }),
      },
    });
    setMutatingWorkItemId(null);

    if (res._tag === "Success") {
      toastManager.add({
        title: gt("Assigned {code} to {milestone}", {
          code: card.workItem.code,
          milestone: targetMilestone.name,
        }),
        type: "success",
      });
      onRefresh();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to assign work item to milestone.")),
        type: "error",
      });
    }
  };

  const handleUnlinkWorkItem = async (card: CockpitWorkItemCard) => {
    setMutatingWorkItemId(card.workItem.id);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId: card.workItem.id,
        attributes: buildLifecycleAttributesPatch({
          milestoneId: null,
        }),
      },
    });
    setMutatingWorkItemId(null);

    if (res._tag === "Success") {
      toastManager.add({
        title: gt("Moved {code} to unassigned backlog", { code: card.workItem.code }),
        type: "success",
      });
      onRefresh();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to unlink work item from milestone.")),
        type: "error",
      });
    }
  };

  const handleToggleExpandMilestone = (milestoneId: string) => {
    setExpandedMilestoneIds((prev) => {
      const next = new Set(prev);
      if (next.has(milestoneId)) {
        next.delete(milestoneId);
      } else {
        next.add(milestoneId);
      }
      return next;
    });
  };

  const deleteTargetLinkedCount = deleteTarget
    ? (sortedCardsByMilestoneId.get(deleteTarget.id)?.length ?? 0)
    : 0;

  return (
    <div className="space-y-5">
      <CockpitStudioBanner
        actions={
          <>
            <Button size="sm" variant="default" onClick={() => openCreateDialog("now")}>
              <PlusIcon />
              <T>New Milestone / Phase</T>
            </Button>
            {milestones.length === 0 ? (
              <Button
                disabled={savingPlanning}
                size="sm"
                variant="outline"
                onClick={() => void handleBootstrapPhases()}
              >
                <LayersIcon />
                <T>Quick Bootstrap Phases</T>
              </Button>
            ) : null}
          </>
        }
        art="gantt_shield"
        compact
        description={
          <T>
            Coordinate continuous discovery and delivery: Now drives active sprint execution, Next
            shapes AI PRDs and interactive prototypes, and Later holds future strategic bets.
          </T>
        }
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            <CockpitStatusDot
              ring={activeMilestonesCount > 0}
              tone={activeMilestonesCount > 0 ? "success" : "info"}
            />
            <T>Dual-Track Product Roadmap</T>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">
              {gt("{count, plural, one {{count} milestone} other {{count} milestones}}", {
                count: milestones.length,
              })}
            </span>
            <span aria-hidden className="opacity-35">
              ·
            </span>
            <span className="tabular-nums">
              {gt("{count, plural, one {{count} linked item} other {{count} linked items}}", {
                count: linkedItemsCount,
              })}
            </span>
            <span aria-hidden className="opacity-35">
              ·
            </span>
            <span className="font-mono text-2xs tabular-nums text-foreground/85">
              {gt("{count, plural, one {{count} total point} other {{count} total points}}", {
                count: totalRoadmapPoints,
              })}
            </span>
            {totalRoadmapPoints > 0 ? (
              <>
                <span aria-hidden className="opacity-35">
                  ·
                </span>
                <span className="text-success-foreground tabular-nums">
                  <T>
                    <Var>{Math.round((doneRoadmapPoints / totalRoadmapPoints) * 100)}</Var>% points
                    done
                  </T>
                </span>
              </>
            ) : null}
          </div>
        }
        title={
          <T>
            <Var>{project.name}</Var> Roadmap &amp; Milestones
          </T>
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            aria-label={gt("Roadmap layout")}
            size="segmented"
            value={[viewMode]}
            variant="segmented"
            onValueChange={(next) => {
              const value = next[0];
              if (value === "columns" || value === "list") {
                setViewMode(value);
              }
            }}
          >
            <Toggle value="columns">
              <Columns3Icon className="size-3.5" />
              <T>Now / Next / Later Columns</T>
            </Toggle>
            <Toggle value="list">
              <ListIcon className="size-3.5" />
              <T>Milestone List</T>
            </Toggle>
          </ToggleGroup>

          {milestones.length > 0 ? (
            <ToggleGroup
              aria-label={gt("Filter milestones by status")}
              size="segmented"
              value={[statusFilter]}
              variant="segmented"
              onValueChange={(next) => {
                const value = next[0];
                if (
                  value === "all" ||
                  value === "active" ||
                  value === "planned" ||
                  value === "completed" ||
                  value === "paused"
                ) {
                  setStatusFilter(value);
                }
              }}
            >
              <Toggle value="all">
                <T>All</T>
              </Toggle>
              <Toggle value="active">
                <T>Active</T>
              </Toggle>
              <Toggle value="planned">
                <T>Planned</T>
              </Toggle>
              <Toggle value="completed">
                <T>Completed</T>
              </Toggle>
              {milestones.some((m) => m.status === "paused") || statusFilter === "paused" ? (
                <Toggle value="paused">
                  <T>Paused</T>
                </Toggle>
              ) : null}
            </ToggleGroup>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          {unassignedCards.length > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/55 bg-muted/25 px-2 py-1 tabular-nums">
              <CockpitStatusDot tone="warning" />
              {gt(
                "{count, plural, one {{count} item awaiting milestone} other {{count} items awaiting milestone}}",
                { count: unassignedCards.length },
              )}
            </span>
          ) : null}
        </div>
      </div>

      {viewMode === "columns" ? (
        <div className="grid gap-4 lg:grid-cols-3">
          {HORIZONS.map((horizon) => {
            const columnMilestones = visibleMilestonesByHorizon[horizon];
            let columnPoints = 0;
            let columnItems = 0;
            for (const milestone of columnMilestones) {
              const progress = computeMilestoneProgress(milestone, cards, todayIso);
              columnPoints += progress.totalPoints;
              columnItems += progress.totalItems;
            }

            return (
              <section
                key={horizon}
                className={cn(
                  "flex flex-col gap-3 rounded-2xl border border-border/55 border-t-2 bg-muted/15 p-3.5",
                  HORIZON_COLUMN_ACCENT_CLASS[horizon],
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2.5">
                    <CockpitIconBadge size="md" tone={horizonBadgeTone(horizon)}>
                      {renderHorizonIcon(horizon)}
                    </CockpitIconBadge>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {horizonLabel(horizon, gt)}
                        </h3>
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {columnMilestones.length}
                        </span>
                      </div>
                      <p className="text-2xs leading-snug text-muted-foreground">
                        {horizonSubtitle(horizon, gt)}
                      </p>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1.5">
                    {columnPoints > 0 ? (
                      <span className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-3xs font-medium tabular-nums text-foreground">
                        {gt("{count, plural, one {{count} pt} other {{count} pts}}", {
                          count: columnPoints,
                        })}
                      </span>
                    ) : columnItems > 0 ? (
                      <span className="rounded-md border border-border/55 bg-background/75 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
                        {gt("{count, plural, one {{count} item} other {{count} items}}", {
                          count: columnItems,
                        })}
                      </span>
                    ) : null}
                    <Button
                      aria-label={gt("Add milestone to {horizon}", {
                        horizon: horizonLabel(horizon, gt),
                      })}
                      size="icon-xs"
                      variant="outline"
                      onClick={() => openCreateDialog(horizon)}
                    >
                      <PlusIcon />
                    </Button>
                  </div>
                </div>

                {columnMilestones.length > 0 ? (
                  <div className="space-y-3">
                    {columnMilestones.map((milestone) => (
                      <MilestoneBoardCard
                        key={milestone.id}
                        allCards={cards}
                        expanded={expandedMilestoneIds.has(milestone.id)}
                        linkedCards={sortedCardsByMilestoneId.get(milestone.id) ?? []}
                        locale={locale}
                        milestone={milestone}
                        mutatingWorkItemId={mutatingWorkItemId}
                        roster={roster}
                        savingPlanning={savingPlanning}
                        stageLabelById={stageLabelById}
                        todayIso={todayIso}
                        onDeleteMilestone={setDeleteTarget}
                        onEditMilestone={openEditDialog}
                        onOpenIntakeForMilestone={onOpenIntakeForMilestone}
                        onOpenWorkItem={onOpenWorkItem}
                        onShiftHorizon={(item, nextHorizon) =>
                          void handleShiftHorizon(item, nextHorizon)
                        }
                        onToggleExpand={handleToggleExpandMilestone}
                        onUnlinkWorkItem={(card) => void handleUnlinkWorkItem(card)}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-2.5 rounded-xl border border-dashed border-border/60 bg-background/35 px-4 py-8 text-center">
                    <p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
                      {statusFilter === "all"
                        ? horizonEmptyCopy(horizon, gt)
                        : gt("No milestones match the active status filter in {horizon}.", {
                            horizon: horizonLabel(horizon, gt),
                          })}
                    </p>
                    <Button size="xs" variant="outline" onClick={() => openCreateDialog(horizon)}>
                      <PlusIcon />
                      <T>Add Phase</T>
                    </Button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      ) : (
        <MilestoneListTable
          allCards={cards}
          cardsByMilestoneId={sortedCardsByMilestoneId}
          expandedMilestoneIds={expandedMilestoneIds}
          locale={locale}
          milestones={visibleMilestones}
          mutatingWorkItemId={mutatingWorkItemId}
          roster={roster}
          savingPlanning={savingPlanning}
          stageLabelById={stageLabelById}
          todayIso={todayIso}
          onDeleteMilestone={setDeleteTarget}
          onEditMilestone={openEditDialog}
          onOpenIntakeForMilestone={onOpenIntakeForMilestone}
          onOpenWorkItem={onOpenWorkItem}
          onShiftHorizon={(item, nextHorizon) => void handleShiftHorizon(item, nextHorizon)}
          onToggleExpand={handleToggleExpandMilestone}
          onUnlinkWorkItem={(card) => void handleUnlinkWorkItem(card)}
        />
      )}

      <UnassignedBacklogStrip
        assigningWorkItemId={mutatingWorkItemId}
        collapsed={unassignedCollapsed}
        milestones={milestones}
        milestonesByHorizon={milestonesByHorizon}
        roster={roster}
        stageLabelById={stageLabelById}
        unassignedCards={unassignedCards}
        onAssignToMilestone={(card, milestoneId) =>
          void handleAssignItemToMilestone(card, milestoneId)
        }
        onOpenCreateMilestone={openCreateDialog}
        onOpenIntake={() => onOpenIntakeForMilestone(null, "now")}
        onOpenWorkItem={onOpenWorkItem}
        onToggleCollapse={() => setUnassignedCollapsed((prev) => !prev)}
      />

      <MilestoneFormDialog
        draft={formDraft}
        open={dialogOpen}
        saving={savingPlanning}
        onDraftChange={(patch) => setFormDraft((prev) => ({ ...prev, ...patch }))}
        onOpenChange={setDialogOpen}
        onSubmit={() => void handleSaveMilestoneForm()}
      />

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>
              <T>Delete milestone?</T>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget ? (
                deleteTargetLinkedCount > 0 ? (
                  gt(
                    "{count, plural, one {Remove {name} from the roadmap? Its {count} linked work item will stay intact and move back to the Unassigned Horizon Backlog.} other {Remove {name} from the roadmap? Its {count} linked work items will stay intact and move back to the Unassigned Horizon Backlog.}}",
                    { count: deleteTargetLinkedCount, name: deleteTarget.name },
                  )
                ) : (
                  <T>
                    Remove <Var>{deleteTarget.name}</Var> from the roadmap? You can always create a
                    new phase later.
                  </T>
                )
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </AlertDialogClose>
            <Button
              disabled={savingPlanning}
              variant="destructive"
              onClick={() => void handleConfirmDeleteMilestone()}
            >
              {savingPlanning ? <T>Deleting...</T> : <T>Delete Milestone</T>}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </div>
  );
}
