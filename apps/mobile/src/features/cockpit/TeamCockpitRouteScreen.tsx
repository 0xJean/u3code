import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import type {
  CockpitOverview,
  EnvironmentId,
  TeamHubDigestsResult,
  TeamHubMemoryResult,
  TeamHubReviewQueueResult,
  TeamHubStatusResult,
} from "@t3tools/contracts";
import type * as Cause from "effect/Cause";
import { useGT } from "gt-react-native";
import { useEffect, useEffectEvent, useState } from "react";
import { Linking, Pressable, TextInput, View } from "react-native";

import { AppActivityIndicator } from "../../components/ui/AppActivityIndicator";
import { AppText as Text } from "../../components/ui/AppText";
import { RefreshControl } from "../../components/ui/RefreshControl";
import { ScreenScrollView as ScrollView } from "../../components/ui/ScreenScrollView";
import { SegmentedControl } from "../../components/ui/SegmentedControl";
import { useEnvironments } from "../../state/environments";
import { teamHubEnvironment } from "../../state/teamHub";
import { useAtomCommand } from "../../state/use-atom-command";
import { SettingsScreen } from "../settings/components/SettingsScreen";
import { SettingsSection } from "../settings/components/SettingsSection";

type MobileCockpitTab = "board" | "triage" | "digest";

function formatCommandError(
  result: { readonly cause: Cause.Cause<unknown> },
  fallback: string,
): string {
  const err = squashAtomCommandFailure(result);
  if (err instanceof Error && err.message) return err.message;
  if (
    typeof err === "object" &&
    err !== null &&
    "message" in err &&
    typeof err.message === "string" &&
    err.message.length > 0
  ) {
    return err.message;
  }
  return fallback;
}

