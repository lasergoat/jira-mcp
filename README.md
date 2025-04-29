# JIRA MCP Integration

A [Model Context Protocol](https://www.anthropic.com/news/model-context-protocol) server for integrating JIRA with Claude. This tool allows Claude to create JIRA tickets directly within your conversations.

<img width="772" alt="grafik" src="https://github.com/user-attachments/assets/a6f9afd8-7f75-4316-9421-ee7126002d2b" />
<img width="1188" alt="grafik" src="https://github.com/user-attachments/assets/b8f089ac-4443-4a64-91c0-87b97175d9dd" />

## Features

- Create JIRA tickets with summary, description, acceptance criteria, and issue type
- Assign story points to Story tickets
- Automatically create linked Test tickets for Stories with points
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
        "AUTO_CREATE_TEST_TICKETS": "true",

        "JIRA_ACCEPTANCE_CRITERIA_FIELD": "customfield_10429",
        "JIRA_STORY_POINTS_FIELD": "customfield_10040",
        "JIRA_EPIC_LINK_FIELD": "customfield_10014",

        "JIRA_PRODUCT_FIELD": "customfield_10757",
        "JIRA_PRODUCT_VALUE": "Your Product Name",
        "JIRA_PRODUCT_ID": "12345",

        "JIRA_CATEGORY_FIELD": "customfield_10636",
        "USE_ALTERNATE_CATEGORY": "false",
        "JIRA_DEFAULT_CATEGORY_VALUE": "Default Category",
        "JIRA_DEFAULT_CATEGORY_ID": "12345",
        "JIRA_ALTERNATE_CATEGORY_VALUE": "Alternate Category",
        "JIRA_ALTERNATE_CATEGORY_ID": "67890"
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
- `AUTO_CREATE_TEST_TICKETS`: Set to "true" (default) to automatically create linked Test tickets for Story tickets with points, or "false" to disable this feature

### Custom Field Configuration

The following environment variables allow you to configure custom fields without hardcoding them in the source code:

- `JIRA_ACCEPTANCE_CRITERIA_FIELD`: The field ID for acceptance criteria (default: "customfield_10429")
- `JIRA_STORY_POINTS_FIELD`: The field ID for story points (default: "customfield_10040")
- `JIRA_EPIC_LINK_FIELD`: The field ID for epic links (default: "customfield_10014")

#### Product Field Configuration (Optional)

- `JIRA_PRODUCT_FIELD`: The field ID for the product field
- `JIRA_PRODUCT_VALUE`: The display value for the product
- `JIRA_PRODUCT_ID`: The ID of the product option

#### Category Field Configuration (Optional)

- `JIRA_CATEGORY_FIELD`: The field ID for the category field
- `USE_ALTERNATE_CATEGORY`: Set to "true" to use alternate category, "false" for default
- `JIRA_DEFAULT_CATEGORY_VALUE`: The display value for the default category
- `JIRA_DEFAULT_CATEGORY_ID`: The ID of the default category option
- `JIRA_ALTERNATE_CATEGORY_VALUE`: The display value for the alternate category
- `JIRA_ALTERNATE_CATEGORY_ID`: The ID of the alternate category option

## Available Tools

### create-ticket

Creates a new JIRA ticket.

**Parameters:**

- `summary`: The title/summary of the ticket (required)
- `issue_type`: The type of issue (`Bug`, `Task`, or `Story`, defaults to `Task`)
- `description`: Detailed description of the ticket (optional)
- `acceptance_criteria`: Acceptance criteria for the ticket (optional, stored in customfield_10429)
- `story_points`: Story points for the ticket (optional, Fibonacci sequence: 1, 2, 3, 5, 8, 13, etc.)
- `create_test_ticket`: Override the default setting for automatically creating a linked Test ticket (optional, boolean)
- `parent_epic`: Key of the parent epic to link this ticket to (optional, e.g., "PROJ-123")

When creating a Story ticket with story points:

- The "QA-Testable" label is automatically added to the Story
- A linked Test ticket is automatically created (if `AUTO_CREATE_TEST_TICKETS` is enabled)
- The Test ticket uses the Story's title as its description
- The Test ticket is linked to the Story with a "Test Case Linking" relationship

### add-test-steps

Adds test steps to a test ticket via the Zephyr integration.

**Parameters:**

- `ticket_key`: The key of the test ticket to add steps to (required, e.g., "PROJ-123")
- `steps`: An array of test step objects (required), where each step object contains:
  - `step`: The description of the test step (required)
  - `data`: Test data for the step (optional)
  - `result`: Expected result of the step (optional)

**Example:**

```json
{
  "ticket_key": "PROJ-123",
  "steps": [
    {
      "step": "Navigate to the login page",
      "data": "https://example.com/login",
      "result": "Login form is displayed"
    },
    {
      "step": "Enter valid credentials",
      "data": "username=test, password=password123",
      "result": "User is logged in successfully"
    }
  ]
}
```

This tool requires Zephyr for Jira Cloud to be installed and configured. You'll need to set the Zephyr API environment variables in your configuration file (see MCP-CONFIG-README.md for details).

### get-ticket

Retrieves the details of an existing JIRA ticket.

**Parameters:**

- `ticket_id`: The ID of the JIRA ticket you want to read (required)

### search-tickets

Searches for JIRA tickets by issue type.

**Parameters:**

- `issue_type`: The type of issue to search for (`Bug`, `Task`, `Story`, or `Test`) (required)
- `max_results`: Maximum number of results to return (optional, default: 10, max: 50)
- `additional_criteria`: Additional JQL criteria to include in the search (optional)

This tool allows you to find all tickets of a specific type (e.g., all Bug tickets) in your JIRA project. You can further refine your search by providing additional JQL criteria.

### link-tickets

Links two JIRA tickets together.

**Parameters:**

- `outward_issue`: The key of the outward issue (required)
- `inward_issue`: The key of the inward issue (required)
- `link_type`: The type of link to create (optional, defaults to "Test Case Linking")

## Usage with Claude

Once configured properly, you can ask Claude to create JIRA tickets directly:

```
Please create a JIRA ticket to track the database performance issue we discussed.
```

You can also specify acceptance criteria for your tickets:

```
Create a JIRA ticket for implementing the new user authentication feature with the following acceptance criteria:
- Users can log in with email and password
- Password reset functionality works via email
- Account lockout occurs after 5 failed attempts
- OAuth integration with Google and Facebook
```

Claude will use the create-ticket tool to generate a ticket in your JIRA project with all the specified details.

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
