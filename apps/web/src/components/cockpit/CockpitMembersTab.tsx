import { T, useGT } from "gt-react";
import { ActivityIcon, AtSignIcon, BotIcon, MessageSquareIcon, UsersIcon } from "lucide-react";
import { useState } from "react";

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
import { cn } from "~/lib/utils";
import { CockpitArtifactIcon, CockpitIllustration } from "./CockpitArtwork";
import { CockpitIconBadge, CockpitSurface } from "./CockpitPrimitives";
import { CockpitSwarmAvatar, type CockpitTeamMember } from "./CockpitSwarmAvatar";

export interface CockpitMembersTabProps {
  readonly roster: readonly CockpitTeamMember[];
  readonly onMentionMember: (handle: string) => void;
  readonly onFilterBoardByMember: (handle: string) => void;
  readonly onOpenWorkItem: (workItemId: string) => void;
}

type MemberBadgeTone = "neutral" | "primary" | "success" | "info" | "warning" | "error" | "violet";
type MemberRoleFilter = "all" | "human" | "coding_agent" | "ai_reviewer" | "working";

function isAiReviewer(member: CockpitTeamMember): boolean {
  return member.kind === "agent" && member.roles.includes("reviewer");
}

function formatRoleLabel(member: CockpitTeamMember, gt: ReturnType<typeof useGT>): string {
  if (member.isOwner) return gt("Owner");
  if (member.subtitle) return member.subtitle;
  if (member.kind === "agent") return gt("Coding Agent");
  if (member.roles.length > 0) return member.roles.join(" · ");
  return gt("Member");
}

function matchesMemberRoleFilter(member: CockpitTeamMember, roleFilter: MemberRoleFilter): boolean {
  switch (roleFilter) {
    case "all":
      return true;
    case "human":
      return member.kind === "human";
    case "coding_agent":
      return member.kind === "agent" && !isAiReviewer(member);
    case "ai_reviewer":
      return isAiReviewer(member);
    case "working":
      return member.state === "working";
  }
}

function matchesMemberSearch(member: CockpitTeamMember, normalizedQuery: string): boolean {
  if (!normalizedQuery) return true;
  const haystacks = [
    member.handle,
    `@${member.handle}`,
    member.displayName,
    member.subtitle ?? "",
    member.currentActivity ?? "",
    member.latestPost?.body ?? "",
    ...member.roles,
  ];
  return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
}

