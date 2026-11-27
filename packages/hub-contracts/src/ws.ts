import * as Schema from "effect/Schema";
import { TriageBucket } from "./cockpit.ts";
import { WorkHealth } from "./pulse.ts";

export const HubWsEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("work_item.changed"),
    workspaceId: Schema.String,
    projectId: Schema.String,
    workItemId: Schema.String,
    stage: Schema.String,
    health: WorkHealth,
  }),
  Schema.Struct({
    type: Schema.Literal("pulse.created"),
    workspaceId: Schema.String,
    projectId: Schema.String,
    workItemId: Schema.String,
    pulseId: Schema.String,
    hasBlocker: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("change_request.updated"),
    workspaceId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
    repoFullName: Schema.String,
    number: Schema.Int,
    triageBucket: TriageBucket,
    blockingCount: Schema.Int,
  }),
  Schema.Struct({
    type: Schema.Literal("gate.updated"),
    workspaceId: Schema.String,
    targetType: Schema.Literals(["work_item", "release"]),
    targetId: Schema.String,
    gateKey: Schema.String,
    status: Schema.Literals(["approved", "rejected", "revoked"]),
  }),
  Schema.Struct({
    type: Schema.Literal("digest.created"),
    workspaceId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
    digestId: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("release.updated"),
    workspaceId: Schema.String,
    projectId: Schema.String,
    releaseId: Schema.String,
    versionLabel: Schema.String,
    status: Schema.Literals(["planning", "staging", "ready", "released", "rolled_back"]),
  }),
  Schema.Struct({
    type: Schema.Literal("board.message_created"),
    workspaceId: Schema.String,
    projectId: Schema.NullOr(Schema.String),
    messageId: Schema.String,
    seq: Schema.Int,
    authorHandle: Schema.String,
    mentions: Schema.Array(Schema.String),
  }),
]);
export type HubWsEvent = typeof HubWsEvent.Type;
