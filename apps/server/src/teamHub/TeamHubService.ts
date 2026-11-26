import {
  CockpitOverview,
  PulseDraft,
  TeamHubAddProjectRepoResult,
  TeamHubApproveGateResult,
  TeamHubCreateNotificationChannelResult,
  TeamHubCreateProjectResult,
  TeamHubCreateWorkspaceResult,
  TeamHubDigestsResult,
  TeamHubError,
  TeamHubGenerateDigestResult,
  TeamHubListNotificationChannelsResult,
  TeamHubMemoryResult,
  TeamHubPublishPulseResult,
  TeamHubReviewQueueResult,
  TeamHubStatusResult,
  TeamHubWorkItemResult,
  type TeamHubAddProjectRepoInput,
  type TeamHubApproveGateInput,
  type TeamHubConnectLocalInput,
  type TeamHubConnectTokensInput,
  type TeamHubCreateNotificationChannelInput,
  type TeamHubCreateProjectInput,
  type TeamHubCreateWorkItemInput,
  type TeamHubCreateWorkspaceInput,
  type TeamHubDigestsInput,
  type TeamHubExtractPulseDraftInput,
  type TeamHubGenerateDigestInput,
  type TeamHubListNotificationChannelsInput,
  type TeamHubMemoryInput,
  type TeamHubOverviewInput,
  type TeamHubPublishPulseInput,
  type TeamHubReviewQueueInput,
  type TeamHubUpdateDirectivesInput,
  type TeamHubUpdateWorkItemInput,
} from "@t3tools/contracts";
import { HubAuthMe, HubTokenPair } from "@u3code/hub-contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

import * as ServerConfig from "../config.ts";
import { buildPulseDraftFromThread } from "./PulseExtractor.ts";

const StoredTeamHubCredentials = Schema.Struct({
  hubUrl: Schema.String,
  accessToken: Schema.String,
  refreshToken: Schema.String,
});
type StoredTeamHubCredentials = typeof StoredTeamHubCredentials.Type;

const StoredCredentialsJson = Schema.fromJsonString(StoredTeamHubCredentials);
const UnknownJson = Schema.fromJsonString(Schema.Unknown);

const LocalLoginResponse = Schema.Struct({
  tokens: HubTokenPair,
});

const RefreshResponse = Schema.Struct({
  tokens: HubTokenPair,
});

const ErrorPayload = Schema.Struct({
  error: Schema.optional(Schema.String),
});
const ErrorPayloadJson = Schema.fromJsonString(ErrorPayload);

const decodeStoredCredentials = Schema.decodeEffect(StoredCredentialsJson);
const encodeStoredCredentials = Schema.encodeUnknownEffect(StoredCredentialsJson);
const decodeErrorPayload = Schema.decodeEffect(ErrorPayloadJson);
const decodeUnknownJson = Schema.decodeEffect(UnknownJson);

const decodeLocalLoginResponse = Schema.decodeUnknownEffect(LocalLoginResponse);
const decodeRefreshResponse = Schema.decodeUnknownEffect(RefreshResponse);
const decodeHubAuthMe = Schema.decodeUnknownEffect(HubAuthMe);
const decodeUnknown = Schema.decodeUnknownEffect(Schema.Unknown);
const decodeCockpitOverview = Schema.decodeUnknownEffect(CockpitOverview);
const decodeReviewQueue = Schema.decodeUnknownEffect(TeamHubReviewQueueResult);
const decodeDigests = Schema.decodeUnknownEffect(TeamHubDigestsResult);
const decodeGenerateDigest = Schema.decodeUnknownEffect(TeamHubGenerateDigestResult);
const decodeMemory = Schema.decodeUnknownEffect(TeamHubMemoryResult);
const decodeWorkItem = Schema.decodeUnknownEffect(TeamHubWorkItemResult);
const decodeApproveGate = Schema.decodeUnknownEffect(TeamHubApproveGateResult);
const decodePublishPulse = Schema.decodeUnknownEffect(TeamHubPublishPulseResult);
const decodeCreateWorkspace = Schema.decodeUnknownEffect(TeamHubCreateWorkspaceResult);
const decodeCreateProject = Schema.decodeUnknownEffect(TeamHubCreateProjectResult);
const decodeAddProjectRepo = Schema.decodeUnknownEffect(TeamHubAddProjectRepoResult);
const decodeListChannels = Schema.decodeUnknownEffect(TeamHubListNotificationChannelsResult);
const decodeCreateChannel = Schema.decodeUnknownEffect(TeamHubCreateNotificationChannelResult);

function normalizeHubUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}

function toTeamHubError(message: string, statusCode?: number): TeamHubError {
  return statusCode !== undefined
    ? new TeamHubError({ message, statusCode })
    : new TeamHubError({ message });
}

export class TeamHubService extends Context.Service<
  TeamHubService,
  {
    readonly status: () => Effect.Effect<TeamHubStatusResult, TeamHubError>;
    readonly connectLocal: (
      input: TeamHubConnectLocalInput,
    ) => Effect.Effect<TeamHubStatusResult, TeamHubError>;
    readonly connectTokens: (
      input: TeamHubConnectTokensInput,
    ) => Effect.Effect<TeamHubStatusResult, TeamHubError>;
    readonly disconnect: () => Effect.Effect<void, TeamHubError>;
    readonly getOverview: (
      input: TeamHubOverviewInput,
    ) => Effect.Effect<CockpitOverview, TeamHubError>;
    readonly getReviewQueue: (
      input: TeamHubReviewQueueInput,
    ) => Effect.Effect<TeamHubReviewQueueResult, TeamHubError>;
    readonly getDigests: (
      input: TeamHubDigestsInput,
    ) => Effect.Effect<TeamHubDigestsResult, TeamHubError>;
    readonly generateDigest: (
      input: TeamHubGenerateDigestInput,
    ) => Effect.Effect<TeamHubGenerateDigestResult, TeamHubError>;
    readonly getMemory: (
      input: TeamHubMemoryInput,
    ) => Effect.Effect<TeamHubMemoryResult, TeamHubError>;
    readonly updateDirectives: (
      input: TeamHubUpdateDirectivesInput,
    ) => Effect.Effect<TeamHubMemoryResult, TeamHubError>;
    readonly createWorkItem: (
      input: TeamHubCreateWorkItemInput,
    ) => Effect.Effect<TeamHubWorkItemResult, TeamHubError>;
    readonly updateWorkItem: (
      input: TeamHubUpdateWorkItemInput,
    ) => Effect.Effect<TeamHubWorkItemResult, TeamHubError>;
    readonly approveGate: (
      input: TeamHubApproveGateInput,
    ) => Effect.Effect<TeamHubApproveGateResult, TeamHubError>;
    readonly publishPulse: (
      input: TeamHubPublishPulseInput,
    ) => Effect.Effect<TeamHubPublishPulseResult, TeamHubError>;
    readonly extractPulseDraft: (
      input: TeamHubExtractPulseDraftInput,
    ) => Effect.Effect<PulseDraft, TeamHubError>;
    readonly createWorkspace: (
      input: TeamHubCreateWorkspaceInput,
    ) => Effect.Effect<TeamHubCreateWorkspaceResult, TeamHubError>;
    readonly createProject: (
      input: TeamHubCreateProjectInput,
    ) => Effect.Effect<TeamHubCreateProjectResult, TeamHubError>;
    readonly addProjectRepo: (
      input: TeamHubAddProjectRepoInput,
    ) => Effect.Effect<TeamHubAddProjectRepoResult, TeamHubError>;
    readonly listNotificationChannels: (
      input: TeamHubListNotificationChannelsInput,
    ) => Effect.Effect<TeamHubListNotificationChannelsResult, TeamHubError>;
    readonly createNotificationChannel: (
      input: TeamHubCreateNotificationChannelInput,
    ) => Effect.Effect<TeamHubCreateNotificationChannelResult, TeamHubError>;
  }
>()("t3/teamHub/TeamHubService") {}

