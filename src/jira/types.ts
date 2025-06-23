// Type definitions for JIRA responses

export type JiraCreateResponse = {
  errorMessages?: string[];
  errors?: Record<string, string>;
  key?: string;
  id?: string;
};

export type JiraGetResponse = {
  errorMessages?: string[];
  id?: string; // Internal Jira ID
  fields?: {
    summary: string;
    description?: any;
    issuetype: {
      name: string;
    };
    status?: {
      name: string;
    };
    priority?: {
      name: string;
    };
    [key: string]: any; // Allow for custom fields
  };
  [key: string]: any;
};

export type JiraSearchResponse = {
  errorMessages?: string[];
  issues?: Array<{
    key: string;
    fields: {
      summary: string;
      description?: any;
      issuetype: {
        name: string;
      };
      status?: {
        name: string;
      };
      priority?: {
        name: string;
      };
      [key: string]: any; // Allow for custom fields
    };
  }>;
  total?: number;
  maxResults?: number;
  startAt?: number;
};

export interface JiraField {
  id: string;
  key?: string;
  name: string;
  custom?: boolean;
  orderable?: boolean;
  navigable?: boolean;
  searchable?: boolean;
  clauseNames?: string[];
  schema?: {
    type: string;
    items?: string;
    system?: string;
    custom?: string;
    customId?: number;
  };
  untranslatedName?: string;
  scope?: {
    type: string;
    project?: {
      id: string;
    };
  };
  description?: string;
  isLocked?: boolean;
  allowedValues?: Array<{
    id: string;
    value?: string;
    name?: string;
    description?: string;
  }>;
}

export interface JiraTransition {
  id: string;
  name: string;
  to: {
    self: string;
    description: string;
    iconUrl: string;
    name: string;
    id: string;
    statusCategory: {
      self: string;
      id: number;
      key: string;
      colorName: string;
      name: string;
    };
  };
  hasScreen: boolean;
  isGlobal: boolean;
  isInitial: boolean;
  isAvailable: boolean;
  isConditional: boolean;
  isLooped: boolean;
}

export interface JiraComment {
  self: string;
  id: string;
  author: {
    self: string;
    accountId: string;
    displayName: string;
    active: boolean;
  };
  body: any; // ADF format
  updateAuthor: {
    self: string;
    accountId: string;
    displayName: string;
    active: boolean;
  };
  created: string;
  updated: string;
  jsdPublic?: boolean;
}

export interface JiraAttachment {
  self: string;
  id: string;
  filename: string;
  author: {
    self: string;
    accountId: string;
    displayName: string;
    active: boolean;
  };
  created: string;
  size: number;
  mimeType: string;
  content: string;
  thumbnail?: string;
}

export interface JiraUser {
  self: string;
  accountId: string;
  accountType: string;
  emailAddress?: string;
  avatarUrls: {
    "48x48": string;
    "24x24": string;
    "16x16": string;
    "32x32": string;
  };
  displayName: string;
  active: boolean;
  timeZone?: string;
  locale?: string;
}
