# Table Conversion Test Cases

## Test Case 1: Simple Table

### Input Markdown:
```
|| Name || Age || City ||
| John | 30 | NYC |
| Jane | 25 | LA |
```

### Expected Result:
- Table renders properly in Jira with headers and 2 data rows
- When fetched back with get-ticket, table should be in markdown format

---

## Test Case 2: Table with Complex Content

### Input Markdown:
```
|| Code || Description || Count ||
| 59 | SUSPECTED FRAUD | 1,980 |
| 05 | DECLINE | 1,458 |
```

### Expected Result:
- Preserves formatting, commas in numbers, uppercase text
- Table renders correctly in Jira

---

## Test Case 3: Multiple Tables in One Description

### Input Markdown:
```
## Section 1
|| Col A || Col B ||
| Data 1 | Data 2 |

## Section 2
|| Col X || Col Y ||
| Data 3 | Data 4 |
```

### Expected Result:
- Both tables render correctly with headings preserved
- When fetched back, both tables and headings are in markdown

---

## Test Case 4: Mixed Content

### Input Markdown:
```
:::error
**ALERT**: Critical issue
:::

Some text here.

|| Header 1 || Header 2 ||
| Cell 1 | Cell 2 |

- Bullet point 1
- Bullet point 2

\`\`\`sql
SELECT * FROM table;
\`\`\`
```

### Expected Result:
- All content types render correctly (panels, text, table, list, code)
- Table integrates seamlessly with other content types

---

## Test Case 5: Table with Inline Formatting

### Input Markdown:
```
|| Feature || Status || Priority ||
| **Authentication** | @status[Done|green] | High |
| *User Profile* | @status[In Progress|yellow] | Medium |
| `API` Integration | @status[Todo|gray] | Low |
```

### Expected Result:
- Bold, italic, and code formatting preserved in cells
- Status indicators render correctly

---

## Manual Testing Instructions

1. Use the `create-ticket` MCP tool to create a test ticket with table content
2. Check the Jira UI to verify the table renders properly
3. Use the `get-ticket` MCP tool to fetch the ticket back
4. Verify the markdown table is correctly formatted in the response
5. Use `update-ticket` to update the description with different table content
6. Verify updates work correctly

## Automated Test Script

To test programmatically, you can use the following approach:

1. Create a ticket with table content
2. Get the raw ADF data to verify table structure
3. Get the ticket normally to verify markdown conversion
4. Compare input markdown with output markdown
