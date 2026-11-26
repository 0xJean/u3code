import { describe, expect, it } from "vite-plus/test";
import type { NotificationMessage } from "@u3code/hub-contracts";
import { GenericWebhookNotifierDriver, buildLarkInteractiveCard } from "./index.ts";

describe("pluggable notification drivers", () => {
  const sampleMessage: NotificationMessage = {
    event: "pr.bot_blocked",
    title: "[Dotsbot] PR #42 Blocked (org/nexus-go)",
    severity: "critical",
    summary: "Dotsbot requested changes on auth refactor.",
    bullets: ["High risk: missing token rotation check"],
    url: "https://github.com/org/nexus-go/pull/42",
    mentionHandles: ["ou_owner123"],
  };

  it("formats Lark interactive card with mentions and HMAC signature", () => {
    const payload = buildLarkInteractiveCard(sampleMessage, "lark-secret", 1_700_000_000);
    expect(payload.msg_type).toBe("interactive");
    expect(payload.timestamp).toBe("1700000000");
    expect(typeof payload.sign).toBe("string");

    const card = payload.card as {
      header: { template: string };
      elements: Array<{ content: string }>;
    };
    expect(card.header.template).toBe("red");
    expect(card.elements[0]?.content).toContain("<at id=ou_owner123></at>");
    expect(card.elements[0]?.content).toContain("High risk: missing token rotation check");
  });

  it("sends signed JSON payloads through GenericWebhookNotifierDriver", async () => {
    let capturedHeaders: Record<string, string> = {};
    let capturedBody = "";

    const fakeFetch: typeof fetch = async (_url, init) => {
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;
      capturedBody = String(init?.body ?? "");
      return new Response("ok", { status: 200 });
    };

    const driver = new GenericWebhookNotifierDriver(fakeFetch);
    await driver.send(
      { webhookUrl: "https://hooks.example.com/u3code", signingSecret: "wh-secret" },
      sampleMessage,
    );

    expect(capturedHeaders["X-U3Code-Signature-256"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    expect(JSON.parse(capturedBody).event).toBe("pr.bot_blocked");
  });
});
