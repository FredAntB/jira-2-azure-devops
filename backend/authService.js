import bcrypt from 'bcrypt';
import crypto from 'crypto';
import pool from './db.js';

const SALT_ROUNDS = 10;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY.padEnd(32, '0'); // Llave de 32 bytes
const IV_LENGTH = 16;

// Función para cifrar tokens
const encryptToken = (token) => {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

// Función para descifrar tokens
const decryptToken = (encryptedToken) => {
    let parts = encryptedToken.split(':');
    let iv = Buffer.from(parts[0], 'hex');
    let encryptedText = Buffer.from(parts[1], 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
};

// Registro de usuario
export const registerUser = async (email, password) => {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const [result] = await pool.query('INSERT INTO users (email, password_hash) VALUES (?, ?)', [email, passwordHash]);
    return result.insertId;
};

// Login de usuario
export const loginUser = async (email, password) => {
    const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) throw new Error('Usuario no encontrado');

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) throw new Error('Contraseña incorrecta');

    return { id: user.id, email: user.email };
};

// Guardar tokens cifrados en MySQL
export const saveUserTokens = async (email, jiraToken, azureToken) => {
    const encryptedJiraToken = jiraToken ? encryptToken(jiraToken) : null;
    const encryptedAzureToken = azureToken ? encryptToken(azureToken) : null;

    await pool.query('UPDATE users SET jira_token = ?, azure_token = ? WHERE email = ?', 
    [encryptedJiraToken, encryptedAzureToken, email]);
};

// Obtener tokens descifrados
export const getUserTokens = async (email) => {
    const [rows] = await pool.query('SELECT jira_token, azure_token FROM users WHERE email = ?', [email]);
    if (rows.length === 0) throw new Error('Usuario no encontrado');

    return {
        jiraToken: rows[0].jira_token ? decryptToken(rows[0].jira_token) : null,
        azureToken: rows[0].azure_token ? decryptToken(rows[0].azure_token) : null
    };
};
