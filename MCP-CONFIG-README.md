# JIRA MCP Configuration Guide

This guide explains how to configure the JIRA MCP server now that the references to 3E, 3eco, etc. have been removed.

## Configuration Template

A template configuration file has been provided in `jira-mcp-config-template.json`. This template shows all possible configuration options for the JIRA MCP server.

## Configuration Location

Add the JIRA MCP server configuration to your Claude configuration file:

- **Claude Desktop App**:

  - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Windows: `%APPDATA%\Roaming\Claude\claude_desktop_config.json`
  - Linux: `~/.config/Claude/claude_desktop_config.json`

- **VSCode Extension**:
  - `~/.vscode-server/data/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json`

## Required Configuration

The following environment variables are **required** for the JIRA MCP server to function:

- `JIRA_HOST`: Your JIRA instance domain (e.g., `company.atlassian.net`)
- `JIRA_USERNAME`: Your JIRA username (usually your email address)
- `JIRA_API_TOKEN`: Your JIRA API token (see README.md for how to get this)
- `JIRA_PROJECT_KEY`: The key for your JIRA project (e.g., `SCRUM`, `DEV`, etc.)

## Optional Configuration

### Test Ticket Creation

- `AUTO_CREATE_TEST_TICKETS`: Set to "true" (default) to automatically create linked Test tickets for Story tickets with points, or "false" to disable this feature

### Custom Field IDs

These fields have defaults in the code but can be overridden if your JIRA instance uses different custom field IDs:

- `JIRA_ACCEPTANCE_CRITERIA_FIELD`: The field ID for acceptance criteria (default: "customfield_10429")
- `JIRA_STORY_POINTS_FIELD`: The field ID for story points (default: "customfield_10040")
- `JIRA_EPIC_LINK_FIELD`: The field ID for epic links (default: "customfield_10014")

### Product Field Configuration

This is entirely optional. All three variables must be provided together for this feature to work:

- `JIRA_PRODUCT_FIELD`: The field ID for the product field
- `JIRA_PRODUCT_VALUE`: The display value for the product
- `JIRA_PRODUCT_ID`: The ID of the product option

### Category Field Configuration

This is entirely optional. The category field is only used if `JIRA_CATEGORY_FIELD` is specified:

- `JIRA_CATEGORY_FIELD`: The field ID for the category field
- `USE_ALTERNATE_CATEGORY`: Set to "true" to use alternate category, "false" for default
- `JIRA_DEFAULT_CATEGORY_VALUE`: The display value for the default category
- `JIRA_DEFAULT_CATEGORY_ID`: The ID of the default category option
- `JIRA_ALTERNATE_CATEGORY_VALUE`: The display value for the alternate category
- `JIRA_ALTERNATE_CATEGORY_ID`: The ID of the alternate category option

## Minimal Configuration Example

If you want the absolute minimal configuration, you can use:

```json
{
  "mcpServers": {
    "jira-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/build/index.js"],
      "env": {
        "JIRA_HOST": "your-site.atlassian.net",
        "JIRA_USERNAME": "your-email@example.com",
        "JIRA_API_TOKEN": "your_api_token",
        "JIRA_PROJECT_KEY": "your_project_key"
      }
    }
  }
}
```

## Finding Custom Field IDs

If you need to find the custom field IDs for your JIRA instance:

1. Open a ticket in your JIRA instance
2. Press F12 to open developer tools
3. Go to the Network tab
4. Refresh the page
5. Look for a request to `issue/[ISSUE-KEY]`
6. Examine the response to find the custom field IDs

Alternatively, you can use the JIRA API to get a list of all fields:

```
GET https://your-site.atlassian.net/rest/api/3/field
```

## Troubleshooting

If you encounter issues:

1. Check that your JIRA credentials are correct
2. Verify the path to the project's index.js file in your configuration
3. Make sure you've given Claude permission to use tools
4. Check Claude's console logs for any error messages related to the JIRA MCP server
