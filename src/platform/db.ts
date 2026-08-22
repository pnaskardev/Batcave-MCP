import { SQL } from "bun";
import type { Migration } from "../module";

let client: SQL | undefined;

/** The shared connection pool. Created on first use so starting the server wakes nothing. */
export function sql(): SQL {
  if (!client) {
    const url = process.env.DB_URL ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DB_URL is not set. Point it at your Postgres instance, e.g. " +
          "postgres://user:pass@host/db?sslmode=require",
      );
    }
    client = new SQL(url);
  }
  return client;
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
  return () => (ready ??= migrate(module, migrations));
}

async function migrate(module: string, migrations: readonly Migration[]): Promise<void> {
  const db = sql();
  await db.unsafe(LEDGER);
  const applied = await db`select id from schema_migrations where module = ${module}`;
  const done = new Set(applied.map((row: { id: string }) => row.id));
  for (const migration of migrations) {
    if (done.has(migration.id)) continue;
    await db.begin(async (tx) => {
      await tx.unsafe(migration.sql);
      await tx`insert into schema_migrations (module, id) values (${module}, ${migration.id})`;
    });
  }
}
