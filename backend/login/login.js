import bcrypt from 'bcrypt';
import pool from './db.js';

const SALT_ROUNDS = 10;


const passwordIsValid = (password) => {
    return password.length >= 8 &&
        /\d/.test(password) &&
        /[a-zA-Z]/.test(password) &&
        /[!@#$%^&*(),.?":{}|<>]/.test(password);
};


const isUsernameUnique = async (username) => {
    const [rows] = await pool.query('SELECT username FROM user WHERE username = ?', [username]);
    return rows.length === 0;
};


export const createAccount = async (username, password) => {
    if (!await isUsernameUnique(username)) {
        throw new Error('El nombre de usuario ya existe.');
    }

    if (!passwordIsValid(password)) {
        throw new Error('La contraseña debe tener al menos 8 caracteres, incluir letras, números y un carácter especial.');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('INSERT INTO user (username, password) VALUES (?, ?)', [username, passwordHash]);

    console.log("Cuenta creada con éxito.");
};


export const login = async (username, password) => {
    const [rows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

    if (rows.length === 0) {
        throw new Error('Credenciales inválidas.');
    }

    const user = rows[0];
    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
        throw new Error('Credenciales inválidas.');
    }

    console.log("Inicio de sesión exitoso.");
    return user;
};
