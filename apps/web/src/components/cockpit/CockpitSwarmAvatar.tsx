import type {
  ChangeRequestAudit,
  CockpitWorkItemCard,
  TeamBoardMessage,
  WorkspaceMember,
} from "@u3code/hub-contracts";
import { msg } from "gt-react";
import { BotIcon, UsersIcon } from "lucide-react";

import { m, type MessageResolver } from "~/i18n/messages";
import { cn } from "~/lib/utils";

export interface CockpitTeamMember {
  readonly id: string;
  readonly handle: string;
  readonly displayName: string;
  readonly kind: "human" | "agent";
  readonly isOwner: boolean;
  readonly roles: readonly string[];
  readonly subtitle: string | null;
  readonly state: "working" | "standing_by";
  readonly currentActivity: string | null;
  readonly currentWorkItemId: string | null;
  readonly currentChangeRequestId: string | null;
  readonly latestPost: TeamBoardMessage | null;
  readonly activeItemCount: number;
  readonly openPrCount: number;
  readonly postCount: number;
}

export interface DeriveTeamRosterInput {
  readonly members: readonly WorkspaceMember[];
  readonly cards: readonly CockpitWorkItemCard[];
  readonly reviewItems: readonly ChangeRequestAudit[];
  readonly boardMessages: readonly TeamBoardMessage[];
  readonly currentUserId?: string | null | undefined;
  readonly nowMs?: number | undefined;
  readonly resolve?: MessageResolver | undefined;
}

export type BoardMessageToken =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "mention"; readonly value: string; readonly handle: string }
  | { readonly kind: "work_item"; readonly value: string; readonly code: string }
  | {
      readonly kind: "pr";
      readonly value: string;
      readonly repoFullName: string | null;
      readonly number: number;
    }
  | { readonly kind: "code"; readonly value: string; readonly code: string };

const DONE_WORK_ITEM_STAGES = new Set([
  "done",
  "cancelled",
  "canceled",
  "released",
  "archived",
  "closed",
]);

const RECENT_BOARD_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;
const RAW_INTERNAL_USER_ID_PATTERN = /^usr_[a-z0-9_-]+$/i;
const BOT_HANDLE_PATTERN = /(?:\[bot\]|(?:^|[-_.])(?:bot|agent|runner))$/i;

export function isWorkItemDoneStage(stage: string): boolean {
  return DONE_WORK_ITEM_STAGES.has(stage.trim().toLowerCase());
}

function isRawUserId(value: string): boolean {
  return RAW_INTERNAL_USER_ID_PATTERN.test(value.trim());
}

function isAgentLikeHandle(handle: string): boolean {
  return BOT_HANDLE_PATTERN.test(handle.trim());
}

function normalizeHandleCandidate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@+/, "");
  if (!trimmed || isRawUserId(trimmed)) return null;

  const lower = trimmed.toLowerCase();
  const hasBotSuffix = lower.endsWith("[bot]");
  const base = hasBotSuffix ? lower.slice(0, -"[bot]".length) : lower;

  const slug = base
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");

  if (!slug || isRawUserId(slug)) return null;
  const limited = slug.slice(0, 32);
  return hasBotSuffix ? `${limited}[bot]` : limited;
}

function deriveWorkspaceMemberHandle(
  member: WorkspaceMember,
  takenHandles: ReadonlySet<string>,
): string {
  const emailLocal = member.email?.split("@")[0] ?? null;
  const candidates = [
    normalizeHandleCandidate(member.primaryVcsLogin),
    normalizeHandleCandidate(emailLocal),
    normalizeHandleCandidate(member.displayName),
  ];

  for (const candidate of candidates) {
    if (candidate && !takenHandles.has(candidate)) {
      return candidate;
    }
  }

  for (const candidate of candidates) {
    if (candidate) {
      let suffix = 2;
      while (takenHandles.has(`${candidate}-${suffix}`)) {
        suffix += 1;
      }
      return `${candidate}-${suffix}`;
    }
  }

  const fallbackBase = member.roles.some((role) => role.toLowerCase() === "owner")
    ? "owner"
    : "member";
  if (!takenHandles.has(fallbackBase)) {
    return fallbackBase;
  }
  let suffix = 2;
  while (takenHandles.has(`${fallbackBase}-${suffix}`)) {
    suffix += 1;
  }
  return `${fallbackBase}-${suffix}`;
}

