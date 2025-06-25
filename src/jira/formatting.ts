// Helper functions for formatting data for JIRA API

// Helper function to format text content for JIRA API v3
export function formatJiraContent(
  content: string | undefined,
  defaultText: string = "No content provided"
) {
  return content
    ? {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: content,
              },
            ],
          },
        ],
      }
    : {
        type: "doc",
        version: 1,
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: defaultText,
              },
            ],
          },
        ],
      };
}

// Helper function to convert enhanced Markdown to Atlassian Document Format (ADF)
function markdownToADF(markdown: string): any {
  const lines = markdown.split('\n');
  const content: any[] = [];
  let currentList: any = null;
  let i = 0;
  
  while (i < lines.length) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Skip empty lines but close any open lists
    if (!trimmedLine) {
      if (currentList) {
        content.push(currentList);
        currentList = null;
      }
      i++;
      continue;
    }
    
    // Close any open list before processing special blocks
    if (currentList && (
      trimmedLine.startsWith(':::') || 
      trimmedLine.startsWith('```') || 
      trimmedLine.startsWith('---') ||
      trimmedLine.startsWith('@')
    )) {
      content.push(currentList);
      currentList = null;
    }
    
    // Confluence-style panels {panel:...}
    if (trimmedLine.startsWith('{panel:')) {
      const panelContent: any[] = [];
      // Extract title from panel parameters
      const titleMatch = trimmedLine.match(/title=([^|]*)/);
      const title = titleMatch ? titleMatch[1].replace(/⚠️|🚨|⚠|🔥|💡|ℹ️|✅|❌|🔧|📝/g, '').trim() : '';
      
      i++; // Move to next line
      
      // Collect panel content until closing {panel}
      while (i < lines.length && !lines[i].trim().startsWith('{panel}')) {
        if (lines[i].trim()) {
          panelContent.push({
            type: "paragraph",
            content: parseInlineFormatting(lines[i])
          });
        }
        i++;
      }
      
      // Default to warning panel for Confluence-style panels
      content.push({
        type: "panel",
        attrs: {
          panelType: "warning"
        },
        content: panelContent.length > 0 ? panelContent : [{
          type: "paragraph",
          content: [{ type: "text", text: title || "Panel content" }]
        }]
      });
      
      i++; // Skip closing {panel}
      continue;
    }

    // Panel blocks (:::info, :::warning, etc.)
    if (trimmedLine.startsWith(':::')) {
      const panelMatch = trimmedLine.match(/^:::(\w+)(?:\s+(.*))?$/);
      if (panelMatch) {
        const panelType = panelMatch[1].toLowerCase();
        const panelContent: any[] = [];
        i++; // Move to next line
        
        // Collect panel content until closing :::
        while (i < lines.length && !lines[i].trim().startsWith(':::')) {
          if (lines[i].trim()) {
            panelContent.push({
              type: "paragraph",
              content: parseInlineFormatting(lines[i])
            });
          }
          i++;
        }
        
        // Map panel types
        const panelTypeMap: { [key: string]: string } = {
          'info': 'info',
          'note': 'note',
          'success': 'success',
          'warning': 'warning',
          'error': 'error'
        };
        
        if (panelTypeMap[panelType]) {
          content.push({
            type: "panel",
            attrs: {
              panelType: panelTypeMap[panelType]
            },
            content: panelContent.length > 0 ? panelContent : [{
              type: "paragraph",
              content: [{ type: "text", text: "Empty panel" }]
            }]
          });
        } else if (panelType === 'quote') {
          // Quote block
          content.push({
            type: "blockquote",
            content: panelContent.length > 0 ? panelContent : [{
              type: "paragraph",
              content: [{ type: "text", text: "Empty quote" }]
            }]
          });
        } else if (panelType === 'expand') {
          // Expand block with title
          const title = panelMatch[2] || "Click to expand";
          content.push({
            type: "expand",
            attrs: {
              title: title
            },
            content: panelContent
          });
        }
        
        i++; // Skip closing :::
        continue;
      }
    }
    
    // Code blocks ```language
    if (trimmedLine.startsWith('```')) {
      const langMatch = trimmedLine.match(/^```(\w+)?/);
      const language = langMatch?.[1] || 'plain';
      const codeLines: string[] = [];
      i++; // Move to next line
      
      // Collect code until closing ```
      while (i < lines.length && !lines[i].trim().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      
      content.push({
        type: "codeBlock",
        attrs: {
          language: language
        },
        content: [{
          type: "text",
          text: codeLines.join('\n')
        }]
      });
      
      i++; // Skip closing ```
      continue;
    }
    
    // Divider ---
    if (trimmedLine === '---') {
      content.push({
        type: "rule"
      });
      i++;
      continue;
    }
    
    // Status @status[text|color]
    if (trimmedLine.startsWith('@status[')) {
      const statusMatch = trimmedLine.match(/@status\[([^|]+)\|([^\]]+)\]/);
      if (statusMatch) {
        const [, text, color] = statusMatch;
        const remainingText = trimmedLine.replace(/@status\[[^\]]+\]/, '').trim();
        
        const paragraphContent: any[] = [{
          type: "status",
          attrs: {
            text: text,
            color: color.toLowerCase()
          }
        }];
        
        if (remainingText) {
          paragraphContent.push({
            type: "text",
            text: " " + remainingText
          });
        }
        
        content.push({
          type: "paragraph",
          content: paragraphContent
        });
        
        i++;
        continue;
      }
    }
    
    // Headers (## Header)
    if (trimmedLine.startsWith('##')) {
      const headerText = trimmedLine.replace(/^#+\s*/, '');
      content.push({
        type: "heading",
        attrs: { level: Math.min(trimmedLine.match(/^#+/)?.[0].length || 1, 6) },
        content: [{ type: "text", text: headerText }]
      });
      i++;
      continue;
    }
    
    // Bullet points
    if (trimmedLine.match(/^-\s/) || (trimmedLine.match(/^\*\s/) && !trimmedLine.startsWith('**'))) {
      const itemText = trimmedLine.replace(/^[-*]\s*/, '');
      const listItem = {
        type: "listItem",
        content: [{
          type: "paragraph",
          content: parseInlineFormatting(itemText)
        }]
      };
      
      if (!currentList) {
        currentList = {
          type: "bulletList",
          content: [listItem]
        };
      } else {
        currentList.content.push(listItem);
      }
      i++;
      continue;
    }
    
    // Regular paragraphs
    if (currentList) {
      content.push(currentList);
      currentList = null;
    }
    
    content.push({
      type: "paragraph",
      content: parseInlineFormatting(trimmedLine)
    });
    i++;
  }
  
  // Don't forget to add any remaining list
  if (currentList) {
    content.push(currentList);
  }
  
  return {
    type: "doc",
    version: 1,
    content: content.length > 0 ? content : [{
      type: "paragraph",
      content: [{ type: "text", text: "No description provided" }]
    }]
  };
}

// Helper function to parse inline formatting (bold, italic, emojis, etc.)
function parseInlineFormatting(text: string): any[] {
  const content: any[] = [];
  
  // First, handle emojis - replace :emoji: with actual emoji nodes
  const emojiMap: { [key: string]: { id: string, text: string } } = {
    ':smile:': { id: '1f604', text: '😄' },
    ':grin:': { id: '1f601', text: '😁' },
    ':joy:': { id: '1f602', text: '😂' },
    ':smiley:': { id: '1f603', text: '😃' },
    ':relaxed:': { id: '263a', text: '☺️' },
    ':blush:': { id: '1f60a', text: '😊' },
    ':heart:': { id: '2764', text: '❤️' },
    ':thumbsup:': { id: '1f44d', text: '👍' },
    ':thumbsdown:': { id: '1f44e', text: '👎' },
    ':ok_hand:': { id: '1f44c', text: '👌' },
    ':wave:': { id: '1f44b', text: '👋' },
    ':pray:': { id: '1f64f', text: '🙏' },
    ':clap:': { id: '1f44f', text: '👏' },
    ':muscle:': { id: '1f4aa', text: '💪' },
    ':rocket:': { id: '1f680', text: '🚀' },
    ':100:': { id: '1f4af', text: '💯' },
    ':fire:': { id: '1f525', text: '🔥' },
    ':star:': { id: '2b50', text: '⭐' },
    ':warning:': { id: '26a0', text: '⚠️' },
    ':white_check_mark:': { id: '2705', text: '✅' },
    ':x:': { id: '274c', text: '❌' },
    ':heavy_check_mark:': { id: '2714', text: '✔️' },
    ':question:': { id: '2753', text: '❓' },
    ':exclamation:': { id: '2757', text: '❗' },
    ':bulb:': { id: '1f4a1', text: '💡' },
    ':tada:': { id: '1f389', text: '🎉' },
    ':sparkles:': { id: '2728', text: '✨' },
    ':bug:': { id: '1f41b', text: '🐛' },
    ':zap:': { id: '26a1', text: '⚡' },
    ':coffee:': { id: '2615', text: '☕' },
    ':computer:': { id: '1f4bb', text: '💻' },
    ':lock:': { id: '1f512', text: '🔒' },
    ':key:': { id: '1f511', text: '🔑' },
    ':email:': { id: '1f4e7', text: '📧' },
    ':memo:': { id: '1f4dd', text: '📝' },
    ':calendar:': { id: '1f4c5', text: '📅' },
    ':chart_with_upwards_trend:': { id: '1f4c8', text: '📈' },
  };
  
  // Process text character by character
  let i = 0;
  let currentText = '';
  
  while (i < text.length) {
    // Check for emoji pattern :word:
    if (text[i] === ':') {
      const emojiMatch = text.slice(i).match(/^(:\w+:)/);
      if (emojiMatch && emojiMap[emojiMatch[1]]) {
        // Add any accumulated text first
        if (currentText) {
          content.push({ type: "text", text: currentText });
          currentText = '';
        }
        
        // Add emoji node
        const emoji = emojiMap[emojiMatch[1]];
        content.push({
          type: "emoji",
          attrs: {
            shortName: emojiMatch[1],
            id: emoji.id,
            text: emoji.text
          }
        });
        
        i += emojiMatch[1].length;
        continue;
      }
    }
    
    if (text[i] === '`') {
      // Found potential code start
      // Add any accumulated text first
      if (currentText) {
        content.push({ type: "text", text: currentText });
        currentText = '';
      }
      
      // Find the end of code
      let endPos = i + 1;
      while (endPos < text.length) {
        if (text[endPos] === '`') {
          break;
        }
        endPos++;
      }
      
      if (endPos < text.length) {
        // Found closing `
        const codeText = text.slice(i + 1, endPos);
        if (codeText.trim()) { // Only add code mark if there's actual content
          content.push({
            type: "text",
            text: codeText,
            marks: [{ type: "code" }]
          });
        } else {
          // Empty or whitespace-only, treat as regular text
          currentText += '`' + codeText + '`';
        }
        i = endPos + 1; // Skip past closing `
      } else {
        // No closing `, treat as regular text
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '*' && text[i + 1] === '*') {
      // Found potential bold start
      // Add any accumulated text first
      if (currentText) {
        content.push({ type: "text", text: currentText });
        currentText = '';
      }
      
      // Find the end of bold
      let endPos = i + 2;
      while (endPos < text.length - 1) {
        if (text[endPos] === '*' && text[endPos + 1] === '*') {
          break;
        }
        endPos++;
      }
      
      if (endPos < text.length - 1) {
        // Found closing **
        const boldText = text.slice(i + 2, endPos);
        content.push({
          type: "text",
          text: boldText,
          marks: [{ type: "strong" }]
        });
        i = endPos + 2; // Skip past closing **
      } else {
        // No closing **, treat as regular text
        currentText += text[i];
        i++;
      }
    } else if (text[i] === '*' && text[i + 1] !== '*' && (i === 0 || text[i - 1] !== '*')) {
      // Found potential italic start (single * not part of **)
      // Add any accumulated text first
      if (currentText) {
        content.push({ type: "text", text: currentText });
        currentText = '';
      }
      
      // Find the end of italic
      let endPos = i + 1;
      while (endPos < text.length) {
        if (text[endPos] === '*' && (endPos === text.length - 1 || text[endPos + 1] !== '*')) {
          break;
        }
        endPos++;
      }
      
      if (endPos < text.length) {
        // Found closing *
        const italicText = text.slice(i + 1, endPos);
        if (italicText.trim()) {
          content.push({
            type: "text",
            text: italicText,
            marks: [{ type: "em" }]
          });
        }
        i = endPos + 1; // Skip past closing *
      } else {
        // No closing *, treat as regular text
        currentText += text[i];
        i++;
      }
    } else {
      // Regular character
      currentText += text[i];
      i++;
    }
  }
  
  // Add any remaining text
  if (currentText) {
    content.push({ type: "text", text: currentText });
  }
  
  // If no content was created, return plain text
  if (content.length === 0) {
    content.push({ type: "text", text: text });
  }
  
  return content;
}

// Helper function to format description for JIRA API v3
export function formatDescription(description: string | undefined) {
  if (!description) {
    return {
      type: "doc",
      version: 1,
      content: [{
        type: "paragraph",
        content: [{ type: "text", text: "No description provided" }]
      }]
    };
  }
  
  return markdownToADF(description);
}

// Helper function to format acceptance criteria for JIRA API v3
export function formatAcceptanceCriteria(criteria: string | undefined) {
  // Check if criteria is undefined or empty
  if (!criteria) {
    return {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [
            {
              type: "text",
              text: "No acceptance criteria provided",
            },
          ],
        },
      ],
    };
  }

  // Split criteria by newlines to handle bullet points properly
  const lines = criteria.split("\n");
  const content = [];

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines
    if (!trimmedLine) continue;

    // Check if line is a bullet point
    if (trimmedLine.startsWith("-") || trimmedLine.startsWith("*")) {
      content.push({
        type: "bulletList",
        content: [
          {
            type: "listItem",
            content: [
              {
                type: "paragraph",
                content: [
                  {
                    type: "text",
                    text: trimmedLine.substring(1).trim(),
                  },
                ],
              },
            ],
          },
        ],
      });
    } else {
      // Regular paragraph
      content.push({
        type: "paragraph",
        content: [
          {
            type: "text",
            text: trimmedLine,
          },
        ],
      });
    }
  }

  return {
    type: "doc",
    version: 1,
    content: content,
  };
}
