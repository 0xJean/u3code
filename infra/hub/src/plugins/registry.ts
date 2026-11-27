import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Hono } from "hono";
import type {
  HubPluginSummary,
  HubWsEvent,
  RegisteredWorkflowPreset,
  WorkflowConfig,
} from "@u3code/hub-contracts";
import { createAuthMiddleware } from "../auth/middleware.ts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import type { NotificationDispatcher } from "../notifiers/index.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";
import type { HubPlugin, HubPluginEventHandler, HubPluginEventType } from "./types.ts";

interface MountedPluginRoute {
  readonly pluginId: string;
  readonly mountPath: string;
  readonly app: Hono;
}

export class HubPluginRegistry {
  readonly #db: HubDatabase;
  readonly #config: HubConfig;
  readonly #broker: HubSocketBroker;
  readonly #notifier: NotificationDispatcher;
  readonly #fetchImpl: typeof fetch;

  readonly #plugins = new Map<string, HubPluginSummary>();
  readonly #presets = new Map<string, RegisteredWorkflowPreset>();
  readonly #routes: MountedPluginRoute[] = [];
  readonly #unsubscribers: Array<() => void> = [];

  constructor(deps: {
    readonly db: HubDatabase;
    readonly config: HubConfig;
    readonly broker: HubSocketBroker;
    readonly notifier: NotificationDispatcher;
    readonly fetchImpl?: typeof fetch;
  }) {
    this.#db = deps.db;
    this.#config = deps.config;
    this.#broker = deps.broker;
    this.#notifier = deps.notifier;
    this.#fetchImpl = deps.fetchImpl ?? fetch;
  }

  register(plugin: HubPlugin): void {
    const id = plugin.id.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-_]{0,63}$/.test(id)) {
      throw new Error(
        `Invalid HubPlugin id '${plugin.id}'. Use lowercase alphanumeric, '-' or '_'.`,
      );
    }
    if (this.#plugins.has(id)) {
      throw new Error(`HubPlugin '${id}' is already registered.`);
    }

    const notifiers: string[] = [];
    const workflowPresets: string[] = [];
    const eventHooks: string[] = [];
    const routes: string[] = [];

    plugin.register({
      db: this.#db,
      config: this.#config,
      broker: this.#broker,
      notifier: this.#notifier,
      fetchImpl: this.#fetchImpl,
      registerNotifier: (driver) => {
        if (plugin.builtin !== true || !this.#notifier.hasDriver(driver.kind)) {
          this.#notifier.registerDriver(driver);
        }
        if (!notifiers.includes(driver.kind)) notifiers.push(driver.kind);
      },
      registerWorkflowPreset: (preset) => {
        const presetId = preset.id.trim();
        this.#presets.set(presetId, {
          id: presetId,
          label: preset.label,
          description: preset.description,
          pluginId: id,
          workflowConfig: {
            preset: presetId,
            stages: preset.workflowConfig.stages.map((s) => ({ ...s })),
            gates: preset.workflowConfig.gates.map((g) => ({
              ...g,
              requiredRoles: [...g.requiredRoles],
            })),
            progressLedgers: [...(preset.workflowConfig.progressLedgers ?? [])],
          },
        });
        if (!workflowPresets.includes(presetId)) workflowPresets.push(presetId);
      },
      onEvent: <T extends HubPluginEventType>(eventType: T, handler: HubPluginEventHandler<T>) => {
        const unsub = this.#broker.subscribe((event: HubWsEvent) => {
          if (eventType !== "*" && event.type !== eventType) return;
          return (handler as (e: HubWsEvent) => void | Promise<void>)(event);
        });
        this.#unsubscribers.push(unsub);
        if (!eventHooks.includes(eventType)) eventHooks.push(eventType);
      },
      registerRoute: (subPath, routeApp) => {
        const cleanSub = subPath.replace(/^\/+|\/+$/g, "");
        const mountPath = cleanSub ? `/plugins/${id}/${cleanSub}` : `/plugins/${id}`;
        this.#routes.push({ pluginId: id, mountPath, app: routeApp });
        if (!routes.includes(mountPath)) routes.push(mountPath);
      },
    });

    this.#plugins.set(id, {
      id,
      name: plugin.name,
      version: plugin.version,
      description: plugin.description,
      builtin: plugin.builtin === true,
      capabilities: {
        notifiers,
        workflowPresets,
        eventHooks,
        routes,
      },
    });
  }

  listPlugins(): HubPluginSummary[] {
    return [...this.#plugins.values()];
  }

  listWorkflowPresets(): RegisteredWorkflowPreset[] {
    return [...this.#presets.values()];
  }

  resolveWorkflowPreset(presetId: string): WorkflowConfig | null {
    const found = this.#presets.get(presetId.trim());
    if (!found) return null;
    return {
      preset: found.workflowConfig.preset,
      stages: found.workflowConfig.stages.map((s) => ({ ...s })),
      gates: found.workflowConfig.gates.map((g) => ({
        ...g,
        requiredRoles: [...g.requiredRoles],
      })),
      progressLedgers: [...(found.workflowConfig.progressLedgers ?? [])],
    };
  }

  mountRoutes(app: Hono): void {
    const metaApp = new Hono();
    metaApp.use("*", createAuthMiddleware(this.#db, this.#config));
    metaApp.get("/", (c) =>
      c.json({
        plugins: this.listPlugins(),
        workflowPresets: this.listWorkflowPresets(),
      }),
    );
    app.route("/api/v1/plugins", metaApp);

    for (const mounted of this.#routes) {
      app.route(mounted.mountPath, mounted.app);
    }
  }

  dispose(): void {
    for (const unsub of this.#unsubscribers) {
      unsub();
    }
    this.#unsubscribers.length = 0;
  }
}

export async function loadExternalHubPlugins(
  moduleSpecifiers: readonly string[],
  baseDir: string = process.cwd(),
): Promise<HubPlugin[]> {
  const loaded: HubPlugin[] = [];
  for (const rawSpec of moduleSpecifiers) {
    const spec = rawSpec.trim();
    if (!spec) continue;
    const resolved =
      spec.startsWith(".") || spec.startsWith("/")
        ? NodeURL.pathToFileURL(NodePath.resolve(baseDir, spec)).href
        : spec;
    const mod = (await import(resolved)) as {
      readonly default?: HubPlugin;
      readonly plugin?: HubPlugin;
    };
    const candidate = mod.default ?? mod.plugin;
    if (!candidate || typeof candidate.register !== "function" || !candidate.id) {
      throw new Error(
        `External plugin module '${spec}' must default-export (or export 'plugin') a HubPlugin created with defineHubPlugin().`,
      );
    }
    loaded.push({ ...candidate, builtin: false });
  }
  return loaded;
}
