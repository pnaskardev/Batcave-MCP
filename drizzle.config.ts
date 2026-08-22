import { defineConfig } from "drizzle-kit";

/**
 * Every module keeps its tables in its own `schema.ts`; the glob picks all of them up. The
 * generated migrations land in one folder with one journal, which is the trade drizzle-kit
 * asks for — modules still define their own schema, but the migration history is shared.
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/features/*/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DB_URL ?? process.env.DATABASE_URL ?? "",
  },
  // Never let drizzle-kit apply anything straight to a database. Migrations are generated,
  // reviewed, committed, and then applied by `bun run db:migrate`.
  strict: true,
  verbose: true,
});
