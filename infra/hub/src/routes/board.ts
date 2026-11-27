import { and, asc, desc, eq, gt, isNull, max, or } from "drizzle-orm";
import { Hono } from "hono";
import {
  extractBoardMentions,
  type TeamBoardAuthorType,
  type TeamBoardCreateInput,
  type TeamBoardMessage,
  type TeamBoardMessageKind,
} from "@u3code/hub-contracts";
import {
  createAuthMiddleware,
  getAuthUser,
  getUserWorkspaceRoles,
  type HubAuthVariables,
} from "../auth/middleware.ts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { boardMessages, projects } from "../db/schema.ts";
import { newId } from "../utils/crypto.ts";
import type { HubSocketBroker } from "../ws/hubSocket.ts";

const VALID_BOARD_KINDS = new Set<TeamBoardMessageKind>([
  "message",
  "handoff",
  "pulse",
  "review",
  "release",
  "system",
]);

const VALID_AUTHOR_TYPES = new Set<TeamBoardAuthorType>(["human", "agent", "system"]);

export function deriveUserBoardHandle(user: {
  readonly primaryVcsLogin?: string | null;
  readonly displayName: string;
}): string {
  const login = user.primaryVcsLogin?.trim().replace(/^@+/, "").toLowerCase();
  if (login) return login;
  const slug = user.displayName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "member";
}

function mergeBoardMentions(body: string, explicit?: readonly string[]): string[] {
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const handle of extractBoardMentions(body)) {
    if (!seen.has(handle)) {
      seen.add(handle);
      merged.push(handle);
    }
  }

  for (const raw of explicit ?? []) {
    const normalized = raw.trim().replace(/^@+/, "").toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    merged.push(normalized);
  }

  return merged;
}

export interface AppendBoardMessageInput {
  readonly workspaceId: string;
  readonly projectId?: string | null;
  readonly kind?: TeamBoardMessageKind;
  readonly authorType?: TeamBoardAuthorType;
  readonly authorUserId?: string | null;
  readonly authorHandle: string;
  readonly authorDisplayName: string;
  readonly body: string;
  readonly mentions?: readonly string[];
  readonly workItemId?: string | null;
  readonly workItemCode?: string | null;
  readonly changeRequestId?: string | null;
  readonly changeRequestRef?: string | null;
}

function isUniqueSeqConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? error.code : undefined;
  const cause = "cause" in error ? error.cause : undefined;
  if (code === "23505") return true;
  if (cause && typeof cause === "object" && "code" in cause && cause.code === "23505") {
    return true;
  }
  return false;
}

