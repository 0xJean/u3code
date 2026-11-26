import * as NodeCrypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { AuthProviderKind } from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { userIdentities, users } from "../db/schema.ts";
import { newId } from "../utils/crypto.ts";

export interface AuthenticatedExternalProfile {
  readonly provider: AuthProviderKind;
  readonly externalId: string;
  readonly username: string;
  readonly displayName: string;
  readonly email: string | null;
  readonly avatarUrl: string | null;
}

export interface AuthProvider {
  readonly kind: AuthProviderKind;
  readonly isConfigured: () => boolean;
  readonly createAuthorizeUrl: (input: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge?: string;
  }) => string;
  readonly exchangeCode: (input: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier?: string;
  }) => Promise<AuthenticatedExternalProfile>;
}

interface GitHubTokenResponse {
  readonly access_token?: string;
  readonly error?: string;
  readonly error_description?: string;
}

interface GitHubUserResponse {
  readonly id: number;
  readonly login: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly avatar_url: string | null;
}

interface GitHubOrgResponse {
  readonly login: string;
}

export class GitHubAuthProvider implements AuthProvider {
  readonly kind: AuthProviderKind = "github";
  readonly #config: HubConfig;
  readonly #fetchImpl: typeof fetch;

  constructor(config: HubConfig, fetchImpl: typeof fetch = fetch) {
    this.#config = config;
    this.#fetchImpl = fetchImpl;
  }

  isConfigured(): boolean {
    return this.#config.githubClientId !== null && this.#config.githubClientSecret !== null;
  }

  createAuthorizeUrl(input: {
    readonly state: string;
    readonly redirectUri: string;
    readonly codeChallenge?: string;
  }): string {
    if (!this.#config.githubClientId) {
      throw new Error("GitHub OAuth is not configured (missing GITHUB_CLIENT_ID).");
    }
    const url = new URL("https://github.com/login/oauth/authorize");
    url.searchParams.set("client_id", this.#config.githubClientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("scope", "read:user user:email read:org");
    url.searchParams.set("state", input.state);
    if (input.codeChallenge) {
      url.searchParams.set("code_challenge", input.codeChallenge);
      url.searchParams.set("code_challenge_method", "S256");
    }
    return url.toString();
  }

  async exchangeCode(input: {
    readonly code: string;
    readonly redirectUri: string;
    readonly codeVerifier?: string;
  }): Promise<AuthenticatedExternalProfile> {
    if (!this.#config.githubClientId || !this.#config.githubClientSecret) {
      throw new Error("GitHub OAuth is not configured.");
    }

    const tokenRes = await this.#fetchImpl("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: this.#config.githubClientId,
        client_secret: this.#config.githubClientSecret,
        code: input.code,
        redirect_uri: input.redirectUri,
        ...(input.codeVerifier ? { code_verifier: input.codeVerifier } : {}),
      }),
    });

    const tokenJson = (await tokenRes.json()) as GitHubTokenResponse;
    if (!tokenRes.ok || !tokenJson.access_token) {
      throw new Error(
        tokenJson.error_description ?? tokenJson.error ?? "GitHub token exchange failed.",
      );
    }

    const headers = {
      Authorization: `Bearer ${tokenJson.access_token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "u3code-hub",
    };

    const userRes = await this.#fetchImpl("https://api.github.com/user", { headers });
    if (!userRes.ok) {
      throw new Error(`Failed to fetch GitHub user profile (${userRes.status}).`);
    }
    const ghUser = (await userRes.json()) as GitHubUserResponse;

    if (this.#config.allowedGithubOrgs.length > 0) {
      const orgsRes = await this.#fetchImpl("https://api.github.com/user/orgs?per_page=100", {
        headers,
      });
      if (!orgsRes.ok) {
        throw new Error("Failed to verify GitHub organization membership.");
      }
      const orgs = (await orgsRes.json()) as GitHubOrgResponse[];
      const memberOrgs = new Set(orgs.map((o) => o.login.toLowerCase()));
      const allowed = this.#config.allowedGithubOrgs.some((org) => memberOrgs.has(org));
      if (!allowed) {
        throw new Error("Account does not belong to an allowed GitHub organization.");
      }
    }

    return {
      provider: "github",
      externalId: String(ghUser.id),
      username: ghUser.login,
      displayName: ghUser.name?.trim() || ghUser.login,
      email: ghUser.email,
      avatarUrl: ghUser.avatar_url,
    };
  }
}

export function createPkcePair(): { readonly verifier: string; readonly challenge: string } {
  const verifier = NodeCrypto.randomBytes(32).toString("base64url");
  const challenge = NodeCrypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function upsertUserFromExternalProfile(
  db: HubDatabase,
  profile: AuthenticatedExternalProfile,
): Promise<typeof users.$inferSelect> {
  const existingIdentity = await db
    .select()
    .from(userIdentities)
    .where(
      and(
        eq(userIdentities.provider, profile.provider),
        eq(userIdentities.externalId, profile.externalId),
      ),
    )
    .limit(1);

  const nowIso = new Date().toISOString();

  if (existingIdentity[0]) {
    const userId = existingIdentity[0].userId;
    const updated = await db
      .update(users)
      .set({
        displayName: profile.displayName,
        email: profile.email,
        avatarUrl: profile.avatarUrl,
        ...(profile.provider === "github" || profile.provider === "gitlab"
          ? { primaryVcsLogin: profile.username }
          : {}),
        updatedAt: nowIso,
      })
      .where(eq(users.id, userId))
      .returning();
    if (!updated[0]) {
      throw new Error("Linked user record missing.");
    }
    return updated[0];
  }

  const userId = newId("usr");
  const insertedUsers = await db
    .insert(users)
    .values({
      id: userId,
      displayName: profile.displayName,
      email: profile.email,
      avatarUrl: profile.avatarUrl,
      primaryVcsLogin:
        profile.provider === "github" || profile.provider === "gitlab" ? profile.username : null,
      createdAt: nowIso,
      updatedAt: nowIso,
    })
    .returning();

  await db.insert(userIdentities).values({
    id: newId("uid"),
    userId,
    provider: profile.provider,
    externalId: profile.externalId,
    externalUsername: profile.username,
    createdAt: nowIso,
  });

  if (!insertedUsers[0]) {
    throw new Error("Failed to insert user.");
  }
  return insertedUsers[0];
}
