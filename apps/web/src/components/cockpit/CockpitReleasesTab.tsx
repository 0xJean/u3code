import type { EnvironmentId } from "@t3tools/contracts";
import type { ReleaseCard, ReleaseStatus } from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import { CheckCircle2Icon, PackageCheckIcon, RotateCcwIcon, ShieldCheckIcon } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatCockpitCommandError } from "./cockpitError";

interface CockpitReleasesTabProps {
  readonly environmentId: EnvironmentId;
  readonly selectedProjectId: string;
  readonly refreshSignal: number;
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
}: CockpitReleasesTabProps) {
  const gt = useGT();
  const [releases, setReleases] = useState<ReadonlyArray<ReleaseCard>>([]);
  const [versionLabel, setVersionLabel] = useState("");
  const [snapshotsText, setSnapshotsText] = useState("");
  const [rollbackPlan, setRollbackPlan] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [creating, setCreating] = useState(false);

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
      },
    });
    setCreating(false);
    if (res._tag === "Success") {
      setVersionLabel("");
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

  const handleApproveReleaseGate = async (releaseId: string, gateKey: string) => {
    const res = await approveGate({
      environmentId,
      input: {
        targetType: "release",
        targetId: releaseId,
        gateKey,
        status: "approved",
      },
    });
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Release gate approved"), type: "success" });
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
        title: formatCockpitCommandError(res, gt("Failed to approve release gate.")),
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
            const approvedKeys = new Set(
              card.gateApprovals.filter((g) => g.status === "approved").map((g) => g.gateKey),
            );
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

                <div className="flex flex-wrap items-center gap-2 pt-1">
                  {RELEASE_GATES.map((gate) => {
                    const isApproved = approvedKeys.has(gate.key);
                    return isApproved ? (
                      <Badge key={gate.key} size="sm" variant="success">
                        <CheckCircle2Icon />
                        {gateLabel(gate.key)}
                      </Badge>
                    ) : (
                      <Button
                        key={gate.key}
                        size="micro"
                        variant="warning-outline"
                        onClick={() => void handleApproveReleaseGate(card.release.id, gate.key)}
                      >
                        <ShieldCheckIcon />
                        {gateLabel(gate.key)}
                      </Button>
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
