import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";

// Define types for JIRA responses
type JiraCreateResponse = {
  errorMessages?: string[];
  errors?: Record<string, string>;
  key?: string;
  id?: string;
};

type JiraGetResponse = {
  errorMessages?: string[];
  fields?: {
    summary: string;
    description?: any;
    issuetype: {
      name: string;
    };
    status?: {
      name: string;
    };
    priority?: {
      name: string;
    };
    [key: string]: any; // Allow for custom fields
  };
  [key: string]: any;
};

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// Create server instance
const server = new McpServer({
  name: "jira-mcp",
  version: "1.0.0",
});

// Check if auto-creation of test tickets is enabled (default to true)
const autoCreateTestTickets = process.env.AUTO_CREATE_TEST_TICKETS !== "false";

// Helper function to format text content for JIRA API v3
function formatJiraContent(
  content: string | undefined,
  defaultText: string = "No content provided"
) {
  return content
    ? {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: content,
              },
            ],
          },
        ],
      }
    : {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: defaultText,
              },
            ],
          },
        ],
      };
}

// Helper function to format description for JIRA API v3
function formatDescription(description: string | undefined) {
  return formatJiraContent(description, "No description provided");
}

// Helper function to format acceptance criteria for JIRA API v3
function formatAcceptanceCriteria(criteria: string | undefined) {
  return formatJiraContent(criteria, "No acceptance criteria provided");
}

// Helper function to create a JIRA ticket
async function createJiraTicket(
  payload: any,
  auth: string
): Promise<{
  success: boolean;
  data: JiraCreateResponse;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue`;

  console.log("JIRA URL:", jiraUrl);
  console.log("JIRA Payload:", JSON.stringify(payload, null, 2));
  console.log("JIRA Auth:", `Basic ${auth.substring(0, 10)}...`);
  console.log("JIRA Project Key:", process.env.JIRA_PROJECT_KEY);

  try {
    const response = await fetch(jiraUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    const responseData = (await response.json()) as JiraCreateResponse;

    if (!response.ok) {
      console.error(
        "Error creating ticket:",
        JSON.stringify(responseData, null, 2),
        "Status:",
        response.status,
        response.statusText
      );

      // Try to extract more detailed error information
      let errorMessage = `Status: ${response.status} ${response.statusText}`;

      if (responseData.errorMessages && responseData.errorMessages.length > 0) {
        errorMessage = responseData.errorMessages.join(", ");
      } else if (responseData.errors) {
        errorMessage = JSON.stringify(responseData.errors);
      }

      return { success: false, data: responseData, errorMessage };
    }

    return { success: true, data: responseData };
  } catch (error) {
    console.error("Exception creating ticket:", error);
    return {
      success: false,
      data: {},
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to create a link between two tickets
async function createTicketLink(
  outwardIssue: string,
  inwardIssue: string,
  linkType: string,
  auth: string
): Promise<{ success: boolean; errorMessage?: string }> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issueLink`;

  const payload = {
    outwardIssue: {
      key: outwardIssue,
    },
    inwardIssue: {
      key: inwardIssue,
    },
    type: {
      name: linkType,
    },
  };

  console.log("Creating link between", outwardIssue, "and", inwardIssue);
  console.log("Link payload:", JSON.stringify(payload, null, 2));

  try {
    const response = await fetch(jiraUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const responseData = await response.json();
      console.error(
        "Error creating link:",
        JSON.stringify(responseData, null, 2),
        "Status:",
        response.status,
        response.statusText
      );

      let errorMessage = `Status: ${response.status} ${response.statusText}`;
      return { success: false, errorMessage };
    }

    return { success: true };
  } catch (error) {
    console.error("Exception creating link:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Register JIRA tools
server.tool(
  "create-ticket",
  "Create a jira ticket",
  {
    summary: z.string().min(1, "Summary is required"),
    issue_type: z.enum(["Bug", "Task", "Story", "Test"]).default("Task"),
    description: z.string().optional(),
    acceptance_criteria: z.string().optional(),
    story_points: z.number().optional(),
    create_test_ticket: z.boolean().optional(),
    parent_epic: z.string().optional(),
  },
  async ({
    summary,
    issue_type,
    description,
    acceptance_criteria,
    story_points,
    create_test_ticket,
    parent_epic,
  }) => {
    const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue`;

    const formattedDescription = formatDescription(description);

    // Determine if we should create a test ticket
    const shouldCreateTestTicket =
      create_test_ticket !== undefined
        ? create_test_ticket
        : autoCreateTestTickets;

    // Build the payload for the main ticket
    const payload: any = {
      fields: {
        project: {
          key: process.env.JIRA_PROJECT_KEY || "SCRUM",
        },
        summary: summary,
        description: formattedDescription,
        issuetype: {
          name: issue_type,
        },
      },
    };

    // Add acceptance criteria if provided
    if (acceptance_criteria !== undefined) {
      // Using customfield_10429 for acceptance criteria based on the ticket data we examined
      payload.fields.customfield_10429 =
        formatAcceptanceCriteria(acceptance_criteria);
    }

    // Only add custom fields for Bug, Task, and Story issue types, not for Test
    if (issue_type !== "Test") {
      // Required custom fields for 3ENOTIFY project
      payload.fields.customfield_10757 = [
        {
          self: "https://3eco.atlassian.net/rest/api/3/customFieldOption/18852",
          value: "Product Stewardship-3E Notify for SAP",
          id: "18852",
        },
      ];

      // Use CPP by default, but allow override via environment variable
      payload.fields.customfield_10636 =
        process.env.USE_NON_CPP === "true"
          ? {
              self: "https://3eco.atlassian.net/rest/api/3/customFieldOption/18384",
              value: "Non-CPP",
              id: "18384",
            }
          : {
              self: "https://3eco.atlassian.net/rest/api/3/customFieldOption/18383",
              value: "CPP",
              id: "18383",
            };
    }

    // Add story points if provided
    if (story_points !== undefined && issue_type === "Story") {
      // Using customfield_10040 for story points based on the ticket data we examined
      payload.fields.customfield_10040 = story_points;

      // Add QA-Testable label for stories with points
      payload.fields.labels = ["QA-Testable"];
    }

    // Add parent epic if provided
    if (parent_epic !== undefined) {
      // Using customfield_10014 for Epic Link based on common JIRA configurations
      payload.fields.customfield_10014 = parent_epic;
    }

    // Create the auth token
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Create the main ticket
    const result = await createJiraTicket(payload, auth);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error creating ticket: ${result.errorMessage}`,
          },
        ],
      };
    }

    // Extract the ticket key/number from the response
    const ticketKey = result.data.key;
    let responseText = `Created ticket ${ticketKey} with summary: ${summary}, description: ${
      description || "No description"
    }, issue type: ${issue_type}`;

    if (acceptance_criteria !== undefined) {
      responseText += `, acceptance criteria: ${acceptance_criteria}`;
    }

    if (story_points !== undefined) {
      responseText += `, story points: ${story_points}`;
    }

    // Create a test ticket if this is a Story with points and auto-creation is enabled
    if (
      shouldCreateTestTicket &&
      issue_type === "Story" &&
      story_points !== undefined &&
      ticketKey
    ) {
      // Create a test ticket linked to the story
      const testTicketPayload: any = {
        fields: {
          project: {
            key: process.env.JIRA_PROJECT_KEY || "SCRUM",
          },
          summary: `${ticketKey} ${summary}`,
          description: formatDescription(summary), // Use story title as description
          issuetype: {
            name: "Test",
          },
          // Don't include custom fields for Test issue type as they may not be available
        },
      };

      // Create the test ticket
      const testResult = await createJiraTicket(testTicketPayload, auth);

      if (testResult.success && testResult.data.key) {
        // Link the test ticket to the story
        const linkResult = await createTicketLink(
          ticketKey,
          testResult.data.key,
          "Test Case Linking", // "is tested by" relationship
          auth
        );

        if (linkResult.success) {
          responseText += `\nCreated linked test ticket ${testResult.data.key}`;
        } else {
          responseText += `\nCreated test ticket ${testResult.data.key} but failed to link it: ${linkResult.errorMessage}`;
        }
      } else {
        responseText += `\nFailed to create test ticket: ${testResult.errorMessage}`;
      }
    }

    return {
      content: [
        {
          type: "text",
          text: responseText,
        },
      ],
    };
  }
);

