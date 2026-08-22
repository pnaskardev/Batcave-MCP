import type { McpServer } from "@modelcontextprotocol/server";

/**
 * A self-contained family of tools — resume review is one; anything else is another.
 *
 * A module owns its own tables (declared in its `schema.ts`, which drizzle-kit picks up) and its
 * own vocabulary. It may depend on `src/platform`, never on another module: two modules that
 * need to know about each other are one module.
 */
export interface ToolModule {
  /** Stable identifier, used for diagnostics. Never shown to callers. */
  readonly name: string;
  /** Registers every tool the module exposes. */
  register(server: McpServer): void;
}
