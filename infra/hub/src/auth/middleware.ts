import { and, eq } from "drizzle-orm";
import type { Context, MiddlewareHandler } from "hono";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { users, workspaceMemberships } from "../db/schema.ts";
import { verifyAccessToken } from "./tokens.ts";

export interface HubAuthVariables {
  user: typeof users.$inferSelect;
}

export function createAuthMiddleware(
  db: HubDatabase,
  config: HubConfig,
): MiddlewareHandler<{ Variables: HubAuthVariables }> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const match = /^Bearer\s+(.+)$/i.exec(header.trim());
    if (!match?.[1]) {
      return c.json({ error: "Missing Bearer token." }, 401);
    }
    const verified = await verifyAccessToken(config, match[1]);
    if (!verified) {
      return c.json({ error: "Invalid or expired access token." }, 401);
    }
    const rows = await db.select().from(users).where(eq(users.id, verified.userId)).limit(1);
    const user = rows[0];
    if (!user || !user.isActive) {
      return c.json({ error: "User account inactive or not found." }, 401);
    }
    c.set("user", user);
    await next();
  };
}

export async function getUserWorkspaceRoles(
  db: HubDatabase,
  workspaceId: string,
  userId: string,
): Promise<readonly string[]> {
  const rows = await db
    .select()
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, workspaceId),
        eq(workspaceMemberships.userId, userId),
      ),
    )
    .limit(1);
  return rows[0]?.roles ?? [];
}

export function hasAnyRole(
  userRoles: readonly string[],
  requiredRoles: readonly string[],
): boolean {
  if (requiredRoles.length === 0) return userRoles.length > 0;
  if (userRoles.includes("owner")) return true;
  return requiredRoles.some((role) => userRoles.includes(role));
}

export function getAuthUser(
  c: Context<{ Variables: HubAuthVariables }>,
): typeof users.$inferSelect {
  return c.get("user");
}
