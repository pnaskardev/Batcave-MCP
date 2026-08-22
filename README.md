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
| `export_dossier` | Writes the whole review — all three stages plus the final resume — to one markdown file. |

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

## Running it

```bash
bun install
bun start          # stdio MCP server
bun test
bun run typecheck
```

`.mcp.json` in this directory registers the server for Claude Code. For another client:

```json
{ "command": "bun", "args": ["index.ts"], "cwd": "/home/jarvis/Work/personal/Batcave" }
```

Sessions are JSON files in `~/.batcave/sessions/`, overridable with `BATCAVE_DATA_DIR`.

## Layout

```
index.ts              server bootstrap, stdio transport
src/store.ts          session persistence and stage gating
src/documents.ts      text / pdf / docx extraction
src/schemas.ts        zod schemas for each stage's result
src/stages.ts         the three briefs
src/tools/pipeline.ts start_review and the three chained stage tools
src/tools/support.ts  status, listing, dossier export
```
