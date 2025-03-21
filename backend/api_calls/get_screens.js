import { getHttpRequest } from '../utils/utils.js';

export const getScreens = async (url, email, api_token, p_id) => {
    let startAt = 0;
    let isLast = false;
    let values = [];
    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/screens?scope=PROJECT`,
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
        values = values.concat(data.values.filter(screen => screen.scope ? screen.scope.project.id === p_id : false));
    }
    while (!isLast);

    console.log(values);
    return values;
}