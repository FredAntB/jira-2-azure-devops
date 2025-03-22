import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import axios from 'axios'; // Add axios for lightweight API calls
import { loginUser, registerUser } from './userService.js';
import pool from './db.js';
import { readArrayFromJSONFile, getSelectionPaths, emptyArrayFromJSONFile, emptyLogFile, emptyJSONFile } from './utils/utils.js';
import { retrieveAndWriteProjects } from './api_calls/index.js';
import { decryptToken, encryptToken } from './tokenService.js';
import { migrate } from './migrations/jiraMigrations.js';
import { fetchAllProjects } from './azure_functions/projects.js';
import { TestsMigration } from './testMigration/TestMigration.js';


// URL's cache
let URL = null;
// Email's cache
let EMAIL = null;
// Jira Token's cache
let JIRA_TOKEN = null;
// Azure Devops Token's cache
let AZURE_TOKEN = null;
// Zephyr Token's cache
let ZEPHYR_TOKEN = null;

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

// Middleware to verify the validity of the Jira token
app.use('/api/save-token', async (req, res, next) => {
    try {
        const { _, token, email, url, application } = req.body;

        if (!token || !application) {
            return res.status(400).json({ success: false, message: 'Missing required parameters: token or application.' });
        }

        if (application === "Zephyr") {
            ZEPHYR_TOKEN = token;
            return next();
        }

        if (application === "Azure Devops") {
            AZURE_TOKEN = token;

            // Fetch and write Azure projects to a separate file
            const azureProjects = await fetchAllProjects(token);
            fs.writeFileSync("./json/azure_projects.json", JSON.stringify({ projects: azureProjects }, null, 2));

            return next();
        }

        if (application === "Jira") {
            if (!token || !email || !url) {
                return res.status(400).json({ success: false, message: 'Missing required parameters for Jira.' });
            }

            const isValid = await validateJiraToken(url, email, token);
            if (!isValid) {
                return res.status(401).json({ success: false, message: 'Invalid Jira token.' });
            }

            URL = url;
            EMAIL = email;
            JIRA_TOKEN = token;

            // Fetch and write Jira projects to a separate file
            await retrieveAndWriteProjects(url, email, token, "./json/jira_projects.json");

            return next();
        }

        return next();
    } catch (e) {
        console.error('❌ Error in token validation middleware:', e.message);
        return res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

// ruta de test
app.get('/api/test', (_, res) => {
    res.json({ message: "✅ Backend funcionando correctamente" });
});

// chequeando que las rutas carguen
console.log("🔍 Loaded API routes:");
app._router.stack.forEach((r) => {
    if (r.route && r.route.path) {
        console.log(`➡️ ${r.route.path}`);
    }
});

// ruta para registro del usuario 
app.post('/api/register', async (req, res) => {
    console.log("📩 Received POST request at /api/register");

    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ success: false, message: "Missing username or password" });
        }

        await registerUser(username, password);
        res.json({ success: true, message: "Usuario registrado con éxito" });
    } catch (error) {
        console.error("❌ Error in /api/register:", error.message);
        res.status(400).json({ success: false, message: error.message });
    }
});

// ruta para login del user
app.post('/api/login', async (req, res) => {
    console.dir(req, { depth: null });
    try {
        const { username, password } = req.body;
        const user = await loginUser(username, password);
        res.status(200).json({ success: true, user: user.username });
    } catch (error) {
        console.error("❌ Login error:", error.message);
        res.status(401).json({ success: false, message: "Unable to login" });
    }
});

