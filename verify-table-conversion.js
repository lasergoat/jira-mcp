// Simple verification script for table conversion
import { formatDescription, adfToMarkdown } from './build/jira/formatting.js';

console.log('Testing Table Conversion...\n');

// Test 1: Simple table
const simpleTable = `|| Name || Age || City ||
| John | 30 | NYC |
| Jane | 25 | LA |`;

console.log('Test 1: Simple Table');
console.log('Input markdown:');
console.log(simpleTable);
console.log('\nConverted to ADF:');
const adf1 = formatDescription(simpleTable);
console.log(JSON.stringify(adf1, null, 2));

// Verify the ADF structure
const hasTable = adf1.content.some(block => block.type === 'table');
console.log('\n✓ Has table node:', hasTable);

if (hasTable) {
  const tableNode = adf1.content.find(block => block.type === 'table');
  const hasHeaders = tableNode.content[0].content.some(cell => cell.type === 'tableHeader');
  const hasCells = tableNode.content[1].content.some(cell => cell.type === 'tableCell');
  console.log('✓ Has table headers:', hasHeaders);
  console.log('✓ Has table cells:', hasCells);
  console.log('✓ Number of rows:', tableNode.content.length);
}

// Test round-trip conversion
console.log('\n\nTest 2: Round-trip Conversion (Markdown -> ADF -> Markdown)');
const markdown2 = adfToMarkdown(adf1);
console.log('Result:');
console.log(markdown2);
console.log('\nOriginal vs Result comparison:');
console.log('Original lines:', simpleTable.split('\n').length);
console.log('Result lines:', markdown2.split('\n').filter(l => l.includes('||') || l.includes('|')).length);

// Test 3: Mixed content with table
const mixedContent = `## Test Section

This is a paragraph.

|| Header 1 || Header 2 ||
| Cell 1 | Cell 2 |

- Bullet 1
- Bullet 2`;

console.log('\n\nTest 3: Mixed Content');
console.log('Input:');
console.log(mixedContent);
const adf3 = formatDescription(mixedContent);
console.log('\nADF content types:');
adf3.content.forEach((block, i) => {
  console.log(`  ${i}: ${block.type}`);
});

console.log('\nConverted back to markdown:');
console.log(adfToMarkdown(adf3));

// Test 4: Table with inline formatting
const formattedTable = `|| Feature || Status ||
| **Bold Text** | Regular |
| *Italic* | \`code\` |`;

console.log('\n\nTest 4: Table with Inline Formatting');
const adf4 = formatDescription(formattedTable);
console.log('ADF structure:');
const table4 = adf4.content.find(b => b.type === 'table');
if (table4) {
  const firstCell = table4.content[0].content[0];
  console.log('First cell content:', JSON.stringify(firstCell.content[0].content, null, 2));
}

console.log('\nConverted back:');
console.log(adfToMarkdown(adf4));

console.log('\n✅ All tests completed!');
console.log('\nNext steps:');
console.log('1. Test with actual Jira MCP server');
console.log('2. Create a test ticket with tables');
console.log('3. Verify table rendering in Jira UI');
console.log('4. Get the ticket back and verify markdown format');
