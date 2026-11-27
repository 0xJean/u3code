import { GenericWebhookNotifierDriver } from "../../notifiers/index.ts";
import { defineHubPlugin } from "../types.ts";

export const webhookPlugin = defineHubPlugin({
  id: "webhook",
  name: "Generic Signed Webhook",
  version: "1.0.0",
  description: "Dispatches HMAC-SHA256 signed JSON notifications to arbitrary HTTP endpoints.",
  builtin: true,
  register(ctx) {
    ctx.registerNotifier(new GenericWebhookNotifierDriver(ctx.fetchImpl));
  },
});
