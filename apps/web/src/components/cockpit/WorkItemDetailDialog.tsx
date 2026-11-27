import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentId, WorkItemDetail } from "@t3tools/contracts";
import {
  buildLifecycleAttributesPatch,
  deriveWorkItemPipelinePhase,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  standardGitHubLabels,
  suggestWorkItemBranchName,
  type ArtifactStatus,
  type AssigneeType,
  type BranchTopology,
  type ChangeRequestAudit,
  type ChecklistItem,
  type DesignTier,
  type Project,
  type ProjectMemory,
  type ProjectRepo,
  type WorkHealth,
  type WorkItem,
  type WorkspaceMember,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  ActivityIcon,
  BotIcon,
  CheckIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  CircleDotIcon,
  CopyIcon,
  ExternalLinkIcon,
  FileTextIcon,
  GitBranchIcon,
  LayoutTemplateIcon,
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
import { cn } from "~/lib/utils";
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
import { CockpitSwarmAvatar, type CockpitTeamMember } from "./CockpitSwarmAvatar";
import { formatCockpitCommandError } from "./cockpitError";
import {
  buildIssueDispatchPrompt,
  buildPrdGenerationPrompt,
  buildPrototypeGenerationPrompt,
  buildWorkItemThreadPrompt,
  pickMatchingWorkspaceProject,
} from "./workItemPrompt";

interface WorkItemDetailDialogProps {
  readonly environmentId: EnvironmentId;
  readonly workItemId: string | null;
  readonly project?: Project | null | undefined;
  readonly memory?: ProjectMemory | null | undefined;
  readonly repos?: ReadonlyArray<ProjectRepo> | undefined;
  readonly members?: ReadonlyArray<WorkspaceMember> | undefined;
  readonly roster?: ReadonlyArray<CockpitTeamMember> | undefined;
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

type PipelineActionKind = "prd" | "prototype" | "issue" | "dev";

const DEFAULT_AGENT_RUNNER_ID = "claude-agent";

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

function designTierLabel(tier: DesignTier, gt: ReturnType<typeof useGT>): string {
  switch (tier) {
    case "small":
      return gt("Small");
    case "medium":
      return gt("Medium");
    case "large":
      return gt("Large");
    case "cross_repo":
      return gt("Cross-repo");
  }
}

function artifactStatusLabel(status: ArtifactStatus, gt: ReturnType<typeof useGT>): string {
  switch (status) {
    case "none":
      return gt("None");
    case "draft":
      return gt("Draft");
    case "approved":
      return gt("Approved");
  }
}

function encodeAssigneeValue(
  assigneeType: AssigneeType,
  assigneeUserId: string | null,
  assigneeRunnerId: string | null,
): string {
  if (assigneeType === "human" && assigneeUserId) {
    return `human:${assigneeUserId}`;
  }
  if (assigneeType === "runner" && assigneeRunnerId) {
    return `runner:${assigneeRunnerId}`;
  }
  return "unassigned";
}

function decodeAssigneeValue(value: string): {
  readonly assigneeType: AssigneeType;
  readonly assigneeUserId: string | null;
  readonly assigneeRunnerId: string | null;
} {
  if (value.startsWith("human:")) {
    const userId = value.slice("human:".length).trim();
    if (userId) {
      return { assigneeType: "human", assigneeUserId: userId, assigneeRunnerId: null };
    }
  }
  if (value.startsWith("runner:")) {
    const runnerId = value.slice("runner:".length).trim();
    if (runnerId) {
      return { assigneeType: "runner", assigneeUserId: null, assigneeRunnerId: runnerId };
    }
  }
  return { assigneeType: "unassigned", assigneeUserId: null, assigneeRunnerId: null };
}

function resolveMemberHandle(
  member: WorkspaceMember,
  roster: ReadonlyArray<CockpitTeamMember>,
): string {
  const fromRoster = roster.find((entry) => entry.id === member.userId);
  if (fromRoster) return fromRoster.handle;
  const vcs = member.primaryVcsLogin?.trim();
  if (vcs) return vcs.replace(/^@+/, "").toLowerCase();
  const emailLocal = member.email?.split("@")[0]?.trim();
  if (emailLocal) return emailLocal.toLowerCase();
  return member.displayName.trim().toLowerCase().replace(/\s+/g, "-") || member.userId;
}

function isSafeExternalUrl(raw: string): boolean {
  return /^https?:\/\/\S+$/i.test(raw.trim());
}

function parseGitHubIssueInput(
  raw: string,
  primaryRepoFullName: string | null,
): { readonly number: number | null; readonly url: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { number: null, url: null };

  const urlIssueMatch = trimmed.match(/^https?:\/\/.+\/issues\/(\d+)(?:[/?#].*)?$/i);
  if (urlIssueMatch) {
    return { number: Number(urlIssueMatch[1]), url: trimmed };
  }

  if (isSafeExternalUrl(trimmed)) {
    return { number: null, url: trimmed };
  }

  const numMatch = trimmed.match(/^#?(\d+)$/);
  if (numMatch) {
    const num = Number(numMatch[1]);
    const derivedUrl = primaryRepoFullName
      ? `https://github.com/${primaryRepoFullName}/issues/${num}`
      : null;
    return { number: num, url: derivedUrl };
  }

  return { number: null, url: null };
}

function buildBranchCheckoutCommand(
  branchName: string,
  topology: BranchTopology,
  workItem?: Pick<WorkItem, "priority" | "itemType"> | null,
): string {
  const isHotfix =
    workItem?.priority === "p0" &&
    (workItem.itemType === "bug" || workItem.itemType === "security");
  const baseBranch = topology === "single_trunk" || isHotfix ? "main" : "dev";
  return `git fetch origin ${baseBranch} && git switch --no-track -c ${branchName} "$(git rev-parse --verify 'FETCH_HEAD^{commit}')"`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  return navigator.clipboard
    .writeText(text)
    .then(() => true)
    .catch(() => false);
}

function focusElementById(id: string): void {
  const el = document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ behavior: "smooth", block: "nearest" });
  if (el instanceof HTMLElement) {
    el.focus();
  }
}

export function WorkItemDetailDialog({
  environmentId,
  workItemId,
  project,
  memory,
  repos = [],
  members = [],
  roster = [],
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
  const [assigneeValue, setAssigneeValue] = useState<string>("unassigned");
  const [plannedStartAt, setPlannedStartAt] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [designTier, setDesignTier] = useState<DesignTier>("medium");
  const [prdStatus, setPrdStatus] = useState<ArtifactStatus>("none");
  const [prototypeStatus, setPrototypeStatus] = useState<ArtifactStatus>("none");
  const [prototypeUrl, setPrototypeUrl] = useState("");
  const [initialPrototypeUrl, setInitialPrototypeUrl] = useState("");
  const [githubIssueInput, setGithubIssueInput] = useState("");
  const [branchName, setBranchName] = useState("");
  const [branchTopology, setBranchTopology] = useState<BranchTopology>("dual_trunk");
  const [specMarkdown, setSpecMarkdown] = useState("");
  const [checklistItems, setChecklistItems] = useState<ReadonlyArray<ChecklistItem>>([]);
  const [newAcText, setNewAcText] = useState("");
  const [saving, setSaving] = useState(false);

  const [busyGateKey, setBusyGateKey] = useState<string | null>(null);
  const [rejectingGateKey, setRejectingGateKey] = useState<string | null>(null);
  const [rejectNote, setRejectNote] = useState("");
  const [unlinkingCrId, setUnlinkingCrId] = useState<string | null>(null);

  const [chosenLocalProjectId, setChosenLocalProjectId] = useState<string>("");
  const [launchingAction, setLaunchingAction] = useState<PipelineActionKind | null>(null);

  const getDetail = useAtomCommand(teamHubEnvironment.getWorkItemDetail, { reportFailure: false });
  const updateWorkItem = useAtomCommand(teamHubEnvironment.updateWorkItem, {
    reportFailure: false,
  });
  const approveGate = useAtomCommand(teamHubEnvironment.approveGate, { reportFailure: false });
  const linkChangeRequest = useAtomCommand(teamHubEnvironment.linkChangeRequest, {
    reportFailure: false,
  });

  const hydrateFromDetail = (data: WorkItemDetail) => {
    const lifecycle = readWorkItemLifecycle(data.workItem);
    const hydratedProtoUrl = lifecycle.prototypeUrl ?? data.workItem.previewUrls[0] ?? "";
    const hydratedIssue =
      lifecycle.githubIssueUrl ??
      (lifecycle.githubIssueNumber !== null ? `#${lifecycle.githubIssueNumber}` : "");

    setDetail(data);
    setTitle(data.workItem.title);
    setStage(data.workItem.stage);
    setHealth(data.workItem.health);
    setAssigneeValue(
      encodeAssigneeValue(
        data.workItem.assigneeType,
        data.workItem.assigneeUserId,
        data.workItem.assigneeRunnerId,
      ),
    );
    setPlannedStartAt(lifecycle.plannedStartAt ? lifecycle.plannedStartAt.slice(0, 10) : "");
    setDueAt(lifecycle.dueAt ? lifecycle.dueAt.slice(0, 10) : "");
    setDesignTier(lifecycle.designTier);
    setPrdStatus(lifecycle.prdStatus);
    setPrototypeStatus(lifecycle.prototypeStatus);
    setPrototypeUrl(hydratedProtoUrl);
    setInitialPrototypeUrl(hydratedProtoUrl);
    setGithubIssueInput(hydratedIssue);
    setBranchName(lifecycle.branchName ?? "");
    setBranchTopology(lifecycle.branchTopology);
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
  const matchedRepoForSelectedLocal = selectedLocalProject
    ? (repos.find((repo) => {
        const repoLeaf = repo.repoFullName.split("/").at(-1)?.trim().toLowerCase() ?? "";
        const folderName =
          selectedLocalProject.workspaceRoot.split(/[\\/]/).at(-1)?.trim().toLowerCase() ?? "";
        return (
          repoLeaf.length > 0 &&
          (repoLeaf === selectedLocalProject.title.trim().toLowerCase() || repoLeaf === folderName)
        );
      }) ?? null)
    : null;
  const primaryRepoFullName =
    matchedRepoForSelectedLocal?.repoFullName ?? repos[0]?.repoFullName ?? null;

  const selectedStageLabel = stages.find((s) => s.id === stage)?.label ?? stage;
  const verifiedCount = checklistItems.filter((item) => item.verified).length;
  const decodedAssignee = decodeAssigneeValue(assigneeValue);
  const parsedIssue = parseGitHubIssueInput(githubIssueInput, primaryRepoFullName);

  const memberOptions = members.map((member) => ({
    value: `human:${member.userId}`,
    userId: member.userId,
    handle: resolveMemberHandle(member, roster),
    displayName: member.displayName,
  }));

  const selectedMemberOption =
    decodedAssignee.assigneeType === "human" && decodedAssignee.assigneeUserId
      ? (memberOptions.find((entry) => entry.userId === decodedAssignee.assigneeUserId) ?? null)
      : null;

  const selectedRosterMember =
    decodedAssignee.assigneeType === "human" && decodedAssignee.assigneeUserId
      ? (roster.find((entry) => entry.id === decodedAssignee.assigneeUserId) ?? null)
      : decodedAssignee.assigneeType === "runner" && decodedAssignee.assigneeRunnerId
        ? (roster.find((entry) => entry.handle === decodedAssignee.assigneeRunnerId) ?? null)
        : null;

  const resolvedAssigneeHandle =
    decodedAssignee.assigneeType === "human"
      ? (selectedMemberOption?.handle ?? selectedRosterMember?.handle ?? null)
      : decodedAssignee.assigneeType === "runner"
        ? (decodedAssignee.assigneeRunnerId ?? DEFAULT_AGENT_RUNNER_ID)
        : null;

  const resolvedAssigneeDisplayName =
    decodedAssignee.assigneeType === "human"
      ? (selectedMemberOption?.displayName ?? selectedRosterMember?.displayName ?? null)
      : decodedAssignee.assigneeType === "runner"
        ? gt("Coding Agent")
        : null;

  const customHumanAssigneeFallback =
    decodedAssignee.assigneeType === "human" &&
    decodedAssignee.assigneeUserId &&
    !selectedMemberOption
      ? {
          value: assigneeValue,
          label: selectedRosterMember
            ? `@${selectedRosterMember.handle}`
            : decodedAssignee.assigneeUserId,
        }
      : null;

  const customRunnerAssigneeFallback =
    decodedAssignee.assigneeType === "runner" &&
    decodedAssignee.assigneeRunnerId &&
    decodedAssignee.assigneeRunnerId !== DEFAULT_AGENT_RUNNER_ID
      ? {
          value: assigneeValue,
          runnerId: decodedAssignee.assigneeRunnerId,
        }
      : null;

  const activeLifecycle = activeDetail ? readWorkItemLifecycle(activeDetail.workItem) : null;
  const standardLabels = activeDetail
    ? activeLifecycle && activeLifecycle.githubLabels.length > 0
      ? activeLifecycle.githubLabels
      : standardGitHubLabels(activeDetail.workItem.itemType, activeDetail.workItem.priority)
    : [];

  const suggestedBranch = activeDetail
    ? suggestWorkItemBranchName({
        itemType: activeDetail.workItem.itemType,
        priority: activeDetail.workItem.priority,
        code: activeDetail.workItem.code,
        title: title.trim() || activeDetail.workItem.title,
        githubIssueNumber: parsedIssue.number,
      })
    : "";
  const effectiveBranchName = branchName.trim() || suggestedBranch;

  const buildNextPreviewUrls = (basePreviewUrls: ReadonlyArray<string>): string[] => {
    const trimmedProtoUrl = prototypeUrl.trim();
    const preserved = basePreviewUrls.filter(
      (url) => url !== initialPrototypeUrl && url !== trimmedProtoUrl,
    );
    return trimmedProtoUrl ? [trimmedProtoUrl, ...preserved] : preserved;
  };

  const buildLifecyclePatch = (): Record<string, unknown> =>
    buildLifecycleAttributesPatch({
      plannedStartAt: plannedStartAt.trim() || null,
      dueAt: dueAt.trim() || null,
      designTier,
      prdStatus,
      prototypeStatus,
      prototypeUrl: prototypeUrl.trim() || null,
      githubIssueNumber: parsedIssue.number,
      githubIssueUrl: parsedIssue.url,
      githubLabels: standardLabels,
      branchTopology,
      branchName: branchName.trim() || null,
    });

  const draftWorkItem: WorkItem | null = activeDetail
    ? {
        ...activeDetail.workItem,
        title: title.trim() || activeDetail.workItem.title,
        stage,
        health,
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        specMarkdown,
        previewUrls: buildNextPreviewUrls(activeDetail.workItem.previewUrls),
        checklistItems: [...checklistItems],
        attributes: {
          ...activeDetail.workItem.attributes,
          ...buildLifecyclePatch(),
        },
      }
    : null;

  const currentPhase =
    draftWorkItem && activeDetail
      ? deriveWorkItemPipelinePhase({
          workItem: draftWorkItem,
          changeRequests: activeDetail.changeRequests,
        })
      : "intake";

  const hasPrdArtifact = prdStatus !== "none" || specMarkdown.trim().length > 40;
  const hasPrototypeArtifact =
    prototypeStatus !== "none" ||
    prototypeUrl.trim().length > 0 ||
    (activeDetail?.workItem.previewUrls.length ?? 0) > 0;
  const hasIssueOrAssignee =
    parsedIssue.number !== null || parsedIssue.url !== null || assigneeValue !== "unassigned";
  const hasDevBranch =
    branchName.trim().length > 0 ||
    (activeDetail?.changeRequests.length ?? 0) > 0 ||
    currentPhase === "dev" ||
    currentPhase === "review" ||
    currentPhase === "release" ||
    currentPhase === "done";
  const hasMergedPr = (activeDetail?.changeRequests ?? []).some((cr) => cr.state === "merged");
  const isReviewDone = hasMergedPr || currentPhase === "release" || currentPhase === "done";
  const isReleaseDone = currentPhase === "done";

  const rawLifecycleSteps = [
    { id: "intake", label: gt("Intake"), done: true, focusId: "wid-title" },
    { id: "prd", label: gt("AI PRD"), done: hasPrdArtifact, focusId: "wid-spec" },
    {
      id: "prototype",
      label: gt("Prototype"),
      done: hasPrototypeArtifact,
      focusId: "wid-prototype-url",
    },
    { id: "issue", label: gt("Issue & Assign"), done: hasIssueOrAssignee, focusId: "wid-issue" },
    { id: "dev", label: gt("Dev Branch"), done: hasDevBranch, focusId: "wid-branch" },
    { id: "review", label: gt("PR & Review"), done: isReviewDone, focusId: "wid-prs" },
    { id: "release", label: gt("Release"), done: isReleaseDone, focusId: "wid-gates" },
  ] as const;

  const firstPendingStepIdx = rawLifecycleSteps.findIndex((step) => !step.done);
  const activeStepIndex =
    firstPendingStepIdx === -1 ? rawLifecycleSteps.length - 1 : firstPendingStepIdx;

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
    if (!workItemId || !activeDetail || !title.trim()) return;
    setSaving(true);
    const nextPreviewUrls = buildNextPreviewUrls(activeDetail.workItem.previewUrls);
    const res = await updateWorkItem({
      environmentId,
      input: {
        workItemId,
        title: title.trim(),
        stage,
        health,
        specMarkdown,
        previewUrls: nextPreviewUrls,
        checklistItems: [...checklistItems],
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        attributes: buildLifecyclePatch(),
      },
    });
    setSaving(false);
    if (res._tag === "Success") {
      setDetail((prev) => (prev ? { ...prev, workItem: res.value.workItem } : prev));
      setInitialPrototypeUrl(prototypeUrl.trim());
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

  const handleCopyBranchCommand = async () => {
    if (!effectiveBranchName) return;
    const command = buildBranchCheckoutCommand(
      effectiveBranchName,
      branchTopology,
      activeDetail?.workItem ?? null,
    );
    const copied = await copyTextToClipboard(command);
    toastManager.add({
      title: copied ? gt("Branch command copied") : gt("Clipboard is unavailable"),
      type: copied ? "success" : "error",
    });
  };

  const handleLaunchPipelineAction = async (action: PipelineActionKind) => {
    if (!activeDetail || !draftWorkItem || !selectedLocalProject) return;
    setLaunchingAction(action);

    let prompt = "";
    switch (action) {
      case "prd":
        prompt = buildPrdGenerationPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
        });
        break;
      case "prototype":
        prompt = buildPrototypeGenerationPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
        });
        break;
      case "issue":
        prompt = buildIssueDispatchPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          repoFullName: primaryRepoFullName,
          assigneeHandle: resolvedAssigneeHandle,
          assigneeDisplayName: resolvedAssigneeDisplayName,
        });
        break;
      case "dev":
        prompt = buildWorkItemThreadPrompt({
          workItem: draftWorkItem,
          project,
          memory,
          changeRequests: activeDetail.changeRequests,
          repoFullName: primaryRepoFullName,
          topology: branchTopology,
        });
        break;
    }

    await handleNewThread(
      scopeProjectRef(selectedLocalProject.environmentId, selectedLocalProject.id),
      {
        prompt,
      },
    );
    setLaunchingAction(null);
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
      <DialogPopup className="max-w-4xl">
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
              Drive end-to-end delivery from requirement intake, AI PRD, and prototype to GitHub
              issue, dev branch, PR review, and release.
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
              <nav aria-label={gt("Delivery lifecycle")} className="overflow-x-auto">
                <ol className="flex min-w-max items-center gap-1 rounded-xl border border-border/50 bg-muted/15 px-2.5 py-2">
                  {rawLifecycleSteps.map((step, index) => {
                    const isCurrent = index === activeStepIndex && !step.done;
                    return (
                      <li key={step.id} className="flex items-center gap-1">
                        <button
                          className={cn(
                            "inline-flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                            isCurrent
                              ? "bg-accent/70 font-medium text-foreground"
                              : step.done
                                ? "text-foreground/90 hover:bg-accent/40"
                                : "text-muted-foreground hover:bg-accent/30 hover:text-foreground",
                          )}
                          type="button"
                          onClick={() => focusElementById(step.focusId)}
                        >
                          <span
                            className={cn(
                              "inline-flex size-4 shrink-0 items-center justify-center rounded-full font-mono text-3xs tabular-nums",
                              step.done
                                ? "bg-success/16 text-success-foreground"
                                : isCurrent
                                  ? "bg-primary/16 font-semibold text-primary"
                                  : "bg-muted text-muted-foreground",
                            )}
                          >
                            {step.done ? <CheckIcon className="size-2.5" /> : index + 1}
                          </span>
                          <span className="whitespace-nowrap">{step.label}</span>
                        </button>
                        {index < rawLifecycleSteps.length - 1 ? (
                          <ChevronRightIcon
                            aria-hidden
                            className="size-3 shrink-0 text-muted-foreground/45"
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </nav>

              <CockpitSurface padding="sm" variant="subtle">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex items-center gap-1.5 text-xs font-medium text-foreground">
                        <GitBranchIcon className="size-3.5 text-muted-foreground" />
                        <T>AI Delivery Actions</T>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        <T>
                          Launch a scoped U3 Code agent thread with live spec, acceptance criteria,
                          and branch workflow guardrails.
                        </T>
                      </p>
                    </div>
                    {localProjects.length > 0 && selectedLocalProject ? (
                      <div className="w-48">
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
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        <T>Add a local repository in the sidebar first.</T>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-2.5">
                    <Button
                      disabled={!selectedLocalProject || launchingAction !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleLaunchPipelineAction("prd")}
                    >
                      <FileTextIcon />
                      {launchingAction === "prd" ? <T>Opening...</T> : <T>AI Draft PRD</T>}
                    </Button>
                    <Button
                      disabled={!selectedLocalProject || launchingAction !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleLaunchPipelineAction("prototype")}
                    >
                      <LayoutTemplateIcon />
                      {launchingAction === "prototype" ? <T>Opening...</T> : <T>AI Prototype</T>}
                    </Button>
                    <Button
                      disabled={!selectedLocalProject || launchingAction !== null}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleLaunchPipelineAction("issue")}
                    >
                      <CircleDotIcon />
                      {launchingAction === "issue" ? <T>Opening...</T> : <T>Submit GitHub Issue</T>}
                    </Button>
                    <Button
                      disabled={!selectedLocalProject || launchingAction !== null}
                      size="xs"
                      variant="secondary"
                      onClick={() => void handleLaunchPipelineAction("dev")}
                    >
                      <GitBranchIcon />
                      {launchingAction === "dev" ? <T>Opening...</T> : <T>Start Dev Branch</T>}
                    </Button>
                  </div>
                </div>
              </CockpitSurface>

              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-12">
                  <div className="sm:col-span-5">
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
                  <div className="sm:col-span-2">
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
                  <div className="sm:col-span-2">
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
                  <div className="sm:col-span-3">
                    <CockpitFieldLabel htmlFor="wid-assignee">
                      <T>Assignee</T>
                    </CockpitFieldLabel>
                    <Select
                      value={assigneeValue}
                      onValueChange={(value) => {
                        if (value) setAssigneeValue(value);
                      }}
                    >
                      <SelectTrigger id="wid-assignee" size="sm">
                        <SelectValue>
                          {decodedAssignee.assigneeType === "unassigned" ? (
                            <T>Unassigned</T>
                          ) : decodedAssignee.assigneeType === "runner" ? (
                            <span className="inline-flex items-center gap-1.5 truncate">
                              <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                              <span className="truncate font-mono text-xs">
                                @{decodedAssignee.assigneeRunnerId ?? DEFAULT_AGENT_RUNNER_ID}
                              </span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 truncate">
                              {resolvedAssigneeHandle ? (
                                <CockpitSwarmAvatar
                                  displayName={
                                    resolvedAssigneeDisplayName ?? resolvedAssigneeHandle
                                  }
                                  handle={resolvedAssigneeHandle}
                                  kind="human"
                                  size="sm"
                                />
                              ) : null}
                              <span className="truncate font-mono text-xs">
                                {resolvedAssigneeHandle
                                  ? `@${resolvedAssigneeHandle}`
                                  : decodedAssignee.assigneeUserId}
                              </span>
                            </span>
                          )}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="unassigned">{gt("Unassigned")}</SelectItem>
                        {memberOptions.map((member) => (
                          <SelectItem key={member.value} value={member.value}>
                            @{member.handle} · {member.displayName}
                          </SelectItem>
                        ))}
                        {customHumanAssigneeFallback ? (
                          <SelectItem value={customHumanAssigneeFallback.value}>
                            {customHumanAssigneeFallback.label}
                          </SelectItem>
                        ) : null}
                        <SelectItem value={`runner:${DEFAULT_AGENT_RUNNER_ID}`}>
                          {gt("Coding Agent ({runnerId})", { runnerId: DEFAULT_AGENT_RUNNER_ID })}
                        </SelectItem>
                        {customRunnerAssigneeFallback ? (
                          <SelectItem value={customRunnerAssigneeFallback.value}>
                            {gt("Coding Agent ({runnerId})", {
                              runnerId: customRunnerAssigneeFallback.runnerId,
                            })}
                          </SelectItem>
                        ) : null}
                      </SelectPopup>
                    </Select>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-5">
                  <div>
                    <CockpitFieldLabel htmlFor="wid-start-date">
                      <T>Start Date</T>
                    </CockpitFieldLabel>
                    <Input
                      id="wid-start-date"
                      size="sm"
                      type="date"
                      value={plannedStartAt}
                      onChange={(event) => setPlannedStartAt(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="wid-due-date">
                      <T>Due Date</T>
                    </CockpitFieldLabel>
                    <Input
                      id="wid-due-date"
                      size="sm"
                      type="date"
                      value={dueAt}
                      onChange={(event) => setDueAt(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="wid-design-tier">
                      <T>Design Tier</T>
                    </CockpitFieldLabel>
                    <Select
                      value={designTier}
                      onValueChange={(value) => {
                        if (
                          value === "small" ||
                          value === "medium" ||
                          value === "large" ||
                          value === "cross_repo"
                        ) {
                          setDesignTier(value);
                        }
                      }}
                    >
                      <SelectTrigger id="wid-design-tier" size="sm">
                        <SelectValue>{designTierLabel(designTier, gt)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="small">{gt("Small")}</SelectItem>
                        <SelectItem value="medium">{gt("Medium")}</SelectItem>
                        <SelectItem value="large">{gt("Large")}</SelectItem>
                        <SelectItem value="cross_repo">{gt("Cross-repo")}</SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="wid-prd-status">
                      <T>PRD Status</T>
                    </CockpitFieldLabel>
                    <Select
                      value={prdStatus}
                      onValueChange={(value) => {
                        if (value === "none" || value === "draft" || value === "approved") {
                          setPrdStatus(value);
                        }
                      }}
                    >
                      <SelectTrigger id="wid-prd-status" size="sm">
                        <SelectValue>{artifactStatusLabel(prdStatus, gt)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="none">{gt("None")}</SelectItem>
                        <SelectItem value="draft">{gt("Draft")}</SelectItem>
                        <SelectItem value="approved">{gt("Approved")}</SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="wid-proto-status">
                      <T>Prototype Status</T>
                    </CockpitFieldLabel>
                    <Select
                      value={prototypeStatus}
                      onValueChange={(value) => {
                        if (value === "none" || value === "draft" || value === "approved") {
                          setPrototypeStatus(value);
                        }
                      }}
                    >
                      <SelectTrigger id="wid-proto-status" size="sm">
                        <SelectValue>{artifactStatusLabel(prototypeStatus, gt)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="none">{gt("None")}</SelectItem>
                        <SelectItem value="draft">{gt("Draft")}</SelectItem>
                        <SelectItem value="approved">{gt("Approved")}</SelectItem>
                      </SelectPopup>
                    </Select>
                  </div>
                </div>
              </div>

              <CockpitSurface padding="sm" variant="subtle">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <GitBranchIcon className="size-3.5 shrink-0 text-muted-foreground" />
                      <div className="min-w-44 flex-1">
                        <Input
                          aria-label={gt("Development branch")}
                          font="mono"
                          id="wid-branch"
                          placeholder={suggestedBranch}
                          size="compact"
                          value={branchName}
                          onChange={(event) => setBranchName(event.target.value)}
                        />
                      </div>
                      <Button
                        disabled={!effectiveBranchName}
                        size="xs"
                        variant="outline"
                        onClick={() => void handleCopyBranchCommand()}
                      >
                        <CopyIcon />
                        <T>Copy Branch Command</T>
                      </Button>
                    </div>
                    {standardLabels.length > 0 ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {standardLabels.map((label) => (
                          <Badge key={label} size="sm" variant="outline">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-3 border-t border-border/40 pt-3 sm:grid-cols-2">
                    <div>
                      <CockpitFieldLabel htmlFor="wid-issue">
                        <T>GitHub Issue URL or #Number</T>
                      </CockpitFieldLabel>
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <Input
                            font="mono"
                            id="wid-issue"
                            placeholder={gt("#42 or https://github.com/org/repo/issues/42")}
                            size="sm"
                            value={githubIssueInput}
                            onChange={(event) => setGithubIssueInput(event.target.value)}
                          />
                        </div>
                        {parsedIssue.url && isSafeExternalUrl(parsedIssue.url) ? (
                          <Button
                            aria-label={gt("Open GitHub Issue")}
                            render={
                              <a href={parsedIssue.url} rel="noreferrer" target="_blank">
                                <ExternalLinkIcon />
                              </a>
                            }
                            size="icon-xs"
                            variant="outline"
                          />
                        ) : null}
                      </div>
                    </div>

                    <div>
                      <CockpitFieldLabel htmlFor="wid-prototype-url">
                        <T>Prototype / Preview URL</T>
                      </CockpitFieldLabel>
                      <div className="flex items-center gap-1.5">
                        <div className="min-w-0 flex-1">
                          <Input
                            font="mono"
                            id="wid-prototype-url"
                            placeholder={gt("https://preview.example.com/prototype")}
                            size="sm"
                            value={prototypeUrl}
                            onChange={(event) => setPrototypeUrl(event.target.value)}
                          />
                        </div>
                        {isSafeExternalUrl(prototypeUrl) ? (
                          <Button
                            aria-label={gt("Open Prototype Preview")}
                            render={
                              <a href={prototypeUrl.trim()} rel="noreferrer" target="_blank">
                                <ExternalLinkIcon />
                              </a>
                            }
                            size="icon-xs"
                            variant="outline"
                          />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>
              </CockpitSurface>

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
                <section className="space-y-2" id="wid-gates">
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

              <section className="space-y-2" id="wid-prs">
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