export function TeamCockpitRouteScreen() {
  const gt = useGT();
  const { environments } = useEnvironments();
  const activeEnvironmentId: EnvironmentId | null = environments[0]?.environmentId ?? null;

  const [tab, setTab] = useState<MobileCockpitTab>("board");
  const [loadedForEnv, setLoadedForEnv] = useState<EnvironmentId | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<TeamHubStatusResult | null>(null);
  const [overview, setOverview] = useState<CockpitOverview | null>(null);
  const [reviewQueue, setReviewQueue] = useState<TeamHubReviewQueueResult | null>(null);
  const [digests, setDigests] = useState<TeamHubDigestsResult | null>(null);
  const [memory, setMemory] = useState<TeamHubMemoryResult["memory"]>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const [hubUrl, setHubUrl] = useState("http://127.0.0.1:4310");
  const [username, setUsername] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [generatingDigest, setGeneratingDigest] = useState(false);

  const fetchStatus = useAtomCommand(teamHubEnvironment.status, { reportFailure: false });
  const connectLocal = useAtomCommand(teamHubEnvironment.connectLocal, { reportFailure: false });
  const disconnectHub = useAtomCommand(teamHubEnvironment.disconnect, { reportFailure: false });
  const fetchOverview = useAtomCommand(teamHubEnvironment.getOverview, { reportFailure: false });
  const fetchReviewQueue = useAtomCommand(teamHubEnvironment.getReviewQueue, {
    reportFailure: false,
  });
  const fetchDigests = useAtomCommand(teamHubEnvironment.getDigests, { reportFailure: false });
  const fetchMemory = useAtomCommand(teamHubEnvironment.getMemory, { reportFailure: false });
  const generateDigest = useAtomCommand(teamHubEnvironment.generateDigest, {
    reportFailure: false,
  });

  const loadWorkspaceData = async (envId: EnvironmentId, workspaceId: string) => {
    const [overviewRes, queueRes, digestsRes] = await Promise.all([
      fetchOverview({ environmentId: envId, input: { workspaceId } }),
      fetchReviewQueue({ environmentId: envId, input: { workspaceId } }),
      fetchDigests({ environmentId: envId, input: { workspaceId } }),
    ]);

    if (overviewRes._tag === "Success") {
      setOverview(overviewRes.value);
      const projectId = overviewRes.value.project?.id ?? overviewRes.value.projects[0]?.id;
      if (projectId) {
        const memRes = await fetchMemory({ environmentId: envId, input: { projectId } });
        if (memRes._tag === "Success") {
          setMemory(memRes.value.memory);
        }
      }
    } else {
      setErrorMessage(formatCommandError(overviewRes, gt("Failed to load cockpit overview.")));
    }

    if (queueRes._tag === "Success") setReviewQueue(queueRes.value);
    if (digestsRes._tag === "Success") setDigests(digestsRes.value);
  };

  const refreshAll = async (envId: EnvironmentId) => {
    const statusRes = await fetchStatus({ environmentId: envId, input: {} });
    if (statusRes._tag !== "Success") {
      setErrorMessage(formatCommandError(statusRes, gt("Unable to check Team Hub status.")));
      return;
    }
    setErrorMessage(null);
    setStatus(statusRes.value);
    const firstWorkspaceId = statusRes.value.me?.workspaces[0]?.id;
    if (statusRes.value.connected && firstWorkspaceId) {
      await loadWorkspaceData(envId, firstWorkspaceId);
    } else {
      setOverview(null);
      setReviewQueue(null);
      setDigests(null);
      setMemory(null);
    }
  };

  const loadOnMount = useEffectEvent((envId: EnvironmentId, cancelled: () => boolean) => {
    void fetchStatus({ environmentId: envId, input: {} }).then((statusRes) => {
      if (cancelled()) return;
      if (statusRes._tag !== "Success") {
        setErrorMessage(formatCommandError(statusRes, gt("Unable to check Team Hub status.")));
        setLoadedForEnv(envId);
        return;
      }
      setErrorMessage(null);
      setStatus(statusRes.value);
      const firstWorkspaceId = statusRes.value.me?.workspaces[0]?.id;
      if (statusRes.value.connected && firstWorkspaceId) {
        void loadWorkspaceData(envId, firstWorkspaceId).then(() => {
          if (!cancelled()) setLoadedForEnv(envId);
        });
      } else {
        setOverview(null);
        setReviewQueue(null);
        setDigests(null);
        setMemory(null);
        setLoadedForEnv(envId);
      }
    });
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Load Team Hub status and overview from external server environment on mount.
  useEffect(() => {
    if (!activeEnvironmentId) return;
    let cancelled = false;
    loadOnMount(activeEnvironmentId, () => cancelled);
    return () => {
      cancelled = true;
    };
  }, [activeEnvironmentId]);

  const loading = activeEnvironmentId !== null && loadedForEnv !== activeEnvironmentId;

  const handleConnectLocal = async () => {
    if (!activeEnvironmentId || !hubUrl.trim() || !username.trim()) return;
    setConnecting(true);
    setErrorMessage(null);
    const res = await connectLocal({
      environmentId: activeEnvironmentId,
      input: {
        hubUrl: hubUrl.trim().replace(/\/+$/, ""),
        username: username.trim(),
      },
    });
    setConnecting(false);
    if (res._tag === "Success") {
      setStatus(res.value);
      const firstWs = res.value.me?.workspaces[0]?.id;
      if (firstWs) {
        await loadWorkspaceData(activeEnvironmentId, firstWs);
      }
    } else {
      setErrorMessage(formatCommandError(res, gt("Failed to connect to Team Hub.")));
    }
  };

  const handleGenerateDigest = async () => {
    const workspaceId = status?.me?.workspaces[0]?.id;
    if (!activeEnvironmentId || !workspaceId) return;
    setGeneratingDigest(true);
    const res = await generateDigest({
      environmentId: activeEnvironmentId,
      input: {
        workspaceId,
        projectId: overview?.project?.id ?? null,
        triggerType: "manual",
      },
    });
    setGeneratingDigest(false);
    if (res._tag === "Success") {
      if (res.value.updatedMemory) setMemory(res.value.updatedMemory);
      await loadWorkspaceData(activeEnvironmentId, workspaceId);
    } else {
      setErrorMessage(formatCommandError(res, gt("Failed to generate digest.")));
    }
  };

  const handleDisconnect = async () => {
    if (!activeEnvironmentId) return;
    await disconnectHub({ environmentId: activeEnvironmentId, input: {} });
    setStatus({ connected: false, hubUrl: status?.hubUrl ?? null, me: null });
    setOverview(null);
    setReviewQueue(null);
    setDigests(null);
    setMemory(null);
  };

  const latestDigest = digests?.digests[0] ?? null;

  return (
    <SettingsScreen title={gt("Team Cockpit")}>
      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-4 px-5 pt-4 pb-10"
        refreshControl={
          activeEnvironmentId ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void refreshAll(activeEnvironmentId).then(() => setRefreshing(false));
              }}
            />
          ) : undefined
        }
      >
        {!activeEnvironmentId ? (
          <Text className="text-sm text-muted">
            {gt("Connect to a U3 Code server environment first to use Team Cockpit.")}
          </Text>
        ) : loading ? (
          <View className="items-center py-10">
            <AppActivityIndicator />
          </View>
        ) : !status?.connected ? (
          <SettingsSection title={gt("Connect to Team Hub")}>
            <View className="gap-3 p-4">
              <Text className="text-xs text-muted">
                {gt("Connect this server environment to your self-hosted u3code-hub instance.")}
              </Text>
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
                placeholder="http://127.0.0.1:4310"
                value={hubUrl}
                onChangeText={setHubUrl}
              />
              <TextInput
                autoCapitalize="none"
                autoCorrect={false}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-ink"
                placeholder={gt("Username")}
                value={username}
                onChangeText={setUsername}
              />
              {errorMessage ? <Text className="text-xs text-danger">{errorMessage}</Text> : null}
              <Pressable
                accessibilityRole="button"
                className="items-center rounded-lg bg-accent px-4 py-2.5"
                disabled={connecting}
                onPress={() => void handleConnectLocal()}
              >
                <Text className="text-sm font-semibold text-white">
                  {connecting ? gt("Connecting...") : gt("Connect")}
                </Text>
              </Pressable>
            </View>
          </SettingsSection>
        ) : (
          <View className="gap-4">
            {errorMessage ? <Text className="text-xs text-danger">{errorMessage}</Text> : null}

            {overview ? (
              <View className="flex-row flex-wrap gap-2">
                <MetricPill label={gt("Active")} value={overview.metrics.activeWorkItems} />
                <MetricPill label={gt("Blocked")} value={overview.metrics.blockedWorkItems} />
                <MetricPill
                  label={gt("Bot Blocked")}
                  value={overview.metrics.botBlockedChangeRequests}
                />
                <MetricPill
                  label={gt("Review")}
                  value={overview.metrics.readyForHumanReviewCount}
                />
              </View>
            ) : null}

            <SegmentedControl<MobileCockpitTab>
              options={[
                { value: "board", label: gt("Board") },
                { value: "triage", label: gt("Triage") },
                { value: "digest", label: gt("Digest") },
              ]}
              selected={tab}
              onSelect={setTab}
            />

            {tab === "board" ? (
              <SettingsSection title={overview?.project?.name ?? gt("Work Items")}>
                <View className="gap-2.5 p-3">
                  {(overview?.cards ?? []).length === 0 ? (
                    <Text className="text-xs text-muted">{gt("No work items yet.")}</Text>
                  ) : (
                    (overview?.cards ?? []).map((card) => (
                      <View
                        key={card.workItem.id}
                        className="gap-1 rounded-xl border border-border bg-card p-3"
                      >
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs font-semibold text-muted">
                            {card.workItem.code} · {card.workItem.stage}
                          </Text>
                          <Text className="text-xs font-medium text-ink">
                            {card.workItem.priority.toUpperCase()} · {card.workItem.health}
                          </Text>
                        </View>
                        <Text className="text-sm font-medium text-ink">{card.workItem.title}</Text>
                        {card.latestPulse ? (
                          <Text className="text-xs text-muted" numberOfLines={2}>
                            {card.latestPulse.doneSummary}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  )}
                </View>
              </SettingsSection>
            ) : null}

            {tab === "triage" ? (
              <SettingsSection title={gt("Review Triage")}>
                <View className="gap-2.5 p-3">
                  {(reviewQueue?.items ?? []).length === 0 ? (
                    <Text className="text-xs text-muted">
                      {gt("No open pull requests require triage.")}
                    </Text>
                  ) : (
                    (reviewQueue?.items ?? []).map((cr) => (
                      <Pressable
                        key={cr.id}
                        accessibilityRole="link"
                        className="gap-1 rounded-xl border border-border bg-card p-3"
                        onPress={() => void Linking.openURL(cr.url)}
                      >
                        <View className="flex-row items-center justify-between">
                          <Text className="text-xs font-semibold text-muted">
                            {cr.repoFullName}#{cr.number}
                          </Text>
                          <Text className="text-xs font-medium text-ink">{cr.triageBucket}</Text>
                        </View>
                        <Text className="text-sm font-medium text-ink">{cr.title}</Text>
                        <Text className="text-xs text-muted">
                          @{cr.authorVcsLogin} · {cr.headBranch} → {cr.baseBranch} (+{cr.additions}
                          /-{cr.deletions})
                        </Text>
                      </Pressable>
                    ))
                  )}
                </View>
              </SettingsSection>
            ) : null}

            {tab === "digest" ? (
              <View className="gap-4">
                <SettingsSection title={gt("Owner Directives")}>
                  <View className="gap-2 p-3">
                    {(memory?.directives ?? []).length === 0 ? (
                      <Text className="text-xs text-muted">{gt("No directives configured.")}</Text>
                    ) : (
                      (memory?.directives ?? []).map((directive) => (
                        <Text key={directive.id} className="text-xs text-ink">
                          • {directive.text}
                        </Text>
                      ))
                    )}
                  </View>
                </SettingsSection>

                <SettingsSection title={gt("Latest AI Digest")}>
                  <View className="gap-3 p-3">
                    <Pressable
                      accessibilityRole="button"
                      className="items-center rounded-lg bg-accent px-3 py-2"
                      disabled={generatingDigest}
                      onPress={() => void handleGenerateDigest()}
                    >
                      <Text className="text-xs font-semibold text-white">
                        {generatingDigest ? gt("Synthesizing...") : gt("Generate Digest")}
                      </Text>
                    </Pressable>
                    {latestDigest ? (
                      <Text className="text-xs leading-5 text-ink">
                        {latestDigest.markdownBody}
                      </Text>
                    ) : (
                      <Text className="text-xs text-muted">{gt("No digests generated yet.")}</Text>
                    )}
                  </View>
                </SettingsSection>
              </View>
            ) : null}

            <Pressable
              accessibilityRole="button"
              className="items-center rounded-lg border border-border py-2.5"
              onPress={() => void handleDisconnect()}
            >
              <Text className="text-xs font-medium text-muted">{gt("Disconnect Team Hub")}</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SettingsScreen>
  );
}

function MetricPill(props: { readonly label: string; readonly value: number }) {
  return (
    <View className="min-w-[72px] flex-1 rounded-xl border border-border bg-card px-3 py-2">
      <Text className="text-[11px] text-muted">{props.label}</Text>
      <Text className="text-base font-semibold text-ink">{props.value}</Text>
    </View>
  );
}
