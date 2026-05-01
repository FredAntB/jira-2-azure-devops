import fs from 'fs/promises';
import path from 'path';
import { updateCustomFields } from '../scripts/update_custom_fields.js';
import cleanCustomFieldName from '../scripts/cleanCustomFieldName.js';
import { appendToLogFile } from '../utils/utils.js';

async function incrementFailedCount(totalJsonPath) {
    try {
        const raw = await fs.readFile(totalJsonPath, 'utf-8');
        const data = JSON.parse(raw);
        data.failed = (data.failed || 0) + 1;
        await fs.writeFile(totalJsonPath, JSON.stringify(data, null, 2), 'utf-8');
    } catch (err) {
        console.error(`Failed to update failed count in total.json: ${err.message}`);
    }
}

async function getMemberId(token) {
    const url = 'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.1';
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.id;
}

async function getOrganizations(memberId, token) {
    const url = `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${memberId}&api-version=6.0`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.value.map(org => org.accountName);
}

async function getProjects(organization, token) {
    const url = `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.value.map(proj => ({ organization: organization, project: proj.name }));
}

/**
 * Fetch all projects for a given organization directly (no member/org discovery).
 * Used when the PAT is scoped to a single organization.
 */
export async function fetchProjectsForOrg(token, organization) {
    try {
        const projects = await getProjects(organization, token);
        console.log(`[Azure] Direct fetch for "${organization}": ${projects.length} project(s)`);
        return projects;
    } catch (error) {
        console.error(`[Azure] fetchProjectsForOrg failed for "${organization}":`, error.message);
        return [];
    }
}

export async function fetchAllProjects(token, organization) {
    // If an organization is provided, skip the member/org discovery and query directly.
    // This is necessary for PATs scoped to a single organization.
    if (organization) {
        return fetchProjectsForOrg(token, organization);
    }

    try {
        const memberId = await getMemberId(token);
        console.log(`[Azure] Resolved memberId: ${memberId}`);

        const organizations = await getOrganizations(memberId, token);
        console.log(`[Azure] Found organizations: ${JSON.stringify(organizations)}`);

        let allProjects = [];
        for (const org of organizations) {
            const projects = await getProjects(org, token);
            console.log(`[Azure] Projects in "${org}": ${projects.length}`);
            allProjects = allProjects.concat(projects);
        }

        return allProjects;
    } catch (error) {
        console.error('[Azure] fetchAllProjects failed:', error.message);
        return [];
    }
}

async function fieldExists(token, organization, referenceName, fieldName) {
    // Check if the field exists by referenceName
    const referenceUrl = `https://dev.azure.com/${organization}/_apis/wit/fields/${referenceName}?api-version=7.0`;
    const referenceResponse = await fetch(referenceUrl, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`
        }
    });

    if (referenceResponse.ok) return true;

    // If not found by referenceName, check all fields for a matching name
    const allFieldsUrl = `https://dev.azure.com/${organization}/_apis/wit/fields?api-version=7.0`;
    const allFieldsResponse = await fetch(allFieldsUrl, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`
        }
    });

    if (!allFieldsResponse.ok) {
        throw new Error(`Failed to fetch fields: ${allFieldsResponse.statusText}`);
    }

    const allFieldsData = await allFieldsResponse.json();
    return allFieldsData.value.some(field => field.name === fieldName);
}

async function createCustomFields(token, customFieldsFile, organization, logfilepath) {
    const url = `https://dev.azure.com/${organization}/_apis/wit/fields?api-version=7.0`;
    let customFields;

    try {
        customFields = JSON.parse(await fs.readFile(customFieldsFile, 'utf-8'));
    } catch (error) {
        throw new Error(`Failed to parse JSON in file: ${customFieldsFile}. Error: ${error.message}`);
    }

    // Validate required fields
    if (!customFields.name || !customFields.type || !customFields.referenceName) {
        throw new Error(
            `Invalid custom field JSON in file: ${customFieldsFile}. Missing required fields: 'name', 'type', or 'referenceName'.`
        );
    }

    // Cleanse the custom field name
    customFields.name = cleanCustomFieldName(customFields.name);

    // Check if the field already exists by referenceName or name
    const exists = await fieldExists(token, organization, customFields.referenceName, customFields.name);
    if (exists) {
        await appendToLogFile(logfilepath, `Custom field '${customFields.name}' already exists. Skipping creation.`);
        return;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(customFields)
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        if (errorDetails.includes(`Field name '${customFields.name}' you specified is already in use`)) {
            await appendToLogFile(logfilepath, `Custom field '${customFields.name}' already exists (detected by error message). Skipping creation.`);
            return;
        }
        throw new Error(`Failed to create custom fields: ${response.statusText}. Details: ${errorDetails}`);
    }

    await appendToLogFile(logfilepath, `Custom field '${customFields.name}' created successfully.`);
}

// Fix for missing assignee field in createIssues
async function validateAssignee(token, organization, assignee) {
    if (!assignee) return null;

    const url = `https://vssps.dev.azure.com/${organization}/_apis/graph/users?api-version=7.1-preview.1`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        console.error(`Failed to validate assignee: ${response.statusText}`);
        return null;
    }

    const data = await response.json();
    const user = data.value.find(user => user.displayName === assignee);
    return user ? assignee : null; // Return the assignee if found, otherwise null
}

/**
 * Fetch the work item types available in the target Azure DevOps project.
 * Returns a Set of type names (lowercased) for case-insensitive matching.
 */
async function getProjectWorkItemTypes(token, organization, project) {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitemtypes?api-version=7.0`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) {
        console.error(`[Azure] Failed to fetch work item types: ${response.statusText}`);
        return new Set();
    }
    const data = await response.json();
    return new Set(data.value.map(t => t.name.toLowerCase()));
}

/**
 * Map a Jira issue type to the best available Azure DevOps work item type.
 * Falls back through a priority list until a match is found in the project's types.
 * If nothing matches, defaults to 'Task' (present in all process templates).
 */
function resolveWorkItemType(jiraType, availableTypes) {
    // Canonical mapping: Jira type → preferred Azure type → fallback chain
    const mappings = {
        'story':   ['User Story', 'Issue', 'Task'],
        'epic':    ['Epic', 'Issue', 'Task'],
        'task':    ['Task', 'Issue'],
        'bug':     ['Bug', 'Issue', 'Task'],
        'subtask': ['Task', 'Issue'],
        'sub-task':['Task', 'Issue'],
        'feature': ['Feature', 'Epic', 'Issue', 'Task'],
    };

    const key = jiraType.toLowerCase();
    const candidates = mappings[key] || [jiraType, 'Task'];

    for (const candidate of candidates) {
        if (availableTypes.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
    return 'Task'; // universal fallback
}

async function createIssues(token, issuesFile, organization, project, workItemType, logfilepath, availableWorkItemTypes) {
    // Resolve to the best available work item type for this project's process template
    const resolvedType = availableWorkItemTypes
        ? resolveWorkItemType(workItemType, availableWorkItemTypes)
        : (workItemType === 'Story' ? 'User Story' : workItemType);

    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$${encodeURIComponent(resolvedType)}?api-version=7.0`;
    const issueData = JSON.parse(await fs.readFile(issuesFile, 'utf-8'));

    const assignee = issueData.fields.assignee ? issueData.fields.assignee.displayName : null;
    const validatedAssignee = await validateAssignee(token, organization, assignee);

    const payload = [
        { op: 'add', path: '/fields/System.Title', value: issueData.fields.summary },
        {
            op: 'add',
            path: '/fields/System.Description',
            value: issueData.fields.description?.content?.[0]?.content?.[0]?.text || ''
        }
    ];

    if (validatedAssignee) {
        payload.push({ op: 'add', path: '/fields/System.AssignedTo', value: validatedAssignee });
    }

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
                'Content-Type': 'application/json-patch+json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorDetails = await response.text();
            throw new Error(`Failed to create issue: ${response.statusText}. Details: ${errorDetails}`);
        }

        await appendToLogFile(logfilepath, `Issue created successfully. Issue key: ${issueData.key} (type: ${resolvedType})`);
    } catch (error) {
        await appendToLogFile(logfilepath, `Error creating issue for workItemType: ${resolvedType}. ${error.message}`);
        throw error; // Re-throw so the caller can increment the failed counter
    }
}

