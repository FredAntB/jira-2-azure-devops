import bcrypt from 'bcrypt';
import pool from './db.js';

const SALT_ROUNDS = 10;

export const registerUser = async (username, password) => {
    // Verificar si el usuario ya existe
    const [existingUser] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

    if (existingUser.length > 0) {
        throw new Error('El usuario ya existe, intenta con otro nombre de usuario.');
    }

    // Cifrar la contraseña antes de guardarla
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('INSERT INTO user (username, password) VALUES (?, ?)', [username, passwordHash]);

    return { message: 'Usuario registrado con éxito' };
};

// Login de usuario (verifica la contraseña)
export const loginUser = async (username, password) => {
    const [rows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

    if (rows.length === 0) {
        throw new Error('Usuario no encontrado');
    }

    const user = rows[0];

    if (!password) {
        throw new Error("Contraseña no proporcionada");
    }

    if (!user.password) {
        throw new Error("La contraseña almacenada es inválida o no fue guardada correctamente");
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) throw new Error('Contraseña incorrecta');

    return { username: user.Username };
};

