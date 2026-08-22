import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadDocument } from "../documents";
import {
  atsPassSchema,
  experienceRewriteSchema,
  matchReportSchema,
  sessionIdSchema,
  stageEnvelopeSchema,
} from "../schemas";
import {
  atsPassInstructions,
  experienceRewriteInstructions,
  matchReportInstructions,
} from "../stages";
import {
  createSession,
  loadSession,
  markComplete,
  markIssued,
  requireStageResult,
  saveSession,
  type Session,
  type StageName,
} from "../store";

interface Envelope {
  session_id: string;
  stage: string;
  mode: "instructions" | "recorded";
  instructions?: string;
  next_step: string;
}

function reply(envelope: Envelope, text: string) {
  return { content: [{ type: "text" as const, text }], structuredContent: envelope };
}

/**
 * The two-mode body every pipeline tool shares: called without `result` it issues the stage
 * instructions, called with one it records the answer so the next stage can read it.
 */
async function runStage(args: {
  session_id: string;
  stage: StageName;
  result?: Record<string, unknown>;
  instructions: (session: Session) => string;
  onRecorded: (session: Session, result: Record<string, unknown>) => string;
}) {
  const session = await loadSession(args.session_id);

  if (args.result) {
    markComplete(session, args.stage, args.result);
    await saveSession(session);
    const next = args.onRecorded(session, args.result);
    const envelope: Envelope = {
      session_id: session.id,
      stage: args.stage,
      mode: "recorded",
      next_step: next,
    };
    return reply(envelope, `Recorded stage "${args.stage}" for session ${session.id}.\n\n${next}`);
  }

  const instructions = args.instructions(session);
  markIssued(session, args.stage);
  await saveSession(session);
  const envelope: Envelope = {
    session_id: session.id,
    stage: args.stage,
    mode: "instructions",
    instructions,
    next_step:
      `Perform the analysis above, then call this same tool again with session_id ` +
      `"${session.id}" and the result argument.`,
  };
  return reply(envelope, instructions);
}

