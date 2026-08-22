import { SQL } from "bun";

export type StageName = "match_report" | "experience_rewrite" | "ats_pass";

export const STAGE_ORDER: StageName[] = ["match_report", "experience_rewrite", "ats_pass"];

export const STAGE_TOOLS: Record<StageName, string> = {
  match_report: "resume_match_report",
  experience_rewrite: "rewrite_experience_xyz",
  ats_pass: "ats_scroll_stopper_pass",
};

export interface DocumentRecord {
  text: string;
  source: string;
  format: string;
  chars: number;
  words: number;
}

export interface StageRecord {
  status: "awaiting_result" | "complete";
  issued_at: string;
  completed_at?: string;
  result?: Record<string, unknown>;
}

export interface Session {
  id: string;
  created_at: string;
  updated_at: string;
  company: string;
  role: string;
  resume: DocumentRecord;
  job_description: DocumentRecord;
  stages: Partial<Record<StageName, StageRecord>>;
}

export interface SessionSummary {
  id: string;
  company: string;
  role: string;
  updated_at: string;
  stages_complete: number;
}

const ID_PATTERN = /^[a-z0-9]{4,32}$/;

let client: SQL | undefined;
let schemaReady: Promise<void> | undefined;

function db(): SQL {
  if (!client) {
    const url = process.env.DB_URL ?? process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DB_URL is not set. Point it at your Postgres instance, e.g. " +
          "postgres://user:pass@host/db?sslmode=require",
      );
    }
    client = new SQL(url);
  }
  return client;
}

/** Runs once per process. Cheap on Neon: three IF NOT EXISTS statements in one round trip. */
export function ensureSchema(): Promise<void> {
  schemaReady ??= db()
    .unsafe(
      `create table if not exists sessions (
         id text primary key,
         created_at timestamptz not null default now(),
         updated_at timestamptz not null default now(),
         company text not null,
         role text not null,
         resume jsonb not null,
         job_description jsonb not null
       );
       create table if not exists stages (
         session_id text not null references sessions(id) on delete cascade,
         stage text not null,
         status text not null,
         issued_at timestamptz not null,
         completed_at timestamptz,
         result jsonb,
         primary key (session_id, stage)
       );
       create index if not exists sessions_updated_at_idx on sessions (updated_at desc);`,
    )
    .then(() => undefined);
  return schemaReady;
}

/** Rejects malformed ids before they cost a round trip to the database. */
function assertId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid session_id "${id}". Expected 4-32 lowercase alphanumerics.`);
  }
  return id;
}

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

export async function createSession(input: {
  company: string;
  role: string;
  resume: DocumentRecord;
  jobDescription: DocumentRecord;
}): Promise<Session> {
  await ensureSchema();
  const id = newId();
  const [row] = await db()`
    insert into sessions (id, company, role, resume, job_description)
    values (${id}, ${input.company}, ${input.role},
            ${input.resume}, ${input.jobDescription})
    returning created_at, updated_at`;
  return {
    id,
    created_at: new Date(row.created_at).toISOString(),
    updated_at: new Date(row.updated_at).toISOString(),
    company: input.company,
    role: input.role,
    resume: input.resume,
    job_description: input.jobDescription,
    stages: {},
  };
}

export async function loadSession(id: string): Promise<Session> {
  await ensureSchema();
  assertId(id);
  const sql = db();
  const [[session], stageRows] = await Promise.all([
    sql`select * from sessions where id = ${id}`,
    sql`select stage, status, issued_at, completed_at, result
        from stages where session_id = ${id}`,
  ]);
  if (!session) {
    throw new Error(
      `No session "${id}". Run list_sessions to see open sessions, or open a new one with ` +
        `start_review (resume + job description).`,
    );
  }
  const stages: Partial<Record<StageName, StageRecord>> = {};
  for (const row of stageRows) {
    stages[row.stage as StageName] = {
      status: row.status,
      issued_at: new Date(row.issued_at).toISOString(),
      ...(row.completed_at ? { completed_at: new Date(row.completed_at).toISOString() } : {}),
      ...(row.result ? { result: row.result } : {}),
    };
  }
  return {
    id: session.id,
    created_at: new Date(session.created_at).toISOString(),
    updated_at: new Date(session.updated_at).toISOString(),
    company: session.company,
    role: session.role,
    resume: session.resume,
    job_description: session.job_description,
    stages,
  };
}

/** Deliberately does not select the documents — a listing has no use for two full resumes. */
export async function listSessions(limit: number): Promise<SessionSummary[]> {
  await ensureSchema();
  const rows = await db()`
    select s.id, s.company, s.role, s.updated_at,
           count(st.stage) filter (where st.status = 'complete') as stages_complete
    from sessions s
    left join stages st on st.session_id = s.id
    group by s.id
    order by s.updated_at desc
    limit ${limit}`;
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    company: String(row.company),
    role: String(row.role),
    updated_at: new Date(row.updated_at as string).toISOString(),
    stages_complete: Number(row.stages_complete),
  }));
}

async function touch(id: string): Promise<void> {
  await db()`update sessions set updated_at = now() where id = ${id}`;
}

export async function markIssued(id: string, stage: StageName): Promise<void> {
  await db()`
    insert into stages (session_id, stage, status, issued_at)
    values (${id}, ${stage}, 'awaiting_result', now())
    on conflict (session_id, stage) do update
      set status = 'awaiting_result', issued_at = now(), completed_at = null, result = null`;
  await touch(id);
}

export async function markComplete(
  id: string,
  stage: StageName,
  result: Record<string, unknown>,
): Promise<void> {
  await db()`
    insert into stages (session_id, stage, status, issued_at, completed_at, result)
    values (${id}, ${stage}, 'complete', now(), now(), ${result})
    on conflict (session_id, stage) do update
      set status = 'complete', completed_at = now(), result = excluded.result`;
  await touch(id);
}

export async function deleteSession(id: string): Promise<boolean> {
  await ensureSchema();
  assertId(id);
  const rows = await db()`delete from sessions where id = ${id} returning id`;
  return rows.length > 0;
}

/** The stored result of a completed stage, or an error explaining how to complete it. */
export function requireStageResult(session: Session, stage: StageName): Record<string, unknown> {
  const record = session.stages[stage];
  if (record?.status === "complete" && record.result) {
    return record.result;
  }
  const tool = STAGE_TOOLS[stage];
  const detail =
    record?.status === "awaiting_result"
      ? `${tool} has issued its instructions for session ${session.id} but no result was ` +
        `recorded yet. Complete that analysis and call ${tool} again with the result argument.`
      : `Stage "${stage}" has not run for session ${session.id}. Call ${tool} first.`;
  throw new Error(detail);
}
