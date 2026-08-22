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
sessions(id, created_at, updated_at, company, role, resume jsonb, job_description jsonb)
stages(session_id -> sessions.id on delete cascade, stage, status,
       issued_at, completed_at, result jsonb, primary key (session_id, stage))
```

Two tables rather than one document, so recording a stage writes one row instead of rewriting
both resumes, and `list_sessions` never selects the document text at all. Schema is created on
first use with `IF NOT EXISTS`, lazily — starting the server does not wake the database.

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

```
index.ts              server bootstrap, stdio transport
src/store.ts          Postgres-backed sessions and stage gating
src/documents.ts      text / pdf / docx extraction
src/schemas.ts        zod schemas for each stage's result
src/stages.ts         the three briefs
src/tools/pipeline.ts start_review and the three chained stage tools
src/tools/support.ts  status, listing, dossier export, deletion
```
