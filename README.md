# Batcave — resume review MCP server

An MCP server that takes two documents — a **resume** and a **job description** — and runs them
through a three-stage review. Each stage feeds the next: you cannot rewrite before you have a
match report, and you cannot run the ATS pass before you have a rewrite.

## The pipeline

| Tool | What it does |
|---|---|
| `start_review` | Intake. Takes the resume and the job description as raw text or as a path to a `.pdf` / `.docx` / `.txt` / `.md` file, extracts the text, and opens a session. |
| `resume_match_report` | **Stage 1.** Senior recruiter at the target company: match score out of 100, top 5 missing keywords, 3 red flags a hiring manager spots in under 10 seconds. |
| `rewrite_experience_xyz` | **Stage 2.** Rewrites the experience section to carry stage 1's keywords and remove its red flags, every bullet in the Google XYZ form — accomplished X as measured by Y by doing Z. |
| `ats_scroll_stopper_pass` | **Stage 3.** ATS parser pass plus a hiring manager on resume #147 of 200: which sections get skipped, then rewrites them to stop the scroll. Returns the final resume. |
| `session_status` | Which stages are done, awaiting a result, or not started, and what to call next. |
| `list_sessions` | Stored sessions, most recently updated first. |
| `export_dossier` | Returns the whole review — all three stages plus the final resume — as one markdown document. |
| `delete_session` | Deletes a session and everything stored against it. Nothing expires on its own. |

## How a stage runs

The server does not call a model. It composes the brief, holds the state, and enforces the order;
the connected client's model does the reasoning. So each stage tool is called twice:

1. **`{ session_id }`** — returns the analysis brief for that stage, with the resume, the job
   description, and every prior stage's output already embedded.
2. **`{ session_id, result }`** — records the answer. `result` is validated against the stage's
   schema, so a report with four keywords instead of five is rejected rather than stored.

Stage 2 reads the recorded stage 1 report. Stage 3 reads `updated_resume` from stage 2, not the
original. A stage called out of order fails with the tool name you need to call first.

## Two rules baked into the briefs

- **No invented metrics.** Where the source resume has no number, the rewrite emits
  `[QUANTIFY: what to measure]` and lists it in `placeholders_needing_user_input`.
- **No keyword stuffing.** A keyword goes in only where real experience supports it; the rest are
  returned in `keywords_not_addressed` with the reason.

## Transports

Two entrypoints, same tools:

| Entry | Transport | For |
|---|---|---|
| `index.ts` | stdio | A client on the same machine — Claude Code, an IDE |
| `serve.ts` | Streamable HTTP on `/mcp` | A remote client — this is what runs in the container |

stdio is a pipe between two processes on one machine; it cannot be reached over a network. A
container serving stdio would accept no connections, which is why the EC2 path uses `serve.ts`.

`serve.ts` requires two variables and refuses to start without either:

- `DB_URL` — Postgres connection string
- `MCP_AUTH_TOKEN` — shared secret; every request needs `Authorization: Bearer <token>`

`GET /healthz` is the only unauthenticated route. It opens no database connection, so a load
balancer polling it never wakes Postgres.

## Storage

Everything lives in Postgres. The server writes nothing to local disk — the only local reads are
the resume and job-description files you point it at.

```
resume_sessions(id, created_at, updated_at, company, role,
                resume jsonb, job_description jsonb)
resume_stages(session_id -> resume_sessions.id on delete cascade, stage, status,
              issued_at, completed_at, result jsonb, primary key (session_id, stage))
drizzle.__drizzle_migrations                  -- drizzle's journal, one for the project
```

Two tables rather than one document, so recording a stage writes one row instead of rewriting
both resumes, and `list_sessions` never selects the document text at all. Tables are prefixed by
module, and migrations run lazily on that module's first query — starting the server does not
wake the database.

Tables are defined once, in each module's `schema.ts`, using Drizzle. `bun run db:generate` diffs
those definitions against `drizzle/` and writes the migration; `bun run db:migrate` applies what
is pending. **Nothing migrates at runtime** — a broken migration fails the deploy rather than a
user's request.

Read every generated migration before committing it. drizzle-kit diffs schema snapshots, and a
column rename looks identical to a drop plus an add unless you tell it otherwise — which silently
destroys the column's data.

Nothing expires. Sessions accumulate until `delete_session` removes them.

## Running it

```bash
bun install
bun run dev        # Postgres + the server, hot reload, nothing to configure
```

That is `docker compose -f docker-compose.dev.yml up --build`: it brings up Postgres, creates the
dev and test databases, runs the migrations, and serves MCP on `http://127.0.0.1:3000/mcp` with
the token `dev-token-not-a-secret`. Editing anything under `src/` reloads the running server.

To run the server directly on the host instead:

```bash
export DB_URL='postgres://postgres:postgres@localhost:55432/batcave'
bun start          # stdio, for a client on this machine
bun run serve      # HTTP on :3000, also needs MCP_AUTH_TOKEN
```

Two database commands, neither of which needs the server running:

```bash
bun run db:check      # can this machine reach DB_URL, and what is in it?
bun run db:generate   # schema.ts changed -> write a migration into drizzle/
bun run db:migrate    # apply pending migrations; safe to run repeatedly
```

`db:check` is the only thing that opens a connection without serving. Both entrypoints validate
`DB_URL` at startup but connect lazily on the first query, so a clean start proves nothing.

