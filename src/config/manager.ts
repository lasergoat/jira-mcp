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

  async saveProjectConfig(projectKey: string, config: ProjectConfig, setAsDefault?: boolean): Promise<void> {
    await this.ensureConfigDir();
    
    // If this is the first project being configured, make it default
    const existingConfig = await this.loadConfig();
    const isFirstProject = Object.keys(existingConfig.projects).length === 0;
    
    // If setting as default or this is the first project, clear other defaults
    if (setAsDefault || isFirstProject) {
      // Clear existing default from other projects
      for (const [key, projectConfig] of Object.entries(existingConfig.projects)) {
        if (projectConfig.isDefault && key !== projectKey) {
          projectConfig.isDefault = false;
          await this.saveProjectConfigFile(key, projectConfig);
        }
      }
      config.isDefault = true;
    }
    
    config.lastUpdated = new Date().toISOString();
    await this.saveProjectConfigFile(projectKey, config);
    
    // Update cache
    if (this.cache) {
      this.cache.projects[projectKey] = config;
    }
  }

  private async saveProjectConfigFile(projectKey: string, config: ProjectConfig): Promise<void> {
    const filePath = path.join(this.configPath, `${projectKey}.json`);
    await fs.writeFile(filePath, JSON.stringify(config, null, 2));
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

  async getDefaultProject(): Promise<string | null> {
    const config = await this.loadConfig();
    
    for (const [projectKey, projectConfig] of Object.entries(config.projects)) {
      if (projectConfig.isDefault) {
        return projectKey;
      }
    }
    
    // If no default is set but projects exist, return the first one
    const projectKeys = Object.keys(config.projects);
    if (projectKeys.length > 0) {
      return projectKeys[0];
    }
    
    return null;
  }

  async setDefaultProject(projectKey: string): Promise<void> {
    const config = await this.loadConfig();
    
    // Check if project exists
    if (!config.projects[projectKey]) {
      throw new Error(`Project ${projectKey} not found`);
    }
    
    // Clear existing defaults
    for (const [key, projectConfig] of Object.entries(config.projects)) {
      if (projectConfig.isDefault) {
        projectConfig.isDefault = false;
        await this.saveProjectConfigFile(key, projectConfig);
      }
    }
    
    // Set new default
    const projectConfig = config.projects[projectKey];
    projectConfig.isDefault = true;
    await this.saveProjectConfigFile(projectKey, projectConfig);
    
    // Update cache
    if (this.cache) {
      this.cache.projects[projectKey] = projectConfig;
    }
  }

  async getProjectKeyWithFallback(requestedProject?: string): Promise<string> {
    // If project is explicitly provided, use it
    if (requestedProject) {
      return requestedProject;
    }
    
    // Try to get default project
    const defaultProject = await this.getDefaultProject();
    if (defaultProject) {
      return defaultProject;
    }
    
    // Fall back to environment variable
    return process.env.JIRA_PROJECT_KEY || 'UNKNOWN';
  }

  // Clear cache to force reload
  clearCache(): void {
    this.cache = null;
  }
}