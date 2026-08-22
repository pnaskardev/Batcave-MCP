import { schemaFor, sql } from "../../platform/db";
import type { StoredDocument } from "../../platform/stored-document";
import { migrations } from "./migrations";

export type StageName = "match_report" | "experience_rewrite" | "ats_pass";

export const STAGE_ORDER: readonly StageName[] = [
  "match_report",
  "experience_rewrite",
  "ats_pass",
];

/** The tool a caller reaches for to move each stage forward, used to write actionable errors. */
export const STAGE_TOOLS: Record<StageName, string> = {
  match_report: "resume_match_report",
  experience_rewrite: "rewrite_experience_xyz",
  ats_pass: "ats_scroll_stopper_pass",
};

export interface StageRecord {
  status: "awaiting_result" | "complete";
  issued_at: string;
  completed_at?: string;
  result?: Record<string, unknown>;
}

export interface ReviewSession {
  id: string;
  created_at: string;
  updated_at: string;
  company: string;
  role: string;
  resume: StoredDocument;
  job_description: StoredDocument;
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

const ready = schemaFor("resume-review", migrations);

/** Rejects a malformed id before it costs a round trip to the database. */
function assertId(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid session_id "${id}". Expected 4-32 lowercase alphanumerics.`);
  }
  return id;
}

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

function iso(value: string | Date): string {
  return new Date(value).toISOString();
}

export async function createSession(input: {
  company: string;
  role: string;
  resume: StoredDocument;
  jobDescription: StoredDocument;
}): Promise<ReviewSession> {
  await ready();
  const id = newId();
  const [row] = await sql()`
    insert into resume_sessions (id, company, role, resume, job_description)
    values (${id}, ${input.company}, ${input.role}, ${input.resume}, ${input.jobDescription})
    returning created_at, updated_at`;
  return {
    id,
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
    company: input.company,
    role: input.role,
    resume: input.resume,
    job_description: input.jobDescription,
    stages: {},
  };
}

export async function loadSession(id: string): Promise<ReviewSession> {
  await ready();
  assertId(id);
  const db = sql();
  const [[session], stageRows] = await Promise.all([
    db`select * from resume_sessions where id = ${id}`,
    db`select stage, status, issued_at, completed_at, result
       from resume_stages where session_id = ${id}`,
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
      issued_at: iso(row.issued_at),
      ...(row.completed_at ? { completed_at: iso(row.completed_at) } : {}),
      ...(row.result ? { result: row.result } : {}),
    };
  }
  return {
    id: session.id,
    created_at: iso(session.created_at),
    updated_at: iso(session.updated_at),
    company: session.company,
    role: session.role,
    resume: session.resume,
    job_description: session.job_description,
    stages,
  };
}

/** Deliberately does not select the documents — a listing has no use for two full resumes. */
export async function listSessions(limit: number): Promise<SessionSummary[]> {
  await ready();
  const rows = await sql()`
    select s.id, s.company, s.role, s.updated_at,
           count(st.stage) filter (where st.status = 'complete') as stages_complete
    from resume_sessions s
    left join resume_stages st on st.session_id = s.id
    group by s.id
    order by s.updated_at desc
    limit ${limit}`;
  return rows.map((row: Record<string, unknown>) => ({
    id: String(row.id),
    company: String(row.company),
    role: String(row.role),
    updated_at: iso(row.updated_at as string),
    stages_complete: Number(row.stages_complete),
  }));
}

async function touch(id: string): Promise<void> {
  await sql()`update resume_sessions set updated_at = now() where id = ${id}`;
}

export async function markIssued(id: string, stage: StageName): Promise<void> {
  await sql()`
    insert into resume_stages (session_id, stage, status, issued_at)
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
  await sql()`
    insert into resume_stages (session_id, stage, status, issued_at, completed_at, result)
    values (${id}, ${stage}, 'complete', now(), now(), ${result})
    on conflict (session_id, stage) do update
      set status = 'complete', completed_at = now(), result = excluded.result`;
  await touch(id);
}

export async function deleteSession(id: string): Promise<boolean> {
  await ready();
  assertId(id);
  const rows = await sql()`delete from resume_sessions where id = ${id} returning id`;
  return rows.length > 0;
}

export function stageStatus(session: ReviewSession, stage: StageName): string {
  return session.stages[stage]?.status ?? "not_started";
}

/** The stored result of a completed stage, or an error explaining how to complete it. */
export function requireStageResult(
  session: ReviewSession,
  stage: StageName,
): Record<string, unknown> {
  const record = session.stages[stage];
  if (record?.status === "complete" && record.result) {
    return record.result;
  }
  const tool = STAGE_TOOLS[stage];
  throw new Error(
    record?.status === "awaiting_result"
      ? `${tool} has issued its instructions for session ${session.id} but no result was ` +
        `recorded yet. Complete that analysis and call ${tool} again with the result argument.`
      : `Stage "${stage}" has not run for session ${session.id}. Call ${tool} first.`,
  );
}
