import type { CockpitOverview, EnvironmentId, TeamHubStatusResult } from "@t3tools/contracts";
import type {
  ForgeKind,
  HubPluginSummary,
  NotificationChannelSummary,
  NotificationEventKind,
  NotifierDriverKind,
  RegisteredWorkflowPreset,
  RepoPolicy,
  WorkspaceMember,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  BellIcon,
  CheckIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LayersIcon,
  PlusIcon,
  PuzzleIcon,
  RefreshCwIcon,
  SendIcon,
  Trash2Icon,
  UserCogIcon,
  UserPlusIcon,
  UsersIcon,
  WorkflowIcon,
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "~/components/ui/empty";
import { Input } from "~/components/ui/input";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Switch } from "~/components/ui/switch";
import { Toggle, ToggleGroup } from "~/components/ui/toggle-group";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import {
  CockpitFieldLabel,
  CockpitSectionHeader,
  CockpitStatusDot,
  CockpitSurface,
  CockpitSurfaceRow,
} from "./CockpitPrimitives";
import { formatCockpitCommandError } from "./cockpitError";

interface CockpitSettingsTabProps {
  readonly environmentId: EnvironmentId;
  readonly status: TeamHubStatusResult;
  readonly selectedWorkspaceId: string;
  readonly selectedProjectId: string;
  readonly overview: CockpitOverview | null;
  readonly onRefreshAll: (nextWorkspaceId?: string, nextProjectId?: string) => void;
}

type SetupSection = "overview" | "team" | "notifications" | "plugins";

const DEFAULT_EVENTS: ReadonlyArray<NotificationEventKind> = [
  "digest.ready",
  "pr.bot_blocked",
  "pr.ready_for_human_review",
  "blocker.needs_attention",
  "release.ready",
];

const WORKSPACE_ROLES = ["owner", "pm", "qa", "ops", "security", "dev"] as const;
type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];

const FORGE_OPTIONS: ReadonlyArray<{ readonly value: ForgeKind; readonly label: string }> = [
  { value: "github", label: "GitHub" },
  { value: "gitlab", label: "GitLab" },
];

const NOTIFIER_DRIVERS: ReadonlyArray<NotifierDriverKind> = ["lark", "webhook", "slack", "discord"];

function getRoleLabel(role: string, gt: ReturnType<typeof useGT>): string {
  switch (role) {
    case "owner":
      return gt("Owner", { $context: "workspace member role" });
    case "pm":
      return gt("PM", { $context: "workspace member role, product manager" });
    case "qa":
      return gt("QA", { $context: "workspace member role, quality assurance" });
    case "ops":
      return gt("Ops", { $context: "workspace member role, operations" });
    case "security":
      return gt("Security", { $context: "workspace member role" });
    case "dev":
      return gt("Dev", { $context: "workspace member role, developer" });
    default:
      return role;
  }
}

function getDriverLabel(driver: NotifierDriverKind, gt: ReturnType<typeof useGT>): string {
  switch (driver) {
    case "lark":
      return gt("Lark / Feishu");
    case "webhook":
      return gt("Generic Webhook");
    case "slack":
      return gt("Slack");
    case "discord":
      return gt("Discord");
  }
}

function getForgeLabel(forge: ForgeKind): string {
  return forge === "gitlab" ? "GitLab" : "GitHub";
}

function getBranchRoleLabel(role: string, gt: ReturnType<typeof useGT>): string {
  switch (role) {
    case "integration":
      return gt("integration", { $context: "git branch policy role" });
    case "release":
      return gt("release", { $context: "git branch policy role" });
    default:
      return role;
  }
}

