import * as Schema from "effect/Schema";
import { IsoTimestamp } from "./auth.ts";

export const NotifierDriverKind = Schema.Literals(["lark", "slack", "discord", "webhook"]);
export type NotifierDriverKind = typeof NotifierDriverKind.Type;

export const NotificationEventKind = Schema.Literals([
  "digest.ready",
  "pr.bot_blocked",
  "pr.ready_for_human_review",
  "blocker.needs_attention",
  "gate.updated",
  "release.ready",
]);
export type NotificationEventKind = typeof NotificationEventKind.Type;

export const NotificationChannelSummary = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  driver: NotifierDriverKind,
  name: Schema.String,
  events: Schema.Array(NotificationEventKind),
  isEnabled: Schema.Boolean,
  createdAt: IsoTimestamp,
});
export type NotificationChannelSummary = typeof NotificationChannelSummary.Type;

export const NotificationMessage = Schema.Struct({
  event: NotificationEventKind,
  title: Schema.String,
  severity: Schema.Literals(["info", "warning", "critical"]),
  summary: Schema.String,
  bullets: Schema.Array(Schema.String),
  url: Schema.optional(Schema.String),
  mentionHandles: Schema.optional(Schema.Array(Schema.String)),
  metadata: Schema.optional(Schema.Record(Schema.String, Schema.Unknown)),
});
export type NotificationMessage = typeof NotificationMessage.Type;
