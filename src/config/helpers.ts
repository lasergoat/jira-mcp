import { configManager } from './tools.js';
import { ConfigurationError } from './types.js';

export interface FieldResolver {
  getProjectKey(): string | undefined;
  getFieldId(fieldName: string, envVarName: string): Promise<string | null>;
  handleFieldError(error: any, fieldName: string): void;
}

export class DynamicFieldResolver implements FieldResolver {
  private projectKey: string | undefined;
  private fieldErrors: Map<string, ConfigurationError> = new Map();

  getProjectKey(): string | undefined {
    return this.projectKey;
  }

  setProjectKey(projectKey: string): void {
    this.projectKey = projectKey;
  }

  async getFieldId(fieldName: string, envVarName: string): Promise<string | null> {
    if (!this.projectKey) {
      // No project key set, fall back to env var
      return process.env[envVarName] || null;
    }

    try {
      const fieldId = await configManager.getFieldMappingWithFallback(
        this.projectKey,
        fieldName,
        envVarName
      );
      return fieldId;
    } catch (error) {
      if (error instanceof ConfigurationError) {
        // Store the error for later handling
        this.fieldErrors.set(fieldName, error);
        
        // For now, return null to continue with the request
        // The actual error will be thrown after we know what fields are needed
        return null;
      }
      throw error;
    }
  }

  hasErrors(): boolean {
    return this.fieldErrors.size > 0;
  }

  getErrors(): ConfigurationError[] {
    return Array.from(this.fieldErrors.values());
  }

  clearErrors(): void {
    this.fieldErrors.clear();
  }

  handleFieldError(error: any, fieldName: string): void {
    if (error instanceof ConfigurationError) {
      this.fieldErrors.set(fieldName, error);
    }
  }
}

// Helper to extract project key from various sources
export function extractProjectKey(
  explicitKey?: string,
  issueKey?: string,
  envKey?: string
): string | undefined {
  if (explicitKey) {
    return explicitKey;
  }
  
  if (issueKey) {
    // Extract project key from issue key (e.g., "VIP-123" -> "VIP")
    const match = issueKey.match(/^([A-Z]+)-/);
    if (match) {
      return match[1];
    }
  }
  
  return envKey || process.env.JIRA_PROJECT_KEY;
}