import { OrchestratorMcpFailure, type TeamHubError } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import * as TeamHubService from "../../../teamHub/TeamHubService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { TeamHubToolkit } from "./tools.ts";

const mapTeamHubError = (err: TeamHubError) =>
  new OrchestratorMcpFailure({
    code: err.statusCode === 401 ? "orchestration_error" : "invalid_request",
    message: err.message,
  });

export const layer = McpToolAccess.toLayer(TeamHubToolkit, {
  team_hub_get_context: McpToolAccess.reads(({ workspaceId, projectId }) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      const status = yield* teamHub.status().pipe(Effect.mapError(mapTeamHubError));
      if (!status.connected || !status.me) {
        return { connected: false, workspaceId: null, overview: null, memory: null };
      }

      const resolvedWorkspaceId = workspaceId ?? status.me.workspaces[0]?.id ?? null;
      if (!resolvedWorkspaceId) {
        return { connected: true, workspaceId: null, overview: null, memory: null };
      }

      const overview = yield* teamHub
        .getOverview({
          workspaceId: resolvedWorkspaceId,
          projectId: projectId ?? null,
        })
        .pipe(Effect.mapError(mapTeamHubError));

      const resolvedProjectId = projectId ?? overview.project?.id ?? overview.projects[0]?.id;
      const memory = resolvedProjectId
        ? (yield* teamHub
            .getMemory({ projectId: resolvedProjectId })
            .pipe(Effect.mapError(mapTeamHubError))).memory
        : null;

      return {
        connected: true,
        workspaceId: resolvedWorkspaceId,
        overview,
        memory,
      };
    }),
  ),

  team_hub_get_review_queue: McpToolAccess.reads(({ workspaceId, bucket, repo }) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      const status = yield* teamHub.status().pipe(Effect.mapError(mapTeamHubError));
      const resolvedWorkspaceId = workspaceId ?? status.me?.workspaces[0]?.id;
      if (!status.connected || !resolvedWorkspaceId) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Not connected to a Team Hub workspace.",
        });
      }
      return yield* teamHub
        .getReviewQueue({
          workspaceId: resolvedWorkspaceId,
          ...(bucket !== undefined ? { bucket } : {}),
          ...(repo !== undefined ? { repo } : {}),
        })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),

  team_hub_get_work_item: McpToolAccess.reads(({ workItemId }) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      return yield* teamHub
        .getWorkItemDetail({ workItemId })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),

  team_hub_update_work_item: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      let checklistItems = input.checklistItems;

      if (checklistItems === undefined && input.verifyAcIds && input.verifyAcIds.length > 0) {
        const detail = yield* teamHub
          .getWorkItemDetail({ workItemId: input.workItemId })
          .pipe(Effect.mapError(mapTeamHubError));
        const verifySet = new Set(input.verifyAcIds.map((id) => id.trim().toUpperCase()));
        const verifiedAt = DateTime.formatIso(yield* DateTime.now);
        checklistItems = detail.workItem.checklistItems.map((item) =>
          verifySet.has(item.id.trim().toUpperCase())
            ? { ...item, verified: true, verifiedAt }
            : item,
        );
      }

      return yield* teamHub
        .updateWorkItem({
          workItemId: input.workItemId,
          ...(input.stage !== undefined ? { stage: input.stage } : {}),
          ...(input.health !== undefined ? { health: input.health } : {}),
          ...(input.specMarkdown !== undefined ? { specMarkdown: input.specMarkdown } : {}),
          ...(checklistItems !== undefined ? { checklistItems } : {}),
        })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),

  team_hub_publish_pulse: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      return yield* teamHub
        .publishPulse({
          workItemId: input.workItemId,
          pulse: {
            sourceType: "human_thread",
            sourceThreadId: scope.thread?.threadId ?? null,
            ...(input.health !== undefined ? { health: input.health } : {}),
            doneSummary: input.doneSummary,
            ...(input.decisions !== undefined ? { decisions: input.decisions } : {}),
            ...(input.blockers !== undefined ? { blockers: input.blockers } : {}),
            ...(input.nextStep !== undefined ? { nextStep: input.nextStep } : {}),
            ...(input.progressedAcIds !== undefined
              ? { progressedAcIds: input.progressedAcIds }
              : {}),
          },
        })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),

  hub_board_read: McpToolAccess.reads(({ workspaceId, projectId, since, limit }) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      const status = yield* teamHub.status().pipe(Effect.mapError(mapTeamHubError));
      const resolvedWorkspaceId = workspaceId ?? status.me?.workspaces[0]?.id;
      if (!status.connected || !resolvedWorkspaceId) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Not connected to a Team Hub workspace.",
        });
      }
      return yield* teamHub
        .listBoardMessages({
          workspaceId: resolvedWorkspaceId,
          ...(projectId !== undefined ? { projectId } : {}),
          ...(since !== undefined ? { since } : {}),
          ...(limit !== undefined ? { limit } : {}),
        })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),

  hub_board_post: McpToolAccess.writesEnvironment((input) =>
    Effect.gen(function* () {
      const teamHub = yield* TeamHubService.TeamHubService;
      const scope = yield* McpInvocationContext.McpInvocationContext;
      const status = yield* teamHub.status().pipe(Effect.mapError(mapTeamHubError));
      const resolvedWorkspaceId = input.workspaceId ?? status.me?.workspaces[0]?.id;
      if (!status.connected || !resolvedWorkspaceId) {
        return yield* new OrchestratorMcpFailure({
          code: "orchestration_error",
          message: "Not connected to a Team Hub workspace.",
        });
      }
      return yield* teamHub
        .postBoardMessage({
          workspaceId: resolvedWorkspaceId,
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          authorType: input.authorType ?? (scope.thread ? "agent" : "human"),
          ...(input.authorHandle !== undefined ? { authorHandle: input.authorHandle } : {}),
          ...(input.authorDisplayName !== undefined
            ? { authorDisplayName: input.authorDisplayName }
            : {}),
          body: input.body,
          ...(input.mentions !== undefined ? { mentions: input.mentions } : {}),
          ...(input.workItemId !== undefined ? { workItemId: input.workItemId } : {}),
          ...(input.workItemCode !== undefined ? { workItemCode: input.workItemCode } : {}),
          ...(input.changeRequestId !== undefined
            ? { changeRequestId: input.changeRequestId }
            : {}),
          ...(input.changeRequestRef !== undefined
            ? { changeRequestRef: input.changeRequestRef }
            : {}),
        })
        .pipe(Effect.mapError(mapTeamHubError));
    }),
  ),
});
