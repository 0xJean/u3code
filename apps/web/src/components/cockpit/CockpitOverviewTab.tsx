import {
  resolveLatestGateApprovals,
  type ChangeRequestAudit,
  type CockpitOverview,
  type CockpitWorkItemCard,
  type ReleaseCard,
  type ReleaseStatus,
  type TeamBoardMessage,
} from "@u3code/hub-contracts";
import { Plural, T, useGT, Var } from "gt-react";
import { AtSignIcon, ChevronDownIcon, ChevronRightIcon, MessageSquareIcon } from "lucide-react";
import { useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";
import {
  CockpitDiffStat,
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

export interface CockpitOverviewTabProps {
  readonly overview: CockpitOverview | null;
  readonly reviewItems: readonly ChangeRequestAudit[];
  readonly releases: readonly ReleaseCard[];
  readonly roster: readonly CockpitTeamMember[];
  readonly boardMessages: readonly TeamBoardMessage[];
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenChangeRequest: (cr: ChangeRequestAudit) => void;
  readonly onNavigateDelivery: (subView: "kanban" | "triage" | "releases") => void;
  readonly onNavigateBoard: (opts?: { mentionHandle?: string; filterHandle?: string }) => void;
  readonly onNavigateMembers: () => void;
}

const STANDARD_RELEASE_GATES = ["qa_ac_pass", "security_clear", "prod_go"] as const;

type ActiveNowRow =
  | {
      readonly key: string;
      readonly kind: "work_item";
      readonly tone: CockpitTone;
      readonly title: string;
      readonly detail: string;
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
      readonly ownerHandle: string | null;
      readonly ownerDisplayName: string;
      readonly ownerKind: "human" | "agent";
      readonly memberHandles: ReadonlySet<string>;
      readonly cr: ChangeRequestAudit;
    };

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

function changeRequestTone(cr: ChangeRequestAudit): CockpitTone {
  if (cr.triageBucket === "bot_blocked" || cr.triageBucket === "ci_blocked") return "error";
  if (cr.triageBucket === "orphan") return "warning";
  if (cr.triageBucket === "ready_for_human_review") return "info";
  return "neutral";
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
}: CockpitOverviewTabProps) {
  const gt = useGT();
  const [selectedHandle, setSelectedHandle] = useState<string | null>(null);
  const [prsExpanded, setPrsExpanded] = useState(false);

  const cards = overview?.cards ?? [];
  const totalItems = cards.length;
  const doneItems = cards.filter((card) => isWorkItemDoneStage(card.workItem.stage));
  const activeCards = cards.filter((card) => !isWorkItemDoneStage(card.workItem.stage));
  const blockedCards = activeCards.filter((card) => card.workItem.health === "blocked");

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

    allActiveRows.push({
      key: `wi:${card.workItem.id}`,
      kind: "work_item",
      tone: workItemHealthTone(card.workItem.health),
      title: `${card.workItem.code} · ${card.workItem.title}`,
      detail: pulseSummary,
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
      : `${cr.headBranch} → ${cr.baseBranch}`;

    allActiveRows.push({
      key: `cr:${cr.id}`,
      kind: "change_request",
      tone: changeRequestTone(cr),
      title: `${cr.repoFullName}#${cr.number} · ${cr.title}`,
      detail,
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

  const latestBoardMessage = getLatestBoardMessage(boardMessages);
  const workingMembersCount = roster.filter((member) => member.state === "working").length;
  const leadMember = roster.find((member) => member.isOwner) ?? roster[0] ?? null;

  return (
    <div className="space-y-6">
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
                <Button size="micro" variant="ghost-muted" onClick={() => setSelectedHandle(null)}>
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
                  <div className="flex min-w-0 flex-1 items-start gap-2.5">
                    <CockpitStatusDot className="mt-1.5" tone={row.tone} />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <div className="truncate text-sm font-medium text-foreground">
                        {row.title}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{row.detail}</div>
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

      <section aria-label={gt("Tracks")} className="space-y-1.5">
        <CockpitSectionHeader title={<T>Tracks</T>} />
        <CockpitSurface divided variant="grouped">
          <button
            className="flex w-full cursor-pointer items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            type="button"
            onClick={() => onNavigateDelivery("kanban")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitStatusDot
                tone={
                  blockedCards.length > 0 ? "error" : activeCards.length > 0 ? "info" : "success"
                }
              />
              <span className="text-sm font-medium text-foreground">
                <T>Work Items</T>
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
            onClick={() => onNavigateDelivery("triage")}
          >
            <div className="flex min-w-0 items-center gap-2.5">
              <CockpitStatusDot
                tone={
                  botBlockedPrs.length > 0
                    ? "error"
                    : readyForReviewPrs.length > 0
                      ? "info"
                      : "success"
                }
              />
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
              <CockpitStatusDot
                tone={
                  latestActiveRelease?.release.status === "ready" ||
                  latestActiveRelease?.release.status === "released"
                    ? "success"
                    : latestActiveRelease
                      ? "info"
                      : "neutral"
                }
              />
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
