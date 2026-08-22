import { afterAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { schemaFor, sql } from "../src/platform/db";

// tests/setup.ts has already pointed DB_URL at TEST_DB_URL, or at nothing.
const TEST_DB_URL = process.env.TEST_DB_URL;
const dbTest = TEST_DB_URL ? test : test.skip;

const MODULE = "migrationprobe";

const first = {
  id: "0001-create",
  sql: "create table if not exists migration_probe (id int primary key)",
};
const second = {
  id: "0002-add-column",
  sql: "alter table migration_probe add column if not exists label text",
};

afterAll(async () => {
  if (!TEST_DB_URL) return;
  const db = new SQL(TEST_DB_URL);
  await db.unsafe("drop table if exists migration_probe");
  await db`delete from schema_migrations where module = ${MODULE}`;
  await db.close();
});

dbTest("applies a module's migrations in order and records each one", async () => {
  await schemaFor(MODULE, [first, second])();
  const applied = await sql()`
    select id from schema_migrations where module = ${MODULE} order by id`;
  expect(applied.map((row: { id: string }) => row.id)).toEqual([first.id, second.id]);

  const columns = await sql()`
    select column_name from information_schema.columns where table_name = 'migration_probe'`;
  expect(columns.map((row: { column_name: string }) => row.column_name).sort()).toEqual([
    "id",
    "label",
  ]);
});

dbTest("never applies the same migration twice", async () => {
  // A migration that would fail on a second run: proof the ledger, not `if not exists`, is
  // what makes this idempotent.
  const destructive = { id: "0003-once-only", sql: "create table migration_probe_once (id int)" };
  await schemaFor(MODULE, [first, second, destructive])();
  await schemaFor(MODULE, [first, second, destructive])();

  const count = await sql()`
    select count(*)::int as n from schema_migrations
    where module = ${MODULE} and id = ${destructive.id}`;
  expect(count[0].n).toBe(1);
  await sql().unsafe("drop table if exists migration_probe_once");
});
