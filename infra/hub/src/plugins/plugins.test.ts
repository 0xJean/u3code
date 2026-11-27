import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { createHubApp } from "../app.ts";
import { loadHubConfig } from "../config.ts";
import { readInitMigrationSql, type HubDatabase } from "../db/client.ts";
import { defineHubPlugin } from "./index.ts";

describe("HubPlugin runtime, built-in plugins & custom extensions", () => {
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

  it("loads built-in + custom plugins, resolves plugin presets, relays events, and handles Lark card gate callbacks", async () => {
    const relayedPayloads: Array<{ url: string; headers: Record<string, string>; body: string }> =
      [];
    let resolveFirstRelay: (() => void) | undefined;
    const firstRelayDone = new Promise<void>((resolve) => {
      resolveFirstRelay = resolve;
    });
    const fakeFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      relayedPayloads.push({
        url: String(input),
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: typeof init?.body === "string" ? init.body : "",
      });
      resolveFirstRelay?.();
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const customEventsSeen: string[] = [];
    const customPlugin = defineHubPlugin({
      id: "acme-custom",
      name: "Acme Custom Delivery",
      version: "0.2.0",
      description: "Custom workflow preset, event hook, and ping route.",
      register(ctx) {
        ctx.registerWorkflowPreset({
          id: "acme-fast-track",
          label: "Acme Fast Track",
          description: "2-stage express flow with owner gate.",
          workflowConfig: {
            preset: "acme-fast-track",
            stages: [
              { id: "build", label: "Build", category: "active" },
              { id: "shipped", label: "Shipped", category: "done" },
            ],
            gates: [
              {
                key: "prod_go",
                label: "Ship Approval",
                requiredRoles: ["owner"],
                beforeStage: "shipped",
              },
            ],
            progressLedgers: [],
          },
        });
        ctx.onEvent("work_item.changed", (event) => {
          customEventsSeen.push(`${event.type}:${event.stage}`);
        });
        const pingApp = new Hono();
        pingApp.get("/", (c) => c.json({ pong: true, plugin: "acme-custom" }));
        ctx.registerRoute("ping", pingApp);
      },
    });

    const config = loadHubConfig({
      HUB_ALLOW_LOCAL_DEV_AUTH: "true",
      HUB_JWT_SECRET: "plugin-test-secret-key-32-bytes-minimum!",
      HUB_LARK_VERIFICATION_TOKEN: "lark-verify-123",
      HUB_AUTOMATION_WEBHOOK_URL: "http://automation.local/hook",
      HUB_AUTOMATION_WEBHOOK_SECRET: "relay-secret",
    });

    const { app, pluginRegistry } = createHubApp({
      db,
      config,
      plugins: [customPlugin],
      fetchImpl: fakeFetch,
    });

    try {
      // 1. Login and list installed plugins + workflow presets
      const loginRes = await app.request("/api/v1/auth/local/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: "owner_plug", displayName: "Owner" }),
      });
      expect(loginRes.status).toBe(200);
      const { tokens } = (await loginRes.json()) as { tokens: { accessToken: string } };
      const authHeaders = {
        Authorization: `Bearer ${tokens.accessToken}`,
        "Content-Type": "application/json",
      };

      // Bind Lark open_id for interactive card callback test
      await app.request("/api/v1/auth/me", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ notificationHandles: { lark: "ou_owner_lark_001" } }),
      });

      const pluginsRes = await app.request("/api/v1/plugins", { headers: authHeaders });
      expect(pluginsRes.status).toBe(200);
      const pluginsJson = (await pluginsRes.json()) as {
        plugins: Array<{ id: string; builtin: boolean }>;
        workflowPresets: Array<{ id: string; pluginId: string }>;
      };
      expect(pluginsJson.plugins.map((p) => p.id)).toEqual(
        expect.arrayContaining([
          "core-workflows",
          "lark",
          "webhook",
          "automation-relay",
          "acme-custom",
        ]),
      );
      expect(pluginsJson.workflowPresets.map((p) => p.id)).toEqual(
        expect.arrayContaining([
          "full-delivery",
          "lean",
          "dual-branch-bot-gated",
          "acme-fast-track",
        ]),
      );

      // 2. Verify custom plugin mounted route
      const pingRes = await app.request("/plugins/acme-custom/ping");
      expect(pingRes.status).toBe(200);
      expect(await pingRes.json()).toEqual({ pong: true, plugin: "acme-custom" });

      // 3. Create workspace & project using custom plugin preset
      const wsRes = await app.request("/api/v1/workspaces", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ slug: "plug-org", name: "Plugin Org" }),
      });
      const { workspace } = (await wsRes.json()) as { workspace: { id: string } };

      const projRes = await app.request(`/api/v1/workspaces/${workspace.id}/projects`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ key: "FAST", name: "Fast App", preset: "acme-fast-track" }),
      });
      expect(projRes.status).toBe(201);
      const { project } = (await projRes.json()) as {
        project: { id: string; workflowConfig: { preset: string; stages: Array<{ id: string }> } };
      };
      expect(project.workflowConfig.preset).toBe("acme-fast-track");
      expect(project.workflowConfig.stages.map((s) => s.id)).toEqual(["build", "shipped"]);

      // 4. Create work item (triggers custom plugin event hook)
      const wiRes = await app.request(`/api/v1/projects/${project.id}/work-items`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ title: "Ship plugin system" }),
      });
      const { workItem } = (await wiRes.json()) as { workItem: { id: string } };
      expect(customEventsSeen).toContain("work_item.changed:build");

      // 5. Lark URL challenge verification
      const challengeRes = await app.request("/plugins/lark/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: "url_verification",
          token: "lark-verify-123",
          challenge: "challenge-xyz",
        }),
      });
      expect(challengeRes.status).toBe(200);
      expect(await challengeRes.json()).toEqual({ challenge: "challenge-xyz" });

      // 6. Lark interactive card gate rejection -> triggers automation relay webhook!
      const larkRejectRes = await app.request("/plugins/lark/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "lark-verify-123",
          open_id: "ou_owner_lark_001",
          action: {
            value: {
              action: "gate_decision",
              targetType: "work_item",
              targetId: workItem.id,
              gateKey: "prod_go",
              status: "rejected",
              note: "Need canary checklist first",
            },
          },
        }),
      });
      expect(larkRejectRes.status).toBe(200);

      await firstRelayDone;
      expect(relayedPayloads.length).toBeGreaterThanOrEqual(1);
      expect(relayedPayloads[0]?.headers["X-U3Code-Event"]).toBe("gate.rejected");
      expect(relayedPayloads[0]?.headers["X-U3Code-Signature-256"]).toMatch(
        /^sha256=[0-9a-f]{64}$/,
      );

      // 7. Lark interactive card gate approval -> unblocks moving to shipped stage!
      const larkApproveRes = await app.request("/plugins/lark/callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: "lark-verify-123",
          open_id: "ou_owner_lark_001",
          action: {
            value: {
              action: "gate_decision",
              targetType: "work_item",
              targetId: workItem.id,
              gateKey: "prod_go",
              status: "approved",
            },
          },
        }),
      });
      expect(larkApproveRes.status).toBe(200);

      const moveShippedRes = await app.request(`/api/v1/work-items/${workItem.id}`, {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({ stage: "shipped" }),
      });
      expect(moveShippedRes.status).toBe(200);
    } finally {
      pluginRegistry.dispose();
    }
  });
});
