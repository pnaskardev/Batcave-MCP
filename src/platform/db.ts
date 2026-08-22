import { SQL } from "bun";
import { type BunSQLDatabase, drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";

let client: SQL | undefined;
let database: BunSQLDatabase | undefined;

function connectionUrl(): string {
  const url = process.env.DB_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DB_URL is not set. Point it at your Postgres instance, e.g. " +
        "postgres://user:pass@host/db?sslmode=require",
    );
  }
  return url;
}

/**
 * Fails now rather than on the first tool call. Both entrypoints call it at startup: a server
 * that cannot reach a database is not serving, and finding that out mid-request is worse.
 * It reads configuration only — no connection is opened, so it costs nothing.
 */
export function assertConfigured(): void {
  connectionUrl();
}

/** The raw Bun SQL client, for introspection that has no schema to go through. */
export function sql(): SQL {
  client ??= new SQL(connectionUrl());
  return client;
}

/** The query builder every repository uses. Created on first use, so startup wakes nothing. */
export function db(): BunSQLDatabase {
  database ??= drizzle({ client: sql() });
  return database;
}

/** Where drizzle-kit writes migrations, relative to the working directory. */
const MIGRATIONS_FOLDER = "./drizzle";

/**
 * Applies every pending migration. Safe to run repeatedly — drizzle records what it has applied
 * and skips it. Run it as a deploy step (`bun run db:migrate`) rather than at startup: a broken
 * migration should fail the deploy, not a user's request.
 */
export async function migrateToLatest(): Promise<void> {
  await migrate(db(), { migrationsFolder: MIGRATIONS_FOLDER });
}

export interface DatabaseInfo {
  database: string;
  user: string;
  version: string;
  latencyMs: number;
  tables: string[];
}

/** Opens a real connection and reports what answered. Used by `bun run db:check`. */
export async function inspect(): Promise<DatabaseInfo> {
  const started = performance.now();
  const raw = sql();
  const [identity] = await raw`
    select current_database() as database, current_user as "user", version() as version`;
  const latencyMs = Math.round(performance.now() - started);
  const tables = await raw`
    select tablename from pg_tables where schemaname = 'public' order by tablename`;
  return {
    database: String(identity.database),
    user: String(identity.user),
    version: String(identity.version).split(" on ")[0] ?? String(identity.version),
    latencyMs,
    tables: tables.map((row: { tablename: string }) => row.tablename),
  };
}
