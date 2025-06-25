import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fetch from "node-fetch";
import { createJiraTicket, createTicketLink, searchJiraTickets, updateJiraTicket, addJiraComment, uploadJiraAttachment, getJiraFields, getJiraTransitions, transitionJiraTicket, getJiraComments, getJiraAttachments, deleteJiraAttachment, getRawTicketData } from "./api.js";
import { updateJiraComment, deleteJiraComment, getFullTicketDetails, searchJiraUsers, validateEpic, resolveEpicKey, validateComponents, getProjectComponents, resolveUser, resolveSprintId, validateTicketKey, getErrorSuggestions } from "./api-extended.js";
import { preferencesManager } from "./preferences.js";
import { formatDescription, formatAcceptanceCriteria } from "./formatting.js";
import { getJiraIssueId } from "../utils.js";
import { 
  getZephyrTestSteps, 
  addZephyrTestStep 
} from "../zephyr/index.js";
import { DynamicFieldResolver, extractProjectKey, extractProjectKeyWithDefault } from "../config/helpers.js";
import { ConfigurationError } from "../config/types.js";
import { configManager } from "../config/tools.js";

// Check if auto-creation of test tickets is enabled (default to true)
const autoCreateTestTickets = process.env.AUTO_CREATE_TEST_TICKETS !== "false";

