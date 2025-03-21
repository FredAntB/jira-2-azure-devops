import { getHttpRequest } from '../utils/utils.js';

const retrieveStatuses = async (url, email, api_token) => {
    const response = await getHttpRequest(
        `${url}/rest/api/3/status`,
        {
            'Authorization': `Basic ${Buffer.from(
                `${email}:${api_token}`
            ).toString('base64')}`,
            'Accept': 'application/json'
        }
    );

    const data = await response.json();
    return data;
}

const retrieveWorkflows = async (url, email, api_token, p_key) => {
    let startAt = 0;
    let isLast = false;
    let values = [];

    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/workflow/search?expand=transitions,statuses,projects&startAt=${startAt}`,
            {
                'Authorization': `Basic ${Buffer.from(
                    `${email}:${api_token}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        );

        const data = await response.json();

        isLast = data.isLast;
        if (!isLast) {
            startAt += data.maxResults;
        }
        values = values.concat(data.values.filter(workflow => workflow.projects && workflow.projects.some(p => p.key === p_key)));
    }
    while (!isLast);

    // console.log(values);
    return values;
}

const cleanWorkflows = async (workflows, statuses) => {
    let clean_workflows = [];

    workflows.forEach(workflow => {
        const obj = {
            id: workflow.id.entityId,
            name: workflow.id.name,
            description: workflow.description,
            statuses: workflow.statuses.map(status => {
                const statusDetails = statuses.find(s => s.id === status.id);
                return {
                    ...status,
                    statusCategory: statusDetails ? statusDetails.statusCategory.name : null
                };
            }),
            transitions: workflow.transitions
        };

        clean_workflows.push(obj);
    });

    return clean_workflows;
}

export const getWorkflows = async (url, email, api_token, p_key) => {
    const workflows = await retrieveWorkflows(url, email, api_token, p_key);
    const statuses = await retrieveStatuses(url, email, api_token);
    return await cleanWorkflows(workflows, statuses);
}