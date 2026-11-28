import * as DateTime from "effect/DateTime";
import * as Option from "effect/Option";
import type { CockpitWorkItemCard } from "./cockpit.ts";
import {
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveWorkItemSchedule,
} from "./lifecycle.ts";
import type { ProjectCycle, ProjectMilestone } from "./workflow.ts";

export const STORY_POINT_SCALE = [1, 2, 3, 5, 8, 13] as const;

export interface CycleProgressSummary {
  readonly totalItems: number;
  readonly doneItems: number;
  readonly activeItems: number;
  readonly blockedItems: number;
  readonly totalPoints: number;
  readonly donePoints: number;
  readonly itemCompletionPct: number;
  readonly pointsCompletionPct: number;
  readonly daysTotal: number;
  readonly daysElapsed: number;
  readonly daysRemaining: number;
  readonly idealPacePct: number;
  readonly capacityPoints: number | null;
  readonly capacityUtilizationPct: number | null;
  readonly scopeHealth: "healthy" | "at_risk" | "overcommitted";
}

export interface CycleBurnupPoint {
  readonly dayIndex: number;
  readonly date: string;
  readonly idealPoints: number;
  readonly scopePoints: number;
  readonly completedPoints: number | null;
}

export interface TeamVelocitySummary {
  readonly completedCycles: number;
  readonly averagePoints: number;
  readonly latestPoints: number;
  readonly trend: "up" | "steady" | "down" | "none";
}

export interface MilestoneProgressSummary {
  readonly totalItems: number;
  readonly doneItems: number;
  readonly activeItems: number;
  readonly overdueItems: number;
  readonly blockedItems: number;
  readonly totalPoints: number;
  readonly donePoints: number;
  readonly completionPct: number;
  readonly prdCount: number;
  readonly devCount: number;
  readonly reviewCount: number;
}

const DONE_STAGES = new Set(["done", "released", "closed", "shipped", "cancelled"]);
const ISO_DATE_PREFIX_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/;
const MAX_BURNUP_POINTS = 15;
const DEFAULT_CYCLE_WINDOW_DAYS = 14;
const DEFAULT_CYCLE_CAPACITY_POINTS = 20;

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

function resolveToday(todayIso?: string): string {
  return normalizeIsoDate(todayIso) ?? DateTime.formatIsoDateUtc(DateTime.nowUnsafe());
}

function utcDayNumber(isoDate: string): number {
  const [yearStr, monthStr, dayStr] = isoDate.split("-");
  return Math.floor(Date.UTC(Number(yearStr), Number(monthStr) - 1, Number(dayStr)) / 86_400_000);
}

