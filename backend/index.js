import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import axios from 'axios';
import { loginUser, registerUser } from './userService.js';
import pool from './db.js';
import { readArrayFromJSONFile, getSelectionPaths, emptyArrayFromJSONFile, emptyLogFile, emptyJSONFile, appendToLogFile } from './utils/utils.js';
import { retrieveAndWriteProjects } from './api_calls/index.js';
import { decryptToken, encryptToken } from './tokenService.js';
import { migrate } from './migrations/jiraMigrations.js';
import { fetchAllProjects, migrateData } from './azure_functions/projects.js';
import { TestsMigration } from './testMigration/TestMigration.js';
import authMiddleware from './middleware/authMiddleware.js';
import { validateMigrationRequest, validateSaveTokenRequest, validateRegisterRequest } from './middleware/validateMiddleware.js';


// Startup environment variable validation
if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) {
    console.error('[FATAL] ENCRYPTION_KEY must be at least 32 characters');
    process.exit(1);
}
if (!process.env.JWT_SECRET) {
    console.error('[FATAL] JWT_SECRET environment variable is required');
    process.exit(1);
}
if (!process.env.DB_HOST) {
    console.error('[FATAL] DB_HOST environment variable is required');
    process.exit(1);
}
if (!process.env.DB_USER) {
    console.error('[FATAL] DB_USER environment variable is required');
    process.exit(1);
}
if (!process.env.DB_PASSWORD) {
    console.error('[FATAL] DB_PASSWORD environment variable is required');
    process.exit(1);
}
if (!process.env.DB_NAME) {
    console.error('[FATAL] DB_NAME environment variable is required');
    process.exit(1);
}

// URL's cache
let URL = null;
// Email's cache
let EMAIL = null;
// Jira Token's cache
let JIRA_TOKEN = null;
// Azure Devops Token's cache
let AZURE_TOKEN = null;
// Azure Devops Organization's cache (used for single-org PATs)
let AZURE_ORG = null;
// Zephyr Token's cache
let ZEPHYR_TOKEN = null;
// Migration concurrency guard
let migrationInProgress = false;

const app = express();

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());
app.use(bodyParser.json());

// debug
app.use((req, _, next) => {
    console.log(`📌 Request received: ${req.method} ${req.url}`);
    next();
});

// Function to validate Jira token
async function validateJiraToken(url, email, token) {
    try {
        const response = await axios.get(`${url}/rest/api/3/myself`, {
            auth: { username: email, password: token }
        });
        return response.status === 200; // Token is valid if the response status is 200
    } catch (error) {
        console.error('❌ Jira token validation failed:', error.message);
        return false; // Token is invalid
    }
}

