import crypto from 'crypto';
import pool from './db.js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const IV_LENGTH = 16;

//Encrypt token
export const encryptToken = (token) => {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

// Decrypt token
export const decryptToken = (encryptedToken) => {
    let parts = encryptedToken.split(':');
    let iv = Buffer.from(parts[0], 'hex');
    let encryptedText = Buffer.from(parts[1], 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
};

// Save a token for a user
export const saveUserToken = async (username, token, application, email, url) => {
    const encryptedToken = encryptToken(token);

    // Insert into `token` and retrieve the `id`
    const [result] = await pool.query(
        `INSERT INTO token (number, application, email, url) VALUES (?, ?, ?, ?)`,
        [encryptedToken, application, email || null, url || null]
    );

    const tokenId = result.insertId; // Get the auto-generated ID

    // Associate in `tokenreg`
    await pool.query(
        'INSERT INTO tokenreg (username, token_id) VALUES (?, ?)', 
        [username, tokenId]
    );

    return { message: 'Token saved successfully' };
};

// Get tokens for a user
export const getUserTokens = async (username) => {
    const [rows] = await pool.query(
        `SELECT token.id, token.number, token.application, token.email, token.url 
         FROM token 
         INNER JOIN tokenreg ON token.id = tokenreg.token_id
         WHERE tokenreg.username = ?`, 
        [username]
    );

    if (rows.length === 0) throw new Error('No tokens found for this user');

    return rows.map(row => ({
        id: row.id,
        number: decryptToken(row.number), // Decrypt before returning
        application: row.application,
        email: row.email,
        url: row.url
    }));
};

