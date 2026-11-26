import { OrchestratorMcpFailure, type TeamHubError } from "@t3tools/contracts";
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
});
