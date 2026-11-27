import * as Schema from "effect/Schema";
import { RepoPolicy, WorkflowConfig } from "./workflow.ts";

export const HubPluginCapabilities = Schema.Struct({
  notifiers: Schema.Array(Schema.String),
  workflowPresets: Schema.Array(Schema.String),
  eventHooks: Schema.Array(Schema.String),
  routes: Schema.Array(Schema.String),
});
export type HubPluginCapabilities = typeof HubPluginCapabilities.Type;

export const HubPluginSummary = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  builtin: Schema.Boolean,
  capabilities: HubPluginCapabilities,
});
export type HubPluginSummary = typeof HubPluginSummary.Type;

export const RegisteredWorkflowPreset = Schema.Struct({
  id: Schema.String,
  label: Schema.String,
  description: Schema.String,
  pluginId: Schema.String,
  workflowConfig: WorkflowConfig,
});
export type RegisteredWorkflowPreset = typeof RegisteredWorkflowPreset.Type;

export const HubPluginsListResponse = Schema.Struct({
  plugins: Schema.Array(HubPluginSummary),
  workflowPresets: Schema.Array(RegisteredWorkflowPreset),
});
export type HubPluginsListResponse = typeof HubPluginsListResponse.Type;

export const PlaybookPackWorkflowEntry = Schema.Struct({
  file: Schema.String,
  name: Schema.String,
  description: Schema.String,
});
export type PlaybookPackWorkflowEntry = typeof PlaybookPackWorkflowEntry.Type;

export const PlaybookPackSkillEntry = Schema.Struct({
  dir: Schema.String,
  name: Schema.String,
  description: Schema.String,
});
export type PlaybookPackSkillEntry = typeof PlaybookPackSkillEntry.Type;

export const PlaybookPackHubConfig = Schema.Struct({
  workflowPresetId: Schema.optional(Schema.String),
  workflowConfig: Schema.optional(WorkflowConfig),
  defaultRepoPolicy: Schema.optional(RepoPolicy),
  defaultDirectives: Schema.optional(Schema.Array(Schema.String)),
  recommendedPlugins: Schema.optional(Schema.Array(Schema.String)),
});
export type PlaybookPackHubConfig = typeof PlaybookPackHubConfig.Type;

export const PlaybookPackManifest = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  id: Schema.String,
  name: Schema.String,
  version: Schema.String,
  description: Schema.String,
  author: Schema.optional(Schema.String),
  tags: Schema.optional(Schema.Array(Schema.String)),
  hub: Schema.optional(PlaybookPackHubConfig),
  workflows: Schema.optional(Schema.Array(PlaybookPackWorkflowEntry)),
  skills: Schema.optional(Schema.Array(PlaybookPackSkillEntry)),
});
export type PlaybookPackManifest = typeof PlaybookPackManifest.Type;
