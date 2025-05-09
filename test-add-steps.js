import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import fetch from 'node-fetch';

// Helper function to generate a JWT token for Zephyr API
function generateZephyrJwt(method, apiPath, expirationSec = 3600) {
    // Zephyr base URL from environment variable
    const zephyrBase = (
        process.env.ZAPI_BASE_URL || "https://prod-api.zephyr4jiracloud.com/connect"
    ).replace(/\/$/, "");

    // Build the canonical string: METHOD&<path>&
    const canonical = `${method.toUpperCase()}&${apiPath}&`;

    // Create SHA-256 hex hash of canonical string
    const qsh = crypto
        .createHash("sha256")
        .update(canonical, "utf8")
        .digest("hex");

    // Timestamps
    const now = Math.floor(Date.now() / 1000);
    const exp = now + expirationSec;

    // JWT claims
    const payload = {
        sub: process.env.ZAPI_ACCOUNT_ID, // Atlassian account ID
        iss: process.env.ZAPI_ACCESS_KEY, // Zephyr Access Key
        qsh, // query-string hash
        iat: now,
        exp,
    };

    // Sign with HMAC-SHA256 using Zephyr Secret Key
    return jwt.sign(payload, process.env.ZAPI_SECRET_KEY || "", {
        algorithm: "HS256",
    });
}

// Helper function to add a test step to a Zephyr test
async function addZephyrTestStep(issueId, step, data = "", result = "") {
    // Zephyr base URL from environment variable
    const baseUrl =
        process.env.ZAPI_BASE_URL ||
        "https://prod-api.zephyr4jiracloud.com/connect";
    const apiPath = `/rest/zapi/latest/teststep/${issueId}`;
    const fullUrl = `${baseUrl}${apiPath}`;

    console.log("Zephyr URL:", fullUrl);
    console.log(
        "Zephyr Payload:",
        JSON.stringify({ step, data, result }, null, 2)
    );

    try {
        // Generate JWT for this specific API call
        const jwtToken = generateZephyrJwt("POST", apiPath);

        const response = await fetch(fullUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                zapiAccessKey: process.env.ZAPI_ACCESS_KEY || "",
                Authorization: `JWT ${jwtToken}`,
            },
            body: JSON.stringify({ step, data, result }),
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error(
                "Error adding test step:",
                JSON.stringify(responseData, null, 2),
                "Status:",
                response.status,
                response.statusText
            );

            return {
                success: false,
                data: responseData,
                errorMessage: `Status: ${response.status} ${response.statusText}`,
            };
        }

        return { success: true, data: responseData };
    } catch (error) {
        console.error("Exception adding test step:", error);
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}

// Helper function to get the internal Jira ID from a ticket key
async function getJiraIssueId(ticketKey, auth) {
    const jiraUrl = `https://${process.env.JIRA_HOST}/rest/api/3/issue/${ticketKey}`;

    try {
        const response = await fetch(jiraUrl, {
            method: "GET",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Basic ${auth}`,
            },
        });

        const responseData = await response.json();

        if (!response.ok) {
            console.error("Error fetching ticket:", responseData);

            let errorMessage = `Status: ${response.status} ${response.statusText}`;
            if (responseData.errorMessages && responseData.errorMessages.length > 0) {
                errorMessage = responseData.errorMessages.join(", ");
            }

            return { success: false, errorMessage };
        }

        if (!responseData.id) {
            return {
                success: false,
                errorMessage: "No issue ID found in response",
            };
        }

        return { success: true, id: responseData.id };
    } catch (error) {
        console.error("Exception fetching ticket ID:", error);
        return {
            success: false,
            errorMessage: error instanceof Error ? error.message : String(error),
        };
    }
}

// Main function to add test steps to a ticket
async function addTestSteps(ticketKey, steps) {
    // Create the auth token for Jira API
    const auth = Buffer.from(
        `${process.env.JIRA_USERNAME}:${process.env.JIRA_API_TOKEN}`
    ).toString("base64");

    // Get the internal Jira ID from the ticket key
    const idResult = await getJiraIssueId(ticketKey, auth);

    if (!idResult.success || !idResult.id) {
        console.error(`Error getting internal ID for ticket ${ticketKey}: ${idResult.errorMessage}`);
        return;
    }

    const issueId = idResult.id;
    console.log(`Found internal ID for ticket ${ticketKey}: ${issueId}`);

    // Add each test step
    const results = [];
    let allSuccessful = true;

    for (const [index, { step, data = "", result = "" }] of steps.entries()) {
        console.log(`Adding test step ${index + 1}/${steps.length}: ${step}`);

        const stepResult = await addZephyrTestStep(issueId, step, data, result);

        if (stepResult.success) {
            console.log(`Step ${index + 1}: Added successfully`);
            results.push(`Step ${index + 1}: Added successfully`);
        } else {
            console.error(`Step ${index + 1}: Failed - ${stepResult.errorMessage}`);
            results.push(`Step ${index + 1}: Failed - ${stepResult.errorMessage}`);
            allSuccessful = false;
        }
    }

    // Return the results
    if (allSuccessful) {
        console.log(`Successfully added ${steps.length} test step(s) to ticket ${ticketKey}`);
    } else {
        console.error(`Some test steps could not be added to ticket ${ticketKey}`);
    }

    return results;
}

// Test data
const ticketKey = "Bob-5956";
const steps = [
    {
        step: "Navigate to https://larry.dev.bob.com/mfes/termsOfService/index.html",
        data: "",
        result: "Page loads successfully"
    },
    {
        step: "Verify that the Terms of Service overlay displays correctly",
        data: "",
        result: "ToS overlay displays with correct content"
    },
    {
        step: "Click the Accept button",
        data: "",
        result: "Button click is registered"
    },
    {
        step: "Verify that the Terms of Service are accepted and the overlay is closed",
        data: "",
        result: "ToS overlay is closed and acceptance is recorded"
    }
];

// Run the test
addTestSteps(ticketKey, steps)
    .then(results => {
        console.log("Test completed");
        if (results) {
            console.log("Results:", results);
        }
    })
    .catch(error => {
        console.error("Test failed:", error);
    });
