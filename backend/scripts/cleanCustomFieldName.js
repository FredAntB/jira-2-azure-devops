/**
 * Cleanses a custom field name by removing invalid characters.
 * Invalid characters: .,;~:/\*|?"&%$!+=()[]{}<>-์
 * @param {string} name - The original custom field name.
 * @returns {string} - The cleansed custom field name.
 */
export default function cleanCustomFieldName(name) {
    if (!name || typeof name !== 'string') {
        console.error(`❌ Invalid input to cleanCustomFieldName: "${name}"`);
        return '';
    }

    // Replace invalid characters with underscores and trim whitespace
    return name.replace(/[^a-zA-Z0-9_]/g, '_').trim();
}
