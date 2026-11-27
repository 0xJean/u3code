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
  CheckCircle2Icon,
  FileTextIcon,
  PackageCheckIcon,
  RotateCcwIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatCockpitCommandError } from "./cockpitError";
import { buildReleaseDraftFromWorkItems } from "./releaseDraft";

interface CockpitReleasesTabProps {
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: string;
  readonly refreshSignal: number;
  readonly cards: ReadonlyArray<CockpitWorkItemCard>;
  readonly repos: ReadonlyArray<ProjectRepo>;
  readonly onOpenWorkItem?: (workItemId: string) => void;
}

const RELEASE_GATES = [
  { key: "qa_ac_pass", labelKey: "QA Sign-off" },
  { key: "security_clear", labelKey: "Security Sign-off" },
  { key: "prod_go", labelKey: "Production Go/No-Go" },
] as const;

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

  const visibleReleases = selectedProjectId ? releases : [];
  const cardById = new Map(cards.map((c) => [c.workItem.id, c] as const));
  const validSelectedIds = selectedWorkItemIds.filter((id) => cardById.has(id));
  const selectedIdSet = new Set(validSelectedIds);

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

  if (!selectedProjectId) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <T>Select or create a project to coordinate cross-repository releases.</T>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <section className="space-y-3 rounded-xl border border-border bg-card p-5 lg:col-span-1">
        <div className="flex items-center gap-2">
          <PackageCheckIcon className="size-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            <T>Plan Cross-Repo Release</T>
          </h3>
        </div>
        <p className="text-xs text-muted-foreground">
          <T>
            Coordinate multi-repository deployments with explicit rollback plans and QA, Security,
            and Production Go/No-Go sign-offs.
          </T>
        </p>

        <div className="space-y-2.5">
          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="rel-version"
            >
              <T>Version Label</T>
            </label>
            <Input
              id="rel-version"
              placeholder={gt("e.g. v2.4.0")}
              size="sm"
              value={versionLabel}
              onChange={(event) => setVersionLabel(event.target.value)}
            />
          </div>

          {cards.length > 0 ? (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-muted-foreground">
                  <T>
                    Included Work Items (<Var>{validSelectedIds.length}</Var>)
                  </T>
                </span>
                <div className="flex items-center gap-1">
                  <Button size="micro" variant="ghost" onClick={handleSelectCandidates}>
                    <T>Pick Ready</T>
                  </Button>
                  <Button size="micro" variant="outline" onClick={handleAutoFillDraft}>
                    <FileTextIcon />
                    <T>Auto-fill</T>
                  </Button>
                </div>
              </div>
              <div className="max-h-36 space-y-1 overflow-y-auto rounded-lg border border-border bg-muted/20 p-2">
                {cards.map((card) => {
                  const checked = selectedIdSet.has(card.workItem.id);
                  return (
                    <label
                      key={card.workItem.id}
                      className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-muted/40"
                    >
                      <input
                        checked={checked}
                        type="checkbox"
                        onChange={() => handleToggleWorkItem(card.workItem.id)}
                      />
                      <span className="font-mono text-muted-foreground">{card.workItem.code}</span>
                      <span className="min-w-0 flex-1 truncate text-foreground">
                        {card.workItem.title}
                      </span>
                      <Badge size="sm" variant="outline">
                        {card.workItem.stage}
                      </Badge>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="rel-snapshots"
            >
              <T>Repository Snapshots (repo=ref, one per line)</T>
            </label>
            <Textarea
              id="rel-snapshots"
              placeholder={gt("org/backend=main@abc123\norg/admin=main@def456")}
              rows={3}
              value={snapshotsText}
              onChange={(event) => setSnapshotsText(event.target.value)}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="rel-rollback"
            >
              <T>Rollback Plan</T>
            </label>
            <Textarea
              id="rel-rollback"
              placeholder={gt("How to roll back safely if canary alerts trigger")}
              rows={2}
              value={rollbackPlan}
              onChange={(event) => setRollbackPlan(event.target.value)}
            />
          </div>

          <div>
            <label
              className="mb-1 block text-xs font-medium text-muted-foreground"
              htmlFor="rel-notes"
            >
              <T>Release Notes</T>
            </label>
            <Textarea
              id="rel-notes"
              rows={3}
              value={releaseNotes}
              onChange={(event) => setReleaseNotes(event.target.value)}
            />
          </div>

          <div className="flex justify-end pt-1">
            <Button
              disabled={creating || !versionLabel.trim()}
              size="sm"
              onClick={() => void handleCreateRelease()}
            >
              {creating ? <T>Creating...</T> : <T>Create Release</T>}
            </Button>
          </div>
        </div>
      </section>

      <section className="space-y-3 lg:col-span-2">
        {visibleReleases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
            <T>No releases planned yet for this project.</T>
          </div>
        ) : (
          visibleReleases.map((card) => {
            const latestGates = resolveLatestGateApprovals(card.gateApprovals);
            const snapshots = Object.entries(card.release.repoSnapshots);
            const nextStatus = nextReleaseStatus(card.release.status);

            return (
              <div
                key={card.release.id}
                className="space-y-3 rounded-xl border border-border bg-card p-5"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-foreground">
                      {card.release.versionLabel}
                    </span>
                    <Badge size="sm" variant={releaseStatusVariant(card.release.status)}>
                      {card.release.status}
                    </Badge>
                    {card.release.releasedAt ? (
                      <span className="text-xs text-muted-foreground">
                        <T>
                          Released{" "}
                          <Var>{card.release.releasedAt.slice(0, 16).replace("T", " ")}</Var>
                        </T>
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {nextStatus ? (
                      <Button
                        size="xs"
                        variant={nextStatus === "released" ? "default" : "outline"}
                        onClick={() => void handleUpdateStatus(card.release.id, nextStatus)}
                      >
                        → {nextStatus}
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

                {card.workItemIds.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {card.workItemIds.map((wiId) => {
                      const matched = cardById.get(wiId);
                      const label = matched
                        ? `${matched.workItem.code} · ${matched.workItem.title}`
                        : wiId;
                      return onOpenWorkItem ? (
                        <Button
                          key={wiId}
                          size="micro"
                          variant="outline"
                          onClick={() => onOpenWorkItem(wiId)}
                        >
                          {label}
                        </Button>
                      ) : (
                        <Badge key={wiId} size="sm" variant="secondary">
                          {label}
                        </Badge>
                      );
                    })}
                  </div>
                ) : null}

                {snapshots.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {snapshots.map(([repo, ref]) => (
                      <Badge key={repo} size="sm" variant="outline">
                        {repo}: {String(ref)}
                      </Badge>
                    ))}
                  </div>
                ) : null}

                {card.release.releaseNotesMd ? (
                  <p className="text-xs whitespace-pre-wrap text-foreground">
                    {card.release.releaseNotesMd}
                  </p>
                ) : null}

                {card.release.rollbackPlan ? (
                  <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      <T>Rollback plan:</T>
                    </span>{" "}
                    {card.release.rollbackPlan}
                  </div>
                ) : null}

                <div className="space-y-1.5 pt-1">
                  {RELEASE_GATES.map((gate) => {
                    const latest = latestGates.get(gate.key);
                    const status = latest?.status ?? null;
                    const busyKey = `${card.release.id}:${gate.key}`;
                    const isRejectingThis =
                      rejectingGateTarget?.releaseId === card.release.id &&
                      rejectingGateTarget.gateKey === gate.key;

                    return (
                      <div
                        key={gate.key}
                        className="space-y-1.5 rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-foreground">
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
                          <div className="flex items-center gap-1.5">
                            {status !== "approved" ? (
                              <Button
                                disabled={busyGateTarget === busyKey}
                                size="micro"
                                variant="warning-outline"
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
                              variant="destructive-outline"
                              onClick={() => {
                                setRejectingGateTarget(
                                  isRejectingThis
                                    ? null
                                    : { releaseId: card.release.id, gateKey: gate.key },
                                );
                                setRejectNote("");
                              }}
                            >
                              <ShieldAlertIcon />
                              <T>Reject</T>
                            </Button>
                          </div>
                        </div>

                        {latest?.note ? (
                          <p
                            className={
                              status === "rejected" ? "text-destructive" : "text-muted-foreground"
                            }
                          >
                            <T>
                              Note: <Var>{latest.note}</Var>
                            </T>
                          </p>
                        ) : null}

                        {isRejectingThis ? (
                          <div className="flex flex-wrap items-center gap-2 pt-1">
                            <div className="min-w-44 flex-1">
                              <Input
                                placeholder={gt("Rejection reason (notifies owners)...")}
                                size="sm"
                                value={rejectNote}
                                onChange={(event) => setRejectNote(event.target.value)}
                              />
                            </div>
                            <Button
                              disabled={busyGateTarget === busyKey}
                              size="xs"
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
                              <T>Confirm Reject</T>
                            </Button>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => {
                                setRejectingGateTarget(null);
                                setRejectNote("");
                              }}
                            >
                              <T>Cancel</T>
                            </Button>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </section>
    </div>
  );
}
