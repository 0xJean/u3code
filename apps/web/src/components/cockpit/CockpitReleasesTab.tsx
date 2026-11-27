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
  FileTextIcon,
  GitCommitHorizontalIcon,
  ListChecksIcon,
  PackageCheckIcon,
  PlusIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

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
import { Separator } from "~/components/ui/separator";
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
  const activeCount = allReleases.filter(
    (item) =>
      item.release.status === "planning" ||
      item.release.status === "staging" ||
      item.release.status === "ready",
  ).length;
  const shippedCount = allReleases.filter(
    (item) => item.release.status === "released" || item.release.status === "rolled_back",
  ).length;

  const visibleReleases = allReleases.filter((item) => {
    if (filter === "active") {
      return (
        item.release.status === "planning" ||
        item.release.status === "staging" ||
        item.release.status === "ready"
      );
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
    <div className="space-y-5">
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
            <Button size="sm" variant="default" onClick={() => setCreateOpen(true)}>
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
        <div className="space-y-4">
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

            return (
              <CockpitSurface key={card.release.id} className="overflow-hidden" variant="grouped">
                <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
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
                        variant={nextStatus === "released" ? "default" : "outline"}
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
                  <div className="grid grid-cols-4 gap-2 border-y border-border/50 bg-muted/15 px-5 py-2.5">
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

                <div className="space-y-4 px-5 py-4">
                  <div className="space-y-2">
                    <CockpitSectionHeader
                      count={approvedCount}
                      icon={<ShieldCheckIcon />}
                      title={<T>Release Sign-off Gates</T>}
                    />
                    <div className="grid gap-2.5 md:grid-cols-3">
                      {RELEASE_GATES.map((gate) => {
                        const latest = latestGates.get(gate.key);
                        const status = latest?.status ?? null;
                        const busyKey = `${card.release.id}:${gate.key}`;
                        const isRejectingThis =
                          rejectingGateTarget?.releaseId === card.release.id &&
                          rejectingGateTarget.gateKey === gate.key;

                        return (
                          <CockpitSurface
                            key={gate.key}
                            className="flex flex-col justify-between gap-2.5"
                            padding="sm"
                            variant="card"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <span className="text-xs font-medium text-foreground">
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
                                  <T>Pending</T>
                                </Badge>
                              )}
                            </div>

                            {latest?.note ? (
                              <p
                                className={cn(
                                  "text-xs leading-relaxed",
                                  status === "rejected"
                                    ? "text-destructive"
                                    : "text-muted-foreground",
                                )}
                              >
                                {latest.note}
                              </p>
                            ) : null}

                            {isRejectingThis ? (
                              <div className="space-y-2 pt-0.5">
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
                                <div className="flex items-center justify-end gap-1.5">
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
                            ) : (
                              <div className="flex items-center gap-1.5 pt-0.5">
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
                            )}
                          </CockpitSurface>
                        );
                      })}
                    </div>
                  </div>

                  {card.workItemIds.length > 0 || snapshots.length > 0 ? (
                    <div className="grid gap-4 pt-1 md:grid-cols-2">
                      {card.workItemIds.length > 0 ? (
                        <div className="space-y-1.5">
                          <div className="text-2xs font-medium text-muted-foreground">
                            <T>Included Work Items</T>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {card.workItemIds.map((wiId) => {
                              const matched = cardById.get(wiId);
                              return onOpenWorkItem ? (
                                <Button
                                  key={wiId}
                                  size="micro"
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
                                    <span className="max-w-52 truncate">
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
                        <div className="space-y-1.5">
                          <div className="text-2xs font-medium text-muted-foreground">
                            <T>Repository Snapshots</T>
                          </div>
                          <div className="flex flex-wrap gap-1.5">
                            {snapshots.map(([repo, ref]) => (
                              <span
                                key={repo}
                                className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-muted/30 px-2 py-0.5 font-mono text-2xs text-foreground"
                              >
                                <GitCommitHorizontalIcon className="size-3 shrink-0 text-muted-foreground" />
                                {repo}@{String(ref)}
                              </span>
                            ))}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {card.release.releaseNotesMd || card.release.rollbackPlan ? (
                    <>
                      <Separator />
                      <div className="grid gap-4 md:grid-cols-2">
                        {card.release.releaseNotesMd ? (
                          <div className="space-y-1">
                            <div className="text-2xs font-medium text-muted-foreground">
                              <T>Release Notes</T>
                            </div>
                            <p className="text-xs leading-relaxed whitespace-pre-wrap text-foreground/90">
                              {card.release.releaseNotesMd}
                            </p>
                          </div>
                        ) : null}

                        {card.release.rollbackPlan ? (
                          <div className="space-y-1">
                            <div className="text-2xs font-medium text-muted-foreground">
                              <T>Rollback Plan</T>
                            </div>
                            <CockpitSurface padding="sm" variant="subtle">
                              <p className="text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                                {card.release.rollbackPlan}
                              </p>
                            </CockpitSurface>
                          </div>
                        ) : null}
                      </div>
                    </>
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
