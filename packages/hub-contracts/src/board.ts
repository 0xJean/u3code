import * as Schema from "effect/Schema";
import { IsoTimestamp } from "./auth.ts";

export const TeamBoardMessageKind = Schema.Literals([
  "message",
  "handoff",
  "pulse",
  "review",
  "release",
  "system",
]);
export type TeamBoardMessageKind = typeof TeamBoardMessageKind.Type;

export const TeamBoardAuthorType = Schema.Literals(["human", "agent", "system"]);
export type TeamBoardAuthorType = typeof TeamBoardAuthorType.Type;

export const TeamBoardMessage = Schema.Struct({
  id: Schema.String,
  workspaceId: Schema.String,
  projectId: Schema.NullOr(Schema.String),
  seq: Schema.Int,
  kind: TeamBoardMessageKind,
  authorType: TeamBoardAuthorType,
  authorUserId: Schema.NullOr(Schema.String),
  authorHandle: Schema.String,
  authorDisplayName: Schema.String,
  mentions: Schema.Array(Schema.String),
  body: Schema.String,
  workItemId: Schema.NullOr(Schema.String),
  workItemCode: Schema.NullOr(Schema.String),
  changeRequestId: Schema.NullOr(Schema.String),
  changeRequestRef: Schema.NullOr(Schema.String),
  createdAt: IsoTimestamp,
});
export type TeamBoardMessage = typeof TeamBoardMessage.Type;

export const TeamBoardListResponse = Schema.Struct({
  messages: Schema.Array(TeamBoardMessage),
  head: Schema.Int,
});
export type TeamBoardListResponse = typeof TeamBoardListResponse.Type;

export const TeamBoardCreateInput = Schema.Struct({
  workspaceId: Schema.String,
  projectId: Schema.optional(Schema.NullOr(Schema.String)),
  kind: Schema.optional(TeamBoardMessageKind),
  authorType: Schema.optional(TeamBoardAuthorType),
  authorHandle: Schema.optional(Schema.String),
  authorDisplayName: Schema.optional(Schema.String),
  body: Schema.String,
  mentions: Schema.optional(Schema.Array(Schema.String)),
  workItemId: Schema.optional(Schema.NullOr(Schema.String)),
  workItemCode: Schema.optional(Schema.NullOr(Schema.String)),
  changeRequestId: Schema.optional(Schema.NullOr(Schema.String)),
  changeRequestRef: Schema.optional(Schema.NullOr(Schema.String)),
});
export type TeamBoardCreateInput = typeof TeamBoardCreateInput.Type;

const BOARD_MENTION_PATTERN = /(?:^|[\s(])@([a-zA-Z0-9][a-zA-Z0-9._-]{0,31}(?:\[bot\])?)/g;

export function extractBoardMentions(body: string): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const match of body.matchAll(BOARD_MENTION_PATTERN)) {
    const raw = match[1];
    if (!raw) continue;
    const normalized = raw.toLowerCase().replace(/\.+$/, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    mentions.push(normalized);
  }
  return mentions;
}
