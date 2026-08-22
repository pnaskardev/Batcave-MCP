/**
 * Answers one question: can this machine reach the database in DB_URL, and what is there?
 *
 * Neither entrypoint does this. They validate that DB_URL is set and then connect lazily on the
 * first query, so a server that starts cleanly proves nothing about the database.
 *
 *   bun run db:check
 */
import { inspect } from "../src/platform/db";

/** Turns a driver error into the thing that is actually wrong. */
function diagnose(message: string): string | undefined {
  const checks: [RegExp, string][] = [
    [/ENOTFOUND|getaddrinfo/i, "Hostname does not resolve. Check the host in DB_URL."],
    [/ECONNREFUSED/i, "Nothing is listening there. Check the port, and that the server is up."],
    [/ETIMEDOUT|timeout/i, "Connection timed out — usually a firewall or security group."],
    [/password|authentication|SASL/i, "Rejected the credentials. Check the user and password."],
    [/does not exist/i, "Connected, but that database or role does not exist."],
    [/SSL|TLS|certificate/i, "TLS negotiation failed. Neon needs `?sslmode=require` in the URL."],
  ];
  return checks.find(([pattern]) => pattern.test(message))?.[1];
}

if (!process.env.DB_URL && !process.env.DATABASE_URL) {
  console.error("DB_URL is not set.\n");
  console.error("  export DB_URL='postgres://user:pass@host/db?sslmode=require'");
  console.error("  bun run db:check");
  process.exit(2);
}

try {
  const info = await inspect();
  console.log(`Connected in ${info.latencyMs}ms`);
  console.log(`  server    ${info.version}`);
  console.log(`  database  ${info.database}`);
  console.log(`  user      ${info.user}`);
  console.log(
    info.tables.length
      ? `  tables    ${info.tables.join(", ")}`
      : "  tables    none — run `bun run db:migrate`",
  );
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // The URL holds a password; print only what the driver said, never the connection string.
  console.error(`Could not reach the database.\n\n  ${message}`);
  const hint = diagnose(message);
  if (hint) console.error(`\n  ${hint}`);
  process.exit(1);
}
