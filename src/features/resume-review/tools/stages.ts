import type { McpServer } from "@modelcontextprotocol/server";
import { atsPassBrief, experienceRewriteBrief, matchReportBrief } from "../briefs";
import { atsPassSchema, experienceRewriteSchema, matchReportSchema } from "../schemas";
import { requireStageResult } from "../sessions";
import { registerStage } from "../stage-tool";

export function registerStageTools(server: McpServer): void {
  registerStage(server, {
    stage: "match_report",
    tool: "resume_match_report",
    title: "Stage 1 — recruiter match report",
    description:
      "Step 1 of 3. Acts as a senior recruiter at the target company: scores the resume " +
      "against the job description out of 100, names the top 5 missing keywords, and the 3 " +
      "red flags a hiring manager spots in under 10 seconds. Call it with session_id alone " +
      "to get the brief, then again with the result to record it. Stages 2 and 3 stay " +
      "blocked until it is recorded.",
    resultSchema: matchReportSchema,
    brief: matchReportBrief,
    nextStep: (session, result) =>
      `Match score ${result.match_score}/100. Next: call rewrite_experience_xyz with ` +
      `session_id "${session.id}" to fix the keywords and red flags.`,
  });

  registerStage(server, {
    stage: "experience_rewrite",
    tool: "rewrite_experience_xyz",
    title: "Stage 2 — XYZ experience rewrite",
    description:
      "Step 2 of 3, requires a recorded stage 1. Rewrites the experience section to carry " +
      "stage 1's missing keywords and remove its red flags, with every bullet in the Google " +
      "XYZ form: accomplished X as measured by Y by doing Z. Never invents metrics — unknown " +
      "numbers become [QUANTIFY: ...] placeholders.",
    resultSchema: experienceRewriteSchema,
    brief: (session) =>
      experienceRewriteBrief(session, requireStageResult(session, "match_report")),
    nextStep: (session, result) => {
      const pending = result.placeholders_needing_user_input.length;
      const note = pending
        ? ` ${pending} [QUANTIFY: ...] placeholder(s) still need real numbers from the candidate.`
        : "";
      return (
        `Experience section rewritten.${note} Next: call ats_scroll_stopper_pass with ` +
        `session_id "${session.id}".`
      );
    },
  });

  registerStage(server, {
    stage: "ats_pass",
    tool: "ats_scroll_stopper_pass",
    title: "Stage 3 — ATS filter + hiring manager scan",
    description:
      "Step 3 of 3, requires a recorded stage 2. Runs the stage-2 resume through an ATS " +
      "parser pass and a hiring manager reading 200 resumes in one sitting: which sections " +
      "get skipped and why, then rewrites them to stop the scroll. Returns the final resume.",
    resultSchema: atsPassSchema,
    brief: (session) => {
      const rewrite = requireStageResult(session, "experience_rewrite");
      const matchReport = requireStageResult(session, "match_report");
      return atsPassBrief(session, rewrite.updated_resume as string, matchReport);
    },
    nextStep: (session) =>
      `Pipeline complete for session ${session.id}. Now ask the candidate: is your resume in ` +
      `LaTeX, and do you want the .tex source edited to match? If yes, call ` +
      `edit_latex_resume with session_id "${session.id}" and their .tex file. If no, the ` +
      `review is finished — call export_dossier for the full report and the final resume.`,
  });
}
