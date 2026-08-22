/**
 * Answers one question about the machine you are on: is this box configured to serve?
 *
 *   bun run preflight
 *
 * It checks configuration, reaches the database, then boots the real HTTP entrypoint on a spare
 * port and exercises the auth path with the actual token before shutting it down. Nothing it
 * prints reveals a secret — credentials are reported by length only.
 *
 * Exits non-zero if any check fails, so it can gate a deploy.
 */
import { inspect } from "../src/platform/db";

const PORT = Number(process.env.PREFLIGHT_PORT ?? 3999);

let failures = 0;
const pass = (message: string) => console.log(`  PASS  ${message}`);
const fail = (message: string) => {
  failures += 1;
  console.log(`  FAIL  ${message}`);
};

// --- configuration -----------------------------------------------------------------------
const token = process.env.MCP_AUTH_TOKEN;
const dbUrl = process.env.DB_URL ?? process.env.DATABASE_URL;

if (token) {
  pass(`MCP_AUTH_TOKEN set (${token.length} chars)`);
  if (token.length < 32) fail("token is short — generate one with `openssl rand -hex 32`");
} else {
  fail("MCP_AUTH_TOKEN is not set");
}

if (dbUrl) {
  pass(`DB_URL set (${dbUrl.length} chars, scheme ${dbUrl.split("://")[0]})`);
} else {
  fail("DB_URL is not set");
}

// --- the database, from this machine -----------------------------------------------------
if (dbUrl) {
  try {
    const info = await inspect();
    pass(`database reachable in ${info.latencyMs}ms (${info.database} as ${info.user})`);
    const expected = ["resume_sessions", "resume_stages"];
    const missing = expected.filter((table) => !info.tables.includes(table));
    if (missing.length) {
      fail(`tables missing: ${missing.join(", ")} — run \`bun run db:migrate\``);
    } else {
      pass(`schema present (${info.tables.join(", ")})`);
    }
  } catch (error) {
    fail(`database unreachable: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// --- the server, as it will actually run --------------------------------------------------
if (token && dbUrl) {
  const server = Bun.spawn(["bun", "serve.ts"], {
    env: { ...process.env, PORT: String(PORT) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const base = `http://127.0.0.1:${PORT}`;

  let healthy = false;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if ((await fetch(`${base}/healthz`)).ok) {
        healthy = true;
        break;
      }
    } catch {
      // Not listening yet.
    }
    await Bun.sleep(250);
  }

  if (!healthy) {
    fail("serve.ts did not start");
    console.log(await new Response(server.stderr).text());
  } else {
    pass("serve.ts starts and /healthz answers");

    const call = (headers: Record<string, string>) =>
      fetch(`${base}/mcp`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
          ...headers,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });

    const anonymous = await call({});
    anonymous.status === 401
      ? pass("unauthenticated request rejected (401)")
      : fail(`unauthenticated request returned ${anonymous.status}, expected 401`);

    const wrong = await call({ authorization: "Bearer not-the-real-token" });
    wrong.status === 401
      ? pass("wrong token rejected (401)")
      : fail(`wrong token returned ${wrong.status}, expected 401`);

    const authorised = await call({ authorization: `Bearer ${token}` });
    if (authorised.ok) {
      const body = await authorised.text();
      const line = body.split("\n").find((l) => l.startsWith("data: "));
      const tools = line ? JSON.parse(line.slice(6)).result?.tools?.length : 0;
      pass(`configured token accepted — tools/list returned ${tools} tools`);
    } else {
      fail(`configured token rejected with ${authorised.status}`);
    }
  }

  server.kill();
}

console.log(
  failures === 0
    ? "\nReady to serve. Remaining work is outside this machine: TLS in front, and the\nsecurity group restricted to Anthropic's egress range 160.79.104.0/21."
    : `\n${failures} check(s) failed.`,
);
process.exit(failures === 0 ? 0 : 1);