// Middleware to cache application credentials and validate Jira token on save
app.use('/api/save-token', async (req, res, next) => {
    try {
        const { token, email, url, application } = req.body;

        if (!token || !application) {
            return res.status(400).json({ success: false, message: 'Missing required parameters: token or application.' });
        }

        if (application === "Zephyr") {
            ZEPHYR_TOKEN = token;
            return next();
        }

        if (application === "Azure Devops") {
            AZURE_TOKEN = token;
            AZURE_ORG = url || null;  // url field carries the organization name for Azure
            const azureProjects = await fetchAllProjects(token, AZURE_ORG);
            fs.writeFileSync("./json/azure_projects.json", JSON.stringify({ projects: azureProjects }, null, 2));
            return next();
        }

        if (application === "Jira") {
            if (!email || !url) {
                return res.status(400).json({ success: false, message: 'Missing required parameters for Jira.' });
            }
            const isValid = await validateJiraToken(url, email, token);
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Invalid Jira token.' });
            }
            URL = url;
            EMAIL = email;
            JIRA_TOKEN = token;
            await retrieveAndWriteProjects(url, email, token, "./json/jira_projects.json");
            return next();
        }

        return next();
    } catch (e) {
        console.error('❌ Error in token validation middleware:', e.message);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// Health check — public
app.get('/api/test', (_, res) => {
    res.json({ message: "✅ Backend is running correctly." });
});

/**
 * Loads all credentials for a user from the DB into the in-memory cache.
 * Returns the decrypted token list. Safe to call multiple times — idempotent.
 * Used by /api/tokens and by the migration route to restore state after a restart.
 */
async function loadCredentialsForUser(username) {
    const [tokens] = await pool.query(`
        SELECT t.id, t.Number, t.Application, t.email, t.url, t.part
        FROM token t
        JOIN tokenreg tr ON t.id = tr.id
        WHERE tr.username = ?`, [username]);

    const decryptedTokens = tokens.filter(t => t.part === null).map(t => ({
        id: t.id,
        Number: decryptToken(t.Number),
        Application: t.Application,
        email: t.email,
        url: t.url,
        part: t.part
    }));

    const jiraToken = decryptedTokens.find(t => t.Application === 'Jira');
    if (jiraToken) {
        JIRA_TOKEN = jiraToken.Number;
        EMAIL = jiraToken.email;
        URL = jiraToken.url;
    } else {
        JIRA_TOKEN = null;
        EMAIL = null;
        URL = null;
    }

    const zephyrParts = tokens.filter(t => t.Application === 'Zephyr');
    if (zephyrParts.length > 0) {
        const p_1 = zephyrParts.find(t => t.part === 1);
        const p_2 = zephyrParts.find(t => t.part === 2);
        if (p_1 && p_2) {
            ZEPHYR_TOKEN = decryptToken(p_1.Number.concat(p_2.Number));
            decryptedTokens.push({ id: p_1.id, Number: ZEPHYR_TOKEN, Application: 'Zephyr', email: p_1.email, url: p_1.url, part: null });
        } else if (p_1) {
            ZEPHYR_TOKEN = decryptToken(p_1.Number);
            decryptedTokens.push({ id: p_1.id, Number: ZEPHYR_TOKEN, Application: 'Zephyr', email: p_1.email, url: p_1.url, part: null });
        }
    }

    const azureToken = decryptedTokens.find(t => t.Application === 'Azure Devops');
    if (azureToken) {
        AZURE_TOKEN = azureToken.Number;
        AZURE_ORG = azureToken.url || null;
    }

    return decryptedTokens;
}

// Register a new user — public
app.post('/api/register', validateRegisterRequest, async (req, res) => {
    console.log("📩 Received POST request at /api/register");

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Missing username or password." });
        }

        await registerUser(username, password);
        res.json({ success: true, message: "User registered successfully." });
    } catch (error) {
        console.error("❌ Error in /api/register:", error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// Login and return JWT
app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const user = await loginUser(username, password);

        // Silently warm the in-memory credential cache so routes that depend on
        // JIRA_TOKEN / AZURE_TOKEN work immediately without requiring the user to
        // visit the token manager first. Errors here are non-fatal — login still succeeds.
        loadCredentialsForUser(user.username).catch(err => {
            console.warn(`[Login] Could not pre-load credentials for "${user.username}":`, err.message);
        });

        res.status(200).json({ success: true, token: user.token, user: user.username });
    } catch (error) {
        console.error("❌ Login error:", error.message);
        res.status(401).json({ success: false, message: "Invalid credentials." });
    }
});

// Get decrypted tokens for the authenticated user — protected
app.get('/api/tokens', authMiddleware, async (req, res, next) => {
    try {
        const { username } = req.query;
        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const decryptedTokens = await loadCredentialsForUser(username);
        res.json({ success: true, tokens: decryptedTokens });
    } catch (error) {
        console.error('❌ Error fetching tokens:', error);
        if (error.code === 'ER_CON_COUNT_ERROR') {
            return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
        }
        next(error);
    }
});

// Save an encrypted token — protected
app.post('/api/save-token', authMiddleware, validateSaveTokenRequest, async (req, res, next) => {
    try {
        const { username, token, email, url, application } = req.body;

        if (!username || !token || !application) {
            return res.status(400).json({ success: false, message: 'Missing required parameters.' });
        }

        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        // Upsert: delete any existing token rows for this application + user before inserting.
        // Must delete tokenreg (child) before token (parent) to satisfy the FK constraint.
        const [existingTokenRows] = await pool.query(
            'SELECT t.id FROM token t JOIN tokenreg tr ON t.id = tr.id WHERE tr.username = ? AND t.Application = ?',
            [username, application]
        );
        if (existingTokenRows.length > 0) {
            const ids = existingTokenRows.map(r => r.id);
            await pool.query('DELETE FROM tokenreg WHERE id IN (?)', [ids]);
            await pool.query('DELETE FROM token WHERE id IN (?)', [ids]);
        }

        const encryptedToken = encryptToken(token);

        if (encryptedToken.length > 500) {
            // Split the token into parts if it exceeds 500 characters
            const part1 = encryptedToken.slice(0, 500);
            const part2 = encryptedToken.slice(500);

            let tokenResult = null;
            let tokenId = null;

            // Insert the first part of the token
            [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, 1)',
                [part1, application, email, url]
            );

            tokenId = tokenResult.insertId;

            // Register the token with the user
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, tokenId]);

            // Insert the second part of the token
            [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, 2)',
                [part2, application, email, url]
            );

            tokenId = tokenResult.insertId;

            // Register the token with the user
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, tokenId]);

        } else {
            // Insert the token as a single part if it does not exceed 500 characters
            const [tokenResult] = await pool.query(
                'INSERT INTO token (Number, Application, email, url, part) VALUES (?, ?, ?, ?, NULL)',
                [encryptedToken, application, email, url]
            );

            const tokenId = tokenResult.insertId;

            // Register the token with the user
            await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, tokenId]);
        }

        res.status(200).json({ success: true, message: `${application} credentials saved successfully!` });
    } catch (error) {
        console.error('❌ Error saving token:', error);
        if (error.code === 'ER_CON_COUNT_ERROR') {
            return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
        }
        if (!res.headersSent) {
            return next(error);
        }
    }
});

