import type { EnvironmentId } from "@t3tools/contracts";
import {
  STORY_POINT_SCALE,
  buildCycleBurnupSeries,
  buildLifecycleAttributesPatch,
  computeCycleProgress,
  computeTeamVelocity,
  readWorkItemLifecycle,
  suggestNextCycleDraft,
  type CockpitWorkItemCard,
  type CycleBurnupPoint,
  type CycleProgressSummary,
  type CycleStatus,
  type Project,
  type ProjectCycle,
  type ProjectMilestone,
  type WorkflowStage,
} from "@u3code/hub-contracts";
import { Plural, T, useGT, Var } from "gt-react";
import {
  ArrowRightIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  FlagIcon,
  GaugeIcon,
  InboxIcon,
  LayersIcon,
  MinusIcon,
  PencilIcon,
  PlayIcon,
  PlusIcon,
  SearchIcon,
  TrendingDownIcon,
  TrendingUpIcon,
  XIcon,
} from "lucide-react";
import { useState } from "react";

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
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
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
  CockpitInlineAlert,
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

export interface CockpitCyclesViewProps {
  readonly environmentId: EnvironmentId;
  readonly project: Project | null;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly stages: ReadonlyArray<WorkflowStage>;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenIntakeForCycle: (cycleId: string | null) => void;
  readonly onRefresh: () => void;
}

type BacklogQuickFilter = "all" | "p0" | "p1" | "unestimated";
type CarryOverMode = "next_cycle" | "backlog";

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const MONTH_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

