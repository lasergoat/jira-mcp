import fetch from "node-fetch";
import { JiraField, JiraTransition, JiraComment, JiraAttachment, JiraUser } from "./types.js";
import { formatDescription } from "./formatting.js";

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
    
    // Get sprint info - Note: Hardcoded field reference, should be made dynamic
    let sprint = 'No sprint';
    if (ticketData.fields.customfield_10020 && ticketData.fields.customfield_10020.length > 0) {
      const sprintData = ticketData.fields.customfield_10020[ticketData.fields.customfield_10020.length - 1];
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
  auth: string
): Promise<{
  success: boolean;
  users?: JiraUser[];
  errorMessage?: string;
}> {
  // First try to search by query string (matches display name, email, etc)
  let jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/user/search?query=${encodeURIComponent(query)}`;

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
        const emailUrl = `https://${process.env.JIRA_HOST}/rest/api/3/user/search?query=${encodeURIComponent(query)}&accountType=atlassian`;
        const emailResponse = await fetch(emailUrl, {
          method: "GET",
          headers: {
            Authorization: `Basic ${auth}`,
          },
        });
        
        if (emailResponse.ok) {
          const users = (await emailResponse.json()) as JiraUser[];
          return { success: true, users };
        }
      }
      
      const errorText = await response.text();
      return { 
        success: false, 
        errorMessage: `Failed to search users: ${response.status} ${errorText}` 
      };
    }

    const users = (await response.json()) as JiraUser[];
    return { success: true, users };
  } catch (error) {
    console.error("Exception searching users:", error);
    return {
      success: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

