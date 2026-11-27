import type * as NodeHttp from "node:http";
import type * as NodeStream from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import type { HubWsEvent } from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { getUserWorkspaceRoles } from "../auth/middleware.ts";
import { verifyAccessToken } from "../auth/tokens.ts";

interface ConnectedClient {
  readonly socket: WebSocket;
  readonly userId: string;
  readonly workspaceId: string;
}

export type HubEventListener = (event: HubWsEvent) => void | Promise<void>;

export class HubSocketBroker {
  readonly #wss = new WebSocketServer({ noServer: true });
  readonly #clients = new Set<ConnectedClient>();
  readonly #listeners = new Set<HubEventListener>();

  subscribe(listener: HubEventListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  broadcast(event: HubWsEvent): void {
    const payload = JSON.stringify(event);
    for (const client of this.#clients) {
      if (client.workspaceId !== event.workspaceId) continue;
      if (client.socket.readyState === WebSocket.OPEN) {
        client.socket.send(payload);
      }
    }
    for (const listener of this.#listeners) {
      try {
        const result = listener(event);
        if (result instanceof Promise) {
          void result.catch(() => {
            // Isolate plugin hook failures so broker broadcast never crashes.
          });
        }
      } catch {
        // Isolate synchronous plugin hook failures.
      }
    }
  }

  async handleUpgrade(
    db: HubDatabase,
    config: HubConfig,
    req: NodeHttp.IncomingMessage,
    socket: NodeStream.Duplex,
    head: Buffer,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname !== "/ws/cockpit" && url.pathname !== "/ws") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    const token =
      url.searchParams.get("token") ??
      /^Bearer\s+(.+)$/i.exec(req.headers.authorization ?? "")?.[1] ??
      "";
    const workspaceId = url.searchParams.get("workspaceId") ?? "";

    const verified = token ? await verifyAccessToken(config, token) : null;
    if (!verified || !workspaceId) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    const roles = await getUserWorkspaceRoles(db, workspaceId, verified.userId);
    if (roles.length === 0) {
      socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
      socket.destroy();
      return;
    }

    this.#wss.handleUpgrade(req, socket, head, (ws) => {
      const entry: ConnectedClient = {
        socket: ws,
        userId: verified.userId,
        workspaceId,
      };
      this.#clients.add(entry);
      ws.on("close", () => {
        this.#clients.delete(entry);
      });
    });
  }

  close(): void {
    for (const client of this.#clients) {
      client.socket.close();
    }
    this.#clients.clear();
    this.#wss.close();
  }
}
