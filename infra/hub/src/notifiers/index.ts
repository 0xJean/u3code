import * as NodeCrypto from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import type { NotificationMessage, NotifierDriverKind } from "@u3code/hub-contracts";
import type { HubConfig } from "../config.ts";
import type { HubDatabase } from "../db/client.ts";
import { notificationChannels, users, workspaceMemberships } from "../db/schema.ts";
import { decryptSecretJson } from "../utils/crypto.ts";

export interface NotificationMentionTarget {
  readonly vcsLogins?: readonly string[];
  readonly roles?: readonly string[];
}

export interface NotifierChannelSecretConfig {
  readonly webhookUrl: string;
  readonly signingSecret?: string;
}

export interface NotifierDriver {
  readonly kind: NotifierDriverKind;
  readonly send: (
    channelConfig: NotifierChannelSecretConfig,
    message: NotificationMessage,
  ) => Promise<void>;
}

const SEVERITY_HEADER_TEMPLATE: Record<NotificationMessage["severity"], string> = {
  info: "blue",
  warning: "orange",
  critical: "red",
};

export function buildLarkInteractiveCard(
  message: NotificationMessage,
  signingSecret?: string,
  timestampSec: number = Math.floor(Date.now() / 1000),
): Record<string, unknown> {
  const mentions =
    message.mentionHandles && message.mentionHandles.length > 0
      ? `${message.mentionHandles.map((id) => `<at id=${id}></at>`).join(" ")}\n`
      : "";
  const bullets =
    message.bullets.length > 0 ? `\n${message.bullets.map((b) => `- ${b}`).join("\n")}` : "";
  const linkLine = message.url ? `\n\n[Open Details](${message.url})` : "";

  const payload: Record<string, unknown> = {
    msg_type: "interactive",
    card: {
      header: {
        title: { tag: "plain_text", content: message.title },
        template: SEVERITY_HEADER_TEMPLATE[message.severity],
      },
      elements: [
        {
          tag: "markdown",
          content: `${mentions}${message.summary}${bullets}${linkLine}`,
        },
      ],
    },
  };

  if (signingSecret) {
    const stringToSign = `${timestampSec}\n${signingSecret}`;
    const sign = NodeCrypto.createHmac("sha256", stringToSign).digest("base64");
    payload.timestamp = String(timestampSec);
    payload.sign = sign;
  }

  return payload;
}

export class LarkNotifierDriver implements NotifierDriver {
  readonly kind: NotifierDriverKind = "lark";
  readonly #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetchImpl = fetchImpl;
  }

  async send(
    channelConfig: NotifierChannelSecretConfig,
    message: NotificationMessage,
  ): Promise<void> {
    const body = buildLarkInteractiveCard(message, channelConfig.signingSecret);
    const res = await this.#fetchImpl(channelConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Lark webhook failed with status ${res.status}`);
    }
  }
}

export class GenericWebhookNotifierDriver implements NotifierDriver {
  readonly kind: NotifierDriverKind = "webhook";
  readonly #fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.#fetchImpl = fetchImpl;
  }

  async send(
    channelConfig: NotifierChannelSecretConfig,
    message: NotificationMessage,
  ): Promise<void> {
    const rawBody = JSON.stringify(message);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (channelConfig.signingSecret) {
      const sig = NodeCrypto.createHmac("sha256", channelConfig.signingSecret)
        .update(rawBody)
        .digest("hex");
      headers["X-U3Code-Signature-256"] = `sha256=${sig}`;
    }
    const res = await this.#fetchImpl(channelConfig.webhookUrl, {
      method: "POST",
      headers,
      body: rawBody,
    });
    if (!res.ok) {
      throw new Error(`Generic webhook failed with status ${res.status}`);
    }
  }
}

export class NotificationDispatcher {
  readonly #drivers = new Map<NotifierDriverKind, NotifierDriver>();
  readonly #db: HubDatabase;
  readonly #config: HubConfig;

  constructor(db: HubDatabase, config: HubConfig, drivers?: readonly NotifierDriver[]) {
    this.#db = db;
    this.#config = config;
    const defaults = drivers ?? [new LarkNotifierDriver(), new GenericWebhookNotifierDriver()];
    for (const driver of defaults) {
      this.#drivers.set(driver.kind, driver);
    }
  }

  registerDriver(driver: NotifierDriver): void {
    this.#drivers.set(driver.kind, driver);
  }

  hasDriver(kind: NotifierDriverKind): boolean {
    return this.#drivers.has(kind);
  }

  listDrivers(): readonly NotifierDriverKind[] {
    return [...this.#drivers.keys()];
  }

  async dispatch(
    workspaceId: string,
    projectId: string | null,
    message: NotificationMessage,
    mentionTarget?: NotificationMentionTarget,
  ): Promise<{ readonly sent: number; readonly failed: number }> {
    const channels = await this.#db
      .select()
      .from(notificationChannels)
      .where(
        and(
          eq(notificationChannels.workspaceId, workspaceId),
          eq(notificationChannels.isEnabled, true),
          projectId
            ? or(
                isNull(notificationChannels.projectId),
                eq(notificationChannels.projectId, projectId),
              )
            : isNull(notificationChannels.projectId),
        ),
      );

    const wantedLogins = new Set(
      (mentionTarget?.vcsLogins ?? []).map((l) => l.trim().toLowerCase()).filter(Boolean),
    );
    const wantedRoles = new Set(
      (mentionTarget?.roles ?? []).map((r) => r.trim().toLowerCase()).filter(Boolean),
    );

    const matchedUsers =
      wantedLogins.size > 0 || wantedRoles.size > 0
        ? (
            await this.#db
              .select({
                primaryVcsLogin: users.primaryVcsLogin,
                notificationHandles: users.notificationHandles,
                roles: workspaceMemberships.roles,
              })
              .from(workspaceMemberships)
              .innerJoin(users, eq(workspaceMemberships.userId, users.id))
              .where(eq(workspaceMemberships.workspaceId, workspaceId))
          ).filter((row) => {
            const loginMatch =
              row.primaryVcsLogin !== null &&
              wantedLogins.has(row.primaryVcsLogin.trim().toLowerCase());
            const roleMatch = row.roles.some((r) => wantedRoles.has(r.trim().toLowerCase()));
            return loginMatch || roleMatch;
          })
        : [];

    let sent = 0;
    let failed = 0;

    for (const channel of channels) {
      if (!channel.events.includes(message.event)) continue;
      const driver = this.#drivers.get(channel.driver as NotifierDriverKind);
      if (!driver) continue;

      const resolvedHandles = new Set(message.mentionHandles ?? []);
      for (const member of matchedUsers) {
        const handle = member.notificationHandles[channel.driver];
        if (handle && handle.trim().length > 0) {
          resolvedHandles.add(handle.trim());
        }
      }
      const enrichedMessage: NotificationMessage =
        resolvedHandles.size > 0 ? { ...message, mentionHandles: [...resolvedHandles] } : message;

      try {
        const secretCfg = decryptSecretJson<NotifierChannelSecretConfig>(
          this.#config.encryptionKey,
          channel.configEncrypted,
        );
        await driver.send(secretCfg, enrichedMessage);
        sent++;
      } catch {
        failed++;
      }
    }

    return { sent, failed };
  }
}
