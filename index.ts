import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { modules } from "./src/modules";
import { assertConfigured } from "./src/platform/db";
import { createServer } from "./src/server";

assertConfigured();

const server = createServer(modules);

await server.connect(new StdioServerTransport());
