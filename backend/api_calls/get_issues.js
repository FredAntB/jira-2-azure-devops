import { appendToLogFile, downloadFile, getHttpRequest } from '../utils/utils.js';

let custom_fields = [];

export const setCustomFields = (customFields) => {
    custom_fields = customFields;
}

const cleanIssues = async (issues, log_filepath, email, api_token) => {
    let cleanedIssues = [];
    const headers = email && api_token ? {
        'Authorization': `Basic ${Buffer.from(
            `${email}:${api_token}`
        ).toString('base64')}`,
        'Accept': 'application/json'
    } : {};

    issues.forEach(issue => {
        appendToLogFile(log_filepath, `Retrieving issue ${issue.key}...`);
        let cleanedIssue = {
            id: issue.id,
            key: issue.key,
            fields: {
                summary: issue.fields.summary,
                description: issue.fields.description,
                issuetype: {
                    id: issue.fields.issuetype.id,
                    name: issue.fields.issuetype.name
                },
                status: {
                    name: issue.fields.status.name
                },
                priority: {
                    name: issue.fields.priority.name
                },
                creator: issue.fields.creator ? {
                    displayName: issue.fields.creator.displayName,
                    emailAddress: issue.fields.creator.emailAddress ? issue.fields.creator.emailAddress : ""
                } : null,
                reporter: issue.fields.reporter ? {
                    displayName: issue.fields.reporter.displayName,
                    emailAddress: issue.fields.reporter.emailAddress ? issue.fields.reporter.emailAddress : ""
                } : null,
                assignee: issue.fields.assignee ? {
                    displayName: issue.fields.assignee ? issue.fields.assignee.displayName : "",
                    emailAddress: issue.fields.assignee ? issue.fields.assignee.emailAddress : ""
                } : null,
                created: issue.fields.created,
                updated: issue.fields.updated,
                duedate: issue.fields.duedate,
                labels: issue.fields.labels,
                components: issue.fields.components,
                fixVersions: issue.fields.fixVersions,
                attachment: issue.fields.attachment ? issue.fields.attachment.map(attachment => {
                    if (attachment.content) {
                        const extension = attachment.filename.split('.')[1];
                        downloadFile(attachment.content, `./attachments/${attachment.id}.${extension}`, headers, true, log_filepath);
                    }
                    return {
                        id: attachment.id,
                        filename: attachment.filename,
                        author: attachment.author,
                        created: attachment.created,
                        size: attachment.size,
                        mimeType: attachment.mimeType
                    }
                }) : null,
                subtasks: issue.fields.subtasks,
                issuelinks: issue.fields.issuelinks,
                comments: issue.fields.comment.comments
            }
        };

        Object.keys(issue.fields)
            .filter(key => key.startsWith('customfield_'))
            .forEach(key => {
                cleanedIssue.fields[key] = {
                    name: custom_fields.find(field => field.id === key)?.name,
                    value: issue.fields[key]
                };
            });

        cleanedIssues.push(cleanedIssue);
    });

    return cleanedIssues;
}

const getSpecificIssue = async (url, email, api_token, project_key, issue_type) => {
    let issues = [];
    let nextPageToken = null;
    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/search/jql?jql=project=${project_key} AND issuetype=${issue_type}&fields=*all,-project,-environment,-timespent,-votes,-aggregatetimespent,-aggregatetimeestimate,-aggregatetimeoriginalestimate,-timeestimate,-timeoriginalestimate,-timetracking,-security,-workratio,-resolution,-resolutiondate,-lastViewed,-watches&${nextPageToken ? "nextPageToken=" + nextPageToken : ""}`,
            {
                'Authorization': `Basic ${Buffer.from(
                    `${email}:${api_token}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            },
            {}
        );
        const data = await response.json();

        issues = issues.concat(data.issues);
        nextPageToken = data.nextPageToken || null;
    }
    while (!!nextPageToken);

    return issues;
}

export const getEpics = async (url, email, api_token, project_key, log_filepath) => {
    const epics = await getSpecificIssue(url, email, api_token, project_key, "Epic");
    return await cleanIssues(epics, log_filepath, email, api_token);
}

export const getStories = async (url, email, api_token, project_key, log_filepath) => {
    const stories = await getSpecificIssue(url, email, api_token, project_key, "Story");
    return await cleanIssues(stories, log_filepath, email, api_token);
}

export const getTasks = async (url, email, api_token, project_key, log_filepath) => {
    const tasks = await getSpecificIssue(url, email, api_token, project_key, "Task");
    return await cleanIssues(tasks, log_filepath, email, api_token);
}

export const getBugs = async (url, email, api_token, project_key, log_filepath) => {
    const bugs = await getSpecificIssue(url, email, api_token, project_key, "Bug");
    return await cleanIssues(bugs, log_filepath, email, api_token);
}

export const getSubTasks = async (url, email, api_token, project_key, log_filepath) => {
    const subtasks = await getSpecificIssue(url, email, api_token, project_key, "Sub-task");
    return await cleanIssues(subtasks, log_filepath, email, api_token);
}

const retrieveMultipleIssues = async (url, email, api_token, project_key, issue_types) => {

    let extra_query = "";
    issue_types.forEach(issue_type => {
        extra_query += `"${issue_type}", `;
    });

    if (extra_query.length > 0) {
        extra_query = "AND issuetype IN (" + extra_query.slice(0, -2) + ")";
    }

    let issues = [];
    let nextPageToken = null;

    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/search/jql?jql=project=${project_key} ${extra_query}&fields=*all,-project,-environment,-timespent,-votes,-aggregatetimespent,-aggregatetimeestimate,-aggregatetimeoriginalestimate,-timeestimate,-timeoriginalestimate,-timetracking,-security,-workratio,-resolution,-resolutiondate,-lastViewed,-watches&${nextPageToken ? "nextPageToken=" + nextPageToken : ""}`,
            {
                'Authorization': `Basic ${Buffer.from(
                    `${email}:${api_token}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        );

        const data = await response.json();

        issues = issues.concat(data.issues);
        nextPageToken = data.nextPageToken || null;
    }
    while (!!nextPageToken);

    return issues;
}

export const getMultipleIssues = async (url, email, api_token, project_key, issue_types, log_filepath) => {
    const issues = await retrieveMultipleIssues(url, email, api_token, project_key, issue_types);
    return await cleanIssues(issues, log_filepath, email, api_token);
}

const retrieveIssues = async (url, email, api_token, project_key) => {
    let nextPageToken = null;
    let issues = [];
    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/search/jql?jql=project=${project_key}&fields=*all,-project,-environment,-timespent,-votes,-aggregatetimespent,-aggregatetimeestimate,-aggregatetimeoriginalestimate,-timeestimate,-timeoriginalestimate,-timetracking,-security,-workratio,-resolution,-resolutiondate,-lastViewed,-watches&${nextPageToken ? "nextPageToken=" + nextPageToken : ""}`,
            {
                'Authorization': `Basic ${Buffer.from(
                    `${email}:${api_token}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        );

        const data = await response.json();

        issues = issues.concat(data.issues);
        nextPageToken = data.nextPageToken || null;
    }
    while (!!nextPageToken);

    return issues;
}

export const getIssues = async (url, email, api_token, project_key, log_filepath) => {
    const issues = await retrieveIssues(url, email, api_token, project_key);
    return await cleanIssues(issues, log_filepath, email, api_token);
}