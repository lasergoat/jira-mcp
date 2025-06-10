import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import fetch from "node-fetch";
import { createJiraTicket, createTicketLink, searchJiraTickets, updateJiraTicket, addJiraComment, uploadJiraAttachment } from "./api.js";
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
        ) || process.env.JIRA_ACCEPTANCE_CRITERIA_FIELD || "customfield_10429";

        payload.fields[acceptanceCriteriaField] =
          formatAcceptanceCriteria(acceptance_criteria);

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
      if (story_points !== undefined && issue_type === "Story") {
        const storyPointsField = await fieldResolver.getFieldId(
          'storyPoints',
          'JIRA_STORY_POINTS_FIELD'
        ) || process.env.JIRA_STORY_POINTS_FIELD || "customfield_10040";
        
        payload.fields[storyPointsField] = story_points;
        payload.fields.labels = ["QA-Testable"];
      }

      // Add parent epic if provided
      if (parent_epic !== undefined) {
        const epicLinkField = await fieldResolver.getFieldId(
          'epicLink',
          'JIRA_EPIC_LINK_FIELD'
        ) || process.env.JIRA_EPIC_LINK_FIELD || "customfield_10014";
        
        payload.fields[epicLinkField] = parent_epic;
      }

      // Add sprint if provided
      if (sprint !== undefined) {
        const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') 
          || "customfield_10020";
        
        payload.fields[sprintField] = [
          {
            name: sprint,
          },
        ];
      }

      // Add story readiness if provided
      if (story_readiness !== undefined) {
        const storyReadinessField = await fieldResolver.getFieldId('storyReadiness', 'JIRA_STORY_READINESS_FIELD')
          || "customfield_10596";
        
        const storyReadinessId = story_readiness === "Yes" ? "18256" : "18257";
        payload.fields[storyReadinessField] = {
          self: `https://${process.env.JIRA_HOST}/rest/api/3/customFieldOption/${storyReadinessId}`,
          value: story_readiness,
          id: storyReadinessId,
        };
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

      return {
        content: [
          {
            type: "text" as const,
            text: responseText,
          },
        ],
      };
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

  // Get ticket tool
  server.tool(
    "get-ticket",
    "Get a jira ticket",
    {
      ticket_id: z.string().min(1, "Ticket ID is required"),
    },
    async ({ ticket_id }) => {
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
        const epic = fields.parent?.key || fields.customfield_10014 || 'No epic';
        
        // Extract sprint information (usually in customfield_10010)
        let sprint = 'No sprint';
        if (fields.customfield_10010 && Array.isArray(fields.customfield_10010) && fields.customfield_10010.length > 0) {
          sprint = fields.customfield_10010[0].name || 'No sprint';
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

        const formattedOutput = `**JIRA Ticket: ${ticket_id}**

**Summary:** ${summary}
**Status:** ${status}
**Assignee:** ${assignee}
**Priority:** ${priority}
**Issue Type:** ${issueType}
**Epic:** ${epic}
**Sprint:** ${sprint}

**Description:**
${description}`;

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
                // Note: Jira API requires numeric sprint ID, not name
                // This is a limitation - sprint names won't work properly
                // TODO: Implement sprint name to ID lookup
                if (!isNaN(Number(value))) {
                  payload.fields[fieldId] = Number(value);
                } else {
                  console.error(`Sprint requires numeric ID, got: ${value}`);
                  // Skip this field as it won't work with name
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

      return {
        content: [
          {
            type: "text" as const,
            text: `Successfully updated ticket ${ticket_id}`,
          },
        ],
      };
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
}