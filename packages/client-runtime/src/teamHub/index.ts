import { WS_METHODS } from "@t3tools/contracts";
import type { Atom } from "effect/reactivity";

import type { EnvironmentRegistry } from "../connection/registry.ts";
import {
  createEnvironmentRpcCommand,
  createEnvironmentRpcSubscriptionAtomFamily,
} from "../state/runtime.ts";

export function createTeamHubEnvironmentAtoms<R, E>(
  runtime: Atom.AtomRuntime<EnvironmentRegistry | R, E>,
) {
  return {
    status: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:status",
      tag: WS_METHODS.teamHubStatus,
    }),
    connectLocal: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:connect-local",
      tag: WS_METHODS.teamHubConnectLocal,
    }),
    connectTokens: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:connect-tokens",
      tag: WS_METHODS.teamHubConnectTokens,
    }),
    disconnect: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:disconnect",
      tag: WS_METHODS.teamHubDisconnect,
    }),
    getOverview: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:get-overview",
      tag: WS_METHODS.teamHubGetOverview,
    }),
    getReviewQueue: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:get-review-queue",
      tag: WS_METHODS.teamHubGetReviewQueue,
    }),
    getDigests: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:get-digests",
      tag: WS_METHODS.teamHubGetDigests,
    }),
    generateDigest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:generate-digest",
      tag: WS_METHODS.teamHubGenerateDigest,
    }),
    getMemory: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:get-memory",
      tag: WS_METHODS.teamHubGetMemory,
    }),
    updateDirectives: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-directives",
      tag: WS_METHODS.teamHubUpdateDirectives,
    }),
    createWorkItem: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:create-work-item",
      tag: WS_METHODS.teamHubCreateWorkItem,
    }),
    updateWorkItem: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-work-item",
      tag: WS_METHODS.teamHubUpdateWorkItem,
    }),
    approveGate: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:approve-gate",
      tag: WS_METHODS.teamHubApproveGate,
    }),
    publishPulse: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:publish-pulse",
      tag: WS_METHODS.teamHubPublishPulse,
    }),
    extractPulseDraft: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:extract-pulse-draft",
      tag: WS_METHODS.teamHubExtractPulseDraft,
    }),
    createWorkspace: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:create-workspace",
      tag: WS_METHODS.teamHubCreateWorkspace,
    }),
    createProject: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:create-project",
      tag: WS_METHODS.teamHubCreateProject,
    }),
    updateProjectPrompts: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-project-prompts",
      tag: WS_METHODS.teamHubUpdateProjectPrompts,
    }),
    addProjectRepo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:add-project-repo",
      tag: WS_METHODS.teamHubAddProjectRepo,
    }),
    listNotificationChannels: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:list-notification-channels",
      tag: WS_METHODS.teamHubListNotificationChannels,
    }),
    createNotificationChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:create-notification-channel",
      tag: WS_METHODS.teamHubCreateNotificationChannel,
    }),
    updateProfile: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-profile",
      tag: WS_METHODS.teamHubUpdateProfile,
    }),
    listMembers: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:list-members",
      tag: WS_METHODS.teamHubListMembers,
    }),
    updateMemberRoles: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-member-roles",
      tag: WS_METHODS.teamHubUpdateMemberRoles,
    }),
    listReleases: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:list-releases",
      tag: WS_METHODS.teamHubListReleases,
    }),
    createRelease: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:create-release",
      tag: WS_METHODS.teamHubCreateRelease,
    }),
    updateRelease: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:update-release",
      tag: WS_METHODS.teamHubUpdateRelease,
    }),
    subscribeEvents: createEnvironmentRpcSubscriptionAtomFamily(runtime, {
      label: "environment-data:team-hub:events",
      tag: WS_METHODS.teamHubSubscribeEvents,
    }),
    addMember: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:add-member",
      tag: WS_METHODS.teamHubAddMember,
    }),
    deleteProjectRepo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:delete-project-repo",
      tag: WS_METHODS.teamHubDeleteProjectRepo,
    }),
    toggleNotificationChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:toggle-notification-channel",
      tag: WS_METHODS.teamHubToggleNotificationChannel,
    }),
    deleteNotificationChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:delete-notification-channel",
      tag: WS_METHODS.teamHubDeleteNotificationChannel,
    }),
    getWorkItemDetail: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:get-work-item-detail",
      tag: WS_METHODS.teamHubGetWorkItemDetail,
    }),
    linkChangeRequest: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:link-change-request",
      tag: WS_METHODS.teamHubLinkChangeRequest,
    }),
    listPlugins: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:list-plugins",
      tag: WS_METHODS.teamHubListPlugins,
    }),
    syncProjectRepo: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:sync-project-repo",
      tag: WS_METHODS.teamHubSyncProjectRepo,
    }),
    testNotificationChannel: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:test-notification-channel",
      tag: WS_METHODS.teamHubTestNotificationChannel,
    }),
    listBoardMessages: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:list-board-messages",
      tag: WS_METHODS.teamHubListBoardMessages,
    }),
    postBoardMessage: createEnvironmentRpcCommand(runtime, {
      label: "environment-data:team-hub:post-board-message",
      tag: WS_METHODS.teamHubPostBoardMessage,
    }),
  };
}
