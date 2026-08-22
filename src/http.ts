import { timingSafeEqual } from "node:crypto";
import { createMcpHandler } from "@modelcontextprotocol/server";
import type { ToolModule } from "./module";
import { createServer } from "./server";

export interface HttpOptions {
  /** Shared secret every request must present as `Authorization: Bearer <token>`. */
  readonly authToken: string;
  readonly onError?: (error: Error) => void;
}

function tokenMatches(presented: string, expected: string): boolean {
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

function bearer(request: Request): string | undefined {
  const header = request.headers.get("authorization");
  return header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": "Bearer" },
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
