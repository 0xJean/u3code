import { loadHubConfig } from "../config.ts";
import { createPostgresHubDb } from "./client.ts";

const config = loadHubConfig();
const handle = createPostgresHubDb(config.databaseUrl);
try {
  await handle.runMigrations();
  console.log("u3code-hub migrations applied successfully.");
} finally {
  await handle.close();
}
