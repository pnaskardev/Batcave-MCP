import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolResult } from "../../../platform/tool-result";
import {
  deleteSession,
  listSessions,
  loadSession,
  type ReviewSession,
  STAGE_ORDER,
  STAGE_TOOLS,
  stageStatus,
} from "../sessions";

const sessionIdSchema = z.string().describe("Session id returned by start_review.");

function nextStep(session: ReviewSession): string {
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

function registerStatusTool(server: McpServer): void {
  server.registerTool(
    "session_status",
    {
      title: "Session status",
      description:
        "Shows where a review session stands: which of the three stages are done, awaiting a " +
        "result, or not started, and what to call next.",
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
      const next_step = nextStep(session);
      const lines = STAGE_ORDER.map((stage) => `- ${stage}: ${stages[stage]}`).join("\n");
      return toolResult(
        `Session ${session.id} — ${session.role} @ ${session.company}\n${lines}\n\n${next_step}`,
        {
          session_id: session.id,
          company: session.company,
          role: session.role,
          stages,
          next_step,
        },
      );
    },
  );
}

function registerListTool(server: McpServer): void {
  server.registerTool(
    "list_sessions",
    {
      title: "List review sessions",
      description: "Lists review sessions, most recently updated first.",
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
      return toolResult(text, { sessions });
    },
  );
}

function registerDeleteTool(server: McpServer): void {
  server.registerTool(
    "delete_session",
    {
      title: "Delete a review session",
      description:
        "Permanently deletes a session and its recorded stages, including the stored resume " +
        "and job description. Nothing expires on its own, so sessions accumulate until " +
        "deleted — export the dossier first.",
      inputSchema: z.object({ session_id: sessionIdSchema }),
      outputSchema: z.object({ session_id: z.string(), deleted: z.boolean() }),
    },
    async ({ session_id }) => {
      const deleted = await deleteSession(session_id);
      return toolResult(
        deleted
          ? `Deleted session ${session_id} and everything stored against it.`
          : `No session ${session_id} to delete.`,
        { session_id, deleted },
      );
    },
  );
}

export function registerSessionAdminTools(server: McpServer): void {
  registerStatusTool(server);
  registerListTool(server);
  registerDeleteTool(server);
}