function cleanDisplayName(raw: string | null | undefined, fallbackHandle: string): string {
  const trimmed = raw?.trim() ?? "";
  if (!trimmed || isRawUserId(trimmed)) return fallbackHandle;
  return trimmed;
}

function mergeRoles(existing: string[], incoming: readonly string[]): void {
  for (const role of incoming) {
    const normalized = role.trim().toLowerCase();
    if (!normalized) continue;
    if (!existing.includes(normalized)) {
      existing.push(normalized);
    }
  }
}

function isNewerMessage(candidate: TeamBoardMessage, current: TeamBoardMessage | null): boolean {
  if (!current) return true;
  if (candidate.seq !== current.seq) return candidate.seq > current.seq;
  return candidate.createdAt > current.createdAt;
}

function truncateActivity(text: string, maxLength = 72): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLength) return collapsed;
  return `${collapsed.slice(0, maxLength - 1).trimEnd()}…`;
}

interface MutableTeamMember {
  id: string;
  handle: string;
  displayName: string;
  kind: "human" | "agent";
  isOwner: boolean;
  roles: string[];
  subtitle: string | null;
  currentActivity: string | null;
  currentWorkItemId: string | null;
  currentChangeRequestId: string | null;
  latestPost: TeamBoardMessage | null;
  activeItemCount: number;
  openPrCount: number;
  postCount: number;
  hasActiveReview: boolean;
}

