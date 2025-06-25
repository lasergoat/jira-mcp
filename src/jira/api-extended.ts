import fetch from "node-fetch";
import { JiraField, JiraTransition, JiraComment, JiraAttachment, JiraUser } from "./types.js";
import { formatDescription } from "./formatting.js";
import { DynamicFieldResolver } from "../config/helpers.js";

// Helper function to get all fields in a Jira instance
export async function getJiraFields(
  auth: string
): Promise<{
  success: boolean;
  fields?: JiraField[];
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/field`;

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to fetch fields: ${response.status} ${errorText}` 
      };
    }

    const fields = (await response.json()) as JiraField[];
    return { success: true, fields };
  } catch (error) {
    console.error("Exception fetching fields:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to get available transitions for a ticket
export async function getJiraTransitions(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  transitions?: JiraTransition[];
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}/transitions`;

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to fetch transitions: ${response.status} ${errorText}` 
      };
    }

    const data = (await response.json()) as { transitions: JiraTransition[] };
    return { success: true, transitions: data.transitions };
  } catch (error) {
    console.error("Exception fetching transitions:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to transition a ticket to a new status
export async function transitionJiraTicket(
  ticketKey: string,
  transitionId: string,
  comment?: string,
  auth?: string
): Promise<{
  success: boolean;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}/transitions`;

  const payload: any = {
    transition: { id: transitionId }
  };

  if (comment) {
    payload.update = {
      comment: [
        {
          add: {
            body: {
              type: "doc",
              version: 1,
              content: [
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: comment,
                    },
                  ],
                },
              ],
            },
          },
        },
      ],
    };
  }

  try {
    const response = await fetch(jiraUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    return { 
      success: false, 
      errorMessage: `Failed to transition ticket: ${response.status} ${errorText}` 
    };
  } catch (error) {
    console.error("Exception transitioning ticket:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to get comments on a ticket
export async function getJiraComments(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  comments?: JiraComment[];
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}/comment`;

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to fetch comments: ${response.status} ${errorText}` 
      };
    }

    const data = (await response.json()) as { comments: JiraComment[] };
    return { success: true, comments: data.comments };
  } catch (error) {
    console.error("Exception fetching comments:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to update a comment
export async function updateJiraComment(
  ticketKey: string,
  commentId: string,
  newText: string,
  auth: string
): Promise<{
  success: boolean;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}/comment/${commentId}`;

  const payload = {
    body: formatDescription(newText),
  };

  try {
    const response = await fetch(jiraUrl, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${auth}`,
      },
      body: JSON.stringify(payload),
    });

    if (response.ok) {
      return { success: true };
    }

    const errorText = await response.text();
    return { 
      success: false, 
      errorMessage: `Failed to update comment: ${response.status} ${errorText}` 
    };
  } catch (error) {
    console.error("Exception updating comment:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to delete a comment
export async function deleteJiraComment(
  ticketKey: string,
  commentId: string,
  auth: string
): Promise<{
  success: boolean;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}/comment/${commentId}`;

  try {
    const response = await fetch(jiraUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    return { 
      success: false, 
      errorMessage: `Failed to delete comment: ${response.status} ${errorText}` 
    };
  } catch (error) {
    console.error("Exception deleting comment:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to get attachments on a ticket
export async function getJiraAttachments(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  attachments?: JiraAttachment[];
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}?fields=attachment`;

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to fetch attachments: ${response.status} ${errorText}` 
      };
    }

    const data = await response.json() as any;
    const attachments = data.fields?.attachment || [];
    return { success: true, attachments };
  } catch (error) {
    console.error("Exception fetching attachments:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to delete an attachment
export async function deleteJiraAttachment(
  attachmentId: string,
  auth: string
): Promise<{
  success: boolean;
  errorMessage?: string;
}> {
  const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/attachment/${attachmentId}`;

  try {
    const response = await fetch(jiraUrl, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (response.status === 204) {
      return { success: true };
    }

    const errorText = await response.text();
    return { 
      success: false, 
      errorMessage: `Failed to delete attachment: ${response.status} ${errorText}` 
    };
  } catch (error) {
    console.error("Exception deleting attachment:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to get full ticket details with transitions - used after create/update operations
export async function getFullTicketDetails(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  ticketDetails?: string; // Formatted string ready for display
  errorMessage?: string;
}> {
  try {
    // Get ticket details
    const ticketUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}`;
    const ticketResponse = await fetch(ticketUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!ticketResponse.ok) {
      return { 
        success: false, 
        errorMessage: `Failed to fetch ticket details: ${ticketResponse.status}` 
      };
    }

    const ticketData = await ticketResponse.json() as any;

    // Get available transitions
    const transitionsResult = await getJiraTransitions(ticketKey, auth);
    
    // Format the output similar to get-ticket tool
    const summary = ticketData.fields.summary || 'No summary';
    const status = ticketData.fields.status?.name || 'No status';
    const assignee = ticketData.fields.assignee?.displayName || 'Unassigned';
    const priority = ticketData.fields.priority?.name || 'No priority';
    const issueType = ticketData.fields.issuetype?.name || 'No type';
    const epic = ticketData.fields.parent?.key || 'No epic'; // Removed hardcoded customfield_10008
    
    // Get sprint info - Use dynamic field resolution
    let sprint = 'No sprint';
    const fieldResolver = new DynamicFieldResolver();
    const projectKey = ticketData.fields.project?.key;
    if (projectKey) {
      fieldResolver.setProjectKey(projectKey);
    }
    const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
    if (ticketData.fields[sprintField] && ticketData.fields[sprintField].length > 0) {
      const sprintData = ticketData.fields[sprintField][ticketData.fields[sprintField].length - 1];
      sprint = sprintData.name || 'No sprint';
    }

    // Get description
    let description = 'No description';
    if (ticketData.fields.description && ticketData.fields.description.content) {
      description = ticketData.fields.description.content
        .map((block: any) => {
          if (block.content) {
            return block.content
              .map((item: any) => item.text || '')
              .join('');
          }
          return '';
        })
        .join('\n')
        .trim() || 'No description';
    }

    // Get story points - Note: Hardcoded field reference, should be made dynamic
    const storyPoints = ticketData.fields.customfield_10038 || 'No story points';

    let output = `**JIRA Ticket: ${ticketKey}**

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

    // Add transitions if available
    if (transitionsResult.success && transitionsResult.transitions && transitionsResult.transitions.length > 0) {
      output += `\n\n**Available Transitions:**\n`;
      transitionsResult.transitions.forEach(transition => {
        output += `• **${transition.name}** → ${transition.to.name}\n`;
      });
    }

    return { success: true, ticketDetails: output };
  } catch (error) {
    console.error("Exception getting full ticket details:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to search for users by name or email
// Temporary debug function to get raw ticket data
export async function getRawTicketData(
  ticketKey: string,
  auth: string
): Promise<{
  success: boolean;
  rawData?: any;
  errorMessage?: string;
}> {
  try {
    const url = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      return { 
        success: false, 
        errorMessage: `Failed to fetch ticket: ${response.status}` 
      };
    }

    const rawData = await response.json();
    return { success: true, rawData };
  } catch (error) {
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

export async function searchJiraUsers(
  query: string,
  auth: string,
  options?: {
    project?: string;
    activeOnly?: boolean;
    returnFormat?: "simple" | "full";
  }
): Promise<{
  success: boolean;
  users?: JiraUser[];
  errorMessage?: string;
}> {
  // Build query parameters
  const params = new URLSearchParams();
  params.append('query', query);
  
  // Add maxResults to get more results when searching
  params.append('maxResults', '50');
  
  // Note: JIRA doesn't have direct project filtering in user search API
  // We'll need to filter results if project is specified
  
  let jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/user/search?${params.toString()}`;

  try {
    const response = await fetch(jiraUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      // If query search fails, try to find by email directly
      if (query.includes('@')) {
        params.append('accountType', 'atlassian');
        const emailUrl = `https://${process.env.JIRA_HOST}/rest/api/3/user/search?${params.toString()}`;
        const emailResponse = await fetch(emailUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });
        
        if (emailResponse.ok) {
          let users = (await emailResponse.json()) as JiraUser[];
          users = applyUserFilters(users, options);
          return { success: true, users };
        }
      }
      
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to search users: ${response.status} ${errorText}` 
      };
    }

    let users = (await response.json()) as JiraUser[];
    
    // Apply filters
    users = applyUserFilters(users, options);
    
    return { success: true, users };
  } catch (error) {
    console.error("Exception searching users:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to apply filters to user results
function applyUserFilters(
  users: JiraUser[],
  options?: {
    project?: string;
    activeOnly?: boolean;
    returnFormat?: "simple" | "full";
  }
): JiraUser[] {
  if (!options) return users;
  
  let filteredUsers = users;
  
  // Filter by active status
  if (options.activeOnly !== false) { // Default to true
    filteredUsers = filteredUsers.filter(user => user.active);
  }
  
  // Note: Project filtering would require additional API calls to check project membership
  // For now, we'll return all matching users and let the LLM/user decide
  
  // Format results if simple format requested
  if (options.returnFormat === "simple") {
    // Return simplified user objects
    return filteredUsers.map(user => ({
      accountId: user.accountId,
      displayName: user.displayName,
      emailAddress: user.emailAddress,
      active: user.active,
      // Only include essential fields
      self: user.self,
      accountType: user.accountType,
      avatarUrls: user.avatarUrls
    } as JiraUser));
  }
  
  return filteredUsers;
}

// Helper function to get the current active sprint for a project
export async function getCurrentSprint(
  projectKey: string,
  auth: string
): Promise<{
  success: boolean;
  sprintId?: string;
  sprintName?: string;
  errorMessage?: string;
}> {
  // Get dynamic sprint field
  const fieldResolver = new DynamicFieldResolver();
  fieldResolver.setProjectKey(projectKey);
  const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
  
  const jql = `project = "${projectKey}" AND sprint in (openSprints()) ORDER BY updated DESC`;
  
  try {
    const searchUrl = `https://${process.env.JIRA_HOST}/rest/api/3/search?jql=${encodeURIComponent(jql)}&maxResults=10&fields=${sprintField}`;
    
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to search for active sprint: ${response.status} ${errorText}` 
      };
    }

    const data = await response.json() as any;
    
    // Look for active sprint in the results
    if (data.issues && data.issues.length > 0) {
      for (const issue of data.issues) {
        if (issue.fields[sprintField] && Array.isArray(issue.fields[sprintField])) {
          const activeSprint = issue.fields[sprintField].find((sprint: any) => 
            sprint.state === 'ACTIVE'
          );
          if (activeSprint) {
            return {
              success: true,
              sprintId: String(activeSprint.id),
              sprintName: activeSprint.name
            };
          }
        }
      }
    }
    
    return {
      success: false,
      errorMessage: `No active sprint found for project ${projectKey}`
    };
  } catch (error) {
    console.error("Exception getting current sprint:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to resolve sprint name/"current" to sprint ID
export async function resolveSprintId(
  sprintInput: string,
  projectKey: string,
  auth: string
): Promise<{
  success: boolean;
  sprintId?: string;
  errorMessage?: string;
}> {
  // If already a numeric ID, return it
  if (/^\d+$/.test(sprintInput)) {
    return { success: true, sprintId: sprintInput };
  }
  
  // Handle "current" keyword
  if (sprintInput.toLowerCase() === "current") {
    const currentSprint = await getCurrentSprint(projectKey, auth);
    if (currentSprint.success && currentSprint.sprintId) {
      return { success: true, sprintId: currentSprint.sprintId };
    }
    return {
      success: false,
      errorMessage: currentSprint.errorMessage || "No active sprint found"
    };
  }
  
  // For sprint names, search through available sprints
  try {
    // Get dynamic sprint field
    const fieldResolver = new DynamicFieldResolver();
    fieldResolver.setProjectKey(projectKey);
    const sprintField = await fieldResolver.getFieldId('sprint', 'JIRA_SPRINT_FIELD') || 'customfield_10020';
    
    // Search for tickets in all sprints to find sprint by name
    const searchUrl = `https://${process.env.JIRA_HOST}/rest/api/3/search?jql=${encodeURIComponent(
      `project = "${projectKey}" AND sprint in (openSprints(), futureSprints()) ORDER BY updated DESC`
    )}&maxResults=50&fields=${sprintField}`;
    
    const response = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      return {
        success: false,
        errorMessage: `Failed to search sprints: ${response.status}`
      };
    }

    const data = await response.json() as any;
    
    // Extract unique sprints and find matching name
    const sprintMap = new Map();
    
    if (data.issues && data.issues.length > 0) {
      for (const issue of data.issues) {
        if (issue.fields[sprintField] && Array.isArray(issue.fields[sprintField])) {
          issue.fields[sprintField].forEach((sprint: any) => {
            if (sprint.id && sprint.name && !sprintMap.has(sprint.id)) {
              sprintMap.set(sprint.id, {
                id: String(sprint.id),
                name: sprint.name,
                state: sprint.state
              });
            }
          });
        }
      }
    }
    
    // Look for exact name match (case-insensitive)
    const matchingSprints = Array.from(sprintMap.values()).filter((sprint: any) =>
      sprint.name.toLowerCase() === sprintInput.toLowerCase()
    );
    
    if (matchingSprints.length === 1) {
      return {
        success: true,
        sprintId: matchingSprints[0].id
      };
    }
    
    if (matchingSprints.length > 1) {
      const sprintList = matchingSprints.map((s: any) => `${s.name} (${s.state})`).join(', ');
      return {
        success: false,
        errorMessage: `Multiple sprints found with name "${sprintInput}": ${sprintList}. Please use sprint ID instead.`
      };
    }
    
    // Try partial name match
    const partialMatches = Array.from(sprintMap.values()).filter((sprint: any) =>
      sprint.name.toLowerCase().includes(sprintInput.toLowerCase())
    );
    
    if (partialMatches.length === 1) {
      return {
        success: true,
        sprintId: partialMatches[0].id
      };
    }
    
    if (partialMatches.length > 1) {
      const sprintList = partialMatches.slice(0, 5).map((s: any) => `"${s.name}" (ID: ${s.id})`).join(', ');
      return {
        success: false,
        errorMessage: `Multiple sprints found matching "${sprintInput}": ${sprintList}${partialMatches.length > 5 ? '...' : ''}. Please use exact name or sprint ID.`
      };
    }
    
    // No matches found
    const availableNames = Array.from(sprintMap.values()).slice(0, 10).map((s: any) => s.name);
    return {
      success: false,
      errorMessage: `No sprint found matching "${sprintInput}".\n\nAvailable sprints: ${availableNames.join(', ')}${sprintMap.size > 10 ? '...' : ''}\n\nUse search-sprints to see all available sprints with IDs.`
    };
    
  } catch (error) {
    console.error("Exception resolving sprint name:", error);
    return {
      success: false,
      errorMessage: `Error searching for sprint: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// Helper function to validate that an epic exists
export async function validateEpic(
  epicInput: string,
  auth: string
): Promise<{
  success: boolean;
  epicKey?: string;
  epicSummary?: string;
  errorMessage?: string;
}> {
  try {
    // If it looks like an epic key (PROJECT-NUMBER), validate it directly
    if (/^[A-Z]+-\d+$/.test(epicInput)) {
      const ticketUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${epicInput}?fields=summary,issuetype`;
      
      const response = await fetch(ticketUrl, {
        method: "GET",
        headers: {
          Authorization: `Basic ${auth}`,
        },
      });

      if (response.ok) {
        const data = await response.json() as any;
        
        // Verify it's actually an Epic issue type
        if (data.fields?.issuetype?.name?.toLowerCase() === 'epic') {
          return {
            success: true,
            epicKey: epicInput,
            epicSummary: data.fields.summary
          };
        } else {
          return {
            success: false,
            errorMessage: `${epicInput} exists but is not an Epic (it's a ${data.fields?.issuetype?.name || 'unknown type'})`
          };
        }
      } else if (response.status === 404) {
        return {
          success: false,
          errorMessage: `Epic ${epicInput} not found. Please check the epic key is correct.`
        };
      } else {
        const errorText = await response.text();
        return {
          success: false,
          errorMessage: `Error validating epic ${epicInput}: ${response.status} ${errorText}`
        };
      }
    }
    
    // If it doesn't look like a key, search by summary/name
    const searchUrl = `https://${process.env.JIRA_HOST}/rest/api/3/search?jql=${encodeURIComponent(
      `issuetype = Epic AND summary ~ "${epicInput}" ORDER BY created DESC`
    )}&maxResults=5&fields=summary`;
    
    const searchResponse = await fetch(searchUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });
    
    if (!searchResponse.ok) {
      const errorText = await searchResponse.text();
      return {
        success: false,
        errorMessage: `Error searching for epic: ${searchResponse.status} ${errorText}`
      };
    }
    
    const searchData = await searchResponse.json() as any;
    
    if (!searchData.issues || searchData.issues.length === 0) {
      return {
        success: false,
        errorMessage: `No epic found matching "${epicInput}". Please provide an epic key (e.g., VIP-123) or check the epic name.`
      };
    }
    
    if (searchData.issues.length === 1) {
      return {
        success: true,
        epicKey: searchData.issues[0].key,
        epicSummary: searchData.issues[0].fields.summary
      };
    }
    
    // Multiple epics found
    const epicList = searchData.issues
      .slice(0, 3)
      .map((issue: any) => `${issue.key}: ${issue.fields.summary}`)
      .join(', ');
    
    return {
      success: false,
      errorMessage: `Multiple epics found matching "${epicInput}": ${epicList}. Please use the specific epic key.`
    };
    
  } catch (error) {
    console.error("Exception validating epic:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to resolve epic input to a valid epic key
export async function resolveEpicKey(
  epicInput: string,
  auth: string
): Promise<{
  success: boolean;
  epicKey?: string;
  errorMessage?: string;
}> {
  const validation = await validateEpic(epicInput, auth);
  
  if (validation.success && validation.epicKey) {
    return {
      success: true,
      epicKey: validation.epicKey
    };
  }
  
  return {
    success: false,
    errorMessage: validation.errorMessage
  };
}

// Helper function to get and validate project components
export async function getProjectComponents(
  projectKey: string,
  auth: string
): Promise<{
  success: boolean;
  components?: Array<{ id: string; name: string; description?: string }>;
  errorMessage?: string;
}> {
  try {
    const componentsUrl = `https://${process.env.JIRA_HOST}/rest/api/3/project/${projectKey}/components`;
    
    const response = await fetch(componentsUrl, {
      method: "GET",
      headers: {
        Authorization: `Basic ${auth}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      return {
        success: false,
        errorMessage: `Failed to fetch project components: ${response.status} ${errorText}`
      };
    }

    const components = await response.json() as Array<{
      id: string;
      name: string;
      description?: string;
    }>;
    
    return { success: true, components };
  } catch (error) {
    console.error("Exception fetching project components:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to validate and resolve component names to component objects
export async function validateComponents(
  componentNames: string[],
  projectKey: string,
  auth: string
): Promise<{
  success: boolean;
  components?: Array<{ name: string }>;
  errorMessage?: string;
}> {
  try {
    const componentsResult = await getProjectComponents(projectKey, auth);
    
    if (!componentsResult.success) {
      return {
        success: false,
        errorMessage: componentsResult.errorMessage
      };
    }
    
    const availableComponents = componentsResult.components || [];
    const validComponents: Array<{ name: string }> = [];
    const invalidComponents: string[] = [];
    
    for (const componentName of componentNames) {
      const found = availableComponents.find(comp => 
        comp.name.toLowerCase() === componentName.toLowerCase()
      );
      
      if (found) {
        validComponents.push({ name: found.name }); // Use exact case from project
      } else {
        invalidComponents.push(componentName);
      }
    }
    
    if (invalidComponents.length > 0) {
      const availableNames = availableComponents.map(c => c.name).slice(0, 10);
      return {
        success: false,
        errorMessage: `Invalid components: ${invalidComponents.join(', ')}\n\n` +
                     `Available components in ${projectKey}: ${availableNames.join(', ')}${availableComponents.length > 10 ? '...' : ''}`
      };
    }
    
    return {
      success: true,
      components: validComponents
    };
  } catch (error) {
    console.error("Exception validating components:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

// Helper function to resolve user input (email/name/accountId) to Account ID
export async function resolveUser(
  userInput: string,
  auth: string,
  projectKey?: string
): Promise<{
  success: boolean;
  accountId?: string;
  displayName?: string;
  errorMessage?: string;
}> {
  // If it already looks like an account ID (24-char hex), return it
  if (/^[0-9a-f]{24}$/i.test(userInput)) {
    return { 
      success: true, 
      accountId: userInput,
      displayName: 'Unknown (using provided Account ID)'
    };
  }
  
  try {
    // Search for user using enhanced search
    const searchResult = await searchJiraUsers(userInput, auth, {
      project: projectKey,
      activeOnly: true,
      returnFormat: "simple"
    });
    
    if (!searchResult.success) {
      return {
        success: false,
        errorMessage: `Failed to search for user: ${searchResult.errorMessage}`
      };
    }
    
    const users = searchResult.users || [];
    
    if (users.length === 0) {
      return {
        success: false,
        errorMessage: `No active user found matching "${userInput}". Try using the exact email address or search for the user with search-users tool.`
      };
    }
    
    if (users.length === 1) {
      return {
        success: true,
        accountId: users[0].accountId,
        displayName: users[0].displayName
      };
    }
    
    // Multiple users found - try exact email match first
    if (userInput.includes('@')) {
      const exactEmailMatch = users.find(user => 
        user.emailAddress && user.emailAddress.toLowerCase() === userInput.toLowerCase()
      );
      
      if (exactEmailMatch) {
        return {
          success: true,
          accountId: exactEmailMatch.accountId,
          displayName: exactEmailMatch.displayName
        };
      }
    }
    
    // Multiple matches without exact email match
    const userList = users
      .slice(0, 5)
      .map(user => `${user.displayName} (${user.emailAddress || 'no email'})`)
      .join(', ');
    
    return {
      success: false,
      errorMessage: `Multiple users found matching "${userInput}": ${userList}. Please use the exact email address or Account ID.`
    };
    
  } catch (error) {
    console.error("Exception resolving user:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}



// Helper function to validate ticket key format
export function validateTicketKey(ticketKey: string): {
  isValid: boolean;
  errorMessage?: string;
} {
  // Basic JIRA ticket key format: PROJECT-NUMBER
  const ticketKeyRegex = /^[A-Z][A-Z0-9]*-\d+$/;
  
  if (!ticketKeyRegex.test(ticketKey)) {
    return {
      isValid: false,
      errorMessage: `Invalid ticket key format: "${ticketKey}". Expected format: PROJECT-123 (e.g., VIP-456, SCRUM-123)`
    };
  }
  
  return { isValid: true };
}

// Helper function to provide contextual error suggestions
export function getErrorSuggestions(errorType: string, context?: any): string {
  switch (errorType) {
    case 'user_not_found':
      return `

**Troubleshooting:**
` +
             `• Try the exact email address
` +
             `• Use search-users tool to find available users
` +
             `• Check if the user has access to this project
` +
             `• Ensure the user account is active`;
    
    case 'epic_not_found':
      return `

**Troubleshooting:**
` +
             `• Verify the epic exists and is accessible
` +
             `• Try using the epic key (VIP-123) instead of name
` +
             `• Check if you have permission to link to this epic
` +
             `• Use search-tickets with issue_type=\"Epic\" to find epics`;
    
    case 'sprint_not_found':
      return `

**Troubleshooting:**
` +
             `• Use \"current\" to assign to active sprint
` +
             `• Use search-sprints to see all available sprints
` +
             `• Check if the sprint belongs to the correct project
` +
             `• Verify sprint is active or future (not closed)`;
    
    case 'component_not_found':
      return `

**Troubleshooting:**
` +
             `• Check component name spelling
` +
             `• Use get-project-schema to see all available components
` +
             `• Verify you have permission to assign components
` +
             `• Contact project admin to add missing components`;
    
    case 'field_configuration':
      return `

**Troubleshooting:**
` +
             `• Run get-project-schema to see field configuration
` +
             `• Some fields may need project-specific setup
` +
             `• Contact JIRA admin for custom field configuration
` +
             `• Try using standard JIRA fields instead`;
    
    default:
      return `

**General troubleshooting:**
` +
             `• Check your permissions for this project
` +
             `• Verify all field values are valid
` +
             `• Use get-project-schema for field requirements
` +
             `• Contact your JIRA administrator if issues persist`;
  }
}
