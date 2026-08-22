import { McpServer } from "@modelcontextprotocol/server";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { registerPipeline } from "./src/tools/pipeline";
import { registerSupport } from "./src/tools/support";

if (!process.env.DB_URL && !process.env.DATABASE_URL) {
  throw new Error(
    "DB_URL is not set. This server keeps every session in Postgres and writes nothing to " +
      "local disk. Export a connection string, e.g. " +
      "postgres://user:pass@host/db?sslmode=require",
  );
}

const server = new McpServer({
  name: "batcave-resume",
  version: "1.0.0",
});

registerPipeline(server);
registerSupport(server);

await server.connect(new StdioServerTransport());
