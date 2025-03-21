import { getProjects } from './get_projects.js';
import { getCustomFields } from './get_fields.js';
import { getIssues, getEpics, getStories, getTasks, getBugs, getSubTasks, getMultipleIssues, setCustomFields } from './get_issues.js';
import { getScreens } from './get_screens.js';
import { getWorkflows } from './get_workflows.js';

import fs from 'fs';
import {
    assert, createDirectory
} from '../utils/utils.js';

let custom_fields_retrieved = false;

export const retrieveAndWriteProjects = async (url, email, api_token, filepath) => {
    const projects = await getProjects(url, email, api_token);

    const data = {
        projects
    }

    fs.writeFileSync(filepath, JSON.stringify(data, null, 2), 'utf8');
    return projects;
}

export const retrieveAndWriteCustomFields = async (url, email, api_token, filepath, total_filepath) => {
    const customFields = await getCustomFields(url, email, api_token);

    setCustomFields(customFields);
    custom_fields_retrieved = true;

    try {
        createDirectory(filepath);
    }
    catch (e) {
        console.error(e);
        return;
    }

    customFields.forEach(field => {
        fs.writeFileSync(`${filepath}/${field.id}.json`, JSON.stringify(field, null, 2), 'utf8');
    });

    if (fs.existsSync(total_filepath)) {
        const data = JSON.parse(fs.readFileSync(total_filepath, 'utf8'));

        data.migrated = data.migrated || 0; // Ensure migrated is initialized
        data.fields = customFields.length;
        data.total = (data.total || 0) + customFields.length; // Initialize total if missing

        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
    else {
        const data = { fields: customFields.length, total: customFields.length, migrated: 0 };

        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
}

export const retrieveAndWriteWorkflows = async (url, email, api_token, p_key, filepath, total_filepath) => {
    const workflows = await getWorkflows(url, email, api_token, p_key);

    try {
        createDirectory(filepath);
    }
    catch (e) {
        console.error(e);
        return;
    }

    workflows.forEach(workflow => {
        fs.writeFileSync(`${filepath}/${workflow.id}.json`, JSON.stringify(workflow, null, 2), 'utf8');
    });

    if (fs.existsSync(total_filepath)) {
        const data = JSON.parse(fs.readFileSync(total_filepath, 'utf8'));
        data.migrated = data.migrated || 0;
        data.workflows = workflows.length;
        data.total = (data.total || 0) + workflows.length;
        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
    else {
        fs.writeFileSync(total_filepath, JSON.stringify({ workflows: workflows.length, total: workflows.length, migrated: 0 }, null, 2), 'utf8');
    }
}

export const retrieveAndWriteScreens = async (url, email, api_token, p_id, filepath, total_filepath) => {
    const screens = await getScreens(url, email, api_token, p_id);

    try {
        createDirectory(filepath);
    }
    catch (e) {
        console.error(e);
        return;
    }

    screens.forEach(screen => {
        fs.writeFileSync(`${filepath}/${screen.id}.json`, JSON.stringify(screen, null, 2), 'utf8');
    });

    if (fs.existsSync(total_filepath)) {
        const data = JSON.parse(fs.readFileSync(total_filepath, 'utf8'));
        data.screens = screens.length;
        data.total = (data.total || 0) + screens.length;
        data.migrated = data.migrated || 0;
        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
    else {
        fs.writeFileSync(total_filepath, JSON.stringify({ screens: screens.length, total: screens.length, migrated: 0 }, null, 2), 'utf8');
    }
}

export const retrieveAndWriteIssues = async (url, email, api_token, project_key, filepath, total_filepath, log_filepath, search_type = "All", search_obj = null) => {
    assert(custom_fields_retrieved, "Custom fields must be retrieved before issues can be retrieved...");

    let issues = [];

    if (search_type === "All") {
        issues = await getIssues(url, email, api_token, project_key, log_filepath);
    }
    else if (search_type === "Multiple") {
        if (search_obj === null || search_obj.length === 0) {
            throw new Error("You need to provide a list of issues to search for...", { cause: 'invalid_search' });
        }

        issues = await getMultipleIssues(url, email, api_token, project_key, search_obj, log_filepath);
    }
    else if (search_type === "Specific") {
        switch (search_obj) {
            case "Epic":
                issues = await getEpics(url, email, api_token, project_key, log_filepath);
                break;
            case "Story":
                issues = await getStories(url, email, api_token, project_key, log_filepath);
                break;
            case "Task":
                issues = await getTasks(url, email, api_token, project_key, log_filepath);
                break;
            case "Bug":
                issues = await getBugs(url, email, api_token, project_key, log_filepath);
                break;
            case "SubTask":
                issues = await getSubTasks(url, email, api_token, project_key, log_filepath);
                break;
            default:
                throw new Error("Invalid search object...", { cause: 'invalid_search' });
        }
    }
    else {
        throw new Error("Invalid search type...\n\nValid search types are:\n\t- All\n\t- Multiple\n\t- Specific", { cause: 'invalid_search' });
    }

    try {
        createDirectory(filepath);
    }
    catch (e) {
        console.error(e);
        return;
    }

    issues.forEach(issue => {
        fs.writeFileSync(`${filepath}/${issue.id}.json`, JSON.stringify(issue, null, 2), 'utf8');
    });

    if (fs.existsSync(total_filepath)) {
        const data = JSON.parse(fs.readFileSync(total_filepath, 'utf8'));

        data.migrated = data.migrated || 0; // Ensure migrated is initialized
        data.issues = issues.length;
        data.total = (data.total || 0) + issues.length; // Initialize total if missing

        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
    else {
        const data = { issues: issues.length, total: issues.length, migrated: 0 };

        fs.writeFileSync(total_filepath, JSON.stringify(data, null, 2), 'utf8');
    }
}