import fs from 'fs/promises';
import path from 'path';

async function inferFieldType(customField) {
    // Infer type based on description or value
    if (customField.value !== undefined) {
        if (typeof customField.value === 'string') return 'string';
        if (typeof customField.value === 'number') return 'integer';
        if (typeof customField.value === 'boolean') return 'boolean';
        if (customField.value === null) return 'string'; // Default for null values
        if (Array.isArray(customField.value)) return 'string'; // Default for arrays
        if (typeof customField.value === 'object') return 'string'; // Default for objects
    }

    // Fallback to description-based inference
    const description = customField.description?.toLowerCase() || '';
    if (description.includes('date')) return 'dateTime';
    if (description.includes('number') || description.includes('count')) return 'integer';
    if (description.includes('boolean') || description.includes('true/false')) return 'boolean';

    // Default to string
    return 'string';
}

export async function updateCustomFields(customFieldsDir) {
    try {
        const files = await fs.readdir(customFieldsDir);

        for (const file of files) {
            const filePath = path.join(customFieldsDir, file);
            const content = JSON.parse(await fs.readFile(filePath, 'utf-8'));

            // Infer the type
            const inferredType = await inferFieldType(content);

            // Update the type if necessary
            if (content.type !== inferredType) {
                console.log(`Updating type for ${file}: ${content.type} -> ${inferredType}`);
                content.type = inferredType;

                // Write the updated content back to the file
                await fs.writeFile(filePath, JSON.stringify(content, null, 2), 'utf-8');
            } else {
                console.log(`No changes needed for ${file}`);
            }
        }

        console.log('Custom fields updated successfully.');
    } catch (error) {
        console.error('Error updating custom fields:', error.message);
    }
}

// Example usage
// const customFieldsDir = path.join(__dirname, '../json/custom_fields');
// updateCustomFields(customFieldsDir);
