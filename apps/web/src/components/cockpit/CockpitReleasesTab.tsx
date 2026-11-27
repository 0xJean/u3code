import type { EnvironmentId } from "@t3tools/contracts";
import {
  resolveLatestGateApprovals,
  type CockpitWorkItemCard,
  type ProjectRepo,
  type ReleaseCard,
  type ReleaseStatus,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronRightIcon,
  FileTextIcon,
  GitCommitHorizontalIcon,
  ListChecksIcon,
  PackageCheckIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { Fragment, type ReactNode, useEffect, useEffectEvent, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { CheckboxMark } from "~/components/ui/checkbox";
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
import { cn } from "~/lib/utils";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitFieldLabel,
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
      <Empty size="compact">
        <EmptyMedia variant="icon">
          <PackageCheckIcon />
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
    );
  }

  return (
    <div className="space-y-6">
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

        <Button size="sm" variant="default" onClick={() => setCreateOpen(true)}>
          <PlusIcon />
          <T>Plan Release</T>
        </Button>
      </div>

      {allReleases.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <PackageCheckIcon />
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
      ) : visibleReleases.length === 0 ? (
        <Empty size="compact">
          <EmptyMedia variant="icon">
            <PackageCheckIcon />
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
      ) : (
        <div className="space-y-5">
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
            const hasDetails = Boolean(card.release.releaseNotesMd || card.release.rollbackPlan);
            const defaultDetailsExpanded =
              visibleReleases.length === 1 && isActiveReleaseStatus(card.release.status);
            const detailsExpanded =
              expandedDetailsOverrides[card.release.id] ?? defaultDetailsExpanded;

            return (
              <CockpitSurface
                key={card.release.id}
                className="overflow-hidden border-border/60 bg-card/35"
                variant="grouped"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-4">
                  <div className="flex flex-wrap items-center gap-2.5">
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
                  <div className="grid grid-cols-4 gap-3 border-y border-border/50 bg-muted/15 px-6 py-3">
                    {PIPELINE_STEPS.map((step, idx) => {
                      const reached = currentStepIdx >= idx;
                      const current = currentStepIdx === idx;
                      const completedAll = card.release.status === "released";
                      return (
                        <div key={step} className="space-y-1">
                          <div
                            className={cn(
                              "h-1 rounded-full transition-colors",
                              reached
                                ? completedAll
                                  ? "bg-success"
                                  : "bg-foreground/80"
                                : "bg-border/70",
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

                <div className="space-y-5 px-6 py-5">
                  <div className="space-y-2.5">
                    <CockpitSectionHeader
                      action={
                        <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                          {`${approvedCount}/${RELEASE_GATES.length}`}
                        </span>
                      }
                      icon={<ShieldCheckIcon />}
                      title={<T>Release Sign-off Gates</T>}
                    />
                    <div className="divide-y divide-border/50 rounded-lg border border-border/50 bg-background/40">
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

                  {hasDetails ? (
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
                          {card.release.releaseNotesMd && card.release.rollbackPlan ? (
                            <T>Release Notes & Rollback Plan</T>
                          ) : card.release.releaseNotesMd ? (
                            <T>Release Notes</T>
                          ) : (
                            <T>Rollback Plan</T>
                          )}
                        </span>
                        <span className="text-2xs font-normal text-muted-foreground/70">
                          {detailsExpanded ? <T>Hide</T> : <T>Show</T>}
                        </span>
                      </button>

                      {detailsExpanded ? (
                        <div className="mt-3.5 space-y-4 px-1">
                          {card.release.releaseNotesMd ? (
                            <div className="space-y-1.5">
                              {card.release.rollbackPlan ? (
                                <div className="text-2xs font-medium text-muted-foreground">
                                  <T>Release Notes</T>
                                </div>
                              ) : null}
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
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </CockpitSurface>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              <T>Plan Cross-Repo Release</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                Select work items to include, auto-generate repository snapshots and release notes,
                and define the rollback plan.
              </T>
            </DialogDescription>
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
