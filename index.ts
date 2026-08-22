import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { modules } from "./src/modules";
import { createServer } from "./src/server";

const server = createServer(modules);

await server.connect(new StdioServerTransport());
