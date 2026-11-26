import type { CockpitOverview, EnvironmentId, TeamHubStatusResult } from "@t3tools/contracts";
import type {
  ForgeKind,
  NotificationChannelSummary,
  NotificationEventKind,
  NotifierDriverKind,
  RepoPolicy,
  WorkspaceMember,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import {
  BellIcon,
  FolderPlusIcon,
  GitBranchIcon,
  LayersIcon,
  UserCogIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { toastManager } from "~/components/ui/toast";
import { teamHubEnvironment } from "~/state/teamHub";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatCockpitCommandError } from "./cockpitError";

interface CockpitSettingsTabProps {
  readonly environmentId: EnvironmentId;
  readonly status: TeamHubStatusResult;
  readonly selectedWorkspaceId: string;
  readonly selectedProjectId: string;
  readonly overview: CockpitOverview | null;
  readonly onRefreshAll: (nextWorkspaceId?: string, nextProjectId?: string) => void;
}

const DEFAULT_EVENTS: ReadonlyArray<NotificationEventKind> = [
  "digest.ready",
  "pr.bot_blocked",
  "pr.ready_for_human_review",
  "blocker.needs_attention",
  "release.ready",
];

const WORKSPACE_ROLES = ["owner", "pm", "qa", "ops", "security", "dev"] as const;

export function CockpitSettingsTab({
  environmentId,
  status,
  selectedWorkspaceId,
  selectedProjectId,
  overview,
  onRefreshAll,
}: CockpitSettingsTabProps) {
  const gt = useGT();

  // Workspace creation
  const [wsName, setWsName] = useState("");
  const [wsSlug, setWsSlug] = useState("");
  const [creatingWs, setCreatingWs] = useState(false);

  // Project creation
  const [projKey, setProjKey] = useState("");
  const [projName, setProjName] = useState("");
  const [projDesc, setProjDesc] = useState("");
  const [projPreset, setProjPreset] = useState<"lean" | "full-delivery">("full-delivery");
  const [creatingProj, setCreatingProj] = useState(false);

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

  const createWorkspace = useAtomCommand(teamHubEnvironment.createWorkspace, {
    reportFailure: false,
  });
  const createProject = useAtomCommand(teamHubEnvironment.createProject, { reportFailure: false });
  const addProjectRepo = useAtomCommand(teamHubEnvironment.addProjectRepo, {
    reportFailure: false,
  });
  const listChannels = useAtomCommand(teamHubEnvironment.listNotificationChannels, {
    reportFailure: false,
  });
  const createChannel = useAtomCommand(teamHubEnvironment.createNotificationChannel, {
    reportFailure: false,
  });
  const updateProfile = useAtomCommand(teamHubEnvironment.updateProfile, { reportFailure: false });
  const listMembers = useAtomCommand(teamHubEnvironment.listMembers, { reportFailure: false });
  const updateMemberRoles = useAtomCommand(teamHubEnvironment.updateMemberRoles, {
    reportFailure: false,
  });

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
        preset: projPreset,
      },
    });
    setCreatingProj(false);
    if (res._tag === "Success") {
      setProjKey("");
      setProjName("");
      setProjDesc("");
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

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center gap-2">
            <UserCogIcon className="size-4 text-muted-foreground" />
            <h3 className="text-sm font-semibold text-foreground">
              <T>My Profile & Notification Handles</T>
            </h3>
          </div>
          <p className="text-xs text-muted-foreground">
            <T>
              Bind your GitHub login and Lark or Slack user ID so Hub cards can @mention you when
              PRs or blockers need attention.
            </T>
          </p>
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Input
              placeholder={gt("Display name")}
              size="sm"
              value={profileDisplayName}
              onChange={(event) => setProfileDisplayName(event.target.value)}
            />
            <Input
              placeholder={gt("GitHub / VCS login")}
              size="sm"
              value={profileVcsLogin}
              onChange={(event) => setProfileVcsLogin(event.target.value)}
            />
            <Input
              placeholder={gt("Lark open_id (for @mentions)")}
              size="sm"
              value={larkHandle}
              onChange={(event) => setLarkHandle(event.target.value)}
            />
            <Input
              placeholder={gt("Slack member ID (optional)")}
              size="sm"
              value={slackHandle}
              onChange={(event) => setSlackHandle(event.target.value)}
            />
          </div>
          <div className="flex justify-end">
            <Button disabled={savingProfile} size="sm" onClick={() => void handleSaveProfile()}>
              {savingProfile ? <T>Saving...</T> : <T>Save Profile</T>}
            </Button>
          </div>
        </section>

        <section className="space-y-3 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <UsersIcon className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                <T>Team Members & Roles</T>
              </h3>
            </div>
            <Badge size="sm" variant="secondary">
              {visibleMembers.length}
            </Badge>
          </div>
          {!selectedWorkspaceId ? (
            <p className="text-xs text-muted-foreground">
              <T>Select or create a workspace to manage member roles.</T>
            </p>
          ) : visibleMembers.length === 0 ? (
            <p className="text-xs text-muted-foreground">
              <T>No members loaded yet.</T>
            </p>
          ) : (
            <div className="space-y-2">
              {visibleMembers.map((member) => (
                <div
                  key={member.userId}
                  className="space-y-2 rounded-lg border border-border bg-muted/25 p-3"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-medium text-foreground">
                      {member.displayName}
                      {member.primaryVcsLogin ? ` (@${member.primaryVcsLogin})` : ""}
                    </span>
                    {member.notificationHandles.lark ? (
                      <Badge size="sm" variant="outline">
                        <T>
                          Lark: <Var>{member.notificationHandles.lark}</Var>
                        </T>
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {WORKSPACE_ROLES.map((role) => {
                      const active = member.roles.includes(role);
                      return (
                        <Button
                          key={role}
                          disabled={updatingMemberId === member.userId}
                          size="micro"
                          variant={active ? "default" : "outline"}
                          onClick={() => void handleToggleMemberRole(member, role)}
                        >
                          {role}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 1. Workspace & Project Setup */}
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <LayersIcon className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                <T>Create Workspace</T>
              </h3>
            </div>
            <p className="text-xs text-muted-foreground">
              <T>
                Signed in as <Var>{status.me?.user.displayName ?? "user"}</Var>. Create a workspace
                to organize projects, repositories, and team roles.
              </T>
            </p>
            <div className="grid gap-2.5 sm:grid-cols-2">
              <Input
                placeholder={gt("Workspace name (e.g. Engineering)")}
                size="sm"
                value={wsName}
                onChange={(event) => setWsName(event.target.value)}
              />
              <Input
                placeholder={gt("Slug (e.g. eng)")}
                size="sm"
                value={wsSlug}
                onChange={(event) => setWsSlug(event.target.value)}
              />
            </div>
            <div className="flex justify-end">
              <Button
                disabled={creatingWs || !wsName.trim()}
                size="sm"
                onClick={() => void handleCreateWorkspace()}
              >
                {creatingWs ? <T>Creating...</T> : <T>Create Workspace</T>}
              </Button>
            </div>
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center gap-2">
              <FolderPlusIcon className="size-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold text-foreground">
                <T>Create Project</T>
              </h3>
            </div>
            {!selectedWorkspaceId ? (
              <p className="text-xs text-muted-foreground">
                <T>Create or select a workspace first.</T>
              </p>
            ) : (
              <div className="space-y-2.5">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Input
                    placeholder={gt("Key (e.g. CORE)")}
                    size="sm"
                    value={projKey}
                    onChange={(event) => setProjKey(event.target.value)}
                  />
                  <div className="sm:col-span-2">
                    <Input
                      placeholder={gt("Project name")}
                      size="sm"
                      value={projName}
                      onChange={(event) => setProjName(event.target.value)}
                    />
                  </div>
                </div>
                <Input
                  placeholder={gt("Short description (optional)")}
                  size="sm"
                  value={projDesc}
                  onChange={(event) => setProjDesc(event.target.value)}
                />
                <div className="flex items-center justify-between gap-2 pt-1">
                  <select
                    aria-label={gt("Workflow Preset")}
                    className="h-8 rounded-lg border border-input bg-background px-2.5 text-xs text-foreground"
                    value={projPreset}
                    onChange={(event) =>
                      setProjPreset(event.target.value as "lean" | "full-delivery")
                    }
                  >
                    <option value="full-delivery">
                      {gt("Full delivery (Scoping → PRD → Dev → QA → Review → Staging → Done)")}
                    </option>
                    <option value="lean">
                      {gt("Lean (Backlog → In Progress → Review → Done)")}
                    </option>
                  </select>
                  <Button
                    disabled={creatingProj || !projKey.trim() || !projName.trim()}
                    size="sm"
                    onClick={() => void handleCreateProject()}
                  >
                    {creatingProj ? <T>Creating...</T> : <T>Create Project</T>}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>

        {/* 2. Repository Policies & Notification Channels */}
        <div className="space-y-6">
          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitBranchIcon className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  <T>Linked Repositories & Policy</T>
                </h3>
              </div>
              <Badge size="sm" variant="secondary">
                {overview?.repos.length ?? 0}
              </Badge>
            </div>

            {(overview?.repos ?? []).length > 0 ? (
              <ul className="space-y-1.5 text-xs">
                {(overview?.repos ?? []).map((repo) => (
                  <li
                    key={repo.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="font-mono font-medium text-foreground">
                      {repo.repoFullName}
                    </span>
                    <div className="flex items-center gap-1.5">
                      {repo.repoPolicy.branches.map((branch) => (
                        <Badge key={branch.name} size="sm" variant="outline">
                          {branch.name}:{branch.role}
                        </Badge>
                      ))}
                      {repo.repoPolicy.automatedReviewers.map((bot) => (
                        <Badge key={bot.name} size="sm" variant="info">
                          bot:{bot.name}
                        </Badge>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!selectedProjectId ? (
              <p className="text-xs text-muted-foreground">
                <T>Select or create a project to link repositories.</T>
              </p>
            ) : (
              <div className="space-y-2.5 pt-1">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <select
                    aria-label={gt("Forge")}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                    value={forgeKind}
                    onChange={(event) => setForgeKind(event.target.value as ForgeKind)}
                  >
                    <option value="github">github</option>
                    <option value="gitlab">gitlab</option>
                  </select>
                  <div className="sm:col-span-2">
                    <Input
                      placeholder={gt("org/repository")}
                      size="sm"
                      value={repoFullName}
                      onChange={(event) => setRepoFullName(event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Input
                    placeholder={gt("Integration branch (dev)")}
                    size="sm"
                    value={integrationBranch}
                    onChange={(event) => setIntegrationBranch(event.target.value)}
                  />
                  <Input
                    placeholder={gt("Release branch (main)")}
                    size="sm"
                    value={releaseBranch}
                    onChange={(event) => setReleaseBranch(event.target.value)}
                  />
                  <Input
                    placeholder={gt("Max PR lines (500)")}
                    size="sm"
                    value={maxPrLines}
                    onChange={(event) => setMaxPrLines(event.target.value)}
                  />
                </div>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <Input
                    placeholder={gt("Automated reviewer name (optional)")}
                    size="sm"
                    value={botName}
                    onChange={(event) => setBotName(event.target.value)}
                  />
                  <Input
                    placeholder={gt("Bot logins comma-separated (optional)")}
                    size="sm"
                    value={botLogins}
                    onChange={(event) => setBotLogins(event.target.value)}
                  />
                </div>
                <div className="flex justify-end">
                  <Button
                    disabled={addingRepo || !repoFullName.trim()}
                    size="sm"
                    onClick={() => void handleAddRepo()}
                  >
                    {addingRepo ? <T>Linking...</T> : <T>Link Repository</T>}
                  </Button>
                </div>
              </div>
            )}
          </section>

          <section className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BellIcon className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  <T>Notification Channels</T>
                </h3>
              </div>
              <Badge size="sm" variant="secondary">
                {visibleChannels.length}
              </Badge>
            </div>

            {visibleChannels.length > 0 ? (
              <ul className="space-y-1.5 text-xs">
                {visibleChannels.map((ch) => (
                  <li
                    key={ch.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2"
                  >
                    <span className="font-medium text-foreground">{ch.name}</span>
                    <div className="flex items-center gap-1.5">
                      <Badge size="sm" variant="outline">
                        {ch.driver}
                      </Badge>
                      <Badge size="sm" variant={ch.isEnabled ? "success" : "secondary"}>
                        {ch.events.length} events
                      </Badge>
                    </div>
                  </li>
                ))}
              </ul>
            ) : null}

            {!selectedWorkspaceId ? (
              <p className="text-xs text-muted-foreground">
                <T>Select or create a workspace to add notification channels.</T>
              </p>
            ) : (
              <div className="space-y-2.5 pt-1">
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <select
                    aria-label={gt("Notification Driver")}
                    className="h-8 rounded-lg border border-input bg-background px-2 text-xs text-foreground"
                    value={channelDriver}
                    onChange={(event) => setChannelDriver(event.target.value as NotifierDriverKind)}
                  >
                    <option value="lark">{gt("Lark / Feishu")}</option>
                    <option value="webhook">{gt("Generic Webhook")}</option>
                    <option value="slack">{gt("Slack")}</option>
                    <option value="discord">{gt("Discord")}</option>
                  </select>
                  <div className="sm:col-span-2">
                    <Input
                      placeholder={gt("Channel name (e.g. Engineering Alerts)")}
                      size="sm"
                      value={channelName}
                      onChange={(event) => setChannelName(event.target.value)}
                    />
                  </div>
                </div>
                <Input
                  placeholder={gt("Webhook URL")}
                  size="sm"
                  value={channelWebhookUrl}
                  onChange={(event) => setChannelWebhookUrl(event.target.value)}
                />
                <Input
                  placeholder={gt("Signing secret (optional, stored AES-256-GCM encrypted)")}
                  size="sm"
                  type="password"
                  value={channelSecret}
                  onChange={(event) => setChannelSecret(event.target.value)}
                />
                <div className="flex justify-end">
                  <Button
                    disabled={creatingChannel || !channelName.trim() || !channelWebhookUrl.trim()}
                    size="sm"
                    onClick={() => void handleCreateChannel()}
                  >
                    {creatingChannel ? <T>Saving...</T> : <T>Add Channel</T>}
                  </Button>
                </div>
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
