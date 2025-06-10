import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { ProjectConfig, DynamicConfig, ConfigurationError } from './types.js';

export class ConfigManager {
  private configPath: string;
  private cache: DynamicConfig | null = null;

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(homedir(), '.jira-mcp', 'configs');
  }

  async ensureConfigDir(): Promise<void> {
    try {
      await fs.mkdir(this.configPath, { recursive: true });
    } catch (error) {
      console.error('Failed to create config directory:', error);
    }
  }

  async loadConfig(): Promise<DynamicConfig> {
    if (this.cache) {
      return this.cache;
    }

    await this.ensureConfigDir();
    
    const config: DynamicConfig = { projects: {} };
    
    try {
      const files = await fs.readdir(this.configPath);
      
      for (const file of files) {
        if (file.endsWith('.json')) {
          const projectKey = file.replace('.json', '');
          const filePath = path.join(this.configPath, file);
          
          try {
            const content = await fs.readFile(filePath, 'utf-8');
            config.projects[projectKey] = JSON.parse(content);
          } catch (error) {
            console.error(`Failed to load config for ${projectKey}:`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to read config directory:', error);
    }

    this.cache = config;
    return config;
  }

  async saveProjectConfig(projectKey: string, config: ProjectConfig): Promise<void> {
    await this.ensureConfigDir();
    
    const filePath = path.join(this.configPath, `${projectKey}.json`);
    config.lastUpdated = new Date().toISOString();
    
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
    
    // Update cache
    if (this.cache) {
      this.cache.projects[projectKey] = config;
    }
  }

  async getProjectConfig(projectKey: string): Promise<ProjectConfig | null> {
    const config = await this.loadConfig();
    return config.projects[projectKey] || null;
  }

  async getFieldMapping(projectKey: string, fieldName: string): Promise<string | null> {
    const projectConfig = await this.getProjectConfig(projectKey);
    
    if (!projectConfig) {
      throw new ConfigurationError('PROJECT_NOT_CONFIGURED', {
        project: projectKey,
        message: `Project ${projectKey} has not been configured yet`
      });
    }

    const field = projectConfig.fields[fieldName];
    
    if (!field) {
      throw new ConfigurationError('FIELD_NOT_CONFIGURED', {
        project: projectKey,
        field: fieldName,
        message: `Field ${fieldName} not configured for project ${projectKey}`
      });
    }

    return field.id;
  }

  async getFieldMappingWithFallback(
    projectKey: string, 
    fieldName: string, 
    envVarName: string
  ): Promise<string | null> {
    try {
      return await this.getFieldMapping(projectKey, fieldName);
    } catch (error) {
      if (error instanceof ConfigurationError) {
        // Fall back to environment variable
        return process.env[envVarName] || null;
      }
      throw error;
    }
  }

  async copyProjectConfig(sourceProject: string, targetProject: string): Promise<void> {
    const sourceConfig = await this.getProjectConfig(sourceProject);
    
    if (!sourceConfig) {
      throw new Error(`Source project ${sourceProject} not found`);
    }

    const targetConfig: ProjectConfig = {
      ...sourceConfig,
      projectKey: targetProject,
      lastUpdated: new Date().toISOString()
    };

    await this.saveProjectConfig(targetProject, targetConfig);
  }

  async listConfiguredProjects(): Promise<Array<{
    projectKey: string;
    lastUpdated: string;
    fieldCount: number;
    fields: string[];
  }>> {
    const config = await this.loadConfig();
    
    return Object.entries(config.projects).map(([key, project]) => ({
      projectKey: key,
      lastUpdated: project.lastUpdated,
      fieldCount: Object.keys(project.fields).length,
      fields: Object.keys(project.fields)
    }));
  }

  // Clear cache to force reload
  clearCache(): void {
    this.cache = null;
  }
}