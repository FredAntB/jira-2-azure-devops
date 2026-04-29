import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import pool from './db.js';

const SALT_ROUNDS = 10;

// Validates password meets policy: min 8 chars, at least one digit, one letter, one special char
const isPasswordValid = (password) => {
    return (
        password.length >= 8 &&
        /\d/.test(password) &&
        /[a-zA-Z]/.test(password) &&
        /[!@#$%^&*(),.?":{}|<>]/.test(password)
    );
};

// Validates username: 3–50 alphanumeric characters and underscores only
const isUsernameValid = (username) => {
    return /^[a-zA-Z0-9_]{3,50}$/.test(username);
};

export const registerUser = async (username, password) => {
    // Validate username format
    if (!isUsernameValid(username)) {
        throw new Error('Username must be 3–50 characters and contain only letters, numbers, and underscores.');
    }

    // Validate password policy
    if (!isPasswordValid(password)) {
        throw new Error('Password must be at least 8 characters and include at least one letter, one digit, and one special character.');
    }

    // Check if username already exists
    const [existingUser] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);
    if (existingUser.length > 0) {
        throw new Error('Username already exists. Please choose a different username.');
    }

    // Hash password and insert user
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    await pool.query('INSERT INTO user (username, password) VALUES (?, ?)', [username, passwordHash]);

    return { message: 'User registered successfully.' };
};

export const loginUser = async (username, password) => {
    const [rows] = await pool.query('SELECT * FROM user WHERE username = ?', [username]);

    if (rows.length === 0) {
        throw new Error('Invalid credentials.');
    }

    const user = rows[0];

    if (!password) {
        throw new Error('Invalid credentials.');
    }

    if (!user.password) {
        throw new Error('Invalid credentials.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
        throw new Error('Invalid credentials.');
    }

    // Issue JWT with 24-hour expiry
    const token = jwt.sign(
        { username: user.Username },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
    );

    return { username: user.Username, token };
};
