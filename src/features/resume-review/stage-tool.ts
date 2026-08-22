import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { toolResult, type ToolResult } from "../../platform/tool-result";
import { type StageEnvelope, stageEnvelopeSchema } from "./schemas";
import {
  loadSession,
  markComplete,
  markIssued,
  type ReviewSession,
  type StageName,
} from "./sessions";

/**
 * Each stage of the review is one tool called twice.
 *
 * Called with a session id alone it returns the brief for that stage, with the documents and
 * every earlier stage's output already embedded, and marks the stage as awaiting an answer.
 * Called again with a `result` it validates and records that answer, which is what unblocks
 * the next stage. Splitting it across two tools would let a caller record a result for a stage
 * whose brief it never read.
 */
export interface StageDefinition<Result extends Record<string, unknown>> {
  readonly stage: StageName;
  readonly tool: string;
  readonly title: string;
  readonly description: string;
  readonly resultSchema: z.ZodType<Result>;
  /** Composes the brief. Throws if an earlier stage has not been recorded yet. */
  brief(session: ReviewSession): string;
  /** One line telling the caller what to do now that this stage is recorded. */
  nextStep(session: ReviewSession, result: Result): string;
}

export function registerStage<Result extends Record<string, unknown>>(
  server: McpServer,
  definition: StageDefinition<Result>,
): void {
  server.registerTool(
    definition.tool,
    {
      title: definition.title,
      description: definition.description,
      inputSchema: z.object({
        session_id: z.string().describe("Session id returned by start_review."),
        result: definition.resultSchema
          .optional()
          .describe("Your analysis for this stage. Omit on the first call to get the brief."),
      }),
      outputSchema: stageEnvelopeSchema,
    },
    async ({ session_id, result }) => runStage(definition, session_id, result),
  );
}

async function runStage<Result extends Record<string, unknown>>(
  definition: StageDefinition<Result>,
  sessionId: string,
  result: Result | undefined,
): Promise<ToolResult<StageEnvelope>> {
  const session = await loadSession(sessionId);

  if (result) {
    await markComplete(session.id, definition.stage, result);
    const next = definition.nextStep(session, result);
    const confirmation = `Recorded stage "${definition.stage}" for session ${session.id}.`;
    return toolResult(`${confirmation}\n\n${next}`, {
      session_id: session.id,
      stage: definition.stage,
      mode: "recorded",
      next_step: next,
    });
  }

  const brief = definition.brief(session);
  await markIssued(session.id, definition.stage);
  return toolResult(brief, {
    session_id: session.id,
    stage: definition.stage,
    mode: "brief",
    brief,
    next_step:
      `Perform the analysis above, then call ${definition.tool} again with session_id ` +
      `"${session.id}" and the result argument.`,
  });
}
