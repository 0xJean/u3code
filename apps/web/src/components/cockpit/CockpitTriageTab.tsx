import type { TeamHubReviewQueueResult } from "@t3tools/contracts";
import {
  recommendPrMergeStrategy,
  type ChangeRequestAudit,
  type CockpitWorkItemCard,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  BotIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  EyeIcon,
  GitBranchIcon,
  Link2Icon,
  MessageSquareCodeIcon,
  SearchIcon,
  ShieldAlertIcon,
  UnlinkIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import {
  CockpitDiffStat,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitTone,
} from "./CockpitPrimitives";

export type TriageFilter = "all" | "blocked" | "human" | "unlinked";

const PR_DIFF_GUARDRAIL_LINES = 400;

export interface CockpitTriageTabProps {
  readonly reviewQueue: TeamHubReviewQueueResult | null;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly selectedChangeRequestId: string | null;
  readonly onSelectChangeRequest: (cr: ChangeRequestAudit) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly filter?: TriageFilter | undefined;
  readonly onFilterChange?: ((next: TriageFilter) => void) | undefined;
}

const BUCKET_ORDER = [
  "bot_blocked",
  "ci_blocked",
  "ready_for_human_review",
  "orphan",
  "auto_merged_integration",
  "draft",
] as const;

function triageBucketLabel(bucket: string, gt: ReturnType<typeof useGT>): string {
  switch (bucket) {
    case "bot_blocked":
      return gt("Bot-Blocked Review");
    case "ready_for_human_review":
      return gt("Ready for Human Review");
    case "ci_blocked":
      return gt("CI / Quality Blocked");
    case "orphan":
      return gt("Orphan PRs (No Work Item)");
    case "auto_merged_integration":
      return gt("Auto-Merged (Integration)");
    case "draft":
      return gt("Draft");
    default:
      return bucket;
  }
}

function BucketIcon({ bucket }: { readonly bucket: string }) {
  switch (bucket) {
    case "bot_blocked":
      return <BotIcon aria-hidden className="text-destructive" />;
    case "ci_blocked":
      return <ShieldAlertIcon aria-hidden className="text-destructive" />;
    case "ready_for_human_review":
      return <EyeIcon aria-hidden className="text-info-foreground" />;
    case "orphan":
      return <UnlinkIcon aria-hidden className="text-warning-foreground" />;
    case "auto_merged_integration":
      return <CheckCircle2Icon aria-hidden className="text-success-foreground" />;
    default:
      return <PullRequestGlyph.pullRequest aria-hidden />;
  }
}

function ciStatusTone(ciStatus: ChangeRequestAudit["qualitySignals"]["ciStatus"]): CockpitTone {
  if (ciStatus === "failure") return "error";
  if (ciStatus === "success") return "success";
  return "neutral";
}

function ciStatusLabel(
  ciStatus: ChangeRequestAudit["qualitySignals"]["ciStatus"],
  gt: ReturnType<typeof useGT>,
): string {
  if (ciStatus === "failure") return gt("Failed");
  if (ciStatus === "success") return gt("Passed");
  return gt("Pending");
}

function matchesTriageFilter(
  bucket: string,
  cr: ChangeRequestAudit,
  filter: TriageFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "blocked") return bucket === "bot_blocked" || bucket === "ci_blocked";
  if (filter === "human") return bucket === "ready_for_human_review";
  if (filter === "unlinked") return bucket === "orphan" || cr.workItemId === null;
  return true;
}