Checks:

```bash
bun run check      # Biome format + lint  (check:fix to apply)
bun run typecheck
bun test           # unit tests; no database needed

TEST_DB_URL='postgres://postgres:postgres@localhost:55432/batcave_test' bun test
```

The end-to-end tests speak the real wire protocol against a real Postgres and **drop their tables
on teardown**. They read `TEST_DB_URL`, deliberately not `DB_URL`, so pointing the server at a
real database cannot arm the teardown — and the dev stack ships a separate `batcave_test`
database so running tests never disturbs a server you have running.

`.mcp.json` in this directory registers the stdio server for Claude Code. For another client:

```json
{ "command": "bun", "args": ["index.ts"], "cwd": "/path/to/Batcave" }
```

## Running it on EC2

```bash
export DB_URL='postgres://user:pass@host/db?sslmode=require'
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"

bun run db:check                       # confirm the instance is reachable from this box
docker compose run --rm mcp bun scripts/migrate.ts   # create the tables
docker compose up -d --build
docker compose logs -f mcp
```

**Migrate before the server takes traffic.** It will migrate itself on the first tool call if you
skip this, but then a broken migration surfaces as a failed user request rather than a failed
deploy, and the first caller waits for the schema. Re-run `db:migrate` on every deploy that ships
a new migration; it is a no-op when there is nothing to apply.

Compose refuses to start if either variable is unset. Keep them in the shell profile or an
instance secret — not in a file in this repo.

**The published port is `127.0.0.1:3000`, deliberately.** The endpoint speaks plaintext HTTP and
authenticates with a bearer token: over the open internet that token is readable by anyone on
the path. Put TLS in front of it — an ALB terminating HTTPS and forwarding to the instance, or
nginx/Caddy on the same box proxying to `127.0.0.1:3000`. Then the security group should allow
443 from your clients and nothing else; port 3000 stays closed to the world.

Rotating the token is `export MCP_AUTH_TOKEN=... && docker compose up -d`, which restarts the
container. There is one token for everyone — it identifies nobody, so it cannot tell your
sessions apart from a friend's. Per-user access needs real auth and an owner column on
`resume_sessions`; neither exists yet.

**`resume_path` resolves inside the container**, so a remote caller cannot use it — paths on
their laptop mean nothing to the server. Over HTTP, pass `resume_text` and
`job_description_text`. Mount a volume if you want the path form to work for files on the box.

`docker-compose.yml` is the production stack only. Local development uses
`docker-compose.dev.yml`, which brings its own Postgres and shares none of this configuration.

## Layout

The server is a host for **modules**. A module is one self-contained family of tools that owns
its own tables and its own vocabulary. Resume review is the only one today; a second, unrelated
one is a folder under `src/features/` and one entry in the list in `index.ts`.

```
index.ts                          stdio entrypoint
serve.ts                          HTTP entrypoint (the container runs this)
src/modules.ts                    the one list of mounted modules, shared by both entries
drizzle/                          generated migrations, one journal for all modules
drizzle.config.ts                 points drizzle-kit at src/features/*/schema.ts
src/module.ts                     the ToolModule contract every feature implements
src/server.ts                     mounts modules onto an McpServer
src/http.ts                       Streamable HTTP handler, bearer auth, /healthz
src/platform/                     feature-agnostic; knows nothing about resumes
  db.ts                             lazy Drizzle client over Bun.sql, plus the migrator
  documents.ts                      text / pdf / docx extraction
  stored-document.ts                what an extracted document looks like
  tool-result.ts                    keeps `content` and `structuredContent` in step
src/features/resume-review/
  index.ts                          the ToolModule: name, migrations, register()
  schema.ts                         this module's tables (drizzle-kit reads these)
  sessions.ts                       repository, domain types, stage gating
  briefs.ts                         the three briefs
  schemas.ts                        zod schema per stage result
  stage-tool.ts                     the brief-then-record tool shape
  dossier.ts                        markdown rendering
  tools/                            one file per group of registered tools
    intake.ts, stages.ts, dossier.ts, session-admin.ts
```

Two rules hold the structure up:

- **`src/platform` never imports from `src/features`.** Anything a second module would also want
  belongs in platform; anything only resume review wants stays in the feature.
- **No module imports another module.** Two modules that need to know about each other are one
  module.

`stage-tool.ts` deliberately lives inside the feature rather than in platform. The
brief-then-record shape might turn out to be reusable, but it has exactly one consumer today,
and guessing at the general case before a second one exists is how a platform layer rots.

## Adding a module

```ts
// src/features/interview-prep/index.ts
export const interviewPrep: ToolModule = {
  name: "interview-prep",
  register(server) {
    registerWhateverTools(server);
  },
};
```

```ts
// index.ts
const server = createServer([resumeReview, interviewPrep]);
```

That is the whole contract. Tables go in `src/features/interview-prep/schema.ts`, which the
drizzle-kit glob picks up automatically; `bun run db:generate` then writes the migration.
`tests/modules.test.ts` exercises the seam with a stub module that has nothing to do with
resumes.

The trade drizzle-kit imposes: one migrations folder and one journal for the whole project. A
module still defines its own tables, but the migration history is shared rather than
per-module.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) — `bun run dev` is the whole setup. Security issues go
through [SECURITY.md](SECURITY.md), not public issues.

## License

[MIT](LICENSE).
