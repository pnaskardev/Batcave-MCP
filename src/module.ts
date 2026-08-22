import type { McpServer } from "@modelcontextprotocol/server";

/**
 * One migration in a module's schema history. Ids are recorded once applied, so a migration
 * runs exactly once per database and later ones can safely alter what earlier ones created.
 */
export interface Migration {
  readonly id: string;
  readonly sql: string;
}

/**
 * A self-contained family of tools — resume review is one; anything else is another.
 *
 * A module owns its own tables and its own vocabulary. It may depend on `src/platform`, never
 * on another module: two modules that need to know about each other are one module.
 */
export interface ToolModule {
  /** Stable identifier. Namespaces the module's migrations; never shown to callers. */
  readonly name: string;
  /** Applied in order, once each, the first time the module touches the database. */
  readonly migrations: readonly Migration[];
  /** Registers every tool the module exposes. */
  register(server: McpServer): void;
}