async function validateWorkItemType(token, organization, processId, workItemType) {
    const url = `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        console.error(`Failed to fetch work item types: ${response.statusText}. Details: ${errorDetails}`);
        return false;
    }

    const data = await response.json();
    const isValid = data.value.some(type => type.name === workItemType);
    if (!isValid) {
        console.error(`WorkItemType "${workItemType}" is not valid for processId: ${processId}`);
    }
    return isValid;
}

async function createWorkflows(token, workflowsFile, organization, processId, workItemType, logfilepath) {
    if (!processId) {
        await appendToLogFile(logfilepath, `Error: processId is undefined for workItemType: ${workItemType}. Skipping workflow creation.`);
        return;
    }

    // Change "Story" to "User Story" for the workflow creation process
    if (workItemType === "Story") {
        workItemType = "User Story";
    }

    // Validate the workItemType before proceeding
    const isValidWorkItemType = await validateWorkItemType(token, organization, processId, workItemType);
    if (!isValidWorkItemType) {
        await appendToLogFile(logfilepath, `Skipping workflow creation for invalid workItemType: ${workItemType}`);
        return;
    }

    const url = `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes/${workItemType}/states?api-version=7.0`;
    const workflowData = JSON.parse(await fs.readFile(workflowsFile, 'utf-8'));

    for (const status of workflowData.statuses) {
        try {
            await appendToLogFile(logfilepath, `Creating workflow status: ${status.name} for processId: ${processId}, workItemType: ${workItemType}`);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: status.name,
                    stateCategory: status.statusCategory
                })
            });

            if (!response.ok) {
                const errorDetails = await response.text();
                await appendToLogFile(logfilepath, `Failed to create workflow status: ${response.statusText}. Details: ${errorDetails}`);
                throw new Error(`Failed to create workflow status: ${status.name}`);
            }

            await appendToLogFile(logfilepath, `Workflow status "${status.name}" created successfully.`);
        } catch (error) {
            await appendToLogFile(logfilepath, `Error creating workflow status "${status.name}": ${error.message}`);
        }
    }
}

async function getProcessId(token, organization, processName) {
    const url = `https://dev.azure.com/${organization}/_apis/work/processes?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`
        }
    });

    if (!response.ok) throw new Error(`Failed to fetch processes: ${response.statusText}`);
    const data = await response.json();

    const process = data.value.find(proc => proc.name === processName);
    if (!process) {
        console.error(`Process with name "${processName}" not found.`);
        throw new Error(`Process with name "${processName}" not found.`);
    }
    return process.id;
}

