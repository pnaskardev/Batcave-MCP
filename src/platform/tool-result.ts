/**
 * MCP tool results carry the same payload twice: prose in `content` for the model to read, and
 * `structuredContent` for anything consuming the tool programmatically. These keep the two in
 * step so no tool forgets one of them.
 */

// A type alias, not an interface: CallToolResult carries an index signature, and TypeScript
// grants implicit index signatures to aliases but never to interfaces.
export type ToolResult<T> = {
  content: { type: "text"; text: string }[];
  structuredContent: T;
};

/** A result whose prose and structured payload are written separately. */
export function toolResult<T extends Record<string, unknown>>(
  text: string,
  structuredContent: T,
): ToolResult<T> {
  return { content: [{ type: "text", text }], structuredContent };
}

/** A result whose prose *is* one of its fields — briefs and documents, where the text is it. */
export function textResult<T extends Record<string, unknown>>(
  structuredContent: T,
  field: keyof T & string,
): ToolResult<T> {
  return toolResult(String(structuredContent[field]), structuredContent);
}
