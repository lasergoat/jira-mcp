# Jira MCP

A [Model Context Protocol](https://modelcontextprotocol.io) server that gives Claude full access to your Jira instance -- create tickets, search, manage sprints, update fields, and more.

## Getting a Jira API Token

You'll need an Atlassian API token before starting.

1. Go to [Atlassian API tokens](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click **Create API token**
3. Name it (e.g., "Claude Integration") and click **Create**
4. Copy the token -- you won't be able to see it again

## Quick Start

### Claude Code (recommended)

```bash
# Clone and build
git clone https://github.com/lasergoat/jira-mcp.git
cd jira-mcp
npm install && npm run build

# Add to Claude Code
claude mcp add jira-mcp -- node $(pwd)/build/index.js
```

### Claude Desktop

Add this to your Claude Desktop config file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Roaming\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "jira-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/build/index.js"]
    }
  }
}
```

### VS Code

Create `.vscode/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "jira-mcp": {
      "command": "node",
      "args": ["/absolute/path/to/jira-mcp/build/index.js"]
    }
  }
}
```

## Setup

No manual configuration needed. On first use, the MCP will detect that credentials aren't configured and prompt you to run `initialize-jira-connection`. Provide your:

- **Jira host** (e.g., `company.atlassian.net`)
- **Email/username**
- **API token** (from the step above)

The MCP tests the connection and saves your credentials for future sessions. After that, run `configure-project-fields` to set up your project's custom fields automatically.

## What You Can Do

- Create, update, search, and link tickets
- Manage sprints and assign tickets to them
- Discover and configure custom fields per project
- Search for users, epics, and components
- Add comments and attachments
- Transition ticket status through workflows
- Clone tickets from existing ones