// Delete a token — protected
app.delete('/api/delete-token', authMiddleware, async (req, res, next) => {
    try {
        const { username, tokenId } = req.body;

        if (!username || !tokenId) {
            return res.status(400).json({ success: false, message: 'Missing required parameters.' });
        }

        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);
        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const [tokenRows] = await pool.query(`
            SELECT t.id, t.Application FROM token t
            JOIN tokenreg tr ON t.id = tr.id
            WHERE tr.username = ? AND t.id = ?`, [username, tokenId]);

        if (tokenRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Token not found or does not belong to the user' });
        }

        const application = tokenRows[0].Application;

        // Handle application-specific cleanup
        if (application === 'Jira') {
            JIRA_TOKEN = null;
            EMAIL = null;
            URL = null;
            emptyArrayFromJSONFile("./json/jira_projects.json");
        }
        if (application === 'Zephyr') {
            ZEPHYR_TOKEN = null;
        }
        if (application === 'Azure Devops') {
            AZURE_TOKEN = null;
            emptyArrayFromJSONFile("./json/azure_projects.json");
        }

        // Delete all parts of the token (handles both single and split tokens uniformly).
        // Must delete tokenreg (child) before token (parent) to satisfy the FK constraint.
        const [tokenIdsToDelete] = await pool.query(
            'SELECT t.id FROM token t JOIN tokenreg tr ON t.id = tr.id WHERE tr.username = ? AND t.Application = ?',
            [username, application]
        );
        if (tokenIdsToDelete.length > 0) {
            const ids = tokenIdsToDelete.map(r => r.id);
            await pool.query('DELETE FROM tokenreg WHERE id IN (?)', [ids]);
            await pool.query('DELETE FROM token WHERE id IN (?)', [ids]);
        }

        res.status(200).json({ success: true, message: 'Token deleted successfully' });
    } catch (error) {
        console.error('❌ Error deleting token:', error);
        if (error.code === 'ER_CON_COUNT_ERROR') {
            return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
        }
        next(error);
    }
});

