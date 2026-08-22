import { SQL } from "bun";
import type { Migration } from "../module";

let client: SQL | undefined;

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

/** The shared connection pool. Created on first use so starting the server wakes nothing. */
export function sql(): SQL {
  client ??= new SQL(connectionUrl());
  return client;
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
  const db = sql();
  const [identity] = await db`
    select current_database() as database, current_user as "user", version() as version`;
  const latencyMs = Math.round(performance.now() - started);
  const tables = await db`
    select tablename from pg_tables where schemaname = 'public' order by tablename`;
  return {
    database: String(identity.database),
    user: String(identity.user),
    version: String(identity.version).split(" on ")[0] ?? String(identity.version),
    latencyMs,
    tables: tables.map((row: { tablename: string }) => row.tablename),
  };
}

const LEDGER = `create table if not exists schema_migrations (
  module text not null,
  id text not null,
  applied_at timestamptz not null default now(),
  primary key (module, id)
)`;

/**
 * Returns a memoised `ensure()` that brings one module's schema up to date. Modules call it
 * before their first query rather than at startup, so an unused module costs no round trips.
 */
export function schemaFor(module: string, migrations: readonly Migration[]): () => Promise<void> {
  let ready: Promise<void> | undefined;
  return () => (ready ??= migrate(module, migrations).then(() => undefined));
}

/**
 * Brings one module's schema up to date and reports the ids it applied. Safe to run repeatedly:
 * each migration executes with its ledger row in one transaction, so a migration is applied
 * exactly once even if a previous run died halfway through.
 *
 * Prefer running this as a deploy step (`bun run db:migrate`) over letting the first tool call
 * trigger it — a failed migration should break the deploy, not a user's request.
 */
export async function migrate(module: string, migrations: readonly Migration[]): Promise<string[]> {
  const db = sql();
  await db.unsafe(LEDGER);
  const applied = await db`select id from schema_migrations where module = ${module}`;
  const done = new Set(applied.map((row: { id: string }) => row.id));
  const newlyApplied: string[] = [];
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await db.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`insert into schema_migrations (module, id) values (${module}, ${migration.id})`;
    });
    newlyApplied.push(migration.id);
  }
  return newlyApplied;
}
