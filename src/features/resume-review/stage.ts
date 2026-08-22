/** The three stages of the review, and how a caller advances each one. */

export type StageName = "match_report" | "experience_rewrite" | "ats_pass";

export type StageStatus = "awaiting_result" | "complete";

export const STAGE_ORDER: readonly StageName[] = ["match_report", "experience_rewrite", "ats_pass"];

/** The tool that moves each stage forward, used to write errors a caller can act on. */
export const STAGE_TOOLS: Record<StageName, string> = {
  match_report: "resume_match_report",
  experience_rewrite: "rewrite_experience_xyz",
  ats_pass: "ats_scroll_stopper_pass",
};
