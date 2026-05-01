/**
 * Tests for utils/utils.js
 *
 * Covers:
 *  - isEmptyString: null, undefined, '' → true; non-empty string → false
 *  - isEmptyString property: correctness over arbitrary strings (fast-check)
 *  - getSelectionPaths: correct paths for a mixed migrate_data object
 *  - appendToLogFile: writes expected content (with timestamp and separator)
 *    to a temp file; cleans up after the test
 *
 * Requirements: 15.3
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import * as fc from 'fast-check';
import { isEmptyString, getSelectionPaths, appendToLogFile } from '../utils/utils.js';

// ─────────────────────────────────────────────────────────────────────────────
// isEmptyString
// ─────────────────────────────────────────────────────────────────────────────
describe('isEmptyString', () => {
    test('returns true for null', () => {
        expect(isEmptyString(null)).toBe(true);
    });

    test('returns true for undefined', () => {
        expect(isEmptyString(undefined)).toBe(true);
    });

    test('returns true for an empty string', () => {
        expect(isEmptyString('')).toBe(true);
    });

    test('returns false for a non-empty string', () => {
        expect(isEmptyString('hello')).toBe(false);
    });

    test('returns false for a string containing only whitespace', () => {
        // A whitespace-only string has length > 0, so it is NOT considered empty
        expect(isEmptyString('   ')).toBe(false);
    });

    test('returns false for a single character string', () => {
        expect(isEmptyString('a')).toBe(false);
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// isEmptyString — property-based tests
// Feature: jira-azure-migration-tool, Property: isEmptyString correctness
// ─────────────────────────────────────────────────────────────────────────────
describe('isEmptyString (property-based)', () => {
    test('returns false for any non-empty string', () => {
        fc.assert(
            fc.property(fc.string({ minLength: 1 }), (s) => {
                expect(isEmptyString(s)).toBe(false);
            })
        );
    });

    test('returns true for null', () => {
        fc.assert(
            fc.property(fc.constant(null), (v) => {
                expect(isEmptyString(v)).toBe(true);
            })
        );
    });

    test('returns true for undefined', () => {
        fc.assert(
            fc.property(fc.constant(undefined), (v) => {
                expect(isEmptyString(v)).toBe(true);
            })
        );
    });

    test('returns true for empty string', () => {
        fc.assert(
            fc.property(fc.constant(''), (v) => {
                expect(isEmptyString(v)).toBe(true);
            })
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// getSelectionPaths
// ─────────────────────────────────────────────────────────────────────────────
describe('getSelectionPaths', () => {
    test('returns paths only for truthy keys', () => {
        const migrateData = { customFields: true, issues: false, workflows: true };
        const result = getSelectionPaths(migrateData, './json');

        // Only customFields and workflows are true.
        // camelCase keys are lowercased with '_' inserted before each uppercase letter:
        //   customFields → custom_fields, workflows → workflows
        expect(result).toHaveLength(2);
        expect(result).toContain('./json/custom_fields');
        expect(result).toContain('./json/workflows');
        expect(result).not.toContain('./json/issues');
    });

    test('returns an empty array when all keys are false', () => {
        const migrateData = { customFields: false, issues: false, workflows: false };
        const result = getSelectionPaths(migrateData, './json');
        expect(result).toEqual([]);
    });

    test('returns all paths when all keys are true', () => {
        const migrateData = { customFields: true, issues: true, workflows: true };
        const result = getSelectionPaths(migrateData, './json');
        expect(result).toHaveLength(3);
    });

    test('appends a file extension when file_type is provided', () => {
        const migrateData = { issues: true };
        const result = getSelectionPaths(migrateData, './json', 'json');
        // 'issues' is all lowercase so no underscore insertion — just lowercased
        expect(result).toEqual(['./json/issues.json']);
    });

    test('throws when migrate_data is not an object', () => {
        expect(() => getSelectionPaths('not-an-object', './json')).toThrow();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// appendToLogFile
// ─────────────────────────────────────────────────────────────────────────────
describe('appendToLogFile', () => {
    let tempFilePath;

    beforeEach(() => {
        // Create a unique temp file path for each test
        tempFilePath = path.join(os.tmpdir(), `utils-test-${Date.now()}-${Math.random()}.log`);
    });

    afterEach(() => {
        // Clean up the temp file after each test
        if (fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
        }
    });

    test('creates the file and writes text with a timestamp and separator', () => {
        const message = 'Migration started';
        appendToLogFile(tempFilePath, message);

        expect(fs.existsSync(tempFilePath)).toBe(true);

        const content = fs.readFileSync(tempFilePath, 'utf8');

        // The message text must appear in the file
        expect(content).toContain(message);
        // The separator (12 '=' characters) must appear
        expect(content).toContain('============');
        // A newline must follow the separator
        expect(content).toContain('============\n');
    });

    test('appends to an existing file without overwriting previous content', () => {
        appendToLogFile(tempFilePath, 'First entry');
        appendToLogFile(tempFilePath, 'Second entry');

        const content = fs.readFileSync(tempFilePath, 'utf8');
        expect(content).toContain('First entry');
        expect(content).toContain('Second entry');
    });

    test('throws when filepath is empty', () => {
        expect(() => appendToLogFile('', 'some text')).toThrow();
    });

    test('throws when text is empty', () => {
        expect(() => appendToLogFile(tempFilePath, '')).toThrow();
    });
});
