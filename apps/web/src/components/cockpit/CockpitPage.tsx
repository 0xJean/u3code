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
import type {
  ChangeRequestAudit,
  CockpitWorkItemCard,
  ProjectDirective,
  WorkItemPriority,
  WorkItemType,
} from "@u3code/hub-contracts";
import * as AsyncResult from "effect/reactivity/AsyncResult";
import { T, useGT, Var } from "gt-react";
import {
  AlertTriangleIcon,
  BotIcon,
  BrainIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  FileTextIcon,
  KanbanIcon,
  LogOutIcon,
  PackageCheckIcon,
  PlusIcon,
  RadioIcon,
  RefreshCwIcon,
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
import { Input } from "~/components/ui/input";
import { SidebarInset } from "~/components/ui/sidebar";
import { Textarea } from "~/components/ui/textarea";
import { toastManager } from "~/components/ui/toast";
import { isElectron } from "~/env";
import { primaryEnvironmentIdAtom } from "~/state/primaryEnvironment";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { CockpitConnectCard } from "./CockpitConnectCard";
import { CockpitReleasesTab } from "./CockpitReleasesTab";
import { CockpitSettingsTab } from "./CockpitSettingsTab";
import { formatCockpitCommandError } from "./cockpitError";

type CockpitTab = "board" | "triage" | "releases" | "memory" | "setup";

function healthBadgeVariant(health: string): "success" | "warning" | "error" {
  if (health === "blocked") return "error";
  if (health === "at_risk") return "warning";
  return "success";
}

function triageBucketLabel(bucket: string, gt: ReturnType<typeof useGT>): string {
  switch (bucket) {
    case "bot_blocked":
      return gt("Bot-Blocked Review");
    case "ready_for_human_review":
      return gt("Ready for Human Review");
    case "ci_blocked":
      return gt("CI / Quality Blocked");
    case "orphan":
      return gt("Orphan PRs (No Work Item)");
    case "auto_merged_integration":
      return gt("Auto-Merged (Integration)");
    case "draft":
      return gt("Draft");
    default:
      return bucket;
  }
}

function triageBucketVariant(
  bucket: string,
): "error" | "warning" | "info" | "success" | "secondary" {
  switch (bucket) {
    case "bot_blocked":
    case "ci_blocked":
      return "error";
    case "orphan":
      return "warning";
    case "ready_for_human_review":
      return "info";
    case "auto_merged_integration":
      return "success";
    default:
      return "secondary";
  }
}

export function CockpitPage() {
  const gt = useGT();
  const primaryEnvironmentId = useAtomValue(primaryEnvironmentIdAtom);
  const [activeTab, setActiveTab] = useState<CockpitTab>("board");
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
  const [newDirectiveText, setNewDirectiveText] = useState("");
  const [savingDirectives, setSavingDirectives] = useState(false);
  const [liveRefreshCount, setLiveRefreshCount] = useState(0);

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

  const handleConnected = (nextStatus: TeamHubStatusResult) => {
    setStatus(nextStatus);
    const firstWorkspaceId = nextStatus.me?.workspaces[0]?.id ?? "";
    setSelectedWorkspaceId(firstWorkspaceId);
    setSelectedProjectId("");
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

  const handleAddDirective = () => {
    const trimmed = newDirectiveText.trim();
    if (!trimmed) return;
    const current = memory?.directives ?? [];
    const next: ProjectDirective = {
      id: `dir_${Date.now().toString(36)}`,
      text: trimmed,
      createdBy: status?.me?.user.displayName ?? "owner",
      createdAt: new Date().toISOString(),
      active: true,
    };
    setNewDirectiveText("");
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

  const handleLiveHubEvent = (_event: HubWsEvent) => {
    setLiveRefreshCount((count) => count + 1);
    if (primaryEnvironmentId && selectedWorkspaceId) {
      void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, selectedProjectId);
    }
  };

  return (
    <SidebarInset className="flex h-dvh flex-col overflow-hidden">
      {primaryEnvironmentId && status?.connected && selectedWorkspaceId ? (
        <CockpitLiveEventsBridge
          environmentId={primaryEnvironmentId}
          workspaceId={selectedWorkspaceId}
          onEvent={handleLiveHubEvent}
        />
      ) : null}
      <WorkspacePageHeader electron={isElectron}>
        <WorkspaceBreadcrumb ariaLabel={gt("Team Cockpit")}>
          <WorkspaceBreadcrumbItem>
            <span className="font-medium text-foreground">
              <T>Team Cockpit</T>
            </span>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>

        {status?.connected && status.me ? (
          <div className="ml-auto flex items-center gap-2 [-webkit-app-region:no-drag]">
            <Badge size="sm" variant="success">
              <RadioIcon />
              <T>Live</T>
            </Badge>
            {status.me.workspaces.length > 0 ? (
              <select
                aria-label={gt("Workspace")}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
                value={selectedWorkspaceId}
                onChange={(event) => {
                  const nextWs = event.target.value;
                  setSelectedWorkspaceId(nextWs);
                  setSelectedProjectId("");
                  if (primaryEnvironmentId) {
                    void loadCockpitData(primaryEnvironmentId, nextWs, "");
                  }
                }}
              >
                {status.me.workspaces.map((ws) => (
                  <option key={ws.id} value={ws.id}>
                    {ws.name}
                  </option>
                ))}
              </select>
            ) : null}

            {overview && overview.projects.length > 0 ? (
              <select
                aria-label={gt("Project")}
                className="h-7 rounded-md border border-input bg-background px-2 text-xs text-foreground outline-none"
                value={selectedProjectId}
                onChange={(event) => {
                  const nextProj = event.target.value;
                  setSelectedProjectId(nextProj);
                  if (primaryEnvironmentId) {
                    void loadCockpitData(primaryEnvironmentId, selectedWorkspaceId, nextProj);
                  }
                }}
              >
                {overview.projects.map((proj) => (
                  <option key={proj.id} value={proj.id}>
                    {proj.key} · {proj.name}
                  </option>
                ))}
              </select>
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
              <RefreshCwIcon />
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        <WorkspacePageContainer width="expanded">
          {!primaryEnvironmentId ? (
            <p className="text-sm text-muted-foreground">
              <T>Connect to a T3 Code server environment first to use Team Cockpit.</T>
            </p>
          ) : loadingStatus ? (
            <p className="text-sm text-muted-foreground">
              <T>Checking Team Hub connection...</T>
            </p>
          ) : !status?.connected ? (
            <CockpitConnectCard
              environmentId={primaryEnvironmentId}
              initialHubUrl={status?.hubUrl}
              onConnected={handleConnected}
            />
          ) : (
            <div className="space-y-6">
              {errorMessage ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                  {errorMessage}
                </div>
              ) : null}

              {overview ? (
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <MetricTile label={gt("Active Items")} value={overview.metrics.activeWorkItems} />
                  <MetricTile
                    label={gt("Blocked")}
                    tone={overview.metrics.blockedWorkItems > 0 ? "error" : "default"}
                    value={overview.metrics.blockedWorkItems}
                  />
                  <MetricTile
                    label={gt("At Risk")}
                    tone={overview.metrics.atRiskWorkItems > 0 ? "warning" : "default"}
                    value={overview.metrics.atRiskWorkItems}
                  />
                  <MetricTile
                    label={gt("Bot Blocked PRs")}
                    tone={overview.metrics.botBlockedChangeRequests > 0 ? "error" : "default"}
                    value={overview.metrics.botBlockedChangeRequests}
                  />
                  <MetricTile
                    label={gt("Human Review")}
                    tone={overview.metrics.readyForHumanReviewCount > 0 ? "info" : "default"}
                    value={overview.metrics.readyForHumanReviewCount}
                  />
                  <MetricTile
                    label={gt("Orphan PRs")}
                    tone={overview.metrics.orphanChangeRequests > 0 ? "warning" : "default"}
                    value={overview.metrics.orphanChangeRequests}
                  />
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant={activeTab === "board" ? "default" : "ghost"}
                    onClick={() => setActiveTab("board")}
                  >
                    <KanbanIcon />
                    <T>Board</T>
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === "triage" ? "default" : "ghost"}
                    onClick={() => setActiveTab("triage")}
                  >
                    <PullRequestGlyph.pullRequest />
                    <T>Review Triage</T>
                    {reviewQueue && reviewQueue.items.length > 0 ? (
                      <Badge size="sm" variant="secondary">
                        {reviewQueue.items.length}
                      </Badge>
                    ) : null}
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === "releases" ? "default" : "ghost"}
                    onClick={() => setActiveTab("releases")}
                  >
                    <PackageCheckIcon />
                    <T>Releases</T>
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === "memory" ? "default" : "ghost"}
                    onClick={() => setActiveTab("memory")}
                  >
                    <BrainIcon />
                    <T>Memory & Digests</T>
                  </Button>
                  <Button
                    size="sm"
                    variant={activeTab === "setup" ? "default" : "ghost"}
                    onClick={() => setActiveTab("setup")}
                  >
                    <SlidersHorizontalIcon />
                    <T>Setup</T>
                  </Button>
                </div>

                {activeProject ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge size="sm" variant="outline">
                      {activeProject.workflowConfig.preset}
                    </Badge>
                    <span>
                      {overview?.repos.length ?? 0} <T>repos</T>
                    </span>
                  </div>
                ) : null}
              </div>

              {activeTab === "board" ? (
                stages.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                    <T>
                      No project selected or configured in this workspace yet. Create a project in
                      u3code-hub to start tracking work items.
                    </T>
                  </div>
                ) : (
                  <div className="flex gap-4 overflow-x-auto pb-4">
                    {stages.map((stage) => {
                      const stageCards = (overview?.cards ?? []).filter(
                        (card) => card.workItem.stage === stage.id,
                      );
                      return (
                        <div
                          key={stage.id}
                          className="flex w-72 shrink-0 flex-col gap-3 rounded-xl border border-border bg-muted/25 p-3"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold tracking-wide text-foreground uppercase">
                              {stage.label}
                            </span>
                            <Badge size="sm" variant="secondary">
                              {stageCards.length}
                            </Badge>
                          </div>

                          <div className="flex flex-col gap-2.5">
                            {stageCards.map((card) => (
                              <WorkItemCardView
                                key={card.workItem.id}
                                card={card}
                                gates={gates}
                                stages={stages}
                                onApproveGate={(gateKey) =>
                                  void handleApproveGate(card.workItem.id, gateKey)
                                }
                                onMoveStage={(nextStage) =>
                                  void handleMoveStage(card.workItem.id, nextStage)
                                }
                              />
                            ))}
                            {stageCards.length === 0 ? (
                              <p className="py-4 text-center text-xs text-muted-foreground">
                                <T>Empty</T>
                              </p>
                            ) : null}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : null}

              {activeTab === "triage" ? <TriageQueueView reviewQueue={reviewQueue} /> : null}

              {activeTab === "releases" ? (
                <CockpitReleasesTab
                  environmentId={primaryEnvironmentId}
                  refreshSignal={liveRefreshCount}
                  selectedProjectId={selectedProjectId}
                />
              ) : null}

              {activeTab === "memory" ? (
                <div className="grid gap-6 lg:grid-cols-2">
                  <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BrainIcon className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold text-foreground">
                          <T>Living Project Memory</T>
                        </h3>
                      </div>
                      {memory ? (
                        <Badge size="sm" variant="outline">
                          v{memory.version}
                        </Badge>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                        <T>Owner Directives (Locked Against AI Overwrite)</T>
                      </h4>
                      <div className="space-y-1.5">
                        {(memory?.directives ?? []).map((directive) => (
                          <div
                            key={directive.id}
                            className="flex items-start justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs"
                          >
                            <span
                              className={
                                directive.active
                                  ? "text-foreground"
                                  : "text-muted-foreground line-through"
                              }
                            >
                              {directive.text}
                            </span>
                            <Button
                              disabled={savingDirectives}
                              size="micro"
                              variant="ghost"
                              onClick={() => handleToggleDirective(directive.id)}
                            >
                              {directive.active ? <T>Disable</T> : <T>Enable</T>}
                            </Button>
                          </div>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <Input
                          placeholder={gt("Add permanent rule (e.g. Never auto-merge main)")}
                          size="sm"
                          value={newDirectiveText}
                          onChange={(event) => setNewDirectiveText(event.target.value)}
                        />
                        <Button
                          disabled={savingDirectives || !newDirectiveText.trim()}
                          size="sm"
                          onClick={handleAddDirective}
                        >
                          <T>Add</T>
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                        <T>Architecture Decisions</T>
                      </h4>
                      {(memory?.architectureDecisions ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          <T>No decisions synthesized yet. Generate a digest to distill them.</T>
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-xs">
                          {(memory?.architectureDecisions ?? []).map((adr) => (
                            <li
                              key={adr.id}
                              className="rounded-md border border-border bg-background p-2.5"
                            >
                              <div className="font-medium text-foreground">{adr.summary}</div>
                              <div className="mt-0.5 text-muted-foreground">
                                {adr.date} {adr.repoFullName ? `· ${adr.repoFullName}` : ""}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>

                    <div className="space-y-2 pt-2">
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase">
                        <T>Recurring Risks</T>
                      </h4>
                      {(memory?.recurringRisks ?? []).length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          <T>No active recurring risks recorded.</T>
                        </p>
                      ) : (
                        <ul className="space-y-1.5 text-xs">
                          {(memory?.recurringRisks ?? []).map((risk) => (
                            <li
                              key={risk.id}
                              className="flex items-start justify-between gap-2 rounded-md border border-border bg-background p-2.5"
                            >
                              <div>
                                <div className="font-medium text-foreground">{risk.title}</div>
                                <div className="mt-0.5 text-muted-foreground">
                                  {risk.mitigation}
                                </div>
                              </div>
                              <Badge
                                size="sm"
                                variant={risk.severity === "high" ? "error" : "warning"}
                              >
                                {risk.severity} ×{risk.occurrences}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  <div className="space-y-4 rounded-xl border border-border bg-card p-5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BotIcon className="size-4 text-muted-foreground" />
                        <h3 className="text-sm font-semibold text-foreground">
                          <T>AI Cockpit Digests</T>
                        </h3>
                      </div>
                      <Button
                        disabled={generatingDigest}
                        size="xs"
                        onClick={() => void handleGenerateDigest()}
                      >
                        <FileTextIcon />
                        {generatingDigest ? <T>Synthesizing...</T> : <T>Generate Digest</T>}
                      </Button>
                    </div>

                    {(digests?.digests ?? []).length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        <T>
                          No digests yet. Click Generate Digest to synthesize recent Pulses and PR
                          activity into an executive summary and update project memory.
                        </T>
                      </p>
                    ) : (
                      <div className="space-y-4">
                        {(digests?.digests ?? []).slice(0, 5).map((digest) => (
                          <div
                            key={digest.id}
                            className="rounded-lg border border-border bg-muted/20 p-3.5"
                          >
                            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
                              <Badge size="sm" variant="outline">
                                {digest.triggerType}
                              </Badge>
                              <span>{digest.createdAt.slice(0, 16).replace("T", " ")}</span>
                            </div>
                            <pre className="max-h-72 overflow-y-auto font-sans text-xs leading-relaxed whitespace-pre-wrap text-foreground">
                              {digest.markdownBody}
                            </pre>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
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
            </div>
          )}
        </WorkspacePageContainer>
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
            <div className="space-y-3">
              <div>
                <label
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                  htmlFor="wi-title"
                >
                  <T>Title</T>
                </label>
                <Input
                  id="wi-title"
                  placeholder={gt("e.g. Idempotent settlement outbox")}
                  value={newTitle}
                  onChange={(event) => setNewTitle(event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="wi-type"
                  >
                    <T>Type</T>
                  </label>
                  <select
                    id="wi-type"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    value={newType}
                    onChange={(event) => setNewType(event.target.value as WorkItemType)}
                  >
                    <option value="feature">feature</option>
                    <option value="refactor">refactor</option>
                    <option value="bug">bug</option>
                    <option value="chore">chore</option>
                    <option value="security">security</option>
                  </select>
                </div>
                <div>
                  <label
                    className="mb-1 block text-xs font-medium text-muted-foreground"
                    htmlFor="wi-priority"
                  >
                    <T>Priority</T>
                  </label>
                  <select
                    id="wi-priority"
                    className="h-8 w-full rounded-lg border border-input bg-background px-2 text-sm text-foreground"
                    value={newPriority}
                    onChange={(event) => setNewPriority(event.target.value as WorkItemPriority)}
                  >
                    <option value="p0">P0</option>
                    <option value="p1">P1</option>
                    <option value="p2">P2</option>
                    <option value="p3">P3</option>
                  </select>
                </div>
              </div>
              <div>
                <label
                  className="mb-1 block text-xs font-medium text-muted-foreground"
                  htmlFor="wi-spec"
                >
                  <T>Spec / Acceptance Criteria (Markdown)</T>
                </label>
                <Textarea
                  id="wi-spec"
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
              onClick={() => void handleCreateWorkItem()}
            >
              {creatingItem ? <T>Creating...</T> : <T>Create</T>}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
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

function MetricTile({
  label,
  value,
  tone = "default",
}: {
  readonly label: string;
  readonly value: number;
  readonly tone?: "default" | "error" | "warning" | "info";
}) {
  const valueClass =
    tone === "error"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning-foreground"
        : tone === "info"
          ? "text-info-foreground"
          : "text-foreground";
  return (
    <div className="rounded-xl border border-border bg-card px-3.5 py-2.5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${valueClass}`}>{value}</div>
    </div>
  );
}

function WorkItemCardView({
  card,
  stages,
  gates,
  onMoveStage,
  onApproveGate,
}: {
  readonly card: CockpitWorkItemCard;
  readonly stages: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly gates: ReadonlyArray<{
    readonly key: string;
    readonly label: string;
    readonly beforeStage: string;
    readonly optional?: boolean | undefined;
  }>;
  readonly onMoveStage: (nextStage: string) => void;
  readonly onApproveGate: (gateKey: string) => void;
}) {
  const approvedKeys = new Set(
    card.gateApprovals.filter((g) => g.status === "approved").map((g) => g.gateKey),
  );
  const currentIdx = stages.findIndex((s) => s.id === card.workItem.stage);
  const nextStage = currentIdx >= 0 ? stages[currentIdx + 1] : undefined;
  const pendingGatesForNext = nextStage
    ? gates.filter((g) => g.beforeStage === nextStage.id && !g.optional && !approvedKeys.has(g.key))
    : [];

  return (
    <div className="space-y-2.5 rounded-lg border border-border bg-card p-3 shadow-2xs">
      <div className="flex items-center justify-between gap-1.5">
        <span className="font-mono text-xs font-medium text-muted-foreground">
          {card.workItem.code}
        </span>
        <div className="flex items-center gap-1">
          <Badge size="sm" variant="outline">
            {card.workItem.priority.toUpperCase()}
          </Badge>
          <Badge size="sm" variant={healthBadgeVariant(card.workItem.health)}>
            {card.workItem.health}
          </Badge>
        </div>
      </div>

      <div className="text-sm leading-snug font-medium text-foreground">{card.workItem.title}</div>

      {card.checklistTotalCount > 0 ? (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CheckCircle2Icon className="size-3.5" />
          <span>
            AC {card.checklistVerifiedCount}/{card.checklistTotalCount}
          </span>
        </div>
      ) : null}

      {card.changeRequests.length > 0 ? (
        <div className="space-y-1">
          {card.changeRequests.map((cr) => (
            <a
              key={cr.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs hover:bg-muted/60"
              href={cr.url}
              rel="noreferrer"
              target="_blank"
            >
              <span className="truncate text-foreground">
                {cr.repoFullName.split("/").at(-1)}#{cr.number}
              </span>
              <Badge
                size="sm"
                variant={
                  cr.automatedReview.status === "blocking"
                    ? "error"
                    : cr.automatedReview.status === "auto_merged" ||
                        cr.automatedReview.status === "pass"
                      ? "success"
                      : "secondary"
                }
              >
                {cr.automatedReview.status}
              </Badge>
            </a>
          ))}
        </div>
      ) : null}

      {card.latestPulse ? (
        <p className="line-clamp-2 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
          {card.latestPulse.doneSummary}
        </p>
      ) : null}

      {pendingGatesForNext.length > 0 ? (
        <div className="flex flex-wrap gap-1 pt-0.5">
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

      {nextStage ? (
        <div className="flex justify-end pt-1">
          <Button size="micro" variant="outline" onClick={() => onMoveStage(nextStage.id)}>
            → {nextStage.label}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function TriageQueueView({
  reviewQueue,
}: {
  readonly reviewQueue: TeamHubReviewQueueResult | null;
}) {
  const gt = useGT();
  const bucketOrder = [
    "bot_blocked",
    "ready_for_human_review",
    "ci_blocked",
    "orphan",
    "auto_merged_integration",
    "draft",
  ];

  const grouped = reviewQueue?.grouped ?? {};
  const activeBuckets = bucketOrder.filter((bucket) => (grouped[bucket]?.length ?? 0) > 0);

  if (activeBuckets.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        <T>All caught up: no open pull requests require triage.</T>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {activeBuckets.map((bucket) => {
        const items: ReadonlyArray<ChangeRequestAudit> = grouped[bucket] ?? [];
        return (
          <div key={bucket} className="space-y-2.5">
            <div className="flex items-center gap-2">
              <Badge variant={triageBucketVariant(bucket)}>{triageBucketLabel(bucket, gt)}</Badge>
              <span className="text-xs text-muted-foreground">{items.length}</span>
            </div>

            <div className="space-y-2">
              {items.map((cr) => (
                <div
                  key={cr.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-3"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <a
                        className="inline-flex items-center gap-1 text-sm font-medium text-foreground hover:underline"
                        href={cr.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        <span>
                          {cr.repoFullName}#{cr.number}
                        </span>
                        <ExternalLinkIcon className="size-3" />
                      </a>
                      <span className="text-sm text-foreground">{cr.title}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>@{cr.authorVcsLogin}</span>
                      <span>
                        {cr.headBranch} → {cr.baseBranch} ({cr.baseBranchRole})
                      </span>
                      <span className="font-mono">
                        +{cr.additions}/-{cr.deletions}
                      </span>
                      {cr.isOversized ? (
                        <Badge size="sm" variant="warning">
                          <AlertTriangleIcon />
                          <T>Oversized</T>
                        </Badge>
                      ) : null}
                      <Badge
                        size="sm"
                        variant={
                          cr.qualitySignals.ciStatus === "failure"
                            ? "error"
                            : cr.qualitySignals.ciStatus === "success"
                              ? "success"
                              : "secondary"
                        }
                      >
                        <T>
                          CI: <Var>{cr.qualitySignals.ciStatus}</Var>
                        </T>
                      </Badge>
                    </div>

                    {cr.automatedReview.reviewers.length > 0 ? (
                      <div className="space-y-1 pt-1">
                        {cr.automatedReview.reviewers.map((finding) => (
                          <div
                            key={`${finding.reviewerName}:${finding.updatedAt}:${finding.state}`}
                            className="rounded-md bg-muted/40 px-2.5 py-1.5 text-xs text-muted-foreground"
                          >
                            <span className="font-medium text-foreground">
                              {finding.reviewerName}
                            </span>{" "}
                            [{finding.state}]: {finding.bodyExcerpt}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
