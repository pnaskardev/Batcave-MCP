/**
 * The auth boundary, tested from the attacker's side.
 *
 * Every test here asserts that something is REFUSED. The one accepting case exists only to prove
 * the refusals are not a handler that rejects everything. No database: `tools/list` never queries,
 * and the client is opened lazily, so this runs in CI with no Postgres.
 */
import { expect, test } from "bun:test";
import { createFetchHandler, MIN_TOKEN_LENGTH } from "../src/http";
import { modules } from "../src/modules";

const TOKEN = "3f8a9c2e1b7d4f60a5e8c3b9d2f14a7e6c0b5d8f2a9e3c7b1d6f0a4e8c2b5d93";
const fetch = createFetchHandler(modules, { authToken: TOKEN });

const rpc = (headers: Record<string, string> = {}, path = "/mcp") =>
  new Request(`http://mcp.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });

const auth = (value: string) => rpc({ authorization: value });

test("a request with no Authorization header is refused", async () => {
  const response = await fetch(rpc());
  expect(response.status).toBe(401);
  expect(await response.json()).toEqual({ error: "unauthorized" });
});

test.each([
  ["an empty header", ""],
  ["a scheme with no token", "Bearer"],
  ["a scheme with only whitespace", "Bearer   "],
  ["the wrong scheme", `Basic ${btoa(`user:${TOKEN}`)}`],
  ["the token with no scheme", TOKEN],
  ["a different token of the same length", `Bearer ${TOKEN.replace(/^3/, "4")}`],
  ["a token differing only in its last character", `Bearer ${TOKEN.slice(0, -1)}0`],
  ["a correct prefix with trailing junk", `Bearer ${TOKEN}extra`],
  ["a truncated token", `Bearer ${TOKEN.slice(0, 32)}`],
])("%s is refused", async (_label, header) => {
  expect((await fetch(auth(header))).status).toBe(401);
});

test("the token in a query string does not authenticate", async () => {
  const response = await fetch(rpc({}, `/mcp?token=${TOKEN}&access_token=${TOKEN}`));
  expect(response.status).toBe(401);
});

test("GET is gated too — the SSE stream is not a way around the check", async () => {
  const response = await fetch(
    new Request("http://mcp.test/mcp", { method: "GET", headers: { accept: "text/event-stream" } }),
  );
  expect(response.status).toBe(401);
});

test("a 401 does not advertise an authorization server", async () => {
  // See the comment on `unauthorized()`: a WWW-Authenticate challenge is MCP's OAuth discovery
  // signal, and this server publishes no OAuth metadata to discover.
  const response = await fetch(rpc());
  expect(response.headers.get("www-authenticate")).toBeNull();
});

test("a rejected request leaks nothing but the refusal", async () => {
  const body = await (await fetch(auth("Bearer wrong"))).text();
  expect(body).not.toContain(TOKEN);
  expect(body.length).toBeLessThan(64);
});

test("unknown paths are refused whether or not the token is valid", async () => {
  for (const path of ["/", "/mcp/", "/mcp/tools", "/admin"]) {
    expect((await fetch(rpc({ authorization: `Bearer ${TOKEN}` }, path))).status).toBe(404);
    expect((await fetch(rpc({}, path))).status).toBe(404);
  }
});

test("/healthz answers without a token and reveals nothing", async () => {
  const response = await fetch(new Request("http://mcp.test/healthz"));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ status: "ok" });
});

test("the configured token is accepted", async () => {
  const response = await fetch(auth(`Bearer ${TOKEN}`));
  expect(response.status).toBe(200);
  expect(await response.text()).toContain("start_review");
});

test("the scheme is matched case-insensitively, as RFC 7235 requires", async () => {
  for (const scheme of ["bearer", "BEARER", "BeArEr"]) {
    expect((await fetch(auth(`${scheme} ${TOKEN}`))).status).toBe(200);
  }
});

test.each(["", "secret", "hunter2", "a".repeat(MIN_TOKEN_LENGTH - 1)])(
  "the server refuses to start with a %p token",
  (weak) => {
    expect(() => createFetchHandler(modules, { authToken: weak })).toThrow(/MCP_AUTH_TOKEN/);
  },
);

test("a token exactly at the floor is allowed", () => {
  expect(() =>
    createFetchHandler(modules, { authToken: "a".repeat(MIN_TOKEN_LENGTH) }),
  ).not.toThrow();
});

test("the dev stack's token clears the floor", async () => {
  // docker-compose.dev.yml hardcodes this. If the floor rises above it, `bun run dev` stops
  // booting, and it should fail here rather than on a contributor's first run.
  const compose = await Bun.file("docker-compose.dev.yml").text();
  const devToken = compose.match(/MCP_AUTH_TOKEN:\s*(\S+)/)?.[1];
  expect(devToken).toBeDefined();
  expect(devToken?.length).toBeGreaterThanOrEqual(MIN_TOKEN_LENGTH);
});
