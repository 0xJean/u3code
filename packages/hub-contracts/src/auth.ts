import * as Schema from "effect/Schema";

export const IsoTimestamp = Schema.String;
export type IsoTimestamp = typeof IsoTimestamp.Type;

export const AuthProviderKind = Schema.Literals(["github", "oidc", "gitlab", "local"]);
export type AuthProviderKind = typeof AuthProviderKind.Type;

export const NotificationHandles = Schema.Record(Schema.String, Schema.String);
export type NotificationHandles = typeof NotificationHandles.Type;

export const HubUser = Schema.Struct({
  id: Schema.String,
  displayName: Schema.String,
  email: Schema.NullOr(Schema.String),
  avatarUrl: Schema.NullOr(Schema.String),
  primaryVcsLogin: Schema.NullOr(Schema.String),
  notificationHandles: NotificationHandles,
  isActive: Schema.Boolean,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
});
export type HubUser = typeof HubUser.Type;

export const WorkspaceSummary = Schema.Struct({
  id: Schema.String,
  slug: Schema.String,
  name: Schema.String,
  roles: Schema.Array(Schema.String),
});
export type WorkspaceSummary = typeof WorkspaceSummary.Type;

export const HubAuthMe = Schema.Struct({
  user: HubUser,
  workspaces: Schema.Array(WorkspaceSummary),
});
export type HubAuthMe = typeof HubAuthMe.Type;

export const HubTokenPair = Schema.Struct({
  accessToken: Schema.String,
  refreshToken: Schema.String,
  expiresInSeconds: Schema.Int,
});
export type HubTokenPair = typeof HubTokenPair.Type;