// Register JIRA tools on the provided server instance
export function registerJiraTools(server: McpServer) {
  // Create ticket tool
  server.tool(
    "create-ticket",
    "Create a jira ticket. When user asks to create a ticket in an epic but doesn't specify which one, use search-epics first to list available epics.",
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
      components: z.array(z.string()).optional().describe("Array of component names"),
      priority: z.string().optional().describe("Priority level (Low, Medium, High, Critical)"),
      labels: z.array(z.string()).optional().describe("Array of labels to add"),
      assignee: z.string().optional().describe("Email address, display name, or Account ID of assignee"),
      link_to: z.array(z.string()).optional().describe("Array of ticket keys to link to (e.g., ['VIP-123', 'VIP-456'])"),
      link_type: z.string().optional().default("Relates").describe("Type of link (default: 'Relates')"),
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
      components,
      priority,
      labels,
      assignee,
      link_to,
      link_type,
    }) => {
      const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue`;
      const formattedDescription = formatDescription(description);

      // Create field resolver
      const fieldResolver = new DynamicFieldResolver();
      const resolvedProjectKey = await extractProjectKeyWithDefault(project_key);
      
      fieldResolver.setProjectKey(resolvedProjectKey);

      // Determine if we should create a test ticket
      const shouldCreateTestTicket =
        create_test_ticket !== undefined
          ? create_test_ticket
          : autoCreateTestTickets;

      // Build the payload for the main ticket
      const payload: any = {
        fields: {
          project: {
            key: resolvedProjectKey,
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
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");
        
        // Validate and resolve epic
        const epicValidation = await validateEpic(parent_epic, auth);
        
        if (!epicValidation.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Epic validation failed: ${epicValidation.errorMessage}\n\n` +
                    `**Epic format help:**\n` +
                    `• Use epic key: VIP-123\n` +
                    `• Or epic name: "User Authentication Epic"\n` +
                    `• Epic must exist and be of type "Epic"`
            }],
          };
        }
        
        if (epicValidation.epicKey) {
          // Use modern parent field format (JIRA API v3 standard)
          payload.fields.parent = {
            key: epicValidation.epicKey
          };
          console.log(`Successfully linked to epic: ${epicValidation.epicKey} - ${epicValidation.epicSummary}`);
        }
      }

      // Add sprint if provided
      if (sprint !== undefined) {
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");
        
        // Resolve sprint input to sprint ID
        const sprintResolution = await resolveSprintId(sprint, resolvedProjectKey || 'VIP', auth);
        
        if (!sprintResolution.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Sprint resolution failed: ${sprintResolution.errorMessage}\n\n` +
                    `**Sprint format help:**\n` +
                    `• Use "current" for active sprint\n` +
                    `• Use sprint ID: "1234"\n` +
                    `• Use sprint name: "Sprint 2025_C1_S07"\n` +
                    `• Use search-sprints or get-current-sprint to find available sprints`
            }],
          };
        }
        
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD');
        
        if (sprintField && sprintResolution.sprintId) {
          payload.fields[sprintField] = Number(sprintResolution.sprintId);
          console.log(`Successfully resolved sprint: ${sprint} → Sprint ID ${sprintResolution.sprintId}`);
        } else if (!sprintField) {
          return {
            content: [{
              type: "text" as const,
              text: `Sprint field not configured for project. Use get-project-schema to configure fields.`
            }],
          };
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

      // Add components if provided
      if (components !== undefined && components.length > 0) {
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");
        
        const componentsValidation = await validateComponents(components, resolvedProjectKey || 'VIP', auth);
        
        if (!componentsValidation.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Components validation failed: ${componentsValidation.errorMessage}`
            }],
          };
        }
        
        if (componentsValidation.components) {
          payload.fields.components = componentsValidation.components;
        }
      }

      // Add priority if provided
      if (priority !== undefined) {
        payload.fields.priority = { name: priority };
      }

      // Add labels if provided
      if (labels !== undefined && labels.length > 0) {
        payload.fields.labels = labels;
      }

      // Add assignee if provided
      if (assignee !== undefined) {
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");
        
        const userResolution = await resolveUser(assignee, auth, resolvedProjectKey);
        
        if (!userResolution.success) {
          return {
            content: [{
              type: "text" as const,
              text: `User resolution failed: ${userResolution.errorMessage}\n\n` +
                    `**Assignee format help:**\n` +
                    `• Use email: "user@company.com"\n` +
                    `• Use display name: "John Doe"\n` +
                    `• Use Account ID: "5f8a1b2c3d4e5f6789012345"\n` +
                    `• Use search-users tool to find the correct user`
            }],
          };
        }
        
        if (userResolution.accountId) {
          payload.fields.assignee = { accountId: userResolution.accountId };
          console.log(`Successfully resolved assignee: ${assignee} → ${userResolution.displayName} (${userResolution.accountId})`);
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

      const createdKey = result.data.key;
      if (!createdKey) {
        return {
          content: [{
            type: "text" as const,
            text: `Error: Ticket was created but no key was returned in response.`
          }],
        };
      }
      
      let responseText = `Created ticket: ${createdKey}`;

      // Create links if provided
      if (link_to && link_to.length > 0) {
        const linkResults: string[] = [];
        const linkErrors: string[] = [];
        const linkTypeToUse = link_type || "Relates";
        
        // Validate all ticket keys first
        for (const targetTicket of link_to) {
          const validation = validateTicketKey(targetTicket);
          if (!validation.isValid) {
            linkErrors.push(`${validation.errorMessage}`);
            continue;
          }
        }
        
        // Only proceed with linking if all keys are valid
        if (linkErrors.length === 0) {
          for (const targetTicket of link_to) {
          try {
            const linkResult = await createTicketLink(
              createdKey, // outward (newly created ticket)
              targetTicket,     // inward (target ticket)
              linkTypeToUse,
              auth
            );
            
            if (linkResult.success) {
              linkResults.push(`${createdKey} ${linkTypeToUse} ${targetTicket}`);
            } else {
              linkErrors.push(`Failed to link to ${targetTicket}: ${linkResult.errorMessage}`);
            }
          } catch (error) {
            linkErrors.push(`Error linking to ${targetTicket}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        }
        
        if (linkResults.length > 0) {
          responseText += `\n\nLinks created:\n• ${linkResults.join('\n• ')}`;
        }
        
        if (linkErrors.length > 0) {
          responseText += `\n\nLink errors:\n• ${linkErrors.join('\n• ')}`;
        }
      }

      // Create test ticket if needed
      if (shouldCreateTestTicket && issue_type === "Story") {
        const testPayload: any = {
          fields: {
            project: {
              key: resolvedProjectKey || process.env.JIRA_PROJECT_KEY || "SCRUM",
            },
            summary: `Test: ${summary}`,
            description: formatDescription(
              `Test ticket for story ${createdKey}`
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
          if (createdKey && testResult.data.key) {
            const linkResult = await createTicketLink(
              createdKey,
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
      
      const detailsResult = await getFullTicketDetails(createdKey, authForDetails);
      
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
      issue_type: z.enum(["Bug", "Task", "Story", "Test", "Epic"]),
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

      const resolvedProjectKey = await configManager.getProjectKeyWithFallback(project_key);
      
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
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");
        
        const userResolution = await resolveUser(standardFields.assignee, auth, resolvedProjectKey);
        
        if (!userResolution.success) {
          return {
            content: [{
              type: "text" as const,
              text: `User resolution failed: ${userResolution.errorMessage}\n\n` +
                    `**Assignee format help:**\n` +
                    `• Use email: "user@company.com"\n` +
                    `• Use display name: "John Doe"\n` +
                    `• Use Account ID: "5f8a1b2c3d4e5f6789012345"\n` +
                    `• Use search-users tool to find the correct user`
            }],
          };
        }
        
        if (userResolution.accountId) {
          payload.fields.assignee = { accountId: userResolution.accountId };
        }
      }

      if (standardFields.components !== undefined) {
        // Validate components exist in the project
        if (standardFields.components.length > 0) {
          const auth = Buffer.from(
            `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
          ).toString("base64");
          
          const componentsValidation = await validateComponents(
            standardFields.components, 
            resolvedProjectKey || 'VIP', 
            auth
          );
          
          if (!componentsValidation.success) {
            return {
              content: [{
                type: "text" as const,
                text: `Components validation failed: ${componentsValidation.errorMessage}`
              }],
            };
          }
          
          if (componentsValidation.components) {
            payload.fields.components = componentsValidation.components;
          }
        } else {
          // Clear components if empty array
          payload.fields.components = [];
        }
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
                // Validate epic if parent is being set
                if (value) {
                  const auth = Buffer.from(
                    `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
                  ).toString("base64");
                  
                  const epicValidation = await validateEpic(value as string, auth);
                  
                  if (!epicValidation.success) {
                    return {
                      content: [{
                        type: "text" as const,
                        text: `Epic validation failed: ${epicValidation.errorMessage}\n\n` +
                              `**Epic format help:**\n` +
                              `• Use epic key: VIP-123\n` +
                              `• Or epic name: "User Authentication Epic"\n` +
                              `• Epic must exist and be of type "Epic"`
                      }],
                    };
                  }
                  
                  // Use modern parent field format instead of custom field
                  payload.fields.parent = {
                    key: epicValidation.epicKey
                  };
                  // Skip setting the fieldId since we're using the standard parent field
                  continue;
                } else {
                  // Clear parent relationship
                  payload.fields.parent = null;
                  continue;
                }
              case 'sprint':
                // Resolve sprint input to sprint ID using smart resolution
                const auth = Buffer.from(
                  `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
                ).toString("base64");
                
                const sprintResolution = await resolveSprintId(String(value), resolvedProjectKey || 'VIP', auth);
                
                if (!sprintResolution.success) {
                  return {
                    content: [{
                      type: "text" as const,
                      text: `Sprint resolution failed: ${sprintResolution.errorMessage}\n\n` +
                            `**Sprint format help:**\n` +
                            `• Use "current" for active sprint\n` +
                            `• Use sprint ID: "1234"\n` +
                            `• Use sprint name: "Sprint 2025_C1_S07"\n` +
                            `• Use search-sprints or get-current-sprint to find available sprints`
                    }],
                  };
                }
                
                if (sprintResolution.sprintId) {
                  payload.fields[fieldId] = Number(sprintResolution.sprintId);
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
      
      // Get dynamic sprint field outside the loop
      const fieldResolver = new DynamicFieldResolver();
      const resolvedProjectKey = extractProjectKey(project_key);
      if (resolvedProjectKey) {
        fieldResolver.setProjectKey(resolvedProjectKey);
      }
      const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
      
      issues.forEach((issue: any) => {
        const assigneeName = issue.fields.assignee ? issue.fields.assignee.displayName : "Unassigned";
        const priority = issue.fields.priority ? issue.fields.priority.name : "No Priority";
        const status = issue.fields.status ? issue.fields.status.name : "No Status";
        
        output += `**${issue.key}** - ${issue.fields.summary}\n`;
        output += `  Status: ${status} | Priority: ${priority} | Assignee: ${assigneeName}\n`;
        
        if (issue.fields[sprintField] && issue.fields[sprintField].length > 0) {
          const sprint = issue.fields[sprintField][issue.fields[sprintField].length - 1];
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

      const resolvedProjectKey = await configManager.getProjectKeyWithFallback(project_key);
      
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

      // Get project components
      const componentsResult = await getProjectComponents(resolvedProjectKey || 'VIP', auth);
      
      let output = `**Project Schema for ${resolvedProjectKey}**\n\n`;
      
      // Add project components section
      if (componentsResult.success && componentsResult.components) {
        output += `**Project Components (${componentsResult.components.length} available):**\n`;
        if (componentsResult.components.length > 0) {
          componentsResult.components.forEach(comp => {
            output += `• **${comp.name}**`;
            if (comp.description) {
              output += ` - ${comp.description}`;
            }
            output += '\n';
          });
        } else {
          output += '• No components configured for this project\n';
        }
        output += '\n';
      }
      
      output += `**Fields (${relevantFields.length} available):**\n\n`;

      // Get user preferences
      const prefs = preferencesManager.getProjectPreferences(resolvedProjectKey || 'VIP');
      const defaultFields = preferencesManager.getDefaultImportantFields();

      // Group fields by category for better organization
      const standardFields = relevantFields.filter(f => !f.custom);
      const customFields = relevantFields.filter(f => f.custom);
      
      // Helper function to format field info
      const formatField = (field: any) => {
        const isImportant = preferencesManager.isFieldImportant(resolvedProjectKey || 'VIP', field.name.toLowerCase().replace(/\s+/g, '_'));
        const isIgnored = preferencesManager.isFieldIgnored(resolvedProjectKey || 'VIP', field.id);
        
        let status = '';
        if (isImportant) status = ' ⭐ (important)';
        if (isIgnored) status = ' 🚫 (ignored)';
        
        let fieldOutput = `• **${field.name}** (\`${field.id}\`)${status}\n`;
        
        // Add description
        if (field.description) {
          fieldOutput += `  ℹ️ ${field.description}\n`;
        }
        
        // Add type and constraints
        const fieldType = field.schema?.type || 'unknown';
        const isRequired = !field.optional && field.required;
        const requiredLabel = isRequired ? ' [REQUIRED]' : ' [OPTIONAL]';
        
        fieldOutput += `  📝 Type: ${fieldType}${requiredLabel}`;
        
        // Add specific guidance for different field types
        if (fieldType === 'user') {
          fieldOutput += ` (use Account ID - search with search-users tool)`;
        } else if (fieldType === 'array' && field.schema?.items === 'component') {
          fieldOutput += ` (use component names from list above)`;
        } else if (fieldType === 'array' && field.schema?.items === 'string') {
          fieldOutput += ` (array of strings)`;
        } else if (fieldType === 'number') {
          fieldOutput += ` (numeric value)`;
        } else if (fieldType === 'option') {
          fieldOutput += ` (single choice from allowed values)`;
        } else if (fieldType === 'array' && field.schema?.items === 'option') {
          fieldOutput += ` (multiple choices from allowed values)`;
        }
        
        fieldOutput += '\n';
        
        // Add allowed values with better formatting
        if (field.allowedValues && field.allowedValues.length > 0) {
          fieldOutput += `  📌 Allowed values: `;
          if (field.allowedValues.length <= 5) {
            fieldOutput += field.allowedValues.map((v: any) => `"${v.value || v.name}"`).join(', ');
          } else {
            fieldOutput += field.allowedValues.slice(0, 5).map((v: any) => `"${v.value || v.name}"`).join(', ') + ` (and ${field.allowedValues.length - 5} more...)`;
          }
          fieldOutput += '\n';
        }
        
        // Add examples for common field types
        if (field.name.toLowerCase().includes('story') && field.name.toLowerCase().includes('point')) {
          fieldOutput += `  📊 Example: 1, 2, 3, 5, 8, 13 (Fibonacci sequence)\n`;
        } else if (field.name.toLowerCase().includes('sprint')) {
          fieldOutput += `  📊 Example: "current" or sprint ID from search-sprints\n`;
        } else if (fieldType === 'user') {
          fieldOutput += `  📊 Example: "5f8a1b2c3d4e5f6789012345" (get from search-users)\n`;
        } else if (field.name.toLowerCase().includes('epic')) {
          fieldOutput += `  📊 Example: "VIP-123" or epic name\n`;
        } else if (fieldType === 'array' && field.schema?.items === 'string' && field.name.toLowerCase().includes('label')) {
          fieldOutput += `  📊 Example: ["bug", "frontend", "urgent"]\n`;
        }
        
        fieldOutput += '\n';
        return fieldOutput;
      };
      
      // Add standard fields section
      if (standardFields.length > 0) {
        output += `### Standard Jira Fields\n\n`;
        standardFields.forEach(field => {
          output += formatField(field);
        });
      }
      
      // Add custom fields section
      if (customFields.length > 0) {
        output += `### Custom Fields\n\n`;
        customFields.forEach(field => {
          output += formatField(field);
        });
      }

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

      output += `\n### Quick Reference\n\n`;
      output += `**Field Symbols:**\n`;
      output += `• ⭐ Important field (commonly used)\n`;
      output += `• 🚫 Ignored field (rarely used)\n`;
      output += `• [REQUIRED] Must be provided\n`;
      output += `• [OPTIONAL] Can be omitted\n\n`;
      
      output += `**Usage Examples:**\n`;
      output += `• \`create-ticket\`: Include any of these fields directly\n`;
      output += `• \`update-ticket\`: Modify existing ticket fields\n`;
      output += `• \`search-users\`: Get Account IDs for user fields\n`;
      output += `• \`search-sprints\`: Get sprint IDs for sprint assignment\n`;
      output += `• \`get-current-sprint\`: Get active sprint quickly\n\n`;
      
      output += `**Common Workflows:**\n`;
      output += `1. Create ticket with components: Specify component names from list above\n`;
      output += `2. Assign to user: Use search-users to get Account ID, then assign\n`;
      output += `3. Link to epic: Use epic key (VIP-123) or epic name\n`;
      output += `4. Add to sprint: Use "current" or sprint ID from search-sprints\n`;
      output += `5. Set priority: Use allowed values shown for priority field\n`;

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
      project: z.string().optional().describe("Filter to project team members (Note: Currently returns all matching users)"),
      active_only: z.boolean().optional().default(true).describe("Only return active users"),
      return_format: z.enum(["simple", "full"]).optional().default("simple").describe("Return format - simple returns just essential fields"),
    },
    async ({ query, project, active_only, return_format }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const result = await searchJiraUsers(query, auth, {
        project,
        activeOnly: active_only,
        returnFormat: return_format,
      });

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
            text: `No users found matching "${query}"${active_only ? " (active only)" : ""}`,
          }],
        };
      }

      let output = `**Found ${users.length} user(s) matching "${query}":**\n\n`;
      
      if (return_format === "simple") {
        // Simple format - concise output
        users.forEach((user, index) => {
          output += `${index + 1}. **${user.displayName}** - ${user.emailAddress || 'No email'} (${user.accountId})${!user.active ? ' [INACTIVE]' : ''}\n`;
        });
        
        if (users.length === 1) {
          output += `\n**Use this Account ID for assignment:** \`${users[0].accountId}\`\n`;
        } else {
          output += `\n**Note:** Multiple users found. Copy the Account ID in parentheses for the user you want.\n`;
        }
      } else {
        // Full format - detailed output
        users.forEach((user, index) => {
          output += `**${index + 1}. ${user.displayName}**\n`;
          output += `• Account ID: \`${user.accountId}\`\n`;
          output += `• Email: ${user.emailAddress || 'Not available'}\n`;
          output += `• Active: ${user.active ? 'Yes' : 'No'}\n`;
          output += `• Type: ${user.accountType}\n\n`;
        });

        if (users.length === 1) {
          output += `**To assign this user to a ticket, use:**\n`;
          output += `Account ID: \`${users[0].accountId}\`\n`;
        } else {
          output += `**Note:** Multiple users found. Use the specific Account ID for the user you want.\n`;
        }
      }

      if (project) {
        output += `\n*Note: Project filtering is not yet implemented. Showing all matching users.*\n`;
      }

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

      const resolvedProjectKey = await configManager.getProjectKeyWithFallback(project_key);
      
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

        // Extract unique sprints from tickets using dynamic field resolution
        const fieldResolver = new DynamicFieldResolver();
        if (resolvedProjectKey) {
          fieldResolver.setProjectKey(resolvedProjectKey);
        }
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
        
        const sprintSet = new Set();
        const sprintDetails: any[] = [];
        
        if (searchResult.data.issues) {
          searchResult.data.issues.forEach((issue: any) => {
            // Check for sprint field using dynamic resolution
            if (issue.fields[sprintField] && Array.isArray(issue.fields[sprintField])) {
              issue.fields[sprintField].forEach((sprint: any) => {
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

  // Get current sprint tool - simplified version for getting the current active sprint
  server.tool(
    "get-current-sprint",
    "Get the current active sprint for a project. Returns the sprint ID needed for ticket assignment.",
    {
      project_key: z.string().optional().describe("Project key (uses default if not specified)"),
    },
    async ({ project_key }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const resolvedProjectKey = await configManager.getProjectKeyWithFallback(project_key);
      
      // Search for tickets in active sprints only
      const jql = `project = "${resolvedProjectKey}" AND sprint in (openSprints()) ORDER BY updated DESC`;

      try {
        const searchResult = await searchJiraTickets(jql, 10, auth);
        
        if (!searchResult.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Error searching for active sprint: ${searchResult.errorMessage}`,
            }],
          };
        }

        // Extract active sprints from tickets using dynamic field resolution
        const fieldResolver = new DynamicFieldResolver();
        if (resolvedProjectKey) {
          fieldResolver.setProjectKey(resolvedProjectKey);
        }
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
        
        let activeSprint: any = null;
        
        if (searchResult.data.issues && searchResult.data.issues.length > 0) {
          // Look through issues to find active sprint
          for (const issue of searchResult.data.issues) {
            if (issue.fields[sprintField] && Array.isArray(issue.fields[sprintField])) {
              const activeSprintData = issue.fields[sprintField].find((sprint: any) => 
                sprint.state === 'ACTIVE'
              );
              if (activeSprintData) {
                activeSprint = activeSprintData;
                break;
              }
            }
          }
        }

        if (!activeSprint) {
          return {
            content: [{
              type: "text" as const,
              text: `No active sprint found for project ${resolvedProjectKey}.\n\nTry using search-sprints to see all available sprints, or check if the project has any active sprints configured.`,
            }],
          };
        }

        const output = `**Current Active Sprint for ${resolvedProjectKey}**\n\n` +
          `🟢 **${activeSprint.name}**\n` +
          `Sprint ID: \`${activeSprint.id}\`\n` +
          `Dates: ${activeSprint.startDate ? new Date(activeSprint.startDate).toLocaleDateString() : 'Not set'} → ${activeSprint.endDate ? new Date(activeSprint.endDate).toLocaleDateString() : 'Not set'}\n\n` +
          `**To use this sprint:**\n` +
          `• In create-ticket: \`sprint: "${activeSprint.id}"\`\n` +
          `• Or use shorthand: \`sprint: "current"\` (will be resolved automatically)`;

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
            text: `Error getting current sprint: ${error instanceof Error ? error.message : String(error)}`,
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

  // Search epics tool - for discovering available epics
  server.tool(
    "search-epics",
    "Search for epics in a project. Use this to discover available epics before creating tickets. Returns epic key, name, status, and description.",
    {
      project_key: z.string().optional(),
      search_term: z.string().optional().describe("Search in epic name/summary"),
      status: z.string().optional().describe("Filter by status (e.g., 'In Progress', 'To Do')"),
      max_results: z.number().min(1).max(50).default(10),
    },
    async ({ project_key, search_term, status, max_results }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      const resolvedProjectKey = await configManager.getProjectKeyWithFallback(project_key);
      
      // Build JQL for epic search
      let jql = `project = "${resolvedProjectKey}" AND issuetype = Epic`;
      
      if (search_term) {
        jql += ` AND summary ~ "${search_term}"`;
      }
      
      if (status) {
        jql += ` AND status = "${status}"`;
      }
      
      jql += " ORDER BY created DESC";

      try {
        const searchResult = await searchJiraTickets(jql, max_results, auth);
        
        if (!searchResult.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Error searching for epics: ${searchResult.errorMessage}`,
            }],
          };
        }

        const epics = searchResult.data.issues || [];
        
        if (epics.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: `No epics found in project ${resolvedProjectKey}.${search_term ? ` matching "${search_term}"` : ''}\n\nTo create an epic, use create-ticket with issue_type="Epic"`,
            }],
          };
        }

        // Get dynamic epic name field
        const fieldResolver = new DynamicFieldResolver();
        fieldResolver.setProjectKey(resolvedProjectKey);
        const epicNameField = await fieldResolver.getFieldId('epicName', 'JIRA_EPIC_NAME_FIELD');

        // Format epic results
        let output = `**Epics in ${resolvedProjectKey} (${epics.length} found)**\n\n`;
        
        for (const epic of epics) {
          const fields = epic.fields;
          const epicName = epicNameField && fields[epicNameField] ? fields[epicNameField] : fields.summary;
          const status = fields.status?.name || 'Unknown';
          const assignee = fields.assignee?.displayName || 'Unassigned';
          
          output += `**${epic.key}**: ${epicName}\n`;
          output += `  Status: ${status} | Assignee: ${assignee}\n`;
          
          // Add description preview if available
          if (fields.description?.content) {
            const descPreview = fields.description.content
              .map((block: any) => {
                if (block.content) {
                  return block.content
                    .map((item: any) => item.text || '')
                    .join('');
                }
                return '';
              })
              .join(' ')
              .trim()
              .substring(0, 100);
            
            if (descPreview) {
              output += `  Description: ${descPreview}${descPreview.length >= 100 ? '...' : ''}\n`;
            }
          }
          
          output += `  Link: https://${process.env.JIRA_HOST}/browse/${epic.key}\n\n`;
        }
        
        output += `**To use an epic when creating tickets:**\n`;
        output += `• By key: \`parent_epic: "${epics[0].key}"\`\n`;
        output += `• By name: \`parent_epic: "${epicNameField && epics[0].fields[epicNameField] ? epics[0].fields[epicNameField] : epics[0].fields.summary}"\``;

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
            text: `Error searching epics: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );

  // Create ticket like another ticket tool
  server.tool(
    "create-ticket-like",
    "Create a new ticket copying fields from an existing ticket. Automatically links the tickets and copies epic, assignee, labels, story points, components, and priority.",
    {
      source_ticket: z.string().min(1, "Source ticket ID is required (e.g., VIP-123)"),
      summary: z.string().min(1, "Summary for the new ticket"),
      description: z.string().optional().describe("Description (if not provided, will reference source ticket)"),
      issue_type: z.enum(["Bug", "Task", "Story", "Test"]).optional().describe("Issue type (defaults to same as source)"),
      // Allow overriding copied fields
      assignee: z.string().optional().describe("Override assignee (email, name, or Account ID)"),
      sprint: z.string().optional().describe("Override sprint (current, sprint name, or ID)"),
      story_points: z.number().optional().describe("Override story points"),
      priority: z.string().optional().describe("Override priority"),
      labels: z.array(z.string()).optional().describe("Override labels (replaces all)"),
      components: z.array(z.string()).optional().describe("Override components (replaces all)"),
      link_type: z.string().optional().default("Relates").describe("Type of link to source ticket"),
      project_key: z.string().optional(),
    },
    async ({
      source_ticket,
      summary,
      description,
      issue_type,
      assignee,
      sprint,
      story_points,
      priority,
      labels,
      components,
      link_type,
      project_key,
    }) => {
      const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
      ).toString("base64");

      // First, get the source ticket details
      const sourceTicketUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${source_ticket}`;
      
      try {
        const sourceResponse = await fetch(sourceTicketUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });

        if (!sourceResponse.ok) {
          const validation = validateTicketKey(source_ticket);
          let errorMsg = `Error fetching source ticket ${source_ticket}: ${sourceResponse.status}`;
          
          if (!validation.isValid) {
            errorMsg += `\n\n${validation.errorMessage}`;
          } else if (sourceResponse.status === 404) {
            errorMsg += `\n\nTicket not found. Verify the ticket exists and you have permission to view it.`;
          } else if (sourceResponse.status === 403) {
            errorMsg += `\n\nAccess denied. Check your permissions for this ticket/project.`;
          }
          
          errorMsg += getErrorSuggestions('general');
          
          return {
            content: [{
              type: "text" as const,
              text: errorMsg,
            }],
          };
        }

        const sourceData = await sourceResponse.json() as any;
        const sourceFields = sourceData.fields;

        // Extract fields to copy
        const resolvedProjectKey = project_key || extractProjectKey(undefined, source_ticket);
        
        // Build the new ticket using our enhanced create-ticket logic
        const formattedDescription = formatDescription(description || `Related to ${source_ticket}: ${sourceFields.summary}`);
        const fieldResolver = new DynamicFieldResolver();
        
        if (resolvedProjectKey) {
          fieldResolver.setProjectKey(resolvedProjectKey);
        }

        const payload: any = {
          fields: {
            project: {
              key: resolvedProjectKey || process.env.JIRA_PROJECT_KEY || "SCRUM",
            },
            summary,
            description: formattedDescription,
            issuetype: {
              name: issue_type || sourceFields.issuetype?.name || "Task",
            },
          },
        };

        // Copy/override assignee with smart resolution
        const assigneeToUse = assignee || sourceFields.assignee?.accountId;
        if (assigneeToUse) {
          const userResolution = await resolveUser(assigneeToUse, auth, resolvedProjectKey);
          if (userResolution.success && userResolution.accountId) {
            payload.fields.assignee = { accountId: userResolution.accountId };
          }
        }

        // Copy/override epic with validation
        const epicLinkField = await fieldResolver.getFieldId('epicLink', 'JIRA_EPIC_LINK_FIELD');
        const epicToUse = sourceFields.parent?.key || (epicLinkField ? sourceFields[epicLinkField] : null);
        if (epicToUse) {
          const epicValidation = await validateEpic(epicToUse, auth);
          if (epicValidation.success && epicValidation.epicKey) {
            // Use modern parent field format
            payload.fields.parent = {
              key: epicValidation.epicKey
            };
          }
        }

        // Copy/override sprint with smart resolution
        let sprintToUse = sprint;
        if (!sprintToUse) {
          // Use dynamic field resolution to get sprint field
          const sprintFieldId = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
          if (sourceFields[sprintFieldId] && sourceFields[sprintFieldId].length > 0) {
            const sourceSprint = sourceFields[sprintFieldId][sourceFields[sprintFieldId].length - 1];
            if (sourceSprint.id) {
              sprintToUse = String(sourceSprint.id);
            }
          }
        }
        if (sprintToUse) {
          const sprintResolution = await resolveSprintId(sprintToUse, resolvedProjectKey || 'VIP', auth);
          if (sprintResolution.success && sprintResolution.sprintId) {
            const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD');
            if (sprintField) {
              payload.fields[sprintField] = Number(sprintResolution.sprintId);
            }
          }
        }

        // Copy/override story points
        const storyPointsToUse = story_points !== undefined ? story_points : sourceFields.customfield_10038;
        if (storyPointsToUse !== undefined) {
          const storyPointsField = await fieldResolver.getFieldId('storyPoints', 'JIRA_STORY_POINTS_FIELD');
          if (storyPointsField) {
            payload.fields[storyPointsField] = storyPointsToUse;
          }
        }

        // Copy/override components with validation
        const componentsToUse = components || (sourceFields.components ? sourceFields.components.map((c: any) => c.name) : undefined);
        if (componentsToUse && componentsToUse.length > 0) {
          const componentsValidation = await validateComponents(componentsToUse, resolvedProjectKey || 'VIP', auth);
          if (componentsValidation.success && componentsValidation.components) {
            payload.fields.components = componentsValidation.components;
          }
        }

        // Copy/override priority
        const priorityToUse = priority || sourceFields.priority?.name;
        if (priorityToUse) {
          payload.fields.priority = { name: priorityToUse };
        }

        // Copy/override labels
        const labelsToUse = labels || sourceFields.labels;
        if (labelsToUse && labelsToUse.length > 0) {
          payload.fields.labels = labelsToUse;
        }

        // Create the ticket
        const result = await createJiraTicket(payload, auth);

        if (!result.success) {
          return {
            content: [{
              type: "text" as const,
              text: `Error creating ticket: ${result.errorMessage}`,
            }],
          };
        }

        const createdKey = result.data.key;
        if (!createdKey) {
          return {
            content: [{
              type: "text" as const,
              text: `Error: Ticket was created but no key was returned.`,
            }],
          };
        }

        let responseText = `Created ticket like ${source_ticket}: ${createdKey}`;

        // Create link to source ticket
        const linkTypeToUse = link_type || "Relates";
        const linkResult = await createTicketLink(
          createdKey,
          source_ticket,
          linkTypeToUse,
          auth
        );
        
        if (linkResult.success) {
          responseText += `\n\nLink created: ${createdKey} ${linkTypeToUse} ${source_ticket}`;
        } else {
          responseText += `\n\nWarning: Failed to link to source ticket: ${linkResult.errorMessage}`;
        }

        // Add summary of copied fields
        const copiedFields: string[] = [];
        if (assigneeToUse && !assignee) copiedFields.push("assignee");
        if (sprintToUse && !sprint) copiedFields.push("sprint");
        if (storyPointsToUse && story_points === undefined) copiedFields.push("story points");
        if (priorityToUse && !priority) copiedFields.push("priority");
        if (labelsToUse && !labels) copiedFields.push("labels");
        if (componentsToUse && !components) copiedFields.push("components");
        if (epicToUse) copiedFields.push("epic");

        if (copiedFields.length > 0) {
          responseText += `\n\nCopied from source: ${copiedFields.join(", ")}`;
        }

        // Get full ticket details
        const detailsResult = await getFullTicketDetails(createdKey, auth);
        if (detailsResult.success && detailsResult.ticketDetails) {
          responseText += `\n\n${detailsResult.ticketDetails}`;
        }

        return {
          content: [{
            type: "text" as const,
            text: responseText,
          }],
        };

      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error creating ticket like ${source_ticket}: ${error instanceof Error ? error.message : String(error)}`,
          }],
        };
      }
    }
  );
}