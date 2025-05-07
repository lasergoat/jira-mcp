import dotenv from "dotenv";
dotenv.config();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import fetch from "node-fetch";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { updateJiraTicket } from "./update-ticket.js";

// Define types for JIRA and Zephyr responses
type JiraCreateResponse = {
  errorMessages?: string[];
  errors?: Record<string, string>;
  key?: string;
  id?: string;
};

type JiraGetResponse = {
  errorMessages?: string[];
  id?: string; // Internal Jira ID
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

type JiraSearchResponse = {
  errorMessages?: string[];
  issues?: Array<{
    key: string;
    fields: {
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
  }>;
  total?: number;
  maxResults?: number;
  startAt?: number;
};

type ZephyrAddTestStepResponse = {
  id?: number;
  orderId?: number;
  step?: string;
  data?: string;
  result?: string;
  [key: string]: any;
};

process.on("uncaughtException", (error) => {
  console.error("UNCAUGHT EXCEPTION:", error);
});

// Helper function to generate a JWT token for Zephyr API
function generateZephyrJwt(
  method: string,
  apiPath: string,
  expirationSec: number = 3600
): string {
  // Zephyr base URL from environment variable
  const zephyrBase = (
    process.env.ZAPI_BASE_URL || "https://prod-api.zephyr4jiracloud.com/connect"
  ).replace(/\/$/, "");

  // Build the canonical string: METHOD&<path>&
  const canonical = `${method.toUpperCase()}&${apiPath}&`;

  // Create SHA-256 hex hash of canonical string
  const qsh = crypto
    .createHash("sha256")
    .update(canonical, "utf8")
    .digest("hex");

  // Timestamps
  const now = Math.floor(Date.now() / 1000);
  const exp = now + expirationSec;

  // JWT claims
  const payload = {
    sub: process.env.ZAPI_ACCOUNT_ID, // Atlassian account ID
    iss: process.env.ZAPI_ACCESS_KEY, // Zephyr Access Key
    qsh, // query-string hash
    iat: now,
    exp,
  };

  // Sign with HMAC-SHA256 using Zephyr Secret Key
  return jwt.sign(payload, process.env.ZAPI_SECRET_KEY || "", {
    algorithm: "HS256",
  });
}

// Helper function to add a test step to a Zephyr test
async function addZephyrTestStep(
  issueId: string,
  step: string,
  data: string = "",
  result: string = ""
): Promise<{
  success: boolean;
  data?: ZephyrAddTestStepResponse;
  errorMessage?: string;
}> {
  // Zephyr base URL from environment variable
  const baseUrl =
    process.env.ZAPI_BASE_URL ||
    "https://prod-api.zephyr4jiracloud.com/connect";
  const apiPath = `/rest/zapi/latest/teststep/${issueId}`;
  const fullUrl = `${baseUrl}${apiPath}`;

  console.log("Zephyr URL:", fullUrl);
  console.log(
    "Zephyr Payload:",
    JSON.stringify({ step, data, result }, null, 2)
  );

  try {
    // Generate JWT for this specific API call
    const jwtToken = generateZephyrJwt("POST", apiPath);

    const response = await fetch(fullUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        zapiAccessKey: process.env.ZAPI_ACCESS_KEY || "",
        Authorization: `JWT ${jwtToken}`,
      },
      body: JSON.stringify({ step, data, result }),
    });

    const responseData = (await response.json()) as ZephyrAddTestStepResponse;

    if (!response.ok) {
      console.error(
        "Error adding test step:",
        JSON.stringify(responseData, null, 2),
        "Status:",
        response.status,
        response.statusText
      );

      return {
        success: false,
        data: responseData,
        errorMessage: `Status: ${response.status} ${response.statusText}`,
      };
    }

    return { success: true, data: responseData };
  } catch (error) {
    console.error("Exception adding test step:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

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
  // Check if criteria is undefined or empty
  if (!criteria) {
    return {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "No acceptance criteria provided",
            },
          ],
        },
      ],
    };
  }

  // Split criteria by newlines to handle bullet points properly
  const lines = criteria.split("\n");
  const content = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Check if line is a bullet point
    if (trimmedLine.startsWith("-") || trimmedLine.startsWith("*")) {
      content.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: trimmedLine.substring(1).trim(),
                  },
                ],
              },
            ],
          },
        ],
      });
    } else {
      // Regular paragraph
      content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: trimmedLine,
          },
        ],
      });
    }
  }

  return {
    type: "doc",
    version: 1,
    content: content,
  };
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

