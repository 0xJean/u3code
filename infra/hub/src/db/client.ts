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

export async function createHubDbFromUrl(databaseUrl: string): Promise<HubDbHandle> {
  if (databaseUrl.startsWith("pglite://")) {
    const rawTarget = databaseUrl.slice("pglite://".length).trim();
    const dataDir = !rawTarget || rawTarget === "memory" ? undefined : NodePath.resolve(rawTarget);
    if (dataDir) {
      NodeFS.mkdirSync(dataDir, { recursive: true });
    }
    const [{ PGlite }, { drizzle: drizzlePglite }] = await Promise.all([
      import("@electric-sql/pglite"),
      import("drizzle-orm/pglite"),
    ]);
    const pglite = dataDir ? new PGlite(dataDir) : new PGlite();
    const db = drizzlePglite({ client: pglite }) as unknown as HubDatabase;
    return {
      db,
      runMigrations: async () => {
        await pglite.exec(readInitMigrationSql());
      },
      close: async () => {
        await pglite.close();
      },
    };
  }
  return createPostgresHubDb(databaseUrl);
}