async function getParentProcessId(token, organization, parentProcessName = "Agile") {
    const url = `https://dev.azure.com/${organization}/_apis/work/processes?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`
        }
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(`Failed to fetch parent processes: ${response.statusText}. Details: ${errorDetails}`);
    }

    const data = await response.json();
    const parentProcess = data.value.find(proc => proc.name === parentProcessName);
    if (!parentProcess) {
        throw new Error(`Parent process "${parentProcessName}" not found.`);
    }

    return parentProcess.typeId; // Return the parent process type ID
}

async function createProcess(token, organization, processName, parentProcessName = "Agile") {
    const parentProcessTypeId = await getParentProcessId(token, organization, parentProcessName);

    const url = `https://dev.azure.com/${organization}/_apis/work/processes?api-version=7.0`;
    const payload = {
        name: processName,
        description: `Process created for workflow: ${processName}`,
        type: "custom",
        parentProcessTypeId // Include the parent process type ID
    };

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        throw new Error(`Failed to create process: ${response.statusText}. Details: ${errorDetails}`);
    }

    const data = await response.json();
    console.log(`Process "${processName}" created successfully.`);
    return data.id; // Return the newly created process ID
}

// Fix for processId retrieval
async function getOrCreateProcessId(token, organization, processName) {
    try {
        // Try to get the process ID
        const processId = await getProcessId(token, organization, processName);
        console.log(`Retrieved processId: ${processId} for processName: ${processName}`);
        return processId;
    } catch (error) {
        if (error.message.includes('not found')) {
            console.log(`Process "${processName}" not found. Creating a new process...`);
            try {
                const newProcessId = await createProcess(token, organization, processName);
                console.log(`Created new processId: ${newProcessId} for processName: ${processName}`);
                return newProcessId;
            } catch (createError) {
                console.error(`Failed to create process "${processName}":`, createError.message);
                return null; // Return null if process creation fails
            }
        }
        throw error; // Re-throw other errors
    }
}

