import { createFetchHandler } from "./src/http";
import { modules } from "./src/modules";

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. ${hint}`);
  return value;
}

const authToken = required(
  "MCP_AUTH_TOKEN",
  "Every request must present it as `Authorization: Bearer <token>`. " +
    "Generate one with `openssl rand -hex 32`.",
);
required("DB_URL", "Point it at your Postgres instance.");

const port = Number(process.env.PORT ?? 3000);
const hostname = process.env.HOST ?? "0.0.0.0";

const fetch = createFetchHandler(modules, {
  authToken,
  onError: (error) => console.error("[mcp]", error.message),
});

const server = Bun.serve({ port, hostname, fetch });

console.error(`[mcp] listening on http://${server.hostname}:${server.port}/mcp`);