export function deriveTeamRoster(input: DeriveTeamRosterInput): CockpitTeamMember[] {
  const resolve = input.resolve ?? m;
  const codingAgentLabel = resolve(msg("Coding Agent"));
  const aiReviewerLabel = resolve(msg("AI Reviewer"));
  const byHandle = new Map<string, MutableTeamMember>();
  const handleByUserId = new Map<string, string>();
  const takenHandles = new Set<string>();

  const getOrCreateMember = (params: {
    readonly handle: string;
    readonly id: string;
    readonly displayName: string;
    readonly kind: "human" | "agent";
    readonly isOwner?: boolean;
    readonly roles?: readonly string[];
    readonly subtitle?: string | null;
  }): MutableTeamMember => {
    const existing = byHandle.get(params.handle);
    if (existing) {
      if (params.isOwner) existing.isOwner = true;
      if (params.roles) mergeRoles(existing.roles, params.roles);
      if (params.kind === "agent" && existing.roles.length === 0) {
        existing.kind = "agent";
      }
      if (!existing.subtitle && params.subtitle) {
        existing.subtitle = params.subtitle;
      }
      if (existing.displayName === existing.handle && params.displayName !== params.handle) {
        existing.displayName = params.displayName;
      }
      return existing;
    }

    const created: MutableTeamMember = {
      id: params.id,
      handle: params.handle,
      displayName: cleanDisplayName(params.displayName, params.handle),
      kind: params.kind,
      isOwner: params.isOwner ?? false,
      roles: [],
      subtitle: params.subtitle ?? null,
      currentActivity: null,
      currentWorkItemId: null,
      currentChangeRequestId: null,
      latestPost: null,
      activeItemCount: 0,
      openPrCount: 0,
      postCount: 0,
      hasActiveReview: false,
    };
    if (params.roles) mergeRoles(created.roles, params.roles);
    byHandle.set(params.handle, created);
    takenHandles.add(params.handle);
    return created;
  };

  for (const member of input.members) {
    const handle = deriveWorkspaceMemberHandle(member, takenHandles);
    const isOwner = member.roles.some((role) => role.toLowerCase() === "owner");
    const isAgent =
      isAgentLikeHandle(handle) ||
      member.roles.some((role) => {
        const lower = role.toLowerCase();
        return lower === "agent" || lower === "bot";
      });
    const subtitle =
      member.primaryVcsLogin?.trim() || member.email?.trim() || (isAgent ? codingAgentLabel : null);

    getOrCreateMember({
      id: member.userId,
      handle,
      displayName: cleanDisplayName(member.displayName, handle),
      kind: isAgent ? "agent" : "human",
      isOwner,
      roles: member.roles,
      subtitle,
    });
    handleByUserId.set(member.userId, handle);
  }

  for (const message of input.boardMessages) {
    if (message.authorType === "system") continue;

    let resolvedHandle: string | null = null;
    if (message.authorUserId) {
      resolvedHandle = handleByUserId.get(message.authorUserId) ?? null;
    }
    if (!resolvedHandle) {
      resolvedHandle =
        normalizeHandleCandidate(message.authorHandle) ??
        normalizeHandleCandidate(message.authorDisplayName);
    }
    if (!resolvedHandle) continue;

    const kind: "human" | "agent" =
      message.authorType === "agent" || isAgentLikeHandle(resolvedHandle) ? "agent" : "human";
    const entry = getOrCreateMember({
      id: message.authorUserId ?? `${kind}:${resolvedHandle}`,
      handle: resolvedHandle,
      displayName: cleanDisplayName(message.authorDisplayName, resolvedHandle),
      kind,
      roles: kind === "agent" ? ["agent"] : [],
      subtitle: kind === "agent" ? codingAgentLabel : null,
    });

    if (message.authorUserId && !handleByUserId.has(message.authorUserId)) {
      handleByUserId.set(message.authorUserId, resolvedHandle);
    }
    entry.postCount += 1;
    if (isNewerMessage(message, entry.latestPost)) {
      entry.latestPost = message;
    }
  }

  const allChangeRequests = new Map<string, ChangeRequestAudit>();
  for (const cr of input.reviewItems) {
    allChangeRequests.set(cr.id, cr);
  }
  for (const card of input.cards) {
    for (const cr of card.changeRequests) {
      if (!allChangeRequests.has(cr.id)) {
        allChangeRequests.set(cr.id, cr);
      }
    }
  }

  const priorityRank = (priority: string): number => {
    switch (priority.toLowerCase()) {
      case "p0":
        return 0;
      case "p1":
        return 1;
      case "p2":
        return 2;
      default:
        return 3;
    }
  };

  const sortedCards = [...input.cards].toSorted((a, b) => {
    const aBlocked = a.workItem.health === "blocked" ? 0 : a.workItem.health === "at_risk" ? 1 : 2;
    const bBlocked = b.workItem.health === "blocked" ? 0 : b.workItem.health === "at_risk" ? 1 : 2;
    if (aBlocked !== bBlocked) return aBlocked - bBlocked;
    const pDiff = priorityRank(a.workItem.priority) - priorityRank(b.workItem.priority);
    if (pDiff !== 0) return pDiff;
    return b.workItem.updatedAt.localeCompare(a.workItem.updatedAt);
  });

  for (const card of sortedCards) {
    const isActive = !isWorkItemDoneStage(card.workItem.stage);
    let assignee: MutableTeamMember | null = null;

    if (card.workItem.assigneeType === "human" && card.workItem.assigneeUserId) {
      const existingHandle = handleByUserId.get(card.workItem.assigneeUserId);
      if (existingHandle) {
        assignee = byHandle.get(existingHandle) ?? null;
      } else {
        const cleanHandle = normalizeHandleCandidate(card.workItem.assigneeUserId);
        if (cleanHandle) {
          assignee = getOrCreateMember({
            id: card.workItem.assigneeUserId,
            handle: cleanHandle,
            displayName: cleanHandle,
            kind: isAgentLikeHandle(cleanHandle) ? "agent" : "human",
          });
        }
      }
    } else if (card.workItem.assigneeType === "runner" && card.workItem.assigneeRunnerId) {
      const runnerHandle = normalizeHandleCandidate(card.workItem.assigneeRunnerId);
      if (runnerHandle) {
        assignee = getOrCreateMember({
          id: `runner:${runnerHandle}`,
          handle: runnerHandle,
          displayName: card.workItem.assigneeRunnerId.trim(),
          kind: "agent",
          roles: ["agent"],
          subtitle: codingAgentLabel,
        });
      }
    }

    if (assignee && isActive) {
      assignee.activeItemCount += 1;
      if (!assignee.currentActivity) {
        assignee.currentActivity = `${card.workItem.code} · ${card.workItem.title}`;
        assignee.currentWorkItemId = card.workItem.id;
      }
    }

    if (card.latestPulse?.runnerId) {
      const pulseRunnerHandle = normalizeHandleCandidate(card.latestPulse.runnerId);
      if (pulseRunnerHandle) {
        const runner = getOrCreateMember({
          id: `runner:${pulseRunnerHandle}`,
          handle: pulseRunnerHandle,
          displayName: card.latestPulse.runnerId.trim(),
          kind: "agent",
          roles: ["agent"],
          subtitle: codingAgentLabel,
        });
        if (isActive && !runner.currentActivity && assignee?.handle !== runner.handle) {
          runner.currentActivity = `${card.workItem.code} · ${card.workItem.title}`;
          runner.currentWorkItemId = card.workItem.id;
        }
      }
    }
  }

  for (const cr of allChangeRequests.values()) {
    const isOpen = cr.state === "open" || cr.state === "draft";

    const authorHandle = normalizeHandleCandidate(cr.authorVcsLogin);
    if (authorHandle) {
      const authorKind: "human" | "agent" = isAgentLikeHandle(authorHandle) ? "agent" : "human";
      const author = getOrCreateMember({
        id: `vcs:${authorHandle}`,
        handle: authorHandle,
        displayName: cleanDisplayName(cr.authorVcsLogin, authorHandle),
        kind: authorKind,
        roles: authorKind === "agent" ? ["agent"] : [],
        subtitle: authorKind === "agent" ? codingAgentLabel : cr.authorVcsLogin.trim(),
      });
      if (isOpen) {
        author.openPrCount += 1;
        if (!author.currentChangeRequestId) {
          author.currentChangeRequestId = cr.id;
        }
        if (!author.currentActivity) {
          author.currentActivity = `${cr.repoFullName}#${cr.number} · ${cr.title}`;
        }
      }
    }

    for (const finding of cr.automatedReview.reviewers) {
      const reviewerHandle = normalizeHandleCandidate(finding.reviewerName);
      if (!reviewerHandle) continue;

      const reviewer = getOrCreateMember({
        id: `reviewer:${reviewerHandle}`,
        handle: reviewerHandle,
        displayName: cleanDisplayName(finding.reviewerName, reviewerHandle),
        kind: "agent",
        roles: ["reviewer", "agent"],
        subtitle: aiReviewerLabel,
      });

      const isActiveReview =
        isOpen &&
        (finding.state === "changes_requested" ||
          finding.state === "pending" ||
          cr.automatedReview.status === "blocking" ||
          cr.automatedReview.status === "pending");

      if (isActiveReview) {
        reviewer.hasActiveReview = true;
        if (!reviewer.currentChangeRequestId) {
          reviewer.currentChangeRequestId = cr.id;
        }
        if (!reviewer.currentActivity) {
          const summary = finding.bodyExcerpt.trim() || cr.title;
          reviewer.currentActivity = `${cr.repoFullName}#${cr.number} · ${truncateActivity(summary)}`;
        }
      }
    }
  }

  const referenceNowMs = input.nowMs ?? Date.now();
  const roster: CockpitTeamMember[] = [];

  for (const entry of byHandle.values()) {
    const latestPostMs = entry.latestPost ? Date.parse(entry.latestPost.createdAt) : Number.NaN;
    const hasRecentPost =
      !Number.isNaN(latestPostMs) &&
      referenceNowMs - latestPostMs >= -5 * 60 * 1000 &&
      referenceNowMs - latestPostMs <= RECENT_BOARD_ACTIVITY_WINDOW_MS;

    const isWorking =
      entry.activeItemCount > 0 || entry.openPrCount > 0 || entry.hasActiveReview || hasRecentPost;

    roster.push({
      id: entry.id,
      handle: entry.handle,
      displayName: entry.displayName,
      kind: entry.kind,
      isOwner: entry.isOwner,
      roles: entry.roles,
      subtitle: entry.subtitle,
      state: isWorking ? "working" : "standing_by",
      currentActivity: entry.currentActivity,
      currentWorkItemId: entry.currentWorkItemId,
      currentChangeRequestId: entry.currentChangeRequestId,
      latestPost: entry.latestPost,
      activeItemCount: entry.activeItemCount,
      openPrCount: entry.openPrCount,
      postCount: entry.postCount,
    });
  }

  return roster.toSorted((left, right) => {
    if (left.isOwner !== right.isOwner) return left.isOwner ? -1 : 1;
    if (left.state !== right.state) return left.state === "working" ? -1 : 1;
    const leftActivity = left.activeItemCount + left.openPrCount;
    const rightActivity = right.activeItemCount + right.openPrCount;
    if (leftActivity !== rightActivity) return rightActivity - leftActivity;
    if (left.postCount !== right.postCount) return right.postCount - left.postCount;
    return left.handle.localeCompare(right.handle);
  });
}

