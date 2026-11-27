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
    const updateWorkItemPayloads: Array<unknown> = [];
    const boardReadPayloads: Array<unknown> = [];
    const boardPostPayloads: Array<unknown> = [];

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
        getWorkItemDetail: ({ workItemId }) =>
          Effect.succeed({
            workItem: {
              id: workItemId,
              projectId: "prj_1",
              seqNo: 1,
              code: "CORE-1",
              title: "Idempotent outbox",
              itemType: "feature",
              priority: "p1",
              stage: "dev",
              health: "on_track",
              assigneeType: "unassigned",
              assigneeUserId: null,
              assigneeRunnerId: null,
              specMarkdown: "Must retry safely.",
              specUrl: null,
              previewUrls: [],
              checklistItems: [
                { id: "AC-1", text: "Retry handles duplicates", verified: false },
                { id: "AC-2", text: "Dead-letter metrics emitted", verified: false },
              ],
              attributes: {},
              createdBy: "usr_1",
              createdAt: "2026-11-26T00:00:00.000Z",
              updatedAt: "2026-11-26T00:00:00.000Z",
            },
            pulses: [],
            changeRequests: [],
            gateApprovals: [],
          }),
        updateWorkItem: (input) => {
          updateWorkItemPayloads.push(input);
          return Effect.succeed({
            workItem: {
              id: input.workItemId,
              projectId: "prj_1",
              seqNo: 1,
              code: "CORE-1",
              title: input.title ?? "Idempotent outbox",
              itemType: "feature",
              priority: "p1",
              stage: input.stage ?? "dev",
              health: input.health ?? "on_track",
              assigneeType: input.assigneeType ?? "unassigned",
              assigneeUserId: input.assigneeUserId ?? null,
              assigneeRunnerId: input.assigneeRunnerId ?? null,
              specMarkdown: input.specMarkdown ?? "Must retry safely.",
              specUrl: input.specUrl ?? null,
              previewUrls: [...(input.previewUrls ?? [])],
              checklistItems: [...(input.checklistItems ?? [])],
              attributes: { ...input.attributes },
              createdBy: "usr_1",
              createdAt: "2026-11-26T00:00:00.000Z",
              updatedAt: "2026-11-26T00:00:00.000Z",
            },
          });
        },
        listBoardMessages: (input) => {
          boardReadPayloads.push(input);
          return Effect.succeed({
            head: 4,
            messages: [
              {
                id: "bmsg_4",
                workspaceId: input.workspaceId,
                projectId: input.projectId ?? "prj_1",
                seq: 4,
                kind: "handoff",
                authorType: "human",
                authorUserId: "usr_1",
                authorHandle: "lead",
                authorDisplayName: "Lead",
                mentions: ["codex"],
                body: "@codex verify CORE-1 outbox tests",
                workItemId: "wi_1",
                workItemCode: "CORE-1",
                changeRequestId: null,
                changeRequestRef: null,
                createdAt: "2026-11-26T00:00:00.000Z",
              },
            ],
          });
        },
        postBoardMessage: (input) => {
          boardPostPayloads.push(input);
          return Effect.succeed({
            message: {
              id: "bmsg_5",
              workspaceId: input.workspaceId,
              projectId: input.projectId ?? null,
              seq: 5,
              kind: input.kind ?? "handoff",
              authorType: input.authorType ?? "agent",
              authorUserId: "usr_1",
              authorHandle: input.authorHandle ?? "lead",
              authorDisplayName: input.authorDisplayName ?? "Lead",
              mentions: [...(input.mentions ?? ["lead"])],
              body: input.body,
              workItemId: input.workItemId ?? null,
              workItemCode: input.workItemCode ?? null,
              changeRequestId: input.changeRequestId ?? null,
              changeRequestRef: input.changeRequestRef ?? null,
              createdAt: "2026-11-26T00:01:00.000Z",
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

      const detail = yield* toolkit.handle("team_hub_get_work_item", { workItemId: "wi_1" }).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts) => parts.at(-1)?.result),
      );
      expect(detail).toMatchObject({
        workItem: {
          code: "CORE-1",
          checklistItems: [
            { id: "AC-1", verified: false },
            { id: "AC-2", verified: false },
          ],
        },
      });

      const updated = yield* toolkit
        .handle("team_hub_update_work_item", {
          workItemId: "wi_1",
          verifyAcIds: ["ac-1"],
        })
        .pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      expect(updated).toMatchObject({
        workItem: {
          id: "wi_1",
          checklistItems: [
            { id: "AC-1", verified: true },
            { id: "AC-2", verified: false },
          ],
        },
      });

      const lifecycleUpdated = yield* toolkit
        .handle("team_hub_update_work_item", {
          workItemId: "wi_1",
          specMarkdown: "# PRD\nDetailed AI delivery specification.",
          specUrl: "https://docs.example.com/prd/core-1",
          previewUrls: ["https://proto.example.com/core-1"],
          attributes: {
            prdStatus: "approved",
            prototypeStatus: "draft",
            prototypeUrl: "https://proto.example.com/core-1",
            githubIssueNumber: 101,
            githubIssueUrl: "https://github.com/acme/u3code/issues/101",
            githubLabels: ["type:feature", "priority:p1"],
            branchName: "feat/101-idempotent-outbox",
          },
          assigneeType: "runner",
          assigneeUserId: null,
          assigneeRunnerId: "claude-agent",
        })
        .pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      expect(lifecycleUpdated).toMatchObject({
        workItem: {
          id: "wi_1",
          specUrl: "https://docs.example.com/prd/core-1",
          previewUrls: ["https://proto.example.com/core-1"],
          assigneeType: "runner",
          assigneeRunnerId: "claude-agent",
          attributes: {
            prdStatus: "approved",
            githubIssueNumber: 101,
            branchName: "feat/101-idempotent-outbox",
          },
        },
      });
      expect(updateWorkItemPayloads).toHaveLength(2);

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

      const boardRead = yield* toolkit.handle("hub_board_read", { since: 3, limit: 20 }).pipe(
        Stream.unwrap,
        Stream.runCollect,
        Effect.map((parts) => parts.at(-1)?.result),
      );
      expect(boardRead).toMatchObject({
        head: 4,
        messages: [{ id: "bmsg_4", seq: 4, workItemCode: "CORE-1" }],
      });
      expect(boardReadPayloads).toEqual([{ workspaceId: "ws_1", since: 3, limit: 20 }]);

      const boardPosted = yield* toolkit
        .handle("hub_board_post", {
          projectId: "prj_1",
          body: "@lead CORE-1 outbox tests are green",
          workItemId: "wi_1",
          workItemCode: "CORE-1",
        })
        .pipe(
          Stream.unwrap,
          Stream.runCollect,
          Effect.map((parts) => parts.at(-1)?.result),
        );
      expect(boardPosted).toMatchObject({
        message: {
          id: "bmsg_5",
          seq: 5,
          authorType: "agent",
          workItemCode: "CORE-1",
        },
      });
      expect(boardPostPayloads).toMatchObject([
        {
          workspaceId: "ws_1",
          projectId: "prj_1",
          authorType: "agent",
          body: "@lead CORE-1 outbox tests are green",
          workItemId: "wi_1",
          workItemCode: "CORE-1",
        },
      ]);
    }).pipe(
      Effect.provide(
        McpToolAccess.HandlersLayer.layer(TeamHubHandlers.layer).pipe(
          Layer.provideMerge(layerDependencies),
        ),
      ),
    );
  }),
);