export function CockpitSettingsTab({
  environmentId,
  status,
  selectedWorkspaceId,
  selectedProjectId,
  overview,
  onRefreshAll,
}: CockpitSettingsTabProps) {
  const gt = useGT();
  const [activeSection, setActiveSection] = useState<SetupSection>("overview");

  // Creation dialog open states
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [projectDialogOpen, setProjectDialogOpen] = useState(false);
  const [repoDialogOpen, setRepoDialogOpen] = useState(false);
  const [memberDialogOpen, setMemberDialogOpen] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);

  // Workspace creation
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);

  // Project creation
  const [projKey, setProjKey] = useState("");
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projPreset, setProjPreset] = useState<string>("full-delivery");
  const [creatingProj, setCreatingProj] = useState(false);

  // Hub plugins & dynamic workflow presets
  const [hubPlugins, setHubPlugins] = useState<ReadonlyArray<HubPluginSummary>>([]);
  const [workflowPresets, setWorkflowPresets] = useState<ReadonlyArray<RegisteredWorkflowPreset>>(
    [],
  );

  // Repo + Policy binding
  const [repoFullName, setRepoFullName] = useState("");
  const [forgeKind, setForgeKind] = useState<ForgeKind>("github");
  const [integrationBranch, setIntegrationBranch] = useState("dev");
  const [releaseBranch, setReleaseBranch] = useState("main");
  const [botName, setBotName] = useState("");
  const [botLogins, setBotLogins] = useState("");
  const [maxPrLines, setMaxPrLines] = useState("500");
  const [addingRepo, setAddingRepo] = useState(false);

  // Notification channels
  const [channels, setChannels] = useState<ReadonlyArray<NotificationChannelSummary>>([]);
  const [channelDriver, setChannelDriver] = useState<NotifierDriverKind>("lark");
  const [channelName, setChannelName] = useState("");
  const [channelWebhookUrl, setChannelWebhookUrl] = useState("");
  const [channelSecret, setChannelSecret] = useState("");
  const [creatingChannel, setCreatingChannel] = useState(false);

  // Personal profile & @mention handles
  const [profileDisplayName, setProfileDisplayName] = useState(status.me?.user.displayName ?? "");
  const [profileVcsLogin, setProfileVcsLogin] = useState(status.me?.user.primaryVcsLogin ?? "");
  const [larkHandle, setLarkHandle] = useState(status.me?.user.notificationHandles.lark ?? "");
  const [slackHandle, setSlackHandle] = useState(status.me?.user.notificationHandles.slack ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Workspace members & multi-role assignments
  const [members, setMembers] = useState<ReadonlyArray<WorkspaceMember>>([]);
  const [updatingMemberId, setUpdatingMemberId] = useState<string | null>(null);
  const [newMemberIdentifier, setNewMemberIdentifier] = useState("");
  const [newMemberRole, setNewMemberRole] = useState<WorkspaceRole>("dev");
  const [addingMember, setAddingMember] = useState(false);

  // Row-level busy states
  const [removingRepoId, setRemovingRepoId] = useState<string | null>(null);
  const [syncingRepoId, setSyncingRepoId] = useState<string | null>(null);
  const [busyChannelId, setBusyChannelId] = useState<string | null>(null);
  const [testingChannelId, setTestingChannelId] = useState<string | null>(null);

  const createWorkspace = useAtomCommand(teamHubEnvironment.createWorkspace, {
    reportFailure: false,
  });
  const createProject = useAtomCommand(teamHubEnvironment.createProject, { reportFailure: false });
  const addProjectRepo = useAtomCommand(teamHubEnvironment.addProjectRepo, {
    reportFailure: false,
  });
  const deleteProjectRepo = useAtomCommand(teamHubEnvironment.deleteProjectRepo, {
    reportFailure: false,
  });
  const listChannels = useAtomCommand(teamHubEnvironment.listNotificationChannels, {
    reportFailure: false,
  });
  const createChannel = useAtomCommand(teamHubEnvironment.createNotificationChannel, {
    reportFailure: false,
  });
  const toggleChannel = useAtomCommand(teamHubEnvironment.toggleNotificationChannel, {
    reportFailure: false,
  });
  const deleteChannel = useAtomCommand(teamHubEnvironment.deleteNotificationChannel, {
    reportFailure: false,
  });
  const updateProfile = useAtomCommand(teamHubEnvironment.updateProfile, { reportFailure: false });
  const listMembers = useAtomCommand(teamHubEnvironment.listMembers, { reportFailure: false });
  const addMember = useAtomCommand(teamHubEnvironment.addMember, { reportFailure: false });
  const updateMemberRoles = useAtomCommand(teamHubEnvironment.updateMemberRoles, {
    reportFailure: false,
  });
  const listPlugins = useAtomCommand(teamHubEnvironment.listPlugins, { reportFailure: false });
  const syncProjectRepo = useAtomCommand(teamHubEnvironment.syncProjectRepo, {
    reportFailure: false,
  });
  const testChannel = useAtomCommand(teamHubEnvironment.testNotificationChannel, {
    reportFailure: false,
  });

  const loadHubPlugins = useEffectEvent((envId: EnvironmentId, cancelled: () => boolean) => {
    void listPlugins({ environmentId: envId, input: {} }).then((res) => {
      if (cancelled()) return;
      if (res._tag === "Success") {
        setHubPlugins(res.value.plugins);
        setWorkflowPresets(res.value.workflowPresets);
      }
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize installed Hub plugins and plugin-registered workflow presets from external Team Hub API.
  useEffect(() => {
    let cancelled = false;
    loadHubPlugins(environmentId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId]);

  const loadWorkspaceMeta = useEffectEvent(
    (envId: EnvironmentId, wsId: string, cancelled: () => boolean) => {
      void Promise.all([
        listChannels({ environmentId: envId, input: { workspaceId: wsId } }),
        listMembers({ environmentId: envId, input: { workspaceId: wsId } }),
      ]).then(([chRes, memRes]) => {
        if (cancelled()) return;
        if (chRes._tag === "Success") {
          setChannels(chRes.value.channels);
        }
        if (memRes._tag === "Success") {
          setMembers(memRes.value.members);
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize workspace notification channels and members from external Team Hub API when workspace changes.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let cancelled = false;
    loadWorkspaceMeta(environmentId, selectedWorkspaceId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, selectedWorkspaceId]);

  const visibleChannels = selectedWorkspaceId ? channels : [];
  const visibleMembers = selectedWorkspaceId ? members : [];
  const repos = overview?.repos ?? [];
  const activeWorkspace = status.me?.workspaces.find((ws) => ws.id === selectedWorkspaceId) ?? null;
  const activeProject = overview?.project ?? null;

  const fallbackPresets: ReadonlyArray<{ readonly id: string; readonly label: string }> = [
    {
      id: "full-delivery",
      label: gt("Full delivery (Scoping → PRD → Dev → QA → Review → Staging → Done)"),
    },
    {
      id: "lean",
      label: gt("Lean (Backlog → In Progress → Review → Done)"),
    },
  ];
  const presetOptions =
    workflowPresets.length > 0
      ? workflowPresets.map((preset) => ({ id: preset.id, label: preset.label }))
      : fallbackPresets;
  const effectiveProjPreset = presetOptions.some((option) => option.id === projPreset)
    ? projPreset
    : (presetOptions[0]?.id ?? "full-delivery");
  const selectedPresetLabel =
    presetOptions.find((option) => option.id === effectiveProjPreset)?.label ?? effectiveProjPreset;

  const handleCreateWorkspace = async () => {
    const slug = wsSlug.trim().toLowerCase() || wsName.trim().toLowerCase().replace(/\s+/g, "-");
    if (!wsName.trim() || !slug) return;
    setCreatingWs(true);
    const res = await createWorkspace({
      environmentId,
      input: { slug, name: wsName.trim() },
    });
    setCreatingWs(false);
    if (res._tag === "Success") {
      setWsName("");
      setWsSlug("");
      setWorkspaceDialogOpen(false);
      toastManager.add({ title: gt("Workspace created"), type: "success" });
      onRefreshAll(res.value.workspace.id, "");
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to create workspace.")),
        type: "error",
      });
    }
  };

  const handleCreateProject = async () => {
    if (!selectedWorkspaceId || !projKey.trim() || !projName.trim()) return;
    setCreatingProj(true);
    const res = await createProject({
      environmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        key: projKey.trim().toUpperCase(),
        name: projName.trim(),
        ...(projDesc.trim() ? { description: projDesc.trim() } : {}),
        preset: effectiveProjPreset,
      },
    });
    setCreatingProj(false);
    if (res._tag === "Success") {
      setProjKey("");
      setProjName("");
      setProjDesc("");
      setProjectDialogOpen(false);
      toastManager.add({ title: gt("Project created"), type: "success" });
      onRefreshAll(selectedWorkspaceId, res.value.project.id);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to create project.")),
        type: "error",
      });
    }
  };

  const handleAddRepo = async () => {
    if (!selectedProjectId || !repoFullName.trim()) return;
    const branches: Array<{
      name: string;
      role: "integration" | "release" | "other";
      mergePolicy: "auto_on_low_risk" | "manual";
    }> = [];
    if (integrationBranch.trim()) {
      branches.push({
        name: integrationBranch.trim(),
        role: "integration",
        mergePolicy: "auto_on_low_risk",
      });
    }
    if (releaseBranch.trim()) {
      branches.push({
        name: releaseBranch.trim(),
        role: "release",
        mergePolicy: "manual",
      });
    }

    const parsedBotLogins = botLogins
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    const automatedReviewers =
      botName.trim() && parsedBotLogins.length > 0
        ? [
            {
              name: botName.trim(),
              botLogins: parsedBotLogins,
              blockingStates: ["CHANGES_REQUESTED"],
            },
          ]
        : [];

    const parsedLines = Number.parseInt(maxPrLines, 10);
    const repoPolicy: RepoPolicy = {
      branches:
        branches.length > 0 ? branches : [{ name: "main", role: "release", mergePolicy: "manual" }],
      automatedReviewers,
      qualitySignals: [],
      maxPrChangedLines: Number.isFinite(parsedLines) && parsedLines > 0 ? parsedLines : 500,
      environments: { staging: "staging", production: "production" },
    };

    setAddingRepo(true);
    const res = await addProjectRepo({
      environmentId,
      input: {
        projectId: selectedProjectId,
        forgeKind,
        repoFullName: repoFullName.trim(),
        repoPolicy,
      },
    });
    setAddingRepo(false);
    if (res._tag === "Success") {
      setRepoFullName("");
      setBotName("");
      setBotLogins("");
      setRepoDialogOpen(false);
      toastManager.add({ title: gt("Repository linked to project"), type: "success" });
      onRefreshAll(selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to add repository.")),
        type: "error",
      });
    }
  };

  const handleCreateChannel = async () => {
    if (!selectedWorkspaceId || !channelName.trim() || !channelWebhookUrl.trim()) return;
    setCreatingChannel(true);
    const res = await createChannel({
      environmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        projectId: selectedProjectId || null,
        driver: channelDriver,
        name: channelName.trim(),
        events: [...DEFAULT_EVENTS],
        webhookUrl: channelWebhookUrl.trim(),
        ...(channelSecret.trim() ? { secret: channelSecret.trim() } : {}),
      },
    });
    setCreatingChannel(false);
    if (res._tag === "Success") {
      setChannelName("");
      setChannelWebhookUrl("");
      setChannelSecret("");
      setChannelDialogOpen(false);
      setChannels((prev) => [...prev, res.value.channel]);
      toastManager.add({ title: gt("Notification channel added"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to add notification channel.")),
        type: "error",
      });
    }
  };

  const handleSaveProfile = async () => {
    setSavingProfile(true);
    const handles: Record<string, string> = {};
    if (larkHandle.trim()) handles.lark = larkHandle.trim();
    if (slackHandle.trim()) handles.slack = slackHandle.trim();
    const res = await updateProfile({
      environmentId,
      input: {
        ...(profileDisplayName.trim() ? { displayName: profileDisplayName.trim() } : {}),
        primaryVcsLogin: profileVcsLogin.trim() || null,
        notificationHandles: handles,
      },
    });
    setSavingProfile(false);
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Profile and @mention handles saved"), type: "success" });
      onRefreshAll(selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update profile.")),
        type: "error",
      });
    }
  };

  const handleToggleMemberRole = async (member: WorkspaceMember, role: string) => {
    if (!selectedWorkspaceId) return;
    const hasRole = member.roles.includes(role);
    const nextRoles = hasRole ? member.roles.filter((r) => r !== role) : [...member.roles, role];
    if (nextRoles.length === 0) {
      toastManager.add({ title: gt("A member must keep at least one role."), type: "error" });
      return;
    }
    setUpdatingMemberId(member.userId);
    const res = await updateMemberRoles({
      environmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        userId: member.userId,
        roles: nextRoles,
      },
    });
    setUpdatingMemberId(null);
    if (res._tag === "Success") {
      setMembers((prev) =>
        prev.map((m) => (m.userId === member.userId ? { ...m, roles: res.value.roles } : m)),
      );
      toastManager.add({ title: gt("Member roles updated"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update member roles.")),
        type: "error",
      });
    }
  };

  const handleAddMember = async () => {
    const trimmed = newMemberIdentifier.trim();
    if (!selectedWorkspaceId || !trimmed) return;
    setAddingMember(true);
    const res = await addMember({
      environmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        identifier: trimmed,
        roles: [newMemberRole],
      },
    });
    setAddingMember(false);
    if (res._tag === "Success") {
      setNewMemberIdentifier("");
      setMemberDialogOpen(false);
      setMembers((prev) => {
        const exists = prev.some((m) => m.userId === res.value.member.userId);
        return exists
          ? prev.map((m) => (m.userId === res.value.member.userId ? res.value.member : m))
          : [...prev, res.value.member];
      });
      toastManager.add({ title: gt("Member added to workspace"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to add workspace member.")),
        type: "error",
      });
    }
  };

  const handleDeleteRepo = async (repoId: string) => {
    if (!selectedProjectId) return;
    setRemovingRepoId(repoId);
    const res = await deleteProjectRepo({
      environmentId,
      input: { projectId: selectedProjectId, repoId },
    });
    setRemovingRepoId(null);
    if (res._tag === "Success") {
      toastManager.add({ title: gt("Repository unlinked"), type: "success" });
      onRefreshAll(selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to unlink repository.")),
        type: "error",
      });
    }
  };

  const handleSyncRepo = async (repoId: string) => {
    if (!selectedProjectId) return;
    setSyncingRepoId(repoId);
    const res = await syncProjectRepo({
      environmentId,
      input: { projectId: selectedProjectId, repoId },
    });
    setSyncingRepoId(null);
    if (res._tag === "Success") {
      toastManager.add({
        title: gt("Synced {count} open PRs ({linked} linked)", {
          count: res.value.syncedCount,
          linked: res.value.linkedCount,
        }),
        type: "success",
      });
      onRefreshAll(selectedWorkspaceId, selectedProjectId);
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to sync open PRs from GitHub.")),
        type: "error",
      });
    }
  };

  const handleTestChannel = async (channelId: string) => {
    if (!selectedWorkspaceId) return;
    setTestingChannelId(channelId);
    const res = await testChannel({
      environmentId,
      input: { workspaceId: selectedWorkspaceId, channelId },
    });
    setTestingChannelId(null);
    if (res._tag === "Success") {
      toastManager.add({
        title: res.value.mentioned
          ? gt("Test notification sent (with @mention)")
          : gt("Test notification sent"),
        type: "success",
      });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Test notification failed.")),
        type: "error",
      });
    }
  };

  const handleToggleChannel = async (channel: NotificationChannelSummary) => {
    if (!selectedWorkspaceId) return;
    setBusyChannelId(channel.id);
    const res = await toggleChannel({
      environmentId,
      input: {
        workspaceId: selectedWorkspaceId,
        channelId: channel.id,
        isEnabled: !channel.isEnabled,
      },
    });
    setBusyChannelId(null);
    if (res._tag === "Success") {
      setChannels((prev) => prev.map((c) => (c.id === channel.id ? res.value.channel : c)));
      toastManager.add({
        title: res.value.channel.isEnabled
          ? gt("Notification channel enabled")
          : gt("Notification channel disabled"),
        type: "success",
      });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to update notification channel.")),
        type: "error",
      });
    }
  };

  const handleDeleteChannel = async (channelId: string) => {
    if (!selectedWorkspaceId) return;
    setBusyChannelId(channelId);
    const res = await deleteChannel({
      environmentId,
      input: { workspaceId: selectedWorkspaceId, channelId },
    });
    setBusyChannelId(null);
    if (res._tag === "Success") {
      setChannels((prev) => prev.filter((c) => c.id !== channelId));
      toastManager.add({ title: gt("Notification channel deleted"), type: "success" });
    } else {
      toastManager.add({
        title: formatCockpitCommandError(res, gt("Failed to delete notification channel.")),
        type: "error",
      });
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Sub-Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ToggleGroup
          aria-label={gt("Setup sections")}
          size="segmented"
          value={[activeSection]}
          variant="segmented"
          onValueChange={(next) => {
            const value = next[0];
            if (
              value === "overview" ||
              value === "team" ||
              value === "notifications" ||
              value === "plugins"
            ) {
              setActiveSection(value);
            }
          }}
        >
          <Toggle value="overview">
            <T>Overview & Repos</T>
          </Toggle>
          <Toggle value="team">
            <T>Team & Profile</T>
          </Toggle>
          <Toggle value="notifications">
            <T>Notifications</T>
          </Toggle>
          <Toggle value="plugins">
            <T>Plugins & Packs</T>
          </Toggle>
        </ToggleGroup>
      </div>

      {/* Section 1: Overview & Repos */}
      {activeSection === "overview" ? (
        <div className="space-y-6">
          <section className="space-y-2.5">
            <CockpitSectionHeader
              action={
                <>
                  <Button size="xs" variant="outline" onClick={() => setWorkspaceDialogOpen(true)}>
                    <PlusIcon />
                    <T>New Workspace</T>
                  </Button>
                  <Button
                    disabled={!selectedWorkspaceId}
                    size="xs"
                    variant="outline"
                    onClick={() => setProjectDialogOpen(true)}
                  >
                    <FolderPlusIcon />
                    <T>New Project</T>
                  </Button>
                </>
              }
              icon={<LayersIcon />}
              title={<T>Workspace & Project</T>}
            />

            <CockpitSurface divided variant="grouped">
              <CockpitSurfaceRow className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium text-foreground">
                    <T>Hub Connection</T>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      <T>
                        Signed in as <Var>{status.me?.user.displayName ?? gt("user")}</Var>
                      </T>
                    </span>
                    {status.me?.user.primaryVcsLogin ? (
                      <span className="font-mono">@{status.me.user.primaryVcsLogin}</span>
                    ) : null}
                    {status.hubUrl ? (
                      <span className="font-mono text-muted-foreground/80">{status.hubUrl}</span>
                    ) : null}
                  </div>
                </div>
                <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <CockpitStatusDot ring tone="success" />
                  <span>
                    <T>Connected</T>
                  </span>
                </div>
              </CockpitSurfaceRow>

              <CockpitSurfaceRow className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium text-foreground">
                    <T>Active Workspace</T>
                  </div>
                  {activeWorkspace ? (
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span className="text-foreground">{activeWorkspace.name}</span>
                      <span className="font-mono">{activeWorkspace.slug}</span>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <T>Create or select a workspace to organize projects and team roles.</T>
                    </p>
                  )}
                </div>
                {activeWorkspace && activeWorkspace.roles.length > 0 ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {activeWorkspace.roles.map((role) => (
                      <Badge key={role} size="sm" variant="outline">
                        {getRoleLabel(role, gt)}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </CockpitSurfaceRow>

              <CockpitSurfaceRow className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0 space-y-0.5">
                  <div className="text-sm font-medium text-foreground">
                    <T>Active Project</T>
                  </div>
                  {activeProject ? (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-foreground">{activeProject.key}</span>
                        <span className="text-foreground">{activeProject.name}</span>
                      </div>
                      {activeProject.description ? <p>{activeProject.description}</p> : null}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      <T>Select or create a project to configure repositories and workflows.</T>
                    </p>
                  )}
                </div>
                {activeProject ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge size="sm" variant="secondary">
                      {activeProject.workflowConfig.preset}
                    </Badge>
                    <Badge size="sm" variant="outline">
                      <T>
                        <Var>{activeProject.workflowConfig.stages.length}</Var> stages
                      </T>
                    </Badge>
                    <Badge size="sm" variant="outline">
                      <T>
                        <Var>{activeProject.workflowConfig.gates.length}</Var> gates
                      </T>
                    </Badge>
                  </div>
                ) : null}
              </CockpitSurfaceRow>
            </CockpitSurface>
          </section>

          <section className="space-y-2.5">
            <CockpitSectionHeader
              action={
                <Button
                  disabled={!selectedProjectId}
                  size="xs"
                  variant={selectedProjectId && repos.length > 0 ? "default" : "outline"}
                  onClick={() => setRepoDialogOpen(true)}
                >
                  <PlusIcon />
                  <T>Link Repository</T>
                </Button>
              }
              count={repos.length}
              icon={<GitBranchIcon />}
              title={<T>Linked Repositories & Policy</T>}
            />

            {!selectedProjectId ? (
              <CockpitSurface variant="grouped">
                <Empty size="compact">
                  <EmptyMedia variant="icon">
                    <GitBranchIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>
                      <T>Select a project first</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>
                        Create or select a project to link repositories, branch merge rules, and
                        automated review bots.
                      </T>
                    </EmptyDescription>
                  </EmptyHeader>
                  {selectedWorkspaceId ? (
                    <EmptyContent>
                      <Button size="sm" onClick={() => setProjectDialogOpen(true)}>
                        <FolderPlusIcon />
                        <T>New Project</T>
                      </Button>
                    </EmptyContent>
                  ) : null}
                </Empty>
              </CockpitSurface>
            ) : repos.length === 0 ? (
              <CockpitSurface variant="grouped">
                <Empty size="compact">
                  <EmptyMedia variant="icon">
                    <GitBranchIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>
                      <T>No linked repositories</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>
                        Link a GitHub or GitLab repository to sync open pull requests, enforce PR
                        line thresholds, and track automated reviewers.
                      </T>
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="sm" onClick={() => setRepoDialogOpen(true)}>
                      <PlusIcon />
                      <T>Link Repository</T>
                    </Button>
                  </EmptyContent>
                </Empty>
              </CockpitSurface>
            ) : (
              <CockpitSurface divided variant="grouped">
                {repos.map((repo) => (
                  <CockpitSurfaceRow
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-3"
                    interactive
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-sm font-medium text-foreground">
                          {repo.repoFullName}
                        </span>
                        <Badge size="sm" variant="outline">
                          {getForgeLabel(repo.forgeKind)}
                        </Badge>
                        {repo.repoPolicy.maxPrChangedLines ? (
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            <T>
                              Max <Var>{repo.repoPolicy.maxPrChangedLines}</Var> lines
                            </T>
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {repo.repoPolicy.branches.map((branch) => (
                          <Badge key={branch.name} size="sm" variant="secondary">
                            {branch.name}: {getBranchRoleLabel(branch.role, gt)}
                          </Badge>
                        ))}
                        {repo.repoPolicy.automatedReviewers.map((bot) => (
                          <Badge key={bot.name} size="sm" variant="info">
                            <T>
                              Bot: <Var>{bot.name}</Var>
                            </T>
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-1.5">
                      {repo.forgeKind === "github" ? (
                        <Button
                          disabled={syncingRepoId === repo.id}
                          size="xs"
                          variant="outline"
                          onClick={() => void handleSyncRepo(repo.id)}
                        >
                          <RefreshCwIcon />
                          {syncingRepoId === repo.id ? <T>Syncing...</T> : <T>Sync PRs</T>}
                        </Button>
                      ) : null}
                      <Button
                        aria-label={gt("Remove repository")}
                        disabled={removingRepoId === repo.id}
                        size="icon-xs"
                        variant="ghost-destructive"
                        onClick={() => void handleDeleteRepo(repo.id)}
                      >
                        <Trash2Icon />
                      </Button>
                    </div>
                  </CockpitSurfaceRow>
                ))}
              </CockpitSurface>
            )}
          </section>
        </div>
      ) : null}

      {/* Section 2: Team & Profile */}
      {activeSection === "team" ? (
        <div className="space-y-6">
          <form
            className="space-y-2.5"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSaveProfile();
            }}
          >
            <CockpitSectionHeader
              action={
                <Button disabled={savingProfile} size="xs" type="submit">
                  {savingProfile ? <T>Saving...</T> : <T>Save Profile</T>}
                </Button>
              }
              icon={<UserCogIcon />}
              title={<T>My Profile & Notification Handles</T>}
            />

            <CockpitSurface divided variant="grouped">
              <CockpitSurfaceRow className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <T>
                    Bind your GitHub login and Lark or Slack user ID so Hub cards can @mention you
                    when PRs or blockers need attention.
                  </T>
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-profile-name">
                      <T>Display name</T>
                    </CockpitFieldLabel>
                    <Input
                      id="cockpit-profile-name"
                      placeholder={gt("Display name")}
                      size="sm"
                      value={profileDisplayName}
                      onChange={(event) => setProfileDisplayName(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-profile-vcs">
                      <T>GitHub / VCS login</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-profile-vcs"
                      placeholder={gt("GitHub / VCS login")}
                      size="sm"
                      value={profileVcsLogin}
                      onChange={(event) => setProfileVcsLogin(event.target.value)}
                    />
                  </div>
                </div>
              </CockpitSurfaceRow>

              <CockpitSurfaceRow>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-profile-lark">
                      <T>Lark open_id</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-profile-lark"
                      placeholder={gt("Lark open_id (for @mentions)")}
                      size="sm"
                      value={larkHandle}
                      onChange={(event) => setLarkHandle(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-profile-slack">
                      <T>Slack member ID</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-profile-slack"
                      placeholder={gt("Slack member ID (optional)")}
                      size="sm"
                      value={slackHandle}
                      onChange={(event) => setSlackHandle(event.target.value)}
                    />
                  </div>
                </div>
              </CockpitSurfaceRow>
            </CockpitSurface>
          </form>

          <section className="space-y-2.5">
            <CockpitSectionHeader
              action={
                <Button
                  disabled={!selectedWorkspaceId}
                  size="xs"
                  variant="outline"
                  onClick={() => setMemberDialogOpen(true)}
                >
                  <UserPlusIcon />
                  <T>Add Member</T>
                </Button>
              }
              count={visibleMembers.length}
              icon={<UsersIcon />}
              title={<T>Team Members & Roles</T>}
            />

            {!selectedWorkspaceId ? (
              <CockpitSurface variant="grouped">
                <Empty size="compact">
                  <EmptyMedia variant="icon">
                    <UsersIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>
                      <T>Select a workspace first</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>Select or create a workspace to manage member roles and gate sign-offs.</T>
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setWorkspaceDialogOpen(true)}
                    >
                      <PlusIcon />
                      <T>New Workspace</T>
                    </Button>
                  </EmptyContent>
                </Empty>
              </CockpitSurface>
            ) : visibleMembers.length === 0 ? (
              <CockpitSurface variant="grouped">
                <Empty size="compact">
                  <EmptyMedia variant="icon">
                    <UsersIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>
                      <T>No members loaded yet</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>
                        Add existing Hub users by GitHub login or email and assign roles for review
                        and release gates.
                      </T>
                    </EmptyDescription>
                  </EmptyHeader>
                  <EmptyContent>
                    <Button size="sm" variant="outline" onClick={() => setMemberDialogOpen(true)}>
                      <UserPlusIcon />
                      <T>Add Member</T>
                    </Button>
                  </EmptyContent>
                </Empty>
              </CockpitSurface>
            ) : (
              <CockpitSurface divided variant="grouped">
                {visibleMembers.map((member) => (
                  <CockpitSurfaceRow key={member.userId} className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">
                          {member.displayName}
                        </span>
                        {member.primaryVcsLogin ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            @{member.primaryVcsLogin}
                          </span>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {member.notificationHandles.lark ? (
                          <Badge size="sm" variant="outline">
                            <T>
                              Lark: <Var>{member.notificationHandles.lark}</Var>
                            </T>
                          </Badge>
                        ) : null}
                        {member.notificationHandles.slack ? (
                          <Badge size="sm" variant="outline">
                            <T>
                              Slack: <Var>{member.notificationHandles.slack}</Var>
                            </T>
                          </Badge>
                        ) : null}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {WORKSPACE_ROLES.map((role) => {
                        const active = member.roles.includes(role);
                        return (
                          <Button
                            key={role}
                            aria-pressed={active}
                            disabled={updatingMemberId === member.userId}
                            size="micro"
                            variant={active ? "secondary" : "ghost-muted"}
                            onClick={() => void handleToggleMemberRole(member, role)}
                          >
                            {active ? <CheckIcon /> : null}
                            {getRoleLabel(role, gt)}
                          </Button>
                        );
                      })}
                    </div>
                  </CockpitSurfaceRow>
                ))}
              </CockpitSurface>
            )}
          </section>
        </div>
      ) : null}

      {/* Section 3: Notifications */}
      {activeSection === "notifications" ? (
        <section className="space-y-2.5">
          <CockpitSectionHeader
            action={
              <Button
                disabled={!selectedWorkspaceId}
                size="xs"
                variant={selectedWorkspaceId && visibleChannels.length > 0 ? "default" : "outline"}
                onClick={() => setChannelDialogOpen(true)}
              >
                <PlusIcon />
                <T>Add Channel</T>
              </Button>
            }
            count={visibleChannels.length}
            icon={<BellIcon />}
            title={<T>Notification Channels</T>}
          />

          {!selectedWorkspaceId ? (
            <CockpitSurface variant="grouped">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>Select a workspace first</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>Select or create a workspace to add notification channels.</T>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" onClick={() => setWorkspaceDialogOpen(true)}>
                    <PlusIcon />
                    <T>New Workspace</T>
                  </Button>
                </EmptyContent>
              </Empty>
            </CockpitSurface>
          ) : visibleChannels.length === 0 ? (
            <CockpitSurface variant="grouped">
              <Empty size="compact">
                <EmptyMedia variant="icon">
                  <BellIcon />
                </EmptyMedia>
                <EmptyHeader>
                  <EmptyTitle>
                    <T>No notification channels</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      Connect Lark, Slack, Discord, or a custom webhook to receive PR triage alerts,
                      blocker @mentions, and release updates.
                    </T>
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent>
                  <Button size="sm" onClick={() => setChannelDialogOpen(true)}>
                    <PlusIcon />
                    <T>Add Channel</T>
                  </Button>
                </EmptyContent>
              </Empty>
            </CockpitSurface>
          ) : (
            <CockpitSurface divided variant="grouped">
              {visibleChannels.map((ch) => (
                <CockpitSurfaceRow
                  key={ch.id}
                  className="flex flex-wrap items-center justify-between gap-3"
                  interactive
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                    <CockpitStatusDot tone={ch.isEnabled ? "success" : "neutral"} />
                    <span
                      className={
                        ch.isEnabled
                          ? "text-sm font-medium text-foreground"
                          : "text-sm font-medium text-muted-foreground"
                      }
                    >
                      {ch.name}
                    </span>
                    <Badge size="sm" variant="outline">
                      {getDriverLabel(ch.driver, gt)}
                    </Badge>
                    <Badge size="sm" variant={ch.isEnabled ? "success" : "secondary"}>
                      <T>
                        <Var>{ch.events.length}</Var> events
                      </T>
                    </Badge>
                  </div>

                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      disabled={testingChannelId === ch.id}
                      size="xs"
                      variant="outline"
                      onClick={() => void handleTestChannel(ch.id)}
                    >
                      <SendIcon />
                      {testingChannelId === ch.id ? <T>Sending...</T> : <T>Test</T>}
                    </Button>
                    <Switch
                      aria-label={gt("Enable {name}", { name: ch.name })}
                      checked={ch.isEnabled}
                      disabled={busyChannelId === ch.id}
                      size="sm"
                      onCheckedChange={() => void handleToggleChannel(ch)}
                    />
                    <Button
                      aria-label={gt("Delete notification channel")}
                      disabled={busyChannelId === ch.id}
                      size="icon-xs"
                      variant="ghost-destructive"
                      onClick={() => void handleDeleteChannel(ch.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </CockpitSurfaceRow>
              ))}
            </CockpitSurface>
          )}
        </section>
      ) : null}

      {/* Section 4: Plugins & Packs */}
      {activeSection === "plugins" ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <CockpitSectionHeader
              count={hubPlugins.length}
              icon={<PuzzleIcon />}
              title={<T>Hub Plugins & Playbook Packs</T>}
            />

            <CockpitSurface padding="sm" variant="subtle">
              <p className="text-xs leading-relaxed text-muted-foreground">
                <T>
                  Server-side Hub plugins extend notification drivers, workflow presets, lifecycle
                  hooks, and callback routes. Load external plugins via{" "}
                  <code className="font-mono text-foreground">HUB_PLUGINS</code>, or install
                  reusable Workflow & Skill Playbook Packs with{" "}
                  <code className="font-mono text-foreground">
                    node infra/hub/src/packs/cli.ts packs/bot-review-autofix
                  </code>
                  .
                </T>
              </p>
            </CockpitSurface>

            {hubPlugins.length === 0 ? (
              <CockpitSurface variant="grouped">
                <Empty size="compact">
                  <EmptyMedia variant="icon">
                    <PuzzleIcon />
                  </EmptyMedia>
                  <EmptyHeader>
                    <EmptyTitle>
                      <T>No plugins reported</T>
                    </EmptyTitle>
                    <EmptyDescription>
                      <T>No plugins reported by the connected Hub.</T>
                    </EmptyDescription>
                  </EmptyHeader>
                </Empty>
              </CockpitSurface>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {hubPlugins.map((plugin) => (
                  <CockpitSurface
                    key={plugin.id}
                    className="space-y-2.5"
                    padding="md"
                    variant="card"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-foreground">{plugin.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          v{plugin.version}
                        </span>
                      </div>
                      <Badge size="sm" variant={plugin.builtin ? "outline" : "info"}>
                        {plugin.builtin ? <T>Built-in</T> : <T>External</T>}
                      </Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {plugin.description}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {plugin.capabilities.notifiers.map((item) => (
                        <Badge key={`n:${item}`} size="sm" variant="secondary">
                          <T>
                            Notifier: <Var>{item}</Var>
                          </T>
                        </Badge>
                      ))}
                      {plugin.capabilities.workflowPresets.map((item) => (
                        <Badge key={`p:${item}`} size="sm" variant="secondary">
                          <T>
                            Preset: <Var>{item}</Var>
                          </T>
                        </Badge>
                      ))}
                      {plugin.capabilities.eventHooks.map((item) => (
                        <Badge key={`e:${item}`} size="sm" variant="outline">
                          <T>
                            Hook: <Var>{item}</Var>
                          </T>
                        </Badge>
                      ))}
                      {plugin.capabilities.routes.map((item) => (
                        <Badge key={`r:${item}`} size="sm" variant="outline">
                          <T>
                            Route: <Var>{item}</Var>
                          </T>
                        </Badge>
                      ))}
                    </div>
                  </CockpitSurface>
                ))}
              </div>
            )}
          </section>

          {workflowPresets.length > 0 ? (
            <section className="space-y-2.5">
              <CockpitSectionHeader
                count={workflowPresets.length}
                icon={<WorkflowIcon />}
                title={<T>Registered Workflow Presets</T>}
              />
              <CockpitSurface divided variant="grouped">
                {workflowPresets.map((preset) => (
                  <CockpitSurfaceRow
                    key={preset.id}
                    className="flex flex-wrap items-center justify-between gap-3"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{preset.label}</span>
                        <span className="font-mono text-xs text-muted-foreground">{preset.id}</span>
                      </div>
                      {preset.description ? (
                        <p className="text-xs text-muted-foreground">{preset.description}</p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                      <Badge size="sm" variant="outline">
                        <T>
                          <Var>{preset.workflowConfig.stages.length}</Var> stages
                        </T>
                      </Badge>
                      <Badge size="sm" variant="outline">
                        <T>
                          <Var>{preset.workflowConfig.gates.length}</Var> gates
                        </T>
                      </Badge>
                    </div>
                  </CockpitSurfaceRow>
                ))}
              </CockpitSurface>
            </section>
          ) : null}
        </div>
      ) : null}

      {/* Dialog 1: Create Workspace */}
      <Dialog open={workspaceDialogOpen} onOpenChange={setWorkspaceDialogOpen}>
        <DialogPopup>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateWorkspace();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Create Workspace</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Signed in as <Var>{status.me?.user.displayName ?? gt("user")}</Var>. Create a
                  workspace to organize projects, repositories, and team roles.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-3">
                <div>
                  <CockpitFieldLabel htmlFor="cockpit-ws-name">
                    <T>Workspace name</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cockpit-ws-name"
                    placeholder={gt("Workspace name (e.g. Engineering)")}
                    size="sm"
                    value={wsName}
                    onChange={(event) => setWsName(event.target.value)}
                  />
                </div>
                <div>
                  <CockpitFieldLabel htmlFor="cockpit-ws-slug">
                    <T>Slug</T>
                  </CockpitFieldLabel>
                  <Input
                    font="mono"
                    id="cockpit-ws-slug"
                    placeholder={gt("Slug (e.g. eng)")}
                    size="sm"
                    value={wsSlug}
                    onChange={(event) => setWsSlug(event.target.value)}
                  />
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </DialogClose>
              <Button disabled={creatingWs || !wsName.trim()} type="submit">
                {creatingWs ? <T>Creating...</T> : <T>Create Workspace</T>}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Dialog 2: Create Project */}
      <Dialog open={projectDialogOpen} onOpenChange={setProjectDialogOpen}>
        <DialogPopup>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateProject();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Create Project</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Configure a project key, name, and delivery workflow preset for this workspace.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-proj-key">
                      <T>Project key</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-proj-key"
                      placeholder={gt("Key (e.g. CORE)")}
                      size="sm"
                      value={projKey}
                      onChange={(event) => setProjKey(event.target.value)}
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <CockpitFieldLabel htmlFor="cockpit-proj-name">
                      <T>Project name</T>
                    </CockpitFieldLabel>
                    <Input
                      id="cockpit-proj-name"
                      placeholder={gt("Project name")}
                      size="sm"
                      value={projName}
                      onChange={(event) => setProjName(event.target.value)}
                    />
                  </div>
                </div>
                <div>
                  <CockpitFieldLabel htmlFor="cockpit-proj-desc">
                    <T>Description</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cockpit-proj-desc"
                    placeholder={gt("Short description (optional)")}
                    size="sm"
                    value={projDesc}
                    onChange={(event) => setProjDesc(event.target.value)}
                  />
                </div>
                <div>
                  <CockpitFieldLabel>
                    <T>Workflow preset</T>
                  </CockpitFieldLabel>
                  <Select
                    value={effectiveProjPreset}
                    onValueChange={(value) => {
                      if (typeof value === "string" && value.length > 0) {
                        setProjPreset(value);
                      }
                    }}
                  >
                    <SelectTrigger aria-label={gt("Workflow Preset")} size="sm">
                      <SelectValue>{selectedPresetLabel}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {presetOptions.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </DialogClose>
              <Button disabled={creatingProj || !projKey.trim() || !projName.trim()} type="submit">
                {creatingProj ? <T>Creating...</T> : <T>Create Project</T>}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Dialog 3: Link Repository */}
      <Dialog open={repoDialogOpen} onOpenChange={setRepoDialogOpen}>
        <DialogPopup>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddRepo();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Link Repository</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Bind a repository and define its integration branch, release branch, PR size
                  guardrail, and automated reviewer bots.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div>
                    <CockpitFieldLabel>
                      <T>Forge</T>
                    </CockpitFieldLabel>
                    <Select
                      value={forgeKind}
                      onValueChange={(value) => {
                        if (value === "github" || value === "gitlab") {
                          setForgeKind(value);
                        }
                      }}
                    >
                      <SelectTrigger aria-label={gt("Forge")} size="sm">
                        <SelectValue>{getForgeLabel(forgeKind)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {FORGE_OPTIONS.map((option) => (
                          <SelectItem key={option.value} value={option.value}>
                            {option.label}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-fullname">
                      <T>Repository</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-repo-fullname"
                      placeholder={gt("org/repository")}
                      size="sm"
                      value={repoFullName}
                      onChange={(event) => setRepoFullName(event.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-integration">
                      <T>Integration branch</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-repo-integration"
                      placeholder={gt("Integration branch (dev)")}
                      size="sm"
                      value={integrationBranch}
                      onChange={(event) => setIntegrationBranch(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-release">
                      <T>Release branch</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-repo-release"
                      placeholder={gt("Release branch (main)")}
                      size="sm"
                      value={releaseBranch}
                      onChange={(event) => setReleaseBranch(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-max-lines">
                      <T>Max PR lines</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-repo-max-lines"
                      inputMode="numeric"
                      placeholder={gt("Max PR lines (500)")}
                      size="sm"
                      value={maxPrLines}
                      onChange={(event) => setMaxPrLines(event.target.value)}
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-bot-name">
                      <T>Automated reviewer name</T>
                    </CockpitFieldLabel>
                    <Input
                      id="cockpit-repo-bot-name"
                      placeholder={gt("Automated reviewer name (optional)")}
                      size="sm"
                      value={botName}
                      onChange={(event) => setBotName(event.target.value)}
                    />
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-repo-bot-logins">
                      <T>Bot logins</T>
                    </CockpitFieldLabel>
                    <Input
                      font="mono"
                      id="cockpit-repo-bot-logins"
                      placeholder={gt("Bot logins comma-separated (optional)")}
                      size="sm"
                      value={botLogins}
                      onChange={(event) => setBotLogins(event.target.value)}
                    />
                  </div>
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </DialogClose>
              <Button disabled={addingRepo || !repoFullName.trim()} type="submit">
                {addingRepo ? <T>Linking...</T> : <T>Link Repository</T>}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Dialog 4: Add Member */}
      <Dialog open={memberDialogOpen} onOpenChange={setMemberDialogOpen}>
        <DialogPopup>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void handleAddMember();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Add Team Member</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Add an existing Hub user by GitHub login or email and pick their initial workspace
                  role.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-3">
                <div>
                  <CockpitFieldLabel htmlFor="cockpit-member-identifier">
                    <T>GitHub login or email</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cockpit-member-identifier"
                    placeholder={gt("GitHub login or email of existing Hub user")}
                    size="sm"
                    value={newMemberIdentifier}
                    onChange={(event) => setNewMemberIdentifier(event.target.value)}
                  />
                </div>
                <div>
                  <CockpitFieldLabel>
                    <T>Initial role</T>
                  </CockpitFieldLabel>
                  <Select
                    value={newMemberRole}
                    onValueChange={(value) => {
                      if (
                        value === "owner" ||
                        value === "pm" ||
                        value === "qa" ||
                        value === "ops" ||
                        value === "security" ||
                        value === "dev"
                      ) {
                        setNewMemberRole(value);
                      }
                    }}
                  >
                    <SelectTrigger aria-label={gt("Initial role")} size="sm">
                      <SelectValue>{getRoleLabel(newMemberRole, gt)}</SelectValue>
                    </SelectTrigger>
                    <SelectPopup alignItemWithTrigger={false}>
                      {WORKSPACE_ROLES.map((role) => (
                        <SelectItem key={role} value={role}>
                          {getRoleLabel(role, gt)}
                        </SelectItem>
                      ))}
                    </SelectPopup>
                  </Select>
                </div>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </DialogClose>
              <Button disabled={addingMember || !newMemberIdentifier.trim()} type="submit">
                {addingMember ? <T>Adding...</T> : <T>Add Member</T>}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>

      {/* Dialog 5: Add Notification Channel */}
      <Dialog open={channelDialogOpen} onOpenChange={setChannelDialogOpen}>
        <DialogPopup>
          <form
            className="flex min-h-0 flex-1 flex-col overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateChannel();
            }}
          >
            <DialogHeader>
              <DialogTitle>
                <T>Add Notification Channel</T>
              </DialogTitle>
              <DialogDescription>
                <T>
                  Deliver digest summaries, blocked PR alerts, and release updates to your team chat
                  or webhook endpoint.
                </T>
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
                  <div>
                    <CockpitFieldLabel>
                      <T>Driver</T>
                    </CockpitFieldLabel>
                    <Select
                      value={channelDriver}
                      onValueChange={(value) => {
                        if (
                          value === "lark" ||
                          value === "webhook" ||
                          value === "slack" ||
                          value === "discord"
                        ) {
                          setChannelDriver(value);
                        }
                      }}
                    >
                      <SelectTrigger aria-label={gt("Notification Driver")} size="sm">
                        <SelectValue>{getDriverLabel(channelDriver, gt)}</SelectValue>
                      </SelectTrigger>
                      <SelectPopup alignItemWithTrigger={false}>
                        {NOTIFIER_DRIVERS.map((driver) => (
                          <SelectItem key={driver} value={driver}>
                            {getDriverLabel(driver, gt)}
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  </div>
                  <div>
                    <CockpitFieldLabel htmlFor="cockpit-channel-name">
                      <T>Channel name</T>
                    </CockpitFieldLabel>
                    <Input
                      id="cockpit-channel-name"
                      placeholder={gt("Channel name (e.g. Engineering Alerts)")}
                      size="sm"
                      value={channelName}
                      onChange={(event) => setChannelName(event.target.value)}
                    />
                  </div>
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="cockpit-channel-url">
                    <T>Webhook URL</T>
                  </CockpitFieldLabel>
                  <Input
                    font="mono"
                    id="cockpit-channel-url"
                    placeholder={gt("Webhook URL")}
                    size="sm"
                    value={channelWebhookUrl}
                    onChange={(event) => setChannelWebhookUrl(event.target.value)}
                  />
                </div>

                <div>
                  <CockpitFieldLabel htmlFor="cockpit-channel-secret">
                    <T>Signing secret</T>
                  </CockpitFieldLabel>
                  <Input
                    id="cockpit-channel-secret"
                    placeholder={gt("Signing secret (optional, stored AES-256-GCM encrypted)")}
                    size="sm"
                    type="password"
                    value={channelSecret}
                    onChange={(event) => setChannelSecret(event.target.value)}
                  />
                </div>

                <p className="text-xs text-muted-foreground">
                  <T>
                    Subscribes to <Var>{DEFAULT_EVENTS.length}</Var> core events by default (digest
                    ready, bot-blocked PR, ready for human review, blocker attention, and release
                    ready).
                  </T>
                </p>
              </div>
            </DialogPanel>
            <DialogFooter>
              <DialogClose render={<Button variant="outline" />}>
                <T>Cancel</T>
              </DialogClose>
              <Button
                disabled={creatingChannel || !channelName.trim() || !channelWebhookUrl.trim()}
                type="submit"
              >
                {creatingChannel ? <T>Saving...</T> : <T>Add Channel</T>}
              </Button>
            </DialogFooter>
          </form>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
