import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it as effectIt } from "@effect/vitest";
import { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { HttpClient, HttpClientResponse } from "effect/http";
import { describe, it } from "vite-plus/test";

import * as ServerConfig from "../config.ts";
import { buildPulseDraftFromThread, extractWorkItemCodeFromThread } from "./PulseExtractor.ts";
import * as TeamHubService from "./TeamHubService.ts";

describe("PulseExtractor", () => {
  it("extracts work item code from thread title or branch name", () => {
    expect(
      extractWorkItemCodeFromThread({
        threadTitle: "NEX-42 Implement outbox idempotency",
      }),
    ).toBe("NEX-42");

    expect(
      extractWorkItemCodeFromThread({
        threadTitle: "Fix payment retries",
        branchName: "feat/pay-108-idempotency",
      }),
    ).toBe("PAY-108");
  });

  it("extracts decisions, blockers, and AC IDs from recent thread excerpts", () => {
    const draft = buildPulseDraftFromThread({
      threadId: ThreadId.make("thread-1"),
      threadTitle: "NEX-42 Settlement outbox",
      branchName: "feat/nex-42-outbox",
      recentExcerpts: [
        "Completed AC-1 and AC-2 schema tests.\nDecision: Use transactional outbox table instead of Redis PubSub.\nBlocker: Waiting on ops confirmation for dead-letter retention policy.",
      ],
    });

    expect(draft.workItemCode).toBe("NEX-42");
    expect(draft.health).toBe("blocked");
    expect(draft.progressedAcIds).toEqual(["AC-1", "AC-2"]);
    expect(draft.decisions).toHaveLength(1);
    expect(draft.blockers).toHaveLength(1);
  });
});

describe("TeamHubService", () => {
  effectIt.effect(
    "persists local login credentials, rotates expired access tokens on 401, and disconnects cleanly",
    () =>
      Effect.gen(function* () {
        const seenAuthHeaders: Array<string | undefined> = [];
        let meCalls = 0;

        const fakeHttp = HttpClient.make((req) => {
          const auth = req.headers.authorization;
          seenAuthHeaders.push(auth);

          const respond = (status: number, body: unknown) =>
            Effect.succeed(
              HttpClientResponse.fromWeb(
                req,
                new Response(JSON.stringify(body), {
                  status,
                  headers: { "content-type": "application/json" },
                }),
              ),
            );

          if (req.url.endsWith("/api/v1/auth/local/login")) {
            return respond(200, {
              tokens: {
                accessToken: "expired-access",
                refreshToken: "refresh-1",
                expiresInSeconds: 900,
              },
            });
          }

          if (req.url.endsWith("/api/v1/auth/refresh")) {
            return respond(200, {
              tokens: {
                accessToken: "fresh-access",
                refreshToken: "refresh-2",
                expiresInSeconds: 900,
              },
            });
          }

          if (req.url.endsWith("/api/v1/auth/me")) {
            meCalls += 1;
            if (auth === "Bearer expired-access") {
              return respond(401, { error: "Token expired" });
            }
            return respond(200, {
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
              workspaces: [
                {
                  id: "ws_1",
                  slug: "acme",
                  name: "Acme",
                  roles: ["owner"],
                },
              ],
            });
          }

          if (req.url.endsWith("/api/v1/auth/logout")) {
            return respond(200, { ok: true });
          }

          return respond(404, { error: "Not found" });
        });

        const testLayer = TeamHubService.layerLive.pipe(
          Layer.provide(Layer.succeed(HttpClient.HttpClient, fakeHttp)),
          Layer.provide(ServerConfig.layerTest(process.cwd(), { prefix: "t3-team-hub-test-" })),
          Layer.provide(NodeServices.layer),
        );

        const result = yield* Effect.gen(function* () {
          const svc = yield* TeamHubService.TeamHubService;
          const before = yield* svc.status();
          const afterLogin = yield* svc.connectLocal({
            hubUrl: "http://127.0.0.1:4310/",
            username: "lead",
            displayName: "Lead",
          });
          yield* svc.disconnect();
          const afterDisconnect = yield* svc.status();
          return { before, afterLogin, afterDisconnect };
        }).pipe(Effect.provide(testLayer));

        expect(result.before).toEqual({ connected: false, hubUrl: null, me: null });
        expect(result.afterLogin.connected).toBe(true);
        expect(result.afterLogin.hubUrl).toBe("http://127.0.0.1:4310");
        expect(result.afterLogin.me?.user.displayName).toBe("Lead");
        expect(meCalls).toBe(2);
        expect(seenAuthHeaders).toContain("Bearer expired-access");
        expect(seenAuthHeaders).toContain("Bearer fresh-access");
        expect(result.afterDisconnect).toEqual({ connected: false, hubUrl: null, me: null });
      }),
  );
});
