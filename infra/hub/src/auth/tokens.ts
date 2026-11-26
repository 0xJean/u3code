import * as NodeCrypto from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { HubTokenPair } from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { refreshTokens, users } from "../db/schema.ts";
import { newId, sha256Hex } from "../utils/crypto.ts";

export interface VerifiedAccessToken {
  readonly userId: string;
}

function secretKey(config: HubConfig): Uint8Array {
  return new TextEncoder().encode(config.jwtSecret);
}

export async function signAccessToken(config: HubConfig, userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer("u3code-hub")
    .setIssuedAt()
    .setExpirationTime(`${config.accessTokenTtlSeconds}s`)
    .sign(secretKey(config));
}

export async function verifyAccessToken(
  config: HubConfig,
  token: string,
): Promise<VerifiedAccessToken | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey(config), { issuer: "u3code-hub" });
    if (typeof payload.sub !== "string" || payload.sub.length === 0) {
      return null;
    }
    return { userId: payload.sub };
  } catch {
    return null;
  }
}

export async function issueTokenPair(
  db: HubDatabase,
  config: HubConfig,
  userId: string,
  familyId: string = newId("fam"),
): Promise<HubTokenPair> {
  const accessToken = await signAccessToken(config, userId);
  const rawRefresh = `rt_${NodeCrypto.randomBytes(32).toString("base64url")}`;
  const expiresAt = new Date(Date.now() + config.refreshTokenTtlSeconds * 1000).toISOString();

  await db.insert(refreshTokens).values({
    id: newId("rtk"),
    userId,
    familyId,
    tokenHash: sha256Hex(rawRefresh),
    expiresAt,
  });

  return {
    accessToken,
    refreshToken: rawRefresh,
    expiresInSeconds: config.accessTokenTtlSeconds,
  };
}

/**
 * Rotates a refresh token. Reusing a previously revoked token invalidates the entire family
 * so stolen tokens cannot keep minting sessions.
 */
export async function rotateRefreshToken(
  db: HubDatabase,
  config: HubConfig,
  rawRefreshToken: string,
): Promise<HubTokenPair | null> {
  const tokenHash = sha256Hex(rawRefreshToken);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  const record = rows[0];
  if (!record) return null;

  const nowIso = new Date().toISOString();
  if (record.revokedAt !== null) {
    await db
      .update(refreshTokens)
      .set({ revokedAt: nowIso })
      .where(and(eq(refreshTokens.familyId, record.familyId), isNull(refreshTokens.revokedAt)));
    return null;
  }

  if (Date.parse(record.expiresAt) <= Date.now()) {
    return null;
  }

  const userRows = await db.select().from(users).where(eq(users.id, record.userId)).limit(1);
  const user = userRows[0];
  if (!user || !user.isActive) {
    return null;
  }

  await db.update(refreshTokens).set({ revokedAt: nowIso }).where(eq(refreshTokens.id, record.id));

  return issueTokenPair(db, config, record.userId, record.familyId);
}

export async function revokeRefreshTokenFamily(
  db: HubDatabase,
  rawRefreshToken: string,
): Promise<void> {
  const tokenHash = sha256Hex(rawRefreshToken);
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  const record = rows[0];
  if (!record) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date().toISOString() })
    .where(and(eq(refreshTokens.familyId, record.familyId), isNull(refreshTokens.revokedAt)));
}
