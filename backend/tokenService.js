import crypto from 'crypto';
import pool from './db.js';

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY.padEnd(32, '0'); // Llave de 32 bytes
const IV_LENGTH = 16;

//Cifrar token
export const encryptToken = (token) => {
    let iv = crypto.randomBytes(IV_LENGTH);
    let cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
};

// Desencriptar token
export const decryptToken = (encryptedToken) => {
    let parts = encryptedToken.split(':');
    let iv = Buffer.from(parts[0], 'hex');
    let encryptedText = Buffer.from(parts[1], 'hex');
    let decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = Buffer.concat([decipher.update(encryptedText), decipher.final()]);
    return decrypted.toString('utf8');
};

// Guardar un token para un usuario
export const saveUserToken = async (username, token, application, email, url) => {
    const encryptedToken = encryptToken(token);

    // Insertar en `token` y recuperar el `id`
    const [result] = await pool.query(
        `INSERT INTO token (number, application, email, url) VALUES (?, ?, ?, ?)`,
        [encryptedToken, application, email || null, url || null]
    );

    const tokenId = result.insertId; // Obtener el ID generado automáticamente

    // Relacionar en `tokenreg`
    await pool.query(
        'INSERT INTO tokenreg (username, token_id) VALUES (?, ?)', 
        [username, tokenId]
    );

    return { message: 'Token almacenado correctamente' };
};

// 🔹 Obtener tokens de un usuario
export const getUserTokens = async (username) => {
    const [rows] = await pool.query(
        `SELECT token.id, token.number, token.application, token.email, token.url 
         FROM token 
         INNER JOIN tokenreg ON token.id = tokenreg.token_id
         WHERE tokenreg.username = ?`, 
        [username]
    );

    if (rows.length === 0) throw new Error('No se encontraron tokens para este usuario');

    return rows.map(row => ({
        id: row.id,
        number: decryptToken(row.number), // Desencriptar antes de devolver
        application: row.application,
        email: row.email,
        url: row.url
    }));
};

