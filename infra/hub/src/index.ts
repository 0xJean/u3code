import { serve } from "@hono/node-server";
import { createHubApp } from "./app.ts";
import { loadHubConfig } from "./config.ts";
import { createPostgresHubDb } from "./db/client.ts";

const config = loadHubConfig();
const dbHandle = createPostgresHubDb(config.databaseUrl);
await dbHandle.runMigrations();

const { app, broker } = createHubApp({ db: dbHandle.db, config });

const server = serve(
  {
    fetch: app.fetch,
    hostname: config.host,
    port: config.port,
  },
  (info) => {
    console.log(`u3code-hub listening on http://${info.address}:${info.port}`);
  },
);

server.on("upgrade", (req, socket, head) => {
  void broker.handleUpgrade(dbHandle.db, config, req, socket, head);
});

const shutdown = async () => {
  broker.close();
  server.close();
  await dbHandle.close();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
