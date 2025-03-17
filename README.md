# JIRA MCP Integration

A [Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) server for integrating JIRA with Claude. This tool allows Claude to create JIRA tickets directly within your conversations.

<img width="772" alt="grafik" src="https://github.com/user-attachments/assets/a6f9afd8-7f75-4316-9421-ee7126002d2b" />
<img width="1188" alt="grafik" src="https://github.com/user-attachments/assets/b8f089ac-4443-4a64-91c0-87b97175d9dd" />

## Features

- Create JIRA tickets with summary, description, and issue type
- Seamless integration with Claude desktop application
- Simple configuration using Claude's desktop configuration file

## Installation

1. Clone the repository:

   ```
   git clone https://github.com/MankowskiNick/jira-mcp.git
   cd jira-mcp
   ```

2. Install dependencies:

   ```
   npm install
   ```

3. Build the project:
   ```
   npm run build
   ```

## Configuration

### Claude Desktop Configuration

Add the JIRA MCP server configuration to your `claude_desktop_config.json` file. This file is typically located at:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Roaming\Claude\claude_desktop_config.json`

Add the following configuration to the file:

```json
{
  "mcpServers": {
    "jira-mcp": {
      "command": "node",
      "args": ["/path/to/project/build/index.js"],
      "env": {
        "JIRA_HOST": "your-site.atlassian.net",
        "JIRA_USERNAME": "your-email@example.com",
        "JIRA_API_TOKEN": "your_api_token",
        "JIRA_PROJECT_KEY": "your_project_key",
        "USE_NON_CPP": "false"
      }
    }
  }
}
```

Replace the placeholder values with your actual JIRA information:

- `/path/to/project/build/index.js`: Full path to the built index.js file
- `JIRA_HOST`: Your JIRA instance domain (e.g., `company.atlassian.net`)
- `JIRA_USERNAME`: Your JIRA username (usually your email address)
- `JIRA_API_TOKEN`: Your JIRA API token (see below for how to get this)
- `JIRA_PROJECT_KEY`: The key for your JIRA project (e.g., `SCRUM`, `DEV`, etc.)
- `USE_NON_CPP`: Set to "true" to use "Non-CPP" for the customfield_10636 field, or "false" (default) to use "CPP"

## Available Tools

### create-ticket

Creates a new JIRA ticket.

**Parameters:**

- `summary`: The title/summary of the ticket (required)
- `issue_type`: The type of issue (`Bug`, `Task`, or `Story`, defaults to `Task`)
- `description`: Detailed description of the ticket (optional)

### read-ticket

Retrieves the details of an existing JIRA ticket.
**Parameters:**

- `ticket_id`: The ID of the JIRA ticket you want to read (required)

## Usage with Claude

Once configured properly, you can ask Claude to create JIRA tickets directly:

```
Please create a JIRA ticket to track the database performance issue we discussed.
```

Claude will use the create-ticket tool to generate a ticket in your JIRA project.

## Getting a JIRA API Token

1. Log in to your Atlassian account at https://id.atlassian.com/manage-profile/security
2. Go to Security > API tokens
3. Click "Create API token"
4. Give your token a name (e.g., "Claude Integration")
5. Click "Create"
6. Copy the token (you won't be able to see it again)

## Troubleshooting

If you encounter issues:

1. Check that your JIRA credentials are correct
2. Verify the path to the project's index.js file in your claude_desktop_config.json
3. Make sure you've given Claude permission to use tools
4. Check Claude's console logs for any error messages related to the JIRA MCP server
