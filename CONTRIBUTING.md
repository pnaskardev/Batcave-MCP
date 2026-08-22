# Contributing

Thanks for taking a look. This is a small project; the bar is a working change with a test and a
clear description.

## Getting a server running

One command brings up Postgres and the MCP server against it, with hot reload:

```bash
docker compose -f docker-compose.dev.yml up --build
```

That gives you:

| | |
|---|---|
| MCP endpoint | `http://127.0.0.1:3000/mcp` |
| Bearer token | `dev-token-not-a-secret` |
| Health check | `http://127.0.0.1:3000/healthz`, no auth |
| Dev database | `postgres://postgres:postgres@localhost:55432/batcave` |
| Test database | `postgres://postgres:postgres@localhost:55432/batcave_test` |

Nothing to configure and no secrets to obtain — the credentials above are local fixtures. Editing
anything under `src/` reloads the running server; you do not need to rebuild.

Smoke test it:

```bash
curl -s -X POST http://127.0.0.1:3000/mcp \
  -H 'authorization: Bearer dev-token-not-a-secret' \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

To point a local MCP client at the code instead, run the stdio entrypoint — see `.mcp.json`.

## Running the checks

```bash
bun install
bun run check        # Biome format + lint
bun run typecheck
bun test             # unit tests only; database tests skip

TEST_DB_URL='postgres://postgres:postgres@localhost:55432/batcave_test' bun test
```

`bun run check:fix` applies what Biome can fix on its own.

**Use `batcave_test`, not `batcave`.** The end-to-end suite drops its tables on teardown, so
pointing it at the dev database would pull the schema out from under a server you have running.
The two databases exist for exactly this reason.

Tests can only ever reach `TEST_DB_URL`. `tests/setup.ts` runs before every test file and
overwrites `DB_URL` with it — Bun autoloads `.env`, so without that a contributor with a real
connection string in `.env` would have the suite dropping tables in their own database. If a test
needs a database, gate it on `TEST_DB_URL` and skip when it is unset; never read `DB_URL`.

CI runs all of the above on every pull request, plus a build of the production Docker image.

## Adding tools

The server hosts **modules**. A module is one self-contained family of tools that owns its own
tables and its own vocabulary; resume review is currently the only one. Adding an unrelated
family of tools means adding a folder under `src/features/` and one entry in `src/modules.ts` —
see "Adding a module" in the README.

Two boundaries to respect:

- `src/platform` must not import from `src/features`. Anything a second module would also want
  belongs in platform; anything only one feature wants stays in that feature.
- No module imports another module. Two modules that need to know about each other are one
  module.

Schema changes are append-only migrations in the module's `migrations.ts`. Never edit a migration
that has already shipped — its id is recorded in `schema_migrations` and it will not run again.
Add a new one, then apply it with `bun run db:migrate`.

## Style

Biome decides formatting, so there is nothing to argue about in review. Beyond that, matching the
surrounding code matters more than any rule here:

- Comments explain **why**, not what. If a comment is needed to say what the code does, the code
  needs rewriting instead.
- Errors say what failed and what to do about it. `No session "abc"` is not enough; name the tool
  the caller should reach for next.
- Tests assert behaviour, not implementation. A refactor that breaks a test without breaking the
  code means the test was wrong.

## Pull requests

- One logical change per PR. Unrelated cleanups are easier to review as their own PR.
- Say what breaks if the change is wrong. That is more useful than describing what it does.
- New behaviour needs a test. Bug fixes need a test that fails without the fix — check it does by
  reverting the fix.
- Green CI before review.

## Reporting a security issue

Do not open a public issue. See [SECURITY.md](SECURITY.md).
