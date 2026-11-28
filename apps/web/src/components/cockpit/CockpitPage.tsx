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
  STORY_POINT_SCALE,
  buildLifecycleAttributesPatch,
  readWorkItemLifecycle,
  resolveLatestGateApprovals,
  resolveWorkItemSchedule,
  standardGitHubLabels,
  type AgileHorizon,
  type AssigneeType,
  type ChangeRequestAudit,
  type CockpitWorkItemCard,
  type DesignTier,
  type ProjectCycle,
  type ProjectDirective,
  type ProjectMilestone,
  type ReleaseCard,
  type TeamBoardMessage,
  type WorkItemPriority,
  type WorkItemType,
  type WorkflowStage,
  type WorkspaceMember,
} from "@u3code/hub-contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { T, useGT, useLocale, useMessages, Var } from "gt-react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BotIcon,
  FileTextIcon,
  FlagIcon,
  GanttChartIcon,
  KanbanIcon,
  ListIcon,
  LogOutIcon,
  MapIcon,
  PackageCheckIcon,
  PlusIcon,
  RepeatIcon,
  RotateCcwIcon,
  SearchIcon,
  ServerIcon,
  ShieldAlertIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  UserIcon,
  XIcon,
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
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
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
import { CockpitCyclesView } from "./CockpitCyclesView";
import { CockpitGanttView } from "./CockpitGanttView";
import { CockpitMembersTab } from "./CockpitMembersTab";
import { CockpitMemoryTab } from "./CockpitMemoryTab";
import { CockpitOverviewTab } from "./CockpitOverviewTab";
import {
  CockpitArtifactIcon,
  CockpitIllustration,
  CockpitStageArtworkIcon,
} from "./CockpitArtwork";
import {
  CockpitFieldLabel,
  CockpitIconBadge,
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
import { CockpitRoadmapView } from "./CockpitRoadmapView";
import { CockpitSettingsTab, type SetupSection } from "./CockpitSettingsTab";
import { CockpitSwarmAvatar, deriveTeamRoster, type CockpitTeamMember } from "./CockpitSwarmAvatar";
import { CockpitTriageTab } from "./CockpitTriageTab";
import { WorkItemDetailDialog } from "./WorkItemDetailDialog";
import { formatCockpitCommandError } from "./cockpitError";
import { buildPrdGenerationPrompt, pickMatchingWorkspaceProject } from "./workItemPrompt";

type CockpitTab = "overview" | "board" | "members" | "delivery" | "memory" | "setup";
type DeliverySubTab = "cycles" | "roadmap" | "kanban" | "gantt" | "triage" | "releases";
type BoardViewMode = "board" | "list";
type BoardFilter = "all" | "blocked" | "has_pr";
type BoardPriorityFilter = "all" | WorkItemPriority;
type TriageFilter = "all" | "blocked" | "human" | "unlinked";

const DEFAULT_AGENT_RUNNER_ID = "claude-agent";
const AGILE_HORIZONS: ReadonlyArray<AgileHorizon> = ["now", "next", "later"];

function agileHorizonLabel(horizon: AgileHorizon, gt: ReturnType<typeof useGT>): string {
  switch (horizon) {
    case "now":
      return gt("Now", { $context: "agile roadmap horizon" });
    case "next":
      return gt("Next", { $context: "agile roadmap horizon" });
    case "later":
      return gt("Later", { $context: "agile roadmap horizon" });
  }
}

function agileHorizonActiveClass(horizon: AgileHorizon): string {
  switch (horizon) {
    case "now":
      return "bg-primary/15 text-primary shadow-2xs ring-1 ring-inset ring-primary/30";
    case "next":
      return "bg-info/15 text-info-foreground shadow-2xs ring-1 ring-inset ring-info/30";
    case "later":
      return "bg-guest/15 text-guest-foreground shadow-2xs ring-1 ring-inset ring-guest/30";
  }
}

function cycleStatusTone(status: ProjectCycle["status"]): CockpitTone {
  switch (status) {
    case "active":
      return "success";
    case "upcoming":
      return "info";
    case "completed":
      return "neutral";
  }
}

function milestoneStatusTone(status: ProjectMilestone["status"]): CockpitTone {
  switch (status) {
    case "active":
      return "success";
    case "completed":
      return "info";
    case "paused":
      return "warning";
    case "planned":
      return "neutral";
  }
}

function milestoneChipClass(colorTone: ProjectMilestone["colorTone"]): string {
  switch (colorTone) {
    case "success":
      return "border-success/25 bg-success/8 text-success-foreground";
    case "info":
      return "border-info/25 bg-info/8 text-info-foreground";
    case "warning":
      return "border-warning/25 bg-warning/8 text-warning-foreground";
    case "violet":
      return "border-guest/25 bg-guest/10 text-guest-foreground";
    case "primary":
    default:
      return "border-primary/25 bg-primary/8 text-primary";
  }
}

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

function workItemTypeIconClass(itemType: WorkItemType): string {
  switch (itemType) {
    case "feature":
      return "text-primary";
    case "bug":
      return "text-destructive";
    case "security":
      return "text-warning-foreground";
    case "refactor":
      return "text-info-foreground";
    case "chore":
      return "text-muted-foreground";
  }
}

function workflowPresetLabel(presetId: string, gt: ReturnType<typeof useGT>): string {
  switch (presetId) {
    case "full-delivery":
      return gt("Full Delivery");
    case "lean":
      return gt("Lean");
    case "dual-branch-bot-gated":
      return gt("Dual-Branch Bot-Gated");
    default:
      return presetId;
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

function stageCategoryTone(category: WorkflowStage["category"]): CockpitTone {
  switch (category) {
    case "done":
      return "success";
    case "review":
      return "warning";
    case "active":
    case "release":
      return "info";
    case "cancelled":
      return "error";
    case "backlog":
      return "neutral";
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

function matchesDeliveryFilters(
  card: CockpitWorkItemCard,
  params: {
    readonly statusFilter: BoardFilter;
    readonly search: string;
    readonly assigneeFilter: string;
    readonly priorityFilter: BoardPriorityFilter;
    readonly cycleFilter: string;
    readonly milestoneFilter: string;
    readonly currentUserId: string | null;
  },
): boolean {
  if (!matchesBoardFilter(card, params.statusFilter)) {
    return false;
  }

  if (
    params.priorityFilter !== "all" &&
    card.workItem.priority.toLowerCase() !== params.priorityFilter
  ) {
    return false;
  }

  if (params.assigneeFilter === "mine") {
    if (
      params.currentUserId === null ||
      card.workItem.assigneeType !== "human" ||
      card.workItem.assigneeUserId !== params.currentUserId
    ) {
      return false;
    }
  } else if (params.assigneeFilter === "unassigned") {
    if (card.workItem.assigneeType !== "unassigned") {
      return false;
    }
  } else if (params.assigneeFilter.startsWith("human:")) {
    const userId = params.assigneeFilter.slice("human:".length);
    if (card.workItem.assigneeType !== "human" || card.workItem.assigneeUserId !== userId) {
      return false;
    }
  } else if (params.assigneeFilter.startsWith("runner:")) {
    const runnerId = params.assigneeFilter.slice("runner:".length).trim().toLowerCase();
    const cardRunnerId = card.workItem.assigneeRunnerId?.trim().toLowerCase() ?? "";
    if (card.workItem.assigneeType !== "runner" || cardRunnerId !== runnerId) {
      return false;
    }
  }

  const lifecycle = readWorkItemLifecycle(card.workItem);

  if (params.cycleFilter === "backlog") {
    if (lifecycle.cycleId !== null) {
      return false;
    }
  } else if (params.cycleFilter !== "all") {
    if (lifecycle.cycleId !== params.cycleFilter) {
      return false;
    }
  }

  if (params.milestoneFilter === "unassigned") {
    if (lifecycle.milestoneId !== null) {
      return false;
    }
  } else if (params.milestoneFilter !== "all") {
    if (lifecycle.milestoneId !== params.milestoneFilter) {
      return false;
    }
  }

  const query = params.search.trim().toLowerCase();
  if (query.length > 0) {
    const matchesCode = card.workItem.code.toLowerCase().includes(query);
    const matchesTitle = card.workItem.title.toLowerCase().includes(query);
    const matchesBranch = lifecycle.branchName?.toLowerCase().includes(query) ?? false;
    const matchesIssue =
      lifecycle.githubIssueNumber !== null && `#${lifecycle.githubIssueNumber}`.includes(query);
    if (!matchesCode && !matchesTitle && !matchesBranch && !matchesIssue) {
      return false;
    }
  }

  return true;
}

export function CockpitPage() {
  const gt = useGT();
  const locale = useLocale();
  const resolveMessage = useMessages();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const localProjects = useProjects();
  const handleNewThread = useNewThreadHandler();
  const [activeTab, setActiveTab] = useState<CockpitTab>("overview");
  const [setupInitialSection, setSetupInitialSection] = useState<SetupSection>("overview");
  const [setupSectionVersion, setSetupSectionVersion] = useState(0);
  const [chosenIntakeLocalProjectKey, setChosenIntakeLocalProjectKey] = useState("");
  const [deliverySubTab, setDeliverySubTab] = useState<DeliverySubTab>("kanban");
  const [boardView, setBoardView] = useState<BoardViewMode>("board");
  const [boardFilter, setBoardFilter] = useState<BoardFilter>("all");
  const [boardSearch, setBoardSearch] = useState("");
  const [boardAssigneeFilter, setBoardAssigneeFilter] = useState<string>("all");
  const [boardPriorityFilter, setBoardPriorityFilter] = useState<BoardPriorityFilter>("all");
  const [boardCycleFilter, setBoardCycleFilter] = useState<string>("all");
  const [boardMilestoneFilter, setBoardMilestoneFilter] = useState<string>("all");
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
  const [newItemInitialStage, setNewItemInitialStage] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<WorkItemType>("feature");
  const [newPriority, setNewPriority] = useState<WorkItemPriority>("p1");
  const [newDesignTier, setNewDesignTier] = useState<DesignTier>("medium");
  const [newAssignee, setNewAssignee] = useState<string>("unassigned");
  const [newPlannedStartAt, setNewPlannedStartAt] = useState<string>(() => todayLocalIsoDate());
  const [newDueAt, setNewDueAt] = useState<string>(() => addDaysIsoDate(todayLocalIsoDate(), 5));
  const [newCycleId, setNewCycleId] = useState<string>("");
  const [newMilestoneId, setNewMilestoneId] = useState<string>("");
  const [newHorizon, setNewHorizon] = useState<AgileHorizon | null>(null);
  const [newStoryPoints, setNewStoryPoints] = useState<number | null>(null);
  const [newSpec, setNewSpec] = useState("");
  const [creatingMode, setCreatingMode] = useState<"create" | "prd" | null>(null);
  const [advancingWorkItemId, setAdvancingWorkItemId] = useState<string | null>(null);

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

  const handleResetDeliveryFilters = () => {
    setBoardFilter("all");
    setBoardSearch("");
    setBoardAssigneeFilter("all");
    setBoardPriorityFilter("all");
    setBoardCycleFilter("all");
    setBoardMilestoneFilter("all");
  };

  const handleConnected = (nextStatus: TeamHubStatusResult) => {
    setStatus(nextStatus);
    const firstWorkspaceId = nextStatus.me?.workspaces[0]?.id ?? "";
    setSelectedWorkspaceId(firstWorkspaceId);
    setSelectedProjectId("");
    setPendingMentionHandle(null);
    setPendingFilterHandle(null);
    handleResetDeliveryFilters();
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
    handleResetDeliveryFilters();
    handleCloseChangeRequest();
  };

  const handleAdvanceWorkItemStage = async (card: CockpitWorkItemCard, nextStageId: string) => {
    if (!primaryEnvironmentId || advancingWorkItemId === card.workItem.id) return;
    setAdvancingWorkItemId(card.workItem.id);
    const res = await updateWorkItem({
      environmentId: primaryEnvironmentId,
      input: { workItemId: card.workItem.id, stage: nextStageId },
    });
    setAdvancingWorkItemId((current) => (current === card.workItem.id ? null : current));
    if (res._tag === "Success") {
      const nextStageLabel = stages.find((stage) => stage.id === nextStageId)?.label ?? nextStageId;
      toastManager.add({
        title: gt("Moved {code} to {stageLabel}", {
          code: card.workItem.code,
          stageLabel: nextStageLabel,
        }),
        type: "success",
      });
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

  const openCreateDialog = (opts?: {
    readonly stageId?: string | null;
    readonly cycleId?: string | null;
    readonly milestoneId?: string | null;
    readonly horizon?: AgileHorizon | null;
    readonly storyPoints?: number | null;
  }) => {
    const today = todayLocalIsoDate();
    const projectCycles = overview?.project?.workflowConfig.cycles ?? [];
    const projectMilestones = overview?.project?.workflowConfig.milestones ?? [];
    const matchedCycle = opts?.cycleId
      ? (projectCycles.find((cycle) => cycle.id === opts.cycleId) ?? null)
      : null;
    const matchedMilestone = opts?.milestoneId
      ? (projectMilestones.find((milestone) => milestone.id === opts.milestoneId) ?? null)
      : null;
    setNewPlannedStartAt(matchedCycle?.startDate ?? today);
    setNewDueAt(
      matchedCycle?.endDate ??
        (matchedMilestone?.targetDate && matchedMilestone.targetDate >= today
          ? matchedMilestone.targetDate
          : addDaysIsoDate(today, 5)),
    );
    setNewItemInitialStage(opts?.stageId ?? null);
    setNewCycleId(opts?.cycleId ?? "");
    setNewMilestoneId(opts?.milestoneId ?? "");
    setNewHorizon(opts?.horizon ?? matchedMilestone?.horizon ?? null);
    setNewStoryPoints(opts?.storyPoints ?? null);
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
        ...(newItemInitialStage ? { stage: newItemInitialStage } : {}),
        assigneeType: decodedAssignee.assigneeType,
        assigneeUserId: decodedAssignee.assigneeUserId,
        assigneeRunnerId: decodedAssignee.assigneeRunnerId,
        ...(newSpec.trim() ? { specMarkdown: newSpec.trim() } : {}),
        attributes: buildLifecycleAttributesPatch({
          plannedStartAt: newPlannedStartAt.trim() || null,
          dueAt: newDueAt.trim() || null,
          designTier: newDesignTier,
          githubLabels: standardGitHubLabels(newType, newPriority),
          cycleId: newCycleId.trim() || null,
          milestoneId: newMilestoneId.trim() || null,
          roadmapHorizon: newHorizon,
          storyPoints: newStoryPoints,
        }),
      },
    });
    setCreatingMode(null);
    if (res._tag === "Success") {
      const createdWorkItem = res.value.workItem;
      const today = todayLocalIsoDate();
      setCreateDialogOpen(false);
      setNewItemInitialStage(null);
      setNewTitle("");
      setNewSpec("");
      setNewDesignTier("medium");
      setNewAssignee("unassigned");
      setNewPlannedStartAt(today);
      setNewDueAt(addDaysIsoDate(today, 5));
      setNewCycleId("");
      setNewMilestoneId("");
      setNewHorizon(null);
      setNewStoryPoints(null);
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);

      if (mode === "prd") {
        const targetLocalProject = selectedIntakeProject;
        if (targetLocalProject) {
          const prompt = buildPrdGenerationPrompt({
            workItem: createdWorkItem,
            project: overview?.project ?? null,
            memory,
            repoFullName: overview?.repos[0]?.repoFullName ?? null,
            locale,
          });
          await handleNewThread(
            scopeProjectRef(targetLocalProject.environmentId, targetLocalProject.id),
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
  const cycles = activeProject?.workflowConfig.cycles ?? [];
  const milestones = activeProject?.workflowConfig.milestones ?? [];
  const activeCycle = cycles.find((cycle) => cycle.status === "active") ?? null;
  const allCards = overview?.cards ?? [];
  const activeCycleCardCount = activeCycle
    ? allCards.filter((card) => readWorkItemLifecycle(card.workItem).cycleId === activeCycle.id)
        .length
    : 0;
  const effectiveCycleFilter =
    boardCycleFilter === "all" ||
    boardCycleFilter === "backlog" ||
    cycles.some((cycle) => cycle.id === boardCycleFilter)
      ? boardCycleFilter
      : "all";
  const effectiveMilestoneFilter =
    boardMilestoneFilter === "all" ||
    boardMilestoneFilter === "unassigned" ||
    milestones.some((milestone) => milestone.id === boardMilestoneFilter)
      ? boardMilestoneFilter
      : "all";
  const currentUserId = status?.me?.user.id ?? null;
  const filteredCards = allCards.filter((card) =>
    matchesDeliveryFilters(card, {
      statusFilter: boardFilter,
      search: boardSearch,
      assigneeFilter: boardAssigneeFilter,
      priorityFilter: boardPriorityFilter,
      cycleFilter: effectiveCycleFilter,
      milestoneFilter: effectiveMilestoneFilter,
      currentUserId,
    }),
  );
  const blockedCardCount = allCards.filter((card) => matchesBoardFilter(card, "blocked")).length;
  const hasPrCardCount = allCards.filter((card) => matchesBoardFilter(card, "has_pr")).length;
  const myCardCount = currentUserId
    ? allCards.filter(
        (card) =>
          card.workItem.assigneeType === "human" && card.workItem.assigneeUserId === currentUserId,
      ).length
    : 0;
  const hasActiveDeliveryFilter =
    boardFilter !== "all" ||
    boardSearch.trim().length > 0 ||
    boardAssigneeFilter !== "all" ||
    boardPriorityFilter !== "all" ||
    effectiveCycleFilter !== "all" ||
    effectiveMilestoneFilter !== "all";
  const isMineFilterActive =
    boardAssigneeFilter === "mine" ||
    (currentUserId !== null && boardAssigneeFilter === `human:${currentUserId}`);
  const reviewItems = reviewQueue?.items ?? [];
  const roster = deriveTeamRoster({
    members,
    cards: allCards,
    reviewItems,
    boardMessages,
    currentUserId,
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
    (deliverySubTab === "gantt" ||
      deliverySubTab === "roadmap" ||
      deliverySubTab === "cycles" ||
      (deliverySubTab === "kanban" && boardView === "board"));
  const selectedCycleFilter =
    effectiveCycleFilter !== "all" && effectiveCycleFilter !== "backlog"
      ? (cycles.find((cycle) => cycle.id === effectiveCycleFilter) ?? null)
      : null;
  const selectedMilestoneFilter =
    effectiveMilestoneFilter !== "all" && effectiveMilestoneFilter !== "unassigned"
      ? (milestones.find((milestone) => milestone.id === effectiveMilestoneFilter) ?? null)
      : null;
  const selectedNewCycle = newCycleId
    ? (cycles.find((cycle) => cycle.id === newCycleId) ?? null)
    : null;
  const selectedNewMilestone = newMilestoneId
    ? (milestones.find((milestone) => milestone.id === newMilestoneId) ?? null)
    : null;
  const matchedIntakeProject = pickMatchingWorkspaceProject(
    localProjects,
    overview?.repos ?? [],
    activeProject,
  );
  const selectedIntakeProject =
    localProjects.find(
      (proj) => `${proj.environmentId}:${proj.id}` === chosenIntakeLocalProjectKey,
    ) ?? matchedIntakeProject;
  const memberSelectOptions = members.map((member) => ({
    value: `human:${member.userId}`,
    handle: resolveMemberHandle(member, roster),
    displayName: member.displayName,
  }));
  const runnerFilterOptions: Array<{ readonly value: string; readonly runnerId: string }> = [];
  const seenRunnerIds = new Set<string>();
  for (const card of allCards) {
    if (card.workItem.assigneeType === "runner" && card.workItem.assigneeRunnerId) {
      const runnerId = card.workItem.assigneeRunnerId.trim();
      const runnerKey = runnerId.toLowerCase();
      if (runnerId && !seenRunnerIds.has(runnerKey)) {
        seenRunnerIds.add(runnerKey);
        runnerFilterOptions.push({ value: `runner:${runnerId}`, runnerId });
      }
    }
  }
  if (!seenRunnerIds.has(DEFAULT_AGENT_RUNNER_ID)) {
    runnerFilterOptions.push({
      value: `runner:${DEFAULT_AGENT_RUNNER_ID}`,
      runnerId: DEFAULT_AGENT_RUNNER_ID,
    });
  }
  const selectedNewAssigneeOption = newAssignee.startsWith("human:")
    ? (memberSelectOptions.find((entry) => entry.value === newAssignee) ?? null)
    : null;
  const selectedAssigneeFilterMember = boardAssigneeFilter.startsWith("human:")
    ? (memberSelectOptions.find((entry) => entry.value === boardAssigneeFilter) ?? null)
    : null;
  const selectedAssigneeFilterRunner = boardAssigneeFilter.startsWith("runner:")
    ? boardAssigneeFilter.slice("runner:".length)
    : null;
  const initialStageMeta = newItemInitialStage
    ? (stages.find((stage) => stage.id === newItemInitialStage) ?? null)
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
                      handleResetDeliveryFilters();
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
                      handleResetDeliveryFilters();
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
                    setBoardSearch("");
                    setBoardAssigneeFilter("all");
                    setBoardPriorityFilter("all");
                    setBoardCycleFilter("all");
                    setBoardMilestoneFilter("all");
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
                  : cn(
                      "py-6 pb-12",
                      isWideDeliveryView &&
                        (deliverySubTab === "roadmap" || deliverySubTab === "cycles"
                          ? "max-w-6xl"
                          : "max-w-[1600px]"),
                    )
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
                  {...(selectedProjectId ? { onOpenIntake: () => openCreateDialog() } : {})}
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
                          value === "roadmap" ||
                          value === "cycles" ||
                          value === "kanban" ||
                          value === "gantt" ||
                          value === "triage" ||
                          value === "releases"
                        ) {
                          setDeliverySubTab(value);
                        }
                      }}
                    >
                      <Toggle value="roadmap">
                        <MapIcon />
                        <T>Roadmap</T>
                        {milestones.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {milestones.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="cycles">
                        <RepeatIcon />
                        <T>Cycles</T>
                        {activeCycle ? (
                          <span className="inline-flex items-center gap-1 font-mono text-2xs tabular-nums opacity-75">
                            <CockpitStatusDot tone="success" />
                            <span>{activeCycleCardCount}</span>
                          </span>
                        ) : cycles.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {cycles.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="kanban">
                        <KanbanIcon />
                        <T>Board</T>
                        {allCards.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {allCards.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="gantt">
                        <GanttChartIcon />
                        <T>Timeline</T>
                      </Toggle>
                      <Toggle value="triage">
                        <PullRequestGlyph.pullRequest />
                        <T>PR Triage</T>
                        {reviewItems.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {reviewItems.length}
                          </span>
                        ) : null}
                      </Toggle>
                      <Toggle value="releases">
                        <PackageCheckIcon />
                        <T>Releases</T>
                        {releases.length > 0 ? (
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {releases.length}
                          </span>
                        ) : null}
                      </Toggle>
                    </ToggleGroup>

                    {(deliverySubTab === "kanban" || deliverySubTab === "gantt") &&
                    activeProject ? (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span>{workflowPresetLabel(activeProject.workflowConfig.preset, gt)}</span>
                        <span aria-hidden className="opacity-40">
                          ·
                        </span>
                        <span className="tabular-nums">
                          <T>
                            <Var>{overview?.repos.length ?? 0}</Var> repos
                          </T>
                        </span>
                        {deliverySubTab === "kanban" && stages.length > 0 && allCards.length > 0 ? (
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
                        ) : null}
                        {selectedProjectId ? (
                          <Button size="xs" variant="default" onClick={() => openCreateDialog()}>
                            <PlusIcon />
                            <T>New Item</T>
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>

                  {(deliverySubTab === "kanban" || deliverySubTab === "gantt") &&
                  stages.length > 0 &&
                  allCards.length > 0 ? (
                    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border/55 bg-linear-to-b from-card/75 to-card/40 px-3 py-2.5 shadow-2xs ring-1 ring-inset ring-foreground/4">
                      <div className="min-w-48 flex-1 sm:max-w-64">
                        <InputGroup>
                          <InputGroupAddon align="inline-start">
                            <SearchIcon />
                          </InputGroupAddon>
                          <InputGroupInput
                            aria-label={gt("Search work items")}
                            placeholder={gt("Search code, title, branch, #issue...")}
                            size="sm"
                            value={boardSearch}
                            onChange={(event) => setBoardSearch(event.target.value)}
                          />
                          {boardSearch ? (
                            <InputGroupAddon align="inline-end">
                              <Button
                                aria-label={gt("Clear search")}
                                size="icon-micro"
                                variant="ghost-muted"
                                onClick={() => setBoardSearch("")}
                              >
                                <XIcon />
                              </Button>
                            </InputGroupAddon>
                          ) : null}
                        </InputGroup>
                      </div>

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
                          <span className="font-mono text-2xs tabular-nums opacity-70">
                            {allCards.length}
                          </span>
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

                      {currentUserId !== null ? (
                        <Button
                          aria-pressed={isMineFilterActive}
                          data-pressed={isMineFilterActive ? "" : undefined}
                          size="compact"
                          variant={isMineFilterActive ? "secondary" : "outline"}
                          onClick={() =>
                            setBoardAssigneeFilter(isMineFilterActive ? "all" : "mine")
                          }
                        >
                          <UserIcon />
                          <T>My Items</T>
                          {myCardCount > 0 ? (
                            <span className="font-mono text-2xs tabular-nums opacity-70">
                              {myCardCount}
                            </span>
                          ) : null}
                        </Button>
                      ) : null}

                      <div className="w-44 shrink-0">
                        <Select
                          value={boardAssigneeFilter}
                          onValueChange={(value) => {
                            if (value) setBoardAssigneeFilter(value);
                          }}
                        >
                          <SelectTrigger aria-label={gt("Filter by assignee")} size="compact">
                            <SelectValue>
                              {boardAssigneeFilter === "all" ? (
                                <T>All assignees</T>
                              ) : boardAssigneeFilter === "mine" ? (
                                <T>My items</T>
                              ) : boardAssigneeFilter === "unassigned" ? (
                                <T>Unassigned</T>
                              ) : selectedAssigneeFilterRunner ? (
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <BotIcon className="size-3.5 shrink-0 text-muted-foreground" />
                                  <span className="truncate font-mono text-xs">
                                    @{selectedAssigneeFilterRunner}
                                  </span>
                                </span>
                              ) : selectedAssigneeFilterMember ? (
                                <span className="truncate font-mono text-xs">
                                  @{selectedAssigneeFilterMember.handle}
                                </span>
                              ) : (
                                <T>All assignees</T>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="all">{gt("All assignees")}</SelectItem>
                            {currentUserId !== null ? (
                              <SelectItem value="mine">{gt("My items")}</SelectItem>
                            ) : null}
                            <SelectItem value="unassigned">{gt("Unassigned")}</SelectItem>
                            {memberSelectOptions.map((member) => (
                              <SelectItem key={member.value} value={member.value}>
                                @{member.handle} · {member.displayName}
                              </SelectItem>
                            ))}
                            {runnerFilterOptions.map((runner) => (
                              <SelectItem key={runner.value} value={runner.value}>
                                {gt("Coding Agent ({runnerId})", { runnerId: runner.runnerId })}
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>

                      <div className="w-36 shrink-0">
                        <Select
                          value={boardPriorityFilter}
                          onValueChange={(value) => {
                            if (
                              value === "all" ||
                              value === "p0" ||
                              value === "p1" ||
                              value === "p2" ||
                              value === "p3"
                            ) {
                              setBoardPriorityFilter(value);
                            }
                          }}
                        >
                          <SelectTrigger aria-label={gt("Filter by priority")} size="compact">
                            <SelectValue>
                              {boardPriorityFilter === "all" ? (
                                <T>All priorities</T>
                              ) : (
                                <CockpitPriorityDot priority={boardPriorityFilter} />
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="all">{gt("All priorities")}</SelectItem>
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

                      {cycles.length > 0 ? (
                        <div className="w-40 shrink-0">
                          <Select
                            value={effectiveCycleFilter}
                            onValueChange={(value) => {
                              if (value) setBoardCycleFilter(value);
                            }}
                          >
                            <SelectTrigger aria-label={gt("Filter by cycle")} size="compact">
                              <SelectValue>
                                {effectiveCycleFilter === "all" ? (
                                  <T>All cycles</T>
                                ) : effectiveCycleFilter === "backlog" ? (
                                  <T>Backlog (No Cycle)</T>
                                ) : selectedCycleFilter ? (
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    <CockpitStatusDot
                                      tone={cycleStatusTone(selectedCycleFilter.status)}
                                    />
                                    <span className="truncate">
                                      {gt("Cycle {number} · {name}", {
                                        number: selectedCycleFilter.number,
                                        name: selectedCycleFilter.name,
                                      })}
                                    </span>
                                  </span>
                                ) : (
                                  <T>All cycles</T>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="all">{gt("All cycles")}</SelectItem>
                              <SelectItem value="backlog">{gt("Backlog (No Cycle)")}</SelectItem>
                              {cycles.map((cycle) => (
                                <SelectItem key={cycle.id} value={cycle.id}>
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    <CockpitStatusDot tone={cycleStatusTone(cycle.status)} />
                                    <span className="truncate">
                                      {gt("Cycle {number} · {name}", {
                                        number: cycle.number,
                                        name: cycle.name,
                                      })}
                                    </span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>
                      ) : null}

                      {milestones.length > 0 ? (
                        <div className="w-44 shrink-0">
                          <Select
                            value={effectiveMilestoneFilter}
                            onValueChange={(value) => {
                              if (value) setBoardMilestoneFilter(value);
                            }}
                          >
                            <SelectTrigger aria-label={gt("Filter by milestone")} size="compact">
                              <SelectValue>
                                {effectiveMilestoneFilter === "all" ? (
                                  <T>All milestones</T>
                                ) : effectiveMilestoneFilter === "unassigned" ? (
                                  <T>No Milestone</T>
                                ) : selectedMilestoneFilter ? (
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    <CockpitStatusDot
                                      tone={milestoneStatusTone(selectedMilestoneFilter.status)}
                                    />
                                    <span className="truncate">{selectedMilestoneFilter.name}</span>
                                  </span>
                                ) : (
                                  <T>All milestones</T>
                                )}
                              </SelectValue>
                            </SelectTrigger>
                            <SelectPopup>
                              <SelectItem value="all">{gt("All milestones")}</SelectItem>
                              <SelectItem value="unassigned">{gt("No Milestone")}</SelectItem>
                              {milestones.map((milestone) => (
                                <SelectItem key={milestone.id} value={milestone.id}>
                                  <span className="inline-flex items-center gap-1.5 truncate">
                                    <CockpitStatusDot
                                      tone={milestoneStatusTone(milestone.status)}
                                    />
                                    <span className="truncate">{milestone.name}</span>
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectPopup>
                          </Select>
                        </div>
                      ) : null}

                      {hasActiveDeliveryFilter ? (
                        <div className="ml-auto flex items-center gap-2">
                          <span className="text-xs text-muted-foreground tabular-nums">
                            <T>
                              Showing <Var>{filteredCards.length}</Var> of{" "}
                              <Var>{allCards.length}</Var>
                            </T>
                          </span>
                          <Button
                            size="xs"
                            variant="ghost-muted"
                            onClick={handleResetDeliveryFilters}
                          >
                            <RotateCcwIcon />
                            <T>Reset filters</T>
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {deliverySubTab === "roadmap" ? (
                    <CockpitRoadmapView
                      cards={allCards}
                      environmentId={primaryEnvironmentId}
                      project={activeProject}
                      roster={roster}
                      stages={stages}
                      onOpenIntakeForMilestone={(milestoneId, horizon) =>
                        openCreateDialog({ milestoneId, horizon })
                      }
                      onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                      onRefresh={() => {
                        if (primaryEnvironmentId && selectedWorkspaceId) {
                          void loadCockpitData(
                            primaryEnvironmentId,
                            selectedWorkspaceId,
                            selectedProjectId,
                          );
                        }
                      }}
                    />
                  ) : null}

                  {deliverySubTab === "cycles" ? (
                    <CockpitCyclesView
                      cards={allCards}
                      environmentId={primaryEnvironmentId}
                      project={activeProject}
                      roster={roster}
                      stages={stages}
                      onOpenIntakeForCycle={(cycleId) =>
                        openCreateDialog({
                          cycleId,
                          ...(cycleId ? { horizon: "now" as const } : {}),
                        })
                      }
                      onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                      onRefresh={() => {
                        if (primaryEnvironmentId && selectedWorkspaceId) {
                          void loadCockpitData(
                            primaryEnvironmentId,
                            selectedWorkspaceId,
                            selectedProjectId,
                          );
                        }
                      }}
                    />
                  ) : null}

                  {deliverySubTab === "kanban" ? (
                    stages.length === 0 ? (
                      <CockpitSurface
                        className="border-border/60 bg-linear-to-b from-card/80 to-card/45 py-4 shadow-xs ring-1 ring-inset ring-foreground/5"
                        variant="grouped"
                      >
                        <Empty size="compact">
                          <EmptyMedia>
                            <CockpitIllustration className="w-72 sm:w-80" kind="empty_work_items" />
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
                    ) : allCards.length === 0 ? (
                      <CockpitSurface
                        className="border-border/60 bg-linear-to-b from-card/80 to-card/45 py-4 shadow-xs ring-1 ring-inset ring-foreground/5"
                        variant="grouped"
                      >
                        <Empty size="compact">
                          <EmptyMedia>
                            <CockpitIllustration className="w-72 sm:w-80" kind="empty_work_items" />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>
                              <T>No work items yet</T>
                            </EmptyTitle>
                            <EmptyDescription>
                              <T>
                                Create your first requirement to kick off PRD drafting, prototypes,
                                pull requests, and workflow gates.
                              </T>
                            </EmptyDescription>
                          </EmptyHeader>
                          {selectedProjectId ? (
                            <EmptyContent>
                              <Button
                                size="sm"
                                variant="default"
                                onClick={() => openCreateDialog()}
                              >
                                <PlusIcon />
                                <T>New Work Item</T>
                              </Button>
                            </EmptyContent>
                          ) : null}
                        </Empty>
                      </CockpitSurface>
                    ) : (
                      <div className="space-y-5">
                        {filteredCards.length === 0 && hasActiveDeliveryFilter ? (
                          <CockpitSurface
                            className="border-border/60 bg-linear-to-b from-card/80 to-card/45 py-4 shadow-xs ring-1 ring-inset ring-foreground/5"
                            variant="grouped"
                          >
                            <Empty size="compact">
                              <EmptyMedia>
                                <CockpitIllustration
                                  className="w-72 sm:w-80"
                                  kind="empty_work_items"
                                />
                              </EmptyMedia>
                              <EmptyHeader>
                                <EmptyTitle>
                                  <T>No matching work items</T>
                                </EmptyTitle>
                                <EmptyDescription>
                                  <T>
                                    No work items match your active search or filters. Reset filters
                                    to inspect all items.
                                  </T>
                                </EmptyDescription>
                              </EmptyHeader>
                              <EmptyContent>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={handleResetDeliveryFilters}
                                >
                                  <RotateCcwIcon />
                                  <T>Reset filters</T>
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
                                  className="flex w-80 shrink-0 flex-col gap-3 rounded-2xl border-border/50 bg-muted/20 p-3.5"
                                  padding="none"
                                  variant="subtle"
                                >
                                  <div className="flex min-h-7 items-center justify-between gap-2 px-0.5 pb-1">
                                    <div className="flex min-w-0 items-center gap-2">
                                      <CockpitStatusDot
                                        ring={stage.category === "active"}
                                        tone={stageCategoryTone(stage.category)}
                                      />
                                      <h2 className="truncate text-xs font-medium text-foreground">
                                        {stage.label}
                                      </h2>
                                      <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-border/50 bg-background/70 px-1.5 font-mono text-2xs font-medium tabular-nums text-muted-foreground">
                                        {stageCards.length}
                                      </span>
                                    </div>
                                    {selectedProjectId ? (
                                      <Tooltip>
                                        <TooltipTrigger
                                          render={
                                            <Button
                                              aria-label={gt("New work item in {stageLabel}", {
                                                stageLabel: stage.label,
                                              })}
                                              size="icon-xs"
                                              variant="ghost-muted"
                                              onClick={() =>
                                                openCreateDialog({ stageId: stage.id })
                                              }
                                            />
                                          }
                                        >
                                          <PlusIcon />
                                        </TooltipTrigger>
                                        <TooltipPopup>
                                          {gt("New work item in {stageLabel}", {
                                            stageLabel: stage.label,
                                          })}
                                        </TooltipPopup>
                                      </Tooltip>
                                    ) : null}
                                  </div>

                                  <div className="flex flex-col gap-3">
                                    {stageCards.map((card) => (
                                      <WorkItemCardView
                                        key={card.workItem.id}
                                        advancing={advancingWorkItemId === card.workItem.id}
                                        card={card}
                                        gates={gates}
                                        milestones={milestones}
                                        roster={roster}
                                        selectedChangeRequestId={selectedChangeRequestId}
                                        stages={stages}
                                        onAdvanceStage={(nextStageId) =>
                                          void handleAdvanceWorkItemStage(card, nextStageId)
                                        }
                                        onApproveGate={(gateKey) =>
                                          void handleApproveGate(card.workItem.id, gateKey)
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
                              if (stageCards.length === 0 && hasActiveDeliveryFilter) return null;
                              return (
                                <section key={stage.id} className="space-y-2">
                                  <CockpitSectionHeader
                                    action={
                                      selectedProjectId ? (
                                        <Tooltip>
                                          <TooltipTrigger
                                            render={
                                              <Button
                                                aria-label={gt("New work item in {stageLabel}", {
                                                  stageLabel: stage.label,
                                                })}
                                                size="icon-xs"
                                                variant="ghost-muted"
                                                onClick={() =>
                                                  openCreateDialog({ stageId: stage.id })
                                                }
                                              />
                                            }
                                          >
                                            <PlusIcon />
                                          </TooltipTrigger>
                                          <TooltipPopup>
                                            {gt("New work item in {stageLabel}", {
                                              stageLabel: stage.label,
                                            })}
                                          </TooltipPopup>
                                        </Tooltip>
                                      ) : undefined
                                    }
                                    count={stageCards.length}
                                    icon={
                                      <CockpitStatusDot
                                        ring={stage.category === "active"}
                                        tone={stageCategoryTone(stage.category)}
                                      />
                                    }
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
                                          advancing={advancingWorkItemId === card.workItem.id}
                                          card={card}
                                          gates={gates}
                                          milestones={milestones}
                                          roster={roster}
                                          selectedChangeRequestId={selectedChangeRequestId}
                                          stages={stages}
                                          onAdvanceStage={(nextStageId) =>
                                            void handleAdvanceWorkItemStage(card, nextStageId)
                                          }
                                          onApproveGate={(gateKey) =>
                                            void handleApproveGate(card.workItem.id, gateKey)
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
                    hasActiveDeliveryFilter && filteredCards.length === 0 ? (
                      <CockpitSurface
                        className="border-border/60 bg-linear-to-b from-card/80 to-card/45 py-4 shadow-xs ring-1 ring-inset ring-foreground/5"
                        variant="grouped"
                      >
                        <Empty size="compact">
                          <EmptyMedia>
                            <CockpitIllustration className="w-72 sm:w-80" kind="empty_gantt" />
                          </EmptyMedia>
                          <EmptyHeader>
                            <EmptyTitle>
                              <T>No matching work items</T>
                            </EmptyTitle>
                            <EmptyDescription>
                              <T>
                                No work items match your active search or filters. Reset filters to
                                inspect all items.
                              </T>
                            </EmptyDescription>
                          </EmptyHeader>
                          <EmptyContent>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={handleResetDeliveryFilters}
                            >
                              <RotateCcwIcon />
                              <T>Reset filters</T>
                            </Button>
                          </EmptyContent>
                        </Empty>
                      </CockpitSurface>
                    ) : (
                      <CockpitGanttView
                        cards={filteredCards}
                        cycles={cycles}
                        milestones={milestones}
                        releases={releases}
                        roster={roster}
                        stages={stages}
                        {...(selectedProjectId ? { onCreateItem: () => openCreateDialog() } : {})}
                        onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                        onUpdateSchedule={handleUpdateSchedule}
                      />
                    )
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
                    key={setupSectionVersion}
                    environmentId={primaryEnvironmentId}
                    initialSection={setupInitialSection}
                    memory={memory}
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

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          setCreateDialogOpen(open);
          if (!open) {
            setNewItemInitialStage(null);
            setNewCycleId("");
            setNewMilestoneId("");
            setNewHorizon(null);
            setNewStoryPoints(null);
          }
        }}
      >
        <DialogPopup className="max-w-2xl">
          <DialogHeader>
            <div className="flex items-start gap-3.5 pr-8 pb-1">
              <CockpitIconBadge className="mt-0.5 shrink-0" size="lg" tone="primary">
                <CockpitStageArtworkIcon stage="intake" />
              </CockpitIconBadge>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="flex flex-wrap items-center gap-2 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                  <T>Requirement Intake</T>
                  {selectedProject ? (
                    <>
                      <span aria-hidden className="opacity-35">
                        ·
                      </span>
                      <span className="font-mono tracking-normal text-foreground/80 normal-case">
                        {selectedProject.key} · {selectedProject.name}
                      </span>
                    </>
                  ) : null}
                  {initialStageMeta ? (
                    <Badge size="sm" variant="outline">
                      <CockpitStatusDot tone={stageCategoryTone(initialStageMeta.category)} />
                      <T>
                        Stage: <Var>{initialStageMeta.label}</Var>
                      </T>
                    </Badge>
                  ) : null}
                  {selectedNewCycle ? (
                    <Badge size="sm" variant="outline">
                      <CockpitStatusDot tone={cycleStatusTone(selectedNewCycle.status)} />
                      {gt("Cycle {number} · {name}", {
                        number: selectedNewCycle.number,
                        name: selectedNewCycle.name,
                      })}
                    </Badge>
                  ) : null}
                  {selectedNewMilestone ? (
                    <Badge size="sm" variant="outline">
                      <FlagIcon />
                      {selectedNewMilestone.name}
                    </Badge>
                  ) : null}
                </div>
                <DialogTitle>
                  <T>New Work Item</T>
                </DialogTitle>
                <DialogDescription>
                  <T>
                    Capture requirement scope, design tier, owner, and timeline, or launch an AI PRD
                    thread right away.
                  </T>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogPanel>
            <div className="space-y-5">
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

              <div className="space-y-3.5 rounded-xl border border-border/55 bg-linear-to-b from-muted/25 to-muted/10 p-4">
                <div className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                  <T>Scope &amp; Schedule</T>
                </div>

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
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
                        <SelectValue>
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass(newType))}
                              kind={newType}
                            />
                            <span>{workItemTypeLabel(newType, gt)}</span>
                          </span>
                        </SelectValue>
                      </SelectTrigger>
                      <SelectPopup>
                        <SelectItem value="feature">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass("feature"))}
                              kind="feature"
                            />
                            <span>{gt("Feature")}</span>
                          </span>
                        </SelectItem>
                        <SelectItem value="refactor">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass("refactor"))}
                              kind="refactor"
                            />
                            <span>{gt("Refactor")}</span>
                          </span>
                        </SelectItem>
                        <SelectItem value="bug">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass("bug"))}
                              kind="bug"
                            />
                            <span>{gt("Bug")}</span>
                          </span>
                        </SelectItem>
                        <SelectItem value="chore">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass("chore"))}
                              kind="chore"
                            />
                            <span>{gt("Chore")}</span>
                          </span>
                        </SelectItem>
                        <SelectItem value="security">
                          <span className="inline-flex items-center gap-1.5">
                            <CockpitArtifactIcon
                              className={cn("size-3.5 shrink-0", workItemTypeIconClass("security"))}
                              kind="security"
                            />
                            <span>{gt("Security")}</span>
                          </span>
                        </SelectItem>
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

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
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
              </div>

              <div className="space-y-3.5 rounded-xl border border-border/55 bg-linear-to-b from-muted/25 to-muted/10 p-4">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                    <T>Agile Planning</T>
                  </div>
                  {newStoryPoints !== null ? (
                    <span className="font-mono text-2xs font-medium tabular-nums text-primary">
                      {gt("{points}pt", { points: newStoryPoints })}
                    </span>
                  ) : null}
                </div>

                {cycles.length > 0 || milestones.length > 0 ? (
                  <div
                    className={cn(
                      "grid grid-cols-1 gap-3.5",
                      cycles.length > 0 && milestones.length > 0 ? "sm:grid-cols-2" : undefined,
                    )}
                  >
                    {cycles.length > 0 ? (
                      <div>
                        <CockpitFieldLabel htmlFor="wi-cycle">
                          <T>Cycle (Sprint)</T>
                        </CockpitFieldLabel>
                        <Select
                          value={newCycleId || "__none__"}
                          onValueChange={(value) => {
                            if (!value) return;
                            setNewCycleId(value === "__none__" ? "" : value);
                          }}
                        >
                          <SelectTrigger id="wi-cycle" size="sm">
                            <SelectValue>
                              {selectedNewCycle ? (
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <CockpitStatusDot
                                    tone={cycleStatusTone(selectedNewCycle.status)}
                                  />
                                  <span className="truncate">
                                    {gt("Cycle {number} · {name}", {
                                      number: selectedNewCycle.number,
                                      name: selectedNewCycle.name,
                                    })}
                                  </span>
                                </span>
                              ) : (
                                <T>Backlog (No Cycle)</T>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="__none__">{gt("Backlog (No Cycle)")}</SelectItem>
                            {cycles.map((cycle) => (
                              <SelectItem key={cycle.id} value={cycle.id}>
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <CockpitStatusDot tone={cycleStatusTone(cycle.status)} />
                                  <span className="truncate">
                                    {gt("Cycle {number} · {name}", {
                                      number: cycle.number,
                                      name: cycle.name,
                                    })}
                                  </span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                    ) : null}

                    {milestones.length > 0 ? (
                      <div>
                        <CockpitFieldLabel htmlFor="wi-milestone">
                          <T>Milestone / Phase</T>
                        </CockpitFieldLabel>
                        <Select
                          value={newMilestoneId || "__none__"}
                          onValueChange={(value) => {
                            if (!value) return;
                            const nextId = value === "__none__" ? "" : value;
                            setNewMilestoneId(nextId);
                            if (nextId && newHorizon === null) {
                              const matched = milestones.find((m) => m.id === nextId);
                              if (matched) {
                                setNewHorizon(matched.horizon);
                              }
                            }
                          }}
                        >
                          <SelectTrigger id="wi-milestone" size="sm">
                            <SelectValue>
                              {selectedNewMilestone ? (
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <FlagIcon
                                    aria-hidden
                                    className="size-3 shrink-0 text-muted-foreground"
                                  />
                                  <span className="truncate">{selectedNewMilestone.name}</span>
                                </span>
                              ) : (
                                <T>No Milestone</T>
                              )}
                            </SelectValue>
                          </SelectTrigger>
                          <SelectPopup>
                            <SelectItem value="__none__">{gt("No Milestone")}</SelectItem>
                            {milestones.map((milestone) => (
                              <SelectItem key={milestone.id} value={milestone.id}>
                                <span className="inline-flex items-center gap-1.5 truncate">
                                  <FlagIcon
                                    aria-hidden
                                    className="size-3 shrink-0 text-muted-foreground"
                                  />
                                  <span className="truncate">{milestone.name}</span>
                                </span>
                              </SelectItem>
                            ))}
                          </SelectPopup>
                        </Select>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        <T>Roadmap Horizon</T>
                      </span>
                      {newHorizon !== null ? (
                        <span className="text-2xs text-muted-foreground/75">
                          {agileHorizonLabel(newHorizon, gt)}
                        </span>
                      ) : null}
                    </div>
                    <div
                      aria-label={gt("Roadmap Horizon")}
                      className="grid grid-cols-3 gap-0.5 rounded-lg border border-border/60 bg-background/60 p-0.5"
                      role="group"
                    >
                      {AGILE_HORIZONS.map((horizon) => {
                        const isActive = newHorizon === horizon;
                        return (
                          <button
                            key={horizon}
                            aria-pressed={isActive}
                            className={cn(
                              "cursor-pointer rounded-md px-2 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              isActive
                                ? agileHorizonActiveClass(horizon)
                                : "text-muted-foreground hover:bg-accent/40 hover:text-foreground",
                            )}
                            type="button"
                            onClick={() => setNewHorizon(isActive ? null : horizon)}
                          >
                            {agileHorizonLabel(horizon, gt)}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        <T>Story Points</T>
                      </span>
                      <span className="font-mono text-2xs tabular-nums text-muted-foreground/75">
                        {newStoryPoints !== null ? (
                          gt("{points}pt", { points: newStoryPoints })
                        ) : (
                          <T>Unestimated</T>
                        )}
                      </span>
                    </div>
                    <div
                      aria-label={gt("Story Points")}
                      className="grid grid-cols-6 gap-1"
                      role="group"
                    >
                      {STORY_POINT_SCALE.map((points) => {
                        const isSelected = newStoryPoints === points;
                        return (
                          <button
                            key={points}
                            aria-label={gt("{points} story points", { points })}
                            aria-pressed={isSelected}
                            className={cn(
                              "cursor-pointer rounded-md border py-1 font-mono text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                              isSelected
                                ? "border-primary/45 bg-primary/15 font-semibold text-primary shadow-2xs"
                                : "border-border/55 bg-background/60 text-muted-foreground hover:border-border hover:bg-accent/40 hover:text-foreground",
                            )}
                            type="button"
                            onClick={() => setNewStoryPoints(isSelected ? null : points)}
                          >
                            {points}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <div className="space-y-3.5 rounded-xl border border-border/55 bg-linear-to-b from-card/75 to-card/35 p-4">
                <div className="flex items-center gap-1.5 text-2xs font-medium tracking-wider text-muted-foreground uppercase">
                  <CockpitStageArtworkIcon
                    className="size-3.5 shrink-0 text-info-foreground"
                    stage="prd"
                  />
                  <T>Context &amp; Requirement Brief</T>
                </div>

                {localProjects.length > 0 && selectedIntakeProject ? (
                  <div>
                    <CockpitFieldLabel htmlFor="wi-local-repo">
                      <T>Target Local Repository (for AI PRD)</T>
                    </CockpitFieldLabel>
                    <Select
                      value={`${selectedIntakeProject.environmentId}:${selectedIntakeProject.id}`}
                      onValueChange={(value) => {
                        if (value) setChosenIntakeLocalProjectKey(value);
                      }}
                    >
                      <SelectTrigger id="wi-local-repo" size="sm">
                        <SelectValue>{selectedIntakeProject.title}</SelectValue>
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
                ) : null}

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
            </div>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              <T>Cancel</T>
            </DialogClose>
            <Button
              disabled={creatingMode !== null || !newTitle.trim() || !selectedIntakeProject}
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
          onOpenPromptSettings={() => {
            setSetupInitialSection("prompts");
            setSetupSectionVersion((v) => v + 1);
            setActiveTab("setup");
          }}
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
  readonly milestones: ReadonlyArray<ProjectMilestone>;
  readonly selectedChangeRequestId: string | null;
  readonly advancing: boolean;
  readonly onAdvanceStage: (nextStageId: string) => void;
  readonly onApproveGate: (gateKey: string) => void;
  readonly onOpenDetail: () => void;
  readonly onOpenChangeRequest: (cr: ChangeRequestAudit) => void;
}

function WorkItemCardView({
  card,
  roster,
  stages,
  gates,
  milestones,
  selectedChangeRequestId,
  advancing,
  onAdvanceStage,
  onApproveGate,
  onOpenDetail,
  onOpenChangeRequest,
}: WorkItemCardViewProps) {
  const gt = useGT();
  const latestGates = resolveLatestGateApprovals(card.gateApprovals);
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const schedule = resolveWorkItemSchedule(card.workItem);
  const assignee = resolveCardAssignee(card, roster);
  const storyPoints = lifecycle.storyPoints;
  const milestone = lifecycle.milestoneId
    ? (milestones.find((entry) => entry.id === lifecycle.milestoneId) ?? null)
    : null;
  const hasPrd = lifecycle.prdStatus !== "none";
  const hasProto = lifecycle.prototypeStatus !== "none" || lifecycle.prototypeUrl !== null;
  const issueNumber = lifecycle.githubIssueNumber;
  const branchName = lifecycle.branchName;
  const dueDateDisplay = lifecycle.dueAt
    ? formatShortDueDate(lifecycle.dueAt)
    : schedule.isOverdue
      ? formatShortDueDate(schedule.dueDate)
      : null;
  const hasQuietLifecycleCues =
    hasPrd ||
    hasProto ||
    issueNumber !== null ||
    branchName !== null ||
    milestone !== null ||
    dueDateDisplay !== null;

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
      className="group/card space-y-3 rounded-xl border-border/60 bg-transparent bg-linear-to-b from-card/90 to-card/55 p-3.5 shadow-xs ring-1 ring-inset ring-foreground/5 transition-colors hover:border-border"
      padding="none"
      variant="card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <CockpitPriorityDot priority={card.workItem.priority} />
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex shrink-0 items-center" />}>
              <CockpitArtifactIcon
                className={cn("size-3.5 shrink-0", workItemTypeIconClass(card.workItem.itemType))}
                kind={card.workItem.itemType}
              />
            </TooltipTrigger>
            <TooltipPopup>{workItemTypeLabel(card.workItem.itemType, gt)}</TooltipPopup>
          </Tooltip>
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
          {storyPoints !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex shrink-0 items-center rounded-md border border-border/55 bg-muted/35 px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums text-muted-foreground" />
                }
              >
                {gt("{points}pt", { points: storyPoints })}
              </TooltipTrigger>
              <TooltipPopup>{gt("{points} story points", { points: storyPoints })}</TooltipPopup>
            </Tooltip>
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
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 leading-tight",
                lifecycle.prdStatus === "approved"
                  ? "border-success/25 bg-success/8 text-success-foreground"
                  : "border-info/25 bg-info/8 text-info-foreground",
              )}
            >
              <CockpitStageArtworkIcon className="size-3 shrink-0 opacity-85" stage="prd" />
              <T>PRD</T>
            </span>
          ) : null}
          {hasProto ? (
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 leading-tight",
                lifecycle.prototypeStatus === "approved"
                  ? "border-success/25 bg-success/8 text-success-foreground"
                  : "border-border/45 bg-muted/30 text-muted-foreground",
              )}
            >
              <CockpitArtifactIcon className="size-3 shrink-0 opacity-85" kind="prototype" />
              <T>Proto</T>
            </span>
          ) : null}
          {issueNumber !== null ? (
            <span className="inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/30 px-2 py-0.5 leading-tight text-muted-foreground">
              <CockpitArtifactIcon className="size-3 shrink-0 opacity-80" kind="github_issue" />
              <span>#{issueNumber}</span>
            </span>
          ) : null}
          {branchName !== null ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="inline-flex max-w-36 items-center gap-1 rounded-md border border-border/45 bg-muted/30 px-2 py-0.5 leading-tight text-muted-foreground" />
                }
              >
                <CockpitArtifactIcon className="size-3 shrink-0 opacity-80" kind="branch" />
                <span className="truncate">{branchName}</span>
              </TooltipTrigger>
              <TooltipPopup>{branchName}</TooltipPopup>
            </Tooltip>
          ) : null}
          {milestone ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span
                    className={cn(
                      "inline-flex max-w-36 items-center gap-1 rounded-md border px-2 py-0.5 font-sans leading-tight font-medium",
                      milestoneChipClass(milestone.colorTone),
                    )}
                  />
                }
              >
                <FlagIcon aria-hidden className="size-3 shrink-0 opacity-80" />
                <span className="truncate">{milestone.name}</span>
              </TooltipTrigger>
              <TooltipPopup>{milestone.name}</TooltipPopup>
            </Tooltip>
          ) : null}
          {dueDateDisplay ? (
            <span
              className={cn(
                "tabular-nums",
                schedule.isOverdue
                  ? "rounded-md border border-destructive/25 bg-destructive/8 px-2 py-0.5 leading-tight font-medium text-destructive"
                  : "px-0.5 text-muted-foreground/85",
              )}
            >
              {dueDateDisplay}
            </span>
          ) : null}
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
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
                  isSelected
                    ? "border-border bg-accent/65 text-foreground"
                    : "border-border/45 bg-background/45 text-foreground hover:border-border/80 hover:bg-accent/35",
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
              onClick={(event) => {
                event.stopPropagation();
                onApproveGate(gate.key);
              }}
            >
              <ShieldCheckIcon />
              {gate.label}
            </Button>
          ))}
        </div>
      ) : null}

      {card.checklistTotalCount > 0 ? (
        <div className="flex items-center gap-2 pt-0.5">
          <div
            aria-label={gt("Acceptance criteria progress")}
            aria-valuemax={card.checklistTotalCount}
            aria-valuemin={0}
            aria-valuenow={card.checklistVerifiedCount}
            className="h-[3px] flex-1 overflow-hidden rounded-full bg-muted"
            role="progressbar"
          >
            <div
              className={cn(
                "h-full rounded-full transition-[width]",
                acPercent === 100 ? "bg-success" : "bg-primary",
              )}
              style={{ width: `${acPercent}%` }}
            />
          </div>
          <span
            className={cn(
              "shrink-0 font-mono text-2xs tabular-nums",
              acPercent === 100 ? "font-medium text-success-foreground" : "text-muted-foreground",
            )}
          >
            <T>
              AC <Var>{card.checklistVerifiedCount}</Var>/<Var>{card.checklistTotalCount}</Var>
            </T>
          </span>
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-2 border-t border-border/45 pt-2.5">
        <Button size="micro" variant="ghost-muted" onClick={onOpenDetail}>
          <T>Details</T>
        </Button>
        {nextStage ? (
          <span
            className={cn(
              "inline-flex items-center transition-opacity",
              advancing
                ? "opacity-100"
                : "opacity-65 group-hover/card:opacity-100 group-focus-within/card:opacity-100",
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={gt("Advance to {nextStageLabel}", {
                      nextStageLabel: nextStage.label,
                    })}
                    disabled={advancing}
                    size="icon-xs"
                    variant="ghost-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAdvanceStage(nextStage.id);
                    }}
                  />
                }
              >
                <ArrowRightIcon />
              </TooltipTrigger>
              <TooltipPopup>
                {gt("Advance to {nextStageLabel}", { nextStageLabel: nextStage.label })}
              </TooltipPopup>
            </Tooltip>
          </span>
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
  milestones,
  selectedChangeRequestId,
  advancing,
  onAdvanceStage,
  onApproveGate,
  onOpenDetail,
  onOpenChangeRequest,
}: WorkItemCardViewProps) {
  const gt = useGT();
  const latestGates = resolveLatestGateApprovals(card.gateApprovals);
  const lifecycle = readWorkItemLifecycle(card.workItem);
  const schedule = resolveWorkItemSchedule(card.workItem);
  const assignee = resolveCardAssignee(card, roster);
  const storyPoints = lifecycle.storyPoints;
  const milestone = lifecycle.milestoneId
    ? (milestones.find((entry) => entry.id === lifecycle.milestoneId) ?? null)
    : null;
  const hasPrd = lifecycle.prdStatus !== "none";
  const hasProto = lifecycle.prototypeStatus !== "none" || lifecycle.prototypeUrl !== null;
  const issueNumber = lifecycle.githubIssueNumber;
  const branchName = lifecycle.branchName;
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
  const acPercent =
    card.checklistTotalCount > 0
      ? Math.round((card.checklistVerifiedCount / card.checklistTotalCount) * 100)
      : 0;

  return (
    <CockpitSurfaceRow
      className="group/row flex flex-wrap items-center justify-between gap-3"
      density="default"
      interactive
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <CockpitPriorityDot priority={card.workItem.priority} />
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex shrink-0 items-center" />}>
            <CockpitArtifactIcon
              className={cn("size-3.5 shrink-0", workItemTypeIconClass(card.workItem.itemType))}
              kind={card.workItem.itemType}
            />
          </TooltipTrigger>
          <TooltipPopup>{workItemTypeLabel(card.workItem.itemType, gt)}</TooltipPopup>
        </Tooltip>
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

      <div className="flex shrink-0 flex-wrap items-center gap-1.5">
        {storyPoints !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex shrink-0 items-center rounded-md border border-border/55 bg-muted/35 px-1.5 py-0.5 font-mono text-2xs font-medium tabular-nums text-muted-foreground" />
              }
            >
              {gt("{points}pt", { points: storyPoints })}
            </TooltipTrigger>
            <TooltipPopup>{gt("{points} story points", { points: storyPoints })}</TooltipPopup>
          </Tooltip>
        ) : null}
        {milestone ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span
                  className={cn(
                    "inline-flex max-w-32 items-center gap-1 rounded-md border px-2 py-0.5 text-2xs leading-tight font-medium",
                    milestoneChipClass(milestone.colorTone),
                  )}
                />
              }
            >
              <FlagIcon aria-hidden className="size-3 shrink-0 opacity-80" />
              <span className="truncate">{milestone.name}</span>
            </TooltipTrigger>
            <TooltipPopup>{milestone.name}</TooltipPopup>
          </Tooltip>
        ) : null}
        {hasPrd ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-2xs leading-tight",
              lifecycle.prdStatus === "approved"
                ? "border-success/25 bg-success/8 text-success-foreground"
                : "border-info/25 bg-info/8 text-info-foreground",
            )}
          >
            <CockpitStageArtworkIcon className="size-3 shrink-0 opacity-85" stage="prd" />
            <T>PRD</T>
          </span>
        ) : null}
        {hasProto ? (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-2xs leading-tight",
              lifecycle.prototypeStatus === "approved"
                ? "border-success/25 bg-success/8 text-success-foreground"
                : "border-border/45 bg-muted/30 text-muted-foreground",
            )}
          >
            <CockpitArtifactIcon className="size-3 shrink-0 opacity-85" kind="prototype" />
            <T>Proto</T>
          </span>
        ) : null}
        {issueNumber !== null ? (
          <span className="inline-flex items-center gap-1 rounded-md border border-border/45 bg-muted/30 px-2 py-0.5 font-mono text-2xs leading-tight text-muted-foreground">
            <CockpitArtifactIcon className="size-3 shrink-0 opacity-80" kind="github_issue" />
            <span>#{issueNumber}</span>
          </span>
        ) : null}
        {branchName !== null ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <span className="inline-flex max-w-32 items-center gap-1 rounded-md border border-border/45 bg-muted/30 px-2 py-0.5 font-mono text-2xs leading-tight text-muted-foreground" />
              }
            >
              <CockpitArtifactIcon className="size-3 shrink-0 opacity-80" kind="branch" />
              <span className="truncate">{branchName}</span>
            </TooltipTrigger>
            <TooltipPopup>{branchName}</TooltipPopup>
          </Tooltip>
        ) : null}
        {dueDateDisplay ? (
          <span
            className={cn(
              "font-mono text-2xs tabular-nums",
              schedule.isOverdue
                ? "rounded-md border border-destructive/25 bg-destructive/8 px-2 py-0.5 leading-tight font-medium text-destructive"
                : "text-muted-foreground/85",
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
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-label={gt("Acceptance criteria progress")}
              aria-valuemax={card.checklistTotalCount}
              aria-valuemin={0}
              aria-valuenow={card.checklistVerifiedCount}
              className="h-[3px] w-10 overflow-hidden rounded-full bg-muted"
              role="progressbar"
            >
              <span
                className={cn(
                  "block h-full rounded-full transition-[width]",
                  acPercent === 100 ? "bg-success" : "bg-primary",
                )}
                style={{ width: `${acPercent}%` }}
              />
            </span>
            <span
              className={cn(
                "font-mono text-2xs tabular-nums",
                acPercent === 100 ? "font-medium text-success-foreground" : "text-muted-foreground",
              )}
            >
              <T>
                AC <Var>{card.checklistVerifiedCount}</Var>/<Var>{card.checklistTotalCount}</Var>
              </T>
            </span>
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
            onClick={(event) => {
              event.stopPropagation();
              onApproveGate(gate.key);
            }}
          >
            <ShieldCheckIcon />
            {gate.label}
          </Button>
        ))}

        {nextStage ? (
          <span
            className={cn(
              "inline-flex items-center transition-opacity",
              advancing
                ? "opacity-100"
                : "opacity-65 group-hover/row:opacity-100 group-focus-within/row:opacity-100",
            )}
          >
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label={gt("Advance to {nextStageLabel}", {
                      nextStageLabel: nextStage.label,
                    })}
                    disabled={advancing}
                    size="icon-xs"
                    variant="ghost-muted"
                    onClick={(event) => {
                      event.stopPropagation();
                      onAdvanceStage(nextStage.id);
                    }}
                  />
                }
              >
                <ArrowRightIcon />
              </TooltipTrigger>
              <TooltipPopup>
                {gt("Advance to {nextStageLabel}", { nextStageLabel: nextStage.label })}
              </TooltipPopup>
            </Tooltip>
          </span>
        ) : null}
      </div>
    </CockpitSurfaceRow>
  );
}