function matchesSearchQuery(
  cr: ChangeRequestAudit,
  linkedCard: CockpitWorkItemCard | null,
  normalizedQuery: string,
): boolean {
  if (!normalizedQuery) return true;
  const haystacks = [
    cr.title,
    cr.repoFullName,
    `${cr.repoFullName}#${cr.number}`,
    `#${cr.number}`,
    cr.authorVcsLogin,
    cr.headBranch,
    cr.baseBranch,
    linkedCard?.workItem.code ?? "",
    linkedCard?.workItem.title ?? "",
    ...cr.automatedReview.reviewers.flatMap((finding) => [
      finding.reviewerName,
      finding.bodyExcerpt,
    ]),
  ];
  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function CockpitTriageTab({
  reviewQueue,
  cards,
  selectedChangeRequestId,
  onSelectChangeRequest,
  onOpenWorkItem,
  filter,
  onFilterChange,
}: CockpitTriageTabProps) {
  const gt = useGT();
  const [internalFilter, setInternalFilter] = useState<TriageFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const activeFilter = filter ?? internalFilter;
  const updateFilter = (next: TriageFilter) => {
    setInternalFilter(next);
    onFilterChange?.(next);
  };

  const cardById = new Map(cards.map((c) => [c.workItem.id, c] as const));
  const grouped = reviewQueue?.grouped ?? {};

  const bucketEntries = BUCKET_ORDER.map((bucket) => ({
    bucket,
    items: (grouped[bucket] ?? []) as ReadonlyArray<ChangeRequestAudit>,
  }));
  const allEntries = bucketEntries.flatMap((entry) =>
    entry.items.map((cr) => ({ bucket: entry.bucket, cr })),
  );

  if (allEntries.length === 0) {
    return (
      <Empty size="compact">
        <EmptyMedia variant="icon">
          <CheckCircle2Icon />
        </EmptyMedia>
        <EmptyHeader>
          <EmptyTitle>
            <T>Review queue is clear</T>
          </EmptyTitle>
          <EmptyDescription>
            <T>
              No open pull requests require triage right now. Sync a repository in Setup or open a
              PR to see live review signals here.
            </T>
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const totalCount = allEntries.length;
  const blockedCount = allEntries.filter(({ bucket, cr }) =>
    matchesTriageFilter(bucket, cr, "blocked"),
  ).length;
  const humanCount = allEntries.filter(({ bucket, cr }) =>
    matchesTriageFilter(bucket, cr, "human"),
  ).length;
  const unlinkedCount = allEntries.filter(({ bucket, cr }) =>
    matchesTriageFilter(bucket, cr, "unlinked"),
  ).length;

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const filteredBuckets = bucketEntries
    .map(({ bucket, items }) => ({
      bucket,
      items: items.filter((cr) => {
        if (!matchesTriageFilter(bucket, cr, activeFilter)) return false;
        const linkedCard = cr.workItemId ? (cardById.get(cr.workItemId) ?? null) : null;
        return matchesSearchQuery(cr, linkedCard, normalizedQuery);
      }),
    }))
    .filter((entry) => entry.items.length > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <ToggleGroup
          size="segmented"
          variant="segmented"
          value={[activeFilter]}
          onValueChange={(next) => {
            const value = next[0];
            if (
              value === "all" ||
              value === "blocked" ||
              value === "human" ||
              value === "unlinked"
            ) {
              updateFilter(value);
            }
          }}
        >
          <Toggle value="all">
            <T>All</T>
            <span className="ml-1 tabular-nums opacity-60">{totalCount}</span>
          </Toggle>
          <Toggle value="blocked">
            <T>Blocked</T>
            {blockedCount > 0 ? (
              <span className="ml-1 tabular-nums opacity-60">{blockedCount}</span>
            ) : null}
          </Toggle>
          <Toggle value="human">
            <T>Human Review</T>
            {humanCount > 0 ? (
              <span className="ml-1 tabular-nums opacity-60">{humanCount}</span>
            ) : null}
          </Toggle>
          <Toggle value="unlinked">
            <T>Unlinked</T>
            {unlinkedCount > 0 ? (
              <span className="ml-1 tabular-nums opacity-60">{unlinkedCount}</span>
            ) : null}
          </Toggle>
        </ToggleGroup>

        <div className="w-full sm:w-64">
          <Input
            aria-label={gt("Search pull requests")}
            placeholder={gt("Search PR, repo, author, branch...")}
            size="compact"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
      </div>

      {filteredBuckets.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <SearchIcon />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>No matching pull requests</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>Try clearing your search query or switching to a different triage filter.</T>
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button
              size="xs"
              variant="outline"
              onClick={() => {
                updateFilter("all");
                setSearchQuery("");
              }}
            >
              <T>Reset Filters</T>
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <div className="space-y-5">
          {filteredBuckets.map(({ bucket, items }) => {
            const isBlockedBucket = bucket === "bot_blocked" || bucket === "ci_blocked";

            return (
              <section key={bucket} className="space-y-1.5">
                <CockpitSectionHeader
                  count={items.length}
                  icon={<BucketIcon bucket={bucket} />}
                  title={triageBucketLabel(bucket, gt)}
                />

                <CockpitSurface divided variant="grouped">
                  {items.map((cr) => {
                    const selected = cr.id === selectedChangeRequestId;
                    const linkedCard = cr.workItemId ? (cardById.get(cr.workItemId) ?? null) : null;
                    const topFinding = cr.automatedReview.reviewers[0] ?? null;
                    const ciTone = ciStatusTone(cr.qualitySignals.ciStatus);
                    const changedLines = cr.additions + cr.deletions;
                    const exceedsDiffGuardrail = changedLines > PR_DIFF_GUARDRAIL_LINES;
                    const mergeStrategy = recommendPrMergeStrategy({
                      headBranch: cr.headBranch,
                      baseBranch: cr.baseBranch,
                    });

                    return (
                      <CockpitSurfaceRow
                        key={cr.id}
                        className="group flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                        interactive
                        selected={selected}
                      >
                        <button
                          className="min-w-0 flex-1 cursor-pointer space-y-1 text-left focus-visible:outline-none"
                          type="button"
                          onClick={() => onSelectChangeRequest(cr)}
                        >
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
                              {cr.repoFullName}#{cr.number}
                            </span>
                            <span className="min-w-0 truncate text-sm font-medium text-foreground">
                              {cr.title}
                            </span>
                            {!linkedCard ? (
                              <Badge size="sm" variant="warning">
                                <T>Unlinked</T>
                              </Badge>
                            ) : null}
                            {cr.isOversized ? (
                              <Badge size="sm" variant="warning">
                                <AlertTriangleIcon />
                                <T>Oversized</T>
                              </Badge>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-muted-foreground">
                            <span>@{cr.authorVcsLogin}</span>
                            <span className="inline-flex min-w-0 items-center gap-1 font-mono">
                              <GitBranchIcon className="size-3 shrink-0 opacity-70" />
                              <span className="truncate">
                                {cr.headBranch} → {cr.baseBranch}
                              </span>
                            </span>
                            {mergeStrategy.method === "merge_commit" ? (
                              <Badge
                                size="sm"
                                variant={mergeStrategy.isBackMerge ? "warning" : "info"}
                              >
                                <PullRequestGlyph.merged />
                                {mergeStrategy.isBackMerge ? (
                                  <T>Back-merge: Merge commit</T>
                                ) : (
                                  <T>Merge commit</T>
                                )}
                              </Badge>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-muted-foreground/80">
                                <PullRequestGlyph.merged
                                  aria-hidden
                                  className="size-3 shrink-0 opacity-70"
                                />
                                <T>Squash</T>
                              </span>
                            )}
                            <CockpitDiffStat additions={cr.additions} deletions={cr.deletions} />
                            {exceedsDiffGuardrail ? (
                              <span className="inline-flex items-center gap-1 font-mono text-warning-foreground">
                                <AlertTriangleIcon aria-hidden className="size-3 shrink-0" />
                                <span>{gt(">400 lines")}</span>
                              </span>
                            ) : null}
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5",
                                ciTone === "error"
                                  ? "text-destructive"
                                  : ciTone === "success"
                                    ? "text-success-foreground"
                                    : "text-muted-foreground",
                              )}
                            >
                              <CockpitStatusDot tone={ciTone} />
                              <T>
                                CI: <Var>{ciStatusLabel(cr.qualitySignals.ciStatus, gt)}</Var>
                              </T>
                            </span>
                          </div>

                          {topFinding ? (
                            <div className="flex items-center gap-1.5 pt-0.5 text-xs text-muted-foreground">
                              <BotIcon
                                className={cn(
                                  "size-3.5 shrink-0",
                                  topFinding.state === "changes_requested"
                                    ? "text-destructive"
                                    : "text-muted-foreground",
                                )}
                              />
                              <span className="line-clamp-1 min-w-0">
                                <span className="font-medium text-foreground">
                                  {topFinding.reviewerName}
                                </span>
                                {": "}
                                {topFinding.bodyExcerpt}
                              </span>
                              {cr.automatedReview.reviewers.length > 1 ? (
                                <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground/70">
                                  +{cr.automatedReview.reviewers.length - 1}
                                </span>
                              ) : null}
                            </div>
                          ) : null}
                        </button>

                        <div className="flex shrink-0 items-center gap-1.5">
                          {linkedCard ? (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => onOpenWorkItem(linkedCard.workItem.id)}
                            >
                              <span className="font-mono">{linkedCard.workItem.code}</span>
                            </Button>
                          ) : (
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => onSelectChangeRequest(cr)}
                            >
                              <Link2Icon />
                              <T>Link</T>
                            </Button>
                          )}

                          <Button
                            size="xs"
                            variant={selected ? "secondary" : "outline"}
                            onClick={() => onSelectChangeRequest(cr)}
                          >
                            {isBlockedBucket ? <WrenchIcon /> : <MessageSquareCodeIcon />}
                            {isBlockedBucket ? <T>Inspect & Fix</T> : <T>Review in App</T>}
                          </Button>

                          <Button
                            aria-label={gt("Open on GitHub")}
                            render={
                              <a href={cr.url} rel="noreferrer" target="_blank">
                                <ExternalLinkIcon />
                              </a>
                            }
                            size="icon-xs"
                            variant="ghost-muted"
                          />
                        </div>
                      </CockpitSurfaceRow>
                    );
                  })}
                </CockpitSurface>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
