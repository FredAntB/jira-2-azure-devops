/**
 * Tests for userService.js
 *
 * Covers:
 *  - Successful user registration
 *  - Duplicate username rejection
 *  - Successful login returning { username, token }
 *  - Login with wrong password
 *
 * Requirements: 15.1
 */

import { jest } from '@jest/globals';
import fc from 'fast-check';

// ── Mock db.js pool before importing userService ──────────────────────────────
const mockQuery = jest.fn();

jest.unstable_mockModule('../db.js', () => ({
    default: { query: mockQuery },
}));

// ── Mock bcrypt so tests run fast (no real hashing) ───────────────────────────
jest.unstable_mockModule('bcrypt', () => ({
    default: {
        hash: jest.fn(async (password) => `hashed:${password}`),
        compare: jest.fn(async (plain, hashed) => hashed === `hashed:${plain}`),
    },
}));

// ── Set required env vars before the module is loaded ─────────────────────────
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';

// ── Dynamically import after mocks are registered ─────────────────────────────
const { registerUser, loginUser } = await import('../userService.js');

// ─────────────────────────────────────────────────────────────────────────────
// registerUser
// ─────────────────────────────────────────────────────────────────────────────
describe('registerUser', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test('successful registration inserts the user and returns a success message', async () => {
        // No existing user found
        mockQuery
            .mockResolvedValueOnce([[]])          // SELECT — no duplicate
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT

        const result = await registerUser('alice_01', 'Secure1!');

        expect(result).toEqual({ message: 'User registered successfully.' });

        // Verify the INSERT was called with the username and a hashed password
        const insertCall = mockQuery.mock.calls[1];
        expect(insertCall[0]).toMatch(/INSERT INTO user/i);
        expect(insertCall[1][0]).toBe('alice_01');
        expect(insertCall[1][1]).toBe('hashed:Secure1!');
    });

    test('duplicate username registration throws with a descriptive English message', async () => {
        // Simulate an existing user row
        mockQuery.mockResolvedValueOnce([[{ Username: 'alice_01' }]]);

        await expect(registerUser('alice_01', 'Secure1!')).rejects.toThrow(
            'Username already exists'
        );
    });

    test('rejects a username that is too short', async () => {
        await expect(registerUser('ab', 'Secure1!')).rejects.toThrow(
            /username must be/i
        );
        // No DB call should have been made
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects a password that is too short', async () => {
        await expect(registerUser('valid_user', 'Ab1!')).rejects.toThrow(
            /password must be/i
        );
        expect(mockQuery).not.toHaveBeenCalled();
    });

    test('rejects a password with no digit', async () => {
        await expect(registerUser('valid_user', 'NoDigit!')).rejects.toThrow(
            /password must be/i
        );
    });

    test('rejects a password with no special character', async () => {
        await expect(registerUser('valid_user', 'NoSpecial1')).rejects.toThrow(
            /password must be/i
        );
    });

    test('rejects a password with no letter', async () => {
        await expect(registerUser('valid_user', '12345678!')).rejects.toThrow(
            /password must be/i
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 16: Password Policy Enforcement
// Validates: Requirements 3.4, 15.1
// ─────────────────────────────────────────────────────────────────────────────
/**
 * **Validates: Requirements 3.4, 15.1**
 *
 * Property 16: registerUser rejects any password that violates the policy:
 *   - Minimum 8 characters
 *   - At least one digit
 *   - At least one letter
 *   - At least one special character
 */
describe('Property 16: Password Policy Enforcement', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    // Characters used to build valid-looking passwords that are missing one class
    const digits = '0123456789';
    const letters = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const specials = '!@#$%^&*(),.?":{}|<>';
    const alphanumeric = digits + letters;

    // Helper: build a string arbitrary from a character pool using fc.array + join
    // (fc.stringOf was removed in fast-check v4; this is the v4-compatible equivalent)
    const stringFromPool = (pool, minLength = 0, maxLength = 20) =>
        fc
            .array(fc.constantFrom(...pool.split('')), { minLength, maxLength })
            .map((chars) => chars.join(''));

    // Arbitrary: password that is too short (0–7 chars), drawn from any printable ASCII
    const tooShortArb = fc.string({ minLength: 0, maxLength: 7 });

    // Arbitrary: password >= 8 chars but containing NO digit
    // Built from letters + specials only, length >= 8
    const noDigitArb = stringFromPool(letters + specials, 8, 30).filter(
        (s) => !/\d/.test(s)
    );

    // Arbitrary: password >= 8 chars but containing NO letter
    // Built from digits + specials only, length >= 8
    const noLetterArb = stringFromPool(digits + specials, 8, 30).filter(
        (s) => !/[a-zA-Z]/.test(s)
    );

    // Arbitrary: password >= 8 chars but containing NO special character
    // Built from alphanumeric only, length >= 8
    const noSpecialArb = stringFromPool(alphanumeric, 8, 30).filter(
        (s) => !/[!@#$%^&*(),.?":{}|<>]/.test(s)
    );

    test('rejects passwords that are too short', async () => {
        await fc.assert(
            fc.asyncProperty(tooShortArb, async (password) => {
                await expect(registerUser('validUser', password)).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    test('rejects passwords missing a digit', async () => {
        await fc.assert(
            fc.asyncProperty(noDigitArb, async (password) => {
                await expect(registerUser('validUser', password)).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    test('rejects passwords missing a letter', async () => {
        await fc.assert(
            fc.asyncProperty(noLetterArb, async (password) => {
                await expect(registerUser('validUser', password)).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });

    test('rejects passwords missing a special character', async () => {
        await fc.assert(
            fc.asyncProperty(noSpecialArb, async (password) => {
                await expect(registerUser('validUser', password)).rejects.toThrow();
            }),
            { numRuns: 100 }
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// loginUser
// ─────────────────────────────────────────────────────────────────────────────
describe('loginUser', () => {
    beforeEach(() => {
        mockQuery.mockReset();
    });

    test('successful login returns { username, token } where token is a valid JWT string', async () => {
        mockQuery.mockResolvedValueOnce([[
            { Username: 'alice_01', password: 'hashed:Secure1!' }
        ]]);

        const result = await loginUser('alice_01', 'Secure1!');

        expect(result).toHaveProperty('username', 'alice_01');
        expect(result).toHaveProperty('token');
        // A JWT has three base64url segments separated by dots
        expect(result.token).toMatch(/^[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+$/);
    });

    test('login with wrong password throws', async () => {
        mockQuery.mockResolvedValueOnce([[
            { Username: 'alice_01', password: 'hashed:Secure1!' }
        ]]);

        await expect(loginUser('alice_01', 'WrongPass1!')).rejects.toThrow(
            'Invalid credentials.'
        );
    });

    test('login with unknown username throws', async () => {
        mockQuery.mockResolvedValueOnce([[]]); // no rows

        await expect(loginUser('ghost', 'Secure1!')).rejects.toThrow(
            'Invalid credentials.'
        );
    });

    test('login with missing password throws', async () => {
        mockQuery.mockResolvedValueOnce([[
            { Username: 'alice_01', password: 'hashed:Secure1!' }
        ]]);

        await expect(loginUser('alice_01', '')).rejects.toThrow(
            'Invalid credentials.'
        );
    });
});
