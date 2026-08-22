import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { loadDocument } from "../../../platform/documents";
import { toolResult } from "../../../platform/tool-result";
import { createSession } from "../sessions";

const documentStatsSchema = z.object({
  source: z.string(),
  format: z.string(),
  words: z.number(),
});

export function registerIntakeTool(server: McpServer): void {
  server.registerTool(
    "start_review",
    {
      title: "Start resume review",
      description:
        "Intake for the review pipeline. Takes the two documents — a resume and a job " +
        "description, each as raw text or a path to a .pdf/.docx/.txt/.md file — extracts " +
        "their text and opens a session. Returns the session_id that resume_match_report, " +
        "rewrite_experience_xyz, and ats_scroll_stopper_pass all run against. Pass company " +
        "and role from the job description when it states them.",
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
        resume: documentStatsSchema,
        job_description: documentStatsSchema,
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
      const session = await createSession({
        company: args.company?.trim() || "the hiring company",
        role: args.role?.trim() || "the advertised role",
        resume,
        jobDescription,
      });
      const next_step = `Call resume_match_report with session_id "${session.id}".`;
      return toolResult(
        `Session ${session.id} open for ${session.role} @ ${session.company}.\n` +
          `Resume: ${resume.words} words from ${resume.source}\n` +
          `Job description: ${jobDescription.words} words from ${jobDescription.source}\n\n` +
          next_step,
        {
          session_id: session.id,
          company: session.company,
          role: session.role,
          resume: { source: resume.source, format: resume.format, words: resume.words },
          job_description: {
            source: jobDescription.source,
            format: jobDescription.format,
            words: jobDescription.words,
          },
          next_step,
        },
      );
    },
  );
}