export function registerPipeline(server: McpServer): void {
  server.registerTool(
    "start_review",
    {
      title: "Start resume review",
      description:
        "Intake for the review pipeline. Takes the two documents — a resume and a job " +
        "description, each as raw text or a path to a .pdf/.docx/.txt/.md file — extracts " +
        "their text and opens a session. Returns the session_id that resume_match_report, " +
        "rewrite_experience_xyz, and ats_scroll_stopper_pass all run against. Pass company " +
        "and role from the job description when they are stated in it.",
      inputSchema: z.object({
        resume_text: z.string().optional().describe("Resume as raw text."),
        resume_path: z.string().optional().describe("Path to a .pdf/.docx/.txt/.md resume."),
        job_description_text: z.string().optional().describe("Job description as raw text."),
        job_description_path: z.string().optional().describe("Path to a job description file."),
        company: z.string().optional().describe("Hiring company, as named in the posting."),
        role: z.string().optional().describe("Role title, as named in the posting."),
      }),
      outputSchema: z.object({
        session_id: z.string(),
        company: z.string(),
        role: z.string(),
        resume: z.object({ source: z.string(), format: z.string(), words: z.number() }),
        job_description: z.object({ source: z.string(), format: z.string(), words: z.number() }),
        next_step: z.string(),
      }),
    },
    async (args) => {
      const [resume, jobDescription] = await Promise.all([
        loadDocument("resume", { text: args.resume_text, path: args.resume_path }),
        loadDocument("job_description", {
          text: args.job_description_text,
          path: args.job_description_path,
        }),
      ]);
      const session = await saveSession(
        createSession({
          company: args.company?.trim() || "the hiring company",
          role: args.role?.trim() || "the advertised role",
          resume,
          jobDescription,
        }),
      );
      const output = {
        session_id: session.id,
        company: session.company,
        role: session.role,
        resume: { source: resume.source, format: resume.format, words: resume.words },
        job_description: {
          source: jobDescription.source,
          format: jobDescription.format,
          words: jobDescription.words,
        },
        next_step: `Call resume_match_report with session_id "${session.id}".`,
      };
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Session ${session.id} open for ${session.role} @ ${session.company}.\n` +
              `Resume: ${resume.words} words from ${resume.source}\n` +
              `Job description: ${jobDescription.words} words from ${jobDescription.source}\n\n` +
              output.next_step,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "resume_match_report",
    {
      title: "Stage 1 — recruiter match report",
      description:
        "Step 1 of 3. Acts as a senior recruiter at the target company: scores the resume " +
        "against the job description out of 100, names the top 5 missing keywords, and the " +
        "3 red flags a hiring manager spots in under 10 seconds. Call it with session_id " +
        "alone to get the analysis brief, then call it again with the result to record it. " +
        "Stages 2 and 3 are blocked until the result is recorded.",
      inputSchema: z.object({
        session_id: sessionIdSchema,
        result: matchReportSchema
          .optional()
          .describe("Your stage 1 analysis. Omit on the first call."),
      }),
      outputSchema: stageEnvelopeSchema,
    },
    async (args) =>
      runStage({
        session_id: args.session_id,
        stage: "match_report",
        result: args.result,
        instructions: matchReportInstructions,
        onRecorded: (session, result) =>
          `Match score ${result.match_score}/100. Next: call rewrite_experience_xyz with ` +
          `session_id "${session.id}" to fix the keywords and red flags.`,
      }),
  );

  server.registerTool(
    "rewrite_experience_xyz",
    {
      title: "Stage 2 — XYZ experience rewrite",
      description:
        "Step 2 of 3, requires a recorded stage 1. Rewrites the experience section to carry " +
        "stage 1's missing keywords and remove its red flags, with every bullet in the " +
        "Google XYZ form: accomplished X as measured by Y by doing Z. Never invents metrics — " +
        "unknown numbers become [QUANTIFY: ...] placeholders. Call with session_id alone for " +
        "the brief, then again with the result to record it.",
      inputSchema: z.object({
        session_id: sessionIdSchema,
        result: experienceRewriteSchema
          .optional()
          .describe("Your stage 2 rewrite. Omit on the first call."),
      }),
      outputSchema: stageEnvelopeSchema,
    },
    async (args) =>
      runStage({
        session_id: args.session_id,
        stage: "experience_rewrite",
        result: args.result,
        instructions: (session) =>
          experienceRewriteInstructions(session, requireStageResult(session, "match_report")),
        onRecorded: (session, result) => {
          const pending = (result.placeholders_needing_user_input as string[] | undefined) ?? [];
          const note = pending.length
            ? ` ${pending.length} [QUANTIFY: ...] placeholder(s) still need real numbers from ` +
              `the candidate.`
            : "";
          return (
            `Experience section rewritten.${note} Next: call ats_scroll_stopper_pass with ` +
            `session_id "${session.id}".`
          );
        },
      }),
  );

  server.registerTool(
    "ats_scroll_stopper_pass",
    {
      title: "Stage 3 — ATS filter + hiring manager scan",
      description:
        "Step 3 of 3, requires a recorded stage 2. Runs the stage-2 resume through an ATS " +
        "parser pass and a hiring manager reading 200 resumes in one sitting: which sections " +
        "get skipped and why, then rewrites them to stop the scroll. Returns the final " +
        "resume. Call with session_id alone for the brief, then again with the result.",
      inputSchema: z.object({
        session_id: sessionIdSchema,
        result: atsPassSchema.optional().describe("Your stage 3 analysis. Omit on the first call."),
      }),
      outputSchema: stageEnvelopeSchema,
    },
    async (args) =>
      runStage({
        session_id: args.session_id,
        stage: "ats_pass",
        result: args.result,
        instructions: (session) => {
          const rewrite = requireStageResult(session, "experience_rewrite");
          const matchReport = requireStageResult(session, "match_report");
          return atsPassInstructions(session, rewrite.updated_resume as string, matchReport);
        },
        onRecorded: (session) =>
          `Pipeline complete for session ${session.id}. Call export_dossier to write the ` +
          `full report and final resume to a file.`,
      }),
  );
}
