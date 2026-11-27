import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createHubApp } from "../app.ts";
import { loadHubConfig } from "../config.ts";
import { readInitMigrationSql, type HubDatabase } from "../db/client.ts";

describe("Day-1 GitHub Open PR sync & notification channel test send", () => {
  let pglite: PGlite;
  let db: HubDatabase;

  beforeAll(async () => {
    pglite = new PGlite();
    await pglite.exec(readInitMigrationSql());
    db = drizzle({ client: pglite }) as unknown as HubDatabase;
  });

  afterAll(async () => {
    await pglite.close();
  });

  it("syncs existing open PRs with bot reviews & sends verified test notifications", async () => {
    const webhookPosts: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/pulls?state=open")) {
        return new Response(
          JSON.stringify([
            {
              number: 88,
              title: "[CORE-1] Implement payment retry queue",
              body: "Refs CORE-1",
              html_url: "https://github.com/acme/backend/pull/88",
              draft: false,
              state: "open",
              head: { ref: "feat/CORE-1", sha: "abc123456789" },
              base: { ref: "main" },
              user: { login: "alice" },
              additions: 140,
              deletions: 25,
            },
            {
              number: 89,
              title: "chore: cleanup unused logs",
              body: null,
              html_url: "https://github.com/acme/backend/pull/89",
              draft: false,
              state: "open",
              head: { ref: "chore/logs", sha: "def987654321" },
              base: { ref: "dev" },
              user: { login: "bob" },
              additions: 10,
              deletions: 40,
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/pulls/88/reviews")) {
        return new Response(
          JSON.stringify([
            {
              state: "CHANGES_REQUESTED",
              body: "High risk: missing idempotency key check.",
              html_url: "https://github.com/acme/backend/pull/88#pullrequestreview-1",
              submitted_at: "2026-11-27T01:00:00.000Z",
              user: { login: "dotsbot[bot]" },
            },
          ]),
          { status: 200 },
        );
      }
      if (url.includes("/pulls/89/reviews")) {
        return new Response(JSON.stringify([]), { status: 200 });
      }
      if (url.includes("open.feishu.cn")) {
        webhookPosts.push({
          url,
          body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
        });
        return new Response(JSON.stringify({ code: 0 }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const config = loadHubConfig({
      HUB_ALLOW_LOCAL_DEV_AUTH: "true",
      HUB_JWT_SECRET: "sync-test-secret-key-32-bytes-minimum!",
      GITHUB_SYNC_TOKEN: "ghp_test_token",
    });

    const { app, pluginRegistry } = createHubApp({ db, config, fetchImpl: fakeFetch });

    try {
      const loginRes = await app.request("/api/v1/auth/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "sync_owner", displayName: "Sync Owner" }),
      });
      const { tokens } = (await loginRes.json()) as { tokens: { accessToken: string } };
      const headers = {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      };

      await app.request("/api/v1/auth/me", {
        method: "PATCH",
        headers,
        body: JSON.stringify({ notificationHandles: { lark: "ou_sync_owner" } }),
      });

      const wsRes = await app.request("/api/v1/workspaces", {
        method: "POST",
        headers,
        body: JSON.stringify({ slug: "sync-org", name: "Sync Org" }),
      });
      const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

      const projRes = await app.request(`/api/v1/workspaces/${workspace.id}/projects`, {
        method: "POST",
        headers,
        body: JSON.stringify({ key: "CORE", name: "Core", preset: "lean" }),
      });
      const { project } = (await projRes.json()) as { project: { id: string } };

      await app.request(`/api/v1/projects/${project.id}/work-items`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: "Payment retry queue" }),
      });

      const repoRes = await app.request(`/api/v1/projects/${project.id}/repos`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          forgeKind: "github",
          repoFullName: "acme/backend",
          repoPolicy: {
            branches: [
              { name: "dev", role: "integration", mergePolicy: "auto_on_low_risk" },
              { name: "main", role: "release", mergePolicy: "manual" },
            ],
            automatedReviewers: [
              {
                name: "Dotsbot",
                botLogins: ["dotsbot[bot]"],
                blockingStates: ["CHANGES_REQUESTED"],
              },
            ],
            qualitySignals: [],
            maxPrChangedLines: 500,
          },
        }),
      });
      const { repo } = (await repoRes.json()) as { repo: { id: string } };

      // 1. Trigger Day-1 Open PR sync
      const syncRes = await app.request(`/api/v1/projects/${project.id}/repos/${repo.id}/sync`, {
        method: "POST",
        headers,
      });
      expect(syncRes.status).toBe(200);
      expect(await syncRes.json()).toEqual({
        repoFullName: "acme/backend",
        syncedCount: 2,
        openCount: 2,
        linkedCount: 1,
      });

      const queueRes = await app.request(
        `/api/v1/cockpit/review-queue?workspaceId=${workspace.id}`,
        { headers },
      );
      const queue = (await queueRes.json()) as {
        grouped: Record<string, Array<{ number: number; triageBucket: string }>>;
      };
      expect(queue.grouped.bot_blocked?.map((c) => c.number)).toEqual([88]);
      expect(queue.grouped.orphan?.map((c) => c.number)).toEqual([89]);

      // 2. Create a Lark channel and trigger test notification
      const chRes = await app.request(`/api/v1/workspaces/${workspace.id}/notification-channels`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          driver: "lark",
          name: "Ops Alerts",
          config: { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/abc" },
        }),
      });
      const { channel } = (await chRes.json()) as { channel: { id: string } };

      const testRes = await app.request(
        `/api/v1/workspaces/${workspace.id}/notification-channels/${channel.id}/test`,
        { method: "POST", headers },
      );
      expect(testRes.status).toBe(200);
      expect(await testRes.json()).toEqual({
        ok: true,
        driver: "lark",
        channelName: "Ops Alerts",
        mentioned: true,
      });
      expect(webhookPosts).toHaveLength(1);
      expect(JSON.stringify(webhookPosts[0]?.body)).toContain("ou_sync_owner");
    } finally {
      pluginRegistry.dispose();
    }
  });
});
