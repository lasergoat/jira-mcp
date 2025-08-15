import { credentialsManager, JiraCredentials } from '../config/credentials.js';

export { credentialsManager } from '../config/credentials.js';

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export class CredentialsNotConfiguredError extends AuthError {
  constructor() {
    super('Jira credentials not configured. Please run the "initialize-jira-connection" tool first with your Jira host, username, and API token.');
    this.name = 'CredentialsNotConfiguredError';
  }
}

/**
 * Get authentication string for Jira API calls
 * @throws {CredentialsNotConfiguredError} if no credentials are available
 */
export async function getAuth(): Promise<string> {
  const credentials = await credentialsManager.getCredentialsWithFallback();
  
  if (!credentials) {
    throw new CredentialsNotConfiguredError();
  }

  return Buffer.from(
    `${credentials.username}:${credentials.apiToken}`
  ).toString('base64');
}

/**
 * Get Jira host URL
 * @throws {CredentialsNotConfiguredError} if no credentials are available
 */
export async function getJiraHost(): Promise<string> {
  const credentials = await credentialsManager.getCredentialsWithFallback();
  
  if (!credentials) {
    throw new CredentialsNotConfiguredError();
  }

  // Ensure host doesn't have protocol or trailing slash
  let host = credentials.host;
  host = host.replace(/^https?:\/\//, '').replace(/\/$/, '');
  
  return host;
}

/**
 * Get full credentials object
 * @throws {CredentialsNotConfiguredError} if no credentials are available
 */
export async function getCredentials(): Promise<JiraCredentials> {
  const credentials = await credentialsManager.getCredentialsWithFallback();
  
  if (!credentials) {
    throw new CredentialsNotConfiguredError();
  }

  return credentials;
}

/**
 * Check if credentials are configured
 */
export async function hasCredentials(): Promise<boolean> {
  const credentials = await credentialsManager.getCredentialsWithFallback();
  return credentials !== null;
}

/**
 * Get the source of credentials (for informational purposes)
 */
export async function getCredentialsSource(): Promise<'file' | 'env' | 'none'> {
  const fileCredentials = await credentialsManager.getCredentials();
  if (fileCredentials) {
    return 'file';
  }

  const envCredentials = credentialsManager.getEnvCredentials();
  if (envCredentials) {
    return 'env';
  }

  return 'none';
}

/**
 * Test connection to Jira with current credentials
 */
export async function testConnection(): Promise<{ success: boolean; message: string }> {
  try {
    const host = await getJiraHost();
    const auth = await getAuth();
    
    const response = await fetch(`https://${host}/rest/api/3/myself`, {
      method: 'GET',
      headers: {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json'
      }
    });

    if (response.ok) {
      const user = await response.json();
      return {
        success: true,
        message: `Successfully connected as ${user.displayName} (${user.emailAddress})`
      };
    } else if (response.status === 401) {
      return {
        success: false,
        message: 'Authentication failed. Please check your username and API token.'
      };
    } else if (response.status === 404) {
      return {
        success: false,
        message: 'Jira host not found. Please check the host URL.'
      };
    } else {
      return {
        success: false,
        message: `Connection failed with status ${response.status}`
      };
    }
  } catch (error) {
    if (error instanceof CredentialsNotConfiguredError) {
      return {
        success: false,
        message: error.message
      };
    }
    return {
      success: false,
      message: `Connection failed: ${error instanceof Error ? error.message : String(error)}`
    };
  }
}