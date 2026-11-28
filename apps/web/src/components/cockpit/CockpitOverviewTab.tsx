import {
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  type ChangeRequestAudit,
  type CockpitOverview,
  type CockpitWorkItemCard,
  type ReleaseCard,
  type ReleaseStatus,
  type TeamBoardMessage,
  type WorkItemType,
} from "@u3code/hub-contracts";
import { Plural, T, useGT, Var } from "gt-react";
import {
  AtSignIcon,
  CalendarClockIcon,
  CalendarRangeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MessageSquareIcon,
  PlusIcon,
} from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  CockpitArtifactIcon,
  CockpitIllustration,
  CockpitStageArtworkIcon,
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

export type OverviewDeliverySubView = "kanban" | "gantt" | "triage" | "releases";

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

type ActiveNowRow =
  | {
      readonly key: string;
      readonly kind: "work_item";
      readonly tone: CockpitTone;
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
      readonly tone: CockpitTone;
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

function workItemHealthTone(health: string): CockpitTone {
  if (health === "blocked") return "error";
  if (health === "at_risk") return "warning";
  return "info";
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
      tone: workItemHealthTone(card.workItem.health),
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
      tone: changeRequestTone(cr),
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

  return (
    <div className="space-y-6">
      {totalItems === 0 ? (
        <section aria-label={gt("Get started")}>
          <CockpitSurface className="overflow-hidden" variant="grouped">
            <div className="flex flex-col items-center gap-5 px-5 py-6 sm:flex-row sm:items-center sm:px-6">
              <div className="shrink-0 rounded-xl border border-border/45 bg-muted/20 p-2.5">
                <CockpitIllustration className="h-24 w-52 sm:w-56" kind="delivery_banner" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5 text-center sm:text-left">
                <h2 className="text-base font-semibold tracking-tight text-foreground">
                  <T>Launch your delivery pipeline</T>
                </h2>
                <p className="max-w-xl text-xs leading-relaxed text-muted-foreground">
                  <T>
                    Capture a requirement, draft an AI PRD and interactive prototype, then dispatch
                    GitHub issues and PRs across your team.
                  </T>
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2 pt-2 sm:justify-start">
                  {onOpenIntake ? (
                    <Button size="sm" variant="default" onClick={onOpenIntake}>
                      <PlusIcon />
                      <T>Create Work Item & Draft PRD</T>
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => onNavigateDelivery("kanban")}>
                    <T>Open Delivery Board</T>
                  </Button>
                </div>
              </div>
            </div>
          </CockpitSurface>
        </section>
      ) : null}

      <section aria-label={gt("Delivery Pipeline")}>
        <CockpitSurface variant="grouped">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/45 px-4 py-2.5">
            <div className="flex items-center gap-2">
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

          <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4 md:grid-cols-7">
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
              const barWidthPct =
                isActive && activeCards.length > 0
                  ? Math.max(18, Math.round((stat.count / activeCards.length) * 100))
                  : 0;

              return (
                <button
                  key={step.stage}
                  className={cn(
                    "flex min-w-0 cursor-pointer flex-col gap-2 rounded-lg border px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                    hasBottleneck
                      ? "border-destructive/35 bg-destructive/6 hover:border-destructive/50 hover:bg-destructive/10"
                      : isActive
                        ? "border-border/65 bg-background/80 shadow-2xs hover:border-border hover:bg-accent/45"
                        : "border-border/35 bg-muted/15 hover:border-border/60 hover:bg-accent/30",
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
                        "font-mono text-sm tabular-nums",
                        stat.blocked > 0
                          ? "font-semibold text-destructive"
                          : stat.overdue > 0
                            ? "font-semibold text-warning-foreground"
                            : isActive
                              ? "font-semibold text-foreground"
                              : "font-medium text-muted-foreground/55",
                      )}
                    >
                      {stat.count}
                    </span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        className={cn(
                          "truncate text-xs",
                          isActive ? "font-medium text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {pipelineStageLabel(step.stage, gt)}
                      </span>
                      {stat.blocked > 0 ? (
                        <CockpitStatusDot tone="error" />
                      ) : stat.overdue > 0 ? (
                        <CockpitStatusDot tone="warning" />
                      ) : null}
                    </div>
                    <div
                      aria-hidden
                      className="h-1 w-full overflow-hidden rounded-full bg-muted/55"
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
                    className="flex w-full cursor-pointer items-center justify-between gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                        <div className="flex min-w-0 items-center gap-2">
                          <CockpitStatusDot tone={row.tone} />
                          <span className="truncate text-sm font-medium text-foreground">
                            {row.title}
                          </span>
                        </div>
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
