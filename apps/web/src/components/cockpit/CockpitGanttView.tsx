import {
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveWorkItemSchedule,
  type CockpitWorkItemCard,
  type PipelinePhase,
  type ReleaseCard,
  type ReleaseStatus,
  type WorkItemType,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { cn } from "~/lib/utils";
import { CockpitArtifactIcon, CockpitIllustration } from "./CockpitArtwork";
import { CockpitSurface } from "./CockpitPrimitives";
import {
  CockpitSwarmAvatar,
  isWorkItemDoneStage,
  type CockpitTeamMember,
} from "./CockpitSwarmAvatar";

export type GanttZoomLevel = "2w" | "1m" | "3m";
export type GanttGroupBy = "all" | "stage" | "assignee";

export interface CockpitGanttViewProps {
  readonly cards: readonly CockpitWorkItemCard[];
  readonly releases: readonly ReleaseCard[];
  readonly roster: readonly CockpitTeamMember[];
  readonly stages: readonly { readonly id: string; readonly label: string }[];
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onUpdateSchedule: (
    workItemId: string,
    plannedStartAt: string,
    dueAt: string,
  ) => Promise<void>;
  readonly onCreateItem?: (() => void) | undefined;
}

export interface GanttTimelineColumn {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string;
  readonly startOffsetPct: number;
  readonly widthPct: number;
  readonly isToday: boolean;
  readonly isWeekend: boolean;
}

export interface GanttTimelineRow {
  readonly card: CockpitWorkItemCard;
  readonly startDate: string;
  readonly dueDate: string;
  readonly isEstimated: boolean;
  readonly isOverdue: boolean;
  readonly leftPct: number;
  readonly widthPct: number;
  readonly progressPct: number;
  readonly assignee: CockpitTeamMember | null;
}

export interface GanttReleaseMarker {
  readonly releaseId: string;
  readonly versionLabel: string;
  readonly status: ReleaseStatus;
  readonly date: string;
  readonly offsetPct: number;
}

export interface GanttTimelineModel {
  readonly startDay: string;
  readonly endDay: string;
  readonly totalDays: number;
  readonly columns: readonly GanttTimelineColumn[];
  readonly todayOffsetPct: number;
  readonly rows: readonly GanttTimelineRow[];
  readonly releaseMarkers: readonly GanttReleaseMarker[];
}

const MS_PER_DAY = 86_400_000;
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
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

const PHASE_PROGRESS_PCT: Record<PipelinePhase, number> = {
  intake: 10,
  prd: 25,
  prototype: 40,
  dev: 60,
  review: 80,
  release: 92,
  done: 100,
};

function parseIsoParts(value: string | null | undefined): [number, number, number] | null {
  if (!value) return null;
  const match = ISO_DATE_PREFIX.exec(value.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return [year, month, day];
}

function formatUtcIsoParts(year: number, month: number, day: number): string {
  const y = String(year).padStart(4, "0");
  const m = String(month).padStart(2, "0");
  const d = String(day).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function toUtcDayMs(isoDate: string): number {
  const parts = parseIsoParts(isoDate);
  if (!parts) return Date.UTC(1970, 0, 1);
  return Date.UTC(parts[0], parts[1] - 1, parts[2]);
}

function formatUtcDateFromMs(ms: number): string {
  const date = new Date(ms);
  return formatUtcIsoParts(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

function normalizeIsoDate(value: string | null | undefined): string | null {
  const parts = parseIsoParts(value);
  if (!parts) return null;
  return formatUtcDateFromMs(Date.UTC(parts[0], parts[1] - 1, parts[2]));
}

export function shiftIsoDate(isoDate: string, deltaDays: number): string {
  const parts = parseIsoParts(isoDate);
  if (!parts) return isoDate;
  const shifted = Date.UTC(parts[0], parts[1] - 1, parts[2] + Math.trunc(deltaDays));
  return formatUtcDateFromMs(shifted);
}

function diffIsoDays(startIso: string, endIso: string): number {
  return Math.round((toUtcDayMs(endIso) - toUtcDayMs(startIso)) / MS_PER_DAY);
}

function utcDayOfWeek(isoDate: string): number {
  return new Date(toUtcDayMs(isoDate)).getUTCDay();
}

function startOfIsoWeek(isoDate: string): string {
  const dow = utcDayOfWeek(isoDate);
  const deltaToMonday = dow === 0 ? -6 : 1 - dow;
  return shiftIsoDate(isoDate, deltaToMonday);
}

function getIsoWeekNumber(isoDate: string): number {
  const date = new Date(toUtcDayMs(isoDate));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return Math.ceil(((date.getTime() - yearStart) / MS_PER_DAY + 1) / 7);
}

function formatMonthDay(isoDate: string): string {
  const parts = parseIsoParts(isoDate);
  if (!parts) return isoDate;
  const monthLabel = MONTH_SHORT[parts[1] - 1] ?? "Jan";
  return `${monthLabel} ${String(parts[2]).padStart(2, "0")}`;
}

function formatShortMonthDay(isoDate: string): string {
  const parts = parseIsoParts(isoDate);
  if (!parts) return isoDate;
  const monthLabel = MONTH_SHORT[parts[1] - 1] ?? "Jan";
  return `${monthLabel} ${parts[2]}`;
}

function resolveRowAssignee(
  card: CockpitWorkItemCard,
  roster: readonly CockpitTeamMember[],
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

function computeRowProgressPct(card: CockpitWorkItemCard): number {
  if (isWorkItemDoneStage(card.workItem.stage)) return 100;
  if (card.checklistTotalCount > 0) {
    return Math.max(
      0,
      Math.min(100, Math.round((card.checklistVerifiedCount / card.checklistTotalCount) * 100)),
    );
  }
  const phase = deriveWorkItemPipelinePhase(card);
  return PHASE_PROGRESS_PCT[phase];
}

function resolveReleaseDate(
  releaseCard: ReleaseCard,
  dueDateByWorkItemId: ReadonlyMap<string, string>,
): string | null {
  const releasedDay = normalizeIsoDate(releaseCard.release.releasedAt);
  if (releasedDay) return releasedDay;

  let latestItemDue: string | null = null;
  for (const workItemId of releaseCard.workItemIds) {
    const due = dueDateByWorkItemId.get(workItemId);
    if (due && (!latestItemDue || due > latestItemDue)) {
      latestItemDue = due;
    }
  }
  if (latestItemDue) return latestItemDue;

  return (
    normalizeIsoDate(releaseCard.release.updatedAt) ??
    normalizeIsoDate(releaseCard.release.createdAt)
  );
}

export function buildGanttTimeline(
  cards: readonly CockpitWorkItemCard[],
  releases: readonly ReleaseCard[],
  zoom: GanttZoomLevel,
  todayIso?: string,
  roster: readonly CockpitTeamMember[] = [],
): GanttTimelineModel {
  const today = normalizeIsoDate(todayIso) ?? formatUtcDateFromMs(Date.now());

  const resolvedCards = cards.map((card) => {
    const schedule = resolveWorkItemSchedule(card.workItem, today);
    const startDate = normalizeIsoDate(schedule.startDate) ?? today;
    const rawDue = normalizeIsoDate(schedule.dueDate) ?? startDate;
    const dueDate = rawDue < startDate ? startDate : rawDue;
    return {
      card,
      startDate,
      dueDate,
      isEstimated: schedule.isEstimated,
      isOverdue: schedule.isOverdue,
    };
  });

  const dueDateByWorkItemId = new Map<string, string>();
  for (const entry of resolvedCards) {
    dueDateByWorkItemId.set(entry.card.workItem.id, entry.dueDate);
  }

  const resolvedReleases = releases
    .map((releaseCard) => ({
      releaseCard,
      date: resolveReleaseDate(releaseCard, dueDateByWorkItemId),
    }))
    .filter((entry): entry is { releaseCard: ReleaseCard; date: string } => entry.date !== null);

  let startDay: string;
  let endDay: string;

  if (zoom === "2w") {
    startDay = shiftIsoDate(today, -3);
    endDay = shiftIsoDate(today, 10);
  } else if (zoom === "1m") {
    startDay = shiftIsoDate(today, -5);
    endDay = shiftIsoDate(today, 24);
  } else {
    startDay = startOfIsoWeek(shiftIsoDate(today, -14));
    endDay = shiftIsoDate(startDay, 90);
  }

  const maxExpandDays = zoom === "2w" ? 45 : zoom === "1m" ? 75 : 180;
  const paddingDays = zoom === "3m" ? 7 : 1;

  for (const entry of resolvedCards) {
    if (entry.startDate < startDay && diffIsoDays(entry.startDate, today) <= maxExpandDays) {
      startDay = shiftIsoDate(entry.startDate, -paddingDays);
    }
    if (entry.dueDate > endDay && diffIsoDays(today, entry.dueDate) <= maxExpandDays) {
      endDay = shiftIsoDate(entry.dueDate, paddingDays);
    }
  }

  for (const entry of resolvedReleases) {
    if (entry.date < startDay && diffIsoDays(entry.date, today) <= maxExpandDays) {
      startDay = shiftIsoDate(entry.date, -paddingDays);
    }
    if (entry.date > endDay && diffIsoDays(today, entry.date) <= maxExpandDays) {
      endDay = shiftIsoDate(entry.date, paddingDays);
    }
  }

  if (zoom === "3m") {
    startDay = startOfIsoWeek(startDay);
    const span = diffIsoDays(startDay, endDay) + 1;
    const remainder = span % 7;
    if (remainder !== 0) {
      endDay = shiftIsoDate(endDay, 7 - remainder);
    }
  }

  const totalDays = Math.max(1, diffIsoDays(startDay, endDay) + 1);
  const columns: GanttTimelineColumn[] = [];

  if (zoom === "3m") {
    for (let offset = 0; offset < totalDays; offset += 7) {
      const weekStart = shiftIsoDate(startDay, offset);
      const spanDays = Math.min(7, totalDays - offset);
      const weekEnd = shiftIsoDate(weekStart, spanDays - 1);
      columns.push({
        key: weekStart,
        label: `W${getIsoWeekNumber(weekStart)}`,
        sublabel: formatShortMonthDay(weekStart),
        startOffsetPct: (offset / totalDays) * 100,
        widthPct: (spanDays / totalDays) * 100,
        isToday: today >= weekStart && today <= weekEnd,
        isWeekend: false,
      });
    }
  } else {
    for (let offset = 0; offset < totalDays; offset += 1) {
      const day = shiftIsoDate(startDay, offset);
      const dow = utcDayOfWeek(day);
      const parts = parseIsoParts(day);
      const dayOfMonth = parts?.[2] ?? 1;
      const monthName = MONTH_SHORT[(parts?.[1] ?? 1) - 1] ?? "Jan";
      const label =
        zoom === "2w"
          ? formatShortMonthDay(day)
          : offset === 0 || dayOfMonth === 1
            ? `${monthName} ${dayOfMonth}`
            : String(dayOfMonth);
      const sublabel = WEEKDAY_SHORT[dow] ?? "";
      columns.push({
        key: day,
        label,
        sublabel,
        startOffsetPct: (offset / totalDays) * 100,
        widthPct: (1 / totalDays) * 100,
        isToday: day === today,
        isWeekend: dow === 0 || dow === 6,
      });
    }
  }

  const todayOffsetDays = diffIsoDays(startDay, today);
  const todayOffsetPct = Math.max(0, Math.min(100, ((todayOffsetDays + 0.5) / totalDays) * 100));

  const rows: GanttTimelineRow[] = resolvedCards.map((entry) => {
    const startOffset = diffIsoDays(startDay, entry.startDate);
    const durationDays = Math.max(1, diffIsoDays(entry.startDate, entry.dueDate) + 1);
    const rawLeft = (startOffset / totalDays) * 100;
    const rawRight = ((startOffset + durationDays) / totalDays) * 100;
    const clippedLeft = Math.max(0, Math.min(100, rawLeft));
    const clippedRight = Math.max(clippedLeft, Math.min(100, rawRight));
    const minWidthPct = Math.min(100 - clippedLeft, (1 / totalDays) * 100);
    const widthPct = Math.max(clippedRight - clippedLeft, minWidthPct);

    return {
      card: entry.card,
      startDate: entry.startDate,
      dueDate: entry.dueDate,
      isEstimated: entry.isEstimated,
      isOverdue: entry.isOverdue,
      leftPct: clippedLeft,
      widthPct,
      progressPct: computeRowProgressPct(entry.card),
      assignee: resolveRowAssignee(entry.card, roster),
    };
  });

  const releaseMarkers: GanttReleaseMarker[] = [];
  for (const entry of resolvedReleases) {
    const offsetDays = diffIsoDays(startDay, entry.date);
    if (offsetDays < 0 || offsetDays >= totalDays) continue;
    releaseMarkers.push({
      releaseId: entry.releaseCard.release.id,
      versionLabel: entry.releaseCard.release.versionLabel,
      status: entry.releaseCard.release.status,
      date: entry.date,
      offsetPct: ((offsetDays + 0.5) / totalDays) * 100,
    });
  }

  return {
    startDay,
    endDay,
    totalDays,
    columns,
    todayOffsetPct,
    rows,
    releaseMarkers,
  };
}

interface GanttRowGroup {
  readonly key: string;
  readonly label: string | null;
  readonly assignee: CockpitTeamMember | null;
  readonly rows: readonly GanttTimelineRow[];
}

function getBarVisualClasses(row: GanttTimelineRow): {
  readonly track: string;
  readonly fill: string;
} {
  const { card } = row;
  if (isWorkItemDoneStage(card.workItem.stage)) {
    return {
      track: "border-success/30 bg-success/10 text-success-foreground",
      fill: "bg-success/25",
    };
  }
  if (card.workItem.health === "blocked") {
    return {
      track: "border-destructive/45 bg-destructive/12 text-destructive",
      fill: "bg-destructive/28",
    };
  }
  if (card.workItem.health === "at_risk") {
    return {
      track: "border-warning/45 bg-warning/12 text-warning-foreground",
      fill: "bg-warning/28",
    };
  }
  const phase = deriveWorkItemPipelinePhase(card);
  if (phase === "review") {
    return {
      track: "border-info/45 bg-info/12 text-info-foreground",
      fill: "bg-info/28",
    };
  }
  return {
    track: "border-success/40 bg-success/12 text-foreground",
    fill: "bg-success/28",
  };
}

function workItemTypeIconClass(itemType: WorkItemType): string {
  switch (itemType) {
    case "feature":
      return "text-primary";
    case "bug":
      return "text-destructive";
    case "security":
      return "text-warning-foreground";
    case "refactor":
      return "text-info-foreground";
    case "chore":
      return "text-muted-foreground";
  }
}

function workItemTypeLabel(itemType: WorkItemType, gt: ReturnType<typeof useGT>): string {
  switch (itemType) {
    case "feature":
      return gt("Feature");
    case "refactor":
      return gt("Refactor");
    case "bug":
      return gt("Bug");
    case "chore":
      return gt("Chore");
    case "security":
      return gt("Security");
  }
}

export function CockpitGanttView({
  cards,
  releases,
  roster,
  stages,
  onOpenWorkItem,
  onUpdateSchedule,
  onCreateItem,
}: CockpitGanttViewProps) {
  const gt = useGT();
  const [zoom, setZoom] = useState<GanttZoomLevel>("1m");
  const [groupBy, setGroupBy] = useState<GanttGroupBy>("all");
  const [savingWorkItemId, setSavingWorkItemId] = useState<string | null>(null);

  if (cards.length === 0) {
    return (
      <CockpitSurface variant="grouped">
        <Empty size="compact">
          <EmptyMedia>
            <CockpitIllustration kind="empty_gantt" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>No scheduled work items yet</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>
                Add a requirement with planned start and due dates to track delivery timelines and
                release milestones.
              </T>
            </EmptyDescription>
          </EmptyHeader>
          {onCreateItem ? (
            <EmptyContent>
              <Button size="sm" variant="default" onClick={onCreateItem}>
                <PlusIcon />
                <T>New Requirement</T>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      </CockpitSurface>
    );
  }

  const timeline = buildGanttTimeline(cards, releases, zoom, undefined, roster);
  const stageLabelById = new Map(stages.map((stage) => [stage.id, stage.label]));
  const overdueCount = timeline.rows.filter((row) => row.isOverdue).length;

  const groups: GanttRowGroup[] = [];
  if (groupBy === "all") {
    groups.push({ key: "all", label: null, assignee: null, rows: timeline.rows });
  } else if (groupBy === "stage") {
    const byStage = new Map<string, GanttTimelineRow[]>();
    for (const stage of stages) {
      byStage.set(stage.id, []);
    }
    for (const row of timeline.rows) {
      const stageId = row.card.workItem.stage;
      const list = byStage.get(stageId);
      if (list) {
        list.push(row);
      } else {
        byStage.set(stageId, [row]);
      }
    }
    for (const [stageId, stageRows] of byStage.entries()) {
      if (stageRows.length === 0) continue;
      groups.push({
        key: `stage:${stageId}`,
        label: stageLabelById.get(stageId) ?? stageId,
        assignee: null,
        rows: stageRows,
      });
    }
  } else {
    const byAssignee = new Map<
      string,
      { assignee: CockpitTeamMember | null; rows: GanttTimelineRow[] }
    >();
    for (const row of timeline.rows) {
      const key = row.assignee ? `member:${row.assignee.handle}` : "unassigned";
      const existing = byAssignee.get(key);
      if (existing) {
        existing.rows.push(row);
      } else {
        byAssignee.set(key, { assignee: row.assignee, rows: [row] });
      }
    }
    for (const [key, entry] of byAssignee.entries()) {
      groups.push({
        key,
        label: entry.assignee ? `@${entry.assignee.handle}` : gt("Unassigned"),
        assignee: entry.assignee,
        rows: entry.rows,
      });
    }
  }

  const timelineMinWidthPx =
    zoom === "2w"
      ? Math.max(760, timeline.totalDays * 56)
      : zoom === "1m"
        ? Math.max(900, timeline.totalDays * 34)
        : Math.max(840, timeline.columns.length * 76);

  const handleShiftRow = async (row: GanttTimelineRow, deltaDays: number) => {
    if (savingWorkItemId === row.card.workItem.id) return;
    const nextStart = shiftIsoDate(row.startDate, deltaDays);
    const nextDue = shiftIsoDate(row.dueDate, deltaDays);
    setSavingWorkItemId(row.card.workItem.id);
    await onUpdateSchedule(row.card.workItem.id, nextStart, nextDue).catch(() => undefined);
    setSavingWorkItemId((current) => (current === row.card.workItem.id ? null : current));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            aria-label={gt("Timeline zoom")}
            size="segmented"
            value={[zoom]}
            variant="segmented"
            onValueChange={(next) => {
              const value = next[0];
              if (value === "2w" || value === "1m" || value === "3m") {
                setZoom(value);
              }
            }}
          >
            <Toggle value="2w">
              <T>2 Weeks</T>
            </Toggle>
            <Toggle value="1m">
              <T>Month</T>
            </Toggle>
            <Toggle value="3m">
              <T>Quarter</T>
            </Toggle>
          </ToggleGroup>

          <ToggleGroup
            aria-label={gt("Group timeline rows")}
            size="segmented"
            value={[groupBy]}
            variant="segmented"
            onValueChange={(next) => {
              const value = next[0];
              if (value === "all" || value === "stage" || value === "assignee") {
                setGroupBy(value);
              }
            }}
          >
            <Toggle value="all">
              <T>All</T>
            </Toggle>
            <Toggle value="stage">
              <T>Stage</T>
            </Toggle>
            <Toggle value="assignee">
              <T>Assignee</T>
            </Toggle>
          </ToggleGroup>
        </div>

        <div className="flex flex-wrap items-center gap-3 text-2xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-xs bg-success/75" />
            <T>On track</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-xs bg-info/75" />
            <T>Review</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rounded-xs bg-destructive/80" />
            <T>Blocked</T>
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="inline-block size-2 rotate-45 rounded-xs bg-primary" />
            <T>Release milestone</T>
          </span>
          {onCreateItem ? (
            <Button size="xs" variant="outline" onClick={onCreateItem}>
              <PlusIcon />
              <T>New Requirement</T>
            </Button>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-border/55 bg-card/30">
        <div className="overflow-x-auto">
          <div style={{ minWidth: `${timelineMinWidthPx + 264}px` }}>
            <div className="flex h-12 border-b border-border/55 bg-muted/15">
              <div className="sticky left-0 z-20 flex w-[264px] shrink-0 items-center justify-between gap-2 border-r border-border/55 bg-card/95 px-3.5 text-xs">
                <div className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <T>Work Item</T>
                  <span className="font-mono text-2xs tabular-nums text-muted-foreground/70">
                    {timeline.rows.length}
                  </span>
                </div>
                {overdueCount > 0 ? (
                  <span className="font-mono text-2xs tabular-nums text-destructive">
                    <T>
                      <Var>{overdueCount}</Var> overdue
                    </T>
                  </span>
                ) : null}
              </div>

              <div className="relative flex-1" style={{ minWidth: `${timelineMinWidthPx}px` }}>
                {timeline.columns.map((column) => (
                  <div
                    key={column.key}
                    className={cn(
                      "absolute inset-y-0 flex flex-col justify-center border-r border-border/30 px-1.5",
                      column.isToday && "bg-primary/8",
                      column.isWeekend && !column.isToday && "bg-muted/20",
                    )}
                    style={{
                      left: `${column.startOffsetPct}%`,
                      width: `${column.widthPct}%`,
                    }}
                  >
                    <span
                      className={cn(
                        "truncate font-mono text-3xs leading-tight tabular-nums",
                        column.isToday ? "font-semibold text-primary" : "text-muted-foreground",
                      )}
                    >
                      {column.label}
                    </span>
                    <span className="truncate text-3xs leading-tight text-muted-foreground/65">
                      {column.sublabel}
                    </span>
                  </div>
                ))}

                <div
                  className="pointer-events-none absolute top-0.5 z-10 -translate-x-1/2"
                  style={{ left: `${timeline.todayOffsetPct}%` }}
                >
                  <span className="inline-flex rounded-sm bg-primary px-1.5 py-px font-mono text-3xs font-medium text-primary-foreground">
                    <T>Today</T>
                  </span>
                </div>

                {timeline.releaseMarkers.map((marker) => (
                  <Tooltip key={marker.releaseId}>
                    <TooltipTrigger
                      render={
                        <span
                          className="pointer-events-auto absolute bottom-0.5 z-10 inline-flex -translate-x-1/2 cursor-default items-center gap-1 rounded-sm border border-primary/35 bg-background/95 px-1.5 py-px font-mono text-3xs text-primary shadow-2xs"
                          style={{ left: `${marker.offsetPct}%` }}
                        >
                          <span aria-hidden>◆</span>
                          <span className="max-w-24 truncate">{marker.versionLabel}</span>
                        </span>
                      }
                    />
                    <TooltipPopup>
                      <T>
                        Release <Var>{marker.versionLabel}</Var> (<Var>{marker.date}</Var>)
                      </T>
                    </TooltipPopup>
                  </Tooltip>
                ))}
              </div>
            </div>

            {groups.map((group) => (
              <div key={group.key}>
                {group.label ? (
                  <div className="flex h-8 border-b border-border/45 bg-muted/20">
                    <div className="sticky left-0 z-10 flex w-[264px] shrink-0 items-center gap-2 border-r border-border/55 bg-muted/35 px-3.5 text-xs font-medium text-muted-foreground">
                      {group.assignee ? (
                        <CockpitSwarmAvatar
                          displayName={group.assignee.displayName}
                          handle={group.assignee.handle}
                          kind={group.assignee.kind}
                          size="sm"
                        />
                      ) : null}
                      <span className="truncate">{group.label}</span>
                      <span className="font-mono text-2xs tabular-nums text-muted-foreground/65">
                        {group.rows.length}
                      </span>
                    </div>
                    <div className="flex-1" style={{ minWidth: `${timelineMinWidthPx}px` }} />
                  </div>
                ) : null}

                {group.rows.map((row) => {
                  const lifecycle = readWorkItemLifecycle(row.card.workItem);
                  const barClasses = getBarVisualClasses(row);
                  const stageLabel =
                    stageLabelById.get(row.card.workItem.stage) ?? row.card.workItem.stage;
                  const hasOpenPr = row.card.changeRequests.some(
                    (cr) => cr.state === "open" || cr.state === "draft",
                  );
                  const hasMergedPr = row.card.changeRequests.some((cr) => cr.state === "merged");
                  const isSaving = savingWorkItemId === row.card.workItem.id;
                  const dateRangeLabel = `${formatMonthDay(row.startDate)} - ${formatMonthDay(row.dueDate)}`;

                  return (
                    <div
                      key={row.card.workItem.id}
                      className="group flex h-12 border-b border-border/40 transition-colors last:border-b-0 hover:bg-accent/20"
                    >
                      <div className="sticky left-0 z-10 flex w-[264px] shrink-0 items-center gap-2 border-r border-border/55 bg-card/95 px-3 py-1.5 transition-colors group-hover:bg-accent/25">
                        <button
                          className="min-w-0 flex-1 cursor-pointer space-y-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          type="button"
                          onClick={() => onOpenWorkItem(row.card.workItem.id)}
                        >
                          <div className="flex items-center gap-1.5">
                            <Tooltip>
                              <TooltipTrigger
                                render={<span className="inline-flex shrink-0 items-center" />}
                              >
                                <CockpitArtifactIcon
                                  className={cn(
                                    "size-3.5 shrink-0",
                                    workItemTypeIconClass(row.card.workItem.itemType),
                                  )}
                                  kind={row.card.workItem.itemType}
                                />
                              </TooltipTrigger>
                              <TooltipPopup>
                                {workItemTypeLabel(row.card.workItem.itemType, gt)}
                              </TooltipPopup>
                            </Tooltip>
                            <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                              {row.card.workItem.code}
                            </span>
                            <span className="truncate text-xs font-medium text-foreground">
                              {row.card.workItem.title}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="max-w-28 truncate rounded-sm border border-border/45 bg-muted/25 px-1.5 py-px text-3xs text-muted-foreground">
                              {stageLabel}
                            </span>
                            <span
                              aria-label={gt(
                                "PRD {prd}, Prototype {proto}, Issue {issue}, PR {pr}",
                                {
                                  prd: lifecycle.prdStatus,
                                  proto: lifecycle.prototypeStatus,
                                  issue:
                                    lifecycle.githubIssueNumber !== null
                                      ? `#${lifecycle.githubIssueNumber}`
                                      : gt("none"),
                                  pr: hasMergedPr
                                    ? gt("merged")
                                    : hasOpenPr
                                      ? gt("open")
                                      : gt("none"),
                                },
                              )}
                              className="inline-flex items-center gap-1"
                            >
                              <span
                                aria-hidden
                                className={cn(
                                  "size-1.5 rounded-full",
                                  lifecycle.prdStatus === "approved"
                                    ? "bg-success"
                                    : lifecycle.prdStatus === "draft"
                                      ? "bg-info"
                                      : "bg-muted-foreground/25",
                                )}
                              />
                              <span
                                aria-hidden
                                className={cn(
                                  "size-1.5 rounded-full",
                                  lifecycle.prototypeStatus === "approved"
                                    ? "bg-success"
                                    : lifecycle.prototypeStatus === "draft"
                                      ? "bg-info"
                                      : "bg-muted-foreground/25",
                                )}
                              />
                              <span
                                aria-hidden
                                className={cn(
                                  "size-1.5 rounded-full",
                                  lifecycle.githubIssueNumber !== null
                                    ? "bg-primary"
                                    : "bg-muted-foreground/25",
                                )}
                              />
                              <span
                                aria-hidden
                                className={cn(
                                  "size-1.5 rounded-full",
                                  hasMergedPr
                                    ? "bg-success"
                                    : hasOpenPr
                                      ? "bg-info"
                                      : "bg-muted-foreground/25",
                                )}
                              />
                            </span>
                          </div>
                        </button>

                        {row.assignee ? (
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <span className="shrink-0">
                                  <CockpitSwarmAvatar
                                    displayName={row.assignee.displayName}
                                    handle={row.assignee.handle}
                                    kind={row.assignee.kind}
                                    size="sm"
                                  />
                                </span>
                              }
                            />
                            <TooltipPopup>
                              @{row.assignee.handle} ({row.assignee.displayName})
                            </TooltipPopup>
                          </Tooltip>
                        ) : null}
                      </div>

                      <div
                        className="relative flex-1"
                        style={{ minWidth: `${timelineMinWidthPx}px` }}
                      >
                        {timeline.columns.map((column) => (
                          <div
                            key={column.key}
                            aria-hidden
                            className={cn(
                              "pointer-events-none absolute inset-y-0 border-r border-border/25",
                              column.isWeekend && "bg-muted/15",
                            )}
                            style={{
                              left: `${column.startOffsetPct}%`,
                              width: `${column.widthPct}%`,
                            }}
                          />
                        ))}

                        {timeline.releaseMarkers.map((marker) => (
                          <div
                            key={marker.releaseId}
                            aria-hidden
                            className="pointer-events-none absolute inset-y-0 w-px bg-primary/20"
                            style={{ left: `${marker.offsetPct}%` }}
                          />
                        ))}

                        <div
                          aria-hidden
                          className="pointer-events-none absolute inset-y-0 z-10 w-px bg-primary/70"
                          style={{ left: `${timeline.todayOffsetPct}%` }}
                        />

                        <div
                          className="absolute top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5"
                          style={{
                            left: `${row.leftPct}%`,
                            width: `${row.widthPct}%`,
                          }}
                        >
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  aria-label={gt("Shift {code} one day earlier", {
                                    code: row.card.workItem.code,
                                  })}
                                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border/60 bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40 group-hover:opacity-100 group-focus-within:opacity-100"
                                  disabled={isSaving}
                                  type="button"
                                  onClick={() => {
                                    void handleShiftRow(row, -1);
                                  }}
                                >
                                  <ChevronLeftIcon className="size-3" />
                                </button>
                              }
                            />
                            <TooltipPopup>
                              <T>Shift -1d</T>
                            </TooltipPopup>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  className={cn(
                                    "relative flex h-7 min-w-0 flex-1 cursor-pointer items-center overflow-hidden rounded-md border px-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                                    barClasses.track,
                                    row.isEstimated && "border-dashed",
                                    row.isOverdue && "ring-1 ring-inset ring-destructive/80",
                                  )}
                                  type="button"
                                  onClick={() => onOpenWorkItem(row.card.workItem.id)}
                                >
                                  <span
                                    aria-hidden
                                    className={cn(
                                      "pointer-events-none absolute inset-y-0 left-0 transition-[width]",
                                      barClasses.fill,
                                    )}
                                    style={{ width: `${row.progressPct}%` }}
                                  />
                                  <span className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-1.5 font-mono text-3xs tabular-nums">
                                    <span className="truncate">{dateRangeLabel}</span>
                                    {row.progressPct > 0 ? (
                                      <span className="hidden shrink-0 opacity-75 sm:inline">
                                        {row.progressPct}%
                                      </span>
                                    ) : null}
                                  </span>
                                </button>
                              }
                            />
                            <TooltipPopup>
                              <T>
                                <Var>{row.card.workItem.code}</Var>: <Var>{dateRangeLabel}</Var> (
                                <Var>{row.progressPct}</Var>%)
                              </T>
                            </TooltipPopup>
                          </Tooltip>

                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <button
                                  aria-label={gt("Shift {code} one day later", {
                                    code: row.card.workItem.code,
                                  })}
                                  className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-border/60 bg-background/90 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-40 group-hover:opacity-100 group-focus-within:opacity-100"
                                  disabled={isSaving}
                                  type="button"
                                  onClick={() => {
                                    void handleShiftRow(row, 1);
                                  }}
                                >
                                  <ChevronRightIcon className="size-3" />
                                </button>
                              }
                            />
                            <TooltipPopup>
                              <T>Shift +1d</T>
                            </TooltipPopup>
                          </Tooltip>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
