/** The stages of the review, and how a caller advances each one. */

export type StageName = "match_report" | "experience_rewrite" | "ats_pass" | "latex_edit";

export type StageStatus = "awaiting_result" | "complete";

/** The three stages every review runs. Each is blocked until the previous one is recorded. */
export const STAGE_ORDER: readonly StageName[] = ["match_report", "experience_rewrite", "ats_pass"];

/**
 * The optional fourth stage. It applies only to a candidate who keeps their resume in LaTeX and
 * wants it touched, and it needs a document the other stages never see — the source file — so it
 * is not part of the chain: the review is finished without it, and nothing tells a caller to run
 * it until the candidate has said yes.
 */
export const LATEX_STAGE: StageName = "latex_edit";

/** The tool that moves each stage forward, used to write errors a caller can act on. */
export const STAGE_TOOLS: Record<StageName, string> = {
  match_report: "resume_match_report",
  experience_rewrite: "rewrite_experience_xyz",
  ats_pass: "ats_scroll_stopper_pass",
  latex_edit: "edit_latex_resume",
};
