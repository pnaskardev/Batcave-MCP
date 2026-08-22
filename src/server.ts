import { McpServer } from "@modelcontextprotocol/server";
import type { ToolModule } from "./module";

const SERVER_INFO = { name: "batcave", version: "1.0.0" } as const;

/**
 * Builds the server from a list of modules. Registration order decides the order tools appear
 * in `tools/list`; nothing else about a module is visible from here.
 */
export function createServer(modules: readonly ToolModule[]): McpServer {
  const seen = new Set<string>();
  for (const module of modules) {
    if (seen.has(module.name)) {
      throw new Error(`Two modules are both named "${module.name}".`);
    }
    seen.add(module.name);
  }

  const server = new McpServer(SERVER_INFO);
  for (const module of modules) {
    module.register(server);
  }
  return server;
}