const make = Effect.gen(function* () {
  const config = yield* ServerConfig.ServerConfig;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const http = yield* HttpClient.HttpClient;

  const credentialsPath = path.join(config.stateDir, "team-hub.json");

  const readCredentials = (): Effect.Effect<StoredTeamHubCredentials | null, TeamHubError> =>
    fs.exists(credentialsPath).pipe(
      Effect.flatMap((exists) =>
        exists
          ? fs.readFileString(credentialsPath).pipe(
              Effect.flatMap((raw) => decodeStoredCredentials(raw)),
              Effect.orElseSucceed(() => null),
            )
          : Effect.succeed(null),
      ),
      Effect.mapError((cause) =>
        toTeamHubError(`Failed to read Team Hub credentials: ${String(cause)}`),
      ),
    );

  const writeCredentials = (creds: StoredTeamHubCredentials): Effect.Effect<void, TeamHubError> =>
    encodeStoredCredentials(creds).pipe(
      Effect.flatMap((encoded) =>
        fs
          .makeDirectory(config.stateDir, { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(credentialsPath, encoded, { mode: 0o600 }))),
      ),
      Effect.mapError((cause) =>
        toTeamHubError(`Failed to save Team Hub credentials: ${String(cause)}`),
      ),
    );

  const clearCredentials = (): Effect.Effect<void, TeamHubError> =>
    fs
      .remove(credentialsPath, { force: true })
      .pipe(
        Effect.mapError((cause) =>
          toTeamHubError(`Failed to remove Team Hub credentials: ${String(cause)}`),
        ),
      );

  const executeJsonRequest = Effect.fnUntraced(function* <A>(input: {
    readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly url: string;
    readonly bearerToken?: string;
    readonly body?: unknown;
    readonly decode: (u: unknown) => Effect.Effect<A, Schema.SchemaError>;
  }) {
    let req =
      input.method === "GET"
        ? HttpClientRequest.get(input.url)
        : input.method === "POST"
          ? HttpClientRequest.post(input.url)
          : input.method === "PUT"
            ? HttpClientRequest.put(input.url)
            : input.method === "PATCH"
              ? HttpClientRequest.patch(input.url)
              : HttpClientRequest.delete(input.url);

    if (input.bearerToken) {
      req = HttpClientRequest.setHeader(req, "authorization", `Bearer ${input.bearerToken}`);
    }
    if (input.body !== undefined) {
      req = HttpClientRequest.bodyJsonUnsafe(req, input.body);
    }

    const res = yield* http
      .execute(req)
      .pipe(Effect.mapError((cause) => toTeamHubError(`Hub request failed: ${cause.message}`)));
    const rawText = yield* res.text.pipe(
      Effect.mapError((cause) => toTeamHubError(`Failed to read Hub response: ${cause.message}`)),
    );

    if (res.status < 200 || res.status >= 300) {
      const parsedErr = yield* decodeErrorPayload(rawText).pipe(
        Effect.orElseSucceed(() => ({ error: undefined })),
      );
      return yield* toTeamHubError(
        parsedErr.error ?? `Hub returned HTTP ${res.status}`,
        res.status,
      );
    }

    const jsonVal = yield* decodeUnknownJson(rawText).pipe(
      Effect.mapError(() => toTeamHubError("Hub returned invalid JSON.", res.status)),
    );
    return yield* input
      .decode(jsonVal)
      .pipe(
        Effect.mapError((err) => toTeamHubError(`Hub response schema mismatch: ${String(err)}`)),
      );
  });

  const authedRequest = Effect.fnUntraced(function* <A>(input: {
    readonly method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
    readonly pathAndQuery: string;
    readonly body?: unknown;
    readonly decode: (u: unknown) => Effect.Effect<A, Schema.SchemaError>;
  }) {
    const creds = yield* readCredentials();
    if (!creds) {
      return yield* toTeamHubError("Not connected to a Team Hub.", 401);
    }

    const url = `${creds.hubUrl}${input.pathAndQuery}`;
    const attempt = executeJsonRequest({
      method: input.method,
      url,
      bearerToken: creds.accessToken,
      ...(input.body !== undefined ? { body: input.body } : {}),
      decode: input.decode,
    });

    return yield* attempt.pipe(
      Effect.catchIf(
        (err) => err.statusCode === 401,
        () =>
          // Access token expired: rotate refresh token once and retry.
          executeJsonRequest({
            method: "POST",
            url: `${creds.hubUrl}/api/v1/auth/refresh`,
            body: { refreshToken: creds.refreshToken },
            decode: decodeRefreshResponse,
          }).pipe(
            Effect.flatMap((refreshed) => {
              const nextCreds: StoredTeamHubCredentials = {
                hubUrl: creds.hubUrl,
                accessToken: refreshed.tokens.accessToken,
                refreshToken: refreshed.tokens.refreshToken,
              };
              return writeCredentials(nextCreds).pipe(
                Effect.andThen(
                  executeJsonRequest({
                    method: input.method,
                    url,
                    bearerToken: nextCreds.accessToken,
                    ...(input.body !== undefined ? { body: input.body } : {}),
                    decode: input.decode,
                  }),
                ),
              );
            }),
          ),
      ),
    );
  });

  const status = Effect.fn("TeamHubService.status")(function* () {
    const creds = yield* readCredentials();
    if (!creds) {
      return { connected: false, hubUrl: null, me: null } satisfies TeamHubStatusResult;
    }
    const me = yield* authedRequest({
      method: "GET",
      pathAndQuery: "/api/v1/auth/me",
      decode: decodeHubAuthMe,
    }).pipe(Effect.orElseSucceed(() => null));

    if (!me) {
      return { connected: false, hubUrl: creds.hubUrl, me: null } satisfies TeamHubStatusResult;
    }
    return { connected: true, hubUrl: creds.hubUrl, me } satisfies TeamHubStatusResult;
  });

  const connectLocal = Effect.fn("TeamHubService.connectLocal")(function* (
    input: TeamHubConnectLocalInput,
  ) {
    const hubUrl = normalizeHubUrl(input.hubUrl);
    const res = yield* executeJsonRequest({
      method: "POST",
      url: `${hubUrl}/api/v1/auth/local/login`,
      body: {
        username: input.username,
        ...(input.displayName ? { displayName: input.displayName } : {}),
      },
      decode: decodeLocalLoginResponse,
    });

    yield* writeCredentials({
      hubUrl,
      accessToken: res.tokens.accessToken,
      refreshToken: res.tokens.refreshToken,
    });
    return yield* status();
  });

  const connectTokens = Effect.fn("TeamHubService.connectTokens")(function* (
    input: TeamHubConnectTokensInput,
  ) {
    const hubUrl = normalizeHubUrl(input.hubUrl);
    yield* writeCredentials({
      hubUrl,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
    return yield* status();
  });

  const disconnect = Effect.fn("TeamHubService.disconnect")(function* () {
    const creds = yield* readCredentials();
    if (creds) {
      yield* executeJsonRequest({
        method: "POST",
        url: `${creds.hubUrl}/api/v1/auth/logout`,
        body: { refreshToken: creds.refreshToken },
        decode: decodeUnknown,
      }).pipe(Effect.ignore);
    }
    yield* clearCredentials();
  });

  const getOverview = Effect.fn("TeamHubService.getOverview")(function* (
    input: TeamHubOverviewInput,
  ) {
    const params = new URLSearchParams({ workspaceId: input.workspaceId });
    if (input.projectId) params.set("projectId", input.projectId);
    return yield* authedRequest({
      method: "GET",
      pathAndQuery: `/api/v1/cockpit/overview?${params.toString()}`,
      decode: decodeCockpitOverview,
    });
  });

  const getReviewQueue = Effect.fn("TeamHubService.getReviewQueue")(function* (
    input: TeamHubReviewQueueInput,
  ) {
    const params = new URLSearchParams({ workspaceId: input.workspaceId });
    if (input.bucket) params.set("bucket", input.bucket);
    if (input.repo) params.set("repo", input.repo);
    return yield* authedRequest({
      method: "GET",
      pathAndQuery: `/api/v1/cockpit/review-queue?${params.toString()}`,
      decode: decodeReviewQueue,
    });
  });

  const getDigests = Effect.fn("TeamHubService.getDigests")(function* (input: TeamHubDigestsInput) {
    const params = new URLSearchParams({ workspaceId: input.workspaceId });
    return yield* authedRequest({
      method: "GET",
      pathAndQuery: `/api/v1/cockpit/digests?${params.toString()}`,
      decode: decodeDigests,
    });
  });

  const generateDigest = Effect.fn("TeamHubService.generateDigest")(function* (
    input: TeamHubGenerateDigestInput,
  ) {
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: "/api/v1/cockpit/digests/generate",
      body: input,
      decode: decodeGenerateDigest,
    });
  });

  const getMemory = Effect.fn("TeamHubService.getMemory")(function* (input: TeamHubMemoryInput) {
    return yield* authedRequest({
      method: "GET",
      pathAndQuery: `/api/v1/projects/${encodeURIComponent(input.projectId)}/memory`,
      decode: decodeMemory,
    });
  });

  const updateDirectives = Effect.fn("TeamHubService.updateDirectives")(function* (
    input: TeamHubUpdateDirectivesInput,
  ) {
    return yield* authedRequest({
      method: "PUT",
      pathAndQuery: `/api/v1/projects/${encodeURIComponent(input.projectId)}/memory/directives`,
      body: { directives: input.directives },
      decode: decodeMemory,
    });
  });

  const createWorkItem = Effect.fn("TeamHubService.createWorkItem")(function* (
    input: TeamHubCreateWorkItemInput,
  ) {
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: `/api/v1/projects/${encodeURIComponent(input.projectId)}/work-items`,
      body: input,
      decode: decodeWorkItem,
    });
  });

  const updateWorkItem = Effect.fn("TeamHubService.updateWorkItem")(function* (
    input: TeamHubUpdateWorkItemInput,
  ) {
    const { workItemId, ...patch } = input;
    return yield* authedRequest({
      method: "PATCH",
      pathAndQuery: `/api/v1/work-items/${encodeURIComponent(workItemId)}`,
      body: patch,
      decode: decodeWorkItem,
    });
  });

  const approveGate = Effect.fn("TeamHubService.approveGate")(function* (
    input: TeamHubApproveGateInput,
  ) {
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: "/api/v1/gates/approve",
      body: input,
      decode: decodeApproveGate,
    });
  });

  const publishPulse = Effect.fn("TeamHubService.publishPulse")(function* (
    input: TeamHubPublishPulseInput,
  ) {
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: `/api/v1/work-items/${encodeURIComponent(input.workItemId)}/pulses`,
      body: input.pulse,
      decode: decodePublishPulse,
    });
  });

  const extractPulseDraft = Effect.fn("TeamHubService.extractPulseDraft")(function* (
    input: TeamHubExtractPulseDraftInput,
  ) {
    return yield* Effect.sync(() => buildPulseDraftFromThread(input));
  });

  const createWorkspace = Effect.fn("TeamHubService.createWorkspace")(function* (
    input: TeamHubCreateWorkspaceInput,
  ) {
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: "/api/v1/workspaces",
      body: input,
      decode: decodeCreateWorkspace,
    });
  });

  const createProject = Effect.fn("TeamHubService.createProject")(function* (
    input: TeamHubCreateProjectInput,
  ) {
    const { workspaceId, ...body } = input;
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: `/api/v1/workspaces/${encodeURIComponent(workspaceId)}/projects`,
      body,
      decode: decodeCreateProject,
    });
  });

  const addProjectRepo = Effect.fn("TeamHubService.addProjectRepo")(function* (
    input: TeamHubAddProjectRepoInput,
  ) {
    const { projectId, ...body } = input;
    return yield* authedRequest({
      method: "POST",
      pathAndQuery: `/api/v1/projects/${encodeURIComponent(projectId)}/repos`,
      body,
      decode: decodeAddProjectRepo,
    });
  });

  const listNotificationChannels = Effect.fn("TeamHubService.listNotificationChannels")(function* (
    input: TeamHubListNotificationChannelsInput,
  ) {
    return yield* authedRequest({
      method: "GET",
      pathAndQuery: `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/notification-channels`,
      decode: decodeListChannels,
    });
  });

  const createNotificationChannel = Effect.fn("TeamHubService.createNotificationChannel")(
    function* (input: TeamHubCreateNotificationChannelInput) {
      return yield* authedRequest({
        method: "POST",
        pathAndQuery: `/api/v1/workspaces/${encodeURIComponent(input.workspaceId)}/notification-channels`,
        body: {
          ...(input.projectId !== undefined ? { projectId: input.projectId } : {}),
          driver: input.driver,
          name: input.name,
          ...(input.events !== undefined ? { events: input.events } : {}),
          config: {
            webhookUrl: input.webhookUrl,
            ...(input.secret !== undefined && input.secret.length > 0
              ? { secret: input.secret }
              : {}),
          },
        },
        decode: decodeCreateChannel,
      });
    },
  );

  return TeamHubService.of({
    status,
    connectLocal,
    connectTokens,
    disconnect,
    getOverview,
    getReviewQueue,
    getDigests,
    generateDigest,
    getMemory,
    updateDirectives,
    createWorkItem,
    updateWorkItem,
    approveGate,
    publishPulse,
    extractPulseDraft,
    createWorkspace,
    createProject,
    addProjectRepo,
    listNotificationChannels,
    createNotificationChannel,
  });
});

export const layerLive = Layer.effect(TeamHubService, make);
export const layer = layerLive.pipe(Layer.provide(FetchHttpClient.layer));
