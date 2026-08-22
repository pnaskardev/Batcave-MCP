/**
 * Preloaded before every test file (see bunfig.toml).
 *
 * Bun autoloads `.env`, so a developer with a real DB_URL has it set during `bun test` — and the
 * end-to-end suite drops its tables on teardown. Rather than trusting every test to remember the
 * TEST_DB_URL gate, this makes the production database unreachable from the suite entirely:
 * DB_URL is either the throwaway test database or nothing at all.
 */
const testDatabase = process.env.TEST_DB_URL ?? "";

process.env.DB_URL = testDatabase;
process.env.DATABASE_URL = testDatabase;
