import type { EnvironmentId } from "@t3tools/contracts";
import {
  resolveLatestGateApprovals,
  type CockpitWorkItemCard,
  type ProjectRepo,
  type ReleaseCard,
  type ReleaseStatus,
} from "@u3code/hub-contracts";
import * as Schema from "effect/Schema";
import { msg, T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CopyIcon,
  FileTextIcon,
  GitCommitHorizontalIcon,
  ListChecksIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox, CheckboxMark } from "~/components/ui/checkbox";
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
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { useLocalStorage } from "~/hooks/useLocalStorage";
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
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  type CockpitTone,
} from "./CockpitPrimitives";
import { formatCockpitCommandError } from "./cockpitError";
import { buildReleaseDraftFromWorkItems } from "./releaseDraft";

export interface CockpitReleasesTabProps {
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: string;
  readonly refreshSignal: number;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly repos: ReadonlyArray<ProjectRepo>;
  readonly onOpenWorkItem?: ((workItemId: string) => void) | undefined;
}

type ReleaseFilter = "all" | "active" | "released";

const RELEASE_GATES = [
  { key: "qa_ac_pass" },
  { key: "security_clear" },
  { key: "prod_go" },
] as const;

const PIPELINE_STEPS: ReadonlyArray<ReleaseStatus> = ["planning", "staging", "ready", "released"];

const RELEASE_CHECKLIST_STORAGE_KEY = "u3code:cockpit-release-checklist:v1";
const releaseChecklistStorageSchema = Schema.Record(Schema.String, Schema.Array(Schema.String));

const RELEASE_CHECKLIST_ITEMS = [
  {
    key: "ci_green",
    label: msg("CI green on all target PRs"),
  },
  {
    key: "staging_qa",
    label: msg("Staging QA verified (qa-approved)"),
  },
  {
    key: "db_rollback",
    label: msg("DB migrations and rollback verified"),
  },
  {
    key: "env_flags",
    label: msg("Environment variables and feature flags confirmed"),
  },
  {
    key: "changelog",
    label: msg("Changelog and release notes ready"),
  },
  {
    key: "owners",
    label: msg("Release Manager and rollback owner confirmed"),
  },
  {
    key: "sli_monitoring",
    label: msg("Post-release SLI monitoring ready"),
  },
] as const;

interface ReleaseGitRefs {
  readonly tagVersion: string;
  readonly rcTag: string;
  readonly releaseBranch: string;
  readonly syncBranch: string;
}

function deriveReleaseGitRefs(versionLabel: string): ReleaseGitRefs {
  const sanitized = versionLabel.trim().replace(/\s+/g, "-");
  const withoutRc = sanitized.replace(/-rc\.\d+$/i, "");
  const tagVersion = withoutRc
    ? withoutRc.startsWith("v") || withoutRc.startsWith("V")
      ? `v${withoutRc.slice(1)}`
      : `v${withoutRc}`
    : "v1.0.0";
  const rcTag = /-rc\.\d+$/i.test(sanitized) ? sanitized : `${tagVersion}-rc.1`;
  const releaseBranch = `release/${tagVersion}`;
  const syncBranch = `sync/main-to-dev-${tagVersion}`;
  return { tagVersion, rcTag, releaseBranch, syncBranch };
}

interface ReleaseGitCommandItem {
  readonly key: "rc" | "prod" | "backmerge";
  readonly command: string;
}

function buildReleaseGitCommands(refs: ReleaseGitRefs): ReadonlyArray<ReleaseGitCommandItem> {
  return [
    {
      key: "rc",
      command: `git fetch origin ${refs.releaseBranch} && git tag -a ${refs.rcTag} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')" -m "Release candidate ${refs.rcTag}" && git push origin ${refs.rcTag}`,
    },
    {
      key: "prod",
      command: `git fetch origin main && git tag -a ${refs.tagVersion} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')" -m "Release ${refs.tagVersion}" && git push origin ${refs.tagVersion}`,
    },
    {
      key: "backmerge",
      command: `git fetch origin dev && git switch --no-track -c ${refs.syncBranch} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')" && git fetch origin main && git merge --no-ff "$(git rev-parse --verify 'FETCH_HEAD^{commit}')" -m "chore: back-merge main (${refs.tagVersion}) into dev" && git push -u origin HEAD`,
    },
  ];
}

interface InlineToken {
  readonly id: string;
  readonly kind: "bold" | "code" | "text";
  readonly value: string;
}

function tokenizeInlineMarkdown(text: string): ReadonlyArray<InlineToken> {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  const tokens: InlineToken[] = [];
  let offset = 0;
  for (const part of parts) {
    if (!part) continue;
    const id = `${offset}:${part.length}`;
    offset += part.length;
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      tokens.push({ id, kind: "bold", value: part.slice(2, -2) });
    } else if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      tokens.push({ id, kind: "code", value: part.slice(1, -1) });
    } else {
      tokens.push({ id, kind: "text", value: part });
    }
  }
  return tokens;
}

function renderInlineMarkdown(text: string): ReadonlyArray<ReactNode> {
  return tokenizeInlineMarkdown(text).map((token) => {
    if (token.kind === "bold") {
      return (
        <strong key={token.id} className="font-medium text-foreground">
          {token.value}
        </strong>
      );
    }
    if (token.kind === "code") {
      return (
        <code
          key={token.id}
          className="rounded bg-muted/70 px-1 py-0.5 font-mono text-2xs text-foreground"
        >
          {token.value}
        </code>
      );
    }
    return <Fragment key={token.id}>{token.value}</Fragment>;
  });
}

interface MarkdownListItem {
  readonly id: string;
  readonly text: string;
}

type MarkdownBlock =
  | {
      readonly id: string;
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly text: string;
    }
  | { readonly id: string; readonly kind: "list"; readonly items: ReadonlyArray<MarkdownListItem> }
  | { readonly id: string; readonly kind: "paragraph"; readonly text: string };