server.tool(
  "link-tickets",
  "Link two jira tickets",
  {
    outward_issue: z.string().min(1, "Outward issue key is required"),
    inward_issue: z.string().min(1, "Inward issue key is required"),
    link_type: z
      .string()
      .min(1, "Link type is required")
      .default("Test Case Linking"),
  },
  async ({ outward_issue, inward_issue, link_type }) => {
    // Create the auth token
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Create the link
    const result = await createTicketLink(
      outward_issue,
      inward_issue,
      link_type,
      auth
    );

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error linking tickets: ${result.errorMessage}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Successfully linked ${outward_issue} to ${inward_issue} with link type "${link_type}"`,
        },
      ],
    };
  }
);

server.tool(
  "get-ticket",
  "Get a jira ticket",
  {
    ticket_id: z.string().min(1, "Ticket ID is required"),
  },
  async ({ ticket_id }) => {
    const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticket_id}`;
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    try {
      const response = await fetch(jiraUrl, {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
      });

      const responseData = (await response.json()) as JiraGetResponse;

      if (!response.ok) {
        console.error("Error fetching ticket:", responseData);
        return {
          content: [
            {
              type: "text",
              text: `Error fetching ticket: ${
                responseData.errorMessages?.join(", ") || "Unknown error"
              }`,
            },
          ],
        };
      }

      if (!responseData.fields) {
        return {
          content: [
            {
              type: "text",
              text: "Error: No ticket fields found in response",
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `JIRA Ticket: ${ticket_id}, Fields: ${JSON.stringify(
              responseData.fields,
              null,
              2
            )}`,
          },
        ],
      };
    } catch (error) {
      console.error("Exception fetching ticket:", error);
      return {
        content: [
          {
            type: "text",
            text: `Error fetching ticket: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        ],
      };
    }
  }
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

main().catch((error) => {
  console.error("Error running main:", error);
  process.exit(1);
});
