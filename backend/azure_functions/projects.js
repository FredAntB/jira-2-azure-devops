import fs from 'fs/promises';
import path from 'path';
import { updateCustomFields } from '../scripts/update_custom_fields.js';

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

async function createCustomFields(token, customFieldsFile, organization) {
    const url = `https://dev.azure.com/${organization}/_apis/wit/fields?api-version=7.0`;
    const customFields = JSON.parse(await fs.readFile(customFieldsFile, 'utf-8'));

    // Validate custom field JSON
    if (!customFields.name || !customFields.type || !customFields.referenceName) {
        throw new Error(`Invalid custom field JSON in file: ${customFieldsFile}`);
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
        const errorDetails = await response.text(); // Log detailed error response
        throw new Error(`Failed to create custom fields: ${response.statusText}. Details: ${errorDetails}`);
    }

    console.log('Custom fields created successfully.');
}

async function createIssues(token, issuesFile, organization, project, workItemType) {
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$${workItemType}?api-version=7.0`;
    const issueData = JSON.parse(await fs.readFile(issuesFile, 'utf-8'));

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}`,
            'Content-Type': 'application/json-patch+json'
        },
        body: JSON.stringify([
            { op: 'add', path: '/fields/System.Title', value: issueData.fields.summary },
            { op: 'add', path: '/fields/System.Description', value: issueData.fields.description.content[0].content[0].text },
            { op: 'add', path: '/fields/System.AssignedTo', value: issueData.fields.assignee.displayName }
        ])
    });

    if (!response.ok) throw new Error(`Failed to create issue: ${response.statusText}`);
    console.log('Issue created successfully.');
}

async function createWorkflows(token, workflowsFile, organization, processId, workItemType) {
    const url = `https://dev.azure.com/${organization}/_apis/work/processes/${processId}/workItemTypes/${workItemType}/states?api-version=7.0`;
    const workflowData = JSON.parse(await fs.readFile(workflowsFile, 'utf-8'));

    for (const status of workflowData.statuses) {
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

        if (!response.ok) throw new Error(`Failed to create workflow status: ${response.statusText}`);
    }

    console.log('Workflows created successfully.');
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
    if (!process) throw new Error(`Process with name "${processName}" not found.`);
    return process.id;
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
            const processId = await getProcessId(token, organization, workflowData.name);

            // Create workflows for each workItemType
            for (const workItemType of workItemTypes) {
                console.log(`Creating workflow for processId: ${processId}, workItemType: ${workItemType}`);
                await createWorkflows(token, filePath, organization, processId, workItemType);
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
