
import dotenv from "dotenv";
dotenv.config();

import fetch from "node-fetch";


const payload = {
    fields: {
        project: {
            key: process.env.JIRA_PROJECT_KEY || "SCRUM"
        },
        summary: "test ticket from API",
        description: "No description provided",
        issuetype: {
            name: "Task"
        }
    }
};

const jiraUrl = `https://${process.env.JIRA_HOST}.atlassian.net/rest/api/2/issue`;
const auth = Buffer.from(`${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`).toString('base64');