// Helper function to search for JIRA tickets
async function searchJiraTickets(
  jql: string,
  maxResults: number,
  auth: string
): Promise<{
  success: boolean;
  data: JiraSearchResponse;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${
    process.env.JIRA_HOST
  }/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=${maxResults}`;

  console.log("JIRA Search URL:", jiraUrl);
  console.log("JIRA Search JQL:", jql);
  console.log("JIRA Auth:", `Basic ${auth.substring(0, 10)}...`);

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
    });

    const responseData = (await response.json()) as JiraSearchResponse;

    if (!response.ok) {
      console.error(
        "Error searching tickets:",
        JSON.stringify(responseData, null, 2),
        "Status:",
        response.status,
        response.statusText
      );

      // Try to extract more detailed error information
      let errorMessage = `Status: ${response.status} ${response.statusText}`;

      if (responseData.errorMessages && responseData.errorMessages.length > 0) {
        errorMessage = responseData.errorMessages.join(", ");
      }

      return { success: false, data: responseData, errorMessage };
    }

    return { success: true, data: responseData };
  } catch (error) {
    console.error("Exception searching tickets:", error);
    return {
      success: false,
      data: {},
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
    sprint: z.string().optional(),
    story_readiness: z.enum(["Yes", "No"]).optional(),
  },
  async ({
    summary,
    issue_type,
    description,
    acceptance_criteria,
    story_points,
    create_test_ticket,
    parent_epic,
    sprint,
    story_readiness,
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
      // Using environment variable for acceptance criteria field
      const acceptanceCriteriaField =
        process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD || "customfield_10429";

      // Format and add acceptance criteria to the custom field only, not to description
      payload.fields[acceptanceCriteriaField] =
        formatAcceptanceCriteria(acceptance_criteria);

      // Log for debugging
      console.log(
        `Adding acceptance criteria to field ${acceptanceCriteriaField}`
      );
      console.log(
        "Formatted acceptance criteria:",
        JSON.stringify(formatAcceptanceCriteria(acceptance_criteria), null, 2)
      );
    }

    // Only add custom fields for Bug, Task, and Story issue types, not for Test
    if (issue_type !== "Test") {
      // Add product field if configured
      const productField = process.env.JIRA_PRODUCT_FIELD;
      const productValue = process.env.JIRA_PRODUCT_VALUE;
      const productId = process.env.JIRA_PRODUCT_ID;

      if (productField && productValue && productId) {
        payload.fields[productField] = [
          {
            self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${productId}`,
            value: productValue,
            id: productId,
          },
        ];
      }

      // Add category field if configured
      const categoryField = process.env.JIRA_CATEGORY_FIELD;

      if (categoryField) {
        const useAlternateCategory =
          process.env.USE_ALTERNATE_CATEGORY === "true";

        const categoryOptionId = useAlternateCategory
          ? process.env.JIRA_ALTERNATE_CATEGORY_ID
          : process.env.JIRA_DEFAULT_CATEGORY_ID;

        const categoryOptionValue = useAlternateCategory
          ? process.env.JIRA_ALTERNATE_CATEGORY_VALUE
          : process.env.JIRA_DEFAULT_CATEGORY_VALUE;

        if (categoryOptionId && categoryOptionValue) {
          payload.fields[categoryField] = {
            self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${categoryOptionId}`,
            value: categoryOptionValue,
            id: categoryOptionId,
          };
        }
      }
    }

    // Add story points if provided
    if (story_points !== undefined && issue_type === "Story") {
      // Using environment variable for story points field
      const storyPointsField =
        process.env.JIRA_STORY_POINTS_FIELD || "customfield_10040";
      payload.fields[storyPointsField] = story_points;

      // Add QA-Testable label for stories with points
      payload.fields.labels = ["QA-Testable"];
    }

    // Add parent epic if provided
    if (parent_epic !== undefined) {
      // Using environment variable for epic link field
      const epicLinkField =
        process.env.JIRA_EPIC_LINK_FIELD || "customfield_10014";
      payload.fields[epicLinkField] = parent_epic;
    }

    // Add sprint if provided
    if (sprint !== undefined) {
      // Sprint field is customfield_10020 based on our query
      payload.fields["customfield_10020"] = [
        {
          name: sprint,
        },
      ];
    }

    // Add story readiness if provided
    if (story_readiness !== undefined) {
      // Story Readiness field is customfield_10596 based on our query
      const storyReadinessId = story_readiness === "Yes" ? "18256" : "18257";
      payload.fields["customfield_10596"] = {
        self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${storyReadinessId}`,
        value: story_readiness,
        id: storyReadinessId,
      };
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

server.tool(
  "search-tickets",
  "Search for jira tickets by issue type",
  {
    issue_type: z.enum(["Bug", "Task", "Story", "Test"]),
    max_results: z.number().min(1).max(50).default(10).optional(),
    additional_criteria: z.string().optional(), // For additional JQL criteria
  },
  async ({ issue_type, max_results = 10, additional_criteria }) => {
    // Create the auth token
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Construct the JQL query
    let jql = `project = "${process.env.JIRA_PROJECT_KEY}" AND issuetype = "${issue_type}"`;

    // Add additional criteria if provided
    if (additional_criteria) {
      jql += ` AND (${additional_criteria})`;
    }

    // Search for tickets
    const result = await searchJiraTickets(jql, max_results, auth);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error searching tickets: ${result.errorMessage}`,
          },
        ],
      };
    }

    // Check if we have results
    if (!result.data.issues || result.data.issues.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `No ${issue_type} tickets found matching the criteria.`,
          },
        ],
      };
    }

    // Format the results
    const tickets = result.data.issues.map((issue) => ({
      key: issue.key,
      summary: issue.fields.summary,
      status: issue.fields.status?.name || "Unknown",
      priority: issue.fields.priority?.name || "Unknown",
    }));

    return {
      content: [
        {
          type: "text",
          text: `Found ${result.data.total} ${issue_type} tickets (showing ${
            tickets.length
          }):\n\n${JSON.stringify(tickets, null, 2)}`,
        },
      ],
    };
  }
);

// Helper function to get the internal Jira ID from a ticket key
async function getJiraIssueId(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  id?: string;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}`;

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

      let errorMessage = `Status: ${response.status} ${response.statusText}`;
      if (responseData.errorMessages && responseData.errorMessages.length > 0) {
        errorMessage = responseData.errorMessages.join(", ");
      }

      return { success: false, errorMessage };
    }

    if (!responseData.id) {
      return {
        success: false,
        errorMessage: "No issue ID found in response",
      };
    }

    return { success: true, id: responseData.id };
  } catch (error) {
    console.error("Exception fetching ticket ID:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Register new tool for updating tickets
server.tool(
  "update-ticket",
  "Update an existing jira ticket",
  {
    ticket_key: z.string().min(1, "Ticket key is required"),
    sprint: z.string().optional(),
    story_readiness: z.enum(["Yes", "No"]).optional(),
  },
  async ({ ticket_key, sprint, story_readiness }) => {
    // Create the auth token
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Build the payload for the update
    const payload: any = {
      fields: {},
    };

    // Add sprint if provided
    if (sprint !== undefined) {
      // Sprint field is customfield_10020 based on our query
      payload.fields["customfield_10020"] = [
        {
          name: sprint,
        },
      ];
    }

    // Add story readiness if provided
    if (story_readiness !== undefined) {
      // Story Readiness field is customfield_10596 based on our query
      const storyReadinessId = story_readiness === "Yes" ? "18256" : "18257";
      payload.fields["customfield_10596"] = {
        self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${storyReadinessId}`,
        value: story_readiness,
        id: storyReadinessId,
      };
    }

    // If no fields were provided, return an error
    if (Object.keys(payload.fields).length === 0) {
      return {
        content: [
          {
            type: "text",
            text: "Error: At least one field to update must be provided",
          },
        ],
      };
    }

    // Update the ticket
    const result = await updateJiraTicket(ticket_key, payload, auth);

    if (!result.success) {
      return {
        content: [
          {
            type: "text",
            text: `Error updating ticket: ${result.errorMessage}`,
          },
        ],
      };
    }

    // Build response text
    let responseText = `Successfully updated ticket ${ticket_key}`;
    if (sprint !== undefined) {
      responseText += `, sprint: ${sprint}`;
    }
    if (story_readiness !== undefined) {
      responseText += `, story readiness: ${story_readiness}`;
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

// Register new tool for adding test steps
server.tool(
  "add-test-steps",
  "Add test steps to a test ticket via Zephyr integration",
  {
    ticket_key: z.string().min(1, "Ticket key is required"),
    steps: z
      .array(
        z.object({
          step: z.string().min(1, "Step description is required"),
          data: z.string().optional(),
          result: z.string().optional(),
        })
      )
      .min(1, "At least one test step is required"),
  },
  async ({ ticket_key, steps }) => {
    // Create the auth token for Jira API
    const auth = Buffer.from(
      `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Get the internal Jira ID from the ticket key
    const idResult = await getJiraIssueId(ticket_key, auth);

    if (!idResult.success || !idResult.id) {
      return {
        content: [
          {
            type: "text",
            text: `Error getting internal ID for ticket ${ticket_key}: ${idResult.errorMessage}`,
          },
        ],
      };
    }

    const issueId = idResult.id;
    console.log(`Found internal ID for ticket ${ticket_key}: ${issueId}`);

    // Add each test step
    const results = [];
    let allSuccessful = true;

    for (const [index, { step, data = "", result = "" }] of steps.entries()) {
      console.log(`Adding test step ${index + 1}/${steps.length}: ${step}`);

      const stepResult = await addZephyrTestStep(issueId, step, data, result);

      if (stepResult.success) {
        results.push(`Step ${index + 1}: Added successfully`);
      } else {
        results.push(`Step ${index + 1}: Failed - ${stepResult.errorMessage}`);
        allSuccessful = false;
      }
    }

    // Return the results
    if (allSuccessful) {
      return {
        content: [
          {
            type: "text",
            text: `Successfully added ${
              steps.length
            } test step(s) to ticket ${ticket_key}:\n\n${results.join("\n")}`,
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: "text",
            text: `Some test steps could not be added to ticket ${ticket_key}:\n\n${results.join(
              "\n"
            )}`,
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
