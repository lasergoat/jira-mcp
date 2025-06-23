import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fetch from "node-fetch";
import { createJiraTicket, createTicketLink, searchJiraTickets, updateJiraTicket, addJiraComment, uploadJiraAttachment, getJiraFields, getJiraTransitions, transitionJiraTicket, getJiraComments, getJiraAttachments, deleteJiraAttachment, getRawTicketData } from "./api.js";
import { updateJiraComment, deleteJiraComment, getFullTicketDetails, searchJiraUsers } from "./api-extended.js";
import { preferencesManager } from "./preferences.js";
import { formatDescription, formatAcceptanceCriteria } from "./formatting.js";
import { getJiraIssueId } from "../utils.js";
import { 
  getZephyrTestSteps, 
  addZephyrTestStep 
} from "../zephyr/index.js";
import { DynamicFieldResolver, extractProjectKey } from "../config/helpers.js";
import { ConfigurationError } from "../config/types.js";

// Check if auto-creation of test tickets is enabled (default to true)
const autoCreateTestTickets = process.env.AUTO_CREATE_TEST_TICKETS !== "false";

// Register JIRA tools on the provided server instance
export function registerJiraTools(server: McpServer) {
  // Create ticket tool
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
      origination: z.string().optional(),
      project_key: z.string().optional(),
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
      origination,
      project_key,
    }) => {
      const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue`;
      const formattedDescription = formatDescription(description);

      // Create field resolver
      const fieldResolver = new DynamicFieldResolver();
      const resolvedProjectKey = extractProjectKey(project_key);
      
      if (resolvedProjectKey) {
        fieldResolver.setProjectKey(resolvedProjectKey);
      }

      // Determine if we should create a test ticket
      const shouldCreateTestTicket =
        create_test_ticket !== undefined
          ? create_test_ticket
          : autoCreateTestTickets;

      // Build the payload for the main ticket
      const payload: any = {
        fields: {
          project: {
            key: resolvedProjectKey || process.env.JIRA_PROJECT_KEY || "SCRUM",
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
        const acceptanceCriteriaField = await fieldResolver.getFieldId(
          'acceptanceCriteria',
          'JIRA_ACCEPTANCE_CRITERIA_FIELD'
        );

        if (acceptanceCriteriaField) {
          payload.fields[acceptanceCriteriaField] =
            formatAcceptanceCriteria(acceptance_criteria);
        } else {
          console.warn('Acceptance criteria field not configured for project. Use get-project-schema to configure fields.');
        }

        console.error(
          `Adding acceptance criteria to field ${acceptanceCriteriaField}`
        );
      }

      // Only add custom fields for Bug, Task, and Story issue types, not for Test
      if (issue_type !== "Test") {
        // Add product field if configured
        const productField = await fieldResolver.getFieldId('product', 'JIRA_PRODUCT_FIELD');
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
        const categoryField = await fieldResolver.getFieldId('category', 'JIRA_CATEGORY_FIELD');

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

        // Add origination field if provided or use default from env
        const originationField = await fieldResolver.getFieldId('origination', 'JIRA_ORIGINATION_FIELD');
        const defaultOrigination = origination || process.env.JIRA_DEFAULT_ORIGINATION_VALUE;
        const originationId = process.env.JIRA_DEFAULT_ORIGINATION_ID;

        if (originationField && defaultOrigination && originationId) {
          payload.fields[originationField] = [
            {
              self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${originationId}`,
              value: defaultOrigination,
              id: originationId,
            },
          ];
        }
      }

      // Add story points if provided
      if (story_points !== undefined) {
        const storyPointsField = await fieldResolver.getFieldId(
          'storyPoints',
          'JIRA_STORY_POINTS_FIELD'
        );
        
        if (storyPointsField) {
          payload.fields[storyPointsField] = story_points;
        } else {
          console.warn('Story points field not configured for project. Use get-project-schema to configure fields.');
        }
      }

      // Add parent epic if provided
      if (parent_epic !== undefined) {
        const epicLinkField = await fieldResolver.getFieldId(
          'epicLink',
          'JIRA_EPIC_LINK_FIELD'
        );
        
        if (epicLinkField) {
          payload.fields[epicLinkField] = parent_epic;
        } else {
          console.warn('Epic link field not configured for project. Use get-project-schema to configure fields.');
        }
      }

      // Add sprint if provided
      if (sprint !== undefined) {
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD');
        
        if (sprintField) {
          // Jira API requires numeric sprint ID, not name
          if (!isNaN(Number(sprint))) {
            payload.fields[sprintField] = Number(sprint);
          } else {
            console.warn(`Sprint field requires numeric ID. Use search-sprints to find sprint IDs. Got: ${sprint}`);
            // Try to extract ID if it looks like "123" or numeric string
            const numericValue = parseInt(String(sprint));
            if (!isNaN(numericValue)) {
              payload.fields[sprintField] = numericValue;
            } else {
              console.error(`Skipping sprint field - invalid format: ${sprint}`);
            }
          }
        } else {
          console.warn('Sprint field not configured for project. Use get-project-schema to configure fields.');
        }
      }

      // Add story readiness if provided
      if (story_readiness !== undefined) {
        const storyReadinessField = await fieldResolver.getFieldId('storyReadiness', 'JIRA_STORY_READINESS_FIELD');
        
        if (storyReadinessField) {
          const storyReadinessId = story_readiness === "Yes" ? "18256" : "18257";
          payload.fields[storyReadinessField] = {
            self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${storyReadinessId}`,
            value: story_readiness,
            id: storyReadinessId,
          };
        } else {
          console.warn('Story readiness field not configured for project. Use get-project-schema to configure fields.');
        }
      }

      // Check if we have configuration errors
      if (fieldResolver.hasErrors()) {
        const errors = fieldResolver.getErrors();
        const errorMessages = errors.map(e => 
          `${e.details.field}: ${e.details.message}`
        ).join('\n');
        
        return {
          content: [
            {
              type: "text" as const,
              text: `Configuration needed for project ${resolvedProjectKey}:\n${errorMessages}\n\nUse the 'configure-project-fields' tool to set up these fields.`,
            },
          ],
        };
      }

      // Create the auth token
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      // Create the main ticket
      const result = await createJiraTicket(payload, auth);

      if (!result.success) {
        // Check if it's a field-related error
        if (result.errorMessage?.includes('Field') || result.errorMessage?.includes('customfield')) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error creating ticket: ${result.errorMessage}\n\nThis might be a field configuration issue. Use 'configure-project-fields' to update the field mappings for project ${resolvedProjectKey}.`,
              },
            ],
          };
        }
        
        return {
          content: [
            {
              type: "text" as const,
              text: `Error creating ticket: ${result.errorMessage}`,
            },
          ],
        };
      }

      let responseText = `Created ticket: ${result.data.key}`;

      // Create test ticket if needed
      if (shouldCreateTestTicket && issue_type === "Story") {
        const testPayload: any = {
          fields: {
            project: {
              key: resolvedProjectKey || process.env.JIRA_PROJECT_KEY || "SCRUM",
            },
            summary: `Test: ${summary}`,
            description: formatDescription(
              `Test ticket for story ${result.data.key}`
            ),
            issuetype: {
              name: "Test",
            },
          },
        };

        const testResult = await createJiraTicket(testPayload, auth);

        if (testResult.success) {
          responseText += `\nCreated test ticket: ${testResult.data.key}`;

          // Link the test ticket to the story
          if (result.data.key && testResult.data.key) {
            const linkResult = await createTicketLink(
              result.data.key,
              testResult.data.key,
              "Tests",
              auth
            );

            if (linkResult.success) {
              responseText += `\nLinked test ticket to story`;
            }
          }

          // If acceptance criteria exists, convert to test steps
          if (acceptance_criteria) {
            try {
              const testSteps = acceptance_criteria
                .split(/\n+/)
                .filter((line) => line.trim())
                .map((line, index) => ({
                  description: line.trim(),
                  testData: "",
                  expectedResult: "Completed successfully",
                  orderId: index,
                }));

              for (const step of testSteps) {
                if (testResult.data.id) {
                  // We need to fetch the ticket to get project ID
                  const getUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${testResult.data.key}`;
                  const getResponse = await fetch(getUrl, {
                    method: "GET",
                    headers: {
                      Authorization: `Basic ${auth}`,
                    },
                  });
                  
                  if (getResponse.ok) {
                    const testTicketData = await getResponse.json() as any;
                    await addZephyrTestStep(
                      testResult.data.id,
                      testTicketData.fields.project.id,
                      step.description,
                      step.testData,
                      step.expectedResult
                    );
                  }
                }
              }

              responseText += `\nAdded ${testSteps.length} test steps to test ticket`;
            } catch (error) {
              console.error("Error adding test steps:", error);
              responseText += `\nWarning: Could not add test steps to test ticket`;
            }
          }
        }
      }

      // Get full ticket details with transitions
      const authForDetails = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");
      
      const detailsResult = await getFullTicketDetails(result.data.key || '', authForDetails);
      
      if (detailsResult.success) {
        let fullResponse = `Successfully created ticket!\n\n${detailsResult.ticketDetails}`;
        
        // Add test ticket info if created
        if (responseText.includes("Also created test ticket:")) {
          const testTicketMatch = responseText.match(/Also created test ticket: ([\w-]+)/);
          if (testTicketMatch) {
            fullResponse += `\n\n**Also created test ticket:** ${testTicketMatch[1]}`;
          }
        }
        
        return {
          content: [
            {
              type: "text" as const,
              text: fullResponse,
            },
          ],
        };
      } else {
        // Fallback to simple response if full details fail
        return {
          content: [
            {
              type: "text" as const,
              text: responseText,
            },
          ],
        };
      }
    }
  );

  // The rest of the tools would follow a similar pattern...
  // For now, I'll include the original implementations with TODO markers

  // Link tickets tool
  server.tool(
    "link-tickets",
    "Link two jira tickets",
    {
      outward_issue: z.string().min(1, "Outward issue is required"),
      inward_issue: z.string().min(1, "Inward issue is required"),
      link_type: z.string().default("Relates"),
    },
    async ({ outward_issue, inward_issue, link_type }) => {
      // TODO: Add dynamic configuration support
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const outwardIssueResult = await getJiraIssueId(outward_issue, auth);
      const inwardIssueResult = await getJiraIssueId(inward_issue, auth);

      if (!outwardIssueResult.success || !outwardIssueResult.id) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting outward issue: ${outwardIssueResult.errorMessage || 'Unknown error'}`,
            },
          ],
        };
      }

      if (!inwardIssueResult.success || !inwardIssueResult.id) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error getting inward issue: ${inwardIssueResult.errorMessage || 'Unknown error'}`,
            },
          ],
        };
      }

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
              type: "text" as const,
              text: `Error linking tickets: ${result.errorMessage}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully linked ${outward_issue} to ${inward_issue} with link type "${link_type}"`,
          },
        ],
      };
    }
  );

  // Debug Raw Ticket Data tool - temporary tool for investigating custom fields
  server.tool(
    "get-ticket-raw",
    "Get raw jira ticket data for debugging custom fields",
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

        const responseData = await response.json() as any;

        if (!response.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error fetching ticket: ${JSON.stringify(responseData, null, 2)}`,
              },
            ],
          };
        }

        // Find all custom fields that have a numeric value of 5
        const fields = responseData.fields || {};
        const customFieldsWithValue5: any[] = [];
        const allCustomFields: any[] = [];
        
        for (const [fieldId, value] of Object.entries(fields)) {
          if (fieldId.startsWith('customfield_')) {
            allCustomFields.push({ fieldId, value });
            if (value === 5 || (typeof value === 'number' && value === 5)) {
              customFieldsWithValue5.push({ fieldId, value });
            }
          }
        }

        let debugOutput = `**RAW JIRA DATA FOR TICKET: ${ticket_id}**\n\n`;
        
        // Show fields with value 5
        if (customFieldsWithValue5.length > 0) {
          debugOutput += `**CUSTOM FIELDS WITH VALUE 5:**\n`;
          customFieldsWithValue5.forEach(field => {
            debugOutput += `- ${field.fieldId}: ${JSON.stringify(field.value)}\n`;
          });
          debugOutput += '\n';
        } else {
          debugOutput += `**NO CUSTOM FIELDS WITH VALUE 5 FOUND**\n\n`;
        }

        // Show all custom fields for reference
        debugOutput += `**ALL CUSTOM FIELDS (${allCustomFields.length} total):**\n`;
        allCustomFields.forEach(field => {
          debugOutput += `- ${field.fieldId}: ${JSON.stringify(field.value)}\n`;
        });
        
        debugOutput += `\n**COMPLETE RAW JSON (fields only):**\n`;
        debugOutput += `\`\`\`json\n${JSON.stringify(fields, null, 2)}\n\`\`\``;

        return {
          content: [
            {
              type: "text" as const,
              text: debugOutput,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching ticket: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
        };
      }
    }
  );

  // Get ticket tool
  server.tool(
    "get-ticket",
    "Get a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      include_comments: z.boolean().optional().describe("Include comments in the response (default: false)"),
    },
    async ({ ticket_id, include_comments }) => {
      // TODO: Add dynamic configuration support
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

        const responseData = (await response.json()) as {
          id?: string;
          errorMessages?: string[];
          fields?: {
            project?: {
              id?: string;
            };
          };
        };

        if (!response.ok) {
          console.error("Error fetching ticket:", responseData);
          return {
            content: [
              {
                type: "text" as const,
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
                type: "text" as const,
                text: "Error: No ticket fields found in response",
              },
            ],
          };
        }

        // Extract and format key fields for better readability
        const fields = responseData.fields as any;
        const summary = fields.summary || 'No summary';
        const status = fields.status?.name || 'Unknown';
        const assignee = fields.assignee?.displayName || 'Unassigned';
        const priority = fields.priority?.name || 'Unknown';
        const issueType = fields.issuetype?.name || 'Unknown';
        // Get epic field dynamically
        const fieldResolver = new DynamicFieldResolver();
        const resolvedProjectKey = extractProjectKey(undefined, ticket_id);
        if (resolvedProjectKey) {
          fieldResolver.setProjectKey(resolvedProjectKey);
        }
        const epicField = await fieldResolver.getFieldId('epicLink', 'JIRA_EPIC_LINK_FIELD');
        const epic = fields.parent?.key || (epicField ? fields[epicField] : null) || 'No epic';
        
        // Extract sprint information dynamically
        let sprint = 'No sprint';
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD');
        if (sprintField && fields[sprintField] && Array.isArray(fields[sprintField]) && fields[sprintField].length > 0) {
          sprint = fields[sprintField][0].name || 'No sprint';
        }
        
        // Format description (handle Atlassian Document Format)
        let description = 'No description';
        if (fields.description?.content) {
          // Extract plain text from Atlassian Document Format
          description = fields.description.content
            .map((block: any) => {
              if (block.content) {
                return block.content
                  .map((item: any) => item.text || '')
                  .join('')
              }
              return '';
            })
            .join('\n')
            .trim() || 'No description';
        }

        // Get story points dynamically
        const storyPointsField = await fieldResolver.getFieldId('storyPoints', 'JIRA_STORY_POINTS_FIELD');
        const storyPoints = (storyPointsField ? fields[storyPointsField] : null) || 'No story points';

        let formattedOutput = `**JIRA Ticket: ${ticket_id}**

**Summary:** ${summary}
**Status:** ${status}
**Assignee:** ${assignee}
**Priority:** ${priority}
**Issue Type:** ${issueType}
**Epic:** ${epic}
**Sprint:** ${sprint}
**Story Points:** ${storyPoints}

**Description:**
${description}`;

        // Fetch comments if requested
        if (include_comments) {
          try {
            const commentsResult = await getJiraComments(ticket_id, auth);
            if (commentsResult.success && commentsResult.comments && commentsResult.comments.length > 0) {
              formattedOutput += `\n\n**Comments (${commentsResult.comments.length}):**\n`;
              
              commentsResult.comments.forEach((comment, index) => {
                const author = comment.author?.displayName || 'Unknown';
                const created = new Date(comment.created).toLocaleString();
                const updated = comment.updated !== comment.created 
                  ? ` (edited ${new Date(comment.updated).toLocaleString()})` 
                  : '';
                
                // Extract text from ADF body
                let commentText = 'No content';
                if (comment.body?.content) {
                  commentText = comment.body.content
                    .map((block: any) => {
                      if (block.type === 'paragraph' && block.content) {
                        return block.content
                          .map((item: any) => item.text || '')
                          .join('');
                      }
                      return '';
                    })
                    .join('\n')
                    .trim() || 'No content';
                }
                
                formattedOutput += `\n---\n**${author}** - ${created}${updated}\n*Comment ID: ${comment.id}*\n${commentText}`;
              });
            } else if (include_comments) {
              formattedOutput += '\n\n**Comments:** No comments found';
            }
          } catch (error) {
            console.error('Error fetching comments:', error);
            formattedOutput += '\n\n**Comments:** Error fetching comments';
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: formattedOutput,
            },
          ],
        };
      } catch (error) {
        console.error("Exception fetching ticket:", error);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error fetching ticket: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    }
  );

  // Search tickets tool
  server.tool(
    "search-tickets",
    "Search for jira tickets by issue type and optional labels",
    {
      issue_type: z.enum(["Bug", "Task", "Story", "Test"]),
      max_results: z.number().min(1).max(50).default(10).optional(),
      additional_criteria: z.string().optional(),
      project_key: z.string().optional(),
      labels: z.array(z.string()).optional().describe("Filter by specific labels"),
    },
    async ({ issue_type, max_results = 10, additional_criteria, project_key, labels }) => {
      // TODO: Add full dynamic configuration support
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const resolvedProjectKey = project_key || process.env.JIRA_PROJECT_KEY;
      
      let jql = `project = "${resolvedProjectKey}" AND issuetype = "${issue_type}"`;

      if (labels && labels.length > 0) {
        const labelQuery = labels.map(label => `"${label}"`).join(', ');
        jql += ` AND labels in (${labelQuery})`;
      }

      if (additional_criteria) {
        jql += ` AND (${additional_criteria})`;
      }

      const result = await searchJiraTickets(jql, max_results, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching tickets: ${result.errorMessage}`,
            },
          ],
        };
      }

      if (!result.data.issues || result.data.issues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: `No ${issue_type} tickets found in project ${resolvedProjectKey}.`,
            },
          ],
        };
      }

      const ticketList = result.data.issues
        .map((issue: any) => `• ${issue.key}: ${issue.fields.summary}`)
        .join("\n");

      return {
        content: [
          {
            type: "text" as const,
            text: `Found ${result.data.issues.length} ${issue_type} tickets:\n\n${ticketList}`,
          },
        ],
      };
    }
  );

  // Update ticket tool - now fully dynamic
  server.tool(
    "update-ticket",
    "Update a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      // Dynamic fields - any field that has been configured for the project
      summary: z.string().optional(),
      description: z.string().optional(),
      acceptance_criteria: z.string().optional(),
      story_points: z.number().optional(),
      parent: z.string().optional(),
      sprint: z.string().optional(),
      story_readiness: z.enum(["Yes", "No"]).optional(),
      origination: z.string().optional(),
      // Standard Jira fields that should work for any project
      labels: z.array(z.string()).optional(),
      priority: z.string().optional(),
      assignee: z.string().optional(),
      components: z.array(z.string()).optional(),
      environment: z.string().optional(),
      // Generic field update mechanism for any configured field
      custom_fields: z.record(z.any()).optional(),
    },
    async (params) => {
      const { ticket_id, custom_fields, ...standardFields } = params;
      // TODO: Add full dynamic configuration support
      const fieldResolver = new DynamicFieldResolver();
      const resolvedProjectKey = extractProjectKey(undefined, ticket_id);
      
      if (resolvedProjectKey) {
        fieldResolver.setProjectKey(resolvedProjectKey);
      }

      const payload: any = { fields: {} };

      // Handle standard Jira fields that don't need field resolution
      if (standardFields.summary !== undefined) {
        payload.fields.summary = standardFields.summary;
      }

      if (standardFields.description !== undefined) {
        payload.fields.description = formatDescription(standardFields.description);
      }

      if (standardFields.labels !== undefined) {
        payload.fields.labels = standardFields.labels;
      }

      if (standardFields.priority !== undefined) {
        payload.fields.priority = { name: standardFields.priority };
      }

      if (standardFields.assignee !== undefined) {
        payload.fields.assignee = { accountId: standardFields.assignee };
      }

      if (standardFields.components !== undefined) {
        payload.fields.components = standardFields.components.map(name => ({ name }));
      }

      if (standardFields.environment !== undefined) {
        payload.fields.environment = standardFields.environment;
      }

      // Handle configured custom fields dynamically
      const fieldsToResolve = {
        acceptance_criteria: standardFields.acceptance_criteria,
        story_points: standardFields.story_points,
        parent: standardFields.parent,
        sprint: standardFields.sprint,
        story_readiness: standardFields.story_readiness,
        origination: standardFields.origination,
      };

      // Process each configured field
      for (const [fieldName, value] of Object.entries(fieldsToResolve)) {
        if (value !== undefined) {
          const fieldId = await fieldResolver.getFieldId(fieldName, '');
          
          if (fieldId) {
            // Apply field-specific formatting
            switch (fieldName) {
              case 'acceptance_criteria':
                payload.fields[fieldId] = formatAcceptanceCriteria(value as string);
                break;
              case 'story_points':
                payload.fields[fieldId] = value;
                break;
              case 'parent':
                payload.fields[fieldId] = value;
                break;
              case 'sprint':
                // Jira API requires numeric sprint ID, not name
                // Accept both numeric ID and attempt to parse if it's a string ID
                if (!isNaN(Number(value))) {
                  payload.fields[fieldId] = Number(value);
                } else {
                  console.warn(`Sprint field requires numeric ID. Use search-sprints to find sprint IDs. Got: ${value}`);
                  // Try to extract ID if it looks like "123" or numeric string
                  const numericValue = parseInt(String(value));
                  if (!isNaN(numericValue)) {
                    payload.fields[fieldId] = numericValue;
                  } else {
                    // Skip this field as it won't work with name
                    console.error(`Skipping sprint field - invalid format: ${value}`);
                  }
                }
                break;
              case 'story_readiness':
                const storyReadinessId = value === "Yes" ? "18256" : "18257";
                payload.fields[fieldId] = {
                  self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${storyReadinessId}`,
                  value: value,
                  id: storyReadinessId,
                };
                break;
              case 'origination':
                const originationId = process.env.JIRA_DEFAULT_ORIGINATION_ID;
                if (originationId) {
                  payload.fields[fieldId] = [{
                    self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${originationId}`,
                    value: value,
                    id: originationId,
                  }];
                }
                break;
              default:
                payload.fields[fieldId] = value;
            }
          }
        }
      }

      // Handle any additional custom fields passed directly
      if (custom_fields) {
        for (const [fieldName, value] of Object.entries(custom_fields)) {
          const fieldId = await fieldResolver.getFieldId(fieldName, '');
          if (fieldId) {
            payload.fields[fieldId] = value;
          }
        }
      }

      // Check if we have configuration errors
      if (fieldResolver.hasErrors()) {
        const errors = fieldResolver.getErrors();
        const errorMessages = errors.map(e => 
          `${e.details.field}: ${e.details.message}`
        ).join('\n');
        
        return {
          content: [
            {
              type: "text" as const,
              text: `Configuration needed for project ${resolvedProjectKey}:\n${errorMessages}\n\nUse the 'configure-project-fields' tool to set up these fields.`,
            },
          ],
        };
      }

      // Check if there are any fields to update
      if (Object.keys(payload.fields).length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No fields provided to update.",
            },
          ],
        };
      }

      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await updateJiraTicket(ticket_id, payload, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error updating ticket: ${result.errorMessage}`,
            },
          ],
        };
      }

      // Get full ticket details with transitions after update
      const detailsResult = await getFullTicketDetails(ticket_id, auth);
      
      if (detailsResult.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully updated ticket!\n\n${detailsResult.ticketDetails}`,
            },
          ],
        };
      } else {
        // Fallback to simple response if full details fail
        return {
          content: [
            {
              type: "text" as const,
              text: `Successfully updated ticket ${ticket_id}`,
            },
          ],
        };
      }
    }
  );

  // Search sprint tickets tool
  server.tool(
    "search-sprint-tickets",
    "Search for tickets in current sprint, optionally filtered by assignee",
    {
      project_key: z.string().optional(),
      assignee: z.string().optional().describe("Email address or username to filter by assignee"),
      sprint_name: z.string().optional().describe("Specific sprint name to search (if not provided, searches active sprints)"),
      max_results: z.number().min(1).max(50).default(10),
    },
    async ({ project_key, assignee, sprint_name, max_results }) => {
      // Build JQL query
      let jql = "";
      
      if (project_key) {
        jql += `project = "${project_key}"`;
      }
      
      // Add sprint filter
      if (sprint_name) {
        if (jql) jql += " AND ";
        jql += `sprint = "${sprint_name}"`;
      } else {
        if (jql) jql += " AND ";
        jql += "sprint in openSprints()";
      }
      
      // Add assignee filter if provided
      if (assignee) {
        jql += ` AND assignee = "${assignee}"`;
      }
      
      // Order by priority and updated date
      jql += " ORDER BY priority DESC, updated DESC";

      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await searchJiraTickets(jql, max_results as number, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error searching sprint tickets: ${result.errorMessage}`,
            },
          ],
        };
      }

      const issues = result.data.issues || [];
      
      if (issues.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No tickets found matching the search criteria.",
            },
          ],
        };
      }

      // Format the results
      let output = `**Sprint Tickets (${issues.length} found)**\n\n`;
      
      issues.forEach((issue: any) => {
        const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : "Unassigned";
        const priority = issue.fields.priority ? issue.fields.priority.name : "No Priority";
        const status = issue.fields.status ? issue.fields.status.name : "No Status";
        
        output += `**${issue.key}** - ${issue.fields.summary}\n`;
        output += `  Status: ${status} | Priority: ${priority} | Assignee: ${assigneeName}\n`;
        
        // Note: Sprint field access is hardcoded here - would need project key to resolve dynamically
        // For now, keeping the hardcoded field but adding a comment about the limitation
        if (issue.fields.customfield_10020 && issue.fields.customfield_10020.length > 0) {
          const sprint = issue.fields.customfield_10020[issue.fields.customfield_10020.length - 1];
          if (sprint.name) {
            output += `  Sprint: ${sprint.name}\n`;
          }
        }
        
        output += `  Link: https://${process.env.JIRA_HOST}/browse/${issue.key}\n\n`;
      });

      return {
        content: [
          {
            type: "text" as const,
            text: output,
          },
        ],
      };
    }
  );

  // Add comment tool
  server.tool(
    "add-comment",
    "Add a comment to a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      comment: z.string().min(1, "Comment text is required"),
    },
    async ({ ticket_id, comment }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await addJiraComment(ticket_id, comment, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error adding comment to ticket: ${result.errorMessage}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully added comment to ticket ${ticket_id}`,
          },
        ],
      };
    }
  );

  // Edit comment tool
  server.tool(
    "edit-comment",
    "Edit an existing comment on a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      comment_id: z.string().min(1, "Comment ID is required"),
      new_comment: z.string().min(1, "New comment text is required"),
    },
    async ({ ticket_id, comment_id, new_comment }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await updateJiraComment(ticket_id, comment_id, new_comment, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error editing comment: ${result.errorMessage}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully edited comment ${comment_id} on ticket ${ticket_id}`,
          },
        ],
      };
    }
  );

  // Delete comment tool
  server.tool(
    "delete-comment",
    "Delete a comment from a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      comment_id: z.string().min(1, "Comment ID is required"),
    },
    async ({ ticket_id, comment_id }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await deleteJiraComment(ticket_id, comment_id, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error deleting comment: ${result.errorMessage}`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully deleted comment ${comment_id} from ticket ${ticket_id}`,
          },
        ],
      };
    }
  );

  // Upload attachment tool
  server.tool(
    "upload-attachment",
    "Upload a file attachment to a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      file_name: z.string().min(1, "File name is required"),
      file_content: z.string().min(1, "File content (base64 encoded) is required"),
      mime_type: z.string().default("application/octet-stream"),
    },
    async ({ ticket_id, file_name, file_content, mime_type }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await uploadJiraAttachment(ticket_id, file_name, file_content, mime_type, auth);

      if (!result.success) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Error uploading attachment to ticket: ${result.errorMessage}`,
            },
          ],
        };
      }

      // Format response with attachment details
      let output = `Successfully uploaded attachment to ticket ${ticket_id}\n\n`;
      
      if (result.attachments && result.attachments.length > 0) {
        result.attachments.forEach((attachment) => {
          output += `**Attachment Details:**\n`;
          output += `- File: ${attachment.filename}\n`;
          output += `- Size: ${Math.round(attachment.size / 1024)} KB\n`;
          output += `- Type: ${attachment.mimeType}\n`;
          output += `- ID: ${attachment.id}\n\n`;
          output += `**Reference in Jira:**\n`;
          output += `To reference this attachment in comments or descriptions, use:\n`;
          output += `!${attachment.filename}!\n\n`;
          output += `**Download URL:**\n`;
          output += `${attachment.content}\n`;
        });
      }

      return {
        content: [
          {
            type: "text" as const,
            text: output,
          },
        ],
      };
    }
  );

  // Get project schema tool - returns all fields and available transitions
  server.tool(
    "get-project-schema",
    "Get comprehensive schema for a Jira project including all fields and transitions",
    {
      project_key: z.string().optional(),
      include_transitions: z.boolean().default(true),
      sample_ticket: z.string().optional().describe("Ticket ID to use for transition discovery"),
    },
    async ({ project_key, include_transitions, sample_ticket }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const resolvedProjectKey = project_key || process.env.JIRA_PROJECT_KEY;
      
      // Get all fields
      const fieldsResult = await getJiraFields(auth);
      if (!fieldsResult.success) {
        return {
          content: [{
            type: "text" as const,
            text: `Error fetching fields: ${fieldsResult.errorMessage}`,
          }],
        };
      }

      // Filter fields relevant to the project (remove global ones that don't apply)
      const relevantFields = fieldsResult.fields?.filter(field => {
        // Include standard fields and project-specific custom fields
        return !field.custom || 
               !field.scope || 
               field.scope.type === 'GLOBAL' ||
               (field.scope.project?.id && field.scope.project.id === resolvedProjectKey);
      }) || [];

      let output = `**Project Schema for ${resolvedProjectKey}**\n\n`;
      output += `**Fields (${relevantFields.length} available):**\n\n`;

      // Get user preferences
      const prefs = preferencesManager.getProjectPreferences(resolvedProjectKey || 'VIP');
      const defaultFields = preferencesManager.getDefaultImportantFields();

      relevantFields.forEach(field => {
        const isImportant = preferencesManager.isFieldImportant(resolvedProjectKey || 'VIP', field.name.toLowerCase().replace(/\s+/g, '_'));
        const isIgnored = preferencesManager.isFieldIgnored(resolvedProjectKey || 'VIP', field.id);
        
        let status = '';
        if (isImportant) status = ' ⭐ (important)';
        if (isIgnored) status = ' 🚫 (ignored)';
        
        output += `• **${field.name}** (${field.id})${status}\n`;
        if (field.description) {
          output += `  Description: ${field.description}\n`;
        }
        const fieldType = field.schema?.type || 'unknown';
        output += `  Type: ${fieldType}`;
        if (fieldType === 'user') {
          output += ` (requires Account ID - use search-users first)`;
        }
        output += '\n';
        
        if (field.allowedValues && field.allowedValues.length > 0) {
          output += `  Values: ${field.allowedValues.map(v => v.value || v.name).slice(0, 5).join(', ')}${field.allowedValues.length > 5 ? '...' : ''}\n`;
        }
        output += '\n';
      });

      // Get transitions if requested
      if (include_transitions && sample_ticket) {
        const transitionsResult = await getJiraTransitions(sample_ticket, auth);
        if (transitionsResult.success && transitionsResult.transitions) {
          output += `**Available Transitions for ${sample_ticket}:**\n\n`;
          transitionsResult.transitions.forEach(transition => {
            output += `• **${transition.name}** → ${transition.to.name} (ID: ${transition.id})\n`;
          });
          output += '\n';
        }
      }

      output += `**Important Fields (defaults + learned):**\n`;
      defaultFields.forEach(field => {
        const mapping = preferencesManager.getFieldMapping(resolvedProjectKey || 'VIP', field);
        if (mapping) {
          output += `• ${field} → ${mapping}\n`;
        } else {
          output += `• ${field} (not yet configured)\n`;
        }
      });

      output += `\n**Usage Instructions:**\n`;
      output += `• Use these field names when creating or updating tickets\n`;
      output += `• The LLM can ask users which fields they care about for this project\n`;
      output += `• Fields marked with ⭐ are considered important for this project\n`;
      output += `• Use transition-ticket to change status using the transition names shown\n`;

      return {
        content: [{
          type: "text" as const,
          text: output,
        }],
      };
    }
  );

  // Transition ticket status tool
  server.tool(
    "transition-ticket",
    "Change the status of a Jira ticket using available transitions",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
      target_status: z.string().min(1, "Target status name is required"),
      comment: z.string().optional(),
    },
    async ({ ticket_id, target_status, comment }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      // Get available transitions
      const transitionsResult = await getJiraTransitions(ticket_id, auth);
      if (!transitionsResult.success) {
        return {
          content: [{
            type: "text" as const,
            text: `Error fetching transitions: ${transitionsResult.errorMessage}`,
          }],
        };
      }

      // Find matching transition
      const transitions = transitionsResult.transitions || [];
      const matchingTransition = transitions.find(t => 
        t.to.name.toLowerCase() === target_status.toLowerCase() ||
        t.name.toLowerCase().includes(target_status.toLowerCase())
      );

      if (!matchingTransition) {
        const availableStatuses = transitions.map(t => `"${t.to.name}" (via "${t.name}")`).join(', ');
        return {
          content: [{
            type: "text" as const,
            text: `No transition found to "${target_status}". Available transitions: ${availableStatuses}`,
          }],
        };
      }

      // Execute transition
      const result = await transitionJiraTicket(ticket_id, matchingTransition.id, comment, auth);
      
      if (!result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `Error transitioning ticket: ${result.errorMessage}`,
          }],
        };
      }

      return {
        content: [{
          type: "text" as const,
          text: `Successfully transitioned ${ticket_id} to "${matchingTransition.to.name}" using "${matchingTransition.name}"${comment ? ' with comment' : ''}`,
        }],
      };
    }
  );

  // Search users tool
  server.tool(
    "search-users",
    "Search for Jira users by name or email. IMPORTANT: When assigning tickets or setting user fields, you MUST first search for the user to get their accountId, then use that accountId in the update.",
    {
      query: z.string().min(1).describe("User's name or email address to search for"),
    },
    async ({ query }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await searchJiraUsers(query, auth);

      if (!result.success) {
        return {
          content: [{
            type: "text" as const,
            text: `Error searching users: ${result.errorMessage}`,
          }],
        };
      }

      const users = result.users || [];
      
      if (users.length === 0) {
        return {
          content: [{
            type: "text" as const,
            text: `No users found matching "${query}"`,
          }],
        };
      }

      let output = `**Found ${users.length} user(s):**\n\n`;
      
      users.forEach((user, index) => {
        output += `**${index + 1}. ${user.displayName}**\n`;
        output += `• Account ID: ${user.accountId}\n`;
        output += `• Email: ${user.emailAddress || 'Not available'}\n`;
        output += `• Active: ${user.active ? 'Yes' : 'No'}\n`;
        output += `• Type: ${user.accountType}\n\n`;
      });

      if (users.length === 1) {
        output += `**To assign this user to a ticket, use:**\n`;
        output += `Account ID: ${users[0].accountId}\n`;
      } else {
        output += `**Note:** Multiple users found. Use the specific Account ID for the user you want.\n`;
      }

      output += `\n**Important:** When updating assignee or any user field, you MUST use the Account ID, not the display name or email.`;

      return {
        content: [{
          type: "text" as const,
          text: output,
        }],
      };
    }
  );

  // Get formatting help tool
  server.tool(
    "get-formatting-help",
    "Get help with Jira formatting syntax for descriptions and comments",
    {},
    async () => {
      const helpText = `**Jira Formatting Guide**

## Basic Markdown
- **Bold**: **text** 
- *Italic*: *text*
- Headers: ## Header 2, ### Header 3
- Lists: - item or * item

## Advanced Jira Elements

### Info Panels
Use panels to highlight important information:
\`\`\`
:::info
This is an informational message
:::

:::warning
This is a warning message
:::

:::error
This is an error message
:::

:::success
This is a success message
:::

:::note
This is a note
:::
\`\`\`

### Quote Blocks
\`\`\`
:::quote
This is a quoted text block
:::
\`\`\`

### Code Blocks
Include code with syntax highlighting:
\`\`\`
\\\`\\\`\\\`javascript
function hello() {
    console.log("Hello World");
}
\\\`\\\`\\\`
\`\`\`
Supported languages: javascript, python, java, sql, json, xml, yaml, bash, and more.

### Status Badges
Show status indicators inline:
\`\`\`
@status[Done|green] - Task completed
@status[In Progress|blue] - Currently working
@status[To Do|neutral] - Not started
@status[Blocked|red] - Issue blocked
\`\`\`
Colors: green, blue, neutral, red, purple, yellow

### Expandable Sections
Create collapsible content:
\`\`\`
:::expand Click to see more details
Hidden content goes here.
Can include multiple paragraphs.
:::
\`\`\`

### Dividers
Add horizontal lines to separate content:
\`\`\`
---
\`\`\`

### Emojis
Use emoji shortcuts like:
- :smile: :grin: :joy: - Happy faces
- :thumbsup: :thumbsdown: - Feedback
- :white_check_mark: :x: - Status indicators
- :warning: :bulb: :fire: - Attention
- :rocket: :star: :tada: - Celebration
- :bug: :zap: :lock: - Development

## Semantic Usage Guide - When to Use Each Element

### Panel Types & Their Purpose:
- **:::info (blue)**: Key information, system requirements, important context
- **:::note (purple)**: Historical context, background information, related tickets, previous decisions
- **:::warning (yellow/orange)**: Caution items, potential issues, things to watch out for
- **:::error (red)**: Critical problems, blockers, failed processes, urgent attention needed  
- **:::success (green)**: Completed work, successful outcomes, positive results
- **:::quote**: External sources, customer feedback, requirements from stakeholders

### Status Badge Colors:
- **green**: Completed, working, success states
- **blue**: In progress, active work, current status
- **neutral/gray**: To do, planned, not started
- **red**: Blocked, failed, error states
- **purple**: Review needed, special attention
- **yellow**: Warning, needs caution

### Content Organization:
- **Headers (##, ###)**: Structure your content, create clear sections
- **Code Blocks**: API examples, configuration snippets, command line instructions
- **Expandable Sections**: Detailed logs, step-by-step instructions, verbose explanations
- **Dividers (---)**: Separate major sections, create visual breaks
- **Bullet Lists**: Action items, requirements, feature lists
- **Emojis**: Quick visual scanning - ✅ done, ❌ failed, ⚠️ warning, 🚀 deployment, 🐛 bug

### Example Ticket Structure:
\`\`\`
:::note  
Historical Context: This relates to ticket ABC-123 where we decided to migrate from X to Y.
:::

## Problem Statement
Description of the issue...

:::warning
Breaking Change: This will affect existing integrations.
:::

## Acceptance Criteria
- [ ] Requirement 1
- [ ] Requirement 2

@status[To Do|neutral] Ready for development

\\\`\\\`\\\`bash
# Example command
npm run build
\\\`\\\`\\\`

:::expand Technical Details
Detailed implementation notes go here...
:::
\`\`\`

This structure helps create professional, scannable tickets that communicate clearly to both technical and non-technical stakeholders.`;

      return {
        content: [{
          type: "text" as const,
          text: helpText,
        }],
      };
    }
  );

  // Search sprints tool - for LLMs to discover sprint IDs
  server.tool(
    "search-sprints",
    "Search for active and recent sprints to get sprint IDs for ticket assignment. Use this before assigning tickets to sprints.",
    {
      project_key: z.string().optional(),
      include_future: z.boolean().default(false).describe("Include future sprints in results"),
      max_results: z.number().min(1).max(20).default(10),
    },
    async ({ project_key, include_future, max_results }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const resolvedProjectKey = project_key || process.env.JIRA_PROJECT_KEY;
      
      // Build JQL to find sprints
      let jql = "";
      if (resolvedProjectKey) {
        jql = `project = "${resolvedProjectKey}"`;
      }
      
      // Add sprint state filters
      if (include_future) {
        jql += jql ? " AND " : "";
        jql += "sprint in (openSprints(), futureSprints())";
      } else {
        jql += jql ? " AND " : "";
        jql += "sprint in (openSprints())";
      }
      
      jql += " ORDER BY updated DESC";

      try {
        const searchResult = await searchJiraTickets(jql, max_results, auth);
        
        if (!searchResult.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Error searching for sprint tickets: ${searchResult.errorMessage}`,
            }],
          };
        }

        // Extract unique sprints from tickets
        const sprintSet = new Set();
        const sprintDetails: any[] = [];
        
        if (searchResult.data.issues) {
          searchResult.data.issues.forEach((issue: any) => {
            // Check for sprint field (typically customfield_10020)
            if (issue.fields.customfield_10020 && Array.isArray(issue.fields.customfield_10020)) {
              issue.fields.customfield_10020.forEach((sprint: any) => {
                if (sprint.id && !sprintSet.has(sprint.id)) {
                  sprintSet.add(sprint.id);
                  sprintDetails.push({
                    id: sprint.id,
                    name: sprint.name || 'Unnamed Sprint',
                    state: sprint.state || 'unknown',
                    startDate: sprint.startDate ? new Date(sprint.startDate).toLocaleDateString() : 'Not set',
                    endDate: sprint.endDate ? new Date(sprint.endDate).toLocaleDateString() : 'Not set',
                  });
                }
              });
            }
          });
        }

        if (sprintDetails.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No active sprints found in project ${resolvedProjectKey}. This could mean:\n• Project has no active sprints\n• Sprint field mapping needs configuration\n• Project key is incorrect`,
            }],
          };
        }

        // Sort sprints by state (active first, then future)
        sprintDetails.sort((a, b) => {
          const stateOrder: { [key: string]: number } = { 'ACTIVE': 0, 'FUTURE': 1, 'CLOSED': 2, 'unknown': 3 };
          return (stateOrder[a.state] || 3) - (stateOrder[b.state] || 3);
        });

        let output = `**Available Sprints in ${resolvedProjectKey}**\n\n`;
        
        sprintDetails.forEach(sprint => {
          const stateEmoji = sprint.state === 'ACTIVE' ? '🟢' : sprint.state === 'FUTURE' ? '🔵' : '⚫';
          output += `${stateEmoji} **${sprint.name}** (ID: ${sprint.id})\n`;
          output += `  State: ${sprint.state}\n`;
          output += `  Dates: ${sprint.startDate} → ${sprint.endDate}\n\n`;
        });

        output += `**To assign a ticket to a sprint:**\n`;
        output += `Use the sprint ID (not name) in update-ticket or create-ticket:\n`;
        output += `Example: \`sprint: "${sprintDetails[0]?.id || 'SPRINT_ID'}"\`\n\n`;
        output += `**Note:** Sprint assignment requires the numeric sprint ID, not the sprint name.`;

        return {
          content: [{
            type: "text" as const,
            text: output,
          }],
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error searching sprints: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // Debug tool to inspect raw ticket data
  server.tool(
    "debug-raw-ticket",
    "Get raw ticket data to inspect custom fields (debug tool)",
    {
      ticket_id: z.string().min(1).describe("Ticket ID to get raw data for"),
    },
    async ({ ticket_id }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await getRawTicketData(ticket_id, auth);
      
      if (!result.success) {
        return {
          content: [{ type: "text", text: `Error getting raw ticket data: ${result.errorMessage}` }]
        };
      }

      // Find all custom fields and their values
      const customFields: any[] = [];
      for (const [key, value] of Object.entries(result.rawData.fields)) {
        if (key.startsWith('customfield_') && value !== null && value !== undefined) {
          customFields.push({ field: key, value: value });
        }
      }

      return {
        content: [{ 
          type: "text", 
          text: `**Raw Custom Fields for ${ticket_id}:**\n\n` +
                customFields.map(cf => `• **${cf.field}**: ${JSON.stringify(cf.value, null, 2)}`).join('\n\n')
        }]
      };
    }
  );
}