function todayLocalIsoDate(): string {
  const now = new Date();
  const y = String(now.getFullYear()).padStart(4, "0");
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function formatShortIsoDate(isoDate: string | null | undefined): string {
  if (!isoDate) return "";
  const match = ISO_DATE_PREFIX.exec(isoDate.trim());
  if (!match) return isoDate;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = MONTH_SHORT[month - 1];
  if (!monthLabel || day < 1 || day > 31) return isoDate;
  return `${monthLabel} ${day}`;
}

function formatCycleDateRange(startDate: string, endDate: string): string {
  const startLabel = formatShortIsoDate(startDate);
  const endLabel = formatShortIsoDate(endDate);
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  return startLabel || endLabel;
}

function createCycleId(cycleNumber: number): string {
  return `cyc_${cycleNumber}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
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

function cycleStatusTone(status: CycleStatus): CockpitTone {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "info";
    case "completed":
      return "neutral";
  }
}

function cycleStatusLabel(status: CycleStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "active":
      return gt("Active", { $context: "cycle status" });
    case "upcoming":
      return gt("Upcoming", { $context: "cycle status" });
    case "completed":
      return gt("Completed", { $context: "cycle status" });
  }
}

function scopeHealthBadgeVariant(
  health: CycleProgressSummary["scopeHealth"],
): "success" | "warning" | "error" {
  switch (health) {
    case "healthy":
      return "success";
    case "at_risk":
      return "warning";
    case "overcommitted":
      return "error";
  }
}

function scopeHealthIconTone(health: CycleProgressSummary["scopeHealth"]): CockpitIconBadgeTone {
  switch (health) {
    case "healthy":
      return "success";
    case "at_risk":
      return "warning";
    case "overcommitted":
      return "error";
  }
}

function scopeHealthBarClass(health: CycleProgressSummary["scopeHealth"]): string {
  switch (health) {
    case "healthy":
      return "bg-success";
    case "at_risk":
      return "bg-warning";
    case "overcommitted":
      return "bg-destructive";
  }
}

function scopeHealthLabel(
  health: CycleProgressSummary["scopeHealth"],
  gt: ReturnType<typeof useGT>,
): string {
  switch (health) {
    case "healthy":
      return gt("Healthy", { $context: "cycle scope health status" });
    case "at_risk":
      return gt("At Risk", { $context: "cycle scope health status" });
    case "overcommitted":
      return gt("Overcommitted", { $context: "cycle scope health status" });
  }
}

function workItemTypeIconClass(itemType: CockpitWorkItemCard["workItem"]["itemType"]): string {
  switch (itemType) {
    case "bug":
      return "text-destructive";
    case "security":
      return "text-warning-foreground";
    case "refactor":
      return "text-info-foreground";
    case "feature":
      return "text-primary";
    case "chore":
      return "text-muted-foreground";
  }
}

function milestoneToneDot(milestone: ProjectMilestone): CockpitTone {
  switch (milestone.colorTone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    case "info":
      return "info";
    default:
      return "neutral";
  }
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

function sortCycles(cycles: ReadonlyArray<ProjectCycle>): ProjectCycle[] {
  return [...cycles].toSorted((left, right) => {
    if (left.number !== right.number) return left.number - right.number;
    return left.startDate.localeCompare(right.startDate);
  });
}

function pickDefaultCycle(sortedCycles: ReadonlyArray<ProjectCycle>): ProjectCycle | null {
  const active = sortedCycles.find((cycle) => cycle.status === "active");
  if (active) return active;
  const upcoming = sortedCycles.find((cycle) => cycle.status === "upcoming");
  if (upcoming) return upcoming;
  return sortedCycles.at(-1) ?? null;
}

function parseCapacityInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? Math.min(500, rounded) : null;
}

function StoryPointsPicker({
  points,
  disabled,
  onSelect,
}: {
  readonly points: number | null;
  readonly disabled: boolean;
  readonly onSelect: (nextPoints: number | null) => void;
}) {
  const gt = useGT();
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        aria-label={
          points !== null
            ? gt("Story points: {points}. Change estimate", { points })
            : gt("Set story points estimate")
        }
        disabled={disabled}
        render={
          <button
            className={cn(
              "inline-flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-md border px-1.5 font-mono text-2xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-55",
              points !== null
                ? "border-primary/30 bg-primary/8 text-primary hover:border-primary/45 hover:bg-primary/14"
                : "border-border/55 bg-muted/25 text-muted-foreground hover:border-border hover:bg-accent/55 hover:text-foreground",
            )}
            type="button"
          />
        }
      >
        <span>
          {points !== null
            ? gt("{points} pt", { points })
            : gt("Est.", { $context: "short label for unset story points" })}
        </span>
        <ChevronDownIcon aria-hidden className="size-2.5 opacity-65" />
      </PopoverTrigger>
      <PopoverPopup align="end" padding="compact" side="bottom" sideOffset={4}>
        <div className="w-44 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-2xs font-medium text-muted-foreground">
              <T>Story Points</T>
            </span>
            {points !== null ? (
              <button
                className="cursor-pointer text-2xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                type="button"
                onClick={() => {
                  setOpen(false);
                  onSelect(null);
                }}
              >
                <T context="button, clears story points estimate">Clear</T>
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-1">
            {STORY_POINT_SCALE.map((value) => {
              const selected = points === value;
              return (
                <button
                  key={value}
                  aria-pressed={selected}
                  className={cn(
                    "inline-flex h-7 cursor-pointer items-center justify-center rounded-md border font-mono text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    selected
                      ? "border-primary/45 bg-primary/14 text-primary"
                      : "border-border/50 bg-background/70 text-foreground hover:border-border hover:bg-accent/60",
                  )}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (points !== value) {
                      onSelect(value);
                    }
                  }}
                >
                  {value}
                </button>
              );
            })}
          </div>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function CycleBurnupChart({
  cycle,
  progress,
  series,
}: {
  readonly cycle: ProjectCycle;
  readonly progress: CycleProgressSummary;
  readonly series: ReadonlyArray<CycleBurnupPoint>;
}) {
  const gt = useGT();
  const usePointsScale = progress.totalPoints > 0;
  const chartWidth = 320;
  const chartHeight = 132;
  const padLeft = 6;
  const padRight = 8;
  const padTop = 10;
  const padBottom = 8;
  const plotWidth = chartWidth - padLeft - padRight;
  const plotHeight = chartHeight - padTop - padBottom;

  let maxRawValue = 1;
  for (const point of series) {
    if (point.scopePoints > maxRawValue) maxRawValue = point.scopePoints;
    if (point.idealPoints > maxRawValue) maxRawValue = point.idealPoints;
    if (point.completedPoints !== null && point.completedPoints > maxRawValue) {
      maxRawValue = point.completedPoints;
    }
  }
  const yCeiling = maxRawValue * 1.12;

  const toX = (index: number): number => {
    if (series.length <= 1) return padLeft + plotWidth;
    return padLeft + (index / (series.length - 1)) * plotWidth;
  };
  const toY = (value: number): number => {
    const ratio = Math.max(0, Math.min(1, value / yCeiling));
    return padTop + plotHeight - ratio * plotHeight;
  };
  const baseY = padTop + plotHeight;

  const scopePolyline = series
    .map((point, index) => `${toX(index).toFixed(1)},${toY(point.scopePoints).toFixed(1)}`)
    .join(" ");

  const idealPolyline = series
    .map((point, index) => `${toX(index).toFixed(1)},${toY(point.idealPoints).toFixed(1)}`)
    .join(" ");

  const completedCoords: Array<{ readonly x: number; readonly y: number }> = [];
  for (let index = 0; index < series.length; index += 1) {
    const point = series[index];
    if (point && point.completedPoints !== null) {
      completedCoords.push({ x: toX(index), y: toY(point.completedPoints) });
    }
  }

  const completedLinePath =
    completedCoords.length >= 2
      ? completedCoords
          .map(
            (coord, idx) => `${idx === 0 ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`,
          )
          .join(" ")
      : "";

  const firstCompleted = completedCoords[0] ?? null;
  const lastCompleted = completedCoords.at(-1) ?? null;
  const completedAreaPath =
    completedCoords.length >= 2 && firstCompleted && lastCompleted
      ? `${completedLinePath} L ${lastCompleted.x.toFixed(1)} ${baseY.toFixed(1)} L ${firstCompleted.x.toFixed(1)} ${baseY.toFixed(1)} Z`
      : "";

  const firstPoint = series[0] ?? null;
  const midPoint = series.length >= 3 ? (series[Math.floor(series.length / 2)] ?? null) : null;
  const lastPoint = series.at(-1) ?? null;

  const paceDelta = progress.pointsCompletionPct - progress.idealPacePct;
  const paceTone: "success" | "info" | "warning" =
    cycle.status === "completed"
      ? progress.pointsCompletionPct >= 80
        ? "success"
        : "warning"
      : paceDelta >= 5
        ? "success"
        : paceDelta <= -12
          ? "warning"
          : "info";

  const paceLabel =
    cycle.status === "completed"
      ? gt("{pct}% delivered", { pct: progress.pointsCompletionPct })
      : cycle.status === "upcoming"
        ? gt("Scheduled")
        : paceDelta >= 5
          ? gt("Ahead of pace")
          : paceDelta <= -12
            ? gt("Behind pace")
            : gt("On pace");

  return (
    <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-xs font-medium text-foreground">
            <T>Burnup &amp; Pace</T>
          </div>
          <div className="text-2xs text-muted-foreground tabular-nums">
            {usePointsScale ? (
              <T>
                <Var>{progress.donePoints}</Var> / <Var>{progress.totalPoints}</Var> pt completed
              </T>
            ) : (
              <T>
                <Var>{progress.doneItems}</Var> / <Var>{progress.totalItems}</Var> items completed
              </T>
            )}
          </div>
        </div>
        <Badge size="sm" variant={paceTone}>
          {paceLabel}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div className="rounded-xl border border-border/45 bg-background/55 px-2.5 pt-2 pb-1.5">
          <svg
            aria-hidden="true"
            className="h-32 w-full overflow-visible"
            preserveAspectRatio="none"
            viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          >
            {[0.25, 0.5, 0.75, 1].map((fraction) => {
              const y = padTop + plotHeight * (1 - fraction);
              return (
                <line
                  key={fraction}
                  className="stroke-border/45"
                  strokeWidth={1}
                  x1={padLeft}
                  x2={padLeft + plotWidth}
                  y1={y}
                  y2={y}
                />
              );
            })}
            <line
              className="stroke-border/70"
              strokeWidth={1}
              x1={padLeft}
              x2={padLeft + plotWidth}
              y1={baseY}
              y2={baseY}
            />

            {scopePolyline ? (
              <polyline
                className="stroke-border"
                fill="none"
                points={scopePolyline}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
              />
            ) : null}

            {idealPolyline ? (
              <polyline
                className="stroke-muted-foreground/50"
                fill="none"
                points={idealPolyline}
                strokeDasharray="4 4"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.35}
              />
            ) : null}

            {completedAreaPath ? <path className="fill-primary/15" d={completedAreaPath} /> : null}

            {completedLinePath ? (
              <path
                className="stroke-primary"
                d={completedLinePath}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            ) : null}

            {lastCompleted ? (
              <>
                <line
                  className="stroke-primary/35"
                  strokeDasharray="2 3"
                  strokeWidth={1}
                  x1={lastCompleted.x}
                  x2={lastCompleted.x}
                  y1={lastCompleted.y}
                  y2={baseY}
                />
                <circle
                  className="fill-primary/20"
                  cx={lastCompleted.x}
                  cy={lastCompleted.y}
                  r={6}
                />
                <circle
                  className="fill-primary stroke-card"
                  cx={lastCompleted.x}
                  cy={lastCompleted.y}
                  r={3.5}
                  strokeWidth={1.5}
                />
              </>
            ) : null}
          </svg>
        </div>

        <div className="flex items-center justify-between gap-2 px-1 font-mono text-2xs tabular-nums text-muted-foreground">
          <span>{formatShortIsoDate(firstPoint?.date ?? cycle.startDate)}</span>
          {midPoint ? <span>{formatShortIsoDate(midPoint.date)}</span> : null}
          <span>{formatShortIsoDate(lastPoint?.date ?? cycle.endDate)}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-2xs text-muted-foreground">
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full bg-primary" />
            <T>Completed</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="inline-block w-3 border-t border-dashed border-muted-foreground/70"
            />
            <T>Ideal pace</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block h-0.5 w-3 rounded-full bg-border" />
            <T>Scope</T>
          </span>
        </div>
        <span className="font-mono tabular-nums text-muted-foreground/80">
          {usePointsScale ? (
            <T>
              <Var>{progress.totalPoints}</Var> pt
            </T>
          ) : (
            <T>
              <Plural
                n={progress.totalItems}
                one={
                  <>
                    <Var>{progress.totalItems}</Var> item
                  </>
                }
                other={
                  <>
                    <Var>{progress.totalItems}</Var> items
                  </>
                }
              />
            </T>
          )}
        </span>
      </div>
    </div>
  );
}

export function CockpitCyclesView({
  environmentId,
  project,
  cards,
  stages,
  roster,
  onOpenWorkItem,
  onOpenIntakeForCycle,
  onRefresh,
}: CockpitCyclesViewProps) {
  const gt = useGT();
  const [selectedCycleId, setSelectedCycleId] = useState<string | null>(null);
  const [backlogSearch, setBacklogSearch] = useState("");
  const [backlogQuickFilter, setBacklogQuickFilter] = useState<BacklogQuickFilter>("all");
  const [busyWorkItemIds, setBusyWorkItemIds] = useState<ReadonlyArray<string>>([]);
  const [savingPlanning, setSavingPlanning] = useState(false);

  const [cycleDialogMode, setCycleDialogMode] = useState<"create" | "edit" | null>(null);
  const [editingCycleId, setEditingCycleId] = useState<string | null>(null);
  const [draftNumber, setDraftNumber] = useState<number>(1);
  const [draftName, setDraftName] = useState("");
  const [draftGoal, setDraftGoal] = useState("");
  const [draftStartDate, setDraftStartDate] = useState("");
  const [draftEndDate, setDraftEndDate] = useState("");
  const [draftCapacity, setDraftCapacity] = useState("");
  const [draftStatus, setDraftStatus] = useState<CycleStatus>("upcoming");

  const [completeDialogOpen, setCompleteDialogOpen] = useState(false);
  const [carryOverMode, setCarryOverMode] = useState<CarryOverMode>("next_cycle");
  const [completingCycle, setCompletingCycle] = useState(false);

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
                Choose or create a project to plan agile cycles, track burnup velocity, and groom
                your product backlog.
              </T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CockpitSurface>
    );
  }

  const todayIso = todayLocalIsoDate();
  const rawCycles = project.workflowConfig.cycles ?? [];
  const sortedCycles = sortCycles(rawCycles);
  const milestones = project.workflowConfig.milestones ?? [];
  const milestoneById = new Map(milestones.map((milestone) => [milestone.id, milestone] as const));
  const stageById = new Map(stages.map((stage) => [stage.id, stage] as const));
  const stageOrder = new Map(stages.map((stage, index) => [stage.id, index] as const));

  const selectedCycle =
    (selectedCycleId ? sortedCycles.find((cycle) => cycle.id === selectedCycleId) : null) ??
    pickDefaultCycle(sortedCycles);

  const velocity = computeTeamVelocity(sortedCycles, cards);
  const nextCycleDraft = suggestNextCycleDraft(sortedCycles, todayIso);
  const selectedProgress = selectedCycle
    ? computeCycleProgress(selectedCycle, cards, todayIso)
    : null;
  const burnupSeries = selectedCycle ? buildCycleBurnupSeries(selectedCycle, cards, todayIso) : [];

  const lifecycleByCardId = new Map(
    cards.map((card) => [card.workItem.id, readWorkItemLifecycle(card.workItem)] as const),
  );

  const cycleCards = selectedCycle
    ? cards
        .filter((card) => lifecycleByCardId.get(card.workItem.id)?.cycleId === selectedCycle.id)
        .toSorted((left, right) => {
          const leftDone = isWorkItemDoneStage(left.workItem.stage) ? 1 : 0;
          const rightDone = isWorkItemDoneStage(right.workItem.stage) ? 1 : 0;
          if (leftDone !== rightDone) return leftDone - rightDone;
          const leftStage = stageOrder.get(left.workItem.stage) ?? 999;
          const rightStage = stageOrder.get(right.workItem.stage) ?? 999;
          if (leftStage !== rightStage) return leftStage - rightStage;
          const pDiff =
            priorityWeight(left.workItem.priority) - priorityWeight(right.workItem.priority);
          if (pDiff !== 0) return pDiff;
          return left.workItem.code.localeCompare(right.workItem.code);
        })
    : [];

  const allBacklogCards = cards
    .filter((card) => {
      const lifecycle = lifecycleByCardId.get(card.workItem.id);
      return !lifecycle?.cycleId && !isWorkItemDoneStage(card.workItem.stage);
    })
    .toSorted((left, right) => {
      const pDiff =
        priorityWeight(left.workItem.priority) - priorityWeight(right.workItem.priority);
      if (pDiff !== 0) return pDiff;
      return right.workItem.updatedAt.localeCompare(left.workItem.updatedAt);
    });

  const normalizedQuery = backlogSearch.trim().toLowerCase();
  const filteredBacklogCards = allBacklogCards.filter((card) => {
    const lifecycle = lifecycleByCardId.get(card.workItem.id);
    if (backlogQuickFilter === "p0" && card.workItem.priority !== "p0") return false;
    if (backlogQuickFilter === "p1" && card.workItem.priority !== "p1") return false;
    if (backlogQuickFilter === "unestimated" && lifecycle?.storyPoints !== null) return false;
    if (!normalizedQuery) return true;
    const milestone = lifecycle?.milestoneId ? milestoneById.get(lifecycle.milestoneId) : null;
    const haystack =
      `${card.workItem.code} ${card.workItem.title} ${milestone?.name ?? ""}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });

  const unfinishedCycleCards = cycleCards.filter(
    (card) => !isWorkItemDoneStage(card.workItem.stage),
  );
  const unfinishedPoints = unfinishedCycleCards.reduce(
    (sum, card) => sum + (lifecycleByCardId.get(card.workItem.id)?.storyPoints ?? 0),
    0,
  );
  const nextUpcomingCycle = selectedCycle
    ? (sortedCycles.find(
        (cycle) =>
          cycle.id !== selectedCycle.id &&
          cycle.status === "upcoming" &&
          cycle.number > selectedCycle.number,
      ) ??
      sortedCycles.find((cycle) => cycle.id !== selectedCycle.id && cycle.status === "upcoming") ??
      null)
    : null;

  const markItemBusy = (workItemId: string, busy: boolean) => {
    setBusyWorkItemIds((prev) =>
      busy
        ? prev.includes(workItemId)
          ? prev
          : [...prev, workItemId]
        : prev.filter((id) => id !== workItemId),
    );
  };

  const openCreateCycleDialog = () => {
    const draft = suggestNextCycleDraft(sortedCycles, todayIso);
    const hasActiveCycle = sortedCycles.some((cycle) => cycle.status === "active");
    setEditingCycleId(null);
    setDraftNumber(draft.number);
    setDraftName(draft.name);
    setDraftGoal("");
    setDraftStartDate(draft.startDate);
    setDraftEndDate(draft.endDate);
    setDraftCapacity(String(draft.capacityPoints));
    setDraftStatus(hasActiveCycle ? "upcoming" : "active");
    setCycleDialogMode("create");
  };

  const openEditCycleDialog = (cycle: ProjectCycle) => {
    setEditingCycleId(cycle.id);
    setDraftNumber(cycle.number);
    setDraftName(cycle.name);
    setDraftGoal(cycle.goal ?? "");
    setDraftStartDate(cycle.startDate);
    setDraftEndDate(cycle.endDate);
    setDraftCapacity(cycle.capacityPoints != null ? String(cycle.capacityPoints) : "");
    setDraftStatus(cycle.status);
    setCycleDialogMode("edit");
  };

  const persistCycles = async (
    nextCycles: ReadonlyArray<ProjectCycle>,
    successTitle: string,
    nextSelectedId?: string,
  ): Promise<boolean> => {
    setSavingPlanning(true);
    const res = await updateProjectPlanning({
      environmentId,
      input: {
        projectId: project.id,
        cycles: nextCycles,
      },
    });
    setSavingPlanning(false);

    if (res._tag === "Success") {
      if (nextSelectedId) {
        setSelectedCycleId(nextSelectedId);
      }
      toastManager.add({ title: successTitle, type: "success" });
      onRefresh();
      return true;
    }

    toastManager.add({
      title: formatCockpitCommandError(res, gt("Failed to save cycle plan.")),
      type: "error",
    });
    return false;
  };

  const handleQuickStartFirstCycle = async () => {
    const draft = suggestNextCycleDraft(sortedCycles, todayIso);
    const firstCycle: ProjectCycle = {
      id: createCycleId(draft.number),
      number: draft.number,
      name: draft.name,
      startDate: draft.startDate,
      endDate: draft.endDate,
      status: "active",
      capacityPoints: draft.capacityPoints,
    };
    await persistCycles(
      [...sortedCycles, firstCycle],
      gt("{name} started", { name: firstCycle.name }),
      firstCycle.id,
    );
  };

  const handleSaveCycleDialog = async () => {
    const trimmedName = draftName.trim();
    if (!trimmedName || !draftStartDate || !draftEndDate || draftEndDate < draftStartDate) return;

    const trimmedGoal = draftGoal.trim();
    const capacityPoints = parseCapacityInput(draftCapacity);

    if (cycleDialogMode === "edit" && editingCycleId) {
      const existing = sortedCycles.find((cycle) => cycle.id === editingCycleId);
      if (!existing) return;

      const { goal: _prevGoal, ...existingWithoutGoal } = existing;
      const updatedCycle: ProjectCycle = {
        ...existingWithoutGoal,
        name: trimmedName,
        ...(trimmedGoal ? { goal: trimmedGoal } : {}),
        startDate: draftStartDate,
        endDate: draftEndDate,
        status: draftStatus,
        capacityPoints,
      };

      const nextCycles = sortedCycles.map((cycle) => {
        if (cycle.id === editingCycleId) return updatedCycle;
        if (draftStatus === "active" && cycle.status === "active") {
          return { ...cycle, status: "upcoming" as const };
        }
        return cycle;
      });

      const ok = await persistCycles(
        nextCycles,
        gt("{name} updated", { name: trimmedName }),
        updatedCycle.id,
      );
      if (ok) {
        setCycleDialogMode(null);
      }
      return;
    }

    const newCycle: ProjectCycle = {
      id: createCycleId(draftNumber),
      number: draftNumber,
      name: trimmedName,
      ...(trimmedGoal ? { goal: trimmedGoal } : {}),
      startDate: draftStartDate,
      endDate: draftEndDate,
      status: draftStatus,
      capacityPoints,
    };

    const baseCycles =
      draftStatus === "active"
        ? sortedCycles.map((cycle) =>
            cycle.status === "active" ? { ...cycle, status: "upcoming" as const } : cycle,
          )
        : sortedCycles;

    const ok = await persistCycles(
      [...baseCycles, newCycle],
      gt("{name} created", { name: trimmedName }),
      newCycle.id,
    );
    if (ok) {
      setCycleDialogMode(null);
    }
  };

  const handleStartCycle = async (cycle: ProjectCycle) => {
    const nextCycles = sortedCycles.map((entry) => {
      if (entry.id === cycle.id) {
        return { ...entry, status: "active" as const };
      }
      if (entry.status === "active") {
        return { ...entry, status: "upcoming" as const };
      }
      return entry;
    });

    await persistCycles(nextCycles, gt("{name} is now active", { name: cycle.name }), cycle.id);
  };

  const handleAddToCycle = async (card: CockpitWorkItemCard) => {
    if (!selectedCycle) return;
    markItemBusy(card.workItem.id, true);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId: card.workItem.id,
        attributes: buildLifecycleAttributesPatch({
          cycleId: selectedCycle.id,
          roadmapHorizon: "now",
        }),
      },
    });
    markItemBusy(card.workItem.id, false);

    if (res._tag === "Success") {
      toastManager.add({
        title: gt("Added {code} to {cycleName}", {
          code: card.workItem.code,
          cycleName: selectedCycle.name,
        }),
        type: "success",
      });
      onRefresh();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to add work item to cycle.")),
        type: "error",
      });
    }
  };

  const handleMoveToBacklog = async (card: CockpitWorkItemCard) => {
    markItemBusy(card.workItem.id, true);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId: card.workItem.id,
        attributes: buildLifecycleAttributesPatch({ cycleId: null }),
      },
    });
    markItemBusy(card.workItem.id, false);

    if (res._tag === "Success") {
      toastManager.add({
        title: gt("Moved {code} to Product Backlog", { code: card.workItem.code }),
        type: "success",
      });
      onRefresh();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to move work item to backlog.")),
        type: "error",
      });
    }
  };

  const handleUpdateStoryPoints = async (card: CockpitWorkItemCard, nextPoints: number | null) => {
    markItemBusy(card.workItem.id, true);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId: card.workItem.id,
        attributes: buildLifecycleAttributesPatch({ storyPoints: nextPoints }),
      },
    });
    markItemBusy(card.workItem.id, false);

    if (res._tag === "Success") {
      toastManager.add({
        title:
          nextPoints !== null
            ? gt("Set {code} to {points} pt", { code: card.workItem.code, points: nextPoints })
            : gt("Cleared story points for {code}", { code: card.workItem.code }),
        type: "success",
      });
      onRefresh();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update story points.")),
        type: "error",
      });
    }
  };

  const handleCompleteCycle = async () => {
    if (!selectedCycle || !selectedProgress) return;
    setCompletingCycle(true);

    const completedAt = new Date().toISOString();
    const shouldCarryToNext = unfinishedCycleCards.length > 0 && carryOverMode === "next_cycle";
    let targetNextCycle: ProjectCycle | null = shouldCarryToNext ? nextUpcomingCycle : null;

    const updatedExisting = sortedCycles.map((cycle) =>
      cycle.id === selectedCycle.id
        ? {
            ...cycle,
            status: "completed" as const,
            completedPoints: selectedProgress.donePoints,
            completedAt,
          }
        : cycle,
    );

    let nextCycles = updatedExisting;
    if (shouldCarryToNext && !targetNextCycle) {
      const draft = suggestNextCycleDraft(updatedExisting, todayIso);
      const createdNext: ProjectCycle = {
        id: createCycleId(draft.number),
        number: draft.number,
        name: draft.name,
        startDate: draft.startDate,
        endDate: draft.endDate,
        status: "upcoming",
        capacityPoints: draft.capacityPoints,
      };
      targetNextCycle = createdNext;
      nextCycles = [...updatedExisting, createdNext];
    }

    const planRes = await updateProjectPlanning({
      environmentId,
      input: {
        projectId: project.id,
        cycles: nextCycles,
      },
    });

    if (planRes._tag !== "Success") {
      setCompletingCycle(false);
      toastManager.add({
        title: formatCockpitCommandError(planRes, gt("Failed to complete cycle.")),
        type: "error",
      });
      return;
    }

    let failedUpdates = 0;
    if (unfinishedCycleCards.length > 0) {
      const targetCycleId = shouldCarryToNext ? (targetNextCycle?.id ?? null) : null;
      const patch = buildLifecycleAttributesPatch(
        targetCycleId ? { cycleId: targetCycleId, roadmapHorizon: "now" } : { cycleId: null },
      );

      const results = await Promise.all(
        unfinishedCycleCards.map((card) =>
          updateWorkItem({
            environmentId,
            input: {
              workItemId: card.workItem.id,
              attributes: patch,
            },
          }),
        ),
      );
      failedUpdates = results.filter((entry) => entry._tag !== "Success").length;
    }

    setCompletingCycle(false);
    setCompleteDialogOpen(false);
    if (targetNextCycle) {
      setSelectedCycleId(targetNextCycle.id);
    }

    if (failedUpdates > 0) {
      toastManager.add({
        title: gt(
          "{cycleName} completed, but {count, plural, one {{count} item} other {{count} items}} failed to move.",
          { cycleName: selectedCycle.name, count: failedUpdates },
        ),
        type: "warning",
      });
    } else if (shouldCarryToNext && targetNextCycle) {
      toastManager.add({
        title: gt(
          "Completed {cycleName} and carried {count, plural, one {{count} item} other {{count} items}} to {nextName}",
          {
            cycleName: selectedCycle.name,
            count: unfinishedCycleCards.length,
            nextName: targetNextCycle.name,
          },
        ),
        type: "success",
      });
    } else if (unfinishedCycleCards.length > 0) {
      toastManager.add({
        title: gt(
          "Completed {cycleName} and returned {count, plural, one {{count} item} other {{count} items}} to backlog",
          { cycleName: selectedCycle.name, count: unfinishedCycleCards.length },
        ),
        type: "success",
      });
    } else {
      toastManager.add({
        title: gt("{cycleName} completed", { cycleName: selectedCycle.name }),
        type: "success",
      });
    }

    onRefresh();
  };

  const isDateRangeInvalid =
    draftStartDate.length > 0 && draftEndDate.length > 0 && draftEndDate < draftStartDate;
  const capacityUtilizationClamped = Math.max(
    0,
    Math.min(100, selectedProgress?.capacityUtilizationPct ?? 0),
  );
  const heroTone: CockpitTone = selectedCycle ? cycleStatusTone(selectedCycle.status) : "info";
  const canEditSelectedScope = selectedCycle !== null && selectedCycle.status !== "completed";

  return (
    <div className="space-y-5">
      <CockpitStudioBanner
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {selectedCycle?.status === "upcoming" ? (
              <Button
                disabled={savingPlanning}
                size="sm"
                variant="default"
                onClick={() => void handleStartCycle(selectedCycle)}
              >
                <PlayIcon />
                <T>Start Cycle</T>
              </Button>
            ) : selectedCycle?.status === "active" ? (
              <Button
                disabled={savingPlanning}
                size="sm"
                variant="default"
                onClick={() => {
                  setCarryOverMode("next_cycle");
                  setCompleteDialogOpen(true);
                }}
              >
                <CheckCircle2Icon />
                <T>Complete Cycle</T>
              </Button>
            ) : null}

            <Button
              disabled={savingPlanning}
              size="sm"
              variant={selectedCycle ? "outline" : "default"}
              onClick={openCreateCycleDialog}
            >
              <PlusIcon />
              <T>New Cycle</T>
            </Button>

            <Button
              size="sm"
              variant="outline"
              onClick={() => onOpenIntakeForCycle(selectedCycle?.id ?? null)}
            >
              <PlusIcon />
              <T>Add Item</T>
            </Button>
          </div>
        }
        art="hero_pipeline"
        compact
        description={
          selectedCycle ? (
            selectedCycle.goal?.trim() ? (
              <span>{selectedCycle.goal}</span>
            ) : (
              <T>
                Keep scope crisp, pace delivery against team capacity, and pull ready work items
                from the backlog in one click.
              </T>
            )
          ) : (
            <T>
              Organize <Var>{project.name}</Var> into focused 2-week cycles with live burnup
              tracking, capacity guardrails, and velocity history.
            </T>
          )
        }
        eyebrow={
          <span className="inline-flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <CockpitStatusDot ring={selectedCycle?.status === "active"} tone={heroTone} />
              <span>
                {selectedCycle?.status === "active" ? (
                  <T>Active Cycle</T>
                ) : selectedCycle?.status === "upcoming" ? (
                  <T>Upcoming Cycle</T>
                ) : selectedCycle?.status === "completed" ? (
                  <T>Completed Cycle</T>
                ) : (
                  <T>Agile Cycles</T>
                )}
              </span>
            </span>
            {selectedCycle ? (
              <span className="inline-flex items-center rounded-md border border-border/65 bg-background/75 px-1.5 py-0.5 font-mono text-2xs font-medium text-foreground tabular-nums">
                <T>
                  Cycle <Var>{selectedCycle.number}</Var>
                </T>
              </span>
            ) : null}
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-2">
            {selectedCycle && selectedProgress ? (
              <span className="inline-flex items-center gap-1.5 rounded-md border border-border/55 bg-background/75 px-2 py-0.5 text-2xs font-medium text-foreground tabular-nums">
                <CalendarRangeIcon aria-hidden className="size-3 text-muted-foreground" />
                <span>{formatCycleDateRange(selectedCycle.startDate, selectedCycle.endDate)}</span>
                <span aria-hidden className="text-muted-foreground/50">
                  ·
                </span>
                <span className="text-muted-foreground">
                  {selectedCycle.status === "completed" ? (
                    <T context="cycle status">Completed</T>
                  ) : selectedProgress.daysRemaining === 0 ? (
                    <T>Ends today</T>
                  ) : (
                    <T>
                      <Plural
                        n={selectedProgress.daysRemaining}
                        one={
                          <>
                            <Var>{selectedProgress.daysRemaining}</Var> day left
                          </>
                        }
                        other={
                          <>
                            <Var>{selectedProgress.daysRemaining}</Var> days left
                          </>
                        }
                      />
                    </T>
                  )}
                </span>
              </span>
            ) : null}

            <span className="inline-flex items-center gap-1.5 rounded-md border border-border/55 bg-background/75 px-2 py-0.5 text-2xs font-medium text-muted-foreground tabular-nums">
              <TrendingUpIcon aria-hidden className="size-3 text-primary" />
              {velocity.completedCycles > 0 ? (
                <T>
                  Avg <Var>{velocity.averagePoints}</Var> pt/cycle
                </T>
              ) : (
                <T>Avg 0 pt/cycle</T>
              )}
            </span>
          </div>
        }
        title={selectedCycle ? selectedCycle.name : <T>Start Your First Cycle</T>}
      />

      {sortedCycles.length === 0 ? (
        <CockpitSurface variant="grouped">
          <Empty>
            <EmptyMedia>
              <CockpitIllustration kind="empty_gantt" />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>
                <T>Plan your first 2-week delivery cycle</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>
                  Kick off <Var>{nextCycleDraft.name}</Var> (
                  <Var>
                    {formatCycleDateRange(nextCycleDraft.startDate, nextCycleDraft.endDate)}
                  </Var>
                  ) with a <Var>{nextCycleDraft.capacityPoints}</Var>-point capacity guardrail, then
                  pull prioritized work items straight from your backlog.
                </T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button
                  disabled={savingPlanning}
                  size="sm"
                  variant="default"
                  onClick={() => void handleQuickStartFirstCycle()}
                >
                  <PlayIcon />
                  <T>Start 2-Week Cycle 1</T>
                </Button>
                <Button
                  disabled={savingPlanning}
                  size="sm"
                  variant="outline"
                  onClick={openCreateCycleDialog}
                >
                  <CalendarRangeIcon />
                  <T>Customize Dates &amp; Goal</T>
                </Button>
              </div>
            </EmptyContent>
          </Empty>
        </CockpitSurface>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3">
            <div
              aria-label={gt("Project cycles")}
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5"
              role="tablist"
            >
              {sortedCycles.map((cycle) => {
                const isSelected = selectedCycle?.id === cycle.id;
                return (
                  <button
                    key={cycle.id}
                    aria-selected={isSelected}
                    className={cn(
                      "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-xl border px-3 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      isSelected
                        ? "border-foreground/25 bg-accent/85 font-medium text-foreground shadow-2xs"
                        : "border-border/55 bg-card/55 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground",
                    )}
                    role="tab"
                    type="button"
                    onClick={() => setSelectedCycleId(cycle.id)}
                  >
                    <CockpitStatusDot
                      ring={cycle.status === "active"}
                      tone={cycleStatusTone(cycle.status)}
                    />
                    <span className="whitespace-nowrap">{cycle.name}</span>
                    <span className="font-mono text-2xs text-muted-foreground/80 tabular-nums whitespace-nowrap">
                      {formatCycleDateRange(cycle.startDate, cycle.endDate)}
                    </span>
                  </button>
                );
              })}
            </div>

            {selectedCycle ? (
              <div className="flex shrink-0 items-center gap-1.5">
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        aria-label={gt("Edit cycle", { $context: "button, edits selected cycle" })}
                        size="icon-sm"
                        variant="outline"
                        onClick={() => openEditCycleDialog(selectedCycle)}
                      />
                    }
                  >
                    <PencilIcon />
                  </TooltipTrigger>
                  <TooltipPopup>
                    <T context="button, edits selected cycle">Edit cycle</T>
                  </TooltipPopup>
                </Tooltip>
              </div>
            ) : null}
          </div>

          {selectedCycle && selectedProgress ? (
            <section aria-label={gt("Cycle health and burnup")}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        <T>Committed Scope</T>
                      </span>
                      <CockpitIconBadge size="sm" tone="primary">
                        <CockpitStageArtworkIcon stage="intake" />
                      </CockpitIconBadge>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                        <T>
                          <Plural
                            n={selectedProgress.totalItems}
                            one={
                              <>
                                <Var>{selectedProgress.totalItems}</Var> item
                              </>
                            }
                            other={
                              <>
                                <Var>{selectedProgress.totalItems}</Var> items
                              </>
                            }
                          />
                        </T>
                      </span>
                      <span className="font-mono text-xs font-medium text-primary tabular-nums">
                        {selectedProgress.totalPoints > 0 ? (
                          <T>
                            <Var>{selectedProgress.totalPoints}</Var> pt
                          </T>
                        ) : (
                          <span className="text-muted-foreground">
                            <T>Unestimated</T>
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground tabular-nums">
                      <span>
                        <T>
                          <Var>{selectedProgress.activeItems}</Var> in progress
                        </T>
                      </span>
                      {selectedProgress.blockedItems > 0 ? (
                        <span className="inline-flex items-center gap-1 font-medium text-destructive">
                          <CockpitStatusDot tone="error" />
                          <T>
                            <Var>{selectedProgress.blockedItems}</Var> blocked
                          </T>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-success-foreground">
                          <CockpitStatusDot tone="success" />
                          <T>No blockers</T>
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        <T>Completed</T>
                      </span>
                      <CockpitIconBadge
                        size="sm"
                        tone={
                          selectedProgress.totalItems > 0 &&
                          selectedProgress.pointsCompletionPct === 100
                            ? "success"
                            : "info"
                        }
                      >
                        <CheckCircle2Icon />
                      </CockpitIconBadge>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                        {selectedProgress.totalPoints > 0 ? (
                          <T>
                            <Var>{selectedProgress.donePoints}</Var>
                            <span className="text-sm font-normal text-muted-foreground">
                              /<Var>{selectedProgress.totalPoints}</Var> pt
                            </span>
                          </T>
                        ) : (
                          <T>
                            <Var>{selectedProgress.doneItems}</Var>
                            <span className="text-sm font-normal text-muted-foreground">
                              /<Var>{selectedProgress.totalItems}</Var>
                            </span>
                          </T>
                        )}
                      </span>
                      <span
                        className={cn(
                          "font-mono text-xs font-semibold tabular-nums",
                          selectedProgress.totalItems > 0 &&
                            selectedProgress.pointsCompletionPct === 100
                            ? "text-success-foreground"
                            : "text-foreground/85",
                        )}
                      >
                        {selectedProgress.pointsCompletionPct}%
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <div
                        aria-hidden
                        className="h-1.5 w-full overflow-hidden rounded-full bg-muted/55"
                      >
                        {selectedProgress.pointsCompletionPct > 0 ? (
                          <div
                            className={cn(
                              "h-full rounded-full",
                              selectedProgress.pointsCompletionPct === 100
                                ? "bg-success"
                                : "bg-primary",
                            )}
                            style={{ width: `${selectedProgress.pointsCompletionPct}%` }}
                          />
                        ) : null}
                      </div>
                      <div className="text-2xs text-muted-foreground tabular-nums">
                        <T>
                          <Var>{selectedProgress.doneItems}</Var> of{" "}
                          <Var>{selectedProgress.totalItems}</Var> items done
                        </T>
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        <T>Capacity Health</T>
                      </span>
                      <div className="flex shrink-0 items-center gap-1.5">
                        <Badge
                          size="sm"
                          variant={scopeHealthBadgeVariant(selectedProgress.scopeHealth)}
                        >
                          {scopeHealthLabel(selectedProgress.scopeHealth, gt)}
                        </Badge>
                        <CockpitIconBadge
                          size="sm"
                          tone={scopeHealthIconTone(selectedProgress.scopeHealth)}
                        >
                          <GaugeIcon />
                        </CockpitIconBadge>
                      </div>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                        {selectedProgress.capacityPoints !== null ? (
                          <T>
                            <Var>{selectedProgress.totalPoints}</Var>
                            <span className="text-sm font-normal text-muted-foreground">
                              /<Var>{selectedProgress.capacityPoints}</Var> pt
                            </span>
                          </T>
                        ) : (
                          <span className="text-sm font-medium text-muted-foreground">
                            <T>No capacity cap</T>
                          </span>
                        )}
                      </span>
                      {selectedProgress.capacityUtilizationPct !== null ? (
                        <span
                          className={cn(
                            "font-mono text-xs font-semibold tabular-nums",
                            selectedProgress.scopeHealth === "overcommitted"
                              ? "text-destructive"
                              : selectedProgress.scopeHealth === "at_risk"
                                ? "text-warning-foreground"
                                : "text-success-foreground",
                          )}
                        >
                          {selectedProgress.capacityUtilizationPct}%
                        </span>
                      ) : null}
                    </div>

                    <div className="space-y-1.5">
                      <div
                        aria-hidden
                        className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted/55"
                      >
                        {capacityUtilizationClamped > 0 ? (
                          <div
                            className={cn(
                              "h-full rounded-full",
                              scopeHealthBarClass(selectedProgress.scopeHealth),
                            )}
                            style={{ width: `${capacityUtilizationClamped}%` }}
                          />
                        ) : null}
                        <span className="absolute inset-y-0 left-[85%] w-0.5 bg-foreground/50" />
                      </div>
                      <div className="text-2xs text-muted-foreground">
                        {selectedProgress.capacityPoints !== null ? (
                          <T>85% sweet-spot target keeps delivery predictable</T>
                        ) : (
                          <T>Edit cycle to configure a target point capacity</T>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex min-w-0 flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-xs font-medium text-muted-foreground">
                        <T>Historical Velocity</T>
                      </span>
                      <CockpitIconBadge
                        size="sm"
                        tone={
                          velocity.trend === "up"
                            ? "success"
                            : velocity.trend === "down"
                              ? "warning"
                              : "neutral"
                        }
                      >
                        {velocity.trend === "down" ? <TrendingDownIcon /> : <TrendingUpIcon />}
                      </CockpitIconBadge>
                    </div>

                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                        {velocity.completedCycles > 0 ? (
                          <T>
                            <Var>{velocity.averagePoints}</Var>{" "}
                            <span className="text-sm font-normal text-muted-foreground">pt</span>
                          </T>
                        ) : (
                          "--"
                        )}
                      </span>
                      {velocity.completedCycles > 0 ? (
                        <Badge
                          size="sm"
                          variant={
                            velocity.trend === "up"
                              ? "success"
                              : velocity.trend === "down"
                                ? "warning"
                                : "secondary"
                          }
                        >
                          {velocity.trend === "up" ? (
                            <>
                              <TrendingUpIcon />
                              <T>Rising</T>
                            </>
                          ) : velocity.trend === "down" ? (
                            <>
                              <TrendingDownIcon />
                              <T>Dipping</T>
                            </>
                          ) : velocity.trend === "steady" ? (
                            <>
                              <MinusIcon />
                              <T>Steady</T>
                            </>
                          ) : (
                            <T>Baseline</T>
                          )}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="text-2xs text-muted-foreground tabular-nums">
                      {velocity.completedCycles > 0 ? (
                        <T>
                          Latest: <Var>{velocity.latestPoints}</Var> pt across{" "}
                          <Plural
                            n={velocity.completedCycles}
                            one={
                              <>
                                <Var>{velocity.completedCycles}</Var> cycle
                              </>
                            }
                            other={
                              <>
                                <Var>{velocity.completedCycles}</Var> cycles
                              </>
                            }
                          />
                        </T>
                      ) : (
                        <T>Complete your first cycle to establish a velocity baseline</T>
                      )}
                    </div>
                  </div>
                </div>

                <CycleBurnupChart
                  cycle={selectedCycle}
                  progress={selectedProgress}
                  series={burnupSeries}
                />
              </div>
            </section>
          ) : null}
        </>
      )}

      <section aria-label={gt("Sprint planning and backlog grooming")}>
        <div className="grid items-start gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-2.5">
            <CockpitSectionHeader
              action={
                selectedCycle ? (
                  <div className="flex items-center gap-1.5">
                    {selectedProgress && selectedProgress.totalPoints > 0 ? (
                      <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                        <T>
                          <Var>{selectedProgress.totalPoints}</Var> pt
                        </T>
                      </span>
                    ) : null}
                    <Button
                      size="micro"
                      variant="ghost"
                      onClick={() => onOpenIntakeForCycle(selectedCycle.id)}
                    >
                      <PlusIcon />
                      <T>New</T>
                    </Button>
                  </div>
                ) : undefined
              }
              count={cycleCards.length}
              icon={<LayersIcon />}
              title={
                selectedCycle ? (
                  <T>
                    Cycle Scope · <Var>{selectedCycle.name}</Var>
                  </T>
                ) : (
                  <T>Cycle Scope</T>
                )
              }
            />

            <CockpitSurface divided variant="grouped">
              {!selectedCycle ? (
                <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                  <T>Start a cycle above to begin committing scope from your backlog.</T>
                </div>
              ) : cycleCards.length === 0 ? (
                <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
                  <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                    <T>
                      No work items are committed to <Var>{selectedCycle.name}</Var> yet. Pull ready
                      items from the Product Backlog or create a new item directly.
                    </T>
                  </p>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onOpenIntakeForCycle(selectedCycle.id)}
                  >
                    <PlusIcon />
                    <T>Add Item to Cycle</T>
                  </Button>
                </div>
              ) : (
                cycleCards.map((card) => {
                  const lifecycle = lifecycleByCardId.get(card.workItem.id);
                  const isDone = isWorkItemDoneStage(card.workItem.stage);
                  const stageLabel =
                    stageById.get(card.workItem.stage)?.label ?? card.workItem.stage;
                  const assignee = resolveCardAssignee(card, roster);
                  const milestone = lifecycle?.milestoneId
                    ? (milestoneById.get(lifecycle.milestoneId) ?? null)
                    : null;
                  const isItemBusy = busyWorkItemIds.includes(card.workItem.id);

                  return (
                    <CockpitSurfaceRow
                      key={card.workItem.id}
                      className="flex items-start gap-2.5"
                      density="compact"
                      interactive
                    >
                      <CockpitArtifactIcon
                        className={cn(
                          "mt-0.5 size-3.5 shrink-0",
                          workItemTypeIconClass(card.workItem.itemType),
                        )}
                        kind={card.workItem.itemType}
                      />

                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <CockpitPriorityDot priority={card.workItem.priority} />
                          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {card.workItem.code}
                          </span>
                          <button
                            className={cn(
                              "min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              isDone ? "text-muted-foreground line-through" : "text-foreground",
                            )}
                            type="button"
                            onClick={() => onOpenWorkItem(card.workItem.id)}
                          >
                            {card.workItem.title}
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge
                            size="sm"
                            variant={
                              isDone
                                ? "success"
                                : card.workItem.health === "blocked"
                                  ? "error"
                                  : "outline"
                            }
                          >
                            {stageLabel}
                          </Badge>

                          {milestone ? (
                            <span className="inline-flex max-w-40 items-center gap-1 truncate rounded-sm border border-border/50 bg-muted/25 px-1.5 py-0.5 text-2xs text-muted-foreground">
                              <CockpitStatusDot tone={milestoneToneDot(milestone)} />
                              <span className="truncate">{milestone.name}</span>
                            </span>
                          ) : null}

                          {assignee ? (
                            <Tooltip>
                              <TooltipTrigger
                                render={
                                  <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground" />
                                }
                              >
                                <CockpitSwarmAvatar
                                  displayName={assignee.displayName}
                                  handle={assignee.handle}
                                  kind={assignee.kind}
                                  size="sm"
                                />
                              </TooltipTrigger>
                              <TooltipPopup>{assignee.displayName}</TooltipPopup>
                            </Tooltip>
                          ) : null}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <StoryPointsPicker
                          disabled={isItemBusy}
                          points={lifecycle?.storyPoints ?? null}
                          onSelect={(nextPoints) => void handleUpdateStoryPoints(card, nextPoints)}
                        />

                        {canEditSelectedScope ? (
                          <Button
                            disabled={isItemBusy}
                            size="micro"
                            variant="ghost-muted"
                            onClick={() => void handleMoveToBacklog(card)}
                          >
                            <T>Move to Backlog</T>
                            <ArrowRightIcon />
                          </Button>
                        ) : null}
                      </div>
                    </CockpitSurfaceRow>
                  );
                })
              )}
            </CockpitSurface>
          </div>

          <div className="min-w-0 space-y-2.5">
            <CockpitSectionHeader
              action={
                <Button size="micro" variant="ghost" onClick={() => onOpenIntakeForCycle(null)}>
                  <PlusIcon />
                  <T>New Backlog Item</T>
                </Button>
              }
              count={filteredBacklogCards.length}
              icon={<InboxIcon />}
              title={<T>Product Backlog &amp; Refinement</T>}
            />

            <CockpitSurface className="overflow-hidden" variant="grouped">
              <div className="space-y-2 border-b border-border/50 bg-muted/15 px-3.5 py-2.5">
                <div className="flex items-center gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Input
                      aria-label={gt("Search backlog work items")}
                      placeholder={gt("Filter backlog by title, code, or milestone...")}
                      size="compact"
                      type="search"
                      value={backlogSearch}
                      onChange={(event) => setBacklogSearch(event.target.value)}
                    />
                  </div>
                  {backlogSearch ? (
                    <Button
                      aria-label={gt("Clear search")}
                      size="icon-xs"
                      variant="ghost-muted"
                      onClick={() => setBacklogSearch("")}
                    >
                      <XIcon />
                    </Button>
                  ) : (
                    <SearchIcon
                      aria-hidden
                      className="size-3.5 shrink-0 text-muted-foreground/60"
                    />
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {(
                    [
                      { key: "all", label: gt("All", { $context: "backlog filter" }) },
                      { key: "p0", label: "P0" },
                      { key: "p1", label: "P1" },
                      {
                        key: "unestimated",
                        label: gt("Unestimated", { $context: "backlog filter" }),
                      },
                    ] as const
                  ).map((option) => {
                    const active = backlogQuickFilter === option.key;
                    return (
                      <button
                        key={option.key}
                        aria-pressed={active}
                        className={cn(
                          "inline-flex h-6 cursor-pointer items-center rounded-md border px-2 text-2xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          active
                            ? "border-border bg-accent text-foreground"
                            : "border-border/45 bg-background/60 text-muted-foreground hover:border-border/75 hover:text-foreground",
                        )}
                        type="button"
                        onClick={() => setBacklogQuickFilter(option.key)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="divide-y divide-border/50">
                {allBacklogCards.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-muted-foreground">
                    <T>
                      Product backlog is completely triaged. Every open item is already scheduled in
                      a cycle.
                    </T>
                  </div>
                ) : filteredBacklogCards.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 px-4 py-8 text-center text-xs text-muted-foreground">
                    <p>
                      <T>No backlog items match your current filter.</T>
                    </p>
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => {
                        setBacklogSearch("");
                        setBacklogQuickFilter("all");
                      }}
                    >
                      <T>Reset Filter</T>
                    </Button>
                  </div>
                ) : (
                  filteredBacklogCards.map((card) => {
                    const lifecycle = lifecycleByCardId.get(card.workItem.id);
                    const stageLabel =
                      stageById.get(card.workItem.stage)?.label ?? card.workItem.stage;
                    const milestone = lifecycle?.milestoneId
                      ? (milestoneById.get(lifecycle.milestoneId) ?? null)
                      : null;
                    const assignee = resolveCardAssignee(card, roster);
                    const isItemBusy = busyWorkItemIds.includes(card.workItem.id);

                    return (
                      <CockpitSurfaceRow
                        key={card.workItem.id}
                        className="flex items-start gap-2.5"
                        density="compact"
                        interactive
                      >
                        <CockpitArtifactIcon
                          className={cn(
                            "mt-0.5 size-3.5 shrink-0",
                            workItemTypeIconClass(card.workItem.itemType),
                          )}
                          kind={card.workItem.itemType}
                        />

                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <CockpitPriorityDot priority={card.workItem.priority} />
                            <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                              {card.workItem.code}
                            </span>
                            <button
                              className="min-w-0 flex-1 cursor-pointer truncate text-left text-xs font-medium text-foreground transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              type="button"
                              onClick={() => onOpenWorkItem(card.workItem.id)}
                            >
                              {card.workItem.title}
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <Badge size="sm" variant="outline">
                              {stageLabel}
                            </Badge>

                            {milestone ? (
                              <span className="inline-flex max-w-44 items-center gap-1 truncate rounded-sm border border-border/50 bg-muted/25 px-1.5 py-0.5 text-2xs text-muted-foreground">
                                <FlagIcon aria-hidden className="size-2.5 shrink-0 text-primary" />
                                <span className="truncate">{milestone.name}</span>
                              </span>
                            ) : null}

                            {assignee ? (
                              <Tooltip>
                                <TooltipTrigger
                                  render={<span className="inline-flex items-center" />}
                                >
                                  <CockpitSwarmAvatar
                                    displayName={assignee.displayName}
                                    handle={assignee.handle}
                                    kind={assignee.kind}
                                    size="sm"
                                  />
                                </TooltipTrigger>
                                <TooltipPopup>{assignee.displayName}</TooltipPopup>
                              </Tooltip>
                            ) : null}
                          </div>
                        </div>

                        <div className="flex shrink-0 items-center gap-1.5">
                          <StoryPointsPicker
                            disabled={isItemBusy}
                            points={lifecycle?.storyPoints ?? null}
                            onSelect={(nextPoints) =>
                              void handleUpdateStoryPoints(card, nextPoints)
                            }
                          />

                          {canEditSelectedScope ? (
                            <Button
                              disabled={isItemBusy}
                              size="micro"
                              variant="outline"
                              onClick={() => void handleAddToCycle(card)}
                            >
                              <PlusIcon />
                              <T>Add to Cycle</T>
                            </Button>
                          ) : null}
                        </div>
                      </CockpitSurfaceRow>
                    );
                  })
                )}
              </div>
            </CockpitSurface>
          </div>
        </div>
      </section>

      <Dialog
        open={cycleDialogMode !== null}
        onOpenChange={(open) => {
          if (!open) setCycleDialogMode(null);
        }}
      >
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3 pr-8">
              <CockpitIconBadge className="mt-0.5 shrink-0" size="lg" tone="primary">
                <CalendarRangeIcon />
              </CockpitIconBadge>
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>
                  {cycleDialogMode === "edit" ? <T>Edit Cycle</T> : <T>Create Agile Cycle</T>}
                </DialogTitle>
                <DialogDescription>
                  <T>
                    Define the cycle window, sprint goal, and target point capacity for{" "}
                    <Var>{project.name}</Var>.
                  </T>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogPanel>
            <div className="space-y-4">
              <div>
                <CockpitFieldLabel htmlFor="cycle-name">
                  <T>Cycle Name</T>
                </CockpitFieldLabel>
                <Input
                  id="cycle-name"
                  placeholder={gt("e.g. Cycle 1")}
                  value={draftName}
                  onChange={(event) => setDraftName(event.target.value)}
                />
              </div>

              <div>
                <CockpitFieldLabel htmlFor="cycle-goal">
                  <T>Sprint Goal</T>
                </CockpitFieldLabel>
                <Textarea
                  id="cycle-goal"
                  placeholder={gt("What key user outcome should ship by the end of this cycle?")}
                  rows={2}
                  value={draftGoal}
                  onChange={(event) => setDraftGoal(event.target.value)}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <CockpitFieldLabel htmlFor="cycle-start">
                    <T>Start Date</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cycle-start"
                    type="date"
                    value={draftStartDate}
                    onChange={(event) => setDraftStartDate(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="cycle-end">
                    <T>End Date</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cycle-end"
                    type="date"
                    value={draftEndDate}
                    onChange={(event) => setDraftEndDate(event.target.value)}
                  />
                </div>
              </div>

              {isDateRangeInvalid ? (
                <CockpitInlineAlert tone="warning">
                  <T>End date must be on or after the start date.</T>
                </CockpitInlineAlert>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <CockpitFieldLabel htmlFor="cycle-capacity">
                    <T>Target Capacity (Points)</T>
                  </CockpitFieldLabel>
                  <Input
                    font="mono"
                    id="cycle-capacity"
                    max={500}
                    min={1}
                    placeholder={gt("e.g. 20")}
                    type="number"
                    value={draftCapacity}
                    onChange={(event) => setDraftCapacity(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="cycle-status">
                    <T>Status</T>
                  </CockpitFieldLabel>
                  <Select
                    value={draftStatus}
                    onValueChange={(value) => {
                      if (value === "upcoming" || value === "active" || value === "completed") {
                        setDraftStatus(value);
                      }
                    }}
                  >
                    <SelectTrigger id="cycle-status" size="sm">
                      <SelectValue>
                        <span className="inline-flex items-center gap-1.5">
                          <CockpitStatusDot tone={cycleStatusTone(draftStatus)} />
                          <span>{cycleStatusLabel(draftStatus, gt)}</span>
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="upcoming">
                        <span className="inline-flex items-center gap-1.5">
                          <CockpitStatusDot tone="info" />
                          <span>{cycleStatusLabel("upcoming", gt)}</span>
                        </span>
                      </SelectItem>
                      <SelectItem value="active">
                        <span className="inline-flex items-center gap-1.5">
                          <CockpitStatusDot tone="success" />
                          <span>{cycleStatusLabel("active", gt)}</span>
                        </span>
                      </SelectItem>
                      {cycleDialogMode === "edit" && draftStatus === "completed" ? (
                        <SelectItem value="completed">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitStatusDot tone="neutral" />
                            <span>{cycleStatusLabel("completed", gt)}</span>
                          </span>
                        </SelectItem>
                      ) : null}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              disabled={
                savingPlanning ||
                !draftName.trim() ||
                !draftStartDate ||
                !draftEndDate ||
                isDateRangeInvalid
              }
              onClick={() => void handleSaveCycleDialog()}
            >
              {savingPlanning ? (
                <T>Saving...</T>
              ) : cycleDialogMode === "edit" ? (
                <T>Save Changes</T>
              ) : (
                <T>Create Cycle</T>
              )}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog open={completeDialogOpen} onOpenChange={setCompleteDialogOpen}>
        <DialogPopup className="max-w-lg">
          <DialogHeader>
            <div className="flex items-start gap-3 pr-8">
              <CockpitIconBadge className="mt-0.5 shrink-0" size="lg" tone="success">
                <CheckCircle2Icon />
              </CockpitIconBadge>
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>
                  {selectedCycle ? (
                    <T>
                      Complete <Var>{selectedCycle.name}</Var>
                    </T>
                  ) : (
                    <T>Complete Cycle</T>
                  )}
                </DialogTitle>
                <DialogDescription>
                  <T>
                    Lock in delivered velocity and decide where any unfinished work items should
                    move next.
                  </T>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          {selectedCycle && selectedProgress ? (
            <DialogPanel>
              <div className="space-y-4">
                <CockpitSurface padding="sm" variant="subtle">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-0.5">
                      <div className="text-2xs font-medium text-muted-foreground">
                        <T>Completed</T>
                      </div>
                      <div className="font-mono text-sm font-semibold text-success-foreground tabular-nums">
                        <T>
                          <Plural
                            n={selectedProgress.doneItems}
                            one={
                              <>
                                <Var>{selectedProgress.doneItems}</Var> item
                              </>
                            }
                            other={
                              <>
                                <Var>{selectedProgress.doneItems}</Var> items
                              </>
                            }
                          />{" "}
                          · <Var>{selectedProgress.donePoints}</Var> pt
                        </T>
                      </div>
                    </div>

                    <div className="space-y-0.5">
                      <div className="text-2xs font-medium text-muted-foreground">
                        <T>Unfinished</T>
                      </div>
                      <div
                        className={cn(
                          "font-mono text-sm font-semibold tabular-nums",
                          unfinishedCycleCards.length > 0
                            ? "text-warning-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        <T>
                          <Plural
                            n={unfinishedCycleCards.length}
                            one={
                              <>
                                <Var>{unfinishedCycleCards.length}</Var> item
                              </>
                            }
                            other={
                              <>
                                <Var>{unfinishedCycleCards.length}</Var> items
                              </>
                            }
                          />{" "}
                          · <Var>{unfinishedPoints}</Var> pt
                        </T>
                      </div>
                    </div>
                  </div>
                </CockpitSurface>

                {unfinishedCycleCards.length === 0 ? (
                  <CockpitInlineAlert tone="info">
                    <T>
                      Every item in <Var>{selectedCycle.name}</Var> is complete. Completing this
                      cycle will record <Var>{selectedProgress.donePoints}</Var> delivered points in
                      your team velocity history.
                    </T>
                  </CockpitInlineAlert>
                ) : (
                  <div className="space-y-3">
                    <div className="text-xs font-medium text-foreground">
                      <T>Carry-over destination</T>
                    </div>

                    <div className="space-y-2">
                      <button
                        aria-pressed={carryOverMode === "next_cycle"}
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          carryOverMode === "next_cycle"
                            ? "border-primary/45 bg-primary/8"
                            : "border-border/55 bg-background/60 hover:border-border hover:bg-accent/35",
                        )}
                        type="button"
                        onClick={() => setCarryOverMode("next_cycle")}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                            carryOverMode === "next_cycle"
                              ? "border-primary bg-primary"
                              : "border-border bg-background",
                          )}
                        >
                          {carryOverMode === "next_cycle" ? (
                            <span className="size-1.5 rounded-full bg-primary-foreground" />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="text-xs font-medium text-foreground">
                            <T>Carry unfinished items to Next Cycle</T>
                          </div>
                          <div className="text-2xs leading-relaxed text-muted-foreground">
                            {nextUpcomingCycle ? (
                              <T>
                                Moves unfinished items into <Var>{nextUpcomingCycle.name}</Var> (
                                <Var>
                                  {formatCycleDateRange(
                                    nextUpcomingCycle.startDate,
                                    nextUpcomingCycle.endDate,
                                  )}
                                </Var>
                                ).
                              </T>
                            ) : (
                              <T>
                                Auto-creates <Var>{nextCycleDraft.name}</Var> (
                                <Var>
                                  {formatCycleDateRange(
                                    nextCycleDraft.startDate,
                                    nextCycleDraft.endDate,
                                  )}
                                </Var>
                                ) and carries unfinished items forward.
                              </T>
                            )}
                          </div>
                        </div>
                      </button>

                      <button
                        aria-pressed={carryOverMode === "backlog"}
                        className={cn(
                          "flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                          carryOverMode === "backlog"
                            ? "border-primary/45 bg-primary/8"
                            : "border-border/55 bg-background/60 hover:border-border hover:bg-accent/35",
                        )}
                        type="button"
                        onClick={() => setCarryOverMode("backlog")}
                      >
                        <span
                          aria-hidden
                          className={cn(
                            "mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border",
                            carryOverMode === "backlog"
                              ? "border-primary bg-primary"
                              : "border-border bg-background",
                          )}
                        >
                          {carryOverMode === "backlog" ? (
                            <span className="size-1.5 rounded-full bg-primary-foreground" />
                          ) : null}
                        </span>
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <div className="text-xs font-medium text-foreground">
                            <T>Return unfinished items to Product Backlog</T>
                          </div>
                          <div className="text-2xs leading-relaxed text-muted-foreground">
                            <T>
                              Clears their cycle assignment so they return to the backlog for
                              re-prioritization.
                            </T>
                          </div>
                        </div>
                      </button>
                    </div>

                    <CockpitSurface divided variant="subtle">
                      {unfinishedCycleCards.slice(0, 5).map((card) => (
                        <div
                          key={card.workItem.id}
                          className="flex items-center gap-2 px-3 py-2 text-xs"
                        >
                          <CockpitPriorityDot priority={card.workItem.priority} showLabel={false} />
                          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {card.workItem.code}
                          </span>
                          <span className="min-w-0 flex-1 truncate text-foreground">
                            {card.workItem.title}
                          </span>
                        </div>
                      ))}
                      {unfinishedCycleCards.length > 5 ? (
                        <div className="px-3 py-1.5 text-2xs text-muted-foreground">
                          <T>
                            +<Var>{unfinishedCycleCards.length - 5}</Var> more unfinished items
                          </T>
                        </div>
                      ) : null}
                    </CockpitSurface>
                  </div>
                )}
              </div>
            </DialogPanel>
          ) : null}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              disabled={completingCycle || !selectedCycle}
              onClick={() => void handleCompleteCycle()}
            >
              {completingCycle ? <T>Completing...</T> : <T>Complete Cycle</T>}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
