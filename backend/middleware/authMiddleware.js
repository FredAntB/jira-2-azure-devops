import jwt from 'jsonwebtoken';

/**
 * JWT authentication middleware.
 * Extracts the Bearer token from the Authorization header,
 * verifies it against JWT_SECRET, and attaches the decoded
 * payload to req.user on success.
 * Returns HTTP 401 if the token is absent, malformed, or expired.
 */
const authMiddleware = (req, res, next) => {
    const authHeader = req.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, message: 'Unauthorized: missing or malformed Authorization header.' });
    }

    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        next();
    } catch (error) {
        return res.status(401).json({ success: false, message: 'Unauthorized: invalid or expired token.' });
    }
};

export default authMiddleware;
