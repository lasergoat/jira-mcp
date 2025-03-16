import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

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
        issue_type: z.enum(["Bug", "Task", "Story"]).default("Task"),
        description: z.string().optional()
    },
    async ({ summary, issue_type, description }) => {
        const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue`;
        const auth = Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`).toString('base64');

        const payload = {
            fields: {
                project: {
                    key: process.env.JIRA_PROJECT_KEY || "SCRUM"
                },
                summary: summary,
                description: description || "No description provided",
                issuetype: {
                    name: issue_type
                }
            }
        };

        const response = await fetch(jiraUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                'Authorization': `Basic ${auth}`
            },
            body: JSON.stringify(payload)
        });

        const responseData = await response.json() as { errorMessages?: string[] };

        if (!response.ok) {
            console.error("Error creating ticket:", responseData);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error creating ticket: ${responseData.errorMessages?.join(", ") || "Unknown error"}`
                    }
                ]
            }
        }


        return {
            content: [
                {
                    type: "text",
                    text: `Created ticket with summary: ${summary}, description: ${description || "No description"}, issue type: ${issue_type}.`
                }
            ]
        };
    },
);

server.tool(
    "get-ticket",
    "Get a jira ticket",
    {
        ticket_id: z.string().min(1, "Ticket ID is required")
    },
    async ({ ticket_id }) => {
        const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticket_id}`;
        const auth = Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`).toString('base64');
        const response = await fetch(jiraUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                'Authorization': `Basic ${auth}`
            }
        });

        type JiraResponse = {
            errorMessages?: string[];
            fields?: {
                summary: string;
                description?: string;
                issuetype: {
                    name: string;
                };
                status?: {
                    name: string;
                };
                priority?: {
                    name: string;
                };
            };
        };

        const responseData = await response.json() as JiraResponse;
        if (!response.ok) {
            console.error("Error fetching ticket:", responseData);
            return {
                content: [
                    {
                        type: "text",
                        text: `Error fetching ticket: ${responseData.errorMessages?.join(", ") || "Unknown error"}`
                    }
                ]
            }
        }

        if (!responseData.fields) {
            return {
                content: [
                    {
                        type: "text",
                        text: "Error: No ticket fields found in response"
                    }
                ]
            };
        }

        return {
            content: [
                {
                    type: "text",
                    text: `JIRA Ticket: ${ticket_id}, Fields: ${JSON.stringify(responseData.fields, null, 2)}`
                }
            ]
        };
    }
)

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