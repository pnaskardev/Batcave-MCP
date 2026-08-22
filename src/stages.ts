import { STAGE_TOOLS, type Session, type StageName } from "./store";

function returnBlock(session: Session, stage: StageName): string {
  const tool = STAGE_TOOLS[stage];
  return [
    "## How to return your answer",
    `Call \`${tool}\` again with \`session_id: "${session.id}"\` and the \`result\` argument`,
    "filled in against this tool's schema. Fill every field.",
    "",
    "Do not answer in chat instead of calling the tool — the next stage reads the recorded",
    "result, and it cannot start until this one is stored.",
  ].join("\n");
}

function fence(label: string, body: string): string {
  return `## ${label}\n\n\`\`\`\n${body}\n\`\`\``;
}

export function matchReportInstructions(session: Session): string {
  return [
    `# Stage 1 — Recruiter match report (${session.role} @ ${session.company})`,
    "",
    `Act as a senior in-house recruiter at ${session.company}, screening for this exact req.`,
    "You have already pushed dozens of candidates through this pipeline and you know which",
    "ones the hiring manager rejects. You are not a career coach. You are the person who",
    "decides whether this resume moves forward.",
    "",
    "Analyse the resume against the job description and produce:",
    "",
    "1. **match_score** — out of 100, calibrated against this req only, not against resumes",
    "   in general. Use the anchors in the schema. A generically strong resume for the wrong",
    "   req scores low.",
    "2. **missing_keywords** — the 5 highest-leverage terms the JD demands that a keyword scan",
    "   of this resume would not hit. A term counts as missing if the resume never uses the",
    "   JD's own phrasing, even when the underlying experience is arguably there. Quote the JD",
    "   line that demands each one.",
    "3. **red_flags** — the 3 things a hiring manager spots in under 10 seconds. Ten seconds",
    "   means shape, not substance: employment gaps, job-hopping, title or level mismatch,",
    "   zero metrics, walls of text, stack mismatch, seniority inflation, a summary that says",
    "   nothing. If something only surfaces on a careful read, it is not a 10-second flag.",
    "   Rank worst first and set severity honestly — do not inflate a minor flag to fill the",
    "   slot.",
    "",
    "## Rules",
    "",
    "- Judge only what is on the page. Never invent employers, dates, tools, or numbers.",
    "- Cite the resume or the JD for every claim you make about them.",
    "- Be blunt. A polite score the candidate cannot act on is a wasted screen.",
    "",
    fence("Job description", session.job_description.text),
    "",
    fence("Resume", session.resume.text),
    "",
    returnBlock(session, "match_report"),
  ].join("\n");
}

export function experienceRewriteInstructions(
  session: Session,
  matchReport: Record<string, unknown>,
): string {
  return [
    `# Stage 2 — Rewrite the experience section (${session.role} @ ${session.company})`,
    "",
    "Rewrite the candidate's EXPERIENCE section so it naturally carries the missing keywords",
    "from stage 1 and removes the red flags. Every bullet uses the Google XYZ formula:",
    "",
    "> Accomplished **X** as measured by **Y** by doing **Z**.",
    "",
    "## Rules",
    "",
    "- Every bullet needs all three parts. Lead with the accomplishment, not the task. A",
    "  bullet that describes responsibilities instead of outcomes has failed.",
    "- **Never fabricate a number.** If the source resume does not contain a metric, write",
    "  `[QUANTIFY: what to measure]` in place of Y and list it in",
    "  `placeholders_needing_user_input`. An invented metric gets the candidate caught in the",
    "  interview, which is worse than a blank.",
    "- Place a keyword only where the candidate's actual experience supports it. Keywords you",
    "  cannot place honestly go in `keywords_not_addressed` with the reason. Stuffing is the",
    "  failure mode this stage exists to avoid.",
    "- Address each red flag structurally — reframe scope, merge or group short stints, cut",
    "  the wall of text, surface the level. Do not paper over a gap by moving dates.",
    "- Company names, titles, and dates stay exactly as written in the original.",
    "- Keep bullets to one or two lines each; front-load the verb and the outcome.",
    "- `updated_resume` must be the whole resume: rewritten experience in place, every other",
    "  section reproduced unchanged.",
    "",
    fence("Stage 1 match report", JSON.stringify(matchReport, null, 2)),
    "",
    fence("Job description", session.job_description.text),
    "",
    fence("Original resume", session.resume.text),
    "",
    returnBlock(session, "experience_rewrite"),
  ].join("\n");
}

export function atsPassInstructions(
  session: Session,
  currentResume: string,
  matchReport: Record<string, unknown>,
): string {
  return [
    `# Stage 3 — ATS filter + 200-resume hiring manager pass (${session.company})`,
    "",
    "Run two passes over the resume below, in order.",
    "",
    "**Pass A — ATS parser.** You are a literal parsing machine, not a reader. You do not",
    "infer. Flag anything that breaks extraction or scoring: nonstandard section headers,",
    "multi-column layouts, tables, text in graphics or headers/footers, inconsistent date",
    "formats, a contact block the parser cannot key on, acronyms used without their expansion",
    "(or the reverse), skills that exist only in a graphic, and required JD terms still absent",
    "after stage 2.",
    "",
    "**Pass B — Hiring manager, resume #147 of 200, seven seconds.** You are tired and you are",
    "looking for a reason to stop. Go section by section and say which ones you skip and why.",
    "Skipping is the default: a section earns attention or it does not get it. Be specific —",
    '"generic summary" is a finding, "could be stronger" is not.',
    "",
    "Then rewrite every skipped section so it stops the scroll: concrete outcome or number in",
    "the first line, no throat-clearing, no adjective stacks, scannable in one glance. Same",
    "honesty rule as stage 2 — no invented metrics, use `[QUANTIFY: ...]` where the number is",
    "unknown.",
    "",
    "`final_resume` is the complete resume after your rewrites, not a diff and not an excerpt.",
    "",
    fence("Stage 1 red flags and missing keywords", JSON.stringify(matchReport, null, 2)),
    "",
    fence("Job description", session.job_description.text),
    "",
    fence("Current resume (post stage-2 rewrite)", currentResume),
    "",
    returnBlock(session, "ats_pass"),
  ].join("\n");
}
