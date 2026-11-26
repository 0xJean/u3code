import type { CockpitOverview, EnvironmentId, TeamHubStatusResult } from "@t3tools/contracts";
import type {
  ForgeKind,
  NotificationChannelSummary,
  NotificationEventKind,
  NotifierDriverKind,
  RepoPolicy,
} from "@u3code/hub-contracts";
import { T, useGT, Var } from "gt-react";
import { BellIcon, FolderPlusIcon, GitBranchIcon, LayersIcon } from "lucide-react";
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

  const loadChannels = useEffectEvent(
    (envId: EnvironmentId, wsId: string, cancelled: () => boolean) => {
      void listChannels({ environmentId: envId, input: { workspaceId: wsId } }).then((res) => {
        if (cancelled()) return;
        if (res._tag === "Success") {
          setChannels(res.value.channels);
        }
      });
    },
  );

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Synchronize workspace notification channels from external Team Hub API when workspace changes.
  useEffect(() => {
    if (!selectedWorkspaceId) return;
    let cancelled = false;
    loadChannels(environmentId, selectedWorkspaceId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [environmentId, selectedWorkspaceId]);

  const visibleChannels = selectedWorkspaceId ? channels : [];

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

  return (
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
              Signed in as <Var>{status.me?.user.displayName ?? "user"}</Var>. Create a workspace to
              organize projects, repositories, and team roles.
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
                  <option value="lean">{gt("Lean (Backlog → In Progress → Review → Done)")}</option>
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
                  <span className="font-mono font-medium text-foreground">{repo.repoFullName}</span>
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
  );
}
