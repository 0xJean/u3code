import { expect, it } from "@effect/vitest";
import { EnvironmentId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";

import * as ThreadManagement from "../../../orchestration-v2/ThreadManagementService.ts";
import * as TeamHubService from "../../../teamHub/TeamHubService.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import * as McpToolAccess from "../../McpToolAccess.ts";
import { liveThreadShell } from "../../McpToolAccess.testkit.ts";
import * as TeamHubHandlers from "./handlers.ts";
import { TeamHubToolkit } from "./tools.ts";

const environmentId = EnvironmentId.make("environment:team-hub");
const threadId = ThreadId.make("thread:team-hub");

it.effect("reads team hub context + living memory and publishes pulse with threadId", () =>
  Effect.gen(function* () {
    const publishedPayloads: Array<unknown> = [];

    const layerDependencies = Layer.mergeAll(
      Layer.succeed(McpInvocationContext.McpInvocationContext, {
        environmentId,
        requestNamespace: "provider:team-hub",
        thread: {
          threadId,
          providerSessionId: "provider:team-hub",
          providerInstanceId: ProviderInstanceId.make("codex"),
        },
        client: undefined,
        capabilities: new Set(["orchestration" as const]),
        issuedAt: 0,
      }),
      Layer.mock(ThreadManagement.ThreadManagementService)({
        getThreadShell: () => Effect.succeed(liveThreadShell(threadId)),
      }),
      Layer.mock(TeamHubService.TeamHubService)({
        status: () =>
          Effect.succeed({
            connected: true,
            hubUrl: "http://127.0.0.1:4310",
            me: {
              user: {
                id: "usr_1",
                displayName: "Lead",
                email: null,
                avatarUrl: null,
                primaryVcsLogin: "lead",
                notificationHandles: {},
                isActive: true,
                createdAt: "2026-11-26T00:00:00.000Z",
                updatedAt: "2026-11-26T00:00:00.000Z",
              },
              workspaces: [{ id: "ws_1", slug: "acme", name: "Acme", roles: ["owner"] }],
            },
          }),
        getOverview: () =>
          Effect.succeed({
            workspaceId: "ws_1",
            project: {
              id: "prj_1",
              workspaceId: "ws_1",
              key: "CORE",
              name: "Core",
              description: "",
              status: "active",
              workflowConfig: {
                preset: "lean",
                stages: [{ id: "dev", label: "Dev", category: "active" }],
                gates: [],
                progressLedgers: [],
              },
              createdAt: "2026-11-26T00:00:00.000Z",
              updatedAt: "2026-11-26T00:00:00.000Z",
            },
            projects: [],
            repos: [],
            metrics: {
              activeWorkItems: 1,
              blockedWorkItems: 0,
              atRiskWorkItems: 0,
              botBlockedChangeRequests: 0,
              readyForHumanReviewCount: 0,
              orphanChangeRequests: 0,
              oversizedChangeRequests: 0,
            },
            cards: [],
            orphanChangeRequests: [],
            generatedAt: "2026-11-26T00:00:00.000Z",
          }),
        getMemory: () =>
          Effect.succeed({
            memory: {
              id: "mem_1",
              projectId: "prj_1",
              version: 3,
              architectureDecisions: [],
              moduleMap: [],
              recurringRisks: [],
              directives: [
                {
                  id: "dir_1",
                  text: "Never auto-merge main.",
                  createdBy: "usr_1",
                  createdAt: "2026-11-26T00:00:00.000Z",
                  active: true,
                },
              ],
              updatedBy: "usr_1",
              updatedAt: "2026-11-26T00:00:00.000Z",
            },
          }),
        publishPulse: (input) => {
          publishedPayloads.push(input);
          return Effect.succeed({
            pulse: {
              id: "pls_1",
              workItemId: input.workItemId,
              sourceType: "human_thread",
              authorUserId: "usr_1",
              runnerId: null,
              sourceThreadId: input.pulse.sourceThreadId ?? null,
              repoFullName: null,
              stageAtTime: "dev",
              health: input.pulse.health ?? "on_track",
              doneSummary: input.pulse.doneSummary,
              decisions: [...(input.pulse.decisions ?? [])],
              blockers: [...(input.pulse.blockers ?? [])],
              nextStep: input.pulse.nextStep ?? "",
              progressedAcIds: [...(input.pulse.progressedAcIds ?? [])],
              createdAt: "2026-11-26T00:00:00.000Z",
            },
          });
        },
      }),
    );

    yield* Effect.gen(function* () {
      const toolkit = yield* TeamHubToolkit;

      const ctx = yield* toolkit.handle("team_hub_get_context", {}).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts) => parts.at(-1)?.result),
      );
      expect(ctx).toMatchObject({
        connected: true,
        workspaceId: "ws_1",
        memory: {
          version: 3,
          directives: [{ text: "Never auto-merge main." }],
        },
      });

      const published = yield* toolkit
        .handle("team_hub_publish_pulse", {
          workItemId: "wi_1",
          doneSummary: "Implemented outbox worker tests.",
          decisions: ["Use idempotent delivery key."],
        })
        .pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      expect(published).toMatchObject({
        pulse: {
          id: "pls_1",
          sourceThreadId: threadId,
        },
      });
      expect(publishedPayloads).toHaveLength(1);
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(TeamHubHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
