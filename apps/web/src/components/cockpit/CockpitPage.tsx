import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type {
  CockpitOverview,
  EnvironmentId,
  HubWsEvent,
  TeamHubDigestsResult,
  TeamHubMemoryResult,
  TeamHubReviewQueueResult,
  TeamHubStatusResult,
} from "@t3tools/contracts";
import {
  buildLifecycleAttributesPatch,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  standardGitHubLabels,
  type AssigneeType,
  type ChangeRequestAudit,
  type CockpitWorkItemCard,
  type DesignTier,
  type ProjectDirective,
  type ReleaseCard,
  type TeamBoardMessage,
  type WorkItemPriority,
  type WorkItemType,
  type WorkspaceMember,
} from "@u3code/hub-contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { T, useGT, useMessages, Var } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  FileTextIcon,
  GanttChartIcon,
  KanbanIcon,
  ListIcon,
  LogOutIcon,
  PackageCheckIcon,
  PlusIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { PullRequestGlyph } from "~/components/pullRequest/pullRequestIcons";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "~/components/WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "~/components/WorkspacePageContainer";
import { WorkspacePageHeader } from "~/components/WorkspacePageHeader";
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import { RefreshIcon } from "~/components/ui/refresh-icon";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { SidebarInset } from "~/components/ui/sidebar";
import { Textarea } from "~/components/ui/textarea";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { toastManager } from "~/components/ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { isElectron } from "~/env";
import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
import { cn } from "~/lib/utils";
import { useProjects } from "~/state/entities";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { CockpitBoardTab } from "./CockpitBoardTab";
import { CockpitConnectCard } from "./CockpitConnectCard";
import { CockpitGanttView } from "./CockpitGanttView";
import { CockpitMembersTab } from "./CockpitMembersTab";
import { CockpitMemoryTab } from "./CockpitMemoryTab";
import { CockpitOverviewTab } from "./CockpitOverviewTab";
import {
  CockpitFieldLabel,
  CockpitInlineAlert,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatPill,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  CockpitUnderlineTab,
  CockpitUnderlineTabs,
  type CockpitTone,
} from "./CockpitPrimitives";
import { CockpitPullRequestPane } from "./CockpitPullRequestPane";
import { CockpitReleasesTab } from "./CockpitReleasesTab";
import { CockpitSettingsTab } from "./CockpitSettingsTab";
import { CockpitSwarmAvatar, deriveTeamRoster, type CockpitTeamMember } from "./CockpitSwarmAvatar";
import { CockpitTriageTab } from "./CockpitTriageTab";
import { WorkItemDetailDialog } from "./WorkItemDetailDialog";
import { formatCockpitCommandError } from "./cockpitError";
import { buildPrdGenerationPrompt, pickMatchingWorkspaceProject } from "./workItemPrompt";

type CockpitTab = "overview" | "board" | "members" | "delivery" | "memory" | "setup";
type DeliverySubTab = "kanban" | "gantt" | "triage" | "releases";
type BoardViewMode = "board" | "list";
type BoardFilter = "all" | "blocked" | "has_pr";
type TriageFilter = "all" | "blocked" | "human" | "unlinked";

const DEFAULT_AGENT_RUNNER_ID = "claude-agent";

function todayLocalIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysIsoDate(baseYmd: string, deltaDays: number): string {
  const match = baseYmd.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return baseYmd;
  const utc = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + deltaDays);
  return new Date(utc).toISOString().slice(0, 10);
}

