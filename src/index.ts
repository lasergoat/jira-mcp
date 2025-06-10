import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerJiraTools } from "./jira/tools.js";
import { registerZephyrTools } from "./zephyr/index.js";
import { registerConfigTools } from "./config/tools.js";

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// Create server instance
const server = new McpServer({
  name: "jira-mcp",
  version: "1.0.0",
});

// Register configuration tools
registerConfigTools(server);

// Register Jira tools
registerJiraTools(server);

// Register Zephyr tools
registerZephyrTools(server);

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
  } catch (error) {
    console.error("Error in main():", error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("Error running main:", error);
  process.exit(1);
});
