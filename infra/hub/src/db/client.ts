import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { drizzle as drizzlePg, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export type HubDatabase = PostgresJsDatabase;

export interface HubDbHandle {
  readonly db: HubDatabase;
  readonly runMigrations: () => Promise<void>;
  readonly close: () => Promise<void>;
}

const INIT_SQL_PATH = NodePath.join(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../drizzle/0000_init.sql",
);

export function readInitMigrationSql(): string {
  return NodeFS.readFileSync(INIT_SQL_PATH, "utf8");
}

export function createPostgresHubDb(databaseUrl: string): HubDbHandle {
  const client = postgres(databaseUrl, { max: 10 });
  const db = drizzlePg({ client });

  return {
    db,
    runMigrations: async () => {
      await client.unsafe(readInitMigrationSql());
    },
    close: async () => {
      await client.end({ timeout: 5 });
    },
  };
}