function formatShortDueDate(isoDate: string): string {
  const ymd = isoDate.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
  const parsed = new Date(`${ymd}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return ymd;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(parsed);
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

function resolveCardAssignee(
  card: CockpitWorkItemCard,
  roster: ReadonlyArray<CockpitTeamMember>,
): {
  readonly handle: string;
  readonly displayName: string;
  readonly kind: "human" | "agent";
} | null {
  if (card.workItem.assigneeType === "human" && card.workItem.assigneeUserId) {
    const matched = roster.find((member) => member.id === card.workItem.assigneeUserId);
    if (matched) {
      return { handle: matched.handle, displayName: matched.displayName, kind: matched.kind };
    }
    return null;
  }
  if (card.workItem.assigneeType === "runner" && card.workItem.assigneeRunnerId) {
    const runnerId = card.workItem.assigneeRunnerId.trim();
    const matched = roster.find((member) => member.handle === runnerId.toLowerCase());
    if (matched) {
      return { handle: matched.handle, displayName: matched.displayName, kind: "agent" };
    }
    return { handle: runnerId, displayName: runnerId, kind: "agent" };
  }
  return null;
}

function workItemTypeLabel(itemType: WorkItemType, gt: ReturnType<typeof useGT>): string {
  switch (itemType) {
    case "feature":
      return gt("Feature");
    case "refactor":
      return gt("Refactor");
    case "bug":
      return gt("Bug");
    case "chore":
      return gt("Chore");
    case "security":
      return gt("Security");
  }
}

function reviewStatusTone(status: string): CockpitTone {
  if (status === "blocking") return "error";
  if (status === "pass" || status === "auto_merged") return "success";
  return "neutral";
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

function matchesBoardFilter(card: CockpitWorkItemCard, filter: BoardFilter): boolean {
  if (filter === "blocked") {
    return card.workItem.health === "blocked" || card.workItem.health === "at_risk";
  }
  if (filter === "has_pr") {
    return card.changeRequests.length > 0;
  }
  return true;
}

export function CockpitPage() {
  const gt = useGT();
  const resolveMessage = useMessages();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const localProjects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [activeTab, setActiveTab] = useState<CockpitTab>("overview");
  const [deliverySubTab, setDeliverySubTab] = useState<DeliverySubTab>("kanban");
  const [boardView, setBoardView] = useState<BoardViewMode>("board");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [triageFilter, setTriageFilter] = useState<TriageFilter>("all");

  const [statusLoadedForEnv, setStatusLoadedForEnv] = useState<EnvironmentId | null>(null);
  const [loadingData, setLoadingData] = useState(false);
  const [status, setStatus] = useState<TeamHubStatusResult | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>("");
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  const [overview, setOverview] = useState<CockpitOverview | null>(null);
  const [reviewQueue, setReviewQueue] = useState<TeamHubReviewQueueResult | null>(null);
  const [digests, setDigests] = useState<TeamHubDigestsResult | null>(null);
  const [memory, setMemory] = useState<TeamHubMemoryResult["memory"]>(null);
  const [members, setMembers] = useState<ReadonlyArray<WorkspaceMember>>([]);
  const [boardMessages, setBoardMessages] = useState<ReadonlyArray<TeamBoardMessage>>([]);
  const [releases, setReleases] = useState<ReadonlyArray<ReleaseCard>>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<WorkItemType>("feature");
  const [newPriority, setNewPriority] = useState<WorkItemPriority>("p1");
  const [newDesignTier, setNewDesignTier] = useState<DesignTier>("medium");
  const [newAssignee, setNewAssignee] = useState<string>("unassigned");
  const [newPlannedStartAt, setNewPlannedStartAt] = useState<string>(() => todayLocalIsoDate());
  const [newDueAt, setNewDueAt] = useState<string>(() => addDaysIsoDate(todayLocalIsoDate(), 5));
  const [newSpec, setNewSpec] = useState("");
  const [creatingMode, setCreatingMode] = useState<"create" | "prd" | null>(null);

  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [savingDirectives, setSavingDirectives] = useState(false);
  const [postingBoardMessage, setPostingBoardMessage] = useState(false);
  const [pendingMentionHandle, setPendingMentionHandle] = useState<string | null>(null);
  const [pendingFilterHandle, setPendingFilterHandle] = useState<string | null>(null);
  const [liveRefreshCount, setLiveRefreshCount] = useState(0);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(null);
  const [selectedChangeRequestId, setSelectedChangeRequestId] = useState<string | null>(null);
  const [fallbackChangeRequest, setFallbackChangeRequest] = useState<ChangeRequestAudit | null>(
    null,
  );

  const fetchStatus = useAtomCommand(teamHubEnvironment.status, { reportFailure: false });
  const connectTokens = useAtomCommand(teamHubEnvironment.connectTokens, { reportFailure: false });
  const disconnectHub = useAtomCommand(teamHubEnvironment.disconnect, { reportFailure: false });
  const fetchOverview = useAtomCommand(teamHubEnvironment.getOverview, { reportFailure: false });
  const fetchReviewQueue = useAtomCommand(teamHubEnvironment.getReviewQueue, {
    reportFailure: false,
  });
  const fetchDigests = useAtomCommand(teamHubEnvironment.getDigests, { reportFailure: false });
  const generateDigest = useAtomCommand(teamHubEnvironment.generateDigest, {
    reportFailure: false,
  });
  const fetchMemory = useAtomCommand(teamHubEnvironment.getMemory, { reportFailure: false });
  const fetchMembers = useAtomCommand(teamHubEnvironment.listMembers, { reportFailure: false });
  const fetchBoardMessages = useAtomCommand(teamHubEnvironment.listBoardMessages, {
    reportFailure: false,
  });
  const postBoardMessage = useAtomCommand(teamHubEnvironment.postBoardMessage, {
    reportFailure: false,
  });
  const fetchReleases = useAtomCommand(teamHubEnvironment.listReleases, { reportFailure: false });
  const updateDirectives = useAtomCommand(teamHubEnvironment.updateDirectives, {
    reportFailure: false,
  });
  const createWorkItem = useAtomCommand(teamHubEnvironment.createWorkItem, {
    reportFailure: false,
  });
  const updateWorkItem = useAtomCommand(teamHubEnvironment.updateWorkItem, {
    reportFailure: false,
  });
  const approveGate = useAtomCommand(teamHubEnvironment.approveGate, { reportFailure: false });
  const linkChangeRequest = useAtomCommand(teamHubEnvironment.linkChangeRequest, {
    reportFailure: false,
  });

  const loadCockpitData = async (envId: EnvironmentId, workspaceId: string, projectId: string) => {
    if (!workspaceId) return;
    setLoadingData(true);
    setErrorMessage(null);

    const [overviewRes, queueRes, digestsRes, membersRes] = await Promise.all([
      fetchOverview({
        environmentId: envId,
        input: { workspaceId, projectId: projectId || null },
      }),
      fetchReviewQueue({ environmentId: envId, input: { workspaceId } }),
      fetchDigests({ environmentId: envId, input: { workspaceId } }),
      fetchMembers({ environmentId: envId, input: { workspaceId } }),
    ]);

    if (overviewRes._tag === "Success") {
      setOverview(overviewRes.value);
      const resolvedProjectId =
        projectId || overviewRes.value.project?.id || overviewRes.value.projects[0]?.id || "";
      if (resolvedProjectId && resolvedProjectId !== projectId) {
        setSelectedProjectId(resolvedProjectId);
      }

      const [boardRes, memRes, releasesRes] = await Promise.all([
        fetchBoardMessages({
          environmentId: envId,
          input: {
            workspaceId,
            ...(resolvedProjectId ? { projectId: resolvedProjectId } : {}),
            limit: 200,
          },
        }),
        resolvedProjectId
          ? fetchMemory({
              environmentId: envId,
              input: { projectId: resolvedProjectId },
            })
          : Promise.resolve(null),
        resolvedProjectId
          ? fetchReleases({
              environmentId: envId,
              input: { projectId: resolvedProjectId },
            })
          : Promise.resolve(null),
      ]);

      if (boardRes._tag === "Success") {
        setBoardMessages(boardRes.value.messages);
      }
      if (memRes) {
        if (memRes._tag === "Success") {
          setMemory(memRes.value.memory);
        }
      } else {
        setMemory(null);
      }
      if (releasesRes) {
        if (releasesRes._tag === "Success") {
          setReleases(releasesRes.value.releases);
        }
      } else {
        setReleases([]);
      }
    } else {
      setErrorMessage(
        formatCockpitCommandError(overviewRes, gt("Failed to load cockpit overview.")),
      );
      const boardRes = await fetchBoardMessages({
        environmentId: envId,
        input: {
          workspaceId,
          ...(projectId ? { projectId } : {}),
          limit: 200,
        },
      });
      if (boardRes._tag === "Success") {
        setBoardMessages(boardRes.value.messages);
      }
    }

    if (queueRes._tag === "Success") {
      setReviewQueue(queueRes.value);
    }
    if (digestsRes._tag === "Success") {
      setDigests(digestsRes.value);
    }
    if (membersRes._tag === "Success") {
      setMembers(membersRes.value.members);
    }
    setLoadingData(false);
  };

  const hydrateHubStatus = useEffectEvent((envId: EnvironmentId, cancelled: () => boolean) => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const oauthAccessToken = hashParams.get("access_token");
    const oauthRefreshToken = hashParams.get("refresh_token");
    const oauthHubUrl = hashParams.get("hub_url");

    const initPromise =
      oauthAccessToken && oauthRefreshToken && oauthHubUrl
        ? (() => {
            window.history.replaceState(
              null,
              "",
              window.location.pathname + window.location.search,
            );
            return connectTokens({
              environmentId: envId,
              input: {
                hubUrl: oauthHubUrl,
                accessToken: oauthAccessToken,
                refreshToken: oauthRefreshToken,
              },
            });
          })()
        : fetchStatus({ environmentId: envId, input: {} });

    void initPromise.then((res) => {
      if (cancelled()) return;
      setStatusLoadedForEnv(envId);
      if (res._tag === "Success") {
        setStatus(res.value);
        const firstWorkspaceId = res.value.me?.workspaces[0]?.id ?? "";
        setSelectedWorkspaceId(firstWorkspaceId);
        if (res.value.connected && firstWorkspaceId) {
          void loadCockpitData(envId, firstWorkspaceId, "");
        } else if (res.value.connected && !firstWorkspaceId) {
          setActiveTab("setup");
        }
      } else {
        setErrorMessage(formatCockpitCommandError(res, gt("Failed to inspect Team Hub status.")));
      }
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Hydrate Team Hub connection state (and consume one-click OAuth callback hash) from external server RPC when active environment changes.
  useEffect(() => {
    if (!primaryEnvironmentId) return;
    let cancelled = false;
    hydrateHubStatus(primaryEnvironmentId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [primaryEnvironmentId]);

  const loadingStatus =
    primaryEnvironmentId !== null && statusLoadedForEnv !== primaryEnvironmentId;

  const handleOpenChangeRequest = (cr: ChangeRequestAudit) => {
    setSelectedChangeRequestId(cr.id);
    setFallbackChangeRequest(cr);
  };

  const handleCloseChangeRequest = () => {
    setSelectedChangeRequestId(null);
    setFallbackChangeRequest(null);
  };

  const handleConnected = (nextStatus: TeamHubStatusResult) => {
    setStatus(nextStatus);
    const firstWorkspaceId = nextStatus.me?.workspaces[0]?.id ?? "";
    setSelectedWorkspaceId(firstWorkspaceId);
    setSelectedProjectId("");
    setPendingMentionHandle(null);
    setPendingFilterHandle(null);
    handleCloseChangeRequest();
    if (primaryEnvironmentId && nextStatus.connected && firstWorkspaceId) {
      setActiveTab("overview");
      void loadCockpitData(primaryEnvironmentId, firstWorkspaceId, "");
    } else if (nextStatus.connected && !firstWorkspaceId) {
      setActiveTab("setup");
    }
  };

  const handleDisconnect = async () => {
    if (!primaryEnvironmentId) return;
    await disconnectHub({ environmentId: primaryEnvironmentId, input: {} });
    setStatus({ connected: false, hubUrl: status?.hubUrl ?? null, me: null });
    setOverview(null);
    setReviewQueue(null);
    setDigests(null);
    setMemory(null);
    setMembers([]);
    setBoardMessages([]);
    setReleases([]);
    setPendingMentionHandle(null);
    setPendingFilterHandle(null);
    handleCloseChangeRequest();
  };

  const handleMoveStage = async (workItemId: string, nextStage: string) => {
    if (!primaryEnvironmentId) return;
    const res = await updateWorkItem({
      environmentId: primaryEnvironmentId,
      input: { workItemId, stage: nextStage },
    });
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Stage updated"), type: "success" });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Unable to move work item stage.")),
        type: "error",
      });
    }
  };

  const handleApproveGate = async (workItemId: string, gateKey: string) => {
    if (!primaryEnvironmentId) return;
    const res = await approveGate({
      environmentId: primaryEnvironmentId,
      input: {
        targetType: "work_item",
        targetId: workItemId,
        gateKey,
        status: "approved",
      },
    });
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Gate approved"), type: "success" });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to approve gate.")),
        type: "error",
      });
    }
  };

  const handleLinkChangeRequest = async (changeRequestId: string, workItemId: string | null) => {
    if (!primaryEnvironmentId) return;
    const res = await linkChangeRequest({
      environmentId: primaryEnvironmentId,
      input: { changeRequestId, workItemId },
    });
    if (res._tag === "Success") {
      toastManager.add({
        title: workItemId ? gt("Pull request linked to work item") : gt("Pull request unlinked"),
        type: "success",
      });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to link pull request.")),
        type: "error",
      });
    }
  };

  const openCreateDialog = () => {
    const today = todayLocalIsoDate();
    setNewPlannedStartAt(today);
    setNewDueAt(addDaysIsoDate(today, 5));
    setCreateDialogOpen(true);
  };

  const handleUpdateSchedule = async (
    workItemId: string,
    plannedStartAt: string,
    dueAt: string,
  ) => {
    if (!primaryEnvironmentId) return;
    const res = await updateWorkItem({
      environmentId: primaryEnvironmentId,
      input: {
        workItemId,
        attributes: buildLifecycleAttributesPatch({ plannedStartAt, dueAt }),
      },
    });
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Schedule updated"), type: "success" });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update schedule.")),
        type: "error",
      });
    }
  };

  const handleCreateWorkItem = async (mode: "create" | "prd" = "create") => {
    if (!primaryEnvironmentId || !selectedProjectId || !newTitle.trim()) return;
    setCreatingMode(mode);
    const decodedAssignee = decodeAssigneeValue(newAssignee);
    const res = await createWorkItem({
      environmentId: primaryEnvironmentId,
      input: {
        projectId: selectedProjectId,
        title: newTitle.trim(),
        itemType: newType,
        priority: newPriority,
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        ...(newSpec.trim() ? { specMarkdown: newSpec.trim() } : {}),
        attributes: buildLifecycleAttributesPatch({
          plannedStartAt: newPlannedStartAt.trim() || null,
          dueAt: newDueAt.trim() || null,
          designTier: newDesignTier,
          githubLabels: standardGitHubLabels(newType, newPriority),
        }),
      },
    });
    setCreatingMode(null);
    if (res._tag === "Success") {
      const createdWorkItem = res.value.workItem;
      const today = todayLocalIsoDate();
      setCreateDialogOpen(false);
      setNewTitle("");
      setNewSpec("");
      setNewDesignTier("medium");
      setNewAssignee("unassigned");
      setNewPlannedStartAt(today);
      setNewDueAt(addDaysIsoDate(today, 5));
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);

      if (mode === "prd") {
        const matchedLocalProject = pickMatchingWorkspaceProject(
          localProjects,
          overview?.repos ?? [],
        );
        if (matchedLocalProject) {
          const prompt = buildPrdGenerationPrompt({
            workItem: createdWorkItem,
            project: overview?.project ?? null,
            memory,
          });
          await handleNewThread(
            scopeProjectRef(matchedLocalProject.environmentId, matchedLocalProject.id),
            { prompt },
          );
          return;
        }
        toastManager.add({
          title: gt("Work item created. Add a local repository to launch AI PRD threads."),
          type: "info",
        });
        setSelectedWorkItemId(createdWorkItem.id);
        return;
      }

      toastManager.add({ title: gt("Work item created"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to create work item.")),
        type: "error",
      });
    }
  };

  const handleGenerateDigest = async () => {
    if (!primaryEnvironmentId || !selectedWorkspaceId) return;
    setGeneratingDigest(true);
    const res = await generateDigest({
      environmentId: primaryEnvironmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        projectId: selectedProjectId || null,
        triggerType: "manual",
      },
    });
    setGeneratingDigest(false);
    if (res._tag === "Success") {
      if (res.value.updatedMemory) {
        setMemory(res.value.updatedMemory);
      }
      toastManager.add({ title: gt("Cockpit digest generated"), type: "success" });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to generate digest.")),
        type: "error",
      });
    }
  };

  const handleSaveDirectives = async (nextDirectives: ReadonlyArray<ProjectDirective>) => {
    if (!primaryEnvironmentId || !selectedProjectId) return;
    setSavingDirectives(true);
    const res = await updateDirectives({
      environmentId: primaryEnvironmentId,
      input: {
        projectId: selectedProjectId,
        directives: [...nextDirectives],
      },
    });
    setSavingDirectives(false);
    if (res._tag === "Success") {
      setMemory(res.value.memory);
      toastManager.add({ title: gt("Project directives saved"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to save directives.")),
        type: "error",
      });
    }
  };

  const handleAddDirective = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const current = memory?.directives ?? [];
    const next: ProjectDirective = {
      id: `dir_${Date.now().toString(36)}`,
      text: trimmed,
      createdBy: status?.me?.user.displayName ?? "owner",
      createdAt: new Date().toISOString(),
      active: true,
    };
    void handleSaveDirectives([...current, next]);
  };

  const handleToggleDirective = (directiveId: string) => {
    const current = memory?.directives ?? [];
    const next = current.map((d) => (d.id === directiveId ? { ...d, active: !d.active } : d));
    void handleSaveDirectives(next);
  };

  const handlePostBoardMessage = async (input: {
    readonly body: string;
    readonly workItemId?: string | null;
    readonly workItemCode?: string | null;
  }): Promise<boolean> => {
    const trimmed = input.body.trim();
    if (!primaryEnvironmentId || !selectedWorkspaceId || !trimmed) return false;
    setPostingBoardMessage(true);
    const res = await postBoardMessage({
      environmentId: primaryEnvironmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        projectId: selectedProjectId || null,
        body: trimmed,
        ...(input.workItemId !== undefined ? { workItemId: input.workItemId } : {}),
        ...(input.workItemCode !== undefined ? { workItemCode: input.workItemCode } : {}),
      },
    });
    setPostingBoardMessage(false);
    if (res._tag === "Success") {
      const created = res.value.message;
      setBoardMessages((prev) =>
        prev.some((msg) => msg.id === created.id) ? prev : [...prev, created],
      );
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
      return true;
    }
    toastManager.add({
      title: formatCockpitCommandError(res, gt("Failed to post board message.")),
      type: "error",
    });
    return false;
  };

  const handleNavigateBoard = (opts?: {
    readonly mentionHandle?: string;
    readonly filterHandle?: string;
  }) => {
    setPendingMentionHandle(opts?.mentionHandle ?? null);
    setPendingFilterHandle(opts?.filterHandle ?? null);
    setActiveTab("board");
  };

  const handleMentionMember = (handle: string) => {
    handleNavigateBoard({ mentionHandle: handle });
  };

  const handleFilterBoardByMember = (handle: string) => {
    handleNavigateBoard({ filterHandle: handle });
  };

  const handleConsumeInitialDraft = () => {
    setPendingMentionHandle(null);
    setPendingFilterHandle(null);
  };

  const handleNavigateDelivery = (subView: DeliverySubTab) => {
    setDeliverySubTab(subView);
    setActiveTab("delivery");
  };

  const activeProject = overview?.project ?? null;
  const stages = activeProject?.workflowConfig.stages ?? [];
  const gates = activeProject?.workflowConfig.gates ?? [];
  const allCards = overview?.cards ?? [];
  const filteredCards = allCards.filter((card) => matchesBoardFilter(card, boardFilter));
  const blockedCardCount = allCards.filter((card) => matchesBoardFilter(card, "blocked")).length;
  const hasPrCardCount = allCards.filter((card) => matchesBoardFilter(card, "has_pr")).length;
  const reviewItems = reviewQueue?.items ?? [];
  const roster = deriveTeamRoster({
    members,
    cards: allCards,
    reviewItems,
    boardMessages,
    currentUserId: status?.me?.user.id ?? null,
    resolve: resolveMessage,
  });
  const deliveryOpenCount = overview
    ? overview.metrics.activeWorkItems + overview.metrics.orphanChangeRequests
    : reviewItems.length;

  const selectedWorkspace =
    status?.me?.workspaces.find((ws) => ws.id === selectedWorkspaceId) ?? null;
  const selectedProject =
    overview?.projects.find((proj) => proj.id === selectedProjectId) ?? activeProject;

  const selectedChangeRequest: ChangeRequestAudit | null = (() => {
    if (!selectedChangeRequestId) return null;
    const fromQueue = reviewItems.find((cr) => cr.id === selectedChangeRequestId);
    if (fromQueue) return fromQueue;
    for (const card of allCards) {
      const fromCard = card.changeRequests.find((cr) => cr.id === selectedChangeRequestId);
      if (fromCard) return fromCard;
    }
    return fallbackChangeRequest?.id === selectedChangeRequestId ? fallbackChangeRequest : null;
  })();

  const handleLiveHubEvent = (_event: HubWsEvent) => {
    setLiveRefreshCount((count) => count + 1);
    if (primaryEnvironmentId && selectedWorkspaceId) {
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    }
  };

  const isConnected = Boolean(primaryEnvironmentId && !loadingStatus && status?.connected);
  const isPullRequestPaneOpen = Boolean(
    isConnected && primaryEnvironmentId && selectedChangeRequest,
  );
  const isWideDeliveryView =
    activeTab === "delivery" &&
    (deliverySubTab === "gantt" || (deliverySubTab === "kanban" && boardView === "board"));
  const matchedIntakeProject = pickMatchingWorkspaceProject(localProjects, overview?.repos ?? []);
  const memberSelectOptions = members.map((member) => ({
    value: `human:${member.userId}`,
    handle: resolveMemberHandle(member, roster),
    displayName: member.displayName,
  }));
  const selectedNewAssigneeOption = newAssignee.startsWith("human:")
    ? (memberSelectOptions.find((entry) => entry.value === newAssignee) ?? null)
    : null;
  const hasActiveBlockers = Boolean(
    overview &&
    (overview.metrics.blockedWorkItems > 0 || overview.metrics.botBlockedChangeRequests > 0),
  );

  return (
    <SidebarInset className="flex h-dvh flex-col overflow-hidden">
      {primaryEnvironmentId && status?.connected && selectedWorkspaceId ? (
        <CockpitLiveEventsBridge
          environmentId={primaryEnvironmentId}
          workspaceId={selectedWorkspaceId}
          onEvent={handleLiveHubEvent}
        />
      ) : null}

      <WorkspacePageHeader
        className="border-b border-border/50 bg-background"
        electron={isElectron}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <WorkspaceBreadcrumb ariaLabel={gt("Team Cockpit")}>
            <WorkspaceBreadcrumbItem current>
              <h1 className="truncate font-medium text-foreground">
                <T>Team Cockpit</T>
              </h1>
            </WorkspaceBreadcrumbItem>
          </WorkspaceBreadcrumb>

          {isConnected && status?.me ? (
            <div className="flex min-w-0 items-center gap-2 [-webkit-app-region:no-drag]">
              {status.me.workspaces.length > 0 ? (
                <div className="max-w-44">
                  <Select
                    value={selectedWorkspaceId}
                    onValueChange={(nextWs) => {
                      if (!nextWs) return;
                      setSelectedWorkspaceId(nextWs);
                      setSelectedProjectId("");
                      setMembers([]);
                      setBoardMessages([]);
                      setReleases([]);
                      setPendingMentionHandle(null);
                      setPendingFilterHandle(null);
                      handleCloseChangeRequest();
                      if (primaryEnvironmentId) {
                        void loadCockpitData(primaryEnvironmentId, nextWs, "");
                      }
                    }}
                  >
                    <SelectTrigger aria-label={gt("Workspace")} size="compact">
                      <SelectValue>{selectedWorkspace?.name ?? gt("Workspace")}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {status.me.workspaces.map((ws) => (
                        <SelectItem key={ws.id} value={ws.id}>
                          {ws.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}

              {overview && overview.projects.length > 0 ? (
                <div className="max-w-52">
                  <Select
                    value={selectedProjectId}
                    onValueChange={(nextProj) => {
                      if (!nextProj) return;
                      setSelectedProjectId(nextProj);
                      setReleases([]);
                      if (primaryEnvironmentId) {
                        void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, nextProj);
                      }
                    }}
                  >
                    <SelectTrigger aria-label={gt("Project")} size="compact">
                      <SelectValue>
                        {selectedProject
                          ? `${selectedProject.key} · ${selectedProject.name}`
                          : gt("Project")}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      {overview.projects.map((proj) => (
                        <SelectItem key={proj.id} value={proj.id}>
                          {proj.key} · {proj.name}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        {isConnected && status?.me ? (
          <div className="ml-auto flex shrink-0 items-center gap-1.5 [-webkit-app-region:no-drag]">
            <span className="mr-1 inline-flex shrink-0 items-center gap-1.5 text-2xs font-medium text-muted-foreground">
              <CockpitStatusDot ring tone="success" />
              <T>Live</T>
            </span>

            <Button
              aria-label={gt("Refresh Cockpit")}
              disabled={loadingData}
              size="icon-xs"
              variant="ghost-muted"
              onClick={() => {
                if (primaryEnvironmentId) {
                  void loadCockpitData(
                    primaryEnvironmentId,
                    selectedWorkspaceId,
                    selectedProjectId,
                  );
                }
              }}
            >
              <RefreshIcon refreshing={loadingData} />
            </Button>

            <Button
              aria-label={gt("Workspace Setup")}
              aria-pressed={activeTab === "setup"}
              data-pressed={activeTab === "setup" ? "" : undefined}
              size="icon-xs"
              title={gt("Workspace Setup")}
              variant="ghost-muted"
              onClick={() => setActiveTab(activeTab === "setup" ? "overview" : "setup")}
            >
              <SlidersHorizontalIcon />
            </Button>

            <Button
              aria-label={gt("Disconnect Team Hub")}
              size="icon-xs"
              title={gt("Disconnect Team Hub")}
              variant="ghost-muted"
              onClick={() => void handleDisconnect()}
            >
              <LogOutIcon />
            </Button>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {isConnected ? (
        <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border/50 bg-background px-5 sm:px-6">
          <CockpitUnderlineTabs label={gt("Team Cockpit views")}>
            <CockpitUnderlineTab
              active={activeTab === "overview"}
              onClick={() => setActiveTab("overview")}
            >
              <T context="team cockpit overview tab">Overview</T>
            </CockpitUnderlineTab>
            <CockpitUnderlineTab
              active={activeTab === "board"}
              count={boardMessages.length}
              onClick={() => setActiveTab("board")}
            >
              <T context="team collaboration message board tab">Board</T>
            </CockpitUnderlineTab>
            <CockpitUnderlineTab
              active={activeTab === "members"}
              count={roster.length}
              onClick={() => setActiveTab("members")}
            >
              <T>Members</T>
            </CockpitUnderlineTab>
            <CockpitUnderlineTab
              active={activeTab === "delivery"}
              count={deliveryOpenCount > 0 ? deliveryOpenCount : undefined}
              onClick={() => setActiveTab("delivery")}
            >
              <T>Delivery</T>
            </CockpitUnderlineTab>
            <CockpitUnderlineTab
              active={activeTab === "memory"}
              onClick={() => setActiveTab("memory")}
            >
              <T context="team cockpit project memory tab">Memory</T>
            </CockpitUnderlineTab>
          </CockpitUnderlineTabs>

          {hasActiveBlockers && overview ? (
            <div className="flex shrink-0 items-center gap-2 py-1.5">
              {overview.metrics.blockedWorkItems > 0 ? (
                <CockpitStatPill
                  active={
                    activeTab === "delivery" &&
                    deliverySubTab === "kanban" &&
                    boardFilter === "blocked"
                  }
                  label={<T>Blocked</T>}
                  tone="error"
                  value={overview.metrics.blockedWorkItems}
                  onClick={() => {
                    setActiveTab("delivery");
                    setDeliverySubTab("kanban");
                    setBoardFilter("blocked");
                  }}
                />
              ) : null}
              {overview.metrics.botBlockedChangeRequests > 0 ? (
                <CockpitStatPill
                  active={
                    activeTab === "delivery" &&
                    deliverySubTab === "triage" &&
                    triageFilter === "blocked"
                  }
                  label={<T>Bot Blocked</T>}
                  tone="error"
                  value={overview.metrics.botBlockedChangeRequests}
                  onClick={() => {
                    setActiveTab("delivery");
                    setDeliverySubTab("triage");
                    setTriageFilter("blocked");
                  }}
                />
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto">
          {!primaryEnvironmentId ? (
            <WorkspacePageContainer width="readable">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <ServerIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>No server environment connected</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>Connect to a U3 Code server environment first to use Team Cockpit.</T>
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            </WorkspacePageContainer>
          ) : loadingStatus ? (
            <WorkspacePageContainer width="readable">
              <p className="py-8 text-center text-sm text-muted-foreground">
                <T>Checking Team Hub connection...</T>
              </p>
            </WorkspacePageContainer>
          ) : !status?.connected ? (
            <WorkspacePageContainer width="readable">
              <CockpitConnectCard
                environmentId={primaryEnvironmentId}
                initialHubUrl={status?.hubUrl}
                onConnected={handleConnected}
              />
            </WorkspacePageContainer>
          ) : (
            <WorkspacePageContainer
              className={
                isPullRequestPaneOpen
                  ? "max-w-none px-5 py-5 sm:px-5"
                  : cn("py-6 pb-12", isWideDeliveryView && "max-w-[1600px]")
              }
              width={isWideDeliveryView ? "expanded" : "readable"}
            >
              {errorMessage ? (
                <CockpitInlineAlert tone="error">{errorMessage}</CockpitInlineAlert>
              ) : null}

              {activeTab === "overview" ? (
                <CockpitOverviewTab
                  boardMessages={boardMessages}
                  overview={overview}
                  releases={releases}
                  reviewItems={reviewItems}
                  roster={roster}
                  onNavigateBoard={handleNavigateBoard}
                  onNavigateDelivery={handleNavigateDelivery}
                  onNavigateMembers={() => setActiveTab("members")}
                  onOpenChangeRequest={handleOpenChangeRequest}
                  {...(selectedProjectId ? { onOpenIntake: openCreateDialog } : {})}
                  onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                />
              ) : null}

              {activeTab === "board" ? (
                <CockpitBoardTab
                  cards={allCards}
                  initialFilterHandle={pendingFilterHandle}
                  initialMentionHandle={pendingMentionHandle}
                  messages={boardMessages}
                  posting={postingBoardMessage}
                  reviewItems={reviewItems}
                  roster={roster}
                  onConsumeInitialDraft={handleConsumeInitialDraft}
                  onOpenChangeRequest={handleOpenChangeRequest}
                  onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                  onPostMessage={handlePostBoardMessage}
                />
              ) : null}

              {activeTab === "members" ? (
                <CockpitMembersTab
                  roster={roster}
                  onFilterBoardByMember={handleFilterBoardByMember}
                  onMentionMember={handleMentionMember}
                  onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                />
              ) : null}

              {activeTab === "delivery" ? (
                <div className="space-y-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <ToggleGroup
                      aria-label={gt("Delivery views")}
                      size="segmented"
                      value={[deliverySubTab]}
                      variant="segmented"
                      onValueChange={(next) => {
                        const value = next[0];
                        if (
                          value === "kanban" ||
                          value === "gantt" ||
                          value === "triage" ||
                          value === "releases"
                        ) {
                          setDeliverySubTab(value);
                        }
                      }}
                    >
                      <Toggle value="kanban">
                        <KanbanIcon />
                        <T>Kanban</T>
                        {allCards.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {allCards.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="gantt">
                        <GanttChartIcon />
                        <T>Gantt</T>
                      </Toggle>
                      <Toggle value="triage">
                        <PullRequestGlyph.pullRequest />
                        <T>Review Triage</T>
                        {reviewItems.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {reviewItems.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="releases">
                        <PackageCheckIcon />
                        <T>Releases</T>
                      </Toggle>
                    </ToggleGroup>

                    {(deliverySubTab === "kanban" || deliverySubTab === "gantt") &&
                    activeProject ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <span>{activeProject.workflowConfig.preset}</span>
                        <span aria-hidden className="opacity-40">
                          ·
                        </span>
                        <span className="tabular-nums">
                          <T>
                            <Var>{overview?.repos.length ?? 0}</Var> repos
                          </T>
                        </span>
                        {deliverySubTab === "gantt" && selectedProjectId ? (
                          <Button size="xs" variant="default" onClick={openCreateDialog}>
                            <PlusIcon />
                            <T>New Item</T>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {deliverySubTab === "kanban" ? (
                    stages.length === 0 ? (
                      <CockpitSurface variant="grouped">
                        <Empty size="compact">
                          <EmptyMedia variant="icon">
                            <KanbanIcon />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>
                              <T>No project configured yet</T>
                            </EmptyTitle>
                            <EmptyDescription>
                              <T>
                                Create or select a project in Setup to track cross-repository work
                                items and workflow gates.
                              </T>
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setActiveTab("setup")}
                            >
                              <SlidersHorizontalIcon />
                              <T>Open Setup</T>
                            </Button>
                          </EmptyContent>
                        </Empty>
                      </CockpitSurface>
                    ) : (
                      <div className="space-y-5">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <ToggleGroup
                            size="segmented"
                            value={[boardFilter]}
                            variant="segmented"
                            onValueChange={(next) => {
                              const value = next[0];
                              if (value === "all" || value === "blocked" || value === "has_pr") {
                                setBoardFilter(value);
                              }
                            }}
                          >
                            <Toggle value="all">
                              <T>All</T>
                              {allCards.length > 0 ? (
                                <span className="font-mono text-2xs tabular-nums opacity-70">
                                  {allCards.length}
                                </span>
                              ) : null}
                            </Toggle>
                            <Toggle value="blocked">
                              <T>Blocked</T>
                              {blockedCardCount > 0 ? (
                                <span className="font-mono text-2xs tabular-nums opacity-70">
                                  {blockedCardCount}
                                </span>
                              ) : null}
                            </Toggle>
                            <Toggle value="has_pr">
                              <T>Has PR</T>
                              {hasPrCardCount > 0 ? (
                                <span className="font-mono text-2xs tabular-nums opacity-70">
                                  {hasPrCardCount}
                                </span>
                              ) : null}
                            </Toggle>
                          </ToggleGroup>

                          <div className="flex items-center gap-2">
                            <ToggleGroup
                              size="segmented"
                              value={[boardView]}
                              variant="segmented"
                              onValueChange={(next) => {
                                const value = next[0];
                                if (value === "board" || value === "list") setBoardView(value);
                              }}
                            >
                              <Toggle value="board">
                                <KanbanIcon />
                                <T>Board</T>
                              </Toggle>
                              <Toggle value="list">
                                <ListIcon />
                                <T>List</T>
                              </Toggle>
                            </ToggleGroup>

                            {selectedProjectId ? (
                              <Button size="xs" variant="default" onClick={openCreateDialog}>
                                <PlusIcon />
                                <T>New Item</T>
                              </Button>
                            ) : null}
                          </div>
                        </div>

                        {filteredCards.length === 0 && boardFilter !== "all" ? (
                          <CockpitSurface variant="grouped">
                            <Empty size="compact">
                              <EmptyMedia variant="icon">
                                <KanbanIcon />
                              </EmptyMedia>
                              <EmptyHeader>
                                <EmptyTitle>
                                  <T>No matching work items</T>
                                </EmptyTitle>
                                <EmptyDescription>
                                  <T>
                                    No work items match the active filter. Reset the filter to
                                    inspect all stages.
                                  </T>
                                </EmptyDescription>
                              </EmptyHeader>
                              <EmptyContent>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => setBoardFilter("all")}
                                >
                                  <T>Show all items</T>
                                </Button>
                              </EmptyContent>
                            </Empty>
                          </CockpitSurface>
                        ) : boardView === "board" ? (
                          <div className="flex items-start gap-4 overflow-x-auto pb-4">
                            {stages.map((stage) => {
                              const stageCards = filteredCards.filter(
                                (card) => card.workItem.stage === stage.id,
                              );
                              return (
                                <CockpitSurface
                                  key={stage.id}
                                  className="flex w-80 shrink-0 flex-col gap-3"
                                  padding="sm"
                                  variant="subtle"
                                >
                                  <CockpitSectionHeader
                                    count={stageCards.length}
                                    title={stage.label}
                                  />

                                  <div className="flex flex-col gap-3">
                                    {stageCards.map((card) => (
                                      <WorkItemCardView
                                        key={card.workItem.id}
                                        card={card}
                                        gates={gates}
                                        roster={roster}
                                        selectedChangeRequestId={selectedChangeRequestId}
                                        stages={stages}
                                        onApproveGate={(gateKey) =>
                                          void handleApproveGate(card.workItem.id, gateKey)
                                        }
                                        onMoveStage={(nextStage) =>
                                          void handleMoveStage(card.workItem.id, nextStage)
                                        }
                                        onOpenChangeRequest={handleOpenChangeRequest}
                                        onOpenDetail={() => setSelectedWorkItemId(card.workItem.id)}
                                      />
                                    ))}
                                    {stageCards.length === 0 ? (
                                      <p className="py-8 text-center text-xs text-muted-foreground/60">
                                        <T>No items</T>
                                      </p>
                                    ) : null}
                                  </div>
                                </CockpitSurface>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="space-y-6 pb-4">
                            {stages.map((stage) => {
                              const stageCards = filteredCards.filter(
                                (card) => card.workItem.stage === stage.id,
                              );
                              if (stageCards.length === 0 && boardFilter !== "all") return null;
                              return (
                                <section key={stage.id} className="space-y-2">
                                  <CockpitSectionHeader
                                    count={stageCards.length}
                                    title={stage.label}
                                  />
                                  {stageCards.length === 0 ? (
                                    <CockpitSurface padding="sm" variant="subtle">
                                      <p className="text-xs text-muted-foreground/75">
                                        <T>No items in this stage</T>
                                      </p>
                                    </CockpitSurface>
                                  ) : (
                                    <CockpitSurface divided variant="grouped">
                                      {stageCards.map((card) => (
                                        <WorkItemListRowView
                                          key={card.workItem.id}
                                          card={card}
                                          gates={gates}
                                          roster={roster}
                                          selectedChangeRequestId={selectedChangeRequestId}
                                          stages={stages}
                                          onApproveGate={(gateKey) =>
                                            void handleApproveGate(card.workItem.id, gateKey)
                                          }
                                          onMoveStage={(nextStage) =>
                                            void handleMoveStage(card.workItem.id, nextStage)
                                          }
                                          onOpenChangeRequest={handleOpenChangeRequest}
                                          onOpenDetail={() =>
                                            setSelectedWorkItemId(card.workItem.id)
                                          }
                                        />
                                      ))}
                                    </CockpitSurface>
                                  )}
                                </section>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )
                  ) : null}

                  {deliverySubTab === "gantt" ? (
                    <CockpitGanttView
                      cards={allCards}
                      releases={releases}
                      roster={roster}
                      stages={stages}
                      {...(selectedProjectId ? { onCreateItem: openCreateDialog } : {})}
                      onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                      onUpdateSchedule={handleUpdateSchedule}
                    />
                  ) : null}

                  {deliverySubTab === "triage" ? (
                    <CockpitTriageTab
                      cards={allCards}
                      filter={triageFilter}
                      reviewQueue={reviewQueue}
                      selectedChangeRequestId={selectedChangeRequestId}
                      onFilterChange={setTriageFilter}
                      onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                      onSelectChangeRequest={handleOpenChangeRequest}
                    />
                  ) : null}

                  {deliverySubTab === "releases" ? (
                    <CockpitReleasesTab
                      cards={allCards}
                      environmentId={primaryEnvironmentId}
                      refreshSignal={liveRefreshCount}
                      repos={overview?.repos ?? []}
                      selectedProjectId={selectedProjectId}
                      onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                    />
                  ) : null}
                </div>
              ) : null}

              {activeTab === "memory" ? (
                <CockpitMemoryTab
                  digests={digests}
                  generatingDigest={generatingDigest}
                  memory={memory}
                  savingDirectives={savingDirectives}
                  selectedProjectId={selectedProjectId}
                  onAddDirective={handleAddDirective}
                  onGenerateDigest={() => void handleGenerateDigest()}
                  onToggleDirective={handleToggleDirective}
                />
              ) : null}

              {activeTab === "setup" ? (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <SlidersHorizontalIcon aria-hidden className="size-4 text-muted-foreground" />
                      <T>Workspace Setup</T>
                    </div>
                    <Button
                      size="xs"
                      variant="ghost-muted"
                      onClick={() => setActiveTab("overview")}
                    >
                      <ArrowLeftIcon />
                      <T>Back to Overview</T>
                    </Button>
                  </div>
                  <CockpitSettingsTab
                    environmentId={primaryEnvironmentId}
                    overview={overview}
                    selectedProjectId={selectedProjectId}
                    selectedWorkspaceId={selectedWorkspaceId}
                    status={status}
                    onRefreshAll={(nextWsId, nextProjId) => {
                      void fetchStatus({ environmentId: primaryEnvironmentId, input: {} }).then(
                        (statusRes) => {
                          if (statusRes._tag === "Success") {
                            setStatus(statusRes.value);
                            const wsId =
                              nextWsId ??
                              selectedWorkspaceId ??
                              statusRes.value.me?.workspaces[0]?.id ??
                              "";
                            const projId = nextProjId ?? selectedProjectId;
                            if (wsId) setSelectedWorkspaceId(wsId);
                            if (nextProjId !== undefined) setSelectedProjectId(projId);
                            if (wsId) {
                              void loadCockpitData(primaryEnvironmentId, wsId, projId);
                            }
                          }
                        },
                      );
                    }}
                  />
                </div>
              ) : null}
            </WorkspacePageContainer>
          )}
        </div>

        {isPullRequestPaneOpen && primaryEnvironmentId && selectedChangeRequest ? (
          <CockpitPullRequestPane
            cards={allCards}
            changeRequest={selectedChangeRequest}
            environmentId={primaryEnvironmentId}
            memory={memory}
            project={activeProject}
            repos={overview?.repos ?? []}
            onClose={handleCloseChangeRequest}
            onLinkChangeRequest={(crId, wiId) => void handleLinkChangeRequest(crId, wiId)}
            onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
          />
        ) : null}
      </div>

      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogPopup className="max-w-xl">
          <DialogHeader>
            <DialogTitle>
              <T>New Work Item</T>
            </DialogTitle>
            <DialogDescription>
              <T>
                Capture requirement scope, design tier, owner, and timeline, or launch an AI PRD
                thread right away.
              </T>
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-3.5">
              <div>
                <CockpitFieldLabel htmlFor="wi-title">
                  <T>Title</T>
                </CockpitFieldLabel>
                <Input
                  id="wi-title"
                  placeholder={gt("e.g. Idempotent settlement outbox")}
                  size="sm"
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && newTitle.trim() && creatingMode === null) {
                      event.preventDefault();
                      void handleCreateWorkItem("create");
                    }
                  }}
                />
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <CockpitFieldLabel htmlFor="wi-type">
                    <T>Type</T>
                  </CockpitFieldLabel>
                  <Select
                    value={newType}
                    onValueChange={(value) => {
                      if (
                        value === "feature" ||
                        value === "refactor" ||
                        value === "bug" ||
                        value === "chore" ||
                        value === "security"
                      ) {
                        setNewType(value);
                      }
                    }}
                  >
                    <SelectTrigger id="wi-type" size="sm">
                      <SelectValue>{workItemTypeLabel(newType, gt)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="feature">{gt("Feature")}</SelectItem>
                      <SelectItem value="refactor">{gt("Refactor")}</SelectItem>
                      <SelectItem value="bug">{gt("Bug")}</SelectItem>
                      <SelectItem value="chore">{gt("Chore")}</SelectItem>
                      <SelectItem value="security">{gt("Security")}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="wi-priority">
                    <T>Priority</T>
                  </CockpitFieldLabel>
                  <Select
                    value={newPriority}
                    onValueChange={(value) => {
                      if (value === "p0" || value === "p1" || value === "p2" || value === "p3") {
                        setNewPriority(value);
                      }
                    }}
                  >
                    <SelectTrigger id="wi-priority" size="sm">
                      <SelectValue>
                        <CockpitPriorityDot priority={newPriority} />
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="p0">
                        <CockpitPriorityDot priority="p0" />
                      </SelectItem>
                      <SelectItem value="p1">
                        <CockpitPriorityDot priority="p1" />
                      </SelectItem>
                      <SelectItem value="p2">
                        <CockpitPriorityDot priority="p2" />
                      </SelectItem>
                      <SelectItem value="p3">
                        <CockpitPriorityDot priority="p3" />
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="wi-design-tier">
                    <T>Design Tier</T>
                  </CockpitFieldLabel>
                  <Select
                    value={newDesignTier}
                    onValueChange={(value) => {
                      if (
                        value === "small" ||
                        value === "medium" ||
                        value === "large" ||
                        value === "cross_repo"
                      ) {
                        setNewDesignTier(value);
                      }
                    }}
                  >
                    <SelectTrigger id="wi-design-tier" size="sm">
                      <SelectValue>{designTierLabel(newDesignTier, gt)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="small">{gt("Small")}</SelectItem>
                      <SelectItem value="medium">{gt("Medium")}</SelectItem>
                      <SelectItem value="large">{gt("Large")}</SelectItem>
                      <SelectItem value="cross_repo">{gt("Cross-repo")}</SelectItem>
                    </SelectPopup>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <CockpitFieldLabel htmlFor="wi-assignee">
                    <T>Assignee</T>
                  </CockpitFieldLabel>
                  <Select
                    value={newAssignee}
                    onValueChange={(value) => {
                      if (value) setNewAssignee(value);
                    }}
                  >
                    <SelectTrigger id="wi-assignee" size="sm">
                      <SelectValue>
                        {newAssignee === "unassigned" ? (
                          <T>Unassigned</T>
                        ) : newAssignee.startsWith("runner:") ? (
                          <span className="inline-flex items-center gap-1.5 truncate">
                            <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                            <span className="truncate font-mono text-xs">
                              @{DEFAULT_AGENT_RUNNER_ID}
                            </span>
                          </span>
                        ) : selectedNewAssigneeOption ? (
                          <span className="truncate font-mono text-xs">
                            @{selectedNewAssigneeOption.handle}
                          </span>
                        ) : (
                          <T>Unassigned</T>
                        )}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectPopup>
                      <SelectItem value="unassigned">{gt("Unassigned")}</SelectItem>
                      {memberSelectOptions.map((member) => (
                        <SelectItem key={member.value} value={member.value}>
                          @{member.handle} · {member.displayName}
                        </SelectItem>
                      ))}
                      <SelectItem value={`runner:${DEFAULT_AGENT_RUNNER_ID}`}>
                        {gt("Coding Agent ({runnerId})", { runnerId: DEFAULT_AGENT_RUNNER_ID })}
                      </SelectItem>
                    </SelectPopup>
                  </Select>
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="wi-start-date">
                    <T>Planned Start</T>
                  </CockpitFieldLabel>
                  <Input
                    id="wi-start-date"
                    size="sm"
                    type="date"
                    value={newPlannedStartAt}
                    onChange={(event) => setNewPlannedStartAt(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="wi-due-date">
                    <T>Due Date</T>
                  </CockpitFieldLabel>
                  <Input
                    id="wi-due-date"
                    size="sm"
                    type="date"
                    value={newDueAt}
                    onChange={(event) => setNewDueAt(event.target.value)}
                  />
                </div>
              </div>

              <div>
                <CockpitFieldLabel htmlFor="wi-spec">
                  <T>Requirement Brief / Problem Statement</T>
                </CockpitFieldLabel>
                <Textarea
                  id="wi-spec"
                  placeholder={gt("Describe user problem, target outcomes, and edge cases")}
                  rows={4}
                  value={newSpec}
                  onChange={(event) => setNewSpec(event.target.value)}
                />
              </div>
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              disabled={creatingMode !== null || !newTitle.trim() || !matchedIntakeProject}
              variant="outline"
              onClick={() => void handleCreateWorkItem("prd")}
            >
              <FileTextIcon />
              {creatingMode === "prd" ? (
                <T>Launching PRD...</T>
              ) : (
                <T>Create &amp; Draft PRD with AI</T>
              )}
            </Button>
            <Button
              disabled={creatingMode !== null || !newTitle.trim()}
              variant="default"
              onClick={() => void handleCreateWorkItem("create")}
            >
              {creatingMode === "create" ? <T>Creating...</T> : <T>Create Item</T>}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {primaryEnvironmentId ? (
        <WorkItemDetailDialog
          environmentId={primaryEnvironmentId}
          gates={gates}
          members={members}
          memory={memory}
          project={activeProject}
          repos={overview?.repos ?? []}
          roster={roster}
          stages={stages}
          workItemId={selectedWorkItemId}
          onClose={() => setSelectedWorkItemId(null)}
          onOpenChangeRequest={handleOpenChangeRequest}
          onUpdated={() => {
            if (primaryEnvironmentId && selectedWorkspaceId) {
              void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
            }
          }}
        />
      ) : null}
    </SidebarInset>
  );
}

function CockpitLiveEventsBridge({
  environmentId,
  workspaceId,
  onEvent,
}: {
  readonly environmentId: EnvironmentId;
  readonly workspaceId: string;
  readonly onEvent: (event: HubWsEvent) => void;
}) {
  const result = useAtomValue(
    teamHubEnvironment.subscribeEvents({ environmentId, input: { workspaceId } }),
  );
  const latestEvent = AsyncResult.isSuccess(result) ? result.value : null;
  const handleEvent = useEffectEvent((event: HubWsEvent) => {
    onEvent(event);
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Forward live Team Hub WebSocket events to refresh the cockpit view.
  useEffect(() => {
    if (!latestEvent) return;
    handleEvent(latestEvent);
  }, [latestEvent]);

  return null;
}

interface WorkItemCardViewProps {
  readonly card: CockpitWorkItemCard;
  readonly roster: ReadonlyArray<CockpitTeamMember>;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly gates: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly beforeStage: string;
    readonly optional?: boolean | undefined;
  }>;
  readonly selectedChangeRequestId: string | null;
  readonly onMoveStage: (nextStage: string) => void;
  readonly onApproveGate: (gateKey: string) => void;
  readonly onOpenDetail: () => void;
  readonly onOpenChangeRequest: (cr: ChangeRequestAudit) => void;
}

function WorkItemCardView({
  card,
  roster,
  stages,
  gates,
  selectedChangeRequestId,
  onMoveStage,
  onApproveGate,
  onOpenDetail,
  onOpenChangeRequest,
}: WorkItemCardViewProps) {
  const gt = useGT();
  const latestGates = resolveLatestGateApprovals(card.gateApprovals);
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const schedule = resolveWorkItemSchedule(card.workItem);
  const assignee = resolveCardAssignee(card, roster);
  const hasPrd = lifecycle.prdStatus !== "none";
  const hasProto = lifecycle.prototypeStatus !== "none" || lifecycle.prototypeUrl !== null;
  const issueNumber = lifecycle.githubIssueNumber;
  const dueDateDisplay = lifecycle.dueAt
    ? formatShortDueDate(lifecycle.dueAt)
    : schedule.isOverdue
      ? formatShortDueDate(schedule.dueDate)
      : null;
  const hasQuietLifecycleCues =
    hasPrd || hasProto || issueNumber !== null || dueDateDisplay !== null;

  const currentIdx = stages.findIndex((s) => s.id === card.workItem.stage);
  const nextStage = currentIdx >= 0 ? stages[currentIdx + 1] : undefined;
  const pendingGatesForNext = nextStage
    ? gates.filter(
        (g) =>
          g.beforeStage === nextStage.id &&
          !g.optional &&
          latestGates.get(g.key)?.status !== "approved",
      )
    : [];
  const rejectedGates = gates.filter((g) => latestGates.get(g.key)?.status === "rejected");
  const acPercent =
    card.checklistTotalCount > 0
      ? Math.round((card.checklistVerifiedCount / card.checklistTotalCount) * 100)
      : 0;

  return (
    <CockpitSurface
      className="space-y-3 transition-colors hover:border-border/90"
      padding="sm"
      variant="card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <CockpitPriorityDot priority={card.workItem.priority} />
          <button
            className="cursor-pointer truncate font-mono text-2xs font-medium text-muted-foreground hover:text-foreground hover:underline"
            type="button"
            onClick={onOpenDetail}
          >
            {card.workItem.code}
          </button>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {card.workItem.health !== "on_track" ? (
            card.workItem.health === "blocked" ? (
              <Badge size="sm" variant="error">
                <T>Blocked</T>
              </Badge>
            ) : (
              <Badge size="sm" variant="warning">
                <T>At Risk</T>
              </Badge>
            )
          ) : null}
          {assignee ? (
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex" />}>
                <CockpitSwarmAvatar
                  displayName={assignee.displayName}
                  handle={assignee.handle}
                  kind={assignee.kind}
                  size="sm"
                />
              </TooltipTrigger>
              <TooltipPopup>@{assignee.handle}</TooltipPopup>
            </Tooltip>
          ) : null}
        </div>
      </div>

      <button
        className="block w-full cursor-pointer text-left text-sm leading-snug font-medium text-foreground underline-offset-2 hover:underline"
        type="button"
        onClick={onOpenDetail}
      >
        {card.workItem.title}
      </button>

      {hasQuietLifecycleCues ? (
        <div className="flex flex-wrap items-center gap-1.5 font-mono text-2xs text-muted-foreground">
          {hasPrd ? (
            <span className="rounded bg-muted/45 px-1.5 py-0.5">
              <T>PRD</T>
            </span>
          ) : null}
          {hasProto ? (
            <span className="rounded bg-muted/45 px-1.5 py-0.5">
              <T>Proto</T>
            </span>
          ) : null}
          {issueNumber !== null ? (
            <span className="rounded bg-muted/45 px-1.5 py-0.5">#{issueNumber}</span>
          ) : null}
          {dueDateDisplay ? (
            <span
              className={cn(
                "tabular-nums",
                schedule.isOverdue
                  ? "rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
                  : "text-muted-foreground",
              )}
            >
              {dueDateDisplay}
            </span>
          ) : null}
        </div>
      ) : null}

      {card.checklistTotalCount > 0 ? (
        <div className="flex items-center gap-2">
          <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                acPercent === 100 ? "bg-success" : "bg-foreground/60",
              )}
              style={{ width: `${acPercent}%` }}
            />
          </div>
          <span className="shrink-0 font-mono text-2xs tabular-nums text-muted-foreground">
            <T>
              AC <Var>{card.checklistVerifiedCount}</Var>/<Var>{card.checklistTotalCount}</Var>
            </T>
          </span>
        </div>
      ) : null}

      {card.changeRequests.length > 0 ? (
        <div className="space-y-1.5">
          {card.changeRequests.map((cr) => {
            const isSelected = cr.id === selectedChangeRequestId;
            return (
              <button
                key={cr.id}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors",
                  isSelected
                    ? "border-border bg-accent/65 text-foreground"
                    : "border-border/50 bg-muted/20 text-foreground hover:border-border/80 hover:bg-accent/40",
                )}
                type="button"
                onClick={() => onOpenChangeRequest(cr)}
              >
                <span className="flex min-w-0 items-center gap-1.5 font-mono text-2xs">
                  <PullRequestGlyph.pullRequest className="size-3 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {cr.repoFullName.split("/").at(-1)}#{cr.number}
                  </span>
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground">
                  <CockpitStatusDot tone={reviewStatusTone(cr.automatedReview.status)} />
                  <span>{reviewStatusLabel(cr.automatedReview.status, gt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      {card.latestPulse ? (
        <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">
          {card.latestPulse.doneSummary}
        </p>
      ) : null}

      {rejectedGates.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {rejectedGates.map((gate) => (
            <Badge key={gate.key} size="sm" variant="error">
              <ShieldAlertIcon />
              <T>
                Rejected: <Var>{gate.label}</Var>
              </T>
            </Badge>
          ))}
        </div>
      ) : null}

      {pendingGatesForNext.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {pendingGatesForNext.map((gate) => (
            <Button
              key={gate.key}
              size="micro"
              variant="warning-outline"
              onClick={() => onApproveGate(gate.key)}
            >
              <ShieldCheckIcon />
              {gate.label}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2.5">
        <Button size="micro" variant="ghost-muted" onClick={onOpenDetail}>
          <T>Details</T>
        </Button>
        {nextStage ? (
          <Button size="micro" variant="outline" onClick={() => onMoveStage(nextStage.id)}>
            <span>{nextStage.label}</span>
            <ArrowRightIcon />
          </Button>
        ) : null}
      </div>
    </CockpitSurface>
  );
}

function WorkItemListRowView({
  card,
  roster,
  stages,
  gates,
  selectedChangeRequestId,
  onMoveStage,
  onApproveGate,
  onOpenDetail,
  onOpenChangeRequest,
}: WorkItemCardViewProps) {
  const latestGates = resolveLatestGateApprovals(card.gateApprovals);
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const schedule = resolveWorkItemSchedule(card.workItem);
  const assignee = resolveCardAssignee(card, roster);
  const hasPrd = lifecycle.prdStatus !== "none";
  const hasProto = lifecycle.prototypeStatus !== "none" || lifecycle.prototypeUrl !== null;
  const issueNumber = lifecycle.githubIssueNumber;
  const dueDateDisplay = lifecycle.dueAt
    ? formatShortDueDate(lifecycle.dueAt)
    : schedule.isOverdue
      ? formatShortDueDate(schedule.dueDate)
      : null;

  const currentIdx = stages.findIndex((s) => s.id === card.workItem.stage);
  const nextStage = currentIdx >= 0 ? stages[currentIdx + 1] : undefined;
  const pendingGatesForNext = nextStage
    ? gates.filter(
        (g) =>
          g.beforeStage === nextStage.id &&
          !g.optional &&
          latestGates.get(g.key)?.status !== "approved",
      )
    : [];

  return (
    <CockpitSurfaceRow
      className="flex flex-wrap items-center justify-between gap-3"
      density="default"
      interactive
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5">
        <CockpitPriorityDot priority={card.workItem.priority} />
        <button
          className="shrink-0 cursor-pointer font-mono text-2xs font-medium text-muted-foreground hover:text-foreground"
          type="button"
          onClick={onOpenDetail}
        >
          {card.workItem.code}
        </button>
        <button
          className="min-w-0 flex-1 cursor-pointer truncate text-left text-sm font-medium text-foreground hover:underline"
          type="button"
          onClick={onOpenDetail}
        >
          {card.workItem.title}
        </button>
        {card.workItem.health !== "on_track" ? (
          card.workItem.health === "blocked" ? (
            <Badge size="sm" variant="error">
              <T>Blocked</T>
            </Badge>
          ) : (
            <Badge size="sm" variant="warning">
              <T>At Risk</T>
            </Badge>
          )
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {hasPrd ? (
          <span className="rounded bg-muted/45 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            <T>PRD</T>
          </span>
        ) : null}
        {hasProto ? (
          <span className="rounded bg-muted/45 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            <T>Proto</T>
          </span>
        ) : null}
        {issueNumber !== null ? (
          <span className="rounded bg-muted/45 px-1.5 py-0.5 font-mono text-2xs text-muted-foreground">
            #{issueNumber}
          </span>
        ) : null}
        {dueDateDisplay ? (
          <span
            className={cn(
              "font-mono text-2xs tabular-nums",
              schedule.isOverdue
                ? "rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive"
                : "text-muted-foreground",
            )}
          >
            {dueDateDisplay}
          </span>
        ) : null}
        {assignee ? (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <CockpitSwarmAvatar
                displayName={assignee.displayName}
                handle={assignee.handle}
                kind={assignee.kind}
                size="sm"
              />
            </TooltipTrigger>
            <TooltipPopup>@{assignee.handle}</TooltipPopup>
          </Tooltip>
        ) : null}
        {card.checklistTotalCount > 0 ? (
          <span className="font-mono text-2xs tabular-nums text-muted-foreground">
            <T>
              AC <Var>{card.checklistVerifiedCount}</Var>/<Var>{card.checklistTotalCount}</Var>
            </T>
          </span>
        ) : null}

        {card.changeRequests.map((cr) => {
          const isSelected = cr.id === selectedChangeRequestId;
          return (
            <button
              key={cr.id}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1.5 rounded-md border px-2 py-0.5 font-mono text-2xs transition-colors",
                isSelected
                  ? "border-border bg-accent/65 text-foreground"
                  : "border-border/60 bg-muted/25 text-muted-foreground hover:border-border hover:text-foreground",
              )}
              type="button"
              onClick={() => onOpenChangeRequest(cr)}
            >
              <CockpitStatusDot tone={reviewStatusTone(cr.automatedReview.status)} />
              <span>
                {cr.repoFullName.split("/").at(-1)}#{cr.number}
              </span>
            </button>
          );
        })}

        {pendingGatesForNext.map((gate) => (
          <Button
            key={gate.key}
            size="micro"
            variant="warning-outline"
            onClick={() => onApproveGate(gate.key)}
          >
            <ShieldCheckIcon />
            {gate.label}
          </Button>
        ))}

        {nextStage ? (
          <Button size="micro" variant="outline" onClick={() => onMoveStage(nextStage.id)}>
            <span>{nextStage.label}</span>
            <ArrowRightIcon />
          </Button>
        ) : null}
      </div>
    </CockpitSurfaceRow>
  );
}
