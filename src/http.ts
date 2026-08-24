import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { ToolModule } from "./module";
import { createServer } from "./server";

export interface HttpOptions {
  /** Shared secret every request must present as `Authorization: Bearer <token>`. */
  readonly authToken: string;
  readonly onError?: (error: Error) => void;
}

/**
 * Shortest token the server will serve with. One shared secret is the whole access control, and
 * the endpoint is reachable from the public internet, so a guessable one is the same as no auth.
 * `openssl rand -hex 32` gives 64 characters; this floor of 128 bits only rules out the passwords
 * someone types by hand.
 */
export const MIN_TOKEN_LENGTH = 32;

function assertUsableToken(token: string): void {
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `MCP_AUTH_TOKEN is ${token.length} characters; at least ${MIN_TOKEN_LENGTH} are required. ` +
        "It is the only thing standing between the internet and this server. " +
        "Generate one with `openssl rand -hex 32`.",
    );
  }
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// The scheme is case-insensitive (RFC 7235 §2.1) and the token itself carries no spaces, so a
// header of only whitespace after the scheme does not match at all rather than presenting a blank
// token to the comparison.
const BEARER = /^Bearer +([^ ]+)$/i;

function bearer(request: Request): string | undefined {
  return BEARER.exec(request.headers.get("authorization") ?? "")?.[1];
}

function unauthorized(): Response {
  // Deliberately no `WWW-Authenticate` header, despite RFC 7235 asking for one on a 401. In MCP
  // that header is the OAuth discovery signal — clients follow it looking for authorization
  // server metadata, which this server does not publish because it has no OAuth. A bare
  // challenge would point them at a handshake that cannot complete.
  //
  // It does NOT affect how Claude's connector dialog labels the server. That label is inferred
  // from the 401 status alone: tested by deploying both variants, the dialog reports
  // "Authentication: Always required (Detected)" either way. Select "None" and supply the token
  // as a request header.
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Serves the modules over Streamable HTTP.
 *
 * A fresh `McpServer` per request: every tool keeps its state in Postgres, so there is nothing
 * worth holding between requests, and a stateless handler survives being restarted or run
 * behind more than one instance.
 */
export function createFetchHandler(
  modules: readonly ToolModule[],
  options: HttpOptions,
): (request: Request) => Promise<Response> {
  assertUsableToken(options.authToken);
  const handler = createMcpHandler(() => createServer(modules), { onerror: options.onError });

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);

    // Liveness only, and deliberately free: it touches no module and opens no database
    // connection, so a load balancer polling it every few seconds never wakes Postgres.
    if (url.pathname === "/healthz") {
      return new Response(JSON.stringify({ status: "ok" }), {
        headers: { "content-type": "application/json" },
      });
    }

    if (url.pathname !== "/mcp") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }

    const presented = bearer(request);
    if (!presented || !tokenMatches(presented, options.authToken)) {
      return unauthorized();
    }

    return handler.fetch(request);
  };
}
