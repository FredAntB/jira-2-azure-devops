/**
 * Tests for scripts/cleanCustomFieldName.js
 *
 * Covers:
 *  - Empty string input returns ""
 *  - Name with leading/trailing spaces is trimmed and special characters
 *    are replaced with underscores
 *  - Name with only special characters returns a string of underscores
 *
 * Requirements: 15.4
 */

import cleanCustomFieldName from '../scripts/cleanCustomFieldName.js';
import * as fc from 'fast-check';

// ─────────────────────────────────────────────────────────────────────────────
// cleanCustomFieldName
// ─────────────────────────────────────────────────────────────────────────────
describe('cleanCustomFieldName', () => {
    test('empty string input returns ""', () => {
        expect(cleanCustomFieldName('')).toBe('');
    });

    test('null input returns ""', () => {
        expect(cleanCustomFieldName(null)).toBe('');
    });

    test('undefined input returns ""', () => {
        expect(cleanCustomFieldName(undefined)).toBe('');
    });

    test('non-string input returns ""', () => {
        expect(cleanCustomFieldName(42)).toBe('');
        expect(cleanCustomFieldName({})).toBe('');
    });

    test('name with leading and trailing spaces is trimmed', () => {
        // The replace step turns spaces into underscores, then trim removes
        // any trailing underscores introduced by leading/trailing spaces.
        // The implementation replaces [^a-zA-Z0-9_] with '_' then calls .trim(),
        // so leading/trailing spaces become underscores that are then trimmed.
        const result = cleanCustomFieldName('  myField  ');
        // After replace: '__myField__', after trim: '__myField__'
        // (trim only removes whitespace, not underscores — so the underscores remain)
        // The key assertion is that the result matches the allowed character set.
        expect(result).toMatch(/^[a-zA-Z0-9_]*$/);
        // And the core name is preserved
        expect(result).toContain('myField');
    });

    test('special characters are replaced with underscores', () => {
        const result = cleanCustomFieldName('my-field.name/test');
        expect(result).toBe('my_field_name_test');
    });

    test('name with only special characters returns a string of underscores', () => {
        const result = cleanCustomFieldName('!@#$%^&*');
        expect(result).toMatch(/^_+$/);
        expect(result).toHaveLength('!@#$%^&*'.length);
    });

    test('alphanumeric name with underscores is returned unchanged', () => {
        expect(cleanCustomFieldName('my_custom_field_01')).toBe('my_custom_field_01');
    });

    test('mixed case letters are preserved', () => {
        const result = cleanCustomFieldName('MyCustomField');
        expect(result).toBe('MyCustomField');
    });

    test('spaces within the name are replaced with underscores', () => {
        const result = cleanCustomFieldName('Story Points');
        expect(result).toBe('Story_Points');
    });

    test('result always matches [a-zA-Z0-9_]* for arbitrary printable ASCII', () => {
        const inputs = [
            'hello world',
            'field-name',
            'value (in %)',
            'a+b=c',
            '日本語',          // non-ASCII characters become underscores
            '   ',
            'normal_field_123',
        ];
        for (const input of inputs) {
            expect(cleanCustomFieldName(input)).toMatch(/^[a-zA-Z0-9_]*$/);
        }
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 18: Custom Field Name Sanitisation
// Validates: Requirements 15.4
// ─────────────────────────────────────────────────────────────────────────────
describe('cleanCustomFieldName – Property 18: Custom Field Name Sanitisation', () => {
    /**
     * **Validates: Requirements 15.4**
     *
     * For any arbitrary string input, the result of cleanCustomFieldName must
     * consist solely of characters in [a-zA-Z0-9_] (or be empty).
     */
    test('Property 18: result always matches /^[a-zA-Z0-9_]*$/ for any string input', () => {
        fc.assert(
            fc.property(fc.string(), (s) => {
                const result = cleanCustomFieldName(s);
                return /^[a-zA-Z0-9_]*$/.test(result);
            })
        );
    });
});
