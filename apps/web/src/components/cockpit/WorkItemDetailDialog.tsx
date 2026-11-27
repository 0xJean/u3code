import type { EnvironmentId, WorkItemDetail } from "@t3tools/contracts";
import type { ChecklistItem, WorkHealth } from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  CheckCircle2Icon,
  CircleIcon,
  ExternalLinkIcon,
  PlusIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
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
import { Input } from "~/components/ui/input";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatCockpitCommandError } from "./cockpitError";

interface WorkItemDetailDialogProps {
  readonly environmentId: EnvironmentId;
  readonly workItemId: string | null;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly gates: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly beforeStage: string;
    readonly optional?: boolean | undefined;
  }>;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
}

export function WorkItemDetailDialog({
  environmentId,
  workItemId,
  stages,
  gates,
  onClose,
  onUpdated,
}: WorkItemDetailDialogProps) {
  const gt = useGT();

  const [detail, setDetail] = useState<WorkItemDetail | null>(null);
  const [loadedWorkItemId, setLoadedWorkItemId] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [stage, setStage] = useState("");
  const [health, setHealth] = useState<WorkHealth>("on_track");
  const [specMarkdown, setSpecMarkdown] = useState("");
  const [checklistItems, setChecklistItems] = useState<ReadonlyArray<ChecklistItem>>([]);
  const [newAcText, setNewAcText] = useState("");
  const [saving, setSaving] = useState(false);
  const [approvingGateKey, setApprovingGateKey] = useState<string | null>(null);
  const [unlinkingCrId, setUnlinkingCrId] = useState<string | null>(null);

  const getDetail = useAtomCommand(teamHubEnvironment.getWorkItemDetail, { reportFailure: false });
  const updateWorkItem = useAtomCommand(teamHubEnvironment.updateWorkItem, {
    reportFailure: false,
  });
  const approveGate = useAtomCommand(teamHubEnvironment.approveGate, { reportFailure: false });
  const linkChangeRequest = useAtomCommand(teamHubEnvironment.linkChangeRequest, {
    reportFailure: false,
  });

  const hydrateFromDetail = (data: WorkItemDetail) => {
    setDetail(data);
    setTitle(data.workItem.title);
    setStage(data.workItem.stage);
    setHealth(data.workItem.health);
    setSpecMarkdown(data.workItem.specMarkdown);
    setChecklistItems(data.workItem.checklistItems);
  };

  const fetchDetail = useEffectEvent(
    (envId: EnvironmentId, id: string, cancelled: () => boolean) => {
      void getDetail({ environmentId: envId, input: { workItemId: id } }).then((res) => {
        if (cancelled()) return;
        setLoadedWorkItemId(id);
        if (res._tag === "Success") {
          setLoadError(null);
          hydrateFromDetail(res.value);
        } else {
          setLoadError(formatCockpitCommandError(res, gt("Failed to load work item details.")));
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Fetch full WorkItem detail (spec, checklist, linked PRs, and pulse timeline) from Team Hub when dialog opens.
  useEffect(() => {
    if (!workItemId) return;
    let cancelled = false;
    fetchDetail(environmentId, workItemId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, workItemId]);

  const loading = workItemId !== null && loadedWorkItemId !== workItemId;
  const activeDetail = workItemId !== null && detail?.workItem.id === workItemId ? detail : null;

  const handleToggleChecklist = (itemId: string) => {
    setChecklistItems((prev) =>
      prev.map((item) => (item.id === itemId ? { ...item, verified: !item.verified } : item)),
    );
  };

  const handleRemoveChecklist = (itemId: string) => {
    setChecklistItems((prev) => prev.filter((item) => item.id !== itemId));
  };

  const handleAddChecklist = () => {
    const trimmed = newAcText.trim();
    if (!trimmed) return;
    const nextNum = checklistItems.length + 1;
    let candidate = `AC-${nextNum}`;
    const existingIds = new Set(checklistItems.map((item) => item.id));
    let offset = 1;
    while (existingIds.has(candidate)) {
      candidate = `AC-${nextNum + offset}`;
      offset += 1;
    }
    setChecklistItems((prev) => [...prev, { id: candidate, text: trimmed, verified: false }]);
    setNewAcText("");
  };

  const handleSave = async () => {
    if (!workItemId || !title.trim()) return;
    setSaving(true);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId,
        title: title.trim(),
        stage,
        health,
        specMarkdown,
        checklistItems: [...checklistItems],
      },
    });
    setSaving(false);
    if (res._tag === "Success") {
      setDetail((prev) => (prev ? { ...prev, workItem: res.value.workItem } : prev));
      toastManager.add({ title: gt("Work item saved"), type: "success" });
      onUpdated();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to save work item.")),
        type: "error",
      });
    }
  };

  const handleApproveGate = async (gateKey: string) => {
    if (!workItemId) return;
    setApprovingGateKey(gateKey);
    const res = await approveGate({
      environmentId,
      input: {
        targetType: "work_item",
        targetId: workItemId,
        gateKey,
        status: "approved",
      },
    });
    setApprovingGateKey(null);
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Gate approved"), type: "success" });
      onUpdated();
      const refreshed = await getDetail({ environmentId, input: { workItemId } });
      if (refreshed._tag === "Success") {
        hydrateFromDetail(refreshed.value);
      }
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to approve gate.")),
        type: "error",
      });
    }
  };

  const handleUnlinkPr = async (changeRequestId: string) => {
    if (!workItemId) return;
    setUnlinkingCrId(changeRequestId);
    const res = await linkChangeRequest({
      environmentId,
      input: { changeRequestId, workItemId: null },
    });
    setUnlinkingCrId(null);
    if (res._tag === "Success") {
      setDetail((prev) =>
        prev
          ? {
              ...prev,
              changeRequests: prev.changeRequests.filter((cr) => cr.id !== changeRequestId),
            }
          : prev,
      );
      toastManager.add({ title: gt("Pull request unlinked"), type: "success" });
      onUpdated();
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to unlink pull request.")),
        type: "error",
      });
    }
  };

  const approvedGateKeys = new Set(
    (activeDetail?.gateApprovals ?? [])
      .filter((g) => g.status === "approved")
      .map((g) => g.gateKey),
  );

  return (
    <Dialog
      open={workItemId !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {activeDetail ? (
              <span className="flex items-center gap-2">
                <span className="font-mono text-xs text-muted-foreground">
                  {activeDetail.workItem.code}
                </span>
                <span>{activeDetail.workItem.title}</span>
              </span>
            ) : (
              <T>Work Item Details</T>
            )}
          </DialogTitle>
          <DialogDescription>
            <T>
              Edit specification, acceptance criteria, workflow stage, gates, linked PRs, and pulse
              history.
            </T>
          </DialogDescription>
        </DialogHeader>

        <DialogPanel>
          {loading ? (
            <p className="py-6 text-sm text-muted-foreground">
              <T>Loading work item details...</T>
            </p>
          ) : loadError ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
              {loadError}
            </div>
          ) : activeDetail ? (
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="wid-title"
                  >
                    <T>Title</T>
                  </label>
                  <Input
                    id="wid-title"
                    size="sm"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="wid-stage"
                  >
                    <T>Stage</T>
                  </label>
                  <select
                    id="wid-stage"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                    value={stage}
                    onChange={(event) => setStage(event.target.value)}
                  >
                    {stages.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="wid-health"
                  >
                    <T>Health</T>
                  </label>
                  <select
                    id="wid-health"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                    value={health}
                    onChange={(event) => setHealth(event.target.value as WorkHealth)}
                  >
                    <option value="on_track">{gt("On track")}</option>
                    <option value="at_risk">{gt("At risk")}</option>
                    <option value="blocked">{gt("Blocked")}</option>
                  </select>
                </div>
              </div>

              <div>
                <label
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                  htmlFor="wid-spec"
                >
                  <T>Specification (Markdown)</T>
                </label>
                <Textarea
                  id="wid-spec"
                  placeholder={gt("Write requirements, architecture notes, or rollout constraints")}
                  rows={4}
                  value={specMarkdown}
                  onChange={(event) => setSpecMarkdown(event.target.value)}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    <T>Acceptance Criteria</T>
                  </span>
                  <Badge size="sm" variant="secondary">
                    {checklistItems.filter((item) => item.verified).length}/{checklistItems.length}
                  </Badge>
                </div>

                {checklistItems.length > 0 ? (
                  <div className="space-y-1.5">
                    {checklistItems.map((item) => {
                      const verified = item.verified;
                      return (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-3 py-1.5 text-xs"
                        >
                          <button
                            className="flex min-w-0 flex-1 items-center gap-2 text-left"
                            type="button"
                            onClick={() => handleToggleChecklist(item.id)}
                          >
                            {verified ? (
                              <CheckCircle2Icon className="size-3.5 shrink-0 text-success-foreground" />
                            ) : (
                              <CircleIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            )}
                            <span className="font-mono text-muted-foreground">{item.id}</span>
                            <span
                              className={
                                verified ? "text-muted-foreground line-through" : "text-foreground"
                              }
                            >
                              {item.text}
                            </span>
                          </button>
                          <Button
                            aria-label={gt("Remove acceptance criterion")}
                            size="icon-xs"
                            variant="ghost-muted"
                            onClick={() => handleRemoveChecklist(item.id)}
                          >
                            <Trash2Icon />
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    <T>No acceptance criteria yet. Add one below.</T>
                  </p>
                )}

                <div className="flex gap-2 pt-1">
                  <Input
                    placeholder={gt("Add acceptance criterion...")}
                    size="sm"
                    value={newAcText}
                    onChange={(event) => setNewAcText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        handleAddChecklist();
                      }
                    }}
                  />
                  <Button
                    disabled={!newAcText.trim()}
                    size="sm"
                    variant="outline"
                    onClick={handleAddChecklist}
                  >
                    <PlusIcon />
                    <T>Add AC</T>
                  </Button>
                </div>
              </div>

              {gates.length > 0 ? (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    <T>Workflow Gates</T>
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {gates.map((gate) => {
                      const approved = approvedGateKeys.has(gate.key);
                      return approved ? (
                        <Badge key={gate.key} size="sm" variant="success">
                          <ShieldCheckIcon />
                          {gate.label}
                        </Badge>
                      ) : (
                        <Button
                          key={gate.key}
                          disabled={approvingGateKey === gate.key}
                          size="micro"
                          variant="warning-outline"
                          onClick={() => void handleApproveGate(gate.key)}
                        >
                          <ShieldCheckIcon />
                          {approvingGateKey === gate.key ? <T>Approving...</T> : gate.label}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    <T>Linked Pull Requests</T>
                  </span>
                  <Badge size="sm" variant="secondary">
                    {activeDetail.changeRequests.length}
                  </Badge>
                </div>
                {activeDetail.changeRequests.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <T>
                      No PRs linked yet. Mention the work item code in a PR title or branch, or link
                      an orphan PR from Review Triage.
                    </T>
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    {activeDetail.changeRequests.map((cr) => (
                      <div
                        key={cr.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 text-xs"
                      >
                        <a
                          className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                          href={cr.url}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <span>
                            {cr.repoFullName}#{cr.number}
                          </span>
                          <ExternalLinkIcon className="size-3" />
                        </a>
                        <span className="min-w-0 flex-1 truncate text-muted-foreground">
                          {cr.title}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <Badge
                            size="sm"
                            variant={
                              cr.automatedReview.status === "blocking"
                                ? "error"
                                : cr.automatedReview.status === "pass" ||
                                    cr.automatedReview.status === "auto_merged"
                                  ? "success"
                                  : "secondary"
                            }
                          >
                            {cr.automatedReview.status}
                          </Badge>
                          <Button
                            aria-label={gt("Unlink pull request")}
                            disabled={unlinkingCrId === cr.id}
                            size="icon-xs"
                            variant="ghost-muted"
                            onClick={() => void handleUnlinkPr(cr.id)}
                          >
                            <UnlinkIcon />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase">
                    <ActivityIcon className="size-3.5" />
                    <T>Pulse History</T>
                  </span>
                  <Badge size="sm" variant="secondary">
                    {activeDetail.pulses.length}
                  </Badge>
                </div>
                {activeDetail.pulses.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    <T>No pulses published yet. Sync a pulse from an active coding thread.</T>
                  </p>
                ) : (
                  <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
                    {activeDetail.pulses.map((pulse) => (
                      <div
                        key={pulse.id}
                        className="space-y-1 rounded-lg border border-border bg-muted/20 p-3 text-xs"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Badge size="sm" variant="outline">
                              {pulse.sourceType}
                            </Badge>
                            <Badge
                              size="sm"
                              variant={
                                pulse.health === "blocked"
                                  ? "error"
                                  : pulse.health === "at_risk"
                                    ? "warning"
                                    : "success"
                              }
                            >
                              {pulse.health}
                            </Badge>
                          </div>
                          <span>{pulse.createdAt.slice(0, 16).replace("T", " ")}</span>
                        </div>
                        <p className="text-foreground">{pulse.doneSummary}</p>
                        {pulse.decisions.length > 0 ? (
                          <p className="text-muted-foreground">
                            <T>
                              Decisions: <Var>{pulse.decisions.join("; ")}</Var>
                            </T>
                          </p>
                        ) : null}
                        {pulse.blockers.length > 0 ? (
                          <p className="text-destructive">
                            <T>
                              Blockers: <Var>{pulse.blockers.map((b) => b.text).join("; ")}</Var>
                            </T>
                          </p>
                        ) : null}
                        {pulse.nextStep ? (
                          <p className="text-muted-foreground">
                            <T>
                              Next: <Var>{pulse.nextStep}</Var>
                            </T>
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            <T>Close</T>
          </DialogClose>
          <Button
            disabled={saving || !activeDetail || !title.trim()}
            onClick={() => void handleSave()}
          >
            {saving ? <T>Saving...</T> : <T>Save Changes</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
