import {
  computeCycleProgress,
  computeMilestoneProgress,
  computeTeamVelocity,
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  type AgileHorizon,
  type ChangeRequestAudit,
  type CockpitOverview,
  type CockpitWorkItemCard,
  type MilestoneTone,
  type ProjectCycle,
  type ProjectMilestone,
  type ReleaseCard,
  type ReleaseStatus,
  type TeamBoardMessage,
  type WorkItemType,
} from "@u3code/hub-contracts";
import { Plural, T, useGT, Var } from "gt-react";
import {
  ArrowRightIcon,
  AtSignIcon,
  CalendarClockIcon,
  CalendarRangeIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  CompassIcon,
  ListChecksIcon,
  MessageSquareIcon,
  PlusIcon,
  RepeatIcon,
  ShieldCheckIcon,
  TrendingDownIcon,
  TrendingUpIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  CockpitArtifactIcon,
  CockpitStageArtworkIcon,
  CockpitStudioBanner,
} from "./CockpitArtwork";
import {
  CockpitDiffStat,
  CockpitIconBadge,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  type CockpitTone,
} from "./CockpitPrimitives";
import {
  CockpitAllTeamAvatar,
  CockpitSwarmAvatar,
  isWorkItemDoneStage,
  type CockpitTeamMember,
} from "./CockpitSwarmAvatar";

export type OverviewDeliverySubView =
  | "cycles"
  | "roadmap"
  | "kanban"
  | "gantt"
  | "triage"
  | "releases";

export interface CockpitOverviewTabProps {
  readonly overview: CockpitOverview | null;
  readonly reviewItems: readonly ChangeRequestAudit[];
  readonly releases: readonly ReleaseCard[];
  readonly roster: readonly CockpitTeamMember[];
  readonly boardMessages: readonly TeamBoardMessage[];
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenChangeRequest: (cr: ChangeRequestAudit) => void;
  readonly onNavigateDelivery: (subView: OverviewDeliverySubView) => void;
  readonly onNavigateBoard: (opts?: { mentionHandle?: string; filterHandle?: string }) => void;
  readonly onNavigateMembers: () => void;
  readonly onOpenIntake?: (() => void) | undefined;
}

const STANDARD_RELEASE_GATES = ["qa_ac_pass", "security_clear", "prod_go"] as const;

type OverviewFunnelStage = "intake" | "prd" | "prototype" | "issue" | "dev" | "review" | "release";

type OverviewBadgeTone =
  | "neutral"
  | "primary"
  | "success"
  | "info"
  | "warning"
  | "error"
  | "violet";

const PIPELINE_STEPS: readonly {
  readonly stage: OverviewFunnelStage;
  readonly targetSubView: OverviewDeliverySubView;
  readonly activeTone: OverviewBadgeTone;
  readonly barClass: string;
}[] = [
  { stage: "intake", targetSubView: "kanban", activeTone: "primary", barClass: "bg-primary" },
  { stage: "prd", targetSubView: "kanban", activeTone: "violet", barClass: "bg-guest" },
  { stage: "prototype", targetSubView: "kanban", activeTone: "info", barClass: "bg-info" },
  { stage: "issue", targetSubView: "kanban", activeTone: "primary", barClass: "bg-primary/80" },
  { stage: "dev", targetSubView: "kanban", activeTone: "info", barClass: "bg-info" },
  { stage: "review", targetSubView: "triage", activeTone: "warning", barClass: "bg-warning" },
  { stage: "release", targetSubView: "releases", activeTone: "success", barClass: "bg-success" },
];

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

const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

interface LifecycleCue {
  readonly key: string;
  readonly iconKind: "due" | "prd" | "prototype" | "issue" | "branch";
  readonly text: string;
  readonly tone: "muted" | "success" | "error";
}

type PriorityActionTarget =
  | { readonly kind: "change_request"; readonly cr: ChangeRequestAudit }
  | { readonly kind: "work_item"; readonly workItemId: string }
  | { readonly kind: "releases" };

interface PriorityNextAction {
  readonly key: string;
  readonly tone: OverviewBadgeTone;
  readonly iconKind: "pr" | "item" | "prd" | "release";
  readonly categoryLabel: string;
  readonly title: string;
  readonly reason: string;
  readonly ctaLabel: string;
  readonly target: PriorityActionTarget;
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

function renderPriorityActionIcon(iconKind: PriorityNextAction["iconKind"]) {
  switch (iconKind) {
    case "pr":
      return <CockpitStageArtworkIcon stage="pr" />;
    case "item":
      return <CalendarClockIcon />;
    case "prd":
      return <CockpitStageArtworkIcon stage="prd" />;
    case "release":
      return <CockpitStageArtworkIcon stage="release" />;
  }
}

type ActiveNowRow =
  | {
      readonly key: string;
      readonly kind: "work_item";
      readonly title: string;
      readonly detail: string;
      readonly cues: readonly LifecycleCue[];
      readonly ownerHandle: string | null;
      readonly ownerDisplayName: string;
      readonly ownerKind: "human" | "agent";
      readonly memberHandles: ReadonlySet<string>;
      readonly card: CockpitWorkItemCard;
    }
  | {
      readonly key: string;
      readonly kind: "change_request";
      readonly title: string;
      readonly detail: string;
      readonly cues: readonly LifecycleCue[];
      readonly ownerHandle: string | null;
      readonly ownerDisplayName: string;
      readonly ownerKind: "human" | "agent";
      readonly memberHandles: ReadonlySet<string>;
      readonly cr: ChangeRequestAudit;
    };

function formatShortIsoDate(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const match = ISO_DATE_PREFIX.exec(isoDate.trim());
  if (!match) return null;
  const month = Number(match[2]);
  const day = Number(match[3]);
  const monthLabel = MONTH_SHORT[month - 1];
  if (!monthLabel || day < 1 || day > 31) return null;
  return `${monthLabel} ${day}`;
}

function pipelineStageLabel(stage: OverviewFunnelStage, gt: ReturnType<typeof useGT>): string {
  switch (stage) {
    case "intake":
      return gt("Intake");
    case "prd":
      return gt("AI PRD");
    case "prototype":
      return gt("Prototype");
    case "issue":
      return gt("Issue");
    case "dev":
      return gt("Dev");
    case "review":
      return gt("PR Review");
    case "release":
      return gt("Release");
  }
}

function resolveFunnelStage(card: CockpitWorkItemCard): OverviewFunnelStage | "done" {
  const basePhase = deriveWorkItemPipelinePhase(card);
  if (basePhase === "done") return "done";
  if (basePhase === "release" || basePhase === "review" || basePhase === "dev") {
    return basePhase;
  }
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const rawStage = card.workItem.stage.trim().toLowerCase();
  if (
    rawStage === "issue" ||
    lifecycle.githubIssueNumber !== null ||
    lifecycle.githubIssueUrl !== null
  ) {
    return "issue";
  }
  return basePhase;
}

function releaseStatusLabel(status: ReleaseStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "planning":
      return gt("Planning");
    case "staging":
      return gt("Staging");
    case "ready":
      return gt("Ready");
    case "released":
      return gt("Released");
    case "rolled_back":
      return gt("Rolled Back");
  }
}

function workItemBadgeTone(itemType: WorkItemType, health: string): OverviewBadgeTone {
  if (health === "blocked") return "error";
  if (health === "at_risk") return "warning";
  switch (itemType) {
    case "bug":
      return "error";
    case "security":
      return "warning";
    case "refactor":
      return "violet";
    case "chore":
      return "neutral";
    case "feature":
      return "primary";
  }
}

function changeRequestTone(cr: ChangeRequestAudit): CockpitTone {
  if (cr.triageBucket === "bot_blocked" || cr.triageBucket === "ci_blocked") return "error";
  if (cr.triageBucket === "orphan") return "warning";
  if (cr.triageBucket === "ready_for_human_review") return "info";
  return "neutral";
}

function changeRequestBadgeTone(cr: ChangeRequestAudit): OverviewBadgeTone {
  if (cr.triageBucket === "bot_blocked" || cr.triageBucket === "ci_blocked") return "error";
  if (cr.triageBucket === "orphan") return "warning";
  if (cr.triageBucket === "ready_for_human_review") return "info";
  return "neutral";
}

function renderCueIcon(iconKind: LifecycleCue["iconKind"]) {
  switch (iconKind) {
    case "due":
      return <CalendarClockIcon aria-hidden className="size-3 shrink-0" />;
    case "prd":
      return <CockpitStageArtworkIcon className="size-3 shrink-0" stage="prd" />;
    case "prototype":
      return <CockpitArtifactIcon className="size-3 shrink-0" kind="prototype" />;
    case "issue":
      return <CockpitArtifactIcon className="size-3 shrink-0" kind="github_issue" />;
    case "branch":
      return <CockpitArtifactIcon className="size-3 shrink-0" kind="branch" />;
  }
}

function findMemberByUserId(
  roster: readonly CockpitTeamMember[],
  userId: string | null,
): CockpitTeamMember | null {
  if (!userId) return null;
  return roster.find((member) => member.id === userId) ?? null;
}

function findMemberByHandle(
  roster: readonly CockpitTeamMember[],
  handle: string | null,
): CockpitTeamMember | null {
  if (!handle) return null;
  const normalized = handle.trim().toLowerCase();
  return roster.find((member) => member.handle === normalized) ?? null;
}

function getLatestBoardMessage(messages: readonly TeamBoardMessage[]): TeamBoardMessage | null {
  let latest: TeamBoardMessage | null = null;
  for (const message of messages) {
    if (!latest || message.seq > latest.seq) {
      latest = message;
    }
  }
  return latest;
}

function buildWorkItemCues(
  card: CockpitWorkItemCard,
  schedule: { readonly dueDate: string; readonly isOverdue: boolean },
  gt: ReturnType<typeof useGT>,
): LifecycleCue[] {
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const cues: LifecycleCue[] = [];

  if (lifecycle.dueAt || schedule.isOverdue) {
    const formattedDue = formatShortIsoDate(lifecycle.dueAt ?? schedule.dueDate);
    if (formattedDue) {
      cues.push({
        key: "due",
        iconKind: "due",
        text: gt("Due {date}", { date: formattedDue }),
        tone: schedule.isOverdue ? "error" : "muted",
      });
    }
  }

  if (lifecycle.prdStatus !== "none") {
    cues.push({
      key: "prd",
      iconKind: "prd",
      text: gt("PRD"),
      tone: lifecycle.prdStatus === "approved" ? "success" : "muted",
    });
  }

  if (lifecycle.prototypeStatus !== "none") {
    cues.push({
      key: "proto",
      iconKind: "prototype",
      text: gt("Proto"),
      tone: lifecycle.prototypeStatus === "approved" ? "success" : "muted",
    });
  }

  if (lifecycle.githubIssueNumber !== null) {
    cues.push({
      key: "issue",
      iconKind: "issue",
      text: gt("Issue #{num}", { num: lifecycle.githubIssueNumber }),
      tone: "muted",
    });
  }

  if (lifecycle.branchName !== null) {
    cues.push({
      key: "branch",
      iconKind: "branch",
      text: lifecycle.branchName,
      tone: "muted",
    });
  }

  return cues.slice(0, 4);
}

