import * as NodeCrypto from "node:crypto";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AuthProvider } from "../auth/providers.ts";
import { createPkcePair, upsertUserFromExternalProfile } from "../auth/providers.ts";
import { createAuthMiddleware, getAuthUser, type HubAuthVariables } from "../auth/middleware.ts";
import { issueTokenPair, revokeRefreshTokenFamily, rotateRefreshToken } from "../auth/tokens.ts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { users, workspaceMemberships, workspaces } from "../db/schema.ts";

interface PendingOAuthState {
  readonly verifier: string;
  readonly clientRedirectUri: string | null;
  readonly expiresAt: number;
}

export function createAuthRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly githubProvider: AuthProvider;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  const pendingStates = new Map<string, PendingOAuthState>();
  const requireAuth = createAuthMiddleware(deps.db, deps.config);

  const sweepExpiredStates = () => {
    const now = Date.now();
    for (const [key, entry] of pendingStates) {
      if (entry.expiresAt <= now) pendingStates.delete(key);
    }
  };

  app.get("/providers", (c) => {
    return c.json({
      providers: [
        { kind: "github", enabled: deps.githubProvider.isConfigured() },
        { kind: "local", enabled: deps.config.allowLocalDevAuth },
      ],
    });
  });

  app.get("/github/start", (c) => {
    if (!deps.githubProvider.isConfigured()) {
      return c.json({ error: "GitHub OAuth is not configured on this hub." }, 503);
    }
    sweepExpiredStates();
    const state = NodeCrypto.randomBytes(24).toString("base64url");
    const pkce = createPkcePair();
    const rawRedirectUri = c.req.query("redirect_uri") ?? null;
    let clientRedirectUri: string | null = null;
    if (rawRedirectUri) {
      try {
        const parsed = new URL(rawRedirectUri);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
          return c.json({ error: "redirect_uri must use http or https." }, 400);
        }
        clientRedirectUri = parsed.toString();
      } catch {
        return c.json({ error: "Invalid redirect_uri." }, 400);
      }
    }
    pendingStates.set(state, {
      verifier: pkce.verifier,
      clientRedirectUri,
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    const callbackUrl = `${deps.config.publicUrl}/api/v1/auth/github/callback`;
    const authorizeUrl = deps.githubProvider.createAuthorizeUrl({
      state,
      redirectUri: callbackUrl,
      codeChallenge: pkce.challenge,
    });

    if (c.req.query("mode") === "json") {
      return c.json({ authorizeUrl, state });
    }
    return c.redirect(authorizeUrl, 302);
  });

  app.get("/github/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.json({ error: "Missing code or state parameter." }, 400);
    }

    const pending = pendingStates.get(state);
    pendingStates.delete(state);
    if (!pending || pending.expiresAt <= Date.now()) {
      return c.json({ error: "OAuth state expired or invalid." }, 400);
    }

    try {
      const callbackUrl = `${deps.config.publicUrl}/api/v1/auth/github/callback`;
      const profile = await deps.githubProvider.exchangeCode({
        code,
        redirectUri: callbackUrl,
        codeVerifier: pending.verifier,
      });
      const user = await upsertUserFromExternalProfile(deps.db, profile);
      const tokens = await issueTokenPair(deps.db, deps.config, user.id);

      if (pending.clientRedirectUri) {
        const target = new URL(pending.clientRedirectUri);
        target.hash = new URLSearchParams({
          hub_url: deps.config.publicUrl,
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
          expires_in: String(tokens.expiresInSeconds),
        }).toString();
        return c.redirect(target.toString(), 302);
      }

      return c.json({ user, tokens });
    } catch (error) {
      const message = error instanceof Error ? error.message : "OAuth sign-in failed.";
      return c.json({ error: message }, 403);
    }
  });

  app.post("/local/login", async (c) => {
    if (!deps.config.allowLocalDevAuth) {
      return c.json({ error: "Local dev auth is disabled." }, 403);
    }
    const body = (await c.req.json()) as {
      readonly username?: string;
      readonly displayName?: string;
      readonly email?: string;
    };
    const username = body.username?.trim();
    if (!username) {
      return c.json({ error: "username is required." }, 400);
    }

    const user = await upsertUserFromExternalProfile(deps.db, {
      provider: "local",
      externalId: username.toLowerCase(),
      username,
      displayName: body.displayName?.trim() || username,
      email: body.email?.trim() || null,
      avatarUrl: null,
    });

    if (!user.primaryVcsLogin) {
      await deps.db
        .update(users)
        .set({ primaryVcsLogin: username, updatedAt: new Date().toISOString() })
        .where(eq(users.id, user.id));
    }

    const tokens = await issueTokenPair(deps.db, deps.config, user.id);
    return c.json({ user: { ...user, primaryVcsLogin: user.primaryVcsLogin ?? username }, tokens });
  });

  app.post("/refresh", async (c) => {
    const body = (await c.req.json()) as { readonly refreshToken?: string };
    if (!body.refreshToken) {
      return c.json({ error: "refreshToken is required." }, 400);
    }
    const rotated = await rotateRefreshToken(deps.db, deps.config, body.refreshToken);
    if (!rotated) {
      return c.json({ error: "Invalid or revoked refresh token." }, 401);
    }
    return c.json({ tokens: rotated });
  });

  app.post("/logout", async (c) => {
    const body = (await c.req.json()) as { readonly refreshToken?: string };
    if (body.refreshToken) {
      await revokeRefreshTokenFamily(deps.db, body.refreshToken);
    }
    return c.json({ ok: true });
  });

  app.get("/me", requireAuth, async (c) => {
    const user = getAuthUser(c);
    const memberships = await deps.db
      .select({
        id: workspaces.id,
        slug: workspaces.slug,
        name: workspaces.name,
        roles: workspaceMemberships.roles,
      })
      .from(workspaceMemberships)
      .innerJoin(workspaces, eq(workspaceMemberships.workspaceId, workspaces.id))
      .where(eq(workspaceMemberships.userId, user.id));

    return c.json({ user, workspaces: memberships });
  });

  app.patch("/me", requireAuth, async (c) => {
    const user = getAuthUser(c);
    const body = (await c.req.json()) as {
      readonly displayName?: string;
      readonly primaryVcsLogin?: string | null;
      readonly notificationHandles?: Record<string, string>;
    };

    const updated = await deps.db
      .update(users)
      .set({
        ...(body.displayName !== undefined ? { displayName: body.displayName.trim() } : {}),
        ...(body.primaryVcsLogin !== undefined ? { primaryVcsLogin: body.primaryVcsLogin } : {}),
        ...(body.notificationHandles !== undefined
          ? { notificationHandles: { ...user.notificationHandles, ...body.notificationHandles } }
          : {}),
        updatedAt: new Date().toISOString(),
      })
      .where(eq(users.id, user.id))
      .returning();

    return c.json({ user: updated[0] });
  });

  return app;
}
