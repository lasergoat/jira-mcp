export interface FieldMapping {
  id: string;
  name: string;
  type: string;
  confidence?: number;
}

export interface ProjectConfig {
  projectKey: string;
  lastUpdated: string;
  fields: {
    [key: string]: FieldMapping;
  };
  fieldCache?: {
    [key: string]: any;
  };
}

export interface DynamicConfig {
  projects: {
    [projectKey: string]: ProjectConfig;
  };
}

export interface DiscoveredField {
  id: string;
  key: string;
  name: string;
  custom: boolean;
  orderable: boolean;
  navigable: boolean;
  searchable: boolean;
  clauseNames?: string[];
  schema?: {
    type: string;
    custom?: string;
    customId?: number;
  };
}

export class ConfigurationError extends Error {
  constructor(
    public type: 'FIELD_NOT_CONFIGURED' | 'PROJECT_NOT_CONFIGURED' | 'REQUIRED_FIELDS_MISSING' | 'INVALID_FIELD_VALUE',
    public details: {
      project?: string;
      field?: string;
      requiredFields?: Array<{
        id: string;
        name: string;
        type: string;
        allowedValues?: string[];
      }>;
      suggestedFields?: Array<{
        id: string;
        name: string;
        confidence: number;
      }>;
      message?: string;
    }
  ) {
    super(details.message || `Configuration error: ${type}`);
    this.name = 'ConfigurationError';
  }
}