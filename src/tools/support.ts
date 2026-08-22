import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { atsPassSchema, experienceRewriteSchema, matchReportSchema } from "../schemas";
import { sessionIdSchema } from "../schemas";
import {
  deleteSession,
  listSessions,
  loadSession,
  STAGE_ORDER,
  STAGE_TOOLS,
  type Session,
  type StageName,
} from "../store";

type MatchReport = z.infer<typeof matchReportSchema>;
type ExperienceRewrite = z.infer<typeof experienceRewriteSchema>;
type AtsPass = z.infer<typeof atsPassSchema>;

function stageStatus(session: Session, stage: StageName): string {
  return session.stages[stage]?.status ?? "not_started";
}

function nextStep(session: Session): string {
  for (const stage of STAGE_ORDER) {
    const status = stageStatus(session, stage);
    if (status === "not_started") {
      return `Call ${STAGE_TOOLS[stage]} with session_id "${session.id}".`;
    }
    if (status === "awaiting_result") {
      return `${STAGE_TOOLS[stage]} is waiting on its result — call it again with the result.`;
    }
  }
  return `All three stages complete. Call export_dossier with session_id "${session.id}".`;
}

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

function renderDossier(session: Session): string {
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

export function registerSupport(server: McpServer): void {
  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Shows where a review session stands: the documents it holds, which of the three " +
        "stages are done, awaiting a result, or not started, and what to call next.",
      inputSchema: z.object({ session_id: sessionIdSchema }),
      outputSchema: z.object({
        session_id: z.string(),
        company: z.string(),
        role: z.string(),
        stages: z.record(z.string(), z.string()),
        next_step: z.string(),
      }),
    },
    async ({ session_id }) => {
      const session = await loadSession(session_id);
      const stages = Object.fromEntries(
        STAGE_ORDER.map((stage) => [stage, stageStatus(session, stage)]),
      );
      const output = {
        session_id: session.id,
        company: session.company,
        role: session.role,
        stages,
        next_step: nextStep(session),
      };
      const lines = STAGE_ORDER.map((s) => `- ${s}: ${stages[s]}`).join("\n");
      return {
        content: [
          {
            type: "text" as const,
            text:
              `Session ${session.id} — ${session.role} @ ${session.company}\n${lines}\n\n` +
              output.next_step,
          },
        ],
        structuredContent: output,
      };
    },
  );

  server.registerTool(
    "list_sessions",
    {
      title: "List review sessions",
      description: "Lists stored review sessions, most recently updated first.",
      inputSchema: z.object({
        limit: z.number().int().min(1).max(100).default(20).describe("Max sessions to return."),
      }),
      outputSchema: z.object({
        sessions: z.array(
          z.object({
            session_id: z.string(),
            company: z.string(),
            role: z.string(),
            updated_at: z.string(),
            stages_complete: z.number(),
          }),
        ),
      }),
    },
    async ({ limit }) => {
      const sessions = (await listSessions(limit)).map((summary) => ({
        session_id: summary.id,
        company: summary.company,
        role: summary.role,
        updated_at: summary.updated_at,
        stages_complete: summary.stages_complete,
      }));
      const text = sessions.length
        ? sessions
            .map((s) => `${s.session_id}  ${s.stages_complete}/3  ${s.role} @ ${s.company}`)
            .join("\n")
        : "No sessions yet. Start one with start_review.";
      return { content: [{ type: "text" as const, text }], structuredContent: { sessions } };
    },
  );

  server.registerTool(
    "export_dossier",
    {
      title: "Export review dossier",
      description:
        "Returns everything recorded for a session — match report, XYZ rewrite, ATS pass, and " +
        "the final resume — as one markdown document. Returns the text rather than writing a " +
        "file; save it wherever you want it.",
      inputSchema: z.object({ session_id: sessionIdSchema }),
      outputSchema: z.object({ session_id: z.string(), markdown: z.string() }),
    },
    async ({ session_id }) => {
      const session = await loadSession(session_id);
      const markdown = renderDossier(session);
      return {
        content: [{ type: "text" as const, text: markdown }],
        structuredContent: { session_id: session.id, markdown },
      };
    },
  );

  server.registerTool(
    "delete_session",
    {
      title: "Delete a review session",
      description:
        "Permanently deletes a session and its recorded stages, including the stored resume " +
        "and job description. Use it once you have exported the dossier — nothing expires on " +
        "its own, so sessions accumulate until deleted.",
      inputSchema: z.object({ session_id: sessionIdSchema }),
      outputSchema: z.object({ session_id: z.string(), deleted: z.boolean() }),
    },
    async ({ session_id }) => {
      const deleted = await deleteSession(session_id);
      const text = deleted
        ? `Deleted session ${session_id} and everything stored against it.`
        : `No session ${session_id} to delete.`;
      return { content: [{ type: "text" as const, text }], structuredContent: { session_id, deleted } };
    },
  );
}
