import { useAtomValue } from "@effect/atom-react";
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
  resolveLatestGateApprovals,
  type ChangeRequestAudit,
  type CockpitWorkItemCard,
  type ProjectDirective,
  type WorkItemPriority,
  type WorkItemType,
} from "@u3code/hub-contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { T, useGT, Var } from "gt-react";
import {
  ArrowRightIcon,
  BrainIcon,
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
import { isElectron } from "~/env";
import { cn } from "~/lib/utils";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { CockpitConnectCard } from "./CockpitConnectCard";
import { CockpitMemoryTab } from "./CockpitMemoryTab";
import {
  CockpitFieldLabel,
  CockpitInlineAlert,
  CockpitPriorityDot,
  CockpitSectionHeader,
  CockpitStatPill,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
  type CockpitTone,
} from "./CockpitPrimitives";
import { CockpitPullRequestPane } from "./CockpitPullRequestPane";
import { CockpitReleasesTab } from "./CockpitReleasesTab";
import { CockpitSettingsTab } from "./CockpitSettingsTab";
import { CockpitTriageTab } from "./CockpitTriageTab";
import { WorkItemDetailDialog } from "./WorkItemDetailDialog";
import { formatCockpitCommandError } from "./cockpitError";

type CockpitTab = "board" | "triage" | "releases" | "memory" | "setup";
type BoardViewMode = "board" | "list";
type BoardFilter = "all" | "blocked" | "has_pr";
type TriageFilter = "all" | "blocked" | "human" | "unlinked";

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
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const [activeTab, setActiveTab] = useState<CockpitTab>("board");
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
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newType, setNewType] = useState<WorkItemType>("feature");
  const [newPriority, setNewPriority] = useState<WorkItemPriority>("p1");
  const [newSpec, setNewSpec] = useState("");
  const [creatingItem, setCreatingItem] = useState(false);

  const [generatingDigest, setGeneratingDigest] = useState(false);
  const [savingDirectives, setSavingDirectives] = useState(false);
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

    const [overviewRes, queueRes, digestsRes] = await Promise.all([
      fetchOverview({
        environmentId: envId,
        input: { workspaceId, projectId: projectId || null },
      }),
      fetchReviewQueue({ environmentId: envId, input: { workspaceId } }),
      fetchDigests({ environmentId: envId, input: { workspaceId } }),
    ]);

    if (overviewRes._tag === "Success") {
      setOverview(overviewRes.value);
      const resolvedProjectId =
        projectId || overviewRes.value.project?.id || overviewRes.value.projects[0]?.id || "";
      if (resolvedProjectId && resolvedProjectId !== projectId) {
        setSelectedProjectId(resolvedProjectId);
      }
      if (resolvedProjectId) {
        const memRes = await fetchMemory({
          environmentId: envId,
          input: { projectId: resolvedProjectId },
        });
        if (memRes._tag === "Success") {
          setMemory(memRes.value.memory);
        }
      } else {
        setMemory(null);
      }
    } else {
      setErrorMessage(
        formatCockpitCommandError(overviewRes, gt("Failed to load cockpit overview.")),
      );
    }

    if (queueRes._tag === "Success") {
      setReviewQueue(queueRes.value);
    }
    if (digestsRes._tag === "Success") {
      setDigests(digestsRes.value);
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
    handleCloseChangeRequest();
    if (primaryEnvironmentId && nextStatus.connected && firstWorkspaceId) {
      void loadCockpitData(primaryEnvironmentId, firstWorkspaceId, "");
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

  const handleCreateWorkItem = async () => {
    if (!primaryEnvironmentId || !selectedProjectId || !newTitle.trim()) return;
    setCreatingItem(true);
    const res = await createWorkItem({
      environmentId: primaryEnvironmentId,
      input: {
        projectId: selectedProjectId,
        title: newTitle.trim(),
        itemType: newType,
        priority: newPriority,
        ...(newSpec.trim() ? { specMarkdown: newSpec.trim() } : {}),
      },
    });
    setCreatingItem(false);
    if (res._tag === "Success") {
      setCreateDialogOpen(false);
      setNewTitle("");
      setNewSpec("");
      toastManager.add({ title: gt("Work item created"), type: "success" });
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
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

  const activeProject = overview?.project ?? null;
  const stages = activeProject?.workflowConfig.stages ?? [];
  const gates = activeProject?.workflowConfig.gates ?? [];
  const allCards = overview?.cards ?? [];
  const filteredCards = allCards.filter((card) => matchesBoardFilter(card, boardFilter));

  const selectedWorkspace =
    status?.me?.workspaces.find((ws) => ws.id === selectedWorkspaceId) ?? null;
  const selectedProject =
    overview?.projects.find((proj) => proj.id === selectedProjectId) ?? activeProject;

  const selectedChangeRequest: ChangeRequestAudit | null = (() => {
    if (!selectedChangeRequestId) return null;
    const fromQueue = reviewQueue?.items.find((cr) => cr.id === selectedChangeRequestId);
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
        className="border-b border-border/60 bg-background"
        electron={isElectron}
      >
        <WorkspaceBreadcrumb ariaLabel={gt("Team Cockpit")}>
          <WorkspaceBreadcrumbItem current>
            <h1 className="truncate font-medium text-foreground">
              <T>Team Cockpit</T>
            </h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        {status?.connected && status.me ? (
          <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
            <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-border/60 bg-muted/35 px-2 text-2xs font-medium text-muted-foreground">
              <CockpitStatusDot ring tone="success" />
              <T>Live</T>
            </span>

            {status.me.workspaces.length > 0 ? (
              <div className="max-w-44">
                <Select
                  value={selectedWorkspaceId}
                  onValueChange={(nextWs) => {
                    if (!nextWs) return;
                    setSelectedWorkspaceId(nextWs);
                    setSelectedProjectId("");
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

            {selectedProjectId ? (
              <Button size="xs" variant="default" onClick={() => setCreateDialogOpen(true)}>
                <PlusIcon />
                <T>New Item</T>
              </Button>
            ) : null}

            <Button
              aria-label={gt("Refresh Cockpit")}
              disabled={loadingData}
              size="icon-xs"
              variant="outline"
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
              aria-label={gt("Disconnect Team Hub")}
              size="icon-xs"
              variant="ghost-muted"
              onClick={() => void handleDisconnect()}
            >
              <LogOutIcon />
            </Button>
          </div>
        ) : null}
      </WorkspacePageHeader>

      {isConnected ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2.5 border-b border-border/60 bg-background px-5 py-2 sm:px-6">
          <ToggleGroup
            size="segmented"
            value={[activeTab]}
            variant="segmented"
            onValueChange={(next) => {
              const value = next[0];
              if (
                value === "board" ||
                value === "triage" ||
                value === "releases" ||
                value === "memory" ||
                value === "setup"
              ) {
                setActiveTab(value);
              }
            }}
          >
            <Toggle value="board">
              <KanbanIcon />
              <T>Board</T>
            </Toggle>
            <Toggle value="triage">
              <PullRequestGlyph.pullRequest />
              <T>Review Triage</T>
              {reviewQueue && reviewQueue.items.length > 0 ? (
                <span className="font-mono text-2xs tabular-nums opacity-70">
                  {reviewQueue.items.length}
                </span>
              ) : null}
            </Toggle>
            <Toggle value="releases">
              <PackageCheckIcon />
              <T>Releases</T>
            </Toggle>
            <Toggle value="memory">
              <BrainIcon />
              <T>Memory & Digests</T>
            </Toggle>
            <Toggle value="setup">
              <SlidersHorizontalIcon />
              <T>Setup</T>
            </Toggle>
          </ToggleGroup>

          {overview ? (
            <div className="flex flex-wrap items-center gap-1.5">
              <CockpitStatPill
                active={activeTab === "board" && boardFilter === "all"}
                label={<T>Active</T>}
                tone="neutral"
                value={overview.metrics.activeWorkItems}
                onClick={() => {
                  setActiveTab("board");
                  setBoardFilter("all");
                }}
              />
              <CockpitStatPill
                active={activeTab === "board" && boardFilter === "blocked"}
                label={<T>Blocked</T>}
                tone="error"
                value={overview.metrics.blockedWorkItems}
                onClick={() => {
                  setActiveTab("board");
                  setBoardFilter("blocked");
                }}
              />
              <CockpitStatPill
                active={activeTab === "triage" && triageFilter === "blocked"}
                label={<T>Bot Blocked</T>}
                tone="error"
                value={overview.metrics.botBlockedChangeRequests}
                onClick={() => {
                  setActiveTab("triage");
                  setTriageFilter("blocked");
                }}
              />
              <CockpitStatPill
                active={activeTab === "triage" && triageFilter === "human"}
                label={<T>Human Review</T>}
                tone="info"
                value={overview.metrics.readyForHumanReviewCount}
                onClick={() => {
                  setActiveTab("triage");
                  setTriageFilter("human");
                }}
              />
              <CockpitStatPill
                active={activeTab === "triage" && triageFilter === "unlinked"}
                label={<T>Orphan PRs</T>}
                tone="warning"
                value={overview.metrics.orphanChangeRequests}
                onClick={() => {
                  setActiveTab("triage");
                  setTriageFilter("unlinked");
                }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="scrollbar-gutter-both min-h-0 min-w-0 flex-1 overflow-y-auto">
          {!primaryEnvironmentId ? (
            <WorkspacePageContainer width="expanded">
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
            <WorkspacePageContainer width="expanded">
              <p className="py-8 text-center text-sm text-muted-foreground">
                <T>Checking Team Hub connection...</T>
              </p>
            </WorkspacePageContainer>
          ) : !status?.connected ? (
            <WorkspacePageContainer width="expanded">
              <CockpitConnectCard
                environmentId={primaryEnvironmentId}
                initialHubUrl={status?.hubUrl}
                onConnected={handleConnected}
              />
            </WorkspacePageContainer>
          ) : activeTab === "board" ? (
            <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-4 px-5 py-4 sm:px-6">
              {errorMessage ? (
                <CockpitInlineAlert tone="error">{errorMessage}</CockpitInlineAlert>
              ) : null}

              {stages.length === 0 ? (
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
                          Create or select a project in Setup to track cross-repository work items
                          and workflow gates.
                        </T>
                      </EmptyDescription>
                    </EmptyHeader>
                    <EmptyContent>
                      <Button size="sm" variant="outline" onClick={() => setActiveTab("setup")}>
                        <SlidersHorizontalIcon />
                        <T>Open Setup</T>
                      </Button>
                    </EmptyContent>
                  </Empty>
                </CockpitSurface>
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2.5">
                    <div className="flex flex-wrap items-center gap-2">
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
                        </Toggle>
                        <Toggle value="has_pr">
                          <T>Has PR</T>
                        </Toggle>
                      </ToggleGroup>
                    </div>

                    {activeProject ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Badge size="sm" variant="outline">
                          {activeProject.workflowConfig.preset}
                        </Badge>
                        <span className="tabular-nums">
                          <T>
                            <Var>{overview?.repos.length ?? 0}</Var> repos
                          </T>
                        </span>
                      </div>
                    ) : null}
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
                              No work items match the active filter. Reset the filter to inspect all
                              stages.
                            </T>
                          </EmptyDescription>
                        </EmptyHeader>
                        <EmptyContent>
                          <Button size="sm" variant="outline" onClick={() => setBoardFilter("all")}>
                            <T>Show all items</T>
                          </Button>
                        </EmptyContent>
                      </Empty>
                    </CockpitSurface>
                  ) : boardView === "board" ? (
                    <div className="flex items-start gap-3.5 overflow-x-auto pb-4">
                      {stages.map((stage) => {
                        const stageCards = filteredCards.filter(
                          (card) => card.workItem.stage === stage.id,
                        );
                        return (
                          <CockpitSurface
                            key={stage.id}
                            className="flex w-76 shrink-0 flex-col gap-2.5"
                            padding="sm"
                            variant="subtle"
                          >
                            <CockpitSectionHeader count={stageCards.length} title={stage.label} />

                            <div className="flex flex-col gap-2">
                              {stageCards.map((card) => (
                                <WorkItemCardView
                                  key={card.workItem.id}
                                  card={card}
                                  gates={gates}
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
                                <p className="py-6 text-center text-xs text-muted-foreground/70">
                                  <T>No items</T>
                                </p>
                              ) : null}
                            </div>
                          </CockpitSurface>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="space-y-4 pb-4">
                      {stages.map((stage) => {
                        const stageCards = filteredCards.filter(
                          (card) => card.workItem.stage === stage.id,
                        );
                        if (stageCards.length === 0 && boardFilter !== "all") return null;
                        return (
                          <section key={stage.id} className="space-y-1.5">
                            <CockpitSectionHeader count={stageCards.length} title={stage.label} />
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
                              </CockpitSurface>
                            )}
                          </section>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>
          ) : (
            <WorkspacePageContainer className="py-5" width="expanded">
              {errorMessage ? (
                <CockpitInlineAlert tone="error">{errorMessage}</CockpitInlineAlert>
              ) : null}

              {activeTab === "triage" ? (
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

              {activeTab === "releases" ? (
                <CockpitReleasesTab
                  cards={allCards}
                  environmentId={primaryEnvironmentId}
                  refreshSignal={liveRefreshCount}
                  repos={overview?.repos ?? []}
                  selectedProjectId={selectedProjectId}
                  onOpenWorkItem={(workItemId) => setSelectedWorkItemId(workItemId)}
                />
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
              ) : null}
            </WorkspacePageContainer>
          )}
        </div>

        {isConnected && primaryEnvironmentId && selectedChangeRequest ? (
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
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>
              <T>New Work Item</T>
            </DialogTitle>
            <DialogDescription>
              <T>Create a cross-repository work item tracked in Team Cockpit.</T>
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
                    if (event.key === "Enter" && newTitle.trim() && !creatingItem) {
                      event.preventDefault();
                      void handleCreateWorkItem();
                    }
                  }}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
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
              </div>
              <div>
                <CockpitFieldLabel htmlFor="wi-spec">
                  <T>Spec / Acceptance Criteria (Markdown)</T>
                </CockpitFieldLabel>
                <Textarea
                  id="wi-spec"
                  placeholder={gt("Outline requirements, edge cases, and acceptance criteria")}
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
              disabled={creatingItem || !newTitle.trim()}
              variant="default"
              onClick={() => void handleCreateWorkItem()}
            >
              {creatingItem ? <T>Creating...</T> : <T>Create</T>}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      {primaryEnvironmentId ? (
        <WorkItemDetailDialog
          environmentId={primaryEnvironmentId}
          gates={gates}
          memory={memory}
          project={activeProject}
          repos={overview?.repos ?? []}
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
      className="space-y-2.5 transition-colors hover:border-border"
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
        {card.workItem.health === "blocked" ? (
          <Badge size="sm" variant="error">
            <T>Blocked</T>
          </Badge>
        ) : card.workItem.health === "at_risk" ? (
          <Badge size="sm" variant="warning">
            <T>At Risk</T>
          </Badge>
        ) : null}
      </div>

      <button
        className="block w-full cursor-pointer text-left text-sm leading-snug font-medium text-foreground underline-offset-2 hover:underline"
        type="button"
        onClick={onOpenDetail}
      >
        {card.workItem.title}
      </button>

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
        <div className="space-y-1">
          {card.changeRequests.map((cr) => {
            const isSelected = cr.id === selectedChangeRequestId;
            return (
              <button
                key={cr.id}
                className={cn(
                  "flex w-full cursor-pointer items-center justify-between gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors",
                  isSelected
                    ? "border-border bg-accent/65 text-foreground"
                    : "border-border/60 bg-muted/25 text-foreground hover:border-border hover:bg-accent/40",
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
        <div className="flex flex-wrap gap-1">
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
        <div className="flex flex-wrap gap-1">
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

      <div className="flex items-center justify-between gap-2 border-t border-border/40 pt-2">
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
  stages,
  gates,
  selectedChangeRequestId,
  onMoveStage,
  onApproveGate,
  onOpenDetail,
  onOpenChangeRequest,
}: WorkItemCardViewProps) {
  const latestGates = resolveLatestGateApprovals(card.gateApprovals);
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
      density="compact"
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
        {card.workItem.health === "blocked" ? (
          <Badge size="sm" variant="error">
            <T>Blocked</T>
          </Badge>
        ) : card.workItem.health === "at_risk" ? (
          <Badge size="sm" variant="warning">
            <T>At Risk</T>
          </Badge>
        ) : null}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
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
