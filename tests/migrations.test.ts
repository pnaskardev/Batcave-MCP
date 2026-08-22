import { afterAll, expect, test } from "bun:test";
import { SQL } from "bun";
import { inspect, migrateToLatest } from "../src/platform/db";

// Drizzle owns whether a migration runs twice; that is its code, not ours. What is ours is the
// wiring — that the migrations folder resolves, the generated SQL applies, and running the
// deploy step twice is safe. The folder path is relative to the working directory, so this also
// catches it going missing from the Docker image.
const TEST_DB_URL = process.env.TEST_DB_URL;
const dbTest = TEST_DB_URL ? test : test.skip;

afterAll(async () => {
  if (!TEST_DB_URL) return;
  const db = new SQL(TEST_DB_URL);
  await db.unsafe(
    "drop table if exists resume_stages; drop table if exists resume_sessions; " +
      "drop schema if exists drizzle cascade;",
  );
  await db.close();
});

dbTest("db:migrate creates the schema, and running it again is a no-op", async () => {
  await migrateToLatest();
  const first = await inspect();
  expect(first.tables).toContain("resume_sessions");
  expect(first.tables).toContain("resume_stages");

  await migrateToLatest();
  const second = await inspect();
  expect(second.tables).toEqual(first.tables);
});