function diffUtcDays(startIso: string, endIso: string): number {
  return utcDayNumber(endIso) - utcDayNumber(startIso);
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

function isCardDone(card: Pick<CockpitWorkItemCard, "workItem">): boolean {
  return DONE_STAGES.has(card.workItem.stage.trim().toLowerCase());
}

export function computeCycleProgress(
  cycle: ProjectCycle,
  cards: ReadonlyArray<CockpitWorkItemCard>,
  todayIso?: string,
): CycleProgressSummary {
  const today = resolveToday(todayIso);
  const startDate = normalizeIsoDate(cycle.startDate) ?? today;
  const rawEndDate = normalizeIsoDate(cycle.endDate) ?? startDate;
  const endDate = rawEndDate < startDate ? startDate : rawEndDate;

  let totalItems = 0;
  let doneItems = 0;
  let blockedItems = 0;
  let totalPoints = 0;
  let donePoints = 0;

  for (const card of cards) {
    const lifecycle = readWorkItemLifecycle(card.workItem);
    if (lifecycle.cycleId !== cycle.id) continue;

    totalItems += 1;
    const points = lifecycle.storyPoints ?? 0;
    totalPoints += points;

    if (isCardDone(card)) {
      doneItems += 1;
      donePoints += points;
    } else if (card.workItem.health === "blocked") {
      blockedItems += 1;
    }
  }

  const activeItems = totalItems - doneItems;
  const itemCompletionPct = totalItems > 0 ? Math.round((doneItems / totalItems) * 100) : 0;
  const pointsCompletionPct =
    totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : itemCompletionPct;

  const daysTotal = Math.max(1, diffUtcDays(startDate, endDate) + 1);
  const rawElapsed =
    today < startDate ? 0 : today > endDate ? daysTotal : diffUtcDays(startDate, today) + 1;
  const daysElapsed = Math.max(0, Math.min(daysTotal, rawElapsed));
  const daysRemaining = Math.max(0, daysTotal - daysElapsed);
  const idealPacePct = Math.round((daysElapsed / daysTotal) * 100);

  const capacityPoints =
    typeof cycle.capacityPoints === "number" &&
    Number.isFinite(cycle.capacityPoints) &&
    cycle.capacityPoints > 0
      ? cycle.capacityPoints
      : null;
  const capacityUtilizationPct =
    capacityPoints !== null ? Math.round((totalPoints / capacityPoints) * 100) : null;

  const scopeHealth: CycleProgressSummary["scopeHealth"] =
    capacityUtilizationPct !== null && capacityUtilizationPct > 100
      ? "overcommitted"
      : blockedItems > 0 ||
          (daysRemaining <= 2 && itemCompletionPct < 75) ||
          (capacityUtilizationPct !== null && capacityUtilizationPct > 85)
        ? "at_risk"
        : "healthy";

  return {
    totalItems,
    doneItems,
    activeItems,
    blockedItems,
    totalPoints,
    donePoints,
    itemCompletionPct,
    pointsCompletionPct,
    daysTotal,
    daysElapsed,
    daysRemaining,
    idealPacePct,
    capacityPoints,
    capacityUtilizationPct,
    scopeHealth,
  };
}

export function buildCycleBurnupSeries(
  cycle: ProjectCycle,
  cards: ReadonlyArray<CockpitWorkItemCard>,
  todayIso?: string,
): ReadonlyArray<CycleBurnupPoint> {
  const today = resolveToday(todayIso);
  const startDate = normalizeIsoDate(cycle.startDate) ?? today;
  const rawEndDate = normalizeIsoDate(cycle.endDate) ?? startDate;
  const endDate = rawEndDate < startDate ? startDate : rawEndDate;

  const cycleEntries: Array<{
    readonly card: CockpitWorkItemCard;
    readonly storyPoints: number;
    readonly done: boolean;
  }> = [];
  let totalEstimatedPoints = 0;

  for (const card of cards) {
    const lifecycle = readWorkItemLifecycle(card.workItem);
    if (lifecycle.cycleId !== cycle.id) continue;
    const storyPoints = lifecycle.storyPoints ?? 0;
    totalEstimatedPoints += storyPoints;
    cycleEntries.push({ card, storyPoints, done: isCardDone(card) });
  }

  const usePoints = totalEstimatedPoints > 0;
  const scopePoints = usePoints ? totalEstimatedPoints : cycleEntries.length;
  const completionCapDate = today < endDate ? today : endDate;

  const doneEntries = cycleEntries
    .filter((entry) => entry.done)
    .map((entry) => {
      const rawUpdatedDate = normalizeIsoDate(entry.card.workItem.updatedAt) ?? today;
      const doneDate = rawUpdatedDate > completionCapDate ? completionCapDate : rawUpdatedDate;
      return {
        doneDate,
        weight: usePoints ? entry.storyPoints : 1,
      };
    });

  const spanDays = Math.max(0, diffUtcDays(startDate, endDate));
  const totalDays = spanDays + 1;
  const dayIndices: number[] = [];

  if (totalDays <= MAX_BURNUP_POINTS) {
    for (let dayIndex = 0; dayIndex <= spanDays; dayIndex += 1) {
      dayIndices.push(dayIndex);
    }
  } else {
    for (let i = 0; i < MAX_BURNUP_POINTS; i += 1) {
      const sampled = Math.round((i * spanDays) / (MAX_BURNUP_POINTS - 1));
      if (dayIndices.length === 0 || dayIndices[dayIndices.length - 1] !== sampled) {
        dayIndices.push(sampled);
      }
    }
  }

  return dayIndices.map((dayIndex) => {
    const date = addUtcDays(startDate, dayIndex);
    const idealPoints =
      spanDays === 0 ? scopePoints : Number(((scopePoints * dayIndex) / spanDays).toFixed(2));

    let completedPoints: number | null = null;
    if (date <= today) {
      let sum = 0;
      for (const entry of doneEntries) {
        if (entry.doneDate <= date) {
          sum += entry.weight;
        }
      }
      completedPoints = sum;
    }

    return {
      dayIndex,
      date,
      idealPoints,
      scopePoints,
      completedPoints,
    };
  });
}

export function computeTeamVelocity(
  cycles: ReadonlyArray<ProjectCycle>,
  cards: ReadonlyArray<CockpitWorkItemCard>,
): TeamVelocitySummary {
  const completed = cycles
    .filter((cycle) => cycle.status === "completed")
    .toSorted(
      (a, b) =>
        a.number - b.number || a.startDate.localeCompare(b.startDate) || a.id.localeCompare(b.id),
    );

  if (completed.length === 0) {
    return {
      completedCycles: 0,
      averagePoints: 0,
      latestPoints: 0,
      trend: "none",
    };
  }

  const donePointsByCycle = new Map<string, number>();
  for (const card of cards) {
    if (!isCardDone(card)) continue;
    const lifecycle = readWorkItemLifecycle(card.workItem);
    if (!lifecycle.cycleId) continue;
    const prev = donePointsByCycle.get(lifecycle.cycleId) ?? 0;
    donePointsByCycle.set(lifecycle.cycleId, prev + (lifecycle.storyPoints ?? 0));
  }

  const pointsSeries = completed.map((cycle) => {
    if (
      typeof cycle.completedPoints === "number" &&
      Number.isFinite(cycle.completedPoints) &&
      cycle.completedPoints >= 0
    ) {
      return cycle.completedPoints;
    }
    return donePointsByCycle.get(cycle.id) ?? 0;
  });

  const completedCycles = pointsSeries.length;
  const total = pointsSeries.reduce((sum, value) => sum + value, 0);
  const averagePoints = Math.round((total / completedCycles) * 10) / 10;
  const latestPoints = pointsSeries[completedCycles - 1] ?? 0;

  let trend: TeamVelocitySummary["trend"] = "none";
  if (completedCycles >= 2) {
    const previous = pointsSeries.slice(0, -1);
    const previousAverage = previous.reduce((sum, value) => sum + value, 0) / previous.length;
    const delta = latestPoints - previousAverage;
    const steadyTolerance = previousAverage * 0.05;

    if (delta > steadyTolerance) {
      trend = "up";
    } else if (delta < -steadyTolerance) {
      trend = "down";
    } else {
      trend = "steady";
    }
  }

  return {
    completedCycles,
    averagePoints,
    latestPoints,
    trend,
  };
}

export function computeMilestoneProgress(
  milestone: ProjectMilestone,
  cards: ReadonlyArray<CockpitWorkItemCard>,
  todayIso?: string,
): MilestoneProgressSummary {
  const today = resolveToday(todayIso);

  let totalItems = 0;
  let doneItems = 0;
  let overdueItems = 0;
  let blockedItems = 0;
  let totalPoints = 0;
  let donePoints = 0;
  let prdCount = 0;
  let devCount = 0;
  let reviewCount = 0;

  for (const card of cards) {
    const lifecycle = readWorkItemLifecycle(card.workItem);
    if (lifecycle.milestoneId !== milestone.id) continue;

    totalItems += 1;
    const points = lifecycle.storyPoints ?? 0;
    totalPoints += points;

    const done = isCardDone(card);
    if (done) {
      doneItems += 1;
      donePoints += points;
    } else {
      if (card.workItem.health === "blocked") {
        blockedItems += 1;
      }
      if (resolveWorkItemSchedule(card.workItem, today).isOverdue) {
        overdueItems += 1;
      }
    }

    const phase = deriveWorkItemPipelinePhase(card);
    if (phase === "prd" || phase === "prototype") {
      prdCount += 1;
    } else if (phase === "dev") {
      devCount += 1;
    } else if (phase === "review" || phase === "release") {
      reviewCount += 1;
    }
  }

  const activeItems = totalItems - doneItems;
  const completionPct =
    totalPoints > 0
      ? Math.round((donePoints / totalPoints) * 100)
      : totalItems > 0
        ? Math.round((doneItems / totalItems) * 100)
        : 0;

  return {
    totalItems,
    doneItems,
    activeItems,
    overdueItems,
    blockedItems,
    totalPoints,
    donePoints,
    completionPct,
    prdCount,
    devCount,
    reviewCount,
  };
}

export function suggestNextCycleDraft(
  existingCycles: ReadonlyArray<ProjectCycle>,
  todayIso?: string,
): {
  readonly number: number;
  readonly name: string;
  readonly startDate: string;
  readonly endDate: string;
  readonly capacityPoints: number;
} {
  const today = resolveToday(todayIso);
  let maxNumber = 0;
  let latestEndDate: string | null = null;

  for (const cycle of existingCycles) {
    if (cycle.number > maxNumber) {
      maxNumber = cycle.number;
    }
    const normalizedEnd = normalizeIsoDate(cycle.endDate);
    if (normalizedEnd && (latestEndDate === null || normalizedEnd > latestEndDate)) {
      latestEndDate = normalizedEnd;
    }
  }

  const number = maxNumber + 1;
  const name = `Cycle ${number}`;
  const dayAfterLatest = latestEndDate ? addUtcDays(latestEndDate, 1) : null;
  const startDate = dayAfterLatest && dayAfterLatest >= today ? dayAfterLatest : today;
  const endDate = addUtcDays(startDate, DEFAULT_CYCLE_WINDOW_DAYS - 1);

  const completedWithPoints = existingCycles.filter(
    (cycle) =>
      cycle.status === "completed" &&
      typeof cycle.completedPoints === "number" &&
      Number.isFinite(cycle.completedPoints) &&
      cycle.completedPoints > 0,
  );
  const capacityPoints =
    completedWithPoints.length > 0
      ? Math.max(
          1,
          Math.round(
            completedWithPoints.reduce((sum, cycle) => sum + (cycle.completedPoints ?? 0), 0) /
              completedWithPoints.length,
          ),
        )
      : DEFAULT_CYCLE_CAPACITY_POINTS;

  return {
    number,
    name,
    startDate,
    endDate,
    capacityPoints,
  };
}