// Get Jira projects — protected
app.get('/api/jira/projects', authMiddleware, async (req, res, next) => {
    try {
        // Read Jira projects from the dedicated file
        let jiraProjects = [];

        if (fs.existsSync("./json/jira_projects.json")) {
            jiraProjects = readArrayFromJSONFile("./json/jira_projects.json", "projects");
        }

        if (jiraProjects.length === 0) {
            jiraProjects = await retrieveAndWriteProjects(URL, EMAIL, JIRA_TOKEN, "./json/jira_projects.json");
        }

        res.status(200).send({ projects: jiraProjects, status: "ok" });
    } catch (error) {
        console.error('❌ Error fetching Jira projects:', error);
        if (error.code === 'ER_CON_COUNT_ERROR') {
            return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
        }
        next(error);
    }
});

// Get Azure DevOps projects — protected
app.get('/api/azure/projects', authMiddleware, async (req, res, next) => {
    try {
        // Read Azure projects from the dedicated file
        let azureProjects = [];

        if (fs.existsSync("./json/azure_projects.json")) {
            azureProjects = readArrayFromJSONFile("./json/azure_projects.json", "projects");
        }

        if (azureProjects.length === 0) {
            azureProjects = await fetchAllProjects(AZURE_TOKEN, AZURE_ORG || null);
            fs.writeFileSync("./json/azure_projects.json", JSON.stringify({ projects: azureProjects }, null, 2));
        }

        res.status(200).send({ projects: azureProjects, status: "ok" });
    } catch (error) {
        console.error('❌ Error fetching Azure projects:', error);
        if (error.code === 'ER_CON_COUNT_ERROR') {
            return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
        }
        next(error);
    }
});

// Force-refresh Jira projects from the API, bypassing the JSON cache — protected
app.post('/api/jira/projects/refresh', authMiddleware, async (req, res, next) => {
    try {
        if (!JIRA_TOKEN || !URL) {
            return res.status(400).json({ success: false, message: 'Jira credentials are not configured.' });
        }
        const projects = await retrieveAndWriteProjects(URL, EMAIL, JIRA_TOKEN, "./json/jira_projects.json");
        res.status(200).json({ projects, status: "ok" });
    } catch (error) {
        console.error('❌ Error refreshing Jira projects:', error);
        next(error);
    }
});

// Force-refresh Azure DevOps projects from the API, bypassing the JSON cache — protected
app.post('/api/azure/projects/refresh', authMiddleware, async (req, res, next) => {
    try {
        if (!AZURE_TOKEN) {
            return res.status(400).json({ success: false, message: 'Azure DevOps credentials are not configured.' });
        }
        const projects = await fetchAllProjects(AZURE_TOKEN, AZURE_ORG || null);
        fs.writeFileSync("./json/azure_projects.json", JSON.stringify({ projects }, null, 2));
        res.status(200).json({ projects, status: "ok" });
    } catch (error) {
        console.error('❌ Error refreshing Azure projects:', error);
        next(error);
    }
});

