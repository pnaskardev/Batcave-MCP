/**
 * Applies every pending migration in `drizzle/`, then exits.
 *
 * Run this as a deploy step, before the server takes traffic. Nothing migrates itself at
 * startup: a broken migration should fail the deploy, not a user's request.
 *
 *   bun run db:migrate
 *
 * Safe to run repeatedly — drizzle records what it has applied and skips it.
 */
import { inspect, migrateToLatest } from "../src/platform/db";

if (!process.env.DB_URL && !process.env.DATABASE_URL) {
  console.error("DB_URL is not set.\n");
  console.error("  export DB_URL='postgres://user:pass@host/db?sslmode=require'");
  console.error("  bun run db:migrate");
  process.exit(2);
}

try {
  const before = await inspect();
  await migrateToLatest();
  const after = await inspect();

  const added = after.tables.filter((table) => !before.tables.includes(table));
  console.log(added.length ? `Applied. New tables: ${added.join(", ")}` : "Already up to date.");
  console.log(`  database  ${after.database}`);
  console.log(`  tables    ${after.tables.join(", ") || "none"}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // The connection string holds a password; report only what the driver said.
  console.error(`\nMigration failed: ${message}`);
  process.exit(1);
}