export function CockpitMembersTab({
  roster,
  onMentionMember,
  onFilterBoardByMember,
  onOpenWorkItem,
}: CockpitMembersTabProps) {
  const gt = useGT();
  const [searchQuery, setSearchQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRoleFilter>("all");

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const hasActiveFilter = normalizedQuery.length > 0 || roleFilter !== "all";
  const filteredRoster = roster.filter(
    (member) =>
      matchesMemberRoleFilter(member, roleFilter) && matchesMemberSearch(member, normalizedQuery),
  );

  const humanCount = roster.filter((member) => member.kind === "human").length;
  const codingAgentCount = roster.filter(
    (member) => member.kind === "agent" && !isAiReviewer(member),
  ).length;
  const aiReviewerCount = roster.filter((member) => isAiReviewer(member)).length;
  const workingCount = roster.filter((member) => member.state === "working").length;

  const featuredOwner = filteredRoster.find((member) => member.isOwner) ?? null;
  const remainingMembers = featuredOwner
    ? filteredRoster.filter((member) => member.handle !== featuredOwner.handle)
    : filteredRoster;

  const activeMembers = remainingMembers.filter((member) => member.state === "working");
  const standingByMembers = remainingMembers.filter((member) => member.state === "standing_by");

  const summaryCards: readonly {
    readonly key: Exclude<MemberRoleFilter, "all">;
    readonly label: string;
    readonly count: number;
    readonly tone: MemberBadgeTone;
    readonly icon: "humans" | "coding_agent" | "ai_reviewer" | "working";
  }[] = [
    { key: "human", label: gt("Teammates"), count: humanCount, tone: "info", icon: "humans" },
    {
      key: "coding_agent",
      label: gt("Coding Agents"),
      count: codingAgentCount,
      tone: "primary",
      icon: "coding_agent",
    },
    {
      key: "ai_reviewer",
      label: gt("AI Reviewers"),
      count: aiReviewerCount,
      tone: "violet",
      icon: "ai_reviewer",
    },
    {
      key: "working",
      label: gt("Working Now"),
      count: workingCount,
      tone: "success",
      icon: "working",
    },
  ];

  return (
    <div className="space-y-6">
      {roster.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {summaryCards.map((card) => {
            const isSelected = roleFilter === card.key;
            return (
              <button
                key={card.key}
                aria-pressed={isSelected}
                className={cn(
                  "flex cursor-pointer items-center gap-3.5 rounded-xl border px-4 py-3.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                  isSelected
                    ? "border-primary/45 bg-linear-to-b from-accent/70 to-card/55 shadow-xs ring-1 ring-primary/35"
                    : "border-border/55 bg-linear-to-b from-card/85 to-card/40 shadow-2xs ring-1 ring-inset ring-foreground/4 hover:border-border hover:bg-accent/35",
                )}
                type="button"
                onClick={() => setRoleFilter((prev) => (prev === card.key ? "all" : card.key))}
              >
                <CockpitIconBadge
                  size="md"
                  tone={card.count > 0 || isSelected ? card.tone : "neutral"}
                >
                  {card.icon === "humans" ? (
                    <UsersIcon />
                  ) : card.icon === "coding_agent" ? (
                    <BotIcon />
                  ) : card.icon === "ai_reviewer" ? (
                    <CockpitArtifactIcon kind="governance" />
                  ) : (
                    <ActivityIcon />
                  )}
                </CockpitIconBadge>
                <div className="min-w-0">
                  <div className="font-mono text-lg leading-none font-semibold tabular-nums text-foreground">
                    {card.count}
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">{card.label}</div>
                </div>
              </button>
            );
          })}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="w-full max-w-sm">
          <Input
            aria-label={gt("Search members")}
            placeholder={gt("Search members...")}
            size="compact"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>
        {roleFilter !== "all" ? (
          <Button size="xs" variant="ghost-muted" onClick={() => setRoleFilter("all")}>
            <T>Show all roles</T>
          </Button>
        ) : null}
      </div>

      {filteredRoster.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant="default">
            <CockpitIllustration kind="empty_board" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              {hasActiveFilter ? <T>No matching members</T> : <T>No team members yet</T>}
            </EmptyTitle>
            <EmptyDescription>
              {hasActiveFilter ? (
                <T>Try searching by another handle, role filter, or activity keyword.</T>
              ) : (
                <T>
                  Workspace members, pull request authors, and active AI reviewers appear here
                  automatically.
                </T>
              )}
            </EmptyDescription>
          </EmptyHeader>
          {hasActiveFilter ? (
            <EmptyContent>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setRoleFilter("all");
                }}
              >
                <T>Clear Filters</T>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <div className="space-y-6">
          {featuredOwner ? (
            <CockpitSurface
              className="bg-linear-to-b from-card/85 to-card/45"
              padding="md"
              variant="grouped"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <CockpitSwarmAvatar
                    displayName={featuredOwner.displayName}
                    handle={featuredOwner.handle}
                    kind={featuredOwner.kind}
                    presence={featuredOwner.state}
                    size="lg"
                  />
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">
                        @{featuredOwner.handle}
                      </span>
                      <Badge size="sm" variant="secondary">
                        <T>Owner</T>
                      </Badge>
                      {featuredOwner.state === "working" ? (
                        <span className="text-xs font-medium text-info-foreground">
                          <T>Working</T>
                        </span>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {featuredOwner.displayName}
                    </div>
                  </div>
                </div>

                {featuredOwner.subtitle || featuredOwner.latestPost ? (
                  <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                    {featuredOwner.subtitle ? <span>{featuredOwner.subtitle}</span> : null}
                    {featuredOwner.subtitle && featuredOwner.latestPost ? (
                      <span aria-hidden className="opacity-45">
                        ·
                      </span>
                    ) : null}
                    {featuredOwner.latestPost ? (
                      <span className="font-mono text-2xs tabular-nums">
                        #{featuredOwner.latestPost.seq}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <div className="mt-3 space-y-1.5">
                {featuredOwner.currentActivity ? (
                  <div className="text-xs text-foreground/90">
                    {featuredOwner.currentWorkItemId ? (
                      <button
                        className="cursor-pointer text-left font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        type="button"
                        onClick={() => {
                          if (featuredOwner.currentWorkItemId) {
                            onOpenWorkItem(featuredOwner.currentWorkItemId);
                          }
                        }}
                      >
                        {featuredOwner.currentActivity}
                      </button>
                    ) : (
                      <span className="font-medium">{featuredOwner.currentActivity}</span>
                    )}
                  </div>
                ) : null}

                <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
                  {featuredOwner.latestPost ? featuredOwner.latestPost.body : <T>No posts yet</T>}
                </p>
              </div>

              <div className="mt-3.5 flex items-center gap-2">
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => onMentionMember(featuredOwner.handle)}
                >
                  <AtSignIcon />
                  <T>Mention</T>
                </Button>
                <Button
                  size="xs"
                  variant="ghost-muted"
                  onClick={() => onFilterBoardByMember(featuredOwner.handle)}
                >
                  <MessageSquareIcon />
                  <T>Posts</T>
                  {featuredOwner.postCount > 0 ? (
                    <span className="font-mono tabular-nums opacity-70">
                      {featuredOwner.postCount}
                    </span>
                  ) : null}
                </Button>
              </div>
            </CockpitSurface>
          ) : null}

          {activeMembers.length > 0 ? (
            <section aria-label={gt("Active members")} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>
                  <T>Active</T>
                </span>
                <span className="font-mono tabular-nums opacity-70">{activeMembers.length}</span>
              </div>

              <CockpitSurface divided variant="grouped">
                {activeMembers.map((member) => (
                  <div
                    key={member.handle}
                    className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-accent/20 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <CockpitSwarmAvatar
                        className="mt-0.5"
                        displayName={member.displayName}
                        handle={member.handle}
                        kind={member.kind}
                        presence="working"
                        size="md"
                      />

                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-semibold text-foreground">
                            @{member.handle}
                          </span>
                          <span className="text-xs font-medium text-info-foreground">
                            <T>Working</T>
                          </span>
                          {member.kind === "agent" ? (
                            <Badge size="sm" variant="secondary">
                              <T>Agent</T>
                            </Badge>
                          ) : null}
                          {member.displayName.toLowerCase() !== member.handle ? (
                            <span className="truncate text-xs text-muted-foreground">
                              {member.displayName}
                            </span>
                          ) : null}
                        </div>

                        {member.currentActivity ? (
                          <div className="text-xs text-foreground/90">
                            {member.currentWorkItemId ? (
                              <button
                                className="max-w-full cursor-pointer truncate text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                                type="button"
                                onClick={() => {
                                  if (member.currentWorkItemId) {
                                    onOpenWorkItem(member.currentWorkItemId);
                                  }
                                }}
                              >
                                {member.currentActivity}
                              </button>
                            ) : (
                              <span className="block truncate">{member.currentActivity}</span>
                            )}
                          </div>
                        ) : null}

                        {member.latestPost ? (
                          <p className="line-clamp-1 text-xs text-muted-foreground">
                            <span className="mr-1.5 font-mono text-2xs text-muted-foreground/75">
                              #{member.latestPost.seq}
                            </span>
                            {member.latestPost.body}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2.5 self-end sm:self-center">
                      <span className="hidden text-xs text-muted-foreground sm:inline">
                        {formatRoleLabel(member, gt)}
                      </span>
                      {member.postCount > 0 ? (
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          onClick={() => onFilterBoardByMember(member.handle)}
                        >
                          <MessageSquareIcon />
                          <span className="font-mono tabular-nums">{member.postCount}</span>
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onMentionMember(member.handle)}
                      >
                        <AtSignIcon />
                        <T>Mention</T>
                      </Button>
                    </div>
                  </div>
                ))}
              </CockpitSurface>
            </section>
          ) : null}

          {standingByMembers.length > 0 ? (
            <section aria-label={gt("Standing by members")} className="space-y-2">
              <div className="flex items-center gap-2 px-0.5 text-2xs font-medium uppercase tracking-wider text-muted-foreground">
                <span>
                  <T>Standing By</T>
                </span>
                <span className="font-mono tabular-nums opacity-70">
                  {standingByMembers.length}
                </span>
              </div>

              <CockpitSurface divided variant="grouped">
                {standingByMembers.map((member) => (
                  <div
                    key={member.handle}
                    className="flex flex-col gap-3 px-4 py-3.5 transition-colors hover:bg-accent/20 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <CockpitSwarmAvatar
                        displayName={member.displayName}
                        handle={member.handle}
                        kind={member.kind}
                        presence="standing_by"
                        size="md"
                      />

                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-sm font-medium text-foreground">
                            @{member.handle}
                          </span>
                          {member.kind === "agent" ? (
                            <Badge size="sm" variant="secondary">
                              <T>Agent</T>
                            </Badge>
                          ) : null}
                          <span className="truncate text-xs text-muted-foreground">
                            {formatRoleLabel(member, gt)}
                          </span>
                        </div>

                        <p className="line-clamp-1 text-xs text-muted-foreground">
                          {member.latestPost ? (
                            <>
                              <span className="mr-1.5 font-mono text-2xs text-muted-foreground/75">
                                #{member.latestPost.seq}
                              </span>
                              {member.latestPost.body}
                            </>
                          ) : (
                            <T>No posts yet</T>
                          )}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                      {member.postCount > 0 ? (
                        <Button
                          size="xs"
                          variant="ghost-muted"
                          onClick={() => onFilterBoardByMember(member.handle)}
                        >
                          <MessageSquareIcon />
                          <span className="font-mono tabular-nums">{member.postCount}</span>
                        </Button>
                      ) : null}
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => onMentionMember(member.handle)}
                      >
                        <AtSignIcon />
                        <T>Mention</T>
                      </Button>
                    </div>
                  </div>
                ))}
              </CockpitSurface>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
