import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadLatex } from "../../../platform/documents";
import { toolResult } from "../../../platform/tool-result";
import { latexEditBrief } from "../briefs";
import { latexEditSchema, sessionIdSchema, stageEnvelopeSchema } from "../schemas";
import {
  loadSession,
  markComplete,
  markIssued,
  requireLatexSource,
  requireStageResult,
  saveLatexSource,
} from "../sessions";
import { LATEX_STAGE, STAGE_TOOLS } from "../stage";

const latexEnvelopeSchema = stageEnvelopeSchema.extend({
  edited_latex: z
    .string()
    .optional()
    .describe("The complete edited .tex source, present once a result has been recorded."),
});

/**
 * Stage 4 does not go through `registerStage`: its brief call takes a document the chained
 * stages never see, and its recorded call hands back a file rather than a confirmation.
 * Everything else matches — one tool, called once for the brief and once with the result.
 */
export function registerLatexTool(server: McpServer): void {
  server.registerTool(
    "edit_latex_resume",
    {
      title: "Stage 4 (optional) — apply the review to a LaTeX resume",
      description:
        "Optional step after stage 3, and only with the candidate's say-so. Once stage 3 is " +
        "recorded, ask them: is your resume in LaTeX, and do you want the source edited? If " +
        "no, the review is already complete — call export_dossier instead and do not call " +
        "this. If yes, call this with session_id and their .tex file (latex_text or " +
        "latex_path) to get the brief, then again with the result. Returns the edited .tex " +
        "source for them to copy, adjust, compile, and submit themselves. It never compiles " +
        "anything and never produces a PDF.",
      inputSchema: z.object({
        session_id: sessionIdSchema,
        latex_text: z.string().optional().describe("The candidate's .tex source as raw text."),
        latex_path: z
          .string()
          .optional()
          .describe(
            "Path to the candidate's .tex or .latex file. Not a .pdf — there is no " +
              "source to edit in a rendered PDF.",
          ),
        result: latexEditSchema
          .optional()
          .describe("Your edited source. Omit on the first call to get the brief."),
      }),
      outputSchema: latexEnvelopeSchema,
    },
    async ({ session_id, latex_text, latex_path, result }) => {
      const session = await loadSession(session_id);

      if (result) {
        await markComplete(session.id, LATEX_STAGE, result);
        const next =
          `Give the candidate the .tex source above verbatim, in a fenced block they can copy. ` +
          `They compile and submit it themselves — this stage never does. ` +
          `Call export_dossier with session_id "${session.id}" for the whole review.`;
        const notes = [
          result.preamble_changed ? "The preamble changed — recompile before trusting it." : "",
          ...result.compile_risks.map((risk) => `Compile risk: ${risk}`),
          ...result.edits_not_applied.map((e) => `Not applied: ${e.change} — ${e.reason}`),
        ].filter(Boolean);
        return toolResult(
          [
            `Recorded stage "${LATEX_STAGE}" for session ${session.id}.`,
            ...(notes.length ? ["", ...notes] : []),
            "",
            "```latex",
            result.edited_latex,
            "```",
            "",
            next,
          ].join("\n"),
          {
            session_id: session.id,
            stage: LATEX_STAGE,
            mode: "recorded" as const,
            edited_latex: result.edited_latex,
            next_step: next,
          },
        );
      }

      // Throws unless stage 3 is recorded: there is nothing to apply before then.
      const atsPass = requireStageResult(session, "ats_pass");
      // A source supplied now replaces any earlier one; with none supplied and none stored,
      // requireLatexSource explains how to opt in — or how to skip the stage entirely.
      const latex =
        latex_text || latex_path
          ? await loadLatex({ text: latex_text, path: latex_path })
          : requireLatexSource(session);
      if (latex_text || latex_path) await saveLatexSource(session.id, latex);

      const brief = latexEditBrief(session, latex, atsPass);
      await markIssued(session.id, LATEX_STAGE);
      return toolResult(brief, {
        session_id: session.id,
        stage: LATEX_STAGE,
        mode: "brief" as const,
        brief,
        next_step:
          `Apply the edits above, then call ${STAGE_TOOLS[LATEX_STAGE]} again with session_id ` +
          `"${session.id}" and the result argument. The .tex source is already stored, so you ` +
          `do not need to pass it again.`,
      });
    },
  );
}
