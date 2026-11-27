import * as NodeCrypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { HubWsEvent, NotificationMessage, TeamBoardMessage } from "@u3code/hub-contracts";
import { createHubApp } from "./app.ts";
import { loadHubConfig } from "./config.ts";
import { readInitMigrationSql, type HubDatabase } from "./db/client.ts";
import { NotificationDispatcher, type NotifierDriver } from "./notifiers/index.ts";

async function createTestHub() {
  const pglite = new PGlite();
  await pglite.exec(readInitMigrationSql());
  const db = drizzle({ client: pglite }) as unknown as HubDatabase;

  const config = loadHubConfig({
    HUB_JWT_SECRET: "test-jwt-secret-must-be-long-enough-123456",
    HUB_ENCRYPTION_KEY: "test-enc-secret-must-be-long-enough-123456",
    GITHUB_WEBHOOK_SECRET: "test-gh-webhook-secret",
    HUB_ALLOW_LOCAL_DEV_AUTH: "true",
  });

  const sentNotifications: NotificationMessage[] = [];
  const captureDriver: NotifierDriver = {
    kind: "lark",
    send: async (_cfg, msg) => {
      sentNotifications.push(msg);
    },
  };
  const notifier = new NotificationDispatcher(db, config, [captureDriver]);
  const { app, broker } = createHubApp({ db, config, notifier });

  return { app, broker, pglite, config, sentNotifications };
}

