import type { McpServer } from "@modelcontextprotocol/server";
import type { ToolModule } from "../../module";
import { registerDossierTool } from "./tools/dossier";
import { registerIntakeTool } from "./tools/intake";
import { registerLatexTool } from "./tools/latex";
import { registerSessionAdminTools } from "./tools/session-admin";
import { registerStageTools } from "./tools/stages";

/**
 * Takes a resume and a job description, then runs them through three chained stages:
 * recruiter match report, XYZ experience rewrite, ATS and hiring-manager scan. A fourth
 * stage applies the result to a LaTeX source, but only if the candidate asks for it.
 */
export const resumeReview: ToolModule = {
  name: "resume-review",
  register(server: McpServer): void {
    // Registration order is the order tools appear in tools/list — keep it the workflow order.
    registerIntakeTool(server);
    registerStageTools(server);
    registerLatexTool(server);
    registerDossierTool(server);
    registerSessionAdminTools(server);
  },
};
