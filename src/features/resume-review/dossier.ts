import type { z } from "zod";
import type { atsPassSchema, experienceRewriteSchema, matchReportSchema } from "./schemas";
import type { ReviewSession } from "./sessions";

type MatchReport = z.infer<typeof matchReportSchema>;
type ExperienceRewrite = z.infer<typeof experienceRewriteSchema>;
type AtsPass = z.infer<typeof atsPassSchema>;

function renderMatchReport(report: MatchReport): string {
  const keywords = report.missing_keywords
    .map((k, i) => `${i + 1}. **${k.keyword}** — ${k.why_it_matters} (add to: ${k.where_to_add})`)
    .join("\n");
  const flags = report.red_flags
    .map(
      (f) =>
        `- **${f.flag}** (${f.severity}) — ${f.what_the_manager_sees}\n` +
        `  Fix: ${f.fix_direction}`,
    )
    .join("\n");
  return [
    `## Stage 1 — Match report`,
    "",
    `**Score: ${report.match_score}/100.** ${report.score_rationale}`,
    "",
    "### Top 5 missing keywords",
    keywords,
    "",
    "### Red flags in the first 10 seconds",
    flags,
  ].join("\n");
}

function renderRewrite(rewrite: ExperienceRewrite): string {
  const skipped = rewrite.keywords_not_addressed
    .map((k) => `- ${k.keyword} — ${k.reason}`)
    .join("\n");
  const pending = rewrite.placeholders_needing_user_input.map((p) => `- ${p}`).join("\n");
  return [
    "## Stage 2 — Experience rewrite (XYZ)",
    "",
    rewrite.rewritten_experience,
    "",
    "### Red flags addressed",
    rewrite.red_flags_addressed.map((r) => `- **${r.flag}** — ${r.how_resolved}`).join("\n"),
    ...(skipped ? ["", "### Keywords deliberately not forced in", skipped] : []),
    ...(pending ? ["", "### Numbers you still need to supply", pending] : []),
  ].join("\n");
}

function renderAtsPass(pass: AtsPass): string {
  const findings = pass.ats_findings
    .map((f) => `- [${f.severity}] ${f.section}: ${f.issue}\n  Fix: ${f.fix}`)
    .join("\n");
  const skipped = pass.skipped_sections
    .map(
      (s) =>
        `- **${s.section}** — ${s.why_skipped}\n` +
        `  Seven-second verdict: ${s.seven_second_verdict}`,
    )
    .join("\n");
  const verdict = pass.final_verdict;
  return [
    "## Stage 3 — ATS filter + hiring manager scan",
    "",
    "### ATS parse findings",
    findings || "_None._",
    "",
    "### Sections that get skipped",
    skipped,
    "",
    `**Verdict:** ATS pass likelihood ${verdict.ats_pass_likelihood}; ` +
      `would shortlist: ${verdict.would_shortlist ? "yes" : "no"}.`,
    ...(verdict.remaining_gaps.length
      ? ["", "Remaining gaps:", verdict.remaining_gaps.map((g) => `- ${g}`).join("\n")]
      : []),
    "",
    "## Final resume",
    "",
    pass.final_resume,
  ].join("\n");
}

export function renderDossier(session: ReviewSession): string {
  const parts = [
    `# Resume review — ${session.role} @ ${session.company}`,
    "",
    `Session \`${session.id}\` · opened ${session.created_at} · updated ${session.updated_at}`,
    `Resume: ${session.resume.source} · Job description: ${session.job_description.source}`,
  ];
  const report = session.stages.match_report?.result as MatchReport | undefined;
  const rewrite = session.stages.experience_rewrite?.result as ExperienceRewrite | undefined;
  const pass = session.stages.ats_pass?.result as AtsPass | undefined;
  if (report) parts.push("", renderMatchReport(report));
  if (rewrite) parts.push("", renderRewrite(rewrite));
  if (pass) parts.push("", renderAtsPass(pass));
  if (!report && !rewrite && !pass) {
    parts.push("", "_No stage has been completed yet._");
  }
  return parts.join("\n");
}