// Start a migration job — protected
app.post('/api/migration', authMiddleware, validateMigrationRequest, async (req, res, next) => {
    const { start, origin, destination, options } = req.body;

    if (start) {
        // Concurrency guard: reject if a migration is already running
        if (migrationInProgress) {
            return res.status(409).json({ success: false, message: 'A migration is already in progress' });
        }

        migrationInProgress = true;

        try {
            // Restore credentials from DB if the in-memory cache is empty (e.g. after a container restart)
            if (!JIRA_TOKEN || !URL) {
                const username = req.user?.username;
                if (username) {
                    console.log('[Migration] In-memory credentials missing — reloading from DB for user:', username);
                    await loadCredentialsForUser(username);
                }
            }

            if (!JIRA_TOKEN || !URL) {
                migrationInProgress = false;
                return res.status(400).json({ success: false, message: 'Jira credentials are not configured. Please save your Jira token first.' });
            }

            if (!AZURE_TOKEN) {
                migrationInProgress = false;
                return res.status(400).json({ success: false, message: 'Azure DevOps credentials are not configured. Please save your Azure token first.' });
            }
            let new_options = options;
            if (options === null) {
                new_options = {
                    customFields: true,
                    issues: true,
                    workflows: true
                };
            }
            const options_paths = getSelectionPaths(new_options, "./json");
            const logFilePath = "./logfile.log";
            const [azure_org, azure_proj] = destination.split('/');

            if (!fs.existsSync(logFilePath)) {
                fs.writeFileSync(logFilePath, '');
            }

            // Initialise total.json if it does not exist
            if (!fs.existsSync('./json/total.json')) {
                fs.writeFileSync('./json/total.json', JSON.stringify({ total: 0, migrated: 0, failed: 0, fields: 0, issues: 0, workflows: 0 }, null, 2));
            }

            migrate(URL, EMAIL, JIRA_TOKEN, origin, logFilePath, "./json/total.json", new_options, options_paths)
                .then(() => migrateData(AZURE_TOKEN, "./json/custom_fields", "./json/workflows", "./json/issues", azure_org, azure_proj, logFilePath, "./json/total.json"))
                .then(() => {
                    const testMigration = new TestsMigration(ZEPHYR_TOKEN, origin, AZURE_TOKEN, azure_org, azure_proj, logFilePath, "./json/total.json");
                    testMigration.migrateTestPlans().then(() => {
                        return testMigration.migrateTestSuites();
                    }).then(() => {
                        return testMigration.migrateTestCases();
                    }).then(() => {
                        appendToLogFile(logFilePath, "Test migration completed successfully.");
                        appendToLogFile(logFilePath, "Migration completed successfully.");
                        const totalJsonData = fs.readFileSync('./json/total.json', 'utf-8');
                        const totalData = JSON.parse(totalJsonData);
                        totalData.migrated = totalData.total;
                        fs.writeFileSync('./json/total.json', JSON.stringify(totalData, null, 2));
                    });
                })
                .catch((err) => {
                    console.error('❌ Migration pipeline error:', err);
                    appendToLogFile(logFilePath, `Migration failed: ${err.message}`);
                })
                .finally(() => {
                    migrationInProgress = false;
                });

            res.status(200).json({
                message: "Migration request received successfully.",
                receivedData: { origin, destination, options }
            });
        } catch (error) {
            migrationInProgress = false;
            next(error);
        }
    }
});

// End a migration and reset state — protected
app.post('/api/end-migration', authMiddleware, async (req, res, next) => {
    try {
        const { finish } = req.body;

        if (finish) {
            emptyLogFile("./logfile.log");
            emptyJSONFile("./json/total.json");
            res.status(200).json({ message: "Migration ended successfully..." });
        } else {
            res.status(400).json({ message: "Tried to end migration forcefully..." });
        }
    } catch (error) {
        next(error);
    }
});

// Get migration progress and logs — protected
app.get('/api/migration-status', authMiddleware, async (req, res, next) => {
    try {
        // Return safe defaults if the log file does not exist yet
        if (!fs.existsSync('./logfile.log')) {
            return res.status(200).json({ progress: 0, logs: [] });
        }

        // Return safe defaults if total.json does not exist yet
        if (!fs.existsSync('./json/total.json')) {
            return res.status(200).json({ progress: 0, logs: [] });
        }

        const totalJsonData = await fs.promises.readFile('./json/total.json', 'utf-8');
        const totalData = JSON.parse(totalJsonData);

        // Return safe defaults if total is 0 (division by zero guard)
        if (!totalData.total || totalData.total === 0) {
            return res.status(200).json({ progress: 0, logs: [] });
        }

        const logData = await fs.promises.readFile('./logfile.log', 'utf-8');
        const logs = logData.split('============\n').map(log => log.trim()).filter(log => log);

        const progress = (totalData.migrated / totalData.total) * 100;

        res.status(200).json({ progress, logs });

    } catch (error) {
        console.error('Error while reading migration status:', error);
        next(error);
    }
});
console.log('Pool initialized:', pool);

// Global error handler — must be the last middleware (four arguments)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
    console.error(err.stack);
    if (err.code === 'ER_CON_COUNT_ERROR') {
        return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
    }
    res.status(500).json({ success: false, message: 'Internal server error' });
});

// ✅ Start the server
const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
    console.log(`🚀 Backend running at http://localhost:${PORT}`);

    // ✅ List registered routes after server starts
    console.log("🔍 Loaded API routes:");
    app._router.stack.forEach((r) => {
        if (r.route && r.route.path) {
            console.log(`➡️ ${r.route.path}`);
        }
    });
});
