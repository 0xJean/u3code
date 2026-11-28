import type {
  ChangeRequestAudit,
  CockpitWorkItemCard,
  TeamBoardMessage,
  TeamBoardMessageKind,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  ArrowRightIcon,
  ArrowRightLeftIcon,
  BotIcon,
  ReplyIcon,
  SearchIcon,
  SendIcon,
  XIcon,
} from "lucide-react";
import { Fragment, useEffect, useEffectEvent, useRef, useState } from "react";

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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { cn } from "~/lib/utils";
import { formatShortTimestamp } from "~/timestampFormat";
import { CockpitIllustration, CockpitStageArtworkIcon } from "./CockpitArtwork";
import { CockpitIconBadge, CockpitSurface } from "./CockpitPrimitives";
import {
  CockpitSwarmAvatar,
  parseMessageTokens,
  type CockpitTeamMember,
} from "./CockpitSwarmAvatar";

export interface CockpitBoardTabProps {
  readonly messages: readonly TeamBoardMessage[];
  readonly roster: readonly CockpitTeamMember[];
  readonly cards: readonly CockpitWorkItemCard[];
  readonly reviewItems: readonly ChangeRequestAudit[];
  readonly posting: boolean;
  readonly initialMentionHandle: string | null;
  readonly initialFilterHandle: string | null;
  readonly onConsumeInitialDraft: () => void;
  readonly onPostMessage: (input: {
    body: string;
    workItemId?: string | null;
    workItemCode?: string | null;
  }) => Promise<boolean>;
  readonly onOpenWorkItem: (workItemId: string) => void;
  readonly onOpenChangeRequest: (cr: ChangeRequestAudit) => void;
}

type BoardKindFilter = "all" | "handoff" | "pulse" | "review_release";

const NO_WORK_ITEM_VALUE = "__none__";

function matchesKindFilter(kind: TeamBoardMessageKind, filter: BoardKindFilter): boolean {
  if (filter === "all") return true;
  if (filter === "handoff") return kind === "handoff";
  if (filter === "pulse") return kind === "pulse";
  return kind === "review" || kind === "release";
}

type BoardBadgeTone = "neutral" | "primary" | "success" | "info" | "warning" | "error" | "violet";

interface BoardMessageMarker {
  readonly tone: BoardBadgeTone;
  readonly iconKind: "handoff" | "pulse" | "review" | "release" | "system";
  readonly accentClass: string;
  readonly rowTintClass?: string;
}

function kindBadgeLabel(kind: TeamBoardMessageKind, gt: ReturnType<typeof useGT>): string | null {
  switch (kind) {
    case "handoff":
      return gt("Handoff");
    case "pulse":
      return gt("Pulse");
    case "review":
      return gt("Review");
    case "release":
      return gt("Release");
    case "system":
      return gt("System");
    default:
      return null;
  }
}

function kindBadgeVariant(
  kind: TeamBoardMessageKind,
): "info" | "secondary" | "warning" | "success" | "outline" {
  switch (kind) {
    case "handoff":
      return "info";
    case "review":
      return "warning";
    case "release":
      return "success";
    case "system":
      return "outline";
    default:
      return "secondary";
  }
}

function resolveBoardMessageMarker(message: TeamBoardMessage): BoardMessageMarker | null {
  switch (message.kind) {
    case "handoff":
      return {
        tone: "info",
        iconKind: "handoff",
        accentClass: "border-l-2 border-l-info/60",
        rowTintClass: "bg-info/3",
      };
    case "review":
      return {
        tone: "warning",
        iconKind: "review",
        accentClass: "border-l-2 border-l-warning/60",
        rowTintClass: "bg-warning/3",
      };
    case "release":
      return {
        tone: "success",
        iconKind: "release",
        accentClass: "border-l-2 border-l-success/60",
        rowTintClass: "bg-success/3",
      };
    case "pulse":
      return {
        tone: "violet",
        iconKind: "pulse",
        accentClass: "border-l-2 border-l-guest/55",
      };
    case "system":
      return {
        tone: "primary",
        iconKind: "system",
        accentClass: "border-l-2 border-l-primary/50",
        rowTintClass: "bg-muted/15",
      };
    case "message":
      if (message.authorType === "system") {
        return {
          tone: "primary",
          iconKind: "system",
          accentClass: "border-l-2 border-l-primary/50",
          rowTintClass: "bg-muted/15",
        };
      }
      return null;
  }
}