// ruta para obtener tokens
app.get('/api/tokens', async (req, res) => {
    try {
        const { username } = req.query;
        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Usuario no encontrado' });
        }

        const [tokens] = await pool.query(`
            SELECT t.id, t.Number, t.Application, t.email, t.url, t.part 
            FROM token t
            JOIN tokenreg tr ON t.id = tr.id
            WHERE tr.username = ?`, [username]);

        const decryptedTokens = tokens.filter(token => token.part === null).map(token => ({
            id: token.id,
            Number: decryptToken(token.Number),
            Application: token.Application,
            email: token.email,
            url: token.url,
            part: token.part
        }));

        const jiraToken = decryptedTokens.find(token => token.Application === 'Jira');
        if (jiraToken) {
            JIRA_TOKEN = jiraToken.Number;
            EMAIL = jiraToken.email;
            URL = jiraToken.url;
        } else {
            JIRA_TOKEN = null;
            EMAIL = null;
            URL = null;
        }
        const zephyrToken = tokens.filter(token => token.Application === 'Zephyr');
        if (zephyrToken) {
            const p_1 = zephyrToken.find(token => token.part === 1);
            const p_2 = zephyrToken.find(token => token.part === 2);
            ZEPHYR_TOKEN = decryptToken(p_1.Number + p_2.Number);
            decryptedTokens.push({
                id: p_1.id,
                Number: ZEPHYR_TOKEN,
                Application: "Zephyr",
                email: zephyrToken.email,
                url: zephyrToken.url,
                part: null
            });
        }

        const azureToken = decryptedTokens.find(token => token.Application === 'Azure Devops');
        if (azureToken) {
            AZURE_TOKEN = azureToken.Number;
        }

        res.json({ success: true, tokens: decryptedTokens });
    } catch (error) {
        console.error('❌ Error fetching tokens:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// Modify save-token endpoint
app.post('/api/save-token', async (req, res) => {
    try {
        console.dir(req.body, { depth: null });
        const { username, token, email, url, application } = req.body;

        if (!username || !token || !application) {
            return res.status(400).json({ success: false, message: 'Missing required parameters.' });
        }

        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Usuario no encontrado' });
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
        if (!res.headersSent) { // Ensure no response has been sent already
            return res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    }
});

// Modify delete-token endpoint
app.delete('/api/delete-token', async (req, res) => {
    try {
        const { username, tokenId } = req.body;

        if (!username || !tokenId) {
            return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos.' });
        }

        const [userRows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);
        if (userRows.length === 0) {
            return res.status(400).json({ success: false, message: 'Usuario no encontrado' });
        }

        const [tokenRows] = await pool.query(`
            SELECT t.id, t.Application FROM token t
            JOIN tokenreg tr ON t.id = tr.id
            WHERE tr.username = ? AND t.id = ?`, [username, tokenId]);

        if (tokenRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Token no encontrado o no pertenece al usuario' });
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

        // Delete all parts of the token
        await pool.query('DELETE FROM tokenreg WHERE username = ? AND id = ?', [username, tokenId]);
        await pool.query('DELETE FROM token WHERE id = ?', [tokenId]);
        await pool.query('DELETE FROM token WHERE id = ? AND part IS NOT NULL', [tokenId]);

        res.status(200).json({ success: true, message: 'Token eliminado correctamente' });
    } catch (error) {
        console.error('❌ Error al eliminar el token:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// Route to get Jira projects
app.get('/api/jira/projects', async (_, res) => {
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
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// Route to get Azure projects
app.get('/api/azure/projects', async (_, res) => {
    try {
        // Read Azure projects from the dedicated file
        let azureProjects = [];

        if (fs.existsSync("./json/azure_projects.json")) {
            azureProjects = readArrayFromJSONFile("./json/azure_projects.json", "projects");
        }

        if (azureProjects.length === 0) {
            azureProjects = await fetchAllProjects(AZURE_TOKEN);
            fs.writeFileSync("./json/azure_projects.json", JSON.stringify({ projects: azureProjects }, null, 2));
        }

        res.status(200).send({ projects: azureProjects, status: "ok" });
    } catch (error) {
        console.error('❌ Error fetching Azure projects:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ruta de migracion
app.post('/api/migration', async (req, res) => {
    console.dir(req.body, { depth: null });
    const { start, origin, destination, options } = req.body;

    if (!origin || !destination) {
        return res.status(400).json({ message: "Missing required parameters." });
    }

    if (start) {
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
        const { azure_org, azure_proj } = destination.split('/');


        migrate(URL, EMAIL, JIRA_TOKEN, origin, logFilePath, "./json/total.json", new_options, options_paths)
        //LUCHO - EYSE AQUI MIGRA?
        /*.then(() => {
            const testMigration = new TestsMigration(ZEPHYR_TOKEN, origin, AZURE_TOKEN, azure_org, azure_proj, logFilePath);
            testMigration.migrateTestPlans();
            testMigration.migrateTestSuites();
            testMigration.migrateTestCases();
        });*/



        res.status(200).json({
            message: "Migration request received successfully.",
            receivedData: { origin, destination, options }
        });
    }
});

app.post('/api/end-migration', async (req, res) => {
    const { finish } = req.body;

    if (finish) {
        emptyLogFile("./logfile.log");
        emptyJSONFile("./json/total.json");
        res.status(200).json({ message: "Migration ended successfully..." });
    }
    else {
        res.status(400).json({ message: "Tried to end migration forcefully..." });
    }
});

app.post('/api/end-migration', bodyParser.json(), async (req, res) => {
    const { finish } = req.body;

    if (finish) {
        emptyLogFile("./logfile.log");
        emptyJSONFile("./json/total.json");
        res.status(200).json({ message: "Migration ended successfully..." });
    }
    else {
        res.status(400).json({ message: "Tried to end migration forcefully..." });
    }
});

//endpoint /api/migration-status (GET) lo que debo hacer es leer logfile.log, luego debo retornar un array de logs (siguiendo el formato en progress.jsx)
// luego calcular el progreso [Log1, Log2, Log3]
app.get('/api/migration-status', async (_, res) => {
    try {
        const logData = await fs.promises.readFile('./logfile.log', 'utf-8');

        const logs = logData.split('============\n').map(log => log.trim()).filter(log => log);

        const totalJsonData = await fs.promises.readFile('./json/total.json', 'utf-8');
        const totalData = JSON.parse(totalJsonData);

        const progress = (totalData.migrated / totalData.total) * 100;

        res.status(200).json({ progress, logs });

    } catch (error) {
        console.error('Error while reading logfile.log:', error);
        res.status(500).json({ error: 'There was an error while reading the status. Could not get the migration status' });
    }
});
console.log('Pool initialized:', pool);

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
