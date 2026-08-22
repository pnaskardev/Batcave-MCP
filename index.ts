import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerPipeline } from "./src/tools/pipeline";
import { registerSupport } from "./src/tools/support";

const server = new McpServer({
  name: "batcave-resume",
  version: "1.0.0",
});

registerPipeline(server);
registerSupport(server);

await server.connect(new StdioServerTransport());
