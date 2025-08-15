import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';

export interface JiraCredentials {
  host: string;
  username: string;
  apiToken: string;
}

export class CredentialsManager {
  private credentialsPath: string;
  private cache: JiraCredentials | null = null;

  constructor() {
    this.credentialsPath = path.join(homedir(), '.jira-mcp', 'credentials.json');
  }

  async ensureDir(): Promise<void> {
    const dir = path.dirname(this.credentialsPath);
    try {
      await fs.mkdir(dir, { recursive: true });
    } catch (error) {
      console.error('Failed to create credentials directory:', error);
    }
  }

  async saveCredentials(credentials: JiraCredentials): Promise<void> {
    await this.ensureDir();
    
    // Write the file with restricted permissions
    await fs.writeFile(
      this.credentialsPath,
      JSON.stringify(credentials, null, 2)
    );
    
    // Set file permissions to 0600 (read/write for owner only)
    try {
      await fs.chmod(this.credentialsPath, 0o600);
    } catch (error) {
      // chmod might not work on Windows, that's okay
      console.debug('Could not set file permissions:', error);
    }
    
    // Clear cache to force reload
    this.cache = null;
  }

  async getCredentials(): Promise<JiraCredentials | null> {
    if (this.cache) {
      return this.cache;
    }

    try {
      const content = await fs.readFile(this.credentialsPath, 'utf-8');
      this.cache = JSON.parse(content);
      return this.cache;
    } catch (error) {
      // File doesn't exist or is invalid
      return null;
    }
  }

  async hasCredentials(): Promise<boolean> {
    const creds = await this.getCredentials();
    return creds !== null;
  }

  async clearCredentials(): Promise<void> {
    try {
      await fs.unlink(this.credentialsPath);
      this.cache = null;
    } catch (error) {
      // File might not exist
      console.debug('Could not delete credentials file:', error);
    }
  }

  // Get credentials from environment variables (fallback)
  getEnvCredentials(): JiraCredentials | null {
    const host = process.env.JIRA_HOST;
    const username = process.env.JIRA_USERNAME;
    const apiToken = process.env.JIRA_API_TOKEN;

    if (host && username && apiToken) {
      return { host, username, apiToken };
    }

    return null;
  }

  // Get credentials from any source (file first, then env)
  async getCredentialsWithFallback(): Promise<JiraCredentials | null> {
    // Try file first
    const fileCredentials = await this.getCredentials();
    if (fileCredentials) {
      return fileCredentials;
    }

    // Fall back to environment variables
    return this.getEnvCredentials();
  }
}

// Export singleton instance
export const credentialsManager = new CredentialsManager();