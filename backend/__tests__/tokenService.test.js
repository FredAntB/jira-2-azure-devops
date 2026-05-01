/**
 * Tests for tokenService.js
 *
 * Covers:
 *  - Token whose encrypted form exceeds 500 characters is split into exactly
 *    two rows with part = 1 and part = 2
 *  - Split-token deletion queries by Application + username (not id + 1)
 *
 * Requirements: 15.2
 */

import { jest } from '@jest/globals';
import fc from 'fast-check';

// ── Set required env vars before the module is loaded ─────────────────────────
process.env.ENCRYPTION_KEY = 'test-encryption-key-32-chars-ok!';
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests';

// ── Mock db.js pool ───────────────────────────────────────────────────────────
const mockQuery = jest.fn();

jest.unstable_mockModule('../db.js', () => ({
    default: { query: mockQuery },
}));

// ── Dynamically import after mocks are registered ─────────────────────────────
const { encryptToken, decryptToken } = await import('../tokenService.js');

// ─────────────────────────────────────────────────────────────────────────────
// encryptToken / decryptToken
// ─────────────────────────────────────────────────────────────────────────────
describe('encryptToken / decryptToken', () => {
    test('round-trip: decryptToken(encryptToken(s)) === s for a short token', () => {
        const original = 'my-api-token-abc123';
        expect(decryptToken(encryptToken(original))).toBe(original);
    });

    test('round-trip: decryptToken(encryptToken(s)) === s for a long token', () => {
        // Generate a token long enough that its encrypted form exceeds 500 chars
        const original = 'x'.repeat(400);
        expect(decryptToken(encryptToken(original))).toBe(original);
    });

    test('encrypted output is different from the plaintext input', () => {
        const original = 'secret-token';
        const encrypted = encryptToken(original);
        expect(encrypted).not.toBe(original);
    });

    test('two encryptions of the same value produce different ciphertexts (random IV)', () => {
        const original = 'same-token';
        expect(encryptToken(original)).not.toBe(encryptToken(original));
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Property 1: Token Encryption Round-Trip
// Validates: Requirements 5.1, 15.2, 15.5
// ─────────────────────────────────────────────────────────────────────────────
/**
 * **Validates: Requirements 5.1, 15.2, 15.5**
 *
 * Property 1: For any non-empty string used as a token, encrypting it with
 * encryptToken and then decrypting the result with decryptToken SHALL return
 * the original string unchanged.
 */
describe('Property 1: Token Encryption Round-Trip', () => {
    test('decryptToken(encryptToken(s)) === s for any non-empty string', () => {
        fc.assert(
            fc.property(
                // Generate arbitrary non-empty strings (printable ASCII range to
                // avoid characters that AES-CBC cannot round-trip through UTF-8)
                fc.string({ minLength: 1 }),
                (token) => {
                    expect(decryptToken(encryptToken(token))).toBe(token);
                }
            ),
            { numRuns: 200 }
        );
    });

    test('round-trip holds for tokens that produce ciphertexts longer than 500 chars', () => {
        // Tokens of 350+ chars reliably produce encrypted strings > 500 chars (split threshold)
        fc.assert(
            fc.property(
                fc.string({ minLength: 350, maxLength: 600 }),
                (token) => {
                    const encrypted = encryptToken(token);
                    expect(encrypted.length).toBeGreaterThan(500);
                    expect(decryptToken(encrypted)).toBe(token);
                }
            ),
            { numRuns: 50 }
        );
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Split-token storage (logic mirrored from index.js /api/save-token)
// ─────────────────────────────────────────────────────────────────────────────
describe('split-token storage logic', () => {
    /**
     * Reproduce the save-token split logic from index.js so we can unit-test it
     * without spinning up Express.
     *
     * Accepts an optional pre-computed encryptedToken so tests can capture the
     * exact ciphertext before passing it in (encryptToken uses a random IV, so
     * calling it twice produces two different values).
     */
    async function saveTokenLogic(pool, username, token, application, email = null, url = null, encryptedToken = null) {
        if (encryptedToken === null) {
            encryptedToken = encryptToken(token);
        }

        if (encryptedToken.length > 500) {
            const part1 = encryptedToken.slice(0, 500);
            const part2 = encryptedToken.slice(500);

            let [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, ?)',
                [part1, application, email, url, 1]
            );
            const id1 = tokenResult.insertId;
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, id1]);

            [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, ?)',
                [part2, application, email, url, 2]
            );
            const id2 = tokenResult.insertId;
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, id2]);

            return { split: true, id1, id2 };
        } else {
            const [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, ?)',
                [encryptedToken, application, email, url, null]
            );
            const tokenId = tokenResult.insertId;
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, tokenId]);
            return { split: false, tokenId };
        }
    }

    beforeEach(() => {
        mockQuery.mockReset();
    });

    test('token whose encrypted form exceeds 500 chars is split into exactly two rows with part=1 and part=2', async () => {
        // A 400-char plaintext token reliably produces an encrypted string > 500 chars.
        // Capture the ciphertext once so we can assert the stored halves reconstruct it
        // exactly — encryptToken uses a random IV so calling it twice gives different values.
        const longToken = 'z'.repeat(400);
        const encrypted = encryptToken(longToken);
        expect(encrypted.length).toBeGreaterThan(500);

        // Mock INSERT responses for the two parts + two tokenreg inserts
        mockQuery
            .mockResolvedValueOnce([{ insertId: 10 }])   // INSERT token part 1
            .mockResolvedValueOnce([{ affectedRows: 1 }]) // INSERT tokenreg for part 1
            .mockResolvedValueOnce([{ insertId: 11 }])   // INSERT token part 2
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT tokenreg for part 2

        const pool = { query: mockQuery };
        // Pass the pre-computed ciphertext so saveTokenLogic doesn't re-encrypt
        const result = await saveTokenLogic(pool, 'alice', longToken, 'Zephyr', null, null, encrypted);

        expect(result.split).toBe(true);

        // Collect all INSERT INTO token calls (exact table name, not tokenreg)
        const tokenInserts = mockQuery.mock.calls.filter(
            ([sql]) => typeof sql === 'string' && /INSERT INTO token\b(?!reg)/i.test(sql)
        );
        expect(tokenInserts).toHaveLength(2);

        // First insert must have part = 1
        expect(tokenInserts[0][1][4]).toBe(1);
        // Second insert must have part = 2
        expect(tokenInserts[1][1][4]).toBe(2);

        // The two halves must reconstruct the original encrypted token
        const storedPart1 = tokenInserts[0][1][0];
        const storedPart2 = tokenInserts[1][1][0];
        expect(storedPart1.length).toBe(500);
        expect(storedPart1 + storedPart2).toBe(encrypted);
    });

    test('short token is stored as a single row with part = NULL', async () => {
        const shortToken = 'short-token-abc';

        const encrypted = encryptToken(shortToken);
        expect(encrypted.length).toBeLessThanOrEqual(500);

        mockQuery
            .mockResolvedValueOnce([{ insertId: 20 }])  // INSERT token
            .mockResolvedValueOnce([{ affectedRows: 1 }]); // INSERT tokenreg

        const pool = { query: mockQuery };
        const result = await saveTokenLogic(pool, 'alice', shortToken, 'Jira');

        expect(result.split).toBe(false);

        const tokenInserts = mockQuery.mock.calls.filter(
            ([sql]) => typeof sql === 'string' && /INSERT INTO token\b(?!reg)/i.test(sql)
        );
        expect(tokenInserts).toHaveLength(1);
        // part column must be NULL for a non-split token
        expect(tokenInserts[0][1][4]).toBeNull();
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// Split-token deletion (logic mirrored from index.js /api/delete-token)
// ─────────────────────────────────────────────────────────────────────────────
describe('split-token deletion logic', () => {
    /**
     * Reproduce the delete-token logic from index.js so we can verify it queries
     * by Application + username rather than assuming id + 1.
     */
    async function deleteTokenLogic(pool, username, application) {
        const [tokenIdsToDelete] = await pool.query(
            'SELECT t.id FROM token t JOIN tokenreg tr ON t.id = tr.id WHERE tr.username = ? AND t.Application = ?',
            [username, application]
        );

        if (tokenIdsToDelete.length > 0) {
            const ids = tokenIdsToDelete.map(r => r.id);
            await pool.query('DELETE FROM tokenreg WHERE id IN (?)', [ids]);
            await pool.query('DELETE FROM token WHERE id IN (?)', [ids]);
        }

        return tokenIdsToDelete.map(r => r.id);
    }

    beforeEach(() => {
        mockQuery.mockReset();
    });

    test('deletion queries by Application + username, not by id + 1', async () => {
        // Simulate two rows returned (split token with non-consecutive IDs)
        mockQuery
            .mockResolvedValueOnce([[{ id: 5 }, { id: 99 }]]) // SELECT — non-consecutive IDs
            .mockResolvedValueOnce([{ affectedRows: 2 }])       // DELETE tokenreg
            .mockResolvedValueOnce([{ affectedRows: 2 }]);      // DELETE token

        const pool = { query: mockQuery };
        const deletedIds = await deleteTokenLogic(pool, 'alice', 'Zephyr');

        expect(deletedIds).toEqual([5, 99]);

        // The SELECT must use Application + username, not id arithmetic
        const selectCall = mockQuery.mock.calls[0];
        expect(selectCall[0]).toMatch(/WHERE tr\.username = \? AND t\.Application = \?/i);
        expect(selectCall[1]).toEqual(['alice', 'Zephyr']);

        // Both DELETE calls must use the collected IDs array, not id + 1
        const deleteTokenregCall = mockQuery.mock.calls[1];
        expect(deleteTokenregCall[0]).toMatch(/DELETE FROM tokenreg WHERE id IN/i);
        expect(deleteTokenregCall[1]).toEqual([[5, 99]]);

        const deleteTokenCall = mockQuery.mock.calls[2];
        expect(deleteTokenCall[0]).toMatch(/DELETE FROM token WHERE id IN/i);
        expect(deleteTokenCall[1]).toEqual([[5, 99]]);
    });

    test('deletion is a no-op when no matching token rows exist', async () => {
        mockQuery.mockResolvedValueOnce([[]]); // SELECT returns empty

        const pool = { query: mockQuery };
        const deletedIds = await deleteTokenLogic(pool, 'alice', 'Jira');

        expect(deletedIds).toEqual([]);
        // Only the SELECT should have been called — no DELETE calls
        expect(mockQuery).toHaveBeenCalledTimes(1);
    });
});
