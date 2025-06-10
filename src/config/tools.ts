import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ConfigManager } from "./manager.js";
import { FieldDiscovery } from "./discovery.js";
import { ProjectConfig, FieldMapping } from "./types.js";

// Create a singleton config manager
const configManager = new ConfigManager(process.env.JIRA_DYNAMIC_CONFIG_PATH);

export function registerConfigTools(server: McpServer) {
  // Configure project fields tool
  server.tool(
    "configure-project-fields",
    "Discover and configure Jira fields for a project",
    {
      project_key: z.string().min(1, "Project key is required"),
      fields_to_discover: z.array(z.string()).optional(),
      sample_issue_key: z.string().optional(),
      user_hints: z.record(z.string()).optional(),
    },
    async ({ project_key, fields_to_discover, sample_issue_key, user_hints }) => {
      try {
        const jiraHost = process.env.JIRA_HOST;
        const auth = Buffer.from(
          `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
        ).toString("base64");

        if (!jiraHost) {
          return {
            content: [{
              type: "text" as const,
              text: "Error: JIRA_HOST not configured"
            }]
          };
        }

        // Get existing config or create new one
        let projectConfig = await configManager.getProjectConfig(project_key);
        if (!projectConfig) {
          projectConfig = {
            projectKey: project_key,
            lastUpdated: new Date().toISOString(),
            fields: {},
            fieldCache: {}
          };
        }

        // Discover fields
        const discoveredMappings = await FieldDiscovery.discoverProjectFields(
          jiraHost,
          auth,
          project_key,
          sample_issue_key,
          fields_to_discover
        );

        // Get all available fields for cache
        const allFields = await FieldDiscovery.discoverFields(jiraHost, auth);
        projectConfig.fieldCache = allFields.reduce((acc, field) => {
          acc[field.id] = field;
          return acc;
        }, {} as any);

        // Apply discovered mappings
        const results: string[] = [];
        
        if (fields_to_discover && fields_to_discover.length > 0) {
          // Configure specific fields
          for (const fieldName of fields_to_discover) {
            const mapping = discoveredMappings.get(fieldName);
            if (mapping) {
              projectConfig.fields[fieldName] = mapping;
              results.push(`✓ ${fieldName}: ${mapping.name} (${mapping.id}) - ${mapping.confidence}% confidence`);
            } else if (user_hints && user_hints[fieldName]) {
              // Use user hint
              const fieldId = user_hints[fieldName];
              const fieldInfo = allFields.find(f => f.id === fieldId);
              if (fieldInfo) {
                projectConfig.fields[fieldName] = {
                  id: fieldId,
                  name: fieldInfo.name,
                  type: fieldInfo.schema?.type || 'string'
                };
                results.push(`✓ ${fieldName}: ${fieldInfo.name} (${fieldId}) - user provided`);
              }
            } else {
              results.push(`✗ ${fieldName}: No match found`);
            }
          }
        } else {
          // Configure all discovered fields
          for (const [fieldName, mapping] of discoveredMappings) {
            projectConfig.fields[fieldName] = mapping;
            results.push(`✓ ${fieldName}: ${mapping.name} (${mapping.id}) - ${mapping.confidence}% confidence`);
          }
        }

        // Apply any additional user hints
        if (user_hints) {
          for (const [fieldName, fieldId] of Object.entries(user_hints)) {
            if (!projectConfig.fields[fieldName]) {
              const fieldInfo = allFields.find(f => f.id === fieldId);
              if (fieldInfo) {
                projectConfig.fields[fieldName] = {
                  id: fieldId,
                  name: fieldInfo.name,
                  type: fieldInfo.schema?.type || 'string'
                };
                results.push(`✓ ${fieldName}: ${fieldInfo.name} (${fieldId}) - user provided`);
              }
            }
          }
        }

        // Save configuration
        await configManager.saveProjectConfig(project_key, projectConfig);

        return {
          content: [{
            type: "text" as const,
            text: `Project ${project_key} configuration updated:\n\n${results.join('\n')}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error configuring project: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  );

  // List configured projects tool
  server.tool(
    "list-configured-projects",
    "List all projects with saved field configurations",
    {},
    async () => {
      try {
        const projects = await configManager.listConfiguredProjects();
        
        if (projects.length === 0) {
          return {
            content: [{
              type: "text" as const,
              text: "No projects have been configured yet."
            }]
          };
        }

        const projectList = projects.map(p => 
          `• ${p.projectKey} (${p.fieldCount} fields) - Updated: ${new Date(p.lastUpdated).toLocaleString()}\n  Fields: ${p.fields.join(', ')}`
        ).join('\n\n');

        return {
          content: [{
            type: "text" as const,
            text: `Configured projects:\n\n${projectList}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error listing projects: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  );

  // Get project configuration tool
  server.tool(
    "get-project-config",
    "Get the field configuration for a specific project",
    {
      project_key: z.string().min(1, "Project key is required")
    },
    async ({ project_key }) => {
      try {
        const config = await configManager.getProjectConfig(project_key);
        
        if (!config) {
          return {
            content: [{
              type: "text" as const,
              text: `Project ${project_key} has not been configured yet.`
            }]
          };
        }

        const fieldsList = Object.entries(config.fields).map(([name, field]) =>
          `• ${name}: ${field.name} (${field.id}) - Type: ${field.type}`
        ).join('\n');

        return {
          content: [{
            type: "text" as const,
            text: `Configuration for ${project_key}:\n\nLast updated: ${new Date(config.lastUpdated).toLocaleString()}\n\nFields:\n${fieldsList}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error getting project config: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  );

  // Copy project configuration tool
  server.tool(
    "copy-project-config",
    "Copy field configuration from one project to another",
    {
      source_project: z.string().min(1, "Source project key is required"),
      target_project: z.string().min(1, "Target project key is required"),
      overwrite: z.boolean().default(false)
    },
    async ({ source_project, target_project, overwrite }) => {
      try {
        // Check if target already exists
        const existingConfig = await configManager.getProjectConfig(target_project);
        if (existingConfig && !overwrite) {
          return {
            content: [{
              type: "text" as const,
              text: `Project ${target_project} already has a configuration. Use overwrite=true to replace it.`
            }]
          };
        }

        await configManager.copyProjectConfig(source_project, target_project);

        return {
          content: [{
            type: "text" as const,
            text: `Successfully copied configuration from ${source_project} to ${target_project}`
          }]
        };
      } catch (error) {
        return {
          content: [{
            type: "text" as const,
            text: `Error copying project config: ${error instanceof Error ? error.message : String(error)}`
          }]
        };
      }
    }
  );
}

// Export the config manager for use in other modules
export { configManager };