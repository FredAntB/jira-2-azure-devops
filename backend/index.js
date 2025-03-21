import express from 'express';
import cors from 'cors';
import bodyParser from 'body-parser';
import fs from 'fs';
import { loginUser, registerUser } from './userService.js';
import pool from './db.js';
import { readArrayFromJSONFile, getSelectionPaths, emptyArrayFromJSONFile, emptyLogFile, emptyJSONFile } from './utils/utils.js';
import { retrieveAndWriteProjects } from './api_calls/index.js';
import { decryptToken, encryptToken } from './tokenService.js';
import { migrate } from './migrations/jiraMigrations.js';
import { fetchAllProjects } from './azure_functions/projects.js';
import { TestsMigration } from './testMigration/TestMigration.js';


// Project's cache
let projects = [];
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

// verify the validity of the jira token
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

            projects = projects.concat(await fetchAllProjects(token, "./json/projects.json"));

            return next();
        }

        if (application === "Jira") {
            if (!token || !email || !url || !application) {
                return res.status(400).json({ success: false, message: 'Faltan parámetros requeridos.' });
            }

            URL = url;
            EMAIL = email;
            JIRA_TOKEN = token;
            projects = projects.concat(await retrieveAndWriteProjects(url, email, token, "./json/projects.json"));
            return next(); // Ensure we return here to avoid further execution
        }

        return next();
    } catch (e) {
        if (e.cause && e.cause === 'invalid_token') {
            return res.status(401).send({ message: "AUTHENTICATED_FAILED" }); // Ensure we return here
        }
    }

    next();
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
            SELECT t.id, t.Number, t.Application, t.email, t.url 
            FROM token t
            JOIN tokenreg tr ON t.id = tr.id
            WHERE tr.username = ?`, [username]);

        const decryptedTokens = tokens.map(token => ({
            id: token.id,
            Number: decryptToken(token.Number),
            Application: token.Application,
            email: token.email,
            url: token.url
        }));

        const zephyrToken = decryptedTokens.find(token => token.Application === 'Zephyr');
        if (zephyrToken) {
            ZEPHYR_TOKEN = zephyrToken.Number;
        }

        const azureToken = decryptedTokens.find(token => token.Application === 'Azure Devops');
        if (azureToken) {
            AZURE_TOKEN = azureToken.Number;
            // Read projects from JSON file if cache is empty
            if (projects.length === 0) {
                projects = readArrayFromJSONFile("./json/projects.json", "projects");
            }
        }

        const jiraToken = decryptedTokens.find(token => token.Application === 'Jira');
        if (jiraToken) {
            JIRA_TOKEN = jiraToken.Number;
            EMAIL = jiraToken.email;
            URL = jiraToken.url;

            // Read projects from JSON file if cache is empty
            if (projects.length === 0) {
                projects = readArrayFromJSONFile("./json/projects.json", "projects");
            }

            // If still empty, retrieve Jira and Azure projects
            if (projects.length === 0) {
                const jiraProjects = await retrieveAndWriteProjects(URL, EMAIL, JIRA_TOKEN, "./json/projects.json");
                projects = projects.concat(jiraProjects);
            }
        } else {
            JIRA_TOKEN = null;
            EMAIL = null;
            URL = null;
        }

        res.json({ success: true, tokens: decryptedTokens });
    } catch (error) {
        console.error('❌ Error fetching tokens:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ruta para guardar token
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
        const [tokenResult] = await pool.query(
            'INSERT INTO token (Number, Application, email, url) VALUES (?, ?, ?, ?)',
            [encryptedToken, application, email, url]
        );

        const tokenId = tokenResult.insertId;
        await pool.query('INSERT INTO tokenreg (username, id) VALUES (?, ?)', [username, tokenId]);

        res.status(200).json({ success: true, message: `${application} credentials saved successfully!` });
    } catch (error) {
        console.error('❌ Error saving token:', error);
        if (!res.headersSent) { // Ensure no response has been sent already
            return res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    }
});

// ruta para eliminar el token
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
            SELECT t.id FROM token t
            JOIN tokenreg tr ON t.id = tr.id
            WHERE tr.username = ? AND t.id = ?`, [username, tokenId]);

        if (tokenRows.length === 0) {
            return res.status(404).json({ success: false, message: 'Token no encontrado o no pertenece al usuario' });
        }

        await pool.query('DELETE FROM tokenreg WHERE username = ? AND id = ?', [username, tokenId]);
        await pool.query('DELETE FROM token WHERE id = ?', [tokenId]);

        // Limpiar la caché
        projects = [];
        URL = null;
        EMAIL = null;
        JIRA_TOKEN = null;
        emptyArrayFromJSONFile("./json/projects.json", "projects");

        res.status(200).json({ success: true, message: 'Token eliminado correctamente' });
    } catch (error) {
        console.error('❌ Error al eliminar el token:', error);
        res.status(500).json({ success: false, message: 'Error interno del servidor' });
    }
});

// ruta para obtener proyectos
app.get('/api/jira/projects', async (_, res) => {
    projects = projects.length === 0 ? readArrayFromJSONFile("./json/projects.json", "projects") : projects;
    res.status(200).send({ projects, status: "ok" });
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
            .then(() => {
                const testMigration = new TestsMigration(ZEPHYR_TOKEN, origin, AZURE_TOKEN, azure_org, azure_proj, logFilePath);
                testMigration.migrateTestPlans();
                testMigration.migrateTestSuites();
                testMigration.migrateTestCases();
            });



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
