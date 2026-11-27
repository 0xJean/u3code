import { Hono } from "hono";
import { cors } from "hono/cors";
import { GitHubAuthProvider, type AuthProvider } from "./auth/providers.ts";
import type { HubConfig } from "./config.ts";
import type { HubDatabase } from "./db/client.ts";
import { NotificationDispatcher } from "./notifiers/index.ts";
import { BUILTIN_HUB_PLUGINS, HubPluginRegistry, type HubPlugin } from "./plugins/index.ts";
import { createAuthRoutes } from "./routes/auth.ts";
import { createCockpitRoutes } from "./routes/cockpit.ts";
import { createReleaseRoutes } from "./routes/releases.ts";
import { createWorkItemRoutes } from "./routes/workItems.ts";
import { createWorkspaceRoutes } from "./routes/workspaces.ts";
import { verifyHmacSha256 } from "./utils/crypto.ts";
import { handleGitHubWebhook } from "./webhooks/github.ts";
import { HubSocketBroker } from "./ws/hubSocket.ts";

export interface CreateHubAppOptions {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker?: HubSocketBroker;
  readonly notifier?: NotificationDispatcher;
  readonly githubProvider?: AuthProvider;
  readonly plugins?: readonly HubPlugin[];
  readonly fetchImpl?: typeof fetch;
}

export function createHubApp(options: CreateHubAppOptions): {
  readonly app: Hono;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
  readonly pluginRegistry: HubPluginRegistry;
} {
  const broker = options.broker ?? new HubSocketBroker();
  const notifier = options.notifier ?? new NotificationDispatcher(options.db, options.config, []);
  const githubProvider = options.githubProvider ?? new GitHubAuthProvider(options.config);

  const pluginRegistry = new HubPluginRegistry({
    db: options.db,
    config: options.config,
    broker,
    notifier,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  });
  for (const builtin of BUILTIN_HUB_PLUGINS) {
    pluginRegistry.register(builtin);
  }
  for (const external of options.plugins ?? []) {
    pluginRegistry.register(external);
  }

  const app = new Hono();

  app.use(
    "/api/*",
    cors({
      origin: "*",
      allowHeaders: ["Authorization", "Content-Type"],
      allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    }),
  );

  app.get("/healthz", (c) => c.json({ ok: true, service: "u3code-hub" }));

  app.post("/webhooks/github", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("x-hub-signature-256") ?? "";
    const deliveryId = c.req.header("x-github-delivery") ?? "";
    const eventName = c.req.header("x-github-event") ?? "";

    if (!deliveryId || !eventName) {
      return c.json({ error: "Missing GitHub delivery or event header." }, 400);
    }

    if (options.config.githubWebhookSecret) {
      if (!signature || !verifyHmacSha256(options.config.githubWebhookSecret, rawBody, signature)) {
        return c.json({ error: "Invalid webhook signature." }, 401);
      }
    }

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(rawBody) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Invalid JSON payload." }, 400);
    }

    const result = await handleGitHubWebhook(
      { db: options.db, broker, notifier },
      { deliveryId, eventName, payload },
    );

    return c.json(result, result.duplicate ? 200 : 202);
  });

  app.route(
    "/api/v1/auth",
    createAuthRoutes({ db: options.db, config: options.config, githubProvider }),
  );
  app.route(
    "/api/v1",
    createWorkspaceRoutes({
      db: options.db,
      config: options.config,
      broker,
      notifier,
      pluginRegistry,
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
  );
  app.route(
    "/api/v1",
    createWorkItemRoutes({ db: options.db, config: options.config, broker, notifier }),
  );
  app.route(
    "/api/v1",
    createReleaseRoutes({ db: options.db, config: options.config, broker, notifier }),
  );
  app.route(
    "/api/v1/cockpit",
    createCockpitRoutes({ db: options.db, config: options.config, broker, notifier }),
  );
  pluginRegistry.mountRoutes(app);

  return { app, broker, notifier, pluginRegistry };
}
