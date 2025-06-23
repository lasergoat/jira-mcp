import fs from 'fs';
import path from 'path';
import os from 'os';

interface ProjectPreferences {
  importantFields: Record<string, string>; // fieldName -> fieldId mapping
  ignoredFields: string[]; // Array of field IDs to ignore
  defaultValues: Record<string, any>; // Default values for fields
  lastUpdated: string;
}

interface PreferencesStore {
  [projectKey: string]: ProjectPreferences;
}

const PREFERENCES_DIR = path.join(os.homedir(), '.jira-mcp');
const PREFERENCES_FILE = path.join(PREFERENCES_DIR, 'preferences.json');

// Default important fields that we assume users want
const DEFAULT_IMPORTANT_FIELDS = [
  'story_points', 'sprint', 'parent', 'assignee', 
  'labels', 'origination', 'description', 'due_date',
  'priority', 'components', 'environment'
];

export class PreferencesManager {
  private preferences: PreferencesStore = {};

  constructor() {
    this.loadPreferences();
  }

  private ensureDirectoryExists(): void {
    if (!fs.existsSync(PREFERENCES_DIR)) {
      fs.mkdirSync(PREFERENCES_DIR, { recursive: true });
    }
  }

  private loadPreferences(): void {
    try {
      if (fs.existsSync(PREFERENCES_FILE)) {
        const data = fs.readFileSync(PREFERENCES_FILE, 'utf8');
        this.preferences = JSON.parse(data);
      }
    } catch (error) {
      console.error('Error loading preferences:', error);
      this.preferences = {};
    }
  }

  private savePreferences(): void {
    try {
      this.ensureDirectoryExists();
      fs.writeFileSync(PREFERENCES_FILE, JSON.stringify(this.preferences, null, 2));
    } catch (error) {
      console.error('Error saving preferences:', error);
    }
  }

  getProjectPreferences(projectKey: string): ProjectPreferences {
    if (!this.preferences[projectKey]) {
      this.preferences[projectKey] = {
        importantFields: {},
        ignoredFields: [],
        defaultValues: {},
        lastUpdated: new Date().toISOString()
      };
    }
    return this.preferences[projectKey];
  }

  updateProjectPreferences(projectKey: string, updates: Partial<ProjectPreferences>): void {
    const current = this.getProjectPreferences(projectKey);
    this.preferences[projectKey] = {
      ...current,
      ...updates,
      lastUpdated: new Date().toISOString()
    };
    this.savePreferences();
  }

  addImportantField(projectKey: string, fieldName: string, fieldId: string): void {
    const prefs = this.getProjectPreferences(projectKey);
    prefs.importantFields[fieldName] = fieldId;
    prefs.lastUpdated = new Date().toISOString();
    this.savePreferences();
  }

  removeImportantField(projectKey: string, fieldName: string): void {
    const prefs = this.getProjectPreferences(projectKey);
    delete prefs.importantFields[fieldName];
    prefs.lastUpdated = new Date().toISOString();
    this.savePreferences();
  }

  addIgnoredField(projectKey: string, fieldId: string): void {
    const prefs = this.getProjectPreferences(projectKey);
    if (!prefs.ignoredFields.includes(fieldId)) {
      prefs.ignoredFields.push(fieldId);
      prefs.lastUpdated = new Date().toISOString();
      this.savePreferences();
    }
  }

  removeIgnoredField(projectKey: string, fieldId: string): void {
    const prefs = this.getProjectPreferences(projectKey);
    prefs.ignoredFields = prefs.ignoredFields.filter(id => id !== fieldId);
    prefs.lastUpdated = new Date().toISOString();
    this.savePreferences();
  }

  setDefaultValue(projectKey: string, fieldName: string, value: any): void {
    const prefs = this.getProjectPreferences(projectKey);
    prefs.defaultValues[fieldName] = value;
    prefs.lastUpdated = new Date().toISOString();
    this.savePreferences();
  }

  getDefaultImportantFields(): string[] {
    return [...DEFAULT_IMPORTANT_FIELDS];
  }

  isFieldImportant(projectKey: string, fieldName: string): boolean {
    const prefs = this.getProjectPreferences(projectKey);
    return fieldName in prefs.importantFields || DEFAULT_IMPORTANT_FIELDS.includes(fieldName);
  }

  isFieldIgnored(projectKey: string, fieldId: string): boolean {
    const prefs = this.getProjectPreferences(projectKey);
    return prefs.ignoredFields.includes(fieldId);
  }

  getFieldMapping(projectKey: string, fieldName: string): string | undefined {
    const prefs = this.getProjectPreferences(projectKey);
    return prefs.importantFields[fieldName];
  }

  getAllPreferences(): PreferencesStore {
    return { ...this.preferences };
  }

  clearProjectPreferences(projectKey: string): void {
    delete this.preferences[projectKey];
    this.savePreferences();
  }
}

// Singleton instance
export const preferencesManager = new PreferencesManager();