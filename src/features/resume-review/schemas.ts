import { z } from "zod";

export const sessionIdSchema = z
  .string()
  .describe("Session id returned by start_review.");

export const matchReportSchema = z
  .object({
    match_score: z
      .number()
      .min(0)
      .max(100)
      .describe(
        "0-100 against this req only. 90+: near-perfect, fast-track. 75-89: strong, would " +
          "interview. 60-74: borderline, depends on the pile. 40-59: unlikely. <40: reject.",
      ),
    score_rationale: z
      .string()
      .describe("2-3 sentences a recruiter would actually say in a pipeline review."),
    missing_keywords: z
      .array(
        z.object({
          keyword: z.string().describe("Exact term as the job description phrases it."),
          jd_evidence: z.string().describe("Quoted line from the JD that demands it."),
          why_it_matters: z.string(),
          where_to_add: z.string().describe("Which resume bullet or section should carry it."),
        }),
      )
      .length(5)
      .describe("The 5 highest-leverage terms a keyword scan of this resume would miss."),
    red_flags: z
      .array(
        z.object({
          flag: z.string(),
          severity: z.enum(["critical", "moderate", "minor"]),
          what_the_manager_sees: z
            .string()
            .describe("What is visible in a 10-second skim, not what a careful reader infers."),
          fix_direction: z.string(),
        }),
      )
      .length(3)
      .describe("The 3 things a hiring manager spots in under 10 seconds, worst first."),
  })
  .describe("Stage 1 output: recruiter match report.");

export const experienceRewriteSchema = z
  .object({
    rewritten_experience: z
      .string()
      .describe("The rewritten EXPERIENCE section only, as markdown."),
    updated_resume: z
      .string()
      .describe(
        "The complete resume with the rewritten experience section swapped in and every " +
          "other section byte-identical to the original.",
      ),
    bullets: z
      .array(
        z.object({
          original: z.string(),
          rewritten: z.string(),
          x_accomplishment: z.string(),
          y_measure: z.string(),
          z_method: z.string(),
          keywords_used: z.array(z.string()),
        }),
      )
      .min(1)
      .describe("Bullet-by-bullet XYZ breakdown, so each rewrite is auditable against the source."),
    red_flags_addressed: z
      .array(z.object({ flag: z.string(), how_resolved: z.string() }))
      .describe("One entry per stage-1 red flag."),
    keywords_not_addressed: z
      .array(z.object({ keyword: z.string(), reason: z.string() }))
      .describe("Stage-1 keywords the candidate's real experience does not support. Do not force."),
    placeholders_needing_user_input: z
      .array(z.string())
      .describe("Every [QUANTIFY: ...] marker left in the text, so the user knows what to supply."),
  })
  .describe("Stage 2 output: XYZ experience rewrite.");

export const atsPassSchema = z
  .object({
    ats_findings: z
      .array(
        z.object({
          issue: z.string(),
          severity: z.enum(["blocker", "degraded", "cosmetic"]),
          section: z.string(),
          fix: z.string(),
        }),
      )
      .describe("Machine-parse problems: headers, tables, dates, contact block, acronyms."),
    skipped_sections: z
      .array(
        z.object({
          section: z.string(),
          why_skipped: z.string(),
          seven_second_verdict: z.string().describe("What resume #147 of 200 gets in one glance."),
        }),
      )
      .min(1),
    rewritten_sections: z
      .array(
        z.object({
          section: z.string(),
          before: z.string(),
          after: z.string(),
          why_it_stops_the_scroll: z.string(),
        }),
      )
      .min(1),
    final_resume: z.string().describe("The full resume after this pass. Complete, not a diff."),
    final_verdict: z.object({
      ats_pass_likelihood: z.enum(["high", "medium", "low"]),
      would_shortlist: z.boolean(),
      remaining_gaps: z.array(z.string()),
    }),
  })
  .describe("Stage 3 output: ATS filter plus 200-resume hiring manager pass.");

/** Every stage tool answers with the same envelope, in either of its two modes. */
export const stageEnvelopeSchema = z.object({
  session_id: z.string(),
  stage: z.string(),
  mode: z
    .enum(["brief", "recorded"])
    .describe("brief: perform the analysis described. recorded: your result was stored."),
  brief: z.string().optional(),
  next_step: z.string(),
});

export type StageEnvelope = z.infer<typeof stageEnvelopeSchema>;