function parseReleaseMarkdown(markdown: string): ReadonlyArray<MarkdownBlock> {
  const lines = markdown.replaceAll("\r\n", "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let listItems: MarkdownListItem[] = [];
  let paragraphLines: string[] = [];
  let blockStartLine = 0;

  const flushList = () => {
    if (listItems.length > 0) {
      blocks.push({ id: `list:${blockStartLine}`, kind: "list", items: listItems });
      listItems = [];
    }
  };

  const flushParagraph = () => {
    if (paragraphLines.length > 0) {
      blocks.push({
        id: `p:${blockStartLine}`,
        kind: "paragraph",
        text: paragraphLines.join(" "),
      });
      paragraphLines = [];
    }
  };

  for (let lineNo = 0; lineNo < lines.length; lineNo += 1) {
    const trimmed = (lines[lineNo] ?? "").trim();
    if (!trimmed) {
      flushList();
      flushParagraph();
      continue;
    }

    const headingMatch = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      flushList();
      flushParagraph();
      const level = Math.min(3, headingMatch[1]?.length ?? 2) as 1 | 2 | 3;
      blocks.push({
        id: `h:${lineNo}`,
        kind: "heading",
        level,
        text: headingMatch[2] ?? "",
      });
      continue;
    }

    const bulletMatch = /^(?:[-*]|\d+\.)\s+(.+)$/.exec(trimmed);
    if (bulletMatch) {
      flushParagraph();
      if (listItems.length === 0) blockStartLine = lineNo;
      listItems.push({ id: `li:${lineNo}`, text: bulletMatch[1] ?? "" });
      continue;
    }

    flushList();
    if (paragraphLines.length === 0) blockStartLine = lineNo;
    paragraphLines.push(trimmed);
  }

  flushList();
  flushParagraph();
  return blocks;
}

function ReleaseNotesProse({ markdown }: { readonly markdown: string }) {
  const blocks = parseReleaseMarkdown(markdown);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-2.5 text-xs leading-6 text-foreground/90">
      {blocks.map((block) => {
        if (block.kind === "heading") {
          const headingClass =
            block.level === 1
              ? "pt-1 text-sm font-semibold tracking-tight text-foreground"
              : block.level === 2
                ? "pt-1 text-xs font-semibold tracking-tight text-foreground"
                : "pt-0.5 text-xs font-medium text-foreground";
          return (
            <h4 key={block.id} className={headingClass}>
              {renderInlineMarkdown(block.text)}
            </h4>
          );
        }
        if (block.kind === "list") {
          return (
            <ul key={block.id} className="space-y-1.5 pl-4 text-xs leading-6 text-foreground/90">
              {block.items.map((item) => (
                <li key={item.id} className="list-disc marker:text-muted-foreground/65">
                  {renderInlineMarkdown(item.text)}
                </li>
              ))}
            </ul>
          );
        }
        return (
          <p key={block.id} className="text-xs leading-6 text-foreground/90">
            {renderInlineMarkdown(block.text)}
          </p>
        );
      })}
    </div>
  );
}

function isActiveReleaseStatus(status: ReleaseStatus): boolean {
  return status === "planning" || status === "staging" || status === "ready";
}

function releaseStatusVariant(
  status: ReleaseStatus,
): "secondary" | "info" | "warning" | "success" | "error" {
  switch (status) {
    case "planning":
      return "secondary";
    case "staging":
      return "info";
    case "ready":
      return "warning";
    case "released":
      return "success";
    case "rolled_back":
      return "error";
  }
}

function releaseHeaderTone(status: ReleaseStatus) {
  switch (status) {
    case "planning":
      return "primary" as const;
    case "staging":
      return "info" as const;
    case "ready":
      return "warning" as const;
    case "released":
      return "success" as const;
    case "rolled_back":
      return "error" as const;
  }
}

function nextReleaseStatus(status: ReleaseStatus): ReleaseStatus | null {
  switch (status) {
    case "planning":
      return "staging";
    case "staging":
      return "ready";
    case "ready":
      return "released";
    default:
      return null;
  }
}

