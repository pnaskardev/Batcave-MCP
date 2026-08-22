/**
 * Creates or updates every module's tables, then exits.
 *
 * Run this as a deploy step, before the server takes traffic. The server can migrate itself on
 * the first tool call, but then a broken migration surfaces as a failed user request instead of
 * a failed deploy — and the first caller pays the latency.
 *
 *   bun run db:migrate
 *
 * Safe to run repeatedly: each migration is recorded in `schema_migrations` and applied once.
 */
import { modules } from "../src/modules";
import { migrate } from "../src/platform/db";

if (!process.env.DB_URL && !process.env.DATABASE_URL) {
  console.error("DB_URL is not set.\n");
  console.error("  export DB_URL='postgres://user:pass@host/db?sslmode=require'");
  console.error("  bun run db:migrate");
  process.exit(2);
}

let total = 0;

try {
  for (const module of modules) {
    const applied = await migrate(module.name, module.migrations);
    total += applied.length;
    if (applied.length === 0) {
      console.log(`${module.name}: already up to date`);
      continue;
    }
    console.log(`${module.name}: applied ${applied.length}`);
    for (const id of applied) console.log(`  + ${id}`);
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // The connection string holds a password; report only what the driver said.
  console.error(`\nMigration failed: ${message}`);
  console.error("Nothing was half-applied — each migration commits with its ledger row.");
  process.exit(1);
}

console.log(total === 0 ? "\nSchema unchanged." : `\nSchema updated (${total} migration(s)).`);