export async function appendBoardMessage(
  deps: {
    readonly db: HubDatabase;
    readonly broker: HubSocketBroker;
  },
  input: AppendBoardMessageInput,
): Promise<TeamBoardMessage> {
  const trimmedBody = input.body.trim();
  const mentions = mergeBoardMentions(trimmedBody, input.mentions);
  const kind: TeamBoardMessageKind = input.kind ?? (mentions.length > 0 ? "handoff" : "message");
  const authorType: TeamBoardAuthorType = input.authorType ?? "human";
  const authorHandle = input.authorHandle.trim().replace(/^@+/, "").toLowerCase() || "member";
  const authorDisplayName = input.authorDisplayName.trim() || authorHandle;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const maxSeqRows = await deps.db
      .select({ maxSeq: max(boardMessages.seq) })
      .from(boardMessages)
      .where(eq(boardMessages.workspaceId, input.workspaceId));
    const nextSeq = Number(maxSeqRows[0]?.maxSeq ?? 0) + 1;

    try {
      const inserted = await deps.db
        .insert(boardMessages)
        .values({
          id: newId("bmsg"),
          workspaceId: input.workspaceId,
          projectId: input.projectId ?? null,
          seq: nextSeq,
          kind,
          authorType,
          authorUserId: input.authorUserId ?? null,
          authorHandle,
          authorDisplayName,
          mentions,
          body: trimmedBody,
          workItemId: input.workItemId ?? null,
          workItemCode: input.workItemCode ?? null,
          changeRequestId: input.changeRequestId ?? null,
          changeRequestRef: input.changeRequestRef ?? null,
        })
        .returning();

      const row = inserted[0]!;
      const message = row as TeamBoardMessage;

      deps.broker.broadcast({
        type: "board.message_created",
        workspaceId: message.workspaceId,
        projectId: message.projectId,
        messageId: message.id,
        seq: message.seq,
        authorHandle: message.authorHandle,
        mentions: [...message.mentions],
      });

      return message;
    } catch (error) {
      if (attempt < 2 && isUniqueSeqConflict(error)) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to allocate sequence number for board message.");
}

export function createBoardRoutes(deps: {
  readonly db: HubDatabase;
  readonly config: HubConfig;
  readonly broker: HubSocketBroker;
}): Hono<{ Variables: HubAuthVariables }> {
  const app = new Hono<{ Variables: HubAuthVariables }>();
  app.use("*", createAuthMiddleware(deps.db, deps.config));

  app.get("/board", async (c) => {
    const user = getAuthUser(c);
    const workspaceId = c.req.query("workspaceId")?.trim();
    const projectId = c.req.query("projectId")?.trim() || null;
    const sinceRaw = c.req.query("since");
    const limitRaw = c.req.query("limit");

    if (!workspaceId) {
      return c.json({ error: "workspaceId query parameter is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    let since: number | undefined;
    if (sinceRaw !== undefined && sinceRaw !== "") {
      const parsedSince = Number(sinceRaw);
      if (!Number.isInteger(parsedSince) || parsedSince < 0) {
        return c.json({ error: "since must be a non-negative integer." }, 400);
      }
      since = parsedSince;
    }

    let limit = 100;
    if (limitRaw !== undefined && limitRaw !== "") {
      const parsedLimit = Number(limitRaw);
      if (!Number.isInteger(parsedLimit) || parsedLimit <= 0) {
        return c.json({ error: "limit must be a positive integer." }, 400);
      }
      limit = Math.min(200, parsedLimit);
    }

    const headRows = await deps.db
      .select({ maxSeq: max(boardMessages.seq) })
      .from(boardMessages)
      .where(eq(boardMessages.workspaceId, workspaceId));
    const head = Number(headRows[0]?.maxSeq ?? 0);

    const conditions = [eq(boardMessages.workspaceId, workspaceId)];
    if (projectId) {
      conditions.push(or(eq(boardMessages.projectId, projectId), isNull(boardMessages.projectId))!);
    }

    if (since !== undefined) {
      conditions.push(gt(boardMessages.seq, since));
      const rows = await deps.db
        .select()
        .from(boardMessages)
        .where(and(...conditions))
        .orderBy(asc(boardMessages.seq))
        .limit(limit);
      return c.json({ messages: rows, head });
    }

    const rows = await deps.db
      .select()
      .from(boardMessages)
      .where(and(...conditions))
      .orderBy(desc(boardMessages.seq))
      .limit(limit);
    rows.reverse();

    return c.json({ messages: rows, head });
  });

  app.post("/board", async (c) => {
    const user = getAuthUser(c);
    const body = (await c.req.json()) as Partial<TeamBoardCreateInput>;

    const workspaceId = body.workspaceId?.trim();
    const messageBody = body.body?.trim();
    if (!workspaceId) {
      return c.json({ error: "workspaceId is required." }, 400);
    }
    if (!messageBody) {
      return c.json({ error: "body is required." }, 400);
    }

    const roles = await getUserWorkspaceRoles(deps.db, workspaceId, user.id);
    if (roles.length === 0) return c.json({ error: "Forbidden." }, 403);

    if (body.kind !== undefined && !VALID_BOARD_KINDS.has(body.kind)) {
      return c.json({ error: `Invalid board message kind '${String(body.kind)}'.` }, 400);
    }
    if (body.authorType !== undefined && !VALID_AUTHOR_TYPES.has(body.authorType)) {
      return c.json({ error: `Invalid authorType '${String(body.authorType)}'.` }, 400);
    }

    const projectId = body.projectId?.trim() || null;
    if (projectId) {
      const projectRows = await deps.db
        .select({ id: projects.id })
        .from(projects)
        .where(and(eq(projects.id, projectId), eq(projects.workspaceId, workspaceId)))
        .limit(1);
      if (!projectRows[0]) {
        return c.json({ error: "Project not found in workspace." }, 404);
      }
    }

    const authorHandle =
      body.authorHandle?.trim().replace(/^@+/, "").toLowerCase() || deriveUserBoardHandle(user);
    const authorDisplayName = body.authorDisplayName?.trim() || user.displayName;

    const message = await appendBoardMessage(
      { db: deps.db, broker: deps.broker },
      {
        workspaceId,
        projectId,
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        authorType: body.authorType ?? "human",
        authorUserId: user.id,
        authorHandle,
        authorDisplayName,
        body: messageBody,
        ...(body.mentions !== undefined ? { mentions: body.mentions } : {}),
        workItemId: body.workItemId ?? null,
        workItemCode: body.workItemCode ?? null,
        changeRequestId: body.changeRequestId ?? null,
        changeRequestRef: body.changeRequestRef ?? null,
      },
    );

    return c.json({ message }, 201);
  });

  return app;
}
