import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, WorkItemDetail } from "@t3tools/contracts";
import {
  resolveLatestGateApprovals,
  type ChangeRequestAudit,
  type ChecklistItem,
  type Project,
  type ProjectMemory,
  type ProjectRepo,
  type WorkHealth,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  CheckSquareIcon,
  ExternalLinkIcon,
  MessageSquarePlusIcon,
  PlusIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UnlinkIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
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
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { useProjects } from "~/state/entities";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitDiffStat,
  CockpitFieldLabel,
  CockpitHealthDot,
  CockpitInlineAlert,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitSurface,
  CockpitSurfaceRow,
} from "./CockpitPrimitives";
import { formatCockpitCommandError } from "./cockpitError";
import { buildWorkItemThreadPrompt, pickMatchingWorkspaceProject } from "./workItemPrompt";

interface WorkItemDetailDialogProps {
  readonly environmentId: EnvironmentId;
  readonly workItemId: string | null;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repos?: ReadonlyArray<ProjectRepo> | undefined;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly gates: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly beforeStage: string;
    readonly optional?: boolean | undefined;
  }>;
  readonly onClose: () => void;
  readonly onUpdated: () => void;
  readonly onOpenChangeRequest?: (cr: ChangeRequestAudit) => void;
}

function workHealthLabel(health: WorkHealth, gt: ReturnType<typeof useGT>): string {
  switch (health) {
    case "on_track":
      return gt("On track");
    case "at_risk":
      return gt("At risk");
    case "blocked":
      return gt("Blocked");
  }
}

function reviewStatusLabel(status: string, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "blocking":
      return gt("Blocking");
    case "pass":
      return gt("Passed");
    case "auto_merged":
      return gt("Auto-merged");
    case "pending":
      return gt("Pending");
    case "none":
      return gt("None");
    default:
      return status;
  }
}

