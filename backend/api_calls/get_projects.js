import { getHttpRequest } from '../utils/utils.js';

export const getProjects = async (url, email, api_token) => {
    let startAt = 0;
    let isLast = false;
    let values = [];
    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/project/search`,
            {
                'Authorization': `Basic ${Buffer.from(
                    `${email}:${api_token}`
                ).toString('base64')}`,
                'Accept': 'application/json'
            }
        );

        if (response.headers.get('x-seraph-loginreason') === 'AUTHENTICATED_FAILED') {
            throw new Error("Your token is invalid, try again...", { cause: 'invalid_token' });
        }

        const data = await response.json();

        if (data.total === 0) {
            console.log("There are no projects...");
            return;
        }

        isLast = data.isLast;
        if (!isLast) {
            startAt += data.maxResults;
        }

        const new_values = data.values.map(project => {
            return {
                name: project.name,
                id: project.id,
                key: project.key
            };
        });

        values = values.concat(new_values);
    }
    while (!isLast);

    return values;
}
