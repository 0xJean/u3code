import { serve } from "@hono/node-server";
import { createHubApp } from "./app.ts";
import { loadHubConfig } from "./config.ts";
import { createPostgresHubDb } from "./db/client.ts";
import { DigestScheduler } from "./memory/scheduler.ts";

const config = loadHubConfig();
const dbHandle = createPostgresHubDb(config.databaseUrl);
await dbHandle.runMigrations();

const { app, broker, notifier } = createHubApp({ db: dbHandle.db, config });
const digestScheduler = new DigestScheduler({ db: dbHandle.db, config, broker, notifier });
digestScheduler.start();

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(`u3code-hub listening on http://${info.address}:${info.port}`);
    if (digestScheduler.slots.length > 0) {
      console.log(
        `Scheduled AI digests active at: ${digestScheduler.slots.map((s) => s.label).join(", ")} (UTC offset ${config.digestTimezoneOffsetMinutes}m)`,
      );
    }
  },
);

server.on("upgrade", (req, socket, head) => {
  void broker.handleUpgrade(dbHandle.db, config, req, socket, head);
});

const shutdown = async () => {
  digestScheduler.stop();
  broker.close();
  server.close();
  await dbHandle.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