async function getWorkItemTypes(token, organization, processId) {
    if (!processId) {
        console.error("Error: processId is undefined. Cannot fetch work item types.");
        return [];
    }

    const url = `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes?api-version=7.0`;
    const response = await fetch(url, {
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json'
        }
    });

    if (!response.ok) {
        const errorDetails = await response.text();
        console.error(`Failed to fetch work item types: ${response.statusText}. Details: ${errorDetails}`);
        return [];
    }

    const data = await response.json();
    console.log("Available Work Item Types:", data.value.map(type => type.name));
    return data.value.map(type => type.name); // Return the list of work item type names
}

// Example usage
async function logAvailableWorkItemTypes(token, organization, processName) {
    try {
        const processId = await getProcessId(token, organization, processName);
        const workItemTypes = await getWorkItemTypes(token, organization, processId);
        console.log(`Work Item Types for process "${processName}":`, workItemTypes);
    } catch (error) {
        console.error("Error fetching work item types:", error.message);
    }
}

export async function migrateData(token, customFieldsDir, workflowsDir, issuesDir, organization, project, logfilepath, totalJsonPath = './json/total.json') {
    try {
        // Update custom fields before migration
        await appendToLogFile(logfilepath, 'Validating and updating custom fields...');
        await updateCustomFields(customFieldsDir);

        const customFieldFiles = await fs.readdir(customFieldsDir);
        for (const file of customFieldFiles) {
            const filePath = path.join(customFieldsDir, file);
            try {
                await createCustomFields(token, filePath, organization, logfilepath);
            } catch (error) {
                await appendToLogFile(logfilepath, `FAILED: custom field "${file}" - ${error.message}`);
                await incrementFailedCount(totalJsonPath);
                // Continue to the next custom field — do not abort the loop
            }
        }

        // Retrieve all workItemTypes from issue JSON files
        const issueFiles = await fs.readdir(issuesDir);
        const workItemTypes = new Set();
        for (const file of issueFiles) {
            const filePath = path.join(issuesDir, file);
            try {
                const issueData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                workItemTypes.add(issueData.fields.issuetype.name); // Collect unique workItemTypes
            } catch (error) {
                await appendToLogFile(logfilepath, `FAILED: reading issue file "${file}" for work item type collection - ${error.message}`);
                // Continue collecting types from remaining files
            }
        }

        // Use workItemTypes for workflows creation
        const workflowFiles = await fs.readdir(workflowsDir);
        for (const file of workflowFiles) {
            const filePath = path.join(workflowsDir, file);
            try {
                const workflowData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                try {
                    const processId = await getOrCreateProcessId(token, organization, workflowData.name);
                    for (const workItemType of workItemTypes) {
                        await appendToLogFile(logfilepath, `Creating workflow for processId: ${processId}, workItemType: ${workItemType}`);
                        try {
                            await createWorkflows(token, filePath, organization, processId, workItemType, logfilepath);
                        } catch (error) {
                            await appendToLogFile(logfilepath, `FAILED: workflow "${workflowData.name}" for workItemType "${workItemType}" - ${error.message}`);
                            await incrementFailedCount(totalJsonPath);
                            // Continue to the next workItemType — do not abort the loop
                        }
                    }
                } catch (error) {
                    await appendToLogFile(logfilepath, `FAILED: processing workflow "${workflowData.name}" - ${error.message}`);
                    await incrementFailedCount(totalJsonPath);
                    // Continue to the next workflow file — do not abort the loop
                }
            } catch (error) {
                await appendToLogFile(logfilepath, `FAILED: reading workflow file "${file}" - ${error.message}`);
                await incrementFailedCount(totalJsonPath);
                // Continue to the next workflow file — do not abort the loop
            }
        }

        // Fetch the project's available work item types once, used for all issue creation
        const availableWorkItemTypes = await getProjectWorkItemTypes(token, organization, project);
        console.log(`[Azure] Available work item types: ${[...availableWorkItemTypes].join(', ')}`);

        // Create issues
        for (const file of issueFiles) {
            const filePath = path.join(issuesDir, file);
            try {
                const issueData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
                const workItemType = issueData.fields.issuetype.name; // Extract work item type from issue JSON
                await createIssues(token, filePath, organization, project, workItemType, logfilepath, availableWorkItemTypes);
            } catch (error) {
                await appendToLogFile(logfilepath, `FAILED: issue "${file}" - ${error.message}`);
                await incrementFailedCount(totalJsonPath);
                // Continue to the next issue — do not abort the loop
            }
        }

        await appendToLogFile(logfilepath, 'Data migration completed successfully.');
    } catch (error) {
        await appendToLogFile(logfilepath, `Error during migration: ${error.message}`);
    }
}
