import { mkdir, readdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

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

const ID_PATTERN = /^[a-z0-9]{4,32}$/;

function dataDir(): string {
  return process.env.BATCAVE_DATA_DIR ?? join(homedir(), ".batcave", "sessions");
}

function sessionPath(id: string): string {
  if (!ID_PATTERN.test(id)) {
    throw new Error(`Invalid session_id "${id}". Expected 4-32 lowercase alphanumerics.`);
  }
  return join(dataDir(), `${id}.json`);
}

function newId(): string {
  return crypto.randomUUID().replaceAll("-", "").slice(0, 10);
}

export function createSession(input: {
  company: string;
  role: string;
  resume: DocumentRecord;
  jobDescription: DocumentRecord;
}): Session {
  const now = new Date().toISOString();
  return {
    id: newId(),
    created_at: now,
    updated_at: now,
    company: input.company,
    role: input.role,
    resume: input.resume,
    job_description: input.jobDescription,
    stages: {},
  };
}

export async function saveSession(session: Session): Promise<Session> {
  session.updated_at = new Date().toISOString();
  // Sessions hold full resumes — phone numbers, addresses. Owner-only, not the 0644 default.
  await mkdir(dataDir(), { recursive: true, mode: 0o700 });
  await writeFile(sessionPath(session.id), JSON.stringify(session, null, 2), { mode: 0o600 });
  return session;
}

export async function loadSession(id: string): Promise<Session> {
  const file = Bun.file(sessionPath(id));
  if (!(await file.exists())) {
    throw new Error(
      `No session "${id}". Run list_sessions to see open sessions, or open a new one with ` +
        `start_review (resume + job description).`,
    );
  }
  return (await file.json()) as Session;
}

export async function listSessions(): Promise<Session[]> {
  let names: string[];
  try {
    names = await readdir(dataDir());
  } catch {
    return [];
  }
  const sessions = await Promise.all(
    names
      .filter((name) => name.endsWith(".json"))
      .map((name) => Bun.file(join(dataDir(), name)).json() as Promise<Session>),
  );
  return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
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

export function markIssued(session: Session, stage: StageName): void {
  session.stages[stage] = { status: "awaiting_result", issued_at: new Date().toISOString() };
}

export function markComplete(
  session: Session,
  stage: StageName,
  result: Record<string, unknown>,
): void {
  const issued_at = session.stages[stage]?.issued_at ?? new Date().toISOString();
  session.stages[stage] = {
    status: "complete",
    issued_at,
    completed_at: new Date().toISOString(),
    result,
  };
}
