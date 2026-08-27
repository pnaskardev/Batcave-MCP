import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../platform/db";
import type { StoredDocument } from "../../platform/stored-document";
import { resumeSessions, resumeStages } from "./schema";
import { LATEX_STAGE, STAGE_TOOLS, type StageName, type StageStatus } from "./stage";

export interface StageRecord {
  status: StageStatus;
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
  /** Present only once the candidate has handed over a source file for the LaTeX stage. */
  latex_source?: StoredDocument;
  stages: Partial<Record<StageName, StageRecord>>;
}

export interface SessionSummary {
  id: string;
  company: string;
  role: string;
  updated_at: string;
  stages_complete: number;
  latex_edited: boolean;
}

const ID_PATTERN = /^[a-z0-9]{4,32}$/;

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

export async function createSession(input: {
  company: string;
  role: string;
  resume: StoredDocument;
  jobDescription: StoredDocument;
}): Promise<ReviewSession> {
  const [row] = await db()
    .insert(resumeSessions)
    .values({
      id: newId(),
      company: input.company,
      role: input.role,
      resume: input.resume,
      jobDescription: input.jobDescription,
    })
    .returning();
  if (!row) throw new Error("The database accepted the session but returned no row.");
  return {
    id: row.id,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
    company: row.company,
    role: row.role,
    resume: row.resume,
    job_description: row.jobDescription,
    stages: {},
  };
}

export async function loadSession(id: string): Promise<ReviewSession> {
  assertId(id);
  const [sessionRows, stageRows] = await Promise.all([
    db().select().from(resumeSessions).where(eq(resumeSessions.id, id)),
    db().select().from(resumeStages).where(eq(resumeStages.sessionId, id)),
  ]);

  const session = sessionRows[0];
  if (!session) {
    throw new Error(
      `No session "${id}". Run list_sessions to see open sessions, or open a new one with ` +
        `start_review (resume + job description).`,
    );
  }

  const stages: Partial<Record<StageName, StageRecord>> = {};
  for (const row of stageRows) {
    stages[row.stage] = {
      status: row.status,
      issued_at: row.issuedAt.toISOString(),
      ...(row.completedAt ? { completed_at: row.completedAt.toISOString() } : {}),
      ...(row.result ? { result: row.result } : {}),
    };
  }

  return {
    id: session.id,
    created_at: session.createdAt.toISOString(),
    updated_at: session.updatedAt.toISOString(),
    company: session.company,
    role: session.role,
    resume: session.resume,
    job_description: session.jobDescription,
    ...(session.latexSource ? { latex_source: session.latexSource } : {}),
    stages,
  };
}

/** Attaches the candidate's LaTeX source to an existing session, replacing any earlier one. */
export async function saveLatexSource(id: string, latex: StoredDocument): Promise<void> {
  assertId(id);
  await db()
    .update(resumeSessions)
    .set({ latexSource: latex, updatedAt: new Date() })
    .where(eq(resumeSessions.id, id));
}

/** Deliberately does not select the documents — a listing has no use for two full resumes. */
export async function listSessions(limit: number): Promise<SessionSummary[]> {
  const rows = await db()
    .select({
      id: resumeSessions.id,
      company: resumeSessions.company,
      role: resumeSessions.role,
      updatedAt: resumeSessions.updatedAt,
      // Counts the required chain only, so the figure stays out of three however many optional
      // stages exist. The LaTeX stage is reported on its own rather than inflating the count.
      stagesComplete: sql<number>`
        count(${resumeStages.stage}) filter (
          where ${resumeStages.status} = 'complete' and ${resumeStages.stage} <> ${LATEX_STAGE}
        )
      `.mapWith(Number),
      latexEdited: sql<boolean>`
        coalesce(bool_or(
          ${resumeStages.status} = 'complete' and ${resumeStages.stage} = ${LATEX_STAGE}
        ), false)
      `.mapWith(Boolean),
    })
    .from(resumeSessions)
    .leftJoin(resumeStages, eq(resumeStages.sessionId, resumeSessions.id))
    .groupBy(resumeSessions.id)
    .orderBy(desc(resumeSessions.updatedAt))
    .limit(limit);

  return rows.map((row) => ({
    id: row.id,
    company: row.company,
    role: row.role,
    updated_at: row.updatedAt.toISOString(),
    stages_complete: row.stagesComplete,
    latex_edited: row.latexEdited,
  }));
}

async function touch(id: string): Promise<void> {
  await db().update(resumeSessions).set({ updatedAt: new Date() }).where(eq(resumeSessions.id, id));
}

export async function markIssued(id: string, stage: StageName): Promise<void> {
  const issuedAt = new Date();
  await db()
    .insert(resumeStages)
    .values({ sessionId: id, stage, status: "awaiting_result", issuedAt })
    .onConflictDoUpdate({
      target: [resumeStages.sessionId, resumeStages.stage],
      set: { status: "awaiting_result", issuedAt, completedAt: null, result: null },
    });
  await touch(id);
}

export async function markComplete(
  id: string,
  stage: StageName,
  result: Record<string, unknown>,
): Promise<void> {
  const now = new Date();
  await db()
    .insert(resumeStages)
    .values({ sessionId: id, stage, status: "complete", issuedAt: now, completedAt: now, result })
    .onConflictDoUpdate({
      target: [resumeStages.sessionId, resumeStages.stage],
      set: { status: "complete", completedAt: now, result },
    });
  await touch(id);
}

export async function deleteSession(id: string): Promise<boolean> {
  assertId(id);
  const deleted = await db()
    .delete(resumeSessions)
    .where(eq(resumeSessions.id, id))
    .returning({ id: resumeSessions.id });
  return deleted.length > 0;
}

export function stageStatus(session: ReviewSession, stage: StageName): string {
  return session.stages[stage]?.status ?? "not_started";
}

/**
 * The LaTeX source held for a session, or an error saying how to supply it.
 *
 * This is the whole of the opt-in. The stage cannot invent a source file, so a candidate who does
 * not keep their resume in LaTeX, or does not want it touched, simply never produces one and the
 * stage never runs. The message says that out loud so a caller does not go looking for a file.
 */
export function requireLatexSource(session: ReviewSession): StoredDocument {
  const source = session.latex_source;
  if (source) return source;
  throw new Error(
    `No LaTeX source held for session ${session.id}. Ask the candidate for the .tex file they ` +
      `compile and pass it as latex_text or latex_path. If they do not keep their resume in ` +
      `LaTeX, or do not want it edited, skip this stage — the review is complete without it. ` +
      `Call export_dossier instead.`,
  );
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
