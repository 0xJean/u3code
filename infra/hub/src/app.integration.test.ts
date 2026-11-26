import * as NodeCrypto from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterEach, describe, expect, it } from "vite-plus/test";
import type { NotificationMessage } from "@u3code/hub-contracts";
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

    // Approve prod_go gate on release
    const approveProdGoRes = await app.request("/api/v1/gates/approve", {
      method: "POST",
      headers: ownerHeaders,
      body: JSON.stringify({
        targetType: "release",
        targetId: createdRel.release.id,
        gateKey: "prod_go",
        status: "approved",
        note: "Staging canary green.",
      }),
    });
    expect(approveProdGoRes.status).toBe(201);

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
    expect(finalRel.gateApprovals).toHaveLength(1);
  });
});
