import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { textResult } from "../../../platform/tool-result";
import { renderDossier } from "../dossier";
import { loadSession } from "../sessions";

export function registerDossierTool(server: McpServer): void {
  server.registerTool(
    "export_dossier",
    {
      title: "Export review dossier",
      description:
        "Returns everything recorded for a session — match report, XYZ rewrite, ATS pass, and " +
        "the final resume — as one markdown document. Returns the text rather than writing a " +
        "file; save it wherever you want it.",
      inputSchema: z.object({
        session_id: z.string().describe("Session id returned by start_review."),
      }),
      outputSchema: z.object({ session_id: z.string(), markdown: z.string() }),
    },
    async ({ session_id }) => {
      const session = await loadSession(session_id);
      return textResult({ session_id: session.id, markdown: renderDossier(session) }, "markdown");
    },
  );
}
