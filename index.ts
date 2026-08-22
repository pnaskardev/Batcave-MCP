import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";
import { resumeReview } from "./src/features/resume-review";
import { createServer } from "./src/server";

const server = createServer([resumeReview]);

await server.connect(new StdioServerTransport());
