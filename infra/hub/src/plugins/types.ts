import type { Hono } from "hono";
import type { HubWsEvent, WorkflowConfig } from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import type { NotificationDispatcher, NotifierDriver } from "../notifiers/index.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

export type HubPluginEventType = HubWsEvent["type"] | "*";

export type HubPluginEventHandler<T extends HubPluginEventType = HubPluginEventType> = (
  event: T extends "*" ? HubWsEvent : Extract<HubWsEvent, { readonly type: T }>,
) => void | Promise<void>;

export interface HubPluginWorkflowPresetInput {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly workflowConfig: WorkflowConfig;
}

export interface HubPluginContext {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
  readonly notifier: NotificationDispatcher;
  readonly fetchImpl: typeof fetch;
  readonly registerNotifier: (driver: NotifierDriver) => void;
  readonly registerWorkflowPreset: (preset: HubPluginWorkflowPresetInput) => void;
  readonly onEvent: <T extends HubPluginEventType>(
    eventType: T,
    handler: HubPluginEventHandler<T>,
  ) => void;
  readonly registerRoute: (subPath: string, routeApp: Hono) => void;
}

export interface HubPlugin {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly description: string;
  readonly builtin?: boolean;
  readonly register: (ctx: HubPluginContext) => void;
}

export function defineHubPlugin(plugin: HubPlugin): HubPlugin {
  return plugin;
}