export function CockpitReleasesTab({
  environmentId,
  selectedProjectId,
  refreshSignal,
  cards,
  repos,
  onOpenWorkItem,
}: CockpitReleasesTabProps) {
  const gt = useGT();
  const resolveMessage = useMessages();
  const [releases, setReleases] = useState<ReadonlyArray<ReleaseCard>>([]);
  const [filter, setFilter] = useState<ReleaseFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);

  const [versionLabel, setVersionLabel] = useState("");
  const [selectedWorkItemIds, setSelectedWorkItemIds] = useState<ReadonlyArray<string>>([]);
  const [snapshotsText, setSnapshotsText] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [creating, setCreating] = useState(false);

  const [busyGateTarget, setBusyGateTarget] = useState<string | null>(null);
  const [rejectingGateTarget, setRejectingGateTarget] = useState<{
    readonly releaseId: string;
    readonly gateKey: string;
  } | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [expandedDetailsOverrides, setExpandedDetailsOverrides] = useState<
    Readonly<Record<string, boolean>>
  >({});
  const [checkedByRelease, setCheckedByRelease] = useLocalStorage(
    RELEASE_CHECKLIST_STORAGE_KEY,
    {},
    releaseChecklistStorageSchema,
  );
  const [lastCopiedCommandKey, setLastCopiedCommandKey] = useState<string | null>(null);
  const { copyToClipboard, isCopied } = useCopyToClipboard<string>({
    onCopy: (key) => {
      setLastCopiedCommandKey(key);
      toastManager.add({ title: gt("Git command copied to clipboard"), type: "success" });
    },
    onError: () => {
      toastManager.add({ title: gt("Failed to copy git command."), type: "error" });
    },
  });

  const listReleases = useAtomCommand(teamHubEnvironment.listReleases, { reportFailure: false });
  const createRelease = useAtomCommand(teamHubEnvironment.createRelease, { reportFailure: false });
  const updateRelease = useAtomCommand(teamHubEnvironment.updateRelease, { reportFailure: false });
  const approveGate = useAtomCommand(teamHubEnvironment.approveGate, { reportFailure: false });

  const loadReleases = useEffectEvent(
    (envId: EnvironmentId, projId: string, _signal: number, cancelled: () => boolean) => {
      void listReleases({ environmentId: envId, input: { projectId: projId } }).then((res) => {
        if (cancelled()) return;
        if (res._tag === "Success") {
          setReleases(res.value.releases);
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize project release cards from external Team Hub API when project or live signal changes.
  useEffect(() => {
    if (!selectedProjectId) return;
    let cancelled = false;
    loadReleases(environmentId, selectedProjectId, refreshSignal, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, selectedProjectId, refreshSignal]);

  const allReleases = selectedProjectId ? releases : [];
  const activeCount = allReleases.filter((item) =>
    isActiveReleaseStatus(item.release.status),
  ).length;
  const shippedCount = allReleases.filter(
    (item) => item.release.status === "released" || item.release.status === "rolled_back",
  ).length;

  const visibleReleases = allReleases.filter((item) => {
    if (filter === "active") {
      return isActiveReleaseStatus(item.release.status);
    }
    if (filter === "released") {
      return item.release.status === "released" || item.release.status === "rolled_back";
    }
    return true;
  });

  const cardById = new Map(cards.map((c) => [c.workItem.id, c] as const));
  const validSelectedIds = selectedWorkItemIds.filter((id) => cardById.has(id));
  const selectedIdSet = new Set(validSelectedIds);

  const statusLabel = (status: ReleaseStatus) => {
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
  };

  const gateLabel = (key: string) => {
    switch (key) {
      case "qa_ac_pass":
        return gt("QA Sign-off");
      case "security_clear":
        return gt("Security Sign-off");
      case "prod_go":
        return gt("Production Go/No-Go");
      default:
        return key;
    }
  };

  const handleToggleReleaseDetails = (releaseId: string, currentlyExpanded: boolean) => {
    setExpandedDetailsOverrides((prev) => ({
      ...prev,
      [releaseId]: !currentlyExpanded,
    }));
  };

  const handleToggleChecklistItem = (releaseId: string, itemKey: string, nextChecked: boolean) => {
    setCheckedByRelease((prev) => {
      const existing = prev[releaseId] ?? [];
      const nextItems = nextChecked
        ? existing.includes(itemKey)
          ? [...existing]
          : [...existing, itemKey]
        : existing.filter((key) => key !== itemKey);
      return {
        ...prev,
        [releaseId]: nextItems,
      };
    });
  };

  const gitCommandLabel = (key: ReleaseGitCommandItem["key"]) => {
    switch (key) {
      case "rc":
        return gt("Tag RC (staging)");
      case "prod":
        return gt("Tag Production (main)");
      case "backmerge":
        return gt("Back-merge main → dev (Merge commit)");
    }
  };

  const handleToggleWorkItem = (workItemId: string) => {
    setSelectedWorkItemIds((prev) =>
      prev.includes(workItemId) ? prev.filter((id) => id !== workItemId) : [...prev, workItemId],
    );
  };

  const handleSelectCandidates = () => {
    const candidateIds = cards
      .filter(
        (c) =>
          c.workItem.stage === "staging" ||
          c.workItem.stage === "review" ||
          c.workItem.stage === "qa",
      )
      .map((c) => c.workItem.id);
    setSelectedWorkItemIds(
      candidateIds.length > 0 ? candidateIds : cards.map((c) => c.workItem.id),
    );
  };

  const handleAutoFillDraft = () => {
    const chosenCards = validSelectedIds
      .map((id) => cardById.get(id))
      .filter((c): c is CockpitWorkItemCard => c !== undefined);
    const draft = buildReleaseDraftFromWorkItems({
      selectedCards: chosenCards,
      repos,
    });
    if (draft.snapshotsText) setSnapshotsText(draft.snapshotsText);
    if (draft.releaseNotesMd) setReleaseNotes(draft.releaseNotesMd);
    toastManager.add({ title: gt("Release snapshots and notes generated"), type: "success" });
  };

  const handleCreateRelease = async () => {
    if (!selectedProjectId || !versionLabel.trim()) return;
    const repoSnapshots: Record<string, string> = {};
    for (const line of snapshotsText.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const sepIdx = trimmed.indexOf("=");
      if (sepIdx > 0) {
        repoSnapshots[trimmed.slice(0, sepIdx).trim()] = trimmed.slice(sepIdx + 1).trim();
      } else {
        repoSnapshots[trimmed] = "HEAD";
      }
    }

    setCreating(true);
    const res = await createRelease({
      environmentId,
      input: {
        projectId: selectedProjectId,
        versionLabel: versionLabel.trim(),
        repoSnapshots,
        rollbackPlan: rollbackPlan.trim(),
        releaseNotesMd: releaseNotes.trim(),
        ...(validSelectedIds.length > 0 ? { workItemIds: validSelectedIds } : {}),
      },
    });
    setCreating(false);
    if (res._tag === "Success") {
      setVersionLabel("");
      setSelectedWorkItemIds([]);
      setSnapshotsText("");
      setRollbackPlan("");
      setReleaseNotes("");
      setCreateOpen(false);
      setReleases((prev) => [res.value.release, ...prev]);
      toastManager.add({ title: gt("Release created"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to create release.")),
        type: "error",
      });
    }
  };

  const handleUpdateStatus = async (releaseId: string, status: ReleaseStatus) => {
    const res = await updateRelease({
      environmentId,
      input: { releaseId, status },
    });
    if (res._tag === "Success") {
      setReleases((prev) =>
        prev.map((item) => (item.release.id === releaseId ? res.value.release : item)),
      );
      toastManager.add({ title: gt("Release status updated"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update release status.")),
        type: "error",
      });
    }
  };

  const handleReleaseGateDecision = async (
    releaseId: string,
    gateKey: string,
    status: "approved" | "rejected",
    note?: string,
  ) => {
    const targetKey = `${releaseId}:${gateKey}`;
    setBusyGateTarget(targetKey);
    const res = await approveGate({
      environmentId,
      input: {
        targetType: "release",
        targetId: releaseId,
        gateKey,
        status,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    });
    setBusyGateTarget(null);
    if (res._tag === "Success") {
      setRejectingGateTarget(null);
      setRejectNote("");
      toastManager.add({
        title: status === "approved" ? gt("Release gate approved") : gt("Release gate rejected"),
        type: status === "approved" ? "success" : "warning",
      });
      if (selectedProjectId) {
        const listRes = await listReleases({
          environmentId,
          input: { projectId: selectedProjectId },
        });
        if (listRes._tag === "Success") {
          setReleases(listRes.value.releases);
        }
      }
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update release gate.")),
        type: "error",
      });
    }
  };

  if (!selectedProjectId) {
    return (
      <CockpitSurface
        className="border-border/60 bg-linear-to-b from-card/80 to-card/45 py-4 shadow-xs ring-1 ring-inset ring-foreground/5"
        variant="grouped"
      >
        <Empty size="compact">
          <EmptyMedia>
            <CockpitIllustration className="w-72 sm:w-80" kind="empty_releases" />
          </EmptyMedia>
          <EmptyHeader>
            <EmptyTitle>
              <T>No project selected</T>
            </EmptyTitle>
            <EmptyDescription>
              <T>Select or create a project to coordinate cross-repository releases.</T>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </CockpitSurface>
    );
  }

  return (
    <div className="space-y-6">
      <CockpitStudioBanner
        actions={
          <Button size="sm" variant="default" onClick={() => setCreateOpen(true)}>
            <PlusIcon />
            <T>Plan Release</T>
          </Button>
        }
        art="release_train"
        compact
        description={
          <T>
            Coordinate dev → main release freezes, cross-repository snapshots, and QA, Security, and
            Production Go/No-Go sign-offs.
          </T>
        }
        eyebrow={
          <span className="inline-flex items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
            <CockpitStatusDot ring={activeCount > 0} tone={activeCount > 0 ? "info" : "neutral"} />
            <T>Dual-Trunk Release Studio</T>
          </span>
        }
        meta={
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CockpitStatusDot tone={activeCount > 0 ? "info" : "neutral"} />
              <span className="font-medium text-foreground">
                {gt(
                  "{count, plural, one {{count} active release} other {{count} active releases}}",
                  { count: activeCount },
                )}
              </span>
            </span>
            <span aria-hidden className="opacity-35">
              ·
            </span>
            <span className="inline-flex items-center gap-1.5 tabular-nums">
              <CockpitStatusDot tone={shippedCount > 0 ? "success" : "neutral"} />
              <span>
                <T>
                  <Var>{shippedCount}</Var> shipped
                </T>
              </span>
            </span>
            {repos.length > 0 ? (
              <>
                <span aria-hidden className="opacity-35">
                  ·
                </span>
                <span className="font-mono text-2xs tabular-nums">
                  {gt("{count, plural, one {{count} repo} other {{count} repos}}", {
                    count: repos.length,
                  })}
                </span>
              </>
            ) : null}
          </div>
        }
        title={<T>Release Trains &amp; Sign-off Gates</T>}
      />

      {allReleases.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ToggleGroup
            size="segmented"
            variant="segmented"
            value={[filter]}
            onValueChange={(next) => {
              const value = next[0];
              if (value === "all" || value === "active" || value === "released") {
                setFilter(value);
              }
            }}
          >
            <Toggle value="all">
              <T>All</T>
              <span className="ml-1 tabular-nums opacity-60">{allReleases.length}</span>
            </Toggle>
            <Toggle value="active">
              <T>In Progress</T>
              {activeCount > 0 ? (
                <span className="ml-1 tabular-nums opacity-60">{activeCount}</span>
              ) : null}
            </Toggle>
            <Toggle value="released">
              <T>Shipped</T>
              {shippedCount > 0 ? (
                <span className="ml-1 tabular-nums opacity-60">{shippedCount}</span>
              ) : null}
            </Toggle>
          </ToggleGroup>
        </div>
      ) : null}

      {allReleases.length === 0 ? (
        <CockpitSurface
          className="border-border/60 bg-linear-to-b from-card/80 to-card/45 shadow-xs ring-1 ring-inset ring-foreground/5"
          variant="grouped"
        >
          <Empty size="compact">
            <EmptyMedia>
              <CockpitIconBadge size="lg" tone="primary">
                <CockpitStageArtworkIcon stage="release" />
              </CockpitIconBadge>
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>
                <T>No releases planned yet</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>
                  Coordinate cross-repository snapshots, rollback plans, and QA, Security, and
                  Production Go/No-Go sign-offs in one release train.
                </T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
                <PlusIcon />
                <T>Plan First Release</T>
              </Button>
            </EmptyContent>
          </Empty>
        </CockpitSurface>
      ) : visibleReleases.length === 0 ? (
        <CockpitSurface
          className="border-border/60 bg-linear-to-b from-card/80 to-card/45 shadow-xs ring-1 ring-inset ring-foreground/5"
          variant="grouped"
        >
          <Empty size="compact">
            <EmptyMedia>
              <CockpitIconBadge size="lg" tone="neutral">
                <CockpitStageArtworkIcon stage="release" />
              </CockpitIconBadge>
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>
                <T>No releases match this filter</T>
              </EmptyTitle>
              <EmptyDescription>
                <T>Switch back to All to inspect planned or shipped release trains.</T>
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button size="xs" variant="outline" onClick={() => setFilter("all")}>
                <T>Show All Releases</T>
              </Button>
            </EmptyContent>
          </Empty>
        </CockpitSurface>
      ) : (
        <div className="space-y-6">
          {visibleReleases.map((card) => {
            const latestGates = resolveLatestGateApprovals(card.gateApprovals);
            const snapshots = Object.entries(card.release.repoSnapshots);
            const nextStatus = nextReleaseStatus(card.release.status);
            const currentStepIdx = PIPELINE_STEPS.indexOf(card.release.status);
            const approvedCount = RELEASE_GATES.filter(
              (g) => latestGates.get(g.key)?.status === "approved",
            ).length;
            const hasRejectedGate = RELEASE_GATES.some(
              (g) => latestGates.get(g.key)?.status === "rejected",
            );
            const signOffTone: CockpitTone = hasRejectedGate
              ? "error"
              : approvedCount === RELEASE_GATES.length
                ? "success"
                : "neutral";
            const isActiveRelease = isActiveReleaseStatus(card.release.status);
            const defaultDetailsExpanded = visibleReleases.length === 1 && isActiveRelease;
            const detailsExpanded =
              expandedDetailsOverrides[card.release.id] ?? defaultDetailsExpanded;
            const gitRefs = deriveReleaseGitRefs(card.release.versionLabel);
            const gitCommands = buildReleaseGitCommands(gitRefs);
            const checkedKeys = new Set(checkedByRelease[card.release.id] ?? []);
            const checkedCount = RELEASE_CHECKLIST_ITEMS.filter((item) =>
              checkedKeys.has(item.key),
            ).length;
            const qaApproved = latestGates.get("qa_ac_pass")?.status === "approved";
            const devBranchLabel = "dev";
            const mainBranchLabel = "main";
            const qaApprovedLabel = "qa-approved";
            const dualTrunkSteps: ReadonlyArray<{
              readonly key: string;
              readonly label: ReactNode;
              readonly hint?: ReactNode;
              readonly state: "done" | "current" | "upcoming";
            }> = [
              {
                key: "dev",
                label: <span className="font-mono">{devBranchLabel}</span>,
                state: "done",
              },
              {
                key: "freeze",
                label: <span className="font-mono">{gitRefs.releaseBranch}</span>,
                hint: <T>freeze</T>,
                state: card.release.status === "planning" ? "current" : "done",
              },
              {
                key: "rc",
                label: <span className="font-mono">{gitRefs.rcTag}</span>,
                hint: <T>staging</T>,
                state:
                  card.release.status === "planning"
                    ? "upcoming"
                    : card.release.status === "staging"
                      ? "current"
                      : "done",
              },
              {
                key: "qa",
                label: <span className="font-mono">{qaApprovedLabel}</span>,
                state:
                  qaApproved || card.release.status === "ready"
                    ? "done"
                    : card.release.status === "staging"
                      ? "current"
                      : "upcoming",
              },
              {
                key: "merge_main",
                label: <T>Merge commit → main</T>,
                state: card.release.status === "ready" ? "current" : "upcoming",
              },
              {
                key: "prod_tag",
                label: <span className="font-mono">{gitRefs.tagVersion}</span>,
                hint: <T>tag</T>,
                state: "upcoming",
              },
              {
                key: "backmerge",
                label: <T>Merge commit main → dev</T>,
                state: "upcoming",
              },
            ];

            return (
              <CockpitSurface
                key={card.release.id}
                className="overflow-hidden border-border/65 bg-linear-to-b from-card/85 to-card/45 shadow-sm ring-1 ring-inset ring-foreground/5"
                variant="grouped"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-5">
                  <div className="flex min-w-0 items-center gap-3.5">
                    <CockpitIconBadge
                      className="shrink-0"
                      size="lg"
                      tone={releaseHeaderTone(card.release.status)}
                    >
                      <CockpitStageArtworkIcon stage="release" />
                    </CockpitIconBadge>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
                      <span className="font-mono text-base font-semibold tracking-tight text-foreground">
                        {card.release.versionLabel}
                      </span>
                      <Badge size="sm" variant={releaseStatusVariant(card.release.status)}>
                        {statusLabel(card.release.status)}
                      </Badge>
                      <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
                        <CockpitStatusDot tone={signOffTone} />
                        <T>
                          <Var>{approvedCount}</Var>/<Var>{RELEASE_GATES.length}</Var> sign-offs
                        </T>
                      </span>
                      {card.release.releasedAt ? (
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {card.release.releasedAt.slice(0, 16).replace("T", " ")}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {nextStatus ? (
                      <Button
                        size="xs"
                        variant="outline"
                        onClick={() => void handleUpdateStatus(card.release.id, nextStatus)}
                      >
                        <T>
                          Move to <Var>{statusLabel(nextStatus)}</Var>
                        </T>
                        <ArrowRightIcon />
                      </Button>
                    ) : null}
                    {card.release.status === "released" ? (
                      <Button
                        size="xs"
                        variant="destructive-outline"
                        onClick={() => void handleUpdateStatus(card.release.id, "rolled_back")}
                      >
                        <RotateCcwIcon />
                        <T>Mark Rolled Back</T>
                      </Button>
                    ) : null}
                  </div>
                </div>

                {card.release.status !== "rolled_back" ? (
                  <div className="grid grid-cols-4 gap-3.5 border-y border-border/50 bg-muted/15 px-6 py-3.5">
                    {PIPELINE_STEPS.map((step, idx) => {
                      const reached = currentStepIdx >= idx;
                      const current = currentStepIdx === idx;
                      const completedAll = card.release.status === "released";
                      return (
                        <div key={step} className="space-y-1.5">
                          <div
                            className={cn(
                              "h-1.5 rounded-full transition-colors",
                              reached
                                ? completedAll
                                  ? "bg-success"
                                  : "bg-foreground/80"
                                : "bg-border/65",
                            )}
                          />
                          <div
                            className={cn(
                              "text-2xs",
                              current
                                ? "font-medium text-foreground"
                                : reached
                                  ? "text-muted-foreground"
                                  : "text-muted-foreground/50",
                            )}
                          >
                            {statusLabel(step)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                {isActiveRelease ? (
                  <div className="space-y-2.5 border-b border-border/50 bg-background/35 px-6 py-3.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-2xs">
                      <div className="inline-flex items-center gap-1.5">
                        <CockpitArtifactIcon
                          className="size-3.5 shrink-0 text-info-foreground"
                          kind="branch"
                        />
                        <span className="font-medium text-foreground">
                          <T>Dual-Trunk Flow</T>
                        </span>
                        <span className="font-mono text-muted-foreground/80">
                          {`${devBranchLabel} → ${mainBranchLabel}`}
                        </span>
                      </div>
                      <span className="font-mono text-muted-foreground/80">
                        {gitRefs.releaseBranch}
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 text-2xs">
                      {dualTrunkSteps.map((step, idx) => (
                        <Fragment key={step.key}>
                          {idx > 0 ? (
                            <ChevronRightIcon
                              aria-hidden
                              className="size-3 shrink-0 text-muted-foreground/40"
                            />
                          ) : null}
                          <span
                            className={cn(
                              "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-1 whitespace-nowrap",
                              step.state === "done"
                                ? "border-success/25 bg-success/8 text-success-foreground"
                                : step.state === "current"
                                  ? "border-primary/35 bg-primary/10 font-medium text-foreground"
                                  : "border-border/45 bg-card/45 text-muted-foreground/75",
                            )}
                          >
                            {step.state === "done" ? (
                              <CheckIcon aria-hidden className="size-2.5 shrink-0" />
                            ) : null}
                            <span>{step.label}</span>
                            {step.hint ? (
                              <span className="text-muted-foreground/70">({step.hint})</span>
                            ) : null}
                          </span>
                        </Fragment>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-6 px-6 py-5">
                  <div className="space-y-2.5">
                    <CockpitSectionHeader
                      action={
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {`${approvedCount}/${RELEASE_GATES.length}`}
                        </span>
                      }
                      icon={
                        <CockpitStageArtworkIcon
                          className={cn(
                            "size-3.5 shrink-0",
                            signOffTone === "error"
                              ? "text-destructive"
                              : signOffTone === "success"
                                ? "text-success-foreground"
                                : "text-muted-foreground",
                          )}
                          stage="governance"
                        />
                      }
                      title={<T>Release Sign-off Gates</T>}
                    />
                    <div className="divide-y divide-border/50 rounded-xl border border-border/50 bg-background/40">
                      {RELEASE_GATES.map((gate) => {
                        const latest = latestGates.get(gate.key);
                        const status = latest?.status ?? null;
                        const busyKey = `${card.release.id}:${gate.key}`;
                        const isRejectingThis =
                          rejectingGateTarget?.releaseId === card.release.id &&
                          rejectingGateTarget.gateKey === gate.key;

                        return (
                          <div key={gate.key} className="px-4 py-3">
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
                              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1.5">
                                <span className="shrink-0 text-xs font-medium text-foreground sm:min-w-36">
                                  {gateLabel(gate.key)}
                                </span>
                                {status === "approved" ? (
                                  <Badge size="sm" variant="success">
                                    <CheckCircle2Icon />
                                    <T>Approved</T>
                                  </Badge>
                                ) : status === "rejected" ? (
                                  <Badge size="sm" variant="error">
                                    <ShieldAlertIcon />
                                    <T>Rejected</T>
                                  </Badge>
                                ) : (
                                  <Badge size="sm" variant="secondary">
                                    {gt("Awaiting sign-off")}
                                  </Badge>
                                )}
                                {latest?.note ? (
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 text-xs leading-snug",
                                      status === "rejected"
                                        ? "text-destructive"
                                        : "text-muted-foreground",
                                    )}
                                  >
                                    {latest.note}
                                  </span>
                                ) : null}
                              </div>

                              {!isRejectingThis ? (
                                <div className="flex shrink-0 items-center gap-1.5">
                                  {status !== "approved" ? (
                                    <Button
                                      disabled={busyGateTarget === busyKey}
                                      size="micro"
                                      variant="outline"
                                      onClick={() =>
                                        void handleReleaseGateDecision(
                                          card.release.id,
                                          gate.key,
                                          "approved",
                                        )
                                      }
                                    >
                                      <ShieldCheckIcon />
                                      <T>Approve</T>
                                    </Button>
                                  ) : null}
                                  <Button
                                    disabled={busyGateTarget === busyKey}
                                    size="micro"
                                    variant="ghost-muted"
                                    onClick={() => {
                                      setRejectingGateTarget({
                                        releaseId: card.release.id,
                                        gateKey: gate.key,
                                      });
                                      setRejectNote("");
                                    }}
                                  >
                                    <T>Reject</T>
                                  </Button>
                                </div>
                              ) : null}
                            </div>

                            {isRejectingThis ? (
                              <div className="mt-2.5 flex flex-wrap items-center gap-2">
                                <div className="min-w-0 flex-1">
                                  <Input
                                    placeholder={gt("Rejection reason (notifies owners)...")}
                                    size="compact"
                                    value={rejectNote}
                                    onChange={(event) => setRejectNote(event.target.value)}
                                    onKeyDown={(event) => {
                                      if (event.key === "Enter" && busyGateTarget !== busyKey) {
                                        event.preventDefault();
                                        void handleReleaseGateDecision(
                                          card.release.id,
                                          gate.key,
                                          "rejected",
                                          rejectNote,
                                        );
                                      }
                                    }}
                                  />
                                </div>
                                <div className="flex shrink-0 items-center gap-1.5">
                                  <Button
                                    size="micro"
                                    variant="ghost"
                                    onClick={() => {
                                      setRejectingGateTarget(null);
                                      setRejectNote("");
                                    }}
                                  >
                                    <T>Cancel</T>
                                  </Button>
                                  <Button
                                    disabled={busyGateTarget === busyKey}
                                    size="micro"
                                    variant="destructive"
                                    onClick={() =>
                                      void handleReleaseGateDecision(
                                        card.release.id,
                                        gate.key,
                                        "rejected",
                                        rejectNote,
                                      )
                                    }
                                  >
                                    <T>Confirm</T>
                                  </Button>
                                </div>
                              </div>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {card.workItemIds.length > 0 || snapshots.length > 0 ? (
                    <div className="space-y-4">
                      {card.workItemIds.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            <T>Included Work Items</T>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {card.workItemIds.map((wiId) => {
                              const matched = cardById.get(wiId);
                              return onOpenWorkItem ? (
                                <Button
                                  key={wiId}
                                  size="xs"
                                  variant="outline"
                                  onClick={() => onOpenWorkItem(wiId)}
                                >
                                  {matched ? (
                                    <CockpitPriorityDot
                                      priority={matched.workItem.priority}
                                      showLabel={false}
                                    />
                                  ) : null}
                                  <span className="font-mono text-muted-foreground">
                                    {matched?.workItem.code ?? wiId}
                                  </span>
                                  {matched ? (
                                    <span className="max-w-64 truncate">
                                      {matched.workItem.title}
                                    </span>
                                  ) : null}
                                </Button>
                              ) : (
                                <Badge key={wiId} size="sm" variant="secondary">
                                  {matched
                                    ? `${matched.workItem.code} · ${matched.workItem.title}`
                                    : wiId}
                                </Badge>
                              );
                            })}
                          </div>
                        </div>
                      ) : null}

                      {snapshots.length > 0 ? (
                        <div className="space-y-2">
                          <div className="text-xs font-medium text-muted-foreground">
                            <T>Repository Snapshots</T>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {snapshots.map(([repo, ref]) => (
                              <span
                                key={repo}
                                className="inline-flex items-center gap-1.5 rounded-md border border-border/60 bg-muted/25 px-2.5 py-1 font-mono text-2xs text-foreground"
                              >
                                <GitCommitHorizontalIcon className="size-3 shrink-0 text-muted-foreground" />
                                {`${repo}@${String(ref)}`}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <div className="border-t border-border/50 pt-4">
                    <button
                      aria-expanded={detailsExpanded}
                      className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-xs font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      type="button"
                      onClick={() => handleToggleReleaseDetails(card.release.id, detailsExpanded)}
                    >
                      <span className="inline-flex items-center gap-1.5">
                        {detailsExpanded ? (
                          <ChevronDownIcon className="size-3.5 shrink-0 opacity-75" />
                        ) : (
                          <ChevronRightIcon className="size-3.5 shrink-0 opacity-75" />
                        )}
                        <T>Release Notes, Checklist &amp; Git Commands</T>
                      </span>
                      <span className="inline-flex shrink-0 items-center gap-2.5 text-2xs font-normal text-muted-foreground/75">
                        <span
                          className={cn(
                            "font-mono tabular-nums",
                            checkedCount === RELEASE_CHECKLIST_ITEMS.length
                              ? "text-success-foreground"
                              : "text-muted-foreground",
                          )}
                        >
                          <T>
                            <Var>{checkedCount}</Var>/<Var>{RELEASE_CHECKLIST_ITEMS.length}</Var>{" "}
                            checked
                          </T>
                        </span>
                        <span>{detailsExpanded ? <T>Hide</T> : <T>Show</T>}</span>
                      </span>
                    </button>

                    {detailsExpanded ? (
                      <div className="mt-3.5 space-y-5 px-1">
                        {card.release.releaseNotesMd ? (
                          <div className="space-y-1.5">
                            <div className="text-2xs font-medium text-muted-foreground">
                              <T>Release Notes</T>
                            </div>
                            <ReleaseNotesProse markdown={card.release.releaseNotesMd} />
                          </div>
                        ) : null}

                        {card.release.rollbackPlan ? (
                          <div className="space-y-1.5">
                            <div className="text-2xs font-medium text-muted-foreground">
                              <T>Rollback Plan</T>
                            </div>
                            <div className="rounded-lg border border-border/50 bg-muted/20 px-3.5 py-2.5">
                              <p className="text-xs leading-6 whitespace-pre-wrap text-muted-foreground">
                                {card.release.rollbackPlan}
                              </p>
                            </div>
                          </div>
                        ) : null}

                        <div className="space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <ListChecksIcon
                                aria-hidden
                                className="size-3.5 shrink-0 text-muted-foreground"
                              />
                              <T>Release Readiness Checklist</T>
                            </div>
                            <span
                              className={cn(
                                "font-mono text-2xs tabular-nums",
                                checkedCount === RELEASE_CHECKLIST_ITEMS.length
                                  ? "text-success-foreground"
                                  : "text-muted-foreground",
                              )}
                            >
                              <T>
                                <Var>{checkedCount}</Var>/
                                <Var>{RELEASE_CHECKLIST_ITEMS.length}</Var> checked
                              </T>
                            </span>
                          </div>
                          <div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-background/40">
                            {RELEASE_CHECKLIST_ITEMS.map((item) => {
                              const checked = checkedKeys.has(item.key);
                              return (
                                <label
                                  key={item.key}
                                  className="flex cursor-pointer items-center gap-2.5 px-4 py-2.5 text-xs transition-colors hover:bg-accent/25"
                                >
                                  <Checkbox
                                    checked={checked}
                                    onCheckedChange={(next) =>
                                      handleToggleChecklistItem(
                                        card.release.id,
                                        item.key,
                                        Boolean(next),
                                      )
                                    }
                                  />
                                  <span
                                    className={cn(
                                      "min-w-0 flex-1 leading-snug",
                                      checked
                                        ? "text-muted-foreground line-through"
                                        : "text-foreground",
                                    )}
                                  >
                                    {resolveMessage(item.label)}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        </div>

                        <div className="space-y-2.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="inline-flex items-center gap-1.5 text-xs font-medium text-foreground">
                              <TerminalIcon
                                aria-hidden
                                className="size-3.5 shrink-0 text-warning-foreground"
                              />
                              <T>Safe Git Tag &amp; Back-Merge Commands</T>
                            </div>
                            <span className="text-2xs text-warning-foreground">
                              <T>Never squash-merge main → dev; tags are immutable.</T>
                            </span>
                          </div>
                          <div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-background/40">
                            {gitCommands.map((cmd) => {
                              const copyKey = `${card.release.id}:${cmd.key}`;
                              const copied = isCopied && lastCopiedCommandKey === copyKey;
                              return (
                                <div key={cmd.key} className="space-y-1.5 px-4 py-3">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className="text-xs font-medium text-foreground">
                                      {gitCommandLabel(cmd.key)}
                                    </span>
                                    <Button
                                      size="micro"
                                      variant="outline"
                                      onClick={() => copyToClipboard(cmd.command, copyKey)}
                                    >
                                      {copied ? <CheckIcon /> : <CopyIcon />}
                                      {copied ? <T>Copied</T> : <T>Copy</T>}
                                    </Button>
                                  </div>
                                  <pre className="overflow-x-auto rounded-md border border-border/40 bg-muted/20 px-2.5 py-1.5 font-mono text-2xs text-muted-foreground select-all">
                                    <code>{cmd.command}</code>
                                  </pre>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </CockpitSurface>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3 pr-8">
              <CockpitIconBadge className="mt-0.5 shrink-0" size="lg" tone="primary">
                <CockpitStageArtworkIcon stage="release" />
              </CockpitIconBadge>
              <div className="min-w-0 flex-1 space-y-1">
                <DialogTitle>
                  <T>Plan Cross-Repo Release</T>
                </DialogTitle>
                <DialogDescription>
                  <T>
                    Select work items to include, auto-generate repository snapshots and release
                    notes, and define the rollback plan.
                  </T>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <DialogPanel>
            <div className="space-y-4">
              <div>
                <CockpitFieldLabel htmlFor="rel-version">
                  <T>Version Label</T>
                </CockpitFieldLabel>
                <Input
                  id="rel-version"
                  placeholder={gt("e.g. v2.4.0")}
                  value={versionLabel}
                  onChange={(event) => setVersionLabel(event.target.value)}
                />
              </div>

              {cards.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">
                      <T>
                        Included Work Items (<Var>{validSelectedIds.length}</Var>)
                      </T>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button size="xs" variant="ghost" onClick={handleSelectCandidates}>
                        <ListChecksIcon />
                        <T>Pick Ready</T>
                      </Button>
                      <Button size="xs" variant="outline" onClick={handleAutoFillDraft}>
                        <FileTextIcon />
                        <T>Auto-fill Snapshots & Notes</T>
                      </Button>
                    </div>
                  </div>
                  <CockpitSurface className="max-h-56 overflow-y-auto" divided variant="subtle">
                    {cards.map((card) => {
                      const checked = selectedIdSet.has(card.workItem.id);
                      return (
                        <button
                          key={card.workItem.id}
                          aria-pressed={checked}
                          className={cn(
                            "flex w-full cursor-pointer items-center gap-2.5 px-3 py-2 text-left text-xs transition-colors",
                            checked ? "bg-accent/45" : "hover:bg-accent/35",
                          )}
                          type="button"
                          onClick={() => handleToggleWorkItem(card.workItem.id)}
                        >
                          <CheckboxMark checked={checked} />
                          <CockpitPriorityDot priority={card.workItem.priority} showLabel={false} />
                          <CockpitArtifactIcon
                            className="size-3.5 shrink-0 text-muted-foreground"
                            kind={card.workItem.itemType}
                          />
                          <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                            {card.workItem.code}
                          </span>
                          <span className="min-w-0 flex-1 text-sm leading-snug text-foreground">
                            {card.workItem.title}
                          </span>
                          {card.changeRequests.length > 0 ? (
                            <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs tabular-nums text-muted-foreground">
                              <PullRequestGlyph.pullRequest className="size-3" />
                              {card.changeRequests.length}
                            </span>
                          ) : null}
                          <Badge size="sm" variant="outline">
                            {card.workItem.stage}
                          </Badge>
                        </button>
                      );
                    })}
                  </CockpitSurface>
                </div>
              ) : null}

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <CockpitFieldLabel htmlFor="rel-snapshots">
                    <T>Repository Snapshots (repo=ref)</T>
                  </CockpitFieldLabel>
                  <Textarea
                    id="rel-snapshots"
                    placeholder={gt("org/backend=main@abc123\norg/admin=main@def456")}
                    rows={3}
                    value={snapshotsText}
                    onChange={(event) => setSnapshotsText(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="rel-rollback">
                    <T>Rollback Plan</T>
                  </CockpitFieldLabel>
                  <Textarea
                    id="rel-rollback"
                    placeholder={gt("How to roll back safely if canary alerts trigger")}
                    rows={3}
                    value={rollbackPlan}
                    onChange={(event) => setRollbackPlan(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <CockpitFieldLabel htmlFor="rel-notes">
                  <T>Release Notes</T>
                </CockpitFieldLabel>
                <Textarea
                  id="rel-notes"
                  placeholder={gt("Highlights, breaking changes, and verification summary...")}
                  rows={4}
                  value={releaseNotes}
                  onChange={(event) => setReleaseNotes(event.target.value)}
                />
              </div>
            </div>
          </DialogPanel>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              disabled={creating || !versionLabel.trim()}
              onClick={() => void handleCreateRelease()}
            >
              {creating ? <T>Creating...</T> : <T>Create Release</T>}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
