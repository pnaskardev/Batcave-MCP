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

## Storage

Everything lives in Postgres. The server writes nothing to local disk — the only local reads are
the resume and job-description files you point it at.

```
resume_sessions(id, created_at, updated_at, company, role,
                resume jsonb, job_description jsonb)
resume_stages(session_id -> resume_sessions.id on delete cascade, stage, status,
              issued_at, completed_at, result jsonb, primary key (session_id, stage))
schema_migrations(module, id, applied_at)     -- shared, owned by src/platform/db.ts
```

Two tables rather than one document, so recording a stage writes one row instead of rewriting
both resumes, and `list_sessions` never selects the document text at all. Tables are prefixed by
module, and migrations run lazily on that module's first query — starting the server does not
wake the database.

Nothing expires. Sessions accumulate until `delete_session` removes them.

## Running it

```bash
bun install
export DB_URL='postgres://user:pass@host/db?sslmode=require'   # DATABASE_URL also accepted
bun start          # stdio MCP server
bun run typecheck
bun test           # unit tests; no database needed
```

The end-to-end tests speak the real wire protocol against a real Postgres, and **drop their
tables on teardown**. They read `TEST_DB_URL`, deliberately not `DB_URL`, so pointing the server
at a real database cannot arm the teardown:

```bash
docker run -d --name pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=batcave -p 55432:5432 postgres:16-alpine
TEST_DB_URL='postgres://postgres:test@localhost:55432/batcave' bun test
```

`.mcp.json` in this directory registers the server for Claude Code. For another client:

```json
{ "command": "bun", "args": ["index.ts"], "cwd": "/home/jarvis/Work/personal/Batcave" }
```

## Layout

The server is a host for **modules**. A module is one self-contained family of tools that owns
its own tables and its own vocabulary. Resume review is the only one today; a second, unrelated
one is a folder under `src/features/` and one entry in the list in `index.ts`.

```
index.ts                          createServer([resumeReview]) and connect stdio
src/module.ts                     the ToolModule contract every feature implements
src/server.ts                     mounts modules onto an McpServer
src/platform/                     feature-agnostic; knows nothing about resumes
  db.ts                             lazy Postgres pool + per-module migration runner
  documents.ts                      text / pdf / docx extraction
  stored-document.ts                what an extracted document looks like
  tool-result.ts                    keeps `content` and `structuredContent` in step
src/features/resume-review/
  index.ts                          the ToolModule: name, migrations, register()
  migrations.ts                     this module's tables
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
  migrations,                       // its own tables, namespaced in schema_migrations
  register(server) {
    registerWhateverTools(server);
  },
};
```

```ts
// index.ts
const server = createServer([resumeReview, interviewPrep]);
```

That is the whole contract. Migrations are applied once each, tracked per module in
`schema_migrations`, and run lazily the first time that module touches the database — an
unused module costs no round trips. `tests/modules.test.ts` exercises the seam with a stub
module that has nothing to do with resumes.