function renderBoardMarkerIcon(iconKind: BoardMessageMarker["iconKind"]) {
  switch (iconKind) {
    case "handoff":
      return <ArrowRightLeftIcon />;
    case "pulse":
      return <ActivityIcon />;
    case "review":
      return <CockpitStageArtworkIcon stage="review" />;
    case "release":
      return <CockpitStageArtworkIcon stage="release" />;
    case "system":
      return <CockpitStageArtworkIcon stage="governance" />;
  }
}

function appendMentionToDraft(current: string, handle: string): string {
  const token = `@${handle}`;
  const trimmedEnd = current.trimEnd();
  if (trimmedEnd.endsWith(token)) {
    return `${trimmedEnd} `;
  }
  if (!trimmedEnd) {
    return `${token} `;
  }
  return `${trimmedEnd} ${token} `;
}

export function CockpitBoardTab({
  messages,
  roster,
  cards,
  reviewItems,
  posting,
  initialMentionHandle,
  initialFilterHandle,
  onConsumeInitialDraft,
  onPostMessage,
  onOpenWorkItem,
  onOpenChangeRequest,
}: CockpitBoardTabProps) {
  const gt = useGT();
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<BoardKindFilter>("all");
  const [memberFilter, setMemberFilter] = useState<string | null>(() => initialFilterHandle);
  const [draft, setDraft] = useState(() =>
    initialMentionHandle ? `@${initialMentionHandle} ` : "",
  );
  const [linkedWorkItemId, setLinkedWorkItemId] = useState<string>(NO_WORK_ITEM_VALUE);

  const consumeInitialDraft = useEffectEvent(() => {
    onConsumeInitialDraft();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- clears one-shot cross-tab mention/filter handoff props in parent after Board captures them on mount
  useEffect(() => {
    if (initialMentionHandle !== null || initialFilterHandle !== null) {
      consumeInitialDraft();
    }
  }, [initialMentionHandle, initialFilterHandle]);

  const rosterByHandle = new Map(roster.map((member) => [member.handle, member] as const));
  const cardByCode = new Map(
    cards.map((card) => [card.workItem.code.toUpperCase(), card] as const),
  );
  const cardById = new Map(cards.map((card) => [card.workItem.id, card] as const));

  const changeRequestsById = new Map<string, ChangeRequestAudit>();
  const changeRequestsByKey = new Map<string, ChangeRequestAudit>();
  const changeRequestsByNumber = new Map<number, ChangeRequestAudit>();
  const registerChangeRequest = (cr: ChangeRequestAudit) => {
    changeRequestsById.set(cr.id, cr);
    changeRequestsByKey.set(`${cr.repoFullName.toLowerCase()}#${cr.number}`, cr);
    if (!changeRequestsByNumber.has(cr.number)) {
      changeRequestsByNumber.set(cr.number, cr);
    }
  };
  for (const cr of reviewItems) {
    registerChangeRequest(cr);
  }
  for (const card of cards) {
    for (const cr of card.changeRequests) {
      registerChangeRequest(cr);
    }
  }

  const insertMention = (handle: string) => {
    setDraft((current) => appendMentionToDraft(current, handle));
    composerRef.current?.focus();
  };

  const handleSubmit = async () => {
    const trimmed = draft.trim();
    if (!trimmed || posting) return;

    const linkedCard =
      linkedWorkItemId !== NO_WORK_ITEM_VALUE ? (cardById.get(linkedWorkItemId) ?? null) : null;

    const ok = await onPostMessage({
      body: trimmed,
      workItemId: linkedCard?.workItem.id ?? null,
      workItemCode: linkedCard?.workItem.code ?? null,
    });
    if (ok) {
      setDraft("");
      setLinkedWorkItemId(NO_WORK_ITEM_VALUE);
    }
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();
  const normalizedMemberFilter = memberFilter?.trim().toLowerCase() ?? null;

  const filteredMessages = messages
    .filter((message) => {
      if (!matchesKindFilter(message.kind, kindFilter)) return false;
      if (normalizedMemberFilter) {
        const authorMatches = message.authorHandle.toLowerCase() === normalizedMemberFilter;
        const mentionMatches = message.mentions.some(
          (mention) => mention.toLowerCase() === normalizedMemberFilter,
        );
        if (!authorMatches && !mentionMatches) return false;
      }
      if (!normalizedQuery) return true;
      const haystacks = [
        message.body,
        message.authorHandle,
        `@${message.authorHandle}`,
        message.authorDisplayName,
        `#${message.seq}`,
        message.workItemCode ?? "",
        message.changeRequestRef ?? "",
        ...message.mentions.map((mention) => `@${mention}`),
      ];
      return haystacks.some((value) => value.toLowerCase().includes(normalizedQuery));
    })
    .toSorted((left, right) => right.seq - left.seq);

  const selectedLinkedCard =
    linkedWorkItemId !== NO_WORK_ITEM_VALUE ? (cardById.get(linkedWorkItemId) ?? null) : null;

  const hasActiveFilters =
    kindFilter !== "all" || normalizedMemberFilter !== null || normalizedQuery.length > 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="w-full sm:max-w-sm sm:flex-1">
          <Input
            aria-label={gt("Search board messages")}
            placeholder={gt("Search messages, @mentions, work items...")}
            size="compact"
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
        </div>

        <ToggleGroup
          size="segmented"
          value={[kindFilter]}
          variant="segmented"
          onValueChange={(next) => {
            const value = next[0];
            if (
              value === "all" ||
              value === "handoff" ||
              value === "pulse" ||
              value === "review_release"
            ) {
              setKindFilter(value);
            }
          }}
        >
          <Toggle value="all">
            <T>All</T>
          </Toggle>
          <Toggle value="handoff">
            <T>Handoffs</T>
          </Toggle>
          <Toggle value="pulse">
            <T>Pulses</T>
          </Toggle>
          <Toggle value="review_release">
            <T>Reviews & Releases</T>
          </Toggle>
        </ToggleGroup>
      </div>

      {normalizedMemberFilter ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>
            <T>
              Filtering by <Var>@{normalizedMemberFilter}</Var>
            </T>
          </span>
          <Button
            aria-label={gt("Clear member filter")}
            size="micro"
            variant="ghost-muted"
            onClick={() => setMemberFilter(null)}
          >
            <XIcon />
            <T>Clear</T>
          </Button>
        </div>
      ) : null}

      <CockpitSurface padding="sm" variant="grouped">
        <Textarea
          ref={composerRef}
          aria-label={gt("Team board message")}
          placeholder={gt("Post an update or @mention a teammate or agent...")}
          rows={2}
          size="sm"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              void handleSubmit();
            }
          }}
        />

        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            {roster.slice(0, 8).map((member) => (
              <button
                key={member.handle}
                className="inline-flex cursor-pointer items-center rounded-md border border-border/50 bg-muted/25 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-border hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                type="button"
                onClick={() => insertMention(member.handle)}
              >
                @{member.handle}
              </button>
            ))}
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-2">
            {cards.length > 0 ? (
              <div className="w-40">
                <Select
                  value={linkedWorkItemId}
                  onValueChange={(value) => {
                    if (typeof value === "string") setLinkedWorkItemId(value);
                  }}
                >
                  <SelectTrigger aria-label={gt("Link work item")} size="compact">
                    <SelectValue>
                      {selectedLinkedCard ? (
                        <span className="font-mono">{selectedLinkedCard.workItem.code}</span>
                      ) : (
                        <span className="text-muted-foreground">
                          <T>No work item</T>
                        </span>
                      )}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup align="end">
                    <SelectItem value={NO_WORK_ITEM_VALUE}>
                      <T>No work item</T>
                    </SelectItem>
                    {cards.map((card) => (
                      <SelectItem key={card.workItem.id} value={card.workItem.id}>
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {card.workItem.code}
                        </span>
                        <span className="truncate">{card.workItem.title}</span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>
            ) : null}

            <Button
              disabled={posting || draft.trim().length === 0}
              size="compact"
              variant="default"
              onClick={() => void handleSubmit()}
            >
              <SendIcon />
              {posting ? <T>Posting...</T> : <T>Post</T>}
            </Button>
          </div>
        </div>
      </CockpitSurface>

      {filteredMessages.length === 0 ? (
        <Empty size="compact">
          {hasActiveFilters ? (
            <EmptyMedia variant="icon">
              <SearchIcon />
            </EmptyMedia>
          ) : (
            <EmptyMedia variant="default">
              <CockpitIllustration kind="empty_board" />
            </EmptyMedia>
          )}
          <EmptyHeader>
            <EmptyTitle>
              {hasActiveFilters ? <T>No matching board posts</T> : <T>Team board is quiet</T>}
            </EmptyTitle>
            <EmptyDescription>
              {hasActiveFilters ? (
                <T>Try clearing your search or filter to see the full team feed.</T>
              ) : (
                <T>
                  Use @mentions to coordinate teammates and agents. Reassignments, PR gates, and
                  release handoffs post here automatically.
                </T>
              )}
            </EmptyDescription>
          </EmptyHeader>
          {hasActiveFilters ? (
            <EmptyContent>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setSearchQuery("");
                  setKindFilter("all");
                  setMemberFilter(null);
                }}
              >
                <T>Reset Filters</T>
              </Button>
            </EmptyContent>
          ) : null}
        </Empty>
      ) : (
        <CockpitSurface divided variant="grouped">
          {filteredMessages.map((message) => {
            const authorHandle = message.authorHandle.toLowerCase();
            const rosterMember = rosterByHandle.get(authorHandle) ?? null;
            const avatarKind: "human" | "agent" =
              message.authorType === "agent" || rosterMember?.kind === "agent" ? "agent" : "human";
            const badgeText = kindBadgeLabel(message.kind, gt);
            const marker = resolveBoardMessageMarker(message);
            const tokens = parseMessageTokens(message.body);
            const timeLabel = formatShortTimestamp(message.createdAt, "locale");
            const linkedHeaderCr = message.changeRequestId
              ? (changeRequestsById.get(message.changeRequestId) ?? null)
              : null;

            return (
              <article
                key={message.id}
                className={cn(
                  "flex items-start gap-3 px-4 py-3.5",
                  marker?.accentClass,
                  marker?.rowTintClass,
                )}
              >
                {message.authorType === "system" ? (
                  <CockpitIconBadge className="mt-0.5" size="lg" tone={marker?.tone ?? "neutral"}>
                    {renderBoardMarkerIcon(marker?.iconKind ?? "system")}
                  </CockpitIconBadge>
                ) : (
                  <CockpitSwarmAvatar
                    className="mt-0.5"
                    displayName={message.authorDisplayName}
                    handle={authorHandle}
                    kind={avatarKind}
                    presence={rosterMember?.state}
                    size="md"
                  />
                )}

                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <button
                        className="cursor-pointer font-mono text-xs font-semibold text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                        type="button"
                        onClick={() => setMemberFilter(authorHandle)}
                      >
                        @{authorHandle}
                      </button>

                      {avatarKind === "agent" && message.authorType !== "system" ? (
                        <Badge size="sm" variant="info">
                          <BotIcon />
                          <T>Agent</T>
                        </Badge>
                      ) : null}

                      {message.mentions.length > 0 ? (
                        <span className="inline-flex flex-wrap items-center gap-1">
                          <ArrowRightIcon
                            aria-hidden
                            className="size-3 shrink-0 text-muted-foreground/65"
                          />
                          {message.mentions.map((mention) => (
                            <button
                              key={mention}
                              className="cursor-pointer rounded bg-info/10 px-1 py-0.5 font-mono text-2xs text-info-foreground transition-colors hover:bg-info/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              type="button"
                              onClick={() => setMemberFilter(mention.toLowerCase())}
                            >
                              @{mention}
                            </button>
                          ))}
                        </span>
                      ) : null}

                      {marker && message.authorType !== "system" ? (
                        <span className="inline-flex items-center gap-1">
                          <CockpitIconBadge size="sm" tone={marker.tone}>
                            {renderBoardMarkerIcon(marker.iconKind)}
                          </CockpitIconBadge>
                          {badgeText ? (
                            <Badge size="sm" variant={kindBadgeVariant(message.kind)}>
                              {badgeText}
                            </Badge>
                          ) : null}
                        </span>
                      ) : badgeText ? (
                        <Badge size="sm" variant={kindBadgeVariant(message.kind)}>
                          {badgeText}
                        </Badge>
                      ) : null}

                      {message.workItemId && message.workItemCode ? (
                        <button
                          className="cursor-pointer rounded border border-border/55 bg-muted/35 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                          type="button"
                          onClick={() => {
                            if (message.workItemId) {
                              onOpenWorkItem(message.workItemId);
                            }
                          }}
                        >
                          {message.workItemCode}
                        </button>
                      ) : null}

                      {message.changeRequestRef ? (
                        linkedHeaderCr ? (
                          <button
                            className="cursor-pointer rounded border border-border/55 bg-muted/35 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground transition-colors hover:border-border hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            type="button"
                            onClick={() => onOpenChangeRequest(linkedHeaderCr)}
                          >
                            {message.changeRequestRef}
                          </button>
                        ) : (
                          <span className="rounded border border-border/45 bg-muted/25 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
                            {message.changeRequestRef}
                          </span>
                        )
                      ) : null}
                    </div>

                    <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
                      {timeLabel ? `#${message.seq} · ${timeLabel}` : `#${message.seq}`}
                    </span>
                  </div>

                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90 wrap-anywhere">
                    {tokens.map((token, index) => {
                      const tokenKey = `${message.id}:${index}:${token.kind}`;

                      if (token.kind === "text") {
                        return <Fragment key={tokenKey}>{token.value}</Fragment>;
                      }

                      if (token.kind === "code") {
                        return (
                          <code
                            key={tokenKey}
                            className="rounded bg-muted/70 px-1 py-0.5 font-mono text-xs text-foreground"
                          >
                            {token.code}
                          </code>
                        );
                      }

                      if (token.kind === "mention") {
                        return (
                          <button
                            key={tokenKey}
                            className="inline cursor-pointer rounded bg-info/10 px-1 py-0.5 font-mono text-xs text-info-foreground transition-colors hover:bg-info/18 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            type="button"
                            onClick={() => setMemberFilter(token.handle)}
                          >
                            {token.value}
                          </button>
                        );
                      }

                      if (token.kind === "work_item") {
                        const matchedCard = cardByCode.get(token.code.toUpperCase());
                        if (matchedCard) {
                          return (
                            <button
                              key={tokenKey}
                              className="inline cursor-pointer rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-foreground transition-colors hover:border-border hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                              type="button"
                              onClick={() => onOpenWorkItem(matchedCard.workItem.id)}
                            >
                              {token.code}
                            </button>
                          );
                        }
                        return (
                          <span
                            key={tokenKey}
                            className="rounded border border-border/45 bg-muted/25 px-1 py-0.5 font-mono text-xs text-muted-foreground"
                          >
                            {token.code}
                          </span>
                        );
                      }

                      const matchedCr = token.repoFullName
                        ? changeRequestsByKey.get(
                            `${token.repoFullName.toLowerCase()}#${token.number}`,
                          )
                        : changeRequestsByNumber.get(token.number);
                      if (matchedCr) {
                        return (
                          <button
                            key={tokenKey}
                            className="inline cursor-pointer rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 font-mono text-xs text-foreground transition-colors hover:border-border hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                            type="button"
                            onClick={() => onOpenChangeRequest(matchedCr)}
                          >
                            {token.value}
                          </button>
                        );
                      }
                      return (
                        <span key={tokenKey} className="font-mono text-xs text-muted-foreground">
                          {token.value}
                        </span>
                      );
                    })}
                  </p>

                  {message.authorType !== "system" ? (
                    <div className="pt-0.5">
                      <Button
                        size="micro"
                        variant="ghost-muted"
                        onClick={() => insertMention(authorHandle)}
                      >
                        <ReplyIcon />
                        <T>
                          Reply <Var>@{authorHandle}</Var>
                        </T>
                      </Button>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </CockpitSurface>
      )}
    </div>
  );
}
