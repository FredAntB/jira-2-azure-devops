import { getHttpRequest } from '../utils/utils.js';
import cleanCustomFieldName from '../scripts/cleanCustomFieldName.js'; // Ensure this is the correct import path

const retrieveCustomFields = async (url, email, api_token) => {
    let startAt = 0;
    let isLast = false;
    let values = [];
    do {
        const response = await getHttpRequest(
            `${url}/rest/api/3/field/search?type=custom&startAt=${startAt}`,
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
        values = values.concat(data.values);
    }
    while (!isLast);

    // console.log(values);
    return values;
}

const cleanCustomFields = async (customFields) => {
    let fields = [];

    customFields.forEach(field => {
        const cleanedName = cleanCustomFieldName(field.name); // Use the corrected function
        if (!cleanedName.trim()) {
            console.error(`❌ Invalid custom field name: "${field.name}"`);
            return; // Skip invalid fields
        }

        fields.push({
            id: field.id,
            name: cleanedName,
            description: field.description,
            type: field.schema.type,
            referenceName: `Custom${field.schema.customId}.${cleanedName}`,
            usage: "workItem"
        });
    });

    return fields;
}

export const getCustomFields = async (url, email, api_token) => {
    const fields = await retrieveCustomFields(url, email, api_token);
    return await cleanCustomFields(fields);
}