const MESSAGE_TOKEN_PATTERN =
  /`([^`\n]+)`|(?<![a-zA-Z0-9._/-])([a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+)#(\d+)\b|(?<![a-zA-Z0-9_/-])#(\d+)\b|(?<![a-zA-Z0-9._-])@([a-zA-Z0-9](?:[a-zA-Z0-9._-]{0,30}[a-zA-Z0-9])?(?:\[bot\])?)|(?<![a-zA-Z0-9_-])([A-Z][A-Z0-9]{1,9}-\d+)\b/g;

export function parseMessageTokens(body: string): BoardMessageToken[] {
  if (!body) return [];

  const tokens: BoardMessageToken[] = [];
  let cursor = 0;

  for (const match of body.matchAll(MESSAGE_TOKEN_PATTERN)) {
    const start = match.index ?? 0;
    const raw = match[0];

    if (start > cursor) {
      tokens.push({ kind: "text", value: body.slice(cursor, start) });
    }

    if (match[1] !== undefined) {
      tokens.push({ kind: "code", value: raw, code: match[1] });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      tokens.push({
        kind: "pr",
        value: raw,
        repoFullName: match[2],
        number: Number(match[3]),
      });
    } else if (match[4] !== undefined) {
      tokens.push({
        kind: "pr",
        value: raw,
        repoFullName: null,
        number: Number(match[4]),
      });
    } else if (match[5] !== undefined) {
      tokens.push({
        kind: "mention",
        value: raw,
        handle: match[5].toLowerCase(),
      });
    } else if (match[6] !== undefined) {
      tokens.push({
        kind: "work_item",
        value: raw,
        code: match[6],
      });
    }

    cursor = start + raw.length;
  }

  if (cursor < body.length) {
    tokens.push({ kind: "text", value: body.slice(cursor) });
  }

  return tokens;
}

function hashHandle(handle: string): number {
  let hash = 2166136261;
  for (let index = 0; index < handle.length; index += 1) {
    hash ^= handle.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function getAvatarToneClass(handle: string): string {
  switch (hashHandle(handle.toLowerCase()) % 8) {
    case 0:
      return "border-info/25 bg-info/14 text-info-foreground";
    case 1:
      return "border-success/25 bg-success/14 text-success-foreground";
    case 2:
      return "border-guest/25 bg-guest/14 text-guest-foreground";
    case 3:
      return "border-warning/25 bg-warning/14 text-warning-foreground";
    case 4:
      return "border-update/25 bg-update/14 text-update-foreground";
    case 5:
      return "border-primary/25 bg-primary/14 text-primary";
    case 6:
      return "border-destructive/25 bg-destructive/12 text-destructive-foreground";
    default:
      return "border-border/70 bg-secondary text-secondary-foreground";
  }
}

function getAvatarInitials(displayName: string, handle: string): string {
  const source = displayName.trim() || handle.trim();
  if (!source) return "?";
  const parts = source
    .replace(/\[bot\]$/i, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0]?.[0] ?? "";
    const second = parts[1]?.[0] ?? "";
    return `${first}${second}`.toUpperCase();
  }
  const clean = parts[0] ?? source;
  return clean.slice(0, 2).toUpperCase();
}

export interface CockpitSwarmAvatarProps {
  readonly handle: string;
  readonly displayName: string;
  readonly kind: "human" | "agent";
  readonly presence?: "working" | "standing_by" | undefined;
  readonly size?: "sm" | "md" | "lg" | undefined;
  readonly selected?: boolean | undefined;
  readonly className?: string | undefined;
}

export function CockpitSwarmAvatar({
  handle,
  displayName,
  kind,
  presence,
  size = "md",
  selected = false,
  className,
}: CockpitSwarmAvatarProps) {
  const sizeClass =
    size === "sm"
      ? "size-6 rounded-md text-3xs"
      : size === "lg"
        ? "size-10 rounded-lg text-sm"
        : "size-8 rounded-lg text-xs";

  const iconSizeClass = size === "sm" ? "size-3.5" : size === "lg" ? "size-5" : "size-4";
  const dotSizeClass = size === "sm" ? "size-1.5" : "size-2";

  return (
    <span
      aria-hidden
      className={cn(
        "relative inline-flex shrink-0 select-none items-center justify-center border font-semibold tracking-tight",
        sizeClass,
        getAvatarToneClass(handle),
        selected && "border-foreground/75 ring-1 ring-inset ring-foreground/30",
        className,
      )}
    >
      {kind === "agent" ? (
        <BotIcon className={iconSizeClass} />
      ) : (
        <span>{getAvatarInitials(displayName, handle)}</span>
      )}
      {presence === "working" ? (
        <span
          className={cn(
            "absolute right-0.5 bottom-0.5 rounded-full bg-success ring-1 ring-background",
            dotSizeClass,
          )}
        />
      ) : null}
    </span>
  );
}

export interface CockpitAllTeamAvatarProps {
  readonly size?: "sm" | "md" | "lg" | undefined;
  readonly selected?: boolean | undefined;
  readonly className?: string | undefined;
}

export function CockpitAllTeamAvatar({
  size = "lg",
  selected = false,
  className,
}: CockpitAllTeamAvatarProps) {
  const sizeClass =
    size === "sm"
      ? "size-6 rounded-md"
      : size === "lg"
        ? "size-10 rounded-lg"
        : "size-8 rounded-lg";
  const iconSizeClass = size === "sm" ? "size-3.5" : size === "lg" ? "size-4.5" : "size-4";

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center border border-border/70 bg-muted/45 text-foreground",
        sizeClass,
        selected &&
          "border-foreground/75 bg-accent text-foreground ring-1 ring-inset ring-foreground/30",
        className,
      )}
    >
      <UsersIcon className={iconSizeClass} />
    </span>
  );
}
