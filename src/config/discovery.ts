import { DiscoveredField, FieldMapping } from './types.js';

interface FieldMatchResult {
  field: DiscoveredField;
  confidence: number;
  reason: string;
}

export class FieldDiscovery {
  // Common field name patterns
  private static fieldPatterns: Record<string, RegExp[]> = {
    storyPoints: [
      /story\s*points?/i,
      /points?/i,
      /estimation/i,
      /effort/i
    ],
    epicLink: [
      /epic\s*link/i,
      /parent\s*epic/i,
      /epic/i
    ],
    acceptanceCriteria: [
      /acceptance\s*criteria/i,
      /ac/i,
      /requirements?/i
    ],
    sprint: [
      /sprint/i,
      /iteration/i
    ],
    dueDate: [
      /due\s*date/i,
      /deadline/i,
      /target\s*date/i
    ],
    origination: [
      /origination/i,
      /source/i,
      /origin/i,
      /reported\s*by/i
    ],
    product: [
      /product/i,
      /application/i,
      /component/i
    ],
    category: [
      /category/i,
      /type/i,
      /classification/i
    ]
  };

  static async discoverFields(
    jiraHost: string,
    auth: string
  ): Promise<DiscoveredField[]> {
    const url = `https://${jiraHost}/rest/api/3/field`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch fields: ${response.statusText}`);
    }

    return await response.json();
  }

  static findFieldMatches(
    fieldName: string,
    availableFields: DiscoveredField[]
  ): FieldMatchResult[] {
    const results: FieldMatchResult[] = [];
    const patterns = this.fieldPatterns[fieldName] || [];

    for (const field of availableFields) {
      let confidence = 0;
      let reason = '';

      // Exact match
      if (field.name.toLowerCase() === fieldName.toLowerCase()) {
        confidence = 100;
        reason = 'Exact name match';
      }
      // Check patterns
      else if (patterns.length > 0) {
        for (const pattern of patterns) {
          if (pattern.test(field.name)) {
            confidence = Math.max(confidence, 80);
            reason = 'Pattern match';
            break;
          }
        }
      }
      // Check clause names (JQL field names)
      else if (field.clauseNames) {
        for (const clauseName of field.clauseNames) {
          if (clauseName.toLowerCase().includes(fieldName.toLowerCase())) {
            confidence = Math.max(confidence, 70);
            reason = 'Clause name match';
          }
        }
      }
      // Fuzzy match using Levenshtein distance
      else {
        const distance = this.levenshteinDistance(
          field.name.toLowerCase(),
          fieldName.toLowerCase()
        );
        const maxLength = Math.max(field.name.length, fieldName.length);
        const similarity = 1 - (distance / maxLength);
        
        if (similarity > 0.6) {
          confidence = Math.round(similarity * 60);
          reason = 'Fuzzy match';
        }
      }

      // Type-based confidence boost
      if (confidence > 0) {
        if (fieldName === 'storyPoints' && field.schema?.type === 'number') {
          confidence += 10;
        } else if (fieldName === 'epicLink' && field.schema?.custom === 'com.pyxis.greenhopper.jira:gh-epic-link') {
          confidence += 20;
          reason = 'Epic link type match';
        } else if (fieldName === 'sprint' && field.schema?.custom === 'com.pyxis.greenhopper.jira:gh-sprint') {
          confidence += 20;
          reason = 'Sprint type match';
        }
      }

      if (confidence > 0) {
        results.push({
          field,
          confidence: Math.min(confidence, 100),
          reason
        });
      }
    }

    // Sort by confidence descending
    return results.sort((a, b) => b.confidence - a.confidence);
  }

  static async discoverProjectFields(
    jiraHost: string,
    auth: string,
    projectKey: string,
    sampleIssueKey?: string,
    fieldsToDiscover?: string[]
  ): Promise<Map<string, FieldMapping>> {
    // Get all available fields
    const allFields = await this.discoverFields(jiraHost, auth);
    
    // If sample issue provided, analyze it to see which fields are actually used
    let sampleFieldsInUse: Set<string> = new Set();
    if (sampleIssueKey) {
      const issueData = await this.fetchIssue(jiraHost, auth, sampleIssueKey);
      if (issueData.fields) {
        sampleFieldsInUse = new Set(Object.keys(issueData.fields));
      }
    }

    const fieldMappings = new Map<string, FieldMapping>();
    
    // If specific fields requested, only configure those
    if (fieldsToDiscover && fieldsToDiscover.length > 0) {
      for (const fieldName of fieldsToDiscover) {
        const matches = this.findFieldMatches(fieldName, allFields);
        
        // If we have a sample issue, boost confidence for fields in use
        if (sampleFieldsInUse.size > 0) {
          for (const match of matches) {
            if (sampleFieldsInUse.has(match.field.id)) {
              match.confidence += 15;
            }
          }
          matches.sort((a, b) => b.confidence - a.confidence);
        }

        // Take the best match if confidence is high enough
        if (matches.length > 0 && matches[0].confidence >= 70) {
          fieldMappings.set(fieldName, {
            id: matches[0].field.id,
            name: matches[0].field.name,
            type: matches[0].field.schema?.type || 'string',
            confidence: matches[0].confidence
          });
        }
      }
    } else {
      // If no specific fields requested, return ALL available fields for LLM to choose from
      // This is the key change - let the LLM see everything and decide
      for (const field of allFields) {
        // Use the field name as the key, but clean it up for better usability
        const cleanFieldName = field.name.toLowerCase()
          .replace(/[^a-z0-9]/g, '_')
          .replace(/_+/g, '_')
          .replace(/^_|_$/g, '');
        
        const confidence = sampleFieldsInUse.has(field.id) ? 90 : 50;
        
        fieldMappings.set(cleanFieldName, {
          id: field.id,
          name: field.name,
          type: field.schema?.type || 'string',
          confidence: confidence
        });
      }
    }

    return fieldMappings;
  }

  private static async fetchIssue(
    jiraHost: string,
    auth: string,
    issueKey: string
  ): Promise<any> {
    const url = `https://${jiraHost}/rest/api/3/issue/${issueKey}`;
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch issue: ${response.statusText}`);
    }

    return await response.json();
  }

  private static levenshteinDistance(str1: string, str2: string): number {
    const matrix: number[][] = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  }
}