function signWebhook(secret: string, body: string): string {
  return `sha256=${NodeCrypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("u3code-hub integration (PGlite)", () => {
  const cleanups: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanups.length > 0) {
      await cleanups.pop()?.();
    }
  });

  it("runs full cockpit lifecycle: auth, preset project, Dotsbot block, dev auto-merge, system pulse, and RBAC gates", async () => {
    const { app, broker, pglite, config, sentNotifications } = await createTestHub();
    cleanups.push(async () => {
      broker.close();
      await pglite.close();
    });

    // 1. Local login for owner & dev
    const ownerLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "boss", displayName: "Tech Founder" }),
    });
    expect(ownerLoginRes.status).toBe(200);
    const ownerAuth = (await ownerLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string; refreshToken: string };
    };

    const devLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", displayName: "Go Dev" }),
    });
    const devAuth = (await devLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string };
    };

    // Verify refresh token rotation & replay invalidation
    const refresh1 = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: ownerAuth.tokens.refreshToken }),
    });
    expect(refresh1.status).toBe(200);
    const replayAttempt = await app.request("/api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: ownerAuth.tokens.refreshToken }),
    });
    expect(replayAttempt.status).toBe(401);

    const ownerHeaders = {
      Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };
    const devHeaders = {
      Authorization: `Bearer ${devAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };

    // 2. Create workspace, add dev member, configure Lark notification channel
    const wsRes = await app.request("/api/v1/workspaces", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ slug: "acme", name: "Acme Engineering" }),
    });
    expect(wsRes.status).toBe(201);
    const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

    await app.request(`/api/v1/workspaces/${workspace.id}/members/${devAuth.user.id}`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ roles: ["dev"] }),
    });

    await app.request(`/api/v1/workspaces/${workspace.id}/notification-channels`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        driver: "lark",
        name: "Engineering Alerts",
        events: ["pr.bot_blocked", "blocker.needs_attention"],
        config: { webhookUrl: "https://open.larksuite.com/open-apis/bot/v2/hook/test" },
      }),
    });

    // 3. Create project using built-in 'full-delivery' preset and attach repo with Dotsbot + dev/main policy
    const projRes = await app.request(`/api/v1/workspaces/${workspace.id}/projects`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ key: "NEX", name: "Nexus Core", preset: "full-delivery" }),
    });
    expect(projRes.status).toBe(201);
    const { project } = (await projRes.json()) as { project: { id: string } };

    const repoRes = await app.request(`/api/v1/projects/${project.id}/repos`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        repoFullName: "acme/nexus-go",
        tags: ["go", "backend"],
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
          qualitySignals: [
            {
              key: "diff_coverage",
              checkName: "ci/diff-coverage",
              pattern: "Diff Coverage:\\s*([0-9.]+)%",
              minValue: 75,
            },
          ],
          maxPrChangedLines: 500,
        },
      }),
    });
    expect(repoRes.status).toBe(201);

    // 4. Create work item NEX-1 and verify gate enforcement blocks moving directly to 'dev'
    const wiRes = await app.request(`/api/v1/projects/${project.id}/work-items`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        title: "Refactor auth middleware",
        checklistItems: [{ id: "AC-1", text: "Support JWT rotation", verified: false }],
      }),
    });
    expect(wiRes.status).toBe(201);
    const { workItem } = (await wiRes.json()) as { workItem: { id: string; code: string } };
    expect(workItem.code).toBe("NEX-1");

    const blockedMove = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: devHeaders,
      body: JSON.stringify({ stage: "dev" }),
    });
    expect(blockedMove.status).toBe(409);

    // Dev cannot approve 'spec_freeze' (requires pm or owner)
    const forbiddenGate = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({
        targetType: "work_item",
        targetId: workItem.id,
        gateKey: "spec_freeze",
        status: "approved",
      }),
    });
    expect(forbiddenGate.status).toBe(403);

    // Owner approves 'spec_freeze', now moving to 'dev' succeeds
    const ownerGate = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "work_item",
        targetId: workItem.id,
        gateKey: "spec_freeze",
        status: "approved",
      }),
    });
    expect(ownerGate.status).toBe(201);

    const allowedMove = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: devHeaders,
      body: JSON.stringify({ stage: "dev" }),
    });
    expect(allowedMove.status).toBe(200);

    // 5. Simulate GitHub Webhook: PR opened -> dev, then Dotsbot requests changes (high risk)
    const prOpenBody = JSON.stringify({
      action: "opened",
      repository: { full_name: "acme/nexus-go" },
      pull_request: {
        number: 12,
        title: "[NEX-1] Auth middleware refactor",
        body: "Refs NEX-1",
        html_url: "https://github.com/acme/nexus-go/pull/12",
        state: "open",
        draft: false,
        merged: false,
        additions: 120,
        deletions: 40,
        head: { ref: "feat/NEX-1-auth", sha: "sha_v1" },
        base: { ref: "dev" },
        user: { login: "alice" },
      },
    });
    const wh1 = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "deliv-1",
        "x-hub-signature-256": signWebhook(config.githubWebhookSecret!, prOpenBody),
      },
      body: prOpenBody,
    });
    expect(wh1.status).toBe(202);

    const dotsReviewBody = JSON.stringify({
      action: "submitted",
      repository: { full_name: "acme/nexus-go" },
      pull_request: { number: 12, title: "[NEX-1] Auth middleware refactor" },
      review: {
        state: "changes_requested",
        body: "High risk: missing replay protection on refresh token.",
        html_url: "https://github.com/acme/nexus-go/pull/12#review-1",
        user: { login: "dotsbot[bot]" },
      },
    });
    const wh2 = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "pull_request_review",
        "x-github-delivery": "deliv-2",
        "x-hub-signature-256": signWebhook(config.githubWebhookSecret!, dotsReviewBody),
      },
      body: dotsReviewBody,
    });
    expect(wh2.status).toBe(202);
    expect(sentNotifications.some((n) => n.event === "pr.bot_blocked")).toBe(true);

    // Check review queue shows PR #12 under bot_blocked
    const queueRes = await app.request(`/api/v1/cockpit/review-queue?workspaceId=${workspace.id}`, {
      headers: ownerHeaders,
    });
    const queue = (await queueRes.json()) as {
      grouped: { bot_blocked: Array<{ number: number }> };
    };
    expect(queue.grouped.bot_blocked.map((p) => p.number)).toEqual([12]);

    // 6. Simulate check_run reporting Diff Coverage + Dotsbot auto-merge to dev -> System Pulse generated
    const checkBody = JSON.stringify({
      action: "completed",
      repository: { full_name: "acme/nexus-go" },
      check_run: {
        name: "ci/diff-coverage",
        status: "completed",
        conclusion: "success",
        head_sha: "sha_v1",
        output: { title: "Diff Coverage: 86.5% (min 75%)", summary: "All tests passed." },
        pull_requests: [{ number: 12 }],
      },
    });
    await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "check_run",
        "x-github-delivery": "deliv-3",
        "x-hub-signature-256": signWebhook(config.githubWebhookSecret!, checkBody),
      },
      body: checkBody,
    });

    const mergeBody = JSON.stringify({
      action: "closed",
      repository: { full_name: "acme/nexus-go" },
      pull_request: {
        number: 12,
        title: "[NEX-1] Auth middleware refactor",
        body: "Refs NEX-1",
        html_url: "https://github.com/acme/nexus-go/pull/12",
        state: "closed",
        draft: false,
        merged: true,
        additions: 120,
        deletions: 40,
        head: { ref: "feat/NEX-1-auth", sha: "sha_v2" },
        base: { ref: "dev" },
        user: { login: "alice" },
        merged_by: { login: "dotsbot[bot]" },
      },
    });
    await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "deliv-4",
        "x-hub-signature-256": signWebhook(config.githubWebhookSecret!, mergeBody),
      },
      body: mergeBody,
    });

    // Duplicate delivery is safely ignored
    const dupRes = await app.request("/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-github-event": "pull_request",
        "x-github-delivery": "deliv-4",
        "x-hub-signature-256": signWebhook(config.githubWebhookSecret!, mergeBody),
      },
      body: mergeBody,
    });
    expect(dupRes.status).toBe(200);
    expect(((await dupRes.json()) as { duplicate?: boolean }).duplicate).toBe(true);

    // Verify Cockpit Overview aggregates work item, system pulse, and merged PR cleanly
    const overviewRes = await app.request(
      `/api/v1/cockpit/overview?workspaceId=${workspace.id}&projectId=${project.id}`,
      { headers: ownerHeaders },
    );
    expect(overviewRes.status).toBe(200);
    const overview = (await overviewRes.json()) as {
      cards: Array<{
        workItem: { code: string };
        latestPulse: { sourceType: string; doneSummary: string } | null;
        changeRequests: Array<{ triageBucket: string }>;
      }>;
    };
    expect(overview.cards).toHaveLength(1);
    expect(overview.cards[0]?.workItem.code).toBe("NEX-1");
    expect(overview.cards[0]?.latestPulse?.sourceType).toBe("system_merge");
    expect(overview.cards[0]?.changeRequests[0]?.triageBucket).toBe("auto_merged_integration");

    // 7. Submit a Human Pulse with an architecture decision, lock an owner directive, and generate Living Memory + Digest
    const humanPulseRes = await app.request(`/api/v1/work-items/${workItem.id}/pulses`, {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({
        doneSummary: "Switched edge middleware to RS256 rotation",
        decisions: ["Standardize RS256 rotation across Go services"],
        blockers: [],
      }),
    });
    expect(humanPulseRes.status).toBe(201);

    const dirRes = await app.request(`/api/v1/projects/${project.id}/memory/directives`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({
        directives: [
          {
            id: "dir_lock",
            text: "Keep backward compatibility for v1 RN clients until Jan 1",
            createdBy: ownerAuth.user.id,
            createdAt: "2026-11-26T00:00:00.000Z",
            active: true,
          },
        ],
      }),
    });
    expect(dirRes.status).toBe(200);

    const digestRes = await app.request("/api/v1/cockpit/digests/generate", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ workspaceId: workspace.id, projectId: project.id }),
    });
    expect(digestRes.status).toBe(201);
    const { digest, updatedMemory } = (await digestRes.json()) as {
      digest: { markdownBody: string };
      updatedMemory: {
        version: number;
        architectureDecisions: Array<{ summary: string }>;
        directives: Array<{ text: string }>;
      };
    };
    expect(digest.markdownBody).toContain("Standardize RS256 rotation across Go services");
    expect(digest.markdownBody).toContain("Keep backward compatibility for v1 RN clients");
    expect(updatedMemory.architectureDecisions.map((d) => d.summary)).toContain(
      "Standardize RS256 rotation across Go services",
    );
    expect(updatedMemory.directives).toHaveLength(1);

    // 9. Members list & profile notification handle update
    const profileRes = await app.request("/api/v1/auth/me", {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        notificationHandles: { lark: "ou_owner_123" },
      }),
    });
    expect(profileRes.status).toBe(200);

    const membersRes = await app.request(`/api/v1/workspaces/${workspace.id}/members`, {
      headers: ownerHeaders,
    });
    expect(membersRes.status).toBe(200);
    const { members } = (await membersRes.json()) as {
      members: Array<{
        userId: string;
        roles: string[];
        notificationHandles: Record<string, string>;
      }>;
    };
    const ownerMember = members.find((m) => m.userId === ownerAuth.user.id);
    expect(ownerMember?.notificationHandles.lark).toBe("ou_owner_123");

    // 10. Cross-repo release lifecycle & prod_go gate enforcement
    const createRelRes = await app.request(`/api/v1/projects/${project.id}/releases`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        versionLabel: "v2.4.0",
        repoSnapshots: { "acme/nexus-core": "main@abc1234", "acme/admin-web": "main@def5678" },
        rollbackPlan: "Revert Helm chart to v2.3.9 and re-enable legacy gateway flag.",
        releaseNotesMd: "Auth outbox + Admin RBAC panel.",
      }),
    });
    expect(createRelRes.status).toBe(201);
    const { release: createdRel } = (await createRelRes.json()) as {
      release: { release: { id: string; status: string } };
    };

    // Trying to mark released before prod_go approval must be blocked with 409
    const blockedReleaseRes = await app.request(`/api/v1/releases/${createdRel.release.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ status: "released" }),
    });
    expect(blockedReleaseRes.status).toBe(409);

    // Approve prod_go gate on release, then reject it to verify rejection blocks release again, then re-approve
    const approveProdGoRes = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "release",
        targetId: createdRel.release.id,
        gateKey: "prod_go",
        status: "approved",
        note: "Initial canary green.",
      }),
    });
    expect(approveProdGoRes.status).toBe(201);

    const rejectProdGoRes = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "release",
        targetId: createdRel.release.id,
        gateKey: "prod_go",
        status: "rejected",
        note: "Latency spike detected in staging.",
      }),
    });
    expect(rejectProdGoRes.status).toBe(201);

    const blockedAfterRejectRes = await app.request(`/api/v1/releases/${createdRel.release.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ status: "released" }),
    });
    expect(blockedAfterRejectRes.status).toBe(409);

    const reapproveProdGoRes = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "release",
        targetId: createdRel.release.id,
        gateKey: "prod_go",
        status: "approved",
        note: "Staging canary green after hotfix.",
      }),
    });
    expect(reapproveProdGoRes.status).toBe(201);

    const releasedRes = await app.request(`/api/v1/releases/${createdRel.release.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ status: "released" }),
    });
    expect(releasedRes.status).toBe(200);
    const { release: finalRel } = (await releasedRes.json()) as {
      release: { release: { status: string; releasedAt: string | null }; gateApprovals: unknown[] };
    };
    expect(finalRel.release.status).toBe("released");
    expect(finalRel.release.releasedAt).not.toBeNull();
    expect(finalRel.gateApprovals).toHaveLength(3);

    // 11. Add teammate by GitHub/VCS login, fetch WorkItem detail, and link orphan PR
    const bobLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "go_dev_bob", displayName: "Bob" }),
    });
    expect(bobLoginRes.status).toBe(200);

    const addMemberRes = await app.request(`/api/v1/workspaces/${workspace.id}/members`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ identifier: "go_dev_bob", roles: ["dev", "ops"] }),
    });
    expect(addMemberRes.status).toBe(201);
    const { member: addedBob } = (await addMemberRes.json()) as {
      member: { primaryVcsLogin: string; roles: string[] };
    };
    expect(addedBob.primaryVcsLogin).toBe("go_dev_bob");
    expect(addedBob.roles).toEqual(["dev", "ops"]);

    const detailRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
      headers: ownerHeaders,
    });
    expect(detailRes.status).toBe(200);
    const detail = (await detailRes.json()) as {
      workItem: { id: string };
      pulses: unknown[];
      changeRequests: unknown[];
    };
    expect(detail.workItem.id).toBe(workItem.id);
    expect(detail.pulses.length).toBeGreaterThanOrEqual(2);

    // Create and toggle/delete notification channel
    const createChRes = await app.request(
      `/api/v1/workspaces/${workspace.id}/notification-channels`,
      {
        method: "POST",
        headers: ownerHeaders,
        body: JSON.stringify({
          driver: "lark",
          name: "Eng Alerts",
          config: { webhookUrl: "https://open.feishu.cn/open-apis/bot/v2/hook/test" },
        }),
      },
    );
    expect(createChRes.status).toBe(201);
    const { channel: createdCh } = (await createChRes.json()) as {
      channel: { id: string; isEnabled: boolean };
    };

    const toggleChRes = await app.request(
      `/api/v1/workspaces/${workspace.id}/notification-channels/${createdCh.id}`,
      {
        method: "PATCH",
        headers: ownerHeaders,
        body: JSON.stringify({ isEnabled: false }),
      },
    );
    expect(toggleChRes.status).toBe(200);
    const { channel: disabledCh } = (await toggleChRes.json()) as {
      channel: { isEnabled: boolean };
    };
    expect(disabledCh.isEnabled).toBe(false);

    const deleteChRes = await app.request(
      `/api/v1/workspaces/${workspace.id}/notification-channels/${createdCh.id}`,
      { method: "DELETE", headers: ownerHeaders },
    );
    expect(deleteChRes.status).toBe(200);
  });

  it("supports Team Collaboration Board: posts, @mentions, seq ordering, WS events, and auto-bridged pulse/gate/release posts", async () => {
    const { app, broker, pglite } = await createTestHub();
    cleanups.push(async () => {
      broker.close();
      await pglite.close();
    });

    const boardEvents: Array<Extract<HubWsEvent, { type: "board.message_created" }>> = [];
    const unsubscribe = broker.subscribe((event) => {
      if (event.type === "board.message_created") {
        boardEvents.push(event);
      }
    });
    cleanups.push(async () => {
      unsubscribe();
    });

    const ownerLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "boss", displayName: "Tech Founder" }),
    });
    const ownerAuth = (await ownerLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string };
    };
    const devLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", displayName: "Alice Dev" }),
    });
    const devAuth = (await devLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string };
    };
    const outsiderLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "eve", displayName: "Outsider" }),
    });
    const outsiderAuth = (await outsiderLoginRes.json()) as {
      tokens: { accessToken: string };
    };

    const ownerHeaders = {
      Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };
    const devHeaders = {
      Authorization: `Bearer ${devAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };
    const outsiderHeaders = {
      Authorization: `Bearer ${outsiderAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };

    const wsRes = await app.request("/api/v1/workspaces", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ slug: "swarm-team", name: "Swarm Team" }),
    });
    const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

    await app.request(`/api/v1/workspaces/${workspace.id}/members/${devAuth.user.id}`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ roles: ["dev"] }),
    });

    const projRes = await app.request(`/api/v1/workspaces/${workspace.id}/projects`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ key: "SWM", name: "Swarm Core", preset: "full-delivery" }),
    });
    const { project } = (await projRes.json()) as { project: { id: string } };

    // Non-members cannot read or post to the board
    const forbiddenGet = await app.request(`/api/v1/cockpit/board?workspaceId=${workspace.id}`, {
      headers: outsiderHeaders,
    });
    expect(forbiddenGet.status).toBe(403);
    const forbiddenPost = await app.request("/api/v1/cockpit/board", {
      method: "POST",
      headers: outsiderHeaders,
      body: JSON.stringify({ workspaceId: workspace.id, body: "sneaky" }),
    });
    expect(forbiddenPost.status).toBe(403);

    // 1. Direct board message (no mentions -> kind "message", seq 1)
    const post1Res = await app.request("/api/v1/cockpit/board", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        workspaceId: workspace.id,
        projectId: project.id,
        body: "Kickoff: tracking SWM sprint on this board.",
      }),
    });
    expect(post1Res.status).toBe(201);
    const { message: msg1 } = (await post1Res.json()) as { message: TeamBoardMessage };
    expect(msg1.seq).toBe(1);
    expect(msg1.kind).toBe("message");
    expect(msg1.authorHandle).toBe("boss");
    expect(msg1.mentions).toEqual([]);

    // 2. Mention-bearing post auto-infers kind "handoff", deduplicates mentions, increments seq to 2
    const post2Res = await app.request("/api/v1/cockpit/board", {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({
        workspaceId: workspace.id,
        projectId: project.id,
        body: "@Boss ready to verify with (@dotsbot[bot]) and @boss.",
        mentions: ["qa-lead"],
      }),
    });
    expect(post2Res.status).toBe(201);
    const { message: msg2 } = (await post2Res.json()) as { message: TeamBoardMessage };
    expect(msg2.seq).toBe(2);
    expect(msg2.kind).toBe("handoff");
    expect(msg2.authorHandle).toBe("alice");
    expect(msg2.mentions).toEqual(["boss", "dotsbot[bot]", "qa-lead"]);

    // 3. Auto-bridged pulse, gate approval, release creation, and release status update
    const wiRes = await app.request(`/api/v1/projects/${project.id}/work-items`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ title: "Wire board feed" }),
    });
    const { workItem } = (await wiRes.json()) as { workItem: { id: string; code: string } };

    const pulseRes = await app.request(`/api/v1/work-items/${workItem.id}/pulses`, {
      method: "POST",
      headers: devHeaders,
      body: JSON.stringify({
        doneSummary: "Implemented board routes and mention parser",
        nextStep: "@boss please sign off spec_freeze",
      }),
    });
    expect(pulseRes.status).toBe(201);

    const gateRes = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "work_item",
        targetId: workItem.id,
        gateKey: "spec_freeze",
        status: "approved",
        note: "Looks clean",
      }),
    });
    expect(gateRes.status).toBe(201);

    const relCreateRes = await app.request(`/api/v1/projects/${project.id}/releases`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        versionLabel: "v1.2.0",
        workItemIds: [workItem.id],
      }),
    });
    expect(relCreateRes.status).toBe(201);
    const { release: createdRel } = (await relCreateRes.json()) as {
      release: { release: { id: string } };
    };

    const relPatchRes = await app.request(`/api/v1/releases/${createdRel.release.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ status: "staging" }),
    });
    expect(relPatchRes.status).toBe(200);

    // Fetch entire board chronologically (seq 1..6)
    const listAllRes = await app.request(
      `/api/v1/cockpit/board?workspaceId=${workspace.id}&projectId=${project.id}`,
      { headers: ownerHeaders },
    );
    expect(listAllRes.status).toBe(200);
    const allBoard = (await listAllRes.json()) as {
      messages: TeamBoardMessage[];
      head: number;
    };
    expect(allBoard.head).toBe(6);
    expect(allBoard.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(allBoard.messages.map((m) => m.kind)).toEqual([
      "message",
      "handoff",
      "pulse",
      "review",
      "release",
      "release",
    ]);
    expect(allBoard.messages[2]?.workItemId).toBe(workItem.id);
    expect(allBoard.messages[2]?.workItemCode).toBe("SWM-1");
    expect(allBoard.messages[2]?.mentions).toEqual(["boss"]);
    expect(allBoard.messages[3]?.workItemId).toBe(workItem.id);
    expect(allBoard.messages[3]?.workItemCode).toBe("SWM-1");
    expect(allBoard.messages[3]?.body).toContain("Approved gate");
    expect(allBoard.messages[4]?.body).toContain("v1.2.0");
    expect(allBoard.messages[5]?.body).toContain("planning -> staging");

    // Verify `since` cursor and `limit` windowing
    const sinceRes = await app.request(
      `/api/v1/cockpit/board?workspaceId=${workspace.id}&since=4&limit=10`,
      { headers: ownerHeaders },
    );
    expect(sinceRes.status).toBe(200);
    const sinceBoard = (await sinceRes.json()) as {
      messages: TeamBoardMessage[];
      head: number;
    };
    expect(sinceBoard.head).toBe(6);
    expect(sinceBoard.messages.map((m) => m.seq)).toEqual([5, 6]);

    const latestTwoRes = await app.request(
      `/api/v1/cockpit/board?workspaceId=${workspace.id}&limit=2`,
      { headers: ownerHeaders },
    );
    expect(latestTwoRes.status).toBe(200);
    const latestTwo = (await latestTwoRes.json()) as {
      messages: TeamBoardMessage[];
      head: number;
    };
    expect(latestTwo.head).toBe(6);
    expect(latestTwo.messages.map((m) => m.seq)).toEqual([5, 6]);

    // Verify WebSocket broker emitted board.message_created for all 6 messages
    expect(boardEvents.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(boardEvents[1]?.mentions).toEqual(["boss", "dotsbot[bot]", "qa-lead"]);
  });

  it("persists work item assignees on create and posts handoff board messages on reassignment", async () => {
    const { app, broker, pglite } = await createTestHub();
    cleanups.push(async () => {
      broker.close();
      await pglite.close();
    });

    const ownerLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "boss", displayName: "Tech Founder" }),
    });
    const ownerAuth = (await ownerLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string };
    };
    const devLoginRes = await app.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "alice", displayName: "Alice Dev" }),
    });
    const devAuth = (await devLoginRes.json()) as {
      user: { id: string };
      tokens: { accessToken: string };
    };

    const ownerHeaders = {
      Authorization: `Bearer ${ownerAuth.tokens.accessToken}`,
      "Content-Type": "application/json",
    };

    const wsRes = await app.request("/api/v1/workspaces", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ slug: "delivery-team", name: "Delivery Team" }),
    });
    const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

    await app.request(`/api/v1/workspaces/${workspace.id}/members/${devAuth.user.id}`, {
      method: "PUT",
      headers: ownerHeaders,
      body: JSON.stringify({ roles: ["dev"] }),
    });

    const projRes = await app.request(`/api/v1/workspaces/${workspace.id}/projects`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({ key: "DLV", name: "Delivery", preset: "full-delivery" }),
    });
    const { project } = (await projRes.json()) as { project: { id: string } };

    const createAssignedRes = await app.request(`/api/v1/projects/${project.id}/work-items`, {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        title: "Build Gantt schedule",
        assigneeType: "human",
        assigneeUserId: ownerAuth.user.id,
        attributes: { plannedStartAt: "2026-11-27", dueAt: "2026-12-03" },
      }),
    });
    expect(createAssignedRes.status).toBe(201);
    const { workItem } = (await createAssignedRes.json()) as {
      workItem: {
        id: string;
        code: string;
        assigneeType: string;
        assigneeUserId: string | null;
        assigneeRunnerId: string | null;
      };
    };
    expect(workItem.assigneeType).toBe("human");
    expect(workItem.assigneeUserId).toBe(ownerAuth.user.id);
    expect(workItem.assigneeRunnerId).toBeNull();

    // Reassign to human teammate -> posts handoff mentioning @alice
    const assignHumanRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        assigneeType: "human",
        assigneeUserId: devAuth.user.id,
      }),
    });
    expect(assignHumanRes.status).toBe(200);

    // Re-saving same assignee does NOT post a duplicate handoff
    const noopSaveRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        assigneeType: "human",
        assigneeUserId: devAuth.user.id,
        title: "Build Gantt schedule v2",
      }),
    });
    expect(noopSaveRes.status).toBe(200);

    // Reassign to coding runner -> clears assigneeUserId and posts handoff mentioning @claude-agent
    const assignRunnerRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({
        assigneeType: "runner",
        assigneeRunnerId: "claude-agent",
      }),
    });
    expect(assignRunnerRes.status).toBe(200);
    const { workItem: runnerAssigned } = (await assignRunnerRes.json()) as {
      workItem: {
        assigneeType: string;
        assigneeUserId: string | null;
        assigneeRunnerId: string | null;
      };
    };
    expect(runnerAssigned.assigneeType).toBe("runner");
    expect(runnerAssigned.assigneeUserId).toBeNull();
    expect(runnerAssigned.assigneeRunnerId).toBe("claude-agent");

    // Unassigning clears both and does NOT post a handoff
    const unassignRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
      method: "PATCH",
      headers: ownerHeaders,
      body: JSON.stringify({ assigneeType: "unassigned" }),
    });
    expect(unassignRes.status).toBe(200);

    const boardRes = await app.request(
      `/api/v1/cockpit/board?workspaceId=${workspace.id}&projectId=${project.id}`,
      { headers: ownerHeaders },
    );
    expect(boardRes.status).toBe(200);
    const board = (await boardRes.json()) as { messages: TeamBoardMessage[]; head: number };
    expect(board.head).toBe(2);
    expect(board.messages.map((m) => m.kind)).toEqual(["handoff", "handoff"]);
    expect(board.messages[0]?.mentions).toEqual(["alice"]);
    expect(board.messages[0]?.body).toContain("@alice");
    expect(board.messages[0]?.workItemCode).toBe("DLV-1");
    expect(board.messages[1]?.mentions).toEqual(["claude-agent"]);
    expect(board.messages[1]?.body).toContain("@claude-agent");
  });
});
