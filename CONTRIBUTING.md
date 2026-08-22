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

Schema lives in the module's `schema.ts` as Drizzle table definitions — that file is the single
source of truth. To change it: edit `schema.ts`, run `bun run db:generate` to write the migration
into `drizzle/`, read the SQL it produced, then `bun run db:migrate` to apply it. Commit the
schema change and the generated migration together.

Never edit a migration that has already shipped; add a new one.

**Read what drizzle-kit generates.** It diffs schema snapshots, so a column rename is
indistinguishable from a drop plus an add — and it will happily emit the destructive version.

### If someone else's migration merges before yours

Regenerate yours on top of theirs. This is not optional, and getting it wrong fails silently.

```
git rebase main                              # or merge
delete your drizzle/NNNN_*.sql and its entry in drizzle/meta/_journal.json
bun run db:generate                          # rebuild the diff against the merged schema
```

The migrator decides what to apply by comparing timestamps against the newest migration already
in the database:

```js
if (!lastDbMigration || Number(lastDbMigration.created_at) < migration.folderMillis)
```

So a migration whose journal timestamp is **older** than one already applied is skipped — with no
error, on every deploy, forever. Two people branching from the same commit produce exactly that:
whoever generated earlier but merges later has their migration silently dropped, and the deploy
reports success. Regenerating gives yours a current timestamp and a diff against the real schema.

The same rule explains a confusing local case: dropping your tables but leaving the `drizzle`
schema means the journal still claims everything is applied, so `db:migrate` does nothing. Reset
both together:

```
bun -e 'import {sql} from "./src/platform/db"; await sql().unsafe("drop table if exists resume_stages; drop table if exists resume_sessions; drop schema if exists drizzle cascade;")'
bun run db:migrate
```

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
