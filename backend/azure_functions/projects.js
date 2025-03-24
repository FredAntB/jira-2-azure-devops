import fs from 'fs/promises';
import path from 'path';
import { updateCustomFields } from '../scripts/update_custom_fields.js';
import cleanCustomFieldName from '../scripts/cleanCustomFieldName.js';

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

export async function fetchAllProjects(token) {
    try {
        const memberId = await getMemberId(token);
        const organizations = await getOrganizations(memberId, token);

        let allProjects = [];
        for (const org of organizations) {
            const projects = await getProjects(org, token);
            allProjects = allProjects.concat(projects);
        }

        return allProjects;
    } catch (error) {
        console.error('Error:', error.message);
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

async function createCustomFields(token, customFieldsFile, organization) {
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
        console.log(`Custom field '${customFields.name}' already exists. Skipping creation.`);
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
            console.log(`Custom field '${customFields.name}' already exists (detected by error message). Skipping creation.`);
            return;
        }
        throw new Error(`Failed to create custom fields: ${response.statusText}. Details: ${errorDetails}`);
    }

    console.log(`Custom field '${customFields.name}' created successfully.`);
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

async function createIssues(token, issuesFile, organization, project, workItemType) {
    // Change "Story" to "User Story" for the creation process
    if (workItemType === "Story") {
        workItemType = "User Story";
    }

    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$${workItemType}?api-version=7.0`;
    const issueData = JSON.parse(await fs.readFile(issuesFile, 'utf-8'));

    const assignee = issueData.fields.assignee ? issueData.fields.assignee.displayName : null;
    const validatedAssignee = await validateAssignee(token, organization, assignee);

    const payload = [
        { op: 'add', path: '/fields/System.Title', value: issueData.fields.summary },
        { op: 'add', path: '/fields/System.Description', value: issueData.fields.description.content[0]?.content[0]?.text || '' }
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

        console.log('Issue created successfully.');
    } catch (error) {
        console.error(`Error creating issue for workItemType: ${workItemType}`, error.message);
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

async function createWorkflows(token, workflowsFile, organization, processId, workItemType) {
    if (!processId) {
        console.error(`Error: processId is undefined for workItemType: ${workItemType}. Skipping workflow creation.`);
        return;
    }

    // Change "Story" to "User Story" for the workflow creation process
    if (workItemType === "Story") {
        workItemType = "User Story";
    }

    // Validate the workItemType before proceeding
    const isValidWorkItemType = await validateWorkItemType(token, organization, processId, workItemType);
    if (!isValidWorkItemType) {
        console.error(`Skipping workflow creation for invalid workItemType: ${workItemType}`);
        return;
    }

    const url = `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes/${workItemType}/states?api-version=7.0`;
    const workflowData = JSON.parse(await fs.readFile(workflowsFile, 'utf-8'));

    for (const status of workflowData.statuses) {
        try {
            console.log(`Creating workflow status: ${status.name} for processId: ${processId}, workItemType: ${workItemType}`);
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
                console.error(`Failed to create workflow status: ${response.statusText}. Details: ${errorDetails}`);
                throw new Error(`Failed to create workflow status: ${status.name}`);
            }

            console.log(`Workflow status "${status.name}" created successfully.`);
        } catch (error) {
            console.error(`Error creating workflow status "${status.name}":`, error.message);
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

export async function migrateData(token, customFieldsDir, workflowsDir, issuesDir, organization, project) {
    try {
        // Update custom fields before migration
        console.log('Validating and updating custom fields...');
        await updateCustomFields(customFieldsDir);

        const customFieldFiles = await fs.readdir(customFieldsDir);
        for (const file of customFieldFiles) {
            const filePath = path.join(customFieldsDir, file);
            await createCustomFields(token, filePath, organization);
        }

        // Retrieve all workItemTypes from issue JSON files
        const issueFiles = await fs.readdir(issuesDir);
        const workItemTypes = new Set();
        for (const file of issueFiles) {
            const filePath = path.join(issuesDir, file);
            const issueData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            workItemTypes.add(issueData.fields.issuetype.name); // Collect unique workItemTypes
        }

        // Use workItemTypes for workflows creation
        const workflowFiles = await fs.readdir(workflowsDir);
        for (const file of workflowFiles) {
            const filePath = path.join(workflowsDir, file);
            const workflowData = JSON.parse(await fs.readFile(filePath, 'utf-8'));

            try {
                const processId = await getOrCreateProcessId(token, organization, workflowData.name);
                for (const workItemType of workItemTypes) {
                    console.log(`Creating workflow for processId: ${processId}, workItemType: ${workItemType}`);
                    await createWorkflows(token, filePath, organization, processId, workItemType);
                }
            } catch (error) {
                console.error(`Error processing workflow "${workflowData.name}":`, error.message);
            }
        }

        // Create issues
        for (const file of issueFiles) {
            const filePath = path.join(issuesDir, file);
            const issueData = JSON.parse(await fs.readFile(filePath, 'utf-8'));
            const workItemType = issueData.fields.issuetype.name; // Extract work item type from issue JSON
            await createIssues(token, filePath, organization, project, workItemType);
        }

        console.log('Data migration completed successfully.');
    } catch (error) {
        console.error('Error during migration:', error.message);
    }
}
