import dotenv from "dotenv";
// Load environment variables from .env file
dotenv.config();
console.error("[", Date.now(), "]JIRA_USERNAME: ", process.env.JIRA_USERNAME);
console.error("JIRA_API_KEY: ", process.env.JIRA_API_KEY);

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

process.on('uncaughtException', (error) => {
    console.error('UNCAUGHT EXCEPTION:', error);
  });

// Create server instance
const server = new McpServer({
  name: "jira-mcp",
  version: "1.0.0",
});

// Register weather tools
server.tool(
    "create-ticket",
    "Create a jira ticket",
    {
        summary: z.string().min(1, "Summary is required"),
        description: z.string().optional(),
        story_points: z.number().min(0, "Story points must be at least 0").optional()
    },
    async ({ summary, description, story_points }) => {
        // TODO: create jira ticket




        return {
            content: [
                {
                    type: "text",
                    text: `Created ticket with summary: ${summary}, description: ${description || "No description"}, story points: ${story_points || 0}, JIRA userame: ${process.env.JIRA_USERNAME}`
                }
            ]
        };
    },
);

async function main() {
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
    } catch (error) {
        console.error("Error in main():", error);
        process.exit(1);
    }   
}

main().catch(error => {
    console.error("Error running main:", error);
    process.exit(1);
});