function selectFeaturedCycle(cycles: readonly ProjectCycle[]): ProjectCycle | null {
  const active = cycles
    .filter((cycle) => cycle.status === "active")
    .toSorted((a, b) => b.number - a.number)[0];
  if (active) return active;

  const upcoming = cycles
    .filter((cycle) => cycle.status === "upcoming")
    .toSorted((a, b) => {
      const dateCmp = a.startDate.localeCompare(b.startDate);
      return dateCmp !== 0 ? dateCmp : a.number - b.number;
    })[0];
  if (upcoming) return upcoming;

  return cycles.toSorted((a, b) => b.number - a.number)[0] ?? null;
}

function horizonRank(horizon: AgileHorizon): number {
  switch (horizon) {
    case "now":
      return 0;
    case "next":
      return 1;
    case "later":
      return 2;
  }
}

function milestoneStatusRank(status: ProjectMilestone["status"]): number {
  switch (status) {
    case "active":
      return 0;
    case "planned":
      return 1;
    case "paused":
      return 2;
    case "completed":
      return 3;
  }
}

function selectFeaturedMilestones(
  milestones: readonly ProjectMilestone[],
): readonly ProjectMilestone[] {
  return milestones
    .toSorted((a, b) => {
      const hDiff = horizonRank(a.horizon) - horizonRank(b.horizon);
      if (hDiff !== 0) return hDiff;
      const sDiff = milestoneStatusRank(a.status) - milestoneStatusRank(b.status);
      if (sDiff !== 0) return sDiff;
      if (a.targetDate && b.targetDate) {
        return a.targetDate.localeCompare(b.targetDate);
      }
      if (a.targetDate) return -1;
      if (b.targetDate) return 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 3);
}

function horizonLabel(horizon: AgileHorizon, gt: ReturnType<typeof useGT>): string {
  switch (horizon) {
    case "now":
      return gt("Now");
    case "next":
      return gt("Next");
    case "later":
      return gt("Later");
  }
}

function horizonPillClass(horizon: AgileHorizon): string {
  switch (horizon) {
    case "now":
      return "border-primary/30 bg-primary/10 text-primary";
    case "next":
      return "border-info/30 bg-info/10 text-info-foreground";
    case "later":
      return "border-guest/30 bg-guest/10 text-guest-foreground";
  }
}

function milestoneProgressBarClass(
  tone: MilestoneTone | undefined,
  completionPct: number,
  blockedItems: number,
): string {
  if (completionPct >= 100) return "bg-success";
  if (blockedItems > 0) return "bg-destructive";
  switch (tone) {
    case "success":
      return "bg-success";
    case "info":
      return "bg-info";
    case "warning":
      return "bg-warning";
    case "violet":
      return "bg-guest";
    case "primary":
    default:
      return "bg-primary";
  }
}

function cycleScopeHealthTone(health: "healthy" | "at_risk" | "overcommitted"): CockpitTone {
  switch (health) {
    case "overcommitted":
      return "error";
    case "at_risk":
      return "warning";
    case "healthy":
      return "success";
  }
}

function cycleScopeHealthLabel(
  health: "healthy" | "at_risk" | "overcommitted",
  gt: ReturnType<typeof useGT>,
): string {
  switch (health) {
    case "overcommitted":
      return gt("Overcommitted");
    case "at_risk":
      return gt("At risk");
    case "healthy":
      return gt("Healthy pace");
  }
}

export function CockpitOverviewTab({
  overview,
  reviewItems,
  releases,
  roster,
  boardMessages,
  onOpenWorkItem,
  onOpenChangeRequest,
  onNavigateDelivery,
  onNavigateBoard,
  onNavigateMembers,
  onOpenIntake,
}: CockpitOverviewTabProps) {
  const gt = useGT();
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [prsExpanded, setPrsExpanded] = useState(false);

  const cards = overview?.cards ?? [];
  const totalItems = cards.length;
  const doneItems = cards.filter((card) => isWorkItemDoneStage(card.workItem.stage));
  const activeCards = cards.filter((card) => !isWorkItemDoneStage(card.workItem.stage));
  const blockedCards = activeCards.filter((card) => card.workItem.health === "blocked");

  const scheduleByCardId = new Map<
    string,
    {
      readonly startDate: string;
      readonly dueDate: string;
      readonly isEstimated: boolean;
      readonly isOverdue: boolean;
    }
  >();
  let overdueCount = 0;
  let explicitScheduleCount = 0;
  let earliestStart: string | null = null;
  let latestDue: string | null = null;

  const phaseStats = new Map<
    OverviewFunnelStage,
    { count: number; blocked: number; overdue: number }
  >();
  for (const step of PIPELINE_STEPS) {
    phaseStats.set(step.stage, { count: 0, blocked: 0, overdue: 0 });
  }

  for (const card of cards) {
    const schedule = resolveWorkItemSchedule(card.workItem);
    scheduleByCardId.set(card.workItem.id, schedule);
    if (schedule.isOverdue) {
      overdueCount += 1;
    }
    if (!schedule.isEstimated) {
      explicitScheduleCount += 1;
    }
    if (!earliestStart || schedule.startDate < earliestStart) {
      earliestStart = schedule.startDate;
    }
    if (!latestDue || schedule.dueDate > latestDue) {
      latestDue = schedule.dueDate;
    }

    const stage = resolveFunnelStage(card);
    if (stage !== "done") {
      const bucket = phaseStats.get(stage);
      if (bucket) {
        bucket.count += 1;
        if (card.workItem.health === "blocked") {
          bucket.blocked += 1;
        }
        if (schedule.isOverdue) {
          bucket.overdue += 1;
        }
      }
    }
  }

  const verifiedAcCount = cards.reduce((sum, card) => sum + card.checklistVerifiedCount, 0);
  const totalAcCount = cards.reduce((sum, card) => sum + card.checklistTotalCount, 0);
  const activeVerifiedAcCount = activeCards.reduce(
    (sum, card) => sum + card.checklistVerifiedCount,
    0,
  );
  const activeTotalAcCount = activeCards.reduce((sum, card) => sum + card.checklistTotalCount, 0);
  const readinessVerifiedAc = activeCards.length > 0 ? activeVerifiedAcCount : verifiedAcCount;
  const readinessTotalAc = activeCards.length > 0 ? activeTotalAcCount : totalAcCount;
  const acceptanceReadinessPct =
    readinessTotalAc > 0 ? Math.round((readinessVerifiedAc / readinessTotalAc) * 100) : 0;

  const activeOverdueCount = activeCards.filter(
    (card) =>
      (scheduleByCardId.get(card.workItem.id) ?? resolveWorkItemSchedule(card.workItem)).isOverdue,
  ).length;
  const activeOnTrackCount = Math.max(0, activeCards.length - activeOverdueCount);
  const scheduleOnTrackPct =
    activeCards.length > 0 ? Math.round((activeOnTrackCount / activeCards.length) * 100) : 100;
  const scheduleOverduePct =
    activeCards.length > 0 ? Math.round((activeOverdueCount / activeCards.length) * 100) : 0;

  const openPrMap = new Map<string, ChangeRequestAudit>();
  for (const cr of reviewItems) {
    if (cr.state === "open" || cr.state === "draft") {
      openPrMap.set(cr.id, cr);
    }
  }
  for (const card of cards) {
    for (const cr of card.changeRequests) {
      if ((cr.state === "open" || cr.state === "draft") && !openPrMap.has(cr.id)) {
        openPrMap.set(cr.id, cr);
      }
    }
  }
  const openPrs = [...openPrMap.values()];
  const botBlockedPrs = openPrs.filter(
    (cr) => cr.triageBucket === "bot_blocked" || cr.triageBucket === "ci_blocked",
  );
  const readyForReviewPrs = openPrs.filter((cr) => cr.triageBucket === "ready_for_human_review");
  const cleanReadyPrs = openPrs.filter(
    (cr) =>
      cr.triageBucket === "ready_for_human_review" ||
      (cr.triageBucket !== "bot_blocked" &&
        cr.triageBucket !== "ci_blocked" &&
        (cr.automatedReview.status === "pass" || cr.automatedReview.status === "auto_merged")),
  );
  const prReadyPct =
    openPrs.length > 0 ? Math.round((cleanReadyPrs.length / openPrs.length) * 100) : 100;
  const prBlockedPct =
    openPrs.length > 0 ? Math.round((botBlockedPrs.length / openPrs.length) * 100) : 0;

  const priorityActions: PriorityNextAction[] = [];
  const seenActionWorkItemIds = new Set<string>();

  const sortedBlockedPrs = [...botBlockedPrs].toSorted((a, b) => {
    const aWeight = a.automatedReview.blockingCount + (a.triageBucket === "ci_blocked" ? 1 : 0);
    const bWeight = b.automatedReview.blockingCount + (b.triageBucket === "ci_blocked" ? 1 : 0);
    if (aWeight !== bWeight) return bWeight - aWeight;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  for (const cr of sortedBlockedPrs) {
    if (priorityActions.length >= 4) break;
    const isCiBlocked = cr.triageBucket === "ci_blocked";
    const reason = isCiBlocked
      ? gt("CI checks failing on {branch}", { branch: cr.headBranch })
      : cr.automatedReview.blockingCount > 0
        ? gt(
            "{count, plural, one {{count} blocking bot finding} other {{count} blocking bot findings}}",
            { count: cr.automatedReview.blockingCount },
          )
        : gt("Automated review blocking merge");
    priorityActions.push({
      key: `p1-pr:${cr.id}`,
      tone: "error",
      iconKind: "pr",
      categoryLabel: isCiBlocked ? gt("CI Blocked") : gt("Bot Blocked"),
      title: `${cr.repoFullName}#${cr.number} · ${cr.title}`,
      reason,
      ctaLabel: gt("Inspect PR"),
      target: { kind: "change_request", cr },
    });
  }

  const urgentWorkItems = activeCards
    .filter((card) => {
      const schedule =
        scheduleByCardId.get(card.workItem.id) ?? resolveWorkItemSchedule(card.workItem);
      return card.workItem.health === "blocked" || schedule.isOverdue;
    })
    .toSorted((a, b) => {
      const aSched = scheduleByCardId.get(a.workItem.id) ?? resolveWorkItemSchedule(a.workItem);
      const bSched = scheduleByCardId.get(b.workItem.id) ?? resolveWorkItemSchedule(b.workItem);
      const aScore = (a.workItem.health === "blocked" ? 2 : 0) + (aSched.isOverdue ? 1 : 0);
      const bScore = (b.workItem.health === "blocked" ? 2 : 0) + (bSched.isOverdue ? 1 : 0);
      if (aScore !== bScore) return bScore - aScore;
      const pDiff = priorityWeight(a.workItem.priority) - priorityWeight(b.workItem.priority);
      if (pDiff !== 0) return pDiff;
      return aSched.dueDate.localeCompare(bSched.dueDate);
    });
  for (const card of urgentWorkItems) {
    if (priorityActions.length >= 4) break;
    const schedule =
      scheduleByCardId.get(card.workItem.id) ?? resolveWorkItemSchedule(card.workItem);
    const isBlocked = card.workItem.health === "blocked";
    const dueLabel = formatShortIsoDate(schedule.dueDate) ?? schedule.dueDate;
    const reason =
      isBlocked && schedule.isOverdue
        ? gt("Blocked and overdue since {date}", { date: dueLabel })
        : isBlocked
          ? card.latestPulse?.nextStep.trim() ||
            gt("Blocked in {stage}", { stage: card.workItem.stage })
          : gt("Overdue since {date}", { date: dueLabel });
    seenActionWorkItemIds.add(card.workItem.id);
    priorityActions.push({
      key: `p2-wi:${card.workItem.id}`,
      tone: isBlocked ? "error" : "warning",
      iconKind: "item",
      categoryLabel: isBlocked ? gt("Blocked") : gt("Overdue"),
      title: `${card.workItem.code} · ${card.workItem.title}`,
      reason,
      ctaLabel: gt("Open Item"),
      target: { kind: "work_item", workItemId: card.workItem.id },
    });
  }

  const missingPrdCards = activeCards
    .filter((card) => {
      if (seenActionWorkItemIds.has(card.workItem.id)) return false;
      const stage = resolveFunnelStage(card);
      const isEarlyStage =
        stage === "intake" || stage === "prd" || stage === "prototype" || stage === "issue";
      if (!isEarlyStage) return false;
      return readWorkItemLifecycle(card.workItem).prdStatus === "none";
    })
    .toSorted((a, b) => {
      const pDiff = priorityWeight(a.workItem.priority) - priorityWeight(b.workItem.priority);
      if (pDiff !== 0) return pDiff;
      return a.workItem.createdAt.localeCompare(b.workItem.createdAt);
    });
  for (const card of missingPrdCards) {
    if (priorityActions.length >= 4) break;
    const stage = resolveFunnelStage(card);
    const stageName = stage === "done" ? card.workItem.stage : pipelineStageLabel(stage, gt);
    seenActionWorkItemIds.add(card.workItem.id);
    priorityActions.push({
      key: `p3-prd:${card.workItem.id}`,
      tone: "violet",
      iconKind: "prd",
      categoryLabel: gt("Missing PRD"),
      title: `${card.workItem.code} · ${card.workItem.title}`,
      reason: gt("Draft PRD to align scope in {stage}", { stage: stageName }),
      ctaLabel: gt("Draft PRD"),
      target: { kind: "work_item", workItemId: card.workItem.id },
    });
  }

  const signoffReleases = releases.filter(
    (entry) => entry.release.status === "staging" || entry.release.status === "ready",
  );
  for (const entry of signoffReleases) {
    if (priorityActions.length >= 4) break;
    const signed = STANDARD_RELEASE_GATES.filter(
      (gateKey) =>
        resolveLatestGateApprovals(entry.gateApprovals).get(gateKey)?.status === "approved",
    ).length;
    const isReady = entry.release.status === "ready";
    priorityActions.push({
      key: `p4-rel:${entry.release.id}`,
      tone: isReady ? "success" : "info",
      iconKind: "release",
      categoryLabel: gt("Release Gate"),
      title: `${entry.release.versionLabel} · ${releaseStatusLabel(entry.release.status, gt)}`,
      reason: isReady
        ? gt("Ready to ship · {signed}/3 gates approved", { signed })
        : gt("Awaiting release sign-off · {signed}/3 gates approved", { signed }),
      ctaLabel: gt("Review Release"),
      target: { kind: "releases" },
    });
  }

  const priorityHeaderDotTone: CockpitTone = priorityActions.some((a) => a.tone === "error")
    ? "error"
    : priorityActions.some((a) => a.tone === "warning")
      ? "warning"
      : "info";

  const handlePriorityAction = (target: PriorityActionTarget) => {
    if (target.kind === "change_request") {
      onOpenChangeRequest(target.cr);
    } else if (target.kind === "work_item") {
      onOpenWorkItem(target.workItemId);
    } else {
      onNavigateDelivery("releases");
    }
  };

  const selectedMember = selectedHandle ? findMemberByHandle(roster, selectedHandle) : null;

  const allActiveRows: ActiveNowRow[] = [];

  for (const card of activeCards) {
    const memberHandles = new Set<string>();
    let owner: CockpitTeamMember | null = null;

    if (card.workItem.assigneeType === "human" && card.workItem.assigneeUserId) {
      owner = findMemberByUserId(roster, card.workItem.assigneeUserId);
    } else if (card.workItem.assigneeType === "runner" && card.workItem.assigneeRunnerId) {
      owner = findMemberByHandle(roster, card.workItem.assigneeRunnerId);
    }
    if (owner) {
      memberHandles.add(owner.handle);
    }
    for (const cr of card.changeRequests) {
      const author = findMemberByHandle(roster, cr.authorVcsLogin);
      if (author) {
        memberHandles.add(author.handle);
        if (!owner) owner = author;
      }
      for (const reviewer of cr.automatedReview.reviewers) {
        const bot = findMemberByHandle(roster, reviewer.reviewerName);
        if (bot) memberHandles.add(bot.handle);
      }
    }

    const pulseSummary =
      card.latestPulse?.doneSummary.trim() ||
      card.latestPulse?.nextStep.trim() ||
      card.changeRequests[0]?.automatedReview.reviewers[0]?.bodyExcerpt.trim() ||
      gt("Stage: {stage}", { stage: card.workItem.stage });

    const schedule =
      scheduleByCardId.get(card.workItem.id) ?? resolveWorkItemSchedule(card.workItem);
    const cues = buildWorkItemCues(card, schedule, gt);

    allActiveRows.push({
      key: `wi:${card.workItem.id}`,
      kind: "work_item",
      title: `${card.workItem.code} · ${card.workItem.title}`,
      detail: pulseSummary,
      cues,
      ownerHandle: owner?.handle ?? null,
      ownerDisplayName: owner?.displayName ?? "",
      ownerKind: owner?.kind ?? "human",
      memberHandles,
      card,
    });
  }

  for (const cr of openPrs) {
    const needsAttention =
      cr.triageBucket === "bot_blocked" ||
      cr.triageBucket === "ci_blocked" ||
      cr.triageBucket === "ready_for_human_review" ||
      cr.triageBucket === "orphan";
    if (!needsAttention) continue;

    const memberHandles = new Set<string>();
    const author = findMemberByHandle(roster, cr.authorVcsLogin);
    if (author) memberHandles.add(author.handle);
    for (const reviewer of cr.automatedReview.reviewers) {
      const bot = findMemberByHandle(roster, reviewer.reviewerName);
      if (bot) memberHandles.add(bot.handle);
    }

    const topFinding = cr.automatedReview.reviewers[0];
    const detail = topFinding
      ? `${topFinding.reviewerName}: ${topFinding.bodyExcerpt}`
      : `${cr.headBranch} -> ${cr.baseBranch}`;

    allActiveRows.push({
      key: `cr:${cr.id}`,
      kind: "change_request",
      title: `${cr.repoFullName}#${cr.number} · ${cr.title}`,
      detail,
      cues: [],
      ownerHandle: author?.handle ?? (cr.authorVcsLogin.trim().toLowerCase() || null),
      ownerDisplayName: author?.displayName ?? cr.authorVcsLogin,
      ownerKind: author?.kind ?? "human",
      memberHandles,
      cr,
    });
  }

  const visibleActiveRows = selectedMember
    ? allActiveRows.filter((row) => row.memberHandles.has(selectedMember.handle))
    : allActiveRows;

  const completionRatio = totalItems > 0 ? doneItems.length / totalItems : 0;
  const completionPct = totalItems > 0 ? Math.round((doneItems.length / totalItems) * 100) : 0;
  const ringRadius = 7.5;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - completionRatio);

  const donePct = totalItems > 0 ? (doneItems.length / totalItems) * 100 : 0;
  const blockedPct = totalItems > 0 ? (blockedCards.length / totalItems) * 100 : 0;
  const movingPct =
    totalItems > 0 ? ((activeCards.length - blockedCards.length) / totalItems) * 100 : 0;

  const latestActiveRelease =
    releases.find(
      (entry) =>
        entry.release.status === "staging" ||
        entry.release.status === "ready" ||
        entry.release.status === "planning",
    ) ??
    releases[0] ??
    null;

  const releaseSignedCount = latestActiveRelease
    ? STANDARD_RELEASE_GATES.filter(
        (gateKey) =>
          resolveLatestGateApprovals(latestActiveRelease.gateApprovals).get(gateKey)?.status ===
          "approved",
      ).length
    : 0;

  const formattedStartRange = formatShortIsoDate(earliestStart);
  const formattedEndRange = formatShortIsoDate(latestDue);
  const scheduleSpanLabel =
    formattedStartRange && formattedEndRange
      ? `${formattedStartRange} - ${formattedEndRange}`
      : null;

  const latestBoardMessage = getLatestBoardMessage(boardMessages);
  const workingMembersCount = roster.filter((member) => member.state === "working").length;
  const leadMember = roster.find((member) => member.isOwner) ?? roster[0] ?? null;

  const activeProject = overview?.project ?? null;
  const projectKey = activeProject?.key.trim() || null;
  const projectName = activeProject?.name.trim() || null;
  const blockerCount = blockedCards.length + botBlockedPrs.length;
  const heroStatusTone: CockpitTone =
    blockerCount > 0 ? "error" : activeCards.length > 0 ? "success" : "info";

  const projectCycles = activeProject?.workflowConfig.cycles ?? [];
  const projectMilestones = activeProject?.workflowConfig.milestones ?? [];
  const featuredCycle = selectFeaturedCycle(projectCycles);
  const featuredCycleProgress = featuredCycle ? computeCycleProgress(featuredCycle, cards) : null;
  const teamVelocity = computeTeamVelocity(projectCycles, cards);
  const featuredMilestones = selectFeaturedMilestones(projectMilestones).map((milestone) => ({
    milestone,
    progress: computeMilestoneProgress(milestone, cards),
  }));
  const cycleDisplayPct = featuredCycleProgress
    ? featuredCycleProgress.totalPoints > 0
      ? featuredCycleProgress.pointsCompletionPct
      : featuredCycleProgress.itemCompletionPct
    : 0;
  const featuredCycleStartLabel = featuredCycle
    ? formatShortIsoDate(featuredCycle.startDate)
    : null;
  const featuredCycleEndLabel = featuredCycle ? formatShortIsoDate(featuredCycle.endDate) : null;
  const cycleDateSpanLabel =
    featuredCycleStartLabel && featuredCycleEndLabel
      ? `${featuredCycleStartLabel} – ${featuredCycleEndLabel}`
      : null;

  return (
    <div className="space-y-6">
      <section aria-label={gt("Delivery Studio")}>
        <CockpitStudioBanner
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {onOpenIntake ? (
                <Button size="sm" variant="default" onClick={onOpenIntake}>
                  <PlusIcon />
                  {totalItems === 0 ? <T>Create Work Item & Draft PRD</T> : <T>New Work Item</T>}
                </Button>
              ) : null}
              <Button size="sm" variant="outline" onClick={() => onNavigateDelivery("kanban")}>
                <T>Open Delivery Board</T>
              </Button>
            </div>
          }
          art="hero_pipeline"
          description={
            totalItems === 0 ? (
              <T>
                Capture a requirement, draft an AI PRD and interactive prototype, then dispatch
                GitHub issues and PRs across your team.
              </T>
            ) : blockerCount > 0 ? (
              <T>
                <Plural
                  n={activeCards.length}
                  one={
                    <>
                      <Var>{activeCards.length}</Var> active work item
                    </>
                  }
                  other={
                    <>
                      <Var>{activeCards.length}</Var> active work items
                    </>
                  }
                />{" "}
                in motion with{" "}
                <Plural
                  n={blockerCount}
                  one={
                    <>
                      <Var>{blockerCount}</Var> blocker
                    </>
                  }
                  other={
                    <>
                      <Var>{blockerCount}</Var> blockers
                    </>
                  }
                />{" "}
                requiring attention.
              </T>
            ) : readyForReviewPrs.length > 0 ? (
              <T>
                <Plural
                  n={activeCards.length}
                  one={
                    <>
                      <Var>{activeCards.length}</Var> active work item
                    </>
                  }
                  other={
                    <>
                      <Var>{activeCards.length}</Var> active work items
                    </>
                  }
                />{" "}
                in flight and{" "}
                <Plural
                  n={readyForReviewPrs.length}
                  one={
                    <>
                      <Var>{readyForReviewPrs.length}</Var> PR
                    </>
                  }
                  other={
                    <>
                      <Var>{readyForReviewPrs.length}</Var> PRs
                    </>
                  }
                />{" "}
                awaiting human review.
              </T>
            ) : latestActiveRelease?.release.status === "ready" ? (
              <T>
                Release <Var>{latestActiveRelease.release.versionLabel}</Var> is ready to ship with
                all gates aligned across{" "}
                <Plural
                  n={totalItems}
                  one={
                    <>
                      <Var>{totalItems}</Var> work item
                    </>
                  }
                  other={
                    <>
                      <Var>{totalItems}</Var> work items
                    </>
                  }
                />
                .
              </T>
            ) : activeCards.length > 0 ? (
              <T>
                <Plural
                  n={activeCards.length}
                  one={
                    <>
                      <Var>{activeCards.length}</Var> active work item
                    </>
                  }
                  other={
                    <>
                      <Var>{activeCards.length}</Var> active work items
                    </>
                  }
                />{" "}
                flowing smoothly from specification through review and release.
              </T>
            ) : (
              <T>
                All{" "}
                <Plural
                  n={doneItems.length}
                  one={
                    <>
                      <Var>{doneItems.length}</Var> work item is
                    </>
                  }
                  other={
                    <>
                      <Var>{doneItems.length}</Var> work items are
                    </>
                  }
                />{" "}
                shipped. Capture the next requirement when ready.
              </T>
            )
          }
          eyebrow={
            <span className="inline-flex flex-wrap items-center gap-2">
              {projectKey ? (
                <span className="inline-flex items-center rounded-md border border-border/65 bg-background/75 px-1.5 py-0.5 font-mono text-2xs font-semibold tracking-wide text-foreground">
                  {projectKey}
                </span>
              ) : null}
              <span className="inline-flex items-center gap-1.5 text-2xs font-medium tracking-wide text-muted-foreground">
                <CockpitStatusDot
                  ring={activeCards.length > 0 || blockerCount > 0}
                  tone={heroStatusTone}
                />
                {totalItems === 0 ? (
                  <T>Ready to launch</T>
                ) : blockerCount > 0 ? (
                  <T>Attention needed</T>
                ) : (
                  <T>Live delivery</T>
                )}
              </span>
            </span>
          }
          meta={
            totalItems > 0 || openPrs.length > 0 || latestActiveRelease ? (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground tabular-nums">
                <span className="inline-flex items-center gap-1.5">
                  <CockpitStatusDot tone={activeCards.length > 0 ? "info" : "success"} />
                  <T>
                    <Var>{activeCards.length}</Var> active
                  </T>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <CockpitStatusDot
                    tone={
                      botBlockedPrs.length > 0
                        ? "error"
                        : readyForReviewPrs.length > 0
                          ? "warning"
                          : "neutral"
                    }
                  />
                  {readyForReviewPrs.length > 0 ? (
                    <T>
                      <Var>{readyForReviewPrs.length}</Var> awaiting review
                    </T>
                  ) : (
                    <T>
                      <Plural
                        n={openPrs.length}
                        one={
                          <>
                            <Var>{openPrs.length}</Var> open PR
                          </>
                        }
                        other={
                          <>
                            <Var>{openPrs.length}</Var> open PRs
                          </>
                        }
                      />
                    </T>
                  )}
                </span>
                {latestActiveRelease ? (
                  <span className="inline-flex items-center gap-1.5">
                    <CockpitStatusDot
                      tone={
                        latestActiveRelease.release.status === "ready" ||
                        latestActiveRelease.release.status === "released"
                          ? "success"
                          : "info"
                      }
                    />
                    <T>
                      <Var>{latestActiveRelease.release.versionLabel}</Var> ·{" "}
                      <Var>{releaseSignedCount}</Var>/3 signed
                    </T>
                  </span>
                ) : doneItems.length > 0 ? (
                  <span className="inline-flex items-center gap-1.5 text-success-foreground">
                    <CockpitStatusDot tone="success" />
                    <T>
                      <Var>{doneItems.length}</Var> shipped
                    </T>
                  </span>
                ) : null}
              </div>
            ) : undefined
          }
          title={
            projectName ? (
              <T>
                <Var>{projectName}</Var> Delivery Studio
              </T>
            ) : (
              <T>End-to-End AI Delivery Pipeline</T>
            )
          }
        />
      </section>

      {activeProject ? (
        <section aria-label={gt("Delivery Health")}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <button
              className="group flex min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 text-left shadow-xs ring-1 ring-inset ring-foreground/5 transition-colors hover:border-border hover:from-card/95 hover:to-card/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              type="button"
              onClick={() => onNavigateDelivery("kanban")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  <T>Delivery Completion</T>
                </span>
                <CockpitIconBadge
                  size="sm"
                  tone={totalItems > 0 && completionPct === 100 ? "success" : "primary"}
                >
                  <CheckCircle2Icon />
                </CockpitIconBadge>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  {doneItems.length}
                  <span className="text-sm font-normal text-muted-foreground">/{totalItems}</span>
                </span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    totalItems > 0 && completionPct === 100
                      ? "text-success-foreground"
                      : "text-foreground/80",
                  )}
                >
                  {completionPct}%
                </span>
              </div>

              <div className="space-y-1.5">
                <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted/55">
                  {completionPct > 0 ? (
                    <div
                      className="h-full rounded-full bg-success transition-[width]"
                      style={{ width: `${completionPct}%` }}
                    />
                  ) : null}
                </div>
                <div className="truncate text-2xs text-muted-foreground tabular-nums">
                  {totalItems === 0 ? (
                    <T>No work items yet</T>
                  ) : activeCards.length > 0 ? (
                    <T>
                      <Plural
                        n={activeCards.length}
                        one={
                          <>
                            <Var>{activeCards.length}</Var> item in progress
                          </>
                        }
                        other={
                          <>
                            <Var>{activeCards.length}</Var> items in progress
                          </>
                        }
                      />
                    </T>
                  ) : (
                    <T>All work items shipped</T>
                  )}
                </div>
              </div>
            </button>

            <button
              className="group flex min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 text-left shadow-xs ring-1 ring-inset ring-foreground/5 transition-colors hover:border-border hover:from-card/95 hover:to-card/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              type="button"
              onClick={() => onNavigateDelivery("kanban")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  <T>Acceptance Readiness</T>
                </span>
                <CockpitIconBadge
                  size="sm"
                  tone={
                    readinessTotalAc > 0 && acceptanceReadinessPct === 100
                      ? "success"
                      : readinessTotalAc > 0
                        ? "violet"
                        : "neutral"
                  }
                >
                  <ListChecksIcon />
                </CockpitIconBadge>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  {readinessVerifiedAc}
                  <span className="text-sm font-normal text-muted-foreground">
                    /{readinessTotalAc}
                  </span>
                </span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    readinessTotalAc > 0 && acceptanceReadinessPct === 100
                      ? "text-success-foreground"
                      : readinessTotalAc > 0
                        ? "text-guest-foreground"
                        : "text-muted-foreground",
                  )}
                >
                  {readinessTotalAc > 0 ? `${acceptanceReadinessPct}%` : "-"}
                </span>
              </div>

              <div className="space-y-1.5">
                <div aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted/55">
                  {readinessTotalAc > 0 && acceptanceReadinessPct > 0 ? (
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width]",
                        acceptanceReadinessPct === 100 ? "bg-success" : "bg-guest",
                      )}
                      style={{ width: `${acceptanceReadinessPct}%` }}
                    />
                  ) : null}
                </div>
                <div className="truncate text-2xs text-muted-foreground tabular-nums">
                  {readinessTotalAc === 0 ? (
                    <T>No checklists on active items</T>
                  ) : readinessVerifiedAc === readinessTotalAc ? (
                    <T>All acceptance criteria verified</T>
                  ) : (
                    <T>
                      <Plural
                        n={readinessTotalAc - readinessVerifiedAc}
                        one={
                          <>
                            <Var>{readinessTotalAc - readinessVerifiedAc}</Var> criterion remaining
                          </>
                        }
                        other={
                          <>
                            <Var>{readinessTotalAc - readinessVerifiedAc}</Var> criteria remaining
                          </>
                        }
                      />
                    </T>
                  )}
                </div>
              </div>
            </button>

            <button
              className={cn(
                "group flex min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-2xl border bg-linear-to-b from-card/85 to-card/45 p-4 text-left shadow-xs ring-1 ring-inset ring-foreground/5 transition-colors hover:from-card/95 hover:to-card/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                activeOverdueCount > 0
                  ? "border-destructive/30 hover:border-destructive/50"
                  : "border-border/60 hover:border-border",
              )}
              type="button"
              onClick={() => onNavigateDelivery("gantt")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  <T>Schedule Health</T>
                </span>
                <CockpitIconBadge
                  size="sm"
                  tone={
                    activeOverdueCount > 0
                      ? "error"
                      : activeCards.length > 0
                        ? "success"
                        : "neutral"
                  }
                >
                  <CalendarClockIcon />
                </CockpitIconBadge>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex items-baseline gap-1 font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  <span>{activeOnTrackCount}</span>
                  <span className="font-sans text-xs font-normal text-muted-foreground">
                    <T>on track</T>
                  </span>
                </span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    activeOverdueCount > 0 ? "text-destructive" : "text-success-foreground",
                  )}
                >
                  {activeOverdueCount > 0 ? (
                    <T>
                      <Var>{activeOverdueCount}</Var> overdue
                    </T>
                  ) : (
                    <T>On time</T>
                  )}
                </span>
              </div>

              <div className="space-y-1.5">
                <div
                  aria-hidden
                  className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/55"
                >
                  {activeCards.length > 0 && scheduleOnTrackPct > 0 ? (
                    <span
                      className="h-full bg-success transition-[width]"
                      style={{ width: `${scheduleOnTrackPct}%` }}
                    />
                  ) : null}
                  {activeCards.length > 0 && scheduleOverduePct > 0 ? (
                    <span
                      className="h-full bg-destructive transition-[width]"
                      style={{ width: `${scheduleOverduePct}%` }}
                    />
                  ) : null}
                </div>
                <div className="truncate text-2xs text-muted-foreground tabular-nums">
                  {activeCards.length === 0 ? (
                    <T>No active schedules</T>
                  ) : activeOverdueCount > 0 ? (
                    <T>
                      <Var>{scheduleOnTrackPct}</Var>% on schedule
                    </T>
                  ) : (
                    <T>
                      <Var>{explicitScheduleCount}</Var>/<Var>{totalItems}</Var> explicitly dated
                    </T>
                  )}
                </div>
              </div>
            </button>

            <button
              className={cn(
                "group flex min-w-0 cursor-pointer flex-col justify-between gap-3 rounded-2xl border bg-linear-to-b from-card/85 to-card/45 p-4 text-left shadow-xs ring-1 ring-inset ring-foreground/5 transition-colors hover:from-card/95 hover:to-card/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                botBlockedPrs.length > 0
                  ? "border-destructive/30 hover:border-destructive/50"
                  : "border-border/60 hover:border-border",
              )}
              type="button"
              onClick={() => onNavigateDelivery("triage")}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-medium text-muted-foreground">
                  <T>PR Audit Gate</T>
                </span>
                <CockpitIconBadge
                  size="sm"
                  tone={
                    botBlockedPrs.length > 0
                      ? "error"
                      : cleanReadyPrs.length > 0
                        ? "info"
                        : openPrs.length > 0
                          ? "warning"
                          : "success"
                  }
                >
                  <ShieldCheckIcon />
                </CockpitIconBadge>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="inline-flex items-baseline gap-1 font-mono text-lg font-semibold tracking-tight text-foreground tabular-nums">
                  <span>{cleanReadyPrs.length}</span>
                  <span className="font-sans text-xs font-normal text-muted-foreground">
                    <T>ready</T>
                  </span>
                </span>
                <span
                  className={cn(
                    "font-mono text-xs font-semibold tabular-nums",
                    botBlockedPrs.length > 0 ? "text-destructive" : "text-success-foreground",
                  )}
                >
                  {botBlockedPrs.length > 0 ? (
                    <T>
                      <Var>{botBlockedPrs.length}</Var> blocked
                    </T>
                  ) : (
                    <T>0 blocked</T>
                  )}
                </span>
              </div>

              <div className="space-y-1.5">
                <div
                  aria-hidden
                  className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted/55"
                >
                  {openPrs.length > 0 && prReadyPct > 0 ? (
                    <span
                      className="h-full bg-info transition-[width]"
                      style={{ width: `${prReadyPct}%` }}
                    />
                  ) : null}
                  {openPrs.length > 0 && prBlockedPct > 0 ? (
                    <span
                      className="h-full bg-destructive transition-[width]"
                      style={{ width: `${prBlockedPct}%` }}
                    />
                  ) : null}
                </div>
                <div className="truncate text-2xs text-muted-foreground tabular-nums">
                  {openPrs.length === 0 ? (
                    <T>No open pull requests</T>
                  ) : (
                    <T>
                      <Plural
                        n={openPrs.length}
                        one={
                          <>
                            <Var>{openPrs.length}</Var> open PR in audit queue
                          </>
                        }
                        other={
                          <>
                            <Var>{openPrs.length}</Var> open PRs in audit queue
                          </>
                        }
                      />
                    </T>
                  )}
                </div>
              </div>
            </button>
          </div>
        </section>
      ) : null}

      {activeProject ? (
        <section aria-label={gt("Agile Cadence & Roadmap")}>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="flex min-w-0 flex-col justify-between gap-3.5 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
              {featuredCycle && featuredCycleProgress ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <CockpitIconBadge
                        size="sm"
                        tone={
                          featuredCycle.status === "active"
                            ? "primary"
                            : featuredCycle.status === "completed"
                              ? "success"
                              : "info"
                        }
                      >
                        <RepeatIcon />
                      </CockpitIconBadge>
                      <span className="inline-flex shrink-0 items-center rounded-md border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-3xs font-semibold text-foreground tabular-nums">
                        <T>
                          Cycle <Var>{featuredCycle.number}</Var>
                        </T>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5 truncate text-xs font-medium text-muted-foreground">
                        <CockpitStatusDot
                          ring={featuredCycle.status === "active"}
                          tone={
                            featuredCycle.status === "active"
                              ? "success"
                              : featuredCycle.status === "completed"
                                ? "neutral"
                                : "info"
                          }
                        />
                        {featuredCycle.status === "active" ? (
                          <T>Active Cycle</T>
                        ) : featuredCycle.status === "upcoming" ? (
                          <T>Upcoming Cycle</T>
                        ) : (
                          <T>Completed Cycle</T>
                        )}
                      </span>
                    </div>

                    <div className="shrink-0">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onNavigateDelivery("cycles")}
                      >
                        <T>Open Cycles</T>
                        <ArrowRightIcon />
                      </Button>
                    </div>
                  </div>

                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-semibold text-foreground">
                        {featuredCycle.name}
                      </h3>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium tabular-nums",
                          featuredCycle.status === "completed"
                            ? "border-success/30 bg-success/10 text-success-foreground"
                            : featuredCycle.status === "upcoming"
                              ? "border-info/30 bg-info/10 text-info-foreground"
                              : featuredCycleProgress.daysRemaining <= 2
                                ? "border-warning/35 bg-warning/12 text-warning-foreground"
                                : "border-border/55 bg-muted/35 text-muted-foreground",
                        )}
                      >
                        {featuredCycle.status === "completed" ? (
                          <T>Completed</T>
                        ) : featuredCycle.status === "upcoming" ? (
                          featuredCycleStartLabel ? (
                            <T>
                              Starts <Var>{featuredCycleStartLabel}</Var>
                            </T>
                          ) : (
                            <T>Upcoming</T>
                          )
                        ) : featuredCycleProgress.daysRemaining === 0 ? (
                          <T>Ends today</T>
                        ) : (
                          <T>
                            <Plural
                              n={featuredCycleProgress.daysRemaining}
                              one={
                                <>
                                  <Var>{featuredCycleProgress.daysRemaining}</Var> day left
                                </>
                              }
                              other={
                                <>
                                  <Var>{featuredCycleProgress.daysRemaining}</Var> days left
                                </>
                              }
                            />
                          </T>
                        )}
                      </span>
                    </div>

                    {featuredCycle.goal?.trim() ? (
                      <p className="truncate text-xs text-muted-foreground">
                        {featuredCycle.goal.trim()}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-baseline justify-between gap-2 text-xs tabular-nums">
                      <div className="flex min-w-0 items-baseline gap-2">
                        <span className="font-mono font-semibold text-foreground">
                          {featuredCycleProgress.totalPoints > 0 ? (
                            <T>
                              <Var>{featuredCycleProgress.donePoints}</Var>/
                              <Var>{featuredCycleProgress.totalPoints}</Var> pt
                            </T>
                          ) : (
                            <T>
                              <Var>{featuredCycleProgress.doneItems}</Var>/
                              <Var>{featuredCycleProgress.totalItems}</Var> items
                            </T>
                          )}
                        </span>
                        {featuredCycleProgress.totalPoints > 0 ? (
                          <span className="font-mono text-2xs text-muted-foreground">
                            <T>
                              <Var>{featuredCycleProgress.doneItems}</Var>/
                              <Var>{featuredCycleProgress.totalItems}</Var> items
                            </T>
                          </span>
                        ) : null}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 font-mono text-xs font-semibold",
                          cycleDisplayPct >= 100 ? "text-success-foreground" : "text-foreground/80",
                        )}
                      >
                        {cycleDisplayPct}%
                      </span>
                    </div>

                    <div
                      aria-hidden
                      className="h-1.5 w-full overflow-hidden rounded-full bg-muted/55"
                    >
                      {cycleDisplayPct > 0 ? (
                        <div
                          className={cn(
                            "h-full rounded-full transition-[width]",
                            cycleDisplayPct >= 100
                              ? "bg-success"
                              : featuredCycleProgress.scopeHealth === "overcommitted"
                                ? "bg-destructive"
                                : featuredCycleProgress.scopeHealth === "at_risk"
                                  ? "bg-warning"
                                  : "bg-primary",
                          )}
                          style={{ width: `${Math.min(100, cycleDisplayPct)}%` }}
                        />
                      ) : null}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-2xs text-muted-foreground">
                    <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="inline-flex items-center gap-1.5 font-medium text-foreground/85">
                        <CockpitStatusDot
                          tone={cycleScopeHealthTone(featuredCycleProgress.scopeHealth)}
                        />
                        {cycleScopeHealthLabel(featuredCycleProgress.scopeHealth, gt)}
                      </span>
                      {cycleDateSpanLabel ? (
                        <span className="font-mono text-3xs tabular-nums text-muted-foreground/85">
                          {cycleDateSpanLabel}
                        </span>
                      ) : null}
                    </div>

                    {teamVelocity.completedCycles > 0 ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border/50 bg-muted/25 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-foreground/85">
                        {teamVelocity.trend === "up" ? (
                          <TrendingUpIcon
                            aria-hidden
                            className="size-3 shrink-0 text-success-foreground"
                          />
                        ) : teamVelocity.trend === "down" ? (
                          <TrendingDownIcon
                            aria-hidden
                            className="size-3 shrink-0 text-warning-foreground"
                          />
                        ) : null}
                        <T>
                          Velocity <Var>{teamVelocity.averagePoints}</Var> pt
                        </T>
                      </span>
                    ) : featuredCycleProgress.capacityPoints !== null ? (
                      <span className="inline-flex shrink-0 items-center rounded-sm border border-border/50 bg-muted/25 px-1.5 py-0.5 font-mono text-3xs tabular-nums text-muted-foreground">
                        <T>
                          Capacity <Var>{featuredCycleProgress.capacityPoints}</Var> pt
                        </T>
                      </span>
                    ) : null}
                  </div>
                </>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <CockpitIconBadge size="sm" tone="primary">
                        <RepeatIcon />
                      </CockpitIconBadge>
                      <span className="truncate text-xs font-medium text-foreground">
                        <T>Active Sprint Cycle</T>
                      </span>
                    </div>
                    <div className="shrink-0">
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onNavigateDelivery("cycles")}
                      >
                        <T>Start Cycle 1</T>
                        <ArrowRightIcon />
                      </Button>
                    </div>
                  </div>

                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <T>Plan 2-week delivery cycles with burndown &amp; velocity</T>
                  </p>

                  <div className="flex items-center gap-2 text-2xs text-muted-foreground tabular-nums">
                    <CockpitStatusDot tone={activeCards.length > 0 ? "info" : "neutral"} />
                    {activeCards.length > 0 ? (
                      <T>
                        <Plural
                          n={activeCards.length}
                          one={
                            <>
                              <Var>{activeCards.length}</Var> active item ready to scope
                            </>
                          }
                          other={
                            <>
                              <Var>{activeCards.length}</Var> active items ready to scope
                            </>
                          }
                        />
                      </T>
                    ) : (
                      <T>Track sprint scope, capacity pace, and team velocity</T>
                    )}
                  </div>
                </>
              )}
            </div>

            <div className="flex min-w-0 flex-col justify-between gap-3.5 rounded-2xl border border-border/60 bg-linear-to-b from-card/85 to-card/45 p-4 shadow-xs ring-1 ring-inset ring-foreground/5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <CockpitIconBadge
                    size="sm"
                    tone={featuredMilestones.length > 0 ? "info" : "neutral"}
                  >
                    <CompassIcon />
                  </CockpitIconBadge>
                  <span className="truncate text-xs font-medium text-foreground">
                    <T>Roadmap Now &amp; Next</T>
                  </span>
                  {projectMilestones.length > 0 ? (
                    <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                      {projectMilestones.length}
                    </span>
                  ) : null}
                </div>

                <div className="shrink-0">
                  <Button size="xs" variant="outline" onClick={() => onNavigateDelivery("roadmap")}>
                    {featuredMilestones.length > 0 ? <T>Open Roadmap</T> : <T>Plan Roadmap</T>}
                    <ArrowRightIcon />
                  </Button>
                </div>
              </div>

              {featuredMilestones.length > 0 ? (
                <div className="space-y-2.5">
                  {featuredMilestones.map(({ milestone, progress }) => {
                    const targetLabel = formatShortIsoDate(milestone.targetDate);
                    return (
                      <div key={milestone.id} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span
                              className={cn(
                                "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium",
                                horizonPillClass(milestone.horizon),
                              )}
                            >
                              {horizonLabel(milestone.horizon, gt)}
                            </span>
                            <span className="min-w-0 truncate text-xs font-medium text-foreground">
                              {milestone.name}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2 font-mono text-3xs tabular-nums">
                            {targetLabel ? (
                              <span className="text-muted-foreground">{targetLabel}</span>
                            ) : null}
                            <span
                              className={cn(
                                "font-semibold",
                                progress.completionPct >= 100
                                  ? "text-success-foreground"
                                  : progress.blockedItems > 0
                                    ? "text-destructive"
                                    : "text-foreground/85",
                              )}
                            >
                              {progress.completionPct}%
                            </span>
                          </div>
                        </div>

                        <div
                          aria-hidden
                          className="h-1 w-full overflow-hidden rounded-full bg-muted/55"
                        >
                          {progress.completionPct > 0 ? (
                            <div
                              className={cn(
                                "h-full rounded-full transition-[width]",
                                milestoneProgressBarClass(
                                  milestone.colorTone,
                                  progress.completionPct,
                                  progress.blockedItems,
                                ),
                              )}
                              style={{ width: `${Math.min(100, progress.completionPct)}%` }}
                            />
                          ) : null}
                        </div>
                      </div>
                    );
                  })}

                  {projectMilestones.length > 3 ? (
                    <div className="pt-0.5 text-2xs text-muted-foreground tabular-nums">
                      <T>
                        +<Var>{projectMilestones.length - 3}</Var> more on roadmap
                      </T>
                    </div>
                  ) : null}
                </div>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    <T>Organize work into Now / Next / Later development phases</T>
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium",
                        horizonPillClass("now"),
                      )}
                    >
                      {horizonLabel("now", gt)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium",
                        horizonPillClass("next"),
                      )}
                    >
                      {horizonLabel("next", gt)}
                    </span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium",
                        horizonPillClass("later"),
                      )}
                    >
                      {horizonLabel("later", gt)}
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>
        </section>
      ) : null}

      <section aria-label={gt("Delivery Pipeline")}>
        <CockpitSurface variant="grouped">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <h2 className="text-xs font-medium text-muted-foreground">
                <T>Delivery Pipeline</T>
              </h2>
              {doneItems.length > 0 ? (
                <span className="font-mono text-2xs tabular-nums text-success-foreground">
                  <T>
                    <Var>{doneItems.length}</Var> shipped
                  </T>
                </span>
              ) : null}
            </div>
            {onOpenIntake ? (
              <Button size="xs" variant="outline" onClick={onOpenIntake}>
                <PlusIcon />
                <T>New Requirement</T>
              </Button>
            ) : null}
          </div>

          <div className="grid grid-cols-2 gap-2.5 p-3.5 sm:grid-cols-4 md:grid-cols-7">
            {PIPELINE_STEPS.map((step) => {
              const stat = phaseStats.get(step.stage) ?? { count: 0, blocked: 0, overdue: 0 };
              const hasBottleneck = stat.blocked > 0 || stat.overdue > 0;
              const isActive = stat.count > 0;
              const badgeTone: OverviewBadgeTone =
                stat.blocked > 0
                  ? "error"
                  : stat.overdue > 0
                    ? "warning"
                    : isActive
                      ? step.activeTone
                      : "neutral";
              const fillBarClass =
                stat.blocked > 0
                  ? "bg-destructive"
                  : stat.overdue > 0
                    ? "bg-warning"
                    : step.barClass;
              const sharePct =
                isActive && activeCards.length > 0
                  ? Math.round((stat.count / activeCards.length) * 100)
                  : 0;
              const barWidthPct = sharePct > 0 ? Math.max(18, sharePct) : 0;

              return (
                <button
                  key={step.stage}
                  className={cn(
                    "flex min-w-0 cursor-pointer flex-col gap-2.5 rounded-xl border px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    hasBottleneck
                      ? "border-destructive/35 bg-linear-to-b from-destructive/10 to-card/45 hover:border-destructive/55 hover:from-destructive/14"
                      : isActive
                        ? "border-border/65 bg-linear-to-b from-card/85 to-card/40 shadow-2xs ring-1 ring-inset ring-foreground/4 hover:border-border hover:bg-accent/40"
                        : "border-border/40 bg-linear-to-b from-card/55 to-card/25 hover:border-border/65 hover:bg-accent/30",
                  )}
                  type="button"
                  onClick={() => onNavigateDelivery(step.targetSubView)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <CockpitIconBadge size="sm" tone={badgeTone}>
                      <CockpitStageArtworkIcon stage={step.stage} />
                    </CockpitIconBadge>
                    <span
                      className={cn(
                        "font-mono text-base leading-none tabular-nums",
                        stat.blocked > 0
                          ? "font-semibold text-destructive"
                          : stat.overdue > 0
                            ? "font-semibold text-warning-foreground"
                            : isActive
                              ? "font-semibold text-foreground"
                              : "font-medium text-muted-foreground/50",
                      )}
                    >
                      {stat.count}
                    </span>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between gap-1.5">
                      <span
                        className={cn(
                          "min-w-0 truncate text-xs",
                          isActive ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {pipelineStageLabel(step.stage, gt)}
                      </span>
                      {sharePct > 0 ? (
                        <span className="shrink-0 font-mono text-3xs tabular-nums text-muted-foreground/75">
                          {sharePct}%
                        </span>
                      ) : null}
                    </div>
                    <div
                      aria-hidden
                      className="h-1 w-full overflow-hidden rounded-full bg-muted/60"
                    >
                      {barWidthPct > 0 ? (
                        <div
                          className={cn("h-full rounded-full", fillBarClass)}
                          style={{ width: `${barWidthPct}%` }}
                        />
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </CockpitSurface>
      </section>

      {priorityActions.length > 0 ? (
        <section aria-label={gt("Priority Next Actions")}>
          <CockpitSurface variant="grouped">
            <div className="flex items-center justify-between gap-2 border-b border-border/45 px-4 py-3">
              <div className="flex items-center gap-2">
                <CockpitStatusDot ring tone={priorityHeaderDotTone} />
                <h2 className="text-sm font-medium text-foreground">
                  <T>Priority Next Actions</T>
                </h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {priorityActions.length}
                </span>
              </div>
              <span className="hidden text-2xs text-muted-foreground sm:inline">
                <T>Highest-leverage team decisions</T>
              </span>
            </div>

            <div className="divide-y divide-border/45">
              {priorityActions.map((action) => (
                <div
                  key={action.key}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 transition-colors hover:bg-accent/25 sm:flex-nowrap"
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3">
                    <CockpitIconBadge className="mt-0.5" size="sm" tone={action.tone}>
                      {renderPriorityActionIcon(action.iconKind)}
                    </CockpitIconBadge>
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className={cn(
                            "inline-flex shrink-0 items-center rounded-sm border px-1.5 py-px font-mono text-3xs font-medium",
                            action.tone === "error"
                              ? "border-destructive/30 bg-destructive/8 text-destructive"
                              : action.tone === "warning"
                                ? "border-warning/35 bg-warning/10 text-warning-foreground"
                                : action.tone === "violet"
                                  ? "border-guest/30 bg-guest/10 text-guest-foreground"
                                  : action.tone === "success"
                                    ? "border-success/30 bg-success/10 text-success-foreground"
                                    : "border-info/30 bg-info/10 text-info-foreground",
                          )}
                        >
                          {action.categoryLabel}
                        </span>
                        <span className="min-w-0 truncate text-sm font-medium text-foreground">
                          {action.title}
                        </span>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">{action.reason}</p>
                    </div>
                  </div>

                  <div className="shrink-0">
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => handlePriorityAction(action.target)}
                    >
                      <span>{action.ctaLabel}</span>
                      <ArrowRightIcon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </CockpitSurface>
        </section>
      ) : totalItems > 0 ? (
        <section aria-label={gt("Priority Next Actions")}>
          <div className="flex items-center justify-between gap-3 rounded-xl border border-success/25 bg-linear-to-r from-success/8 via-card/65 to-card/45 px-4 py-2.5 text-xs shadow-2xs ring-1 ring-inset ring-foreground/4">
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitStatusDot ring tone="success" />
              <span className="font-medium text-foreground">
                <T>All clear: pipeline flowing smoothly</T>
              </span>
            </div>
            <span className="hidden shrink-0 font-mono text-2xs text-muted-foreground sm:inline">
              <T>No urgent actions</T>
            </span>
          </div>
        </section>
      ) : null}

      {totalItems > 0 || visibleActiveRows.length > 0 || selectedMember ? (
        <section aria-label={gt("Active Now")}>
          <CockpitSurface variant="grouped">
            <div className="flex items-center justify-between gap-2 border-b border-border/45 px-4 py-3">
              <div className="flex items-center gap-2">
                <CockpitStatusDot
                  ring={visibleActiveRows.length > 0}
                  tone={visibleActiveRows.length > 0 ? "success" : "neutral"}
                />
                <h2 className="text-sm font-medium text-foreground">
                  <T>Active Now</T>
                </h2>
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  {visibleActiveRows.length}
                </span>
              </div>

              {selectedMember ? (
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">
                    @{selectedMember.handle}
                  </span>
                  <Button
                    size="micro"
                    variant="ghost-muted"
                    onClick={() => setSelectedHandle(null)}
                  >
                    <T>Show all</T>
                  </Button>
                </div>
              ) : null}
            </div>

            {visibleActiveRows.length === 0 ? (
              <div className="px-4 py-7 text-center text-xs text-muted-foreground">
                {selectedMember ? (
                  <T>
                    No active work items or open reviews for <Var>@{selectedMember.handle}</Var>.
                  </T>
                ) : (
                  <T>Nothing active right now. Everything in this project is clear.</T>
                )}
              </div>
            ) : (
              <div className="divide-y divide-border/45">
                {visibleActiveRows.slice(0, 8).map((row) => (
                  <button
                    key={row.key}
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3.5 text-left transition-colors hover:bg-accent/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    type="button"
                    onClick={() => {
                      if (row.kind === "work_item") {
                        onOpenWorkItem(row.card.workItem.id);
                      } else {
                        onOpenChangeRequest(row.cr);
                      }
                    }}
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      {row.kind === "work_item" ? (
                        <CockpitIconBadge
                          className="mt-0.5"
                          size="sm"
                          tone={workItemBadgeTone(
                            row.card.workItem.itemType,
                            row.card.workItem.health,
                          )}
                        >
                          <CockpitArtifactIcon kind={row.card.workItem.itemType} />
                        </CockpitIconBadge>
                      ) : (
                        <CockpitIconBadge
                          className="mt-0.5"
                          size="sm"
                          tone={changeRequestBadgeTone(row.cr)}
                        >
                          <CockpitStageArtworkIcon stage="pr" />
                        </CockpitIconBadge>
                      )}
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="block truncate text-sm font-medium text-foreground">
                          {row.title}
                        </span>
                        <div className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
                          <span className="min-w-0 truncate">{row.detail}</span>
                          {row.cues.length > 0 ? (
                            <span className="hidden shrink-0 items-center gap-1.5 font-mono text-2xs sm:inline-flex">
                              {row.cues.map((cue) => (
                                <span
                                  key={cue.key}
                                  className={cn(
                                    "inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 tabular-nums",
                                    cue.tone === "error"
                                      ? "border-destructive/35 bg-destructive/8 text-destructive"
                                      : cue.tone === "success"
                                        ? "border-success/30 bg-success/8 text-success-foreground"
                                        : "border-border/45 bg-muted/20 text-muted-foreground",
                                  )}
                                >
                                  {renderCueIcon(cue.iconKind)}
                                  <span
                                    className={
                                      cue.iconKind === "branch" ? "max-w-24 truncate" : undefined
                                    }
                                  >
                                    {cue.text}
                                  </span>
                                </span>
                              ))}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {row.ownerHandle ? (
                      <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border/45 bg-muted/25 py-0.5 pr-2 pl-1 text-xs text-muted-foreground">
                        <CockpitSwarmAvatar
                          displayName={row.ownerDisplayName}
                          handle={row.ownerHandle}
                          kind={row.ownerKind}
                          size="sm"
                        />
                        <span className="max-w-28 truncate font-mono text-2xs">
                          @{row.ownerHandle}
                        </span>
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </CockpitSurface>
        </section>
      ) : null}

      <section aria-label={gt("Project progress")}>
        <CockpitSurface className="overflow-hidden" variant="grouped">
          <div className="flex flex-wrap items-center gap-3 px-4 py-3">
            <svg aria-hidden className="size-5 shrink-0 -rotate-90" viewBox="0 0 20 20">
              <circle
                className="text-muted/60"
                cx="10"
                cy="10"
                fill="none"
                r={ringRadius}
                stroke="currentColor"
                strokeWidth="2.2"
              />
              <circle
                className="text-success"
                cx="10"
                cy="10"
                fill="none"
                r={ringRadius}
                stroke="currentColor"
                strokeDasharray={ringCircumference}
                strokeDashoffset={ringDashOffset}
                strokeLinecap="round"
                strokeWidth="2.2"
              />
            </svg>

            <div className="flex min-w-0 flex-wrap items-center gap-2 text-xs">
              <span className="font-medium text-foreground tabular-nums">
                {totalItems > 0 ? (
                  <T>
                    <Var>{doneItems.length}</Var> of <Var>{totalItems}</Var> items done
                  </T>
                ) : (
                  <T>No work items yet</T>
                )}
              </span>
              {totalAcCount > 0 ? (
                <span className="text-muted-foreground tabular-nums">
                  <T>
                    · <Var>{verifiedAcCount}</Var>/<Var>{totalAcCount}</Var> ACs verified
                  </T>
                </span>
              ) : null}
              {overdueCount > 0 ? (
                <span className="font-medium text-destructive tabular-nums">
                  <T>
                    · <Var>{overdueCount}</Var> overdue
                  </T>
                </span>
              ) : null}
              {readyForReviewPrs.length > 0 ? (
                <span className="text-info-foreground tabular-nums">
                  <T>
                    · <Var>{readyForReviewPrs.length}</Var> ready for review
                  </T>
                </span>
              ) : null}
            </div>

            <div
              aria-hidden
              className="hidden h-1.5 max-w-44 flex-1 overflow-hidden rounded-full bg-muted/50 sm:flex"
            >
              {donePct > 0 ? (
                <span className="h-full bg-success" style={{ width: `${donePct}%` }} />
              ) : null}
              {movingPct > 0 ? (
                <span className="h-full bg-info" style={{ width: `${movingPct}%` }} />
              ) : null}
              {blockedPct > 0 ? (
                <span className="h-full bg-destructive" style={{ width: `${blockedPct}%` }} />
              ) : null}
            </div>

            <div className="ml-auto">
              <Button
                aria-expanded={prsExpanded}
                size="xs"
                variant="ghost-muted"
                onClick={() => setPrsExpanded((prev) => !prev)}
              >
                <span className="tabular-nums">
                  <T>
                    <Plural
                      n={openPrs.length}
                      one={
                        <>
                          <Var>{openPrs.length}</Var> open PR
                        </>
                      }
                      other={
                        <>
                          <Var>{openPrs.length}</Var> open PRs
                        </>
                      }
                    />
                  </T>
                </span>
                {prsExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
              </Button>
            </div>
          </div>

          {prsExpanded ? (
            <div className="divide-y divide-border/45 border-t border-border/45 bg-muted/10">
              {openPrs.length === 0 ? (
                <div className="px-4 py-3 text-xs text-muted-foreground">
                  <T>No open pull requests right now.</T>
                </div>
              ) : (
                openPrs.map((cr) => (
                  <button
                    key={cr.id}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-2.5 text-left text-xs transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                    type="button"
                    onClick={() => onOpenChangeRequest(cr)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <CockpitStatusDot tone={changeRequestTone(cr)} />
                      <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                        {cr.repoFullName}#{cr.number}
                      </span>
                      <span className="truncate font-medium text-foreground">{cr.title}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-2.5 text-2xs text-muted-foreground">
                      <span className="hidden font-mono sm:inline">@{cr.authorVcsLogin}</span>
                      <CockpitDiffStat additions={cr.additions} deletions={cr.deletions} />
                    </div>
                  </button>
                ))
              )}
            </div>
          ) : null}
        </CockpitSurface>
      </section>

      <section aria-label={gt("Delivery Tracks")} className="space-y-1.5">
        <CockpitSectionHeader title={<T>Delivery Tracks</T>} />
        <CockpitSurface divided variant="grouped">
          <button
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
            onClick={() => onNavigateDelivery("kanban")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitIconBadge
                size="sm"
                tone={
                  blockedCards.length > 0 ? "error" : activeCards.length > 0 ? "info" : "success"
                }
              >
                <CockpitStageArtworkIcon stage="dev" />
              </CockpitIconBadge>
              <span className="text-sm font-medium text-foreground">
                <T>Kanban Board</T>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {blockedCards.length > 0 ? (
                  <T>Blocked</T>
                ) : activeCards.length > 0 ? (
                  <T>Moving</T>
                ) : (
                  <T>All clear</T>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span
                aria-hidden
                className="hidden h-1.5 w-14 overflow-hidden rounded-full bg-muted/50 sm:flex"
              >
                {donePct > 0 ? (
                  <span className="h-full bg-success" style={{ width: `${donePct}%` }} />
                ) : null}
                {movingPct > 0 ? (
                  <span className="h-full bg-info" style={{ width: `${movingPct}%` }} />
                ) : null}
                {blockedPct > 0 ? (
                  <span className="h-full bg-destructive" style={{ width: `${blockedPct}%` }} />
                ) : null}
              </span>
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {activeCards.length}/{totalItems}
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground/70" />
            </div>
          </button>

          <button
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
            onClick={() => onNavigateDelivery("gantt")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitIconBadge
                size="sm"
                tone={overdueCount > 0 ? "error" : totalItems > 0 ? "primary" : "neutral"}
              >
                <CalendarRangeIcon />
              </CockpitIconBadge>
              <span className="text-sm font-medium text-foreground">
                <T>Gantt Timeline</T>
              </span>
              <span className="truncate font-mono text-xs text-muted-foreground">
                {scheduleSpanLabel ?? <T>No schedule yet</T>}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              {overdueCount > 0 ? (
                <span className="font-mono text-xs font-medium tabular-nums text-destructive">
                  <T>
                    <Var>{overdueCount}</Var> overdue
                  </T>
                </span>
              ) : (
                <span className="font-mono text-xs tabular-nums text-muted-foreground">
                  <T>
                    <Var>{explicitScheduleCount}</Var>/<Var>{totalItems}</Var> dated
                  </T>
                </span>
              )}
              <ChevronRightIcon className="size-4 text-muted-foreground/70" />
            </div>
          </button>

          <button
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
            onClick={() => onNavigateDelivery("triage")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitIconBadge
                size="sm"
                tone={
                  botBlockedPrs.length > 0
                    ? "error"
                    : readyForReviewPrs.length > 0
                      ? "warning"
                      : "success"
                }
              >
                <CockpitStageArtworkIcon stage="review" />
              </CockpitIconBadge>
              <span className="text-sm font-medium text-foreground">
                <T>PR Reviews</T>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {botBlockedPrs.length > 0 ? (
                  <T>
                    <Var>{botBlockedPrs.length}</Var> bot blocked
                  </T>
                ) : readyForReviewPrs.length > 0 ? (
                  <T>
                    <Var>{readyForReviewPrs.length}</Var> ready for review
                  </T>
                ) : (
                  <T>Queue clear</T>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                <T>
                  <Var>{openPrs.length}</Var> open
                </T>
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground/70" />
            </div>
          </button>

          <button
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
            onClick={() => onNavigateDelivery("releases")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitIconBadge
                size="sm"
                tone={
                  latestActiveRelease?.release.status === "ready" ||
                  latestActiveRelease?.release.status === "released"
                    ? "success"
                    : latestActiveRelease
                      ? "violet"
                      : "neutral"
                }
              >
                <CockpitStageArtworkIcon stage="release" />
              </CockpitIconBadge>
              <span className="text-sm font-medium text-foreground">
                <T>Release Train</T>
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {latestActiveRelease ? (
                  <T>
                    <Var>{latestActiveRelease.release.versionLabel}</Var> ·{" "}
                    <Var>{releaseStatusLabel(latestActiveRelease.release.status, gt)}</Var>
                  </T>
                ) : (
                  <T>No active release</T>
                )}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2.5">
              <span className="font-mono text-xs tabular-nums text-muted-foreground">
                {latestActiveRelease ? (
                  <T>
                    <Var>{releaseSignedCount}</Var>/3 signed
                  </T>
                ) : (
                  <T>Plan</T>
                )}
              </span>
              <ChevronRightIcon className="size-4 text-muted-foreground/70" />
            </div>
          </button>
        </CockpitSurface>
      </section>

      <section aria-label={gt("The team")} className="space-y-2.5">
        <CockpitSectionHeader
          action={
            <Button size="micro" variant="ghost-muted" onClick={onNavigateMembers}>
              <T>View all</T>
            </Button>
          }
          count={roster.length}
          title={<T>The team</T>}
        />

        <CockpitSurface padding="md" variant="grouped">
          {selectedMember ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <CockpitSwarmAvatar
                    displayName={selectedMember.displayName}
                    handle={selectedMember.handle}
                    kind={selectedMember.kind}
                    presence={selectedMember.state}
                    size="lg"
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        @{selectedMember.handle}
                      </span>
                      {selectedMember.isOwner ? (
                        <Badge size="sm" variant="secondary">
                          <T>Owner</T>
                        </Badge>
                      ) : null}
                      {selectedMember.kind === "agent" ? (
                        <Badge size="sm" variant="info">
                          <T>Agent</T>
                        </Badge>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="truncate">{selectedMember.displayName}</span>
                      {selectedMember.subtitle ? (
                        <span className="truncate opacity-80">· {selectedMember.subtitle}</span>
                      ) : null}
                      <span
                        className={cn(
                          "font-medium",
                          selectedMember.state === "working"
                            ? "text-info-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        · {selectedMember.state === "working" ? <T>Working</T> : <T>Standing by</T>}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => onNavigateBoard({ mentionHandle: selectedMember.handle })}
                  >
                    <AtSignIcon />
                    <T>Mention</T>
                  </Button>
                  <Button
                    size="xs"
                    variant="ghost-muted"
                    onClick={() => onNavigateBoard({ filterHandle: selectedMember.handle })}
                  >
                    <T>Filter Board</T>
                  </Button>
                </div>
              </div>

              {selectedMember.currentActivity ? (
                <div className="rounded-lg border border-border/45 bg-muted/20 px-3 py-2 text-xs">
                  {selectedMember.currentWorkItemId ? (
                    <button
                      className="cursor-pointer text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      type="button"
                      onClick={() => {
                        if (selectedMember.currentWorkItemId) {
                          onOpenWorkItem(selectedMember.currentWorkItemId);
                        }
                      }}
                    >
                      {selectedMember.currentActivity}
                    </button>
                  ) : selectedMember.currentChangeRequestId &&
                    openPrMap.has(selectedMember.currentChangeRequestId) ? (
                    <button
                      className="cursor-pointer text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      type="button"
                      onClick={() => {
                        const matched = selectedMember.currentChangeRequestId
                          ? openPrMap.get(selectedMember.currentChangeRequestId)
                          : undefined;
                        if (matched) {
                          onOpenChangeRequest(matched);
                        }
                      }}
                    >
                      {selectedMember.currentActivity}
                    </button>
                  ) : (
                    <span className="font-medium text-foreground">
                      {selectedMember.currentActivity}
                    </span>
                  )}
                </div>
              ) : null}

              {selectedMember.latestPost ? (
                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  <span className="mr-1.5 font-mono text-2xs text-muted-foreground/75">
                    #{selectedMember.latestPost.seq}
                  </span>
                  {selectedMember.latestPost.body}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <T>No board posts yet.</T>
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  {leadMember ? (
                    <CockpitSwarmAvatar
                      displayName={leadMember.displayName}
                      handle={leadMember.handle}
                      kind={leadMember.kind}
                      presence={leadMember.state}
                      size="lg"
                    />
                  ) : (
                    <CockpitAllTeamAvatar size="lg" />
                  )}
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-medium text-foreground">
                        {leadMember ? (
                          <span className="font-mono">@{leadMember.handle}</span>
                        ) : (
                          <T>Team Overview</T>
                        )}
                      </span>
                      {leadMember?.isOwner ? (
                        <Badge size="sm" variant="secondary">
                          <T>Owner</T>
                        </Badge>
                      ) : null}
                    </div>
                    <div className="text-xs text-muted-foreground tabular-nums">
                      <T>
                        <Var>{workingMembersCount}</Var> working ·{" "}
                        <Plural
                          n={roster.length}
                          one={
                            <>
                              <Var>{roster.length}</Var> member
                            </>
                          }
                          other={
                            <>
                              <Var>{roster.length}</Var> members
                            </>
                          }
                        />
                      </T>
                    </div>
                  </div>
                </div>

                <Button size="xs" variant="outline" onClick={() => onNavigateBoard()}>
                  <MessageSquareIcon />
                  <T>Open Board</T>
                </Button>
              </div>

              {latestBoardMessage ? (
                <div className="rounded-lg border border-border/45 bg-muted/20 px-3 py-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2 font-mono text-2xs text-muted-foreground">
                    <span>@{latestBoardMessage.authorHandle}</span>
                    <span>#{latestBoardMessage.seq}</span>
                  </div>
                  <p className="line-clamp-2 leading-relaxed text-foreground/90">
                    {latestBoardMessage.body}
                  </p>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  <T>No board updates yet. Post a handoff or status note to coordinate the team.</T>
                </p>
              )}
            </div>
          )}
        </CockpitSurface>

        <div className="flex items-start gap-1.5 overflow-x-auto pb-1">
          <button
            aria-pressed={selectedMember === null}
            className={cn(
              "flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1.5 text-center transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
              selectedMember === null && "bg-accent/45",
            )}
            type="button"
            onClick={() => setSelectedHandle(null)}
          >
            <CockpitAllTeamAvatar selected={selectedMember === null} size="lg" />
            <span className="w-full truncate text-2xs font-medium text-muted-foreground">
              <T>All</T>
            </span>
          </button>

          {roster.map((member) => {
            const isSelected = selectedMember?.handle === member.handle;
            return (
              <button
                key={member.handle}
                aria-pressed={isSelected}
                className={cn(
                  "flex w-16 shrink-0 cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1.5 text-center transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isSelected && "bg-accent/45",
                )}
                type="button"
                onClick={() => setSelectedHandle(isSelected ? null : member.handle)}
              >
                <CockpitSwarmAvatar
                  displayName={member.displayName}
                  handle={member.handle}
                  kind={member.kind}
                  presence={member.state}
                  selected={isSelected}
                  size="lg"
                />
                <span className="w-full truncate font-mono text-2xs text-muted-foreground">
                  @{member.handle}
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
