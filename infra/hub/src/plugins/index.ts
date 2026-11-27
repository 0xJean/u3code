import { automationRelayPlugin } from "./builtin/automationRelayPlugin.ts";
import { coreWorkflowsPlugin } from "./builtin/coreWorkflowsPlugin.ts";
import { larkPlugin } from "./builtin/larkPlugin.ts";
import { webhookPlugin } from "./builtin/webhookPlugin.ts";
import type { HubPlugin } from "./types.ts";

export { HubPluginRegistry, loadExternalHubPlugins } from "./registry.ts";
export {
  defineHubPlugin,
  type HubPlugin,
  type HubPluginContext,
  type HubPluginEventHandler,
  type HubPluginEventType,
  type HubPluginWorkflowPresetInput,
} from "./types.ts";
export { automationRelayPlugin, coreWorkflowsPlugin, larkPlugin, webhookPlugin };

export const BUILTIN_HUB_PLUGINS: readonly HubPlugin[] = [
  coreWorkflowsPlugin,
  larkPlugin,
  webhookPlugin,
  automationRelayPlugin,
];