export function WorkItemDetailDialog({
  environmentId,
  workItemId,
  project,
  memory,
  repos = [],
  stages,
  gates,
  onClose,
  onUpdated,
  onOpenChangeRequest,
}: WorkItemDetailDialogProps) {
  const gt = useGT();
  const localProjects = useProjects();
  const handleNewThread = useNewThreadHandler();

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

  const [busyGateKey, setBusyGateKey] = useState<string | null>(null);
  const [rejectingGateKey, setRejectingGateKey] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [unlinkingCrId, setUnlinkingCrId] = useState<string | null>(null);

  const [chosenLocalProjectId, setChosenLocalProjectId] = useState<string>("");
  const [startingThread, setStartingThread] = useState(false);

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

  const matchedProject = pickMatchingWorkspaceProject(localProjects, repos);
  const selectedLocalProject =
    localProjects.find((p) => `${p.environmentId}:${p.id}` === chosenLocalProjectId) ??
    matchedProject;

  const selectedStageLabel = stages.find((s) => s.id === stage)?.label ?? stage;
  const verifiedCount = checklistItems.filter((item) => item.verified).length;

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

  const handleGateDecision = async (
    gateKey: string,
    status: "approved" | "rejected",
    note?: string,
  ) => {
    if (!workItemId) return;
    setBusyGateKey(gateKey);
    const res = await approveGate({
      environmentId,
      input: {
        targetType: "work_item",
        targetId: workItemId,
        gateKey,
        status,
        ...(note?.trim() ? { note: note.trim() } : {}),
      },
    });
    setBusyGateKey(null);
    if (res._tag === "Success") {
      setRejectingGateKey(null);
      setRejectNote("");
      toastManager.add({
        title: status === "approved" ? gt("Gate approved") : gt("Gate rejected"),
        type: status === "approved" ? "success" : "warning",
      });
      onUpdated();
      const refreshed = await getDetail({ environmentId, input: { workItemId } });
      if (refreshed._tag === "Success") {
        hydrateFromDetail(refreshed.value);
      }
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update gate decision.")),
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

  const handleStartCodingThread = async () => {
    if (!activeDetail || !selectedLocalProject) return;
    setStartingThread(true);
    const prompt = buildWorkItemThreadPrompt({
      workItem: {
        ...activeDetail.workItem,
        title: title.trim() || activeDetail.workItem.title,
        stage,
        health,
        specMarkdown,
        checklistItems: [...checklistItems],
      },
      project,
      memory,
      changeRequests: activeDetail.changeRequests,
    });
    await handleNewThread(
      scopeProjectRef(selectedLocalProject.environmentId, selectedLocalProject.id),
      {
        prompt,
      },
    );
    setStartingThread(false);
    onClose();
  };

  const latestGates = resolveLatestGateApprovals(activeDetail?.gateApprovals ?? []);

  return (
    <Dialog
      open={workItemId !== null}
      onOpenChange={(open) => {
        if (!open) {
          setRejectingGateKey(null);
          setRejectNote("");
          onClose();
        }
      }}
    >
      <DialogPopup className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>
            {activeDetail ? (
              <span className="flex flex-wrap items-center gap-2">
                <CockpitPriorityDot priority={activeDetail.workItem.priority} />
                <span className="font-mono text-xs text-muted-foreground">
                  {activeDetail.workItem.code}
                </span>
                <span className="min-w-0">{activeDetail.workItem.title}</span>
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
            <CockpitInlineAlert tone="error">{loadError}</CockpitInlineAlert>
          ) : activeDetail ? (
            <div className="space-y-5">
              <CockpitSurface padding="sm" variant="subtle">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <MessageSquarePlusIcon className="size-3.5 text-muted-foreground" />
                      <T>Start Coding Thread with Context</T>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      <T>
                        Pre-fills a new U3 Code thread with spec, acceptance criteria, and locked
                        directives.
                      </T>
                    </p>
                  </div>
                  {localProjects.length > 0 && selectedLocalProject ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="w-44">
                        <Select
                          value={`${selectedLocalProject.environmentId}:${selectedLocalProject.id}`}
                          onValueChange={(value) => {
                            if (value) setChosenLocalProjectId(value);
                          }}
                        >
                          <SelectTrigger aria-label={gt("Local workspace project")} size="compact">
                            <SelectValue>{selectedLocalProject.title}</SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            {localProjects.map((proj) => (
                              <SelectItem
                                key={`${proj.environmentId}:${proj.id}`}
                                value={`${proj.environmentId}:${proj.id}`}
                              >
                                {proj.title}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                      <Button
                        disabled={startingThread}
                        size="xs"
                        variant="outline"
                        onClick={() => void handleStartCodingThread()}
                      >
                        <MessageSquarePlusIcon />
                        {startingThread ? <T>Opening...</T> : <T>Start Thread</T>}
                      </Button>
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      <T>Add a local repository in the sidebar first.</T>
                    </span>
                  )}
                </div>
              </CockpitSurface>

              <div className="grid gap-3 sm:grid-cols-4">
                <div className="sm:col-span-2">
                  <CockpitFieldLabel htmlFor="wid-title">
                    <T>Title</T>
                  </CockpitFieldLabel>
                  <Input
                    id="wid-title"
                    size="sm"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                  />
                </div>
                <div>
                  <CockpitFieldLabel htmlFor="wid-stage">
                    <T>Stage</T>
                  </CockpitFieldLabel>
                  <Select
                    value={stage}
                    onValueChange={(value) => {
                      if (value) setStage(value);
                    }}
                  >
                    <SelectTrigger id="wid-stage" size="sm">
                      <SelectValue>{selectedStageLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {stages.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
                <div>
                  <CockpitFieldLabel htmlFor="wid-health">
                    <T>Health</T>
                  </CockpitFieldLabel>
                  <Select
                    value={health}
                    onValueChange={(value) => {
                      if (value === "on_track" || value === "at_risk" || value === "blocked") {
                        setHealth(value);
                      }
                    }}
                  >
                    <SelectTrigger id="wid-health" size="sm">
                      <SelectValue>
                        <CockpitHealthDot health={health} label={workHealthLabel(health, gt)} />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="on_track">{gt("On track")}</SelectItem>
                      <SelectItem value="at_risk">{gt("At risk")}</SelectItem>
                      <SelectItem value="blocked">{gt("Blocked")}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>

              <div>
                <CockpitFieldLabel htmlFor="wid-spec">
                  <T>Specification (Markdown)</T>
                </CockpitFieldLabel>
                <Textarea
                  id="wid-spec"
                  placeholder={gt("Write requirements, architecture notes, or rollout constraints")}
                  rows={4}
                  value={specMarkdown}
                  onChange={(event) => setSpecMarkdown(event.target.value)}
                />
              </div>

              <section className="space-y-2">
                <CockpitSectionHeader
                  action={
                    <span className="font-mono text-2xs tabular-nums text-muted-foreground">
                      {verifiedCount}/{checklistItems.length}
                    </span>
                  }
                  icon={<CheckSquareIcon />}
                  title={<T>Acceptance Criteria</T>}
                />

                <CockpitSurface divided variant="grouped">
                  {checklistItems.length === 0 ? (
                    <CockpitSurfaceRow density="compact">
                      <p className="py-1 text-xs text-muted-foreground">
                        <T>No acceptance criteria yet. Add one below.</T>
                      </p>
                    </CockpitSurfaceRow>
                  ) : (
                    checklistItems.map((item) => {
                      const verified = item.verified;
                      return (
                        <CockpitSurfaceRow
                          key={item.id}
                          className="flex items-center justify-between gap-2.5"
                          density="compact"
                        >
                          <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 text-xs">
                            <Checkbox
                              checked={verified}
                              onCheckedChange={() => handleToggleChecklist(item.id)}
                            />
                            <span className="shrink-0 font-mono text-2xs text-muted-foreground">
                              {item.id}
                            </span>
                            <span
                              className={
                                verified ? "text-muted-foreground line-through" : "text-foreground"
                              }
                            >
                              {item.text}
                            </span>
                          </label>
                          <Button
                            aria-label={gt("Remove acceptance criterion")}
                            size="icon-xs"
                            variant="ghost-muted"
                            onClick={() => handleRemoveChecklist(item.id)}
                          >
                            <Trash2Icon />
                          </Button>
                        </CockpitSurfaceRow>
                      );
                    })
                  )}

                  <CockpitSurfaceRow className="bg-muted/15" density="compact">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
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
                      </div>
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
                  </CockpitSurfaceRow>
                </CockpitSurface>
              </section>

              {gates.length > 0 ? (
                <section className="space-y-2">
                  <CockpitSectionHeader
                    count={gates.length}
                    icon={<ShieldCheckIcon />}
                    title={<T>Workflow Gates</T>}
                  />
                  <CockpitSurface divided variant="grouped">
                    {gates.map((gate) => {
                      const latest = latestGates.get(gate.key);
                      const status = latest?.status ?? null;
                      const isRejectingThis = rejectingGateKey === gate.key;
                      return (
                        <CockpitSurfaceRow
                          key={gate.key}
                          className="space-y-2 text-xs"
                          density="compact"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-foreground">{gate.label}</span>
                              {status === "approved" ? (
                                <Badge size="sm" variant="success">
                                  <ShieldCheckIcon />
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
                                  disabled={busyGateKey === gate.key}
                                  size="micro"
                                  variant="warning-outline"
                                  onClick={() => void handleGateDecision(gate.key, "approved")}
                                >
                                  <ShieldCheckIcon />
                                  {busyGateKey === gate.key ? <T>Approving...</T> : <T>Approve</T>}
                                </Button>
                              ) : null}
                              <Button
                                disabled={busyGateKey === gate.key}
                                size="micro"
                                variant="destructive-outline"
                                onClick={() => {
                                  setRejectingGateKey(isRejectingThis ? null : gate.key);
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
                              <div className="min-w-48 flex-1">
                                <Input
                                  placeholder={gt("Rejection reason (notifies owners)...")}
                                  size="sm"
                                  value={rejectNote}
                                  onChange={(event) => setRejectNote(event.target.value)}
                                />
                              </div>
                              <Button
                                disabled={busyGateKey === gate.key}
                                size="xs"
                                variant="destructive"
                                onClick={() =>
                                  void handleGateDecision(gate.key, "rejected", rejectNote)
                                }
                              >
                                <T>Confirm Reject</T>
                              </Button>
                              <Button
                                size="xs"
                                variant="ghost"
                                onClick={() => {
                                  setRejectingGateKey(null);
                                  setRejectNote("");
                                }}
                              >
                                <T>Cancel</T>
                              </Button>
                            </div>
                          ) : null}
                        </CockpitSurfaceRow>
                      );
                    })}
                  </CockpitSurface>
                </section>
              ) : null}

              <section className="space-y-2">
                <CockpitSectionHeader
                  count={activeDetail.changeRequests.length}
                  icon={<PullRequestGlyph.pullRequest />}
                  title={<T>Linked Pull Requests</T>}
                />
                {activeDetail.changeRequests.length === 0 ? (
                  <CockpitSurface padding="sm" variant="subtle">
                    <p className="text-xs text-muted-foreground">
                      <T>
                        No PRs linked yet. Mention the work item code in a PR title or branch, or
                        link an orphan PR from Review Triage.
                      </T>
                    </p>
                  </CockpitSurface>
                ) : (
                  <CockpitSurface divided variant="grouped">
                    {activeDetail.changeRequests.map((cr) => (
                      <CockpitSurfaceRow
                        key={cr.id}
                        className="flex items-center justify-between gap-2.5 text-xs"
                        density="compact"
                        interactive={onOpenChangeRequest !== undefined}
                      >
                        {onOpenChangeRequest ? (
                          <button
                            className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-none"
                            type="button"
                            onClick={() => {
                              onOpenChangeRequest(cr);
                              onClose();
                            }}
                          >
                            <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="shrink-0 font-mono text-2xs font-medium text-foreground">
                              {cr.repoFullName}#{cr.number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {cr.title}
                            </span>
                          </button>
                        ) : (
                          <a
                            className="flex min-w-0 flex-1 items-center gap-2 text-left hover:underline"
                            href={cr.url}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <PullRequestGlyph.pullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="shrink-0 font-mono text-2xs font-medium text-foreground">
                              {cr.repoFullName}#{cr.number}
                            </span>
                            <span className="min-w-0 flex-1 truncate text-muted-foreground">
                              {cr.title}
                            </span>
                          </a>
                        )}

                        <div className="flex shrink-0 items-center gap-1.5">
                          <CockpitDiffStat additions={cr.additions} deletions={cr.deletions} />
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
                            {reviewStatusLabel(cr.automatedReview.status, gt)}
                          </Badge>
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
                      </CockpitSurfaceRow>
                    ))}
                  </CockpitSurface>
                )}
              </section>

              <section className="space-y-2">
                <CockpitSectionHeader
                  count={activeDetail.pulses.length}
                  icon={<ActivityIcon />}
                  title={<T>Pulse History</T>}
                />
                {activeDetail.pulses.length === 0 ? (
                  <CockpitSurface padding="sm" variant="subtle">
                    <p className="text-xs text-muted-foreground">
                      <T>No pulses published yet. Sync a pulse from an active coding thread.</T>
                    </p>
                  </CockpitSurface>
                ) : (
                  <CockpitSurface className="max-h-56 overflow-y-auto" divided variant="grouped">
                    {activeDetail.pulses.map((pulse) => (
                      <CockpitSurfaceRow
                        key={pulse.id}
                        className="space-y-1.5 text-xs"
                        density="compact"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2 text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <Badge size="sm" variant="outline">
                              {pulse.sourceType}
                            </Badge>
                            <CockpitHealthDot
                              health={pulse.health}
                              label={workHealthLabel(pulse.health, gt)}
                            />
                          </div>
                          <span className="font-mono text-2xs tabular-nums">
                            {pulse.createdAt.slice(0, 16).replace("T", " ")}
                          </span>
                        </div>
                        <p className="leading-relaxed text-foreground">{pulse.doneSummary}</p>
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
                      </CockpitSurfaceRow>
                    ))}
                  </CockpitSurface>
                )}
              </section>
            </div>
          ) : null}
        </DialogPanel>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            <T>Close</T>
          </DialogClose>
          <Button
            disabled={saving || !activeDetail || !title.trim()}
            variant="default"
            onClick={() => void handleSave()}
          >
            {saving ? <T>Saving...</T> : <T>Save Changes</T>}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
