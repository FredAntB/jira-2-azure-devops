/**
 * validateMiddleware.js
 *
 * Express middleware functions for validating incoming request bodies
 * before they reach route handlers. Each validator returns HTTP 400
 * with a message identifying the invalid field on failure.
 */

const ALLOWED_APPLICATIONS = ['Jira', 'Azure Devops', 'Zephyr'];

/**
 * Validates POST /api/migration requests.
 *
 * Rules:
 *  - `origin`      must be a non-empty string
 *  - `destination` must match {organization}/{project} (no leading slash,
 *                  exactly one forward slash separating two non-empty parts)
 */
export const validateMigrationRequest = (req, res, next) => {
    const { origin, destination } = req.body;

    if (!origin || typeof origin !== 'string' || origin.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Invalid field: "origin" must be a non-empty string.'
        });
    }

    if (
        !destination ||
        typeof destination !== 'string' ||
        !/^[^/]+\/[^/]+$/.test(destination.trim())
    ) {
        return res.status(400).json({
            success: false,
            message: 'Invalid field: "destination" must follow the format "organization/project".'
        });
    }

    next();
};

/**
 * Validates POST /api/save-token requests.
 *
 * Rules:
 *  - `username`    must be a non-empty string
 *  - `token`       must be a non-empty string
 *  - `application` must be one of "Jira", "Azure Devops", "Zephyr"
 *  - `url`         must be a well-formed HTTPS URL when application === "Jira"
 */
export const validateSaveTokenRequest = (req, res, next) => {
    const { username, token, application, url } = req.body;

    if (!username || typeof username !== 'string' || username.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Invalid field: "username" must be a non-empty string.'
        });
    }

    if (!token || typeof token !== 'string' || token.trim() === '') {
        return res.status(400).json({
            success: false,
            message: 'Invalid field: "token" must be a non-empty string.'
        });
    }

    if (!application || !ALLOWED_APPLICATIONS.includes(application)) {
        return res.status(400).json({
            success: false,
            message: `Invalid field: "application" must be one of: ${ALLOWED_APPLICATIONS.join(', ')}.`
        });
    }

    if (application === 'Jira') {
        try {
            const parsed = new URL(url);
            if (parsed.protocol !== 'https:') {
                throw new Error('Not HTTPS');
            }
        } catch {
            return res.status(400).json({
                success: false,
                message: 'Invalid field: "url" must be a well-formed HTTPS URL when application is "Jira".'
            });
        }
    }

    next();
};

/**
 * Validates POST /api/register requests.
 *
 * Rules:
 *  - `username` must match /^[a-zA-Z0-9_]{3,50}$/
 */
export const validateRegisterRequest = (req, res, next) => {
    const { username } = req.body;

    if (!username || !/^[a-zA-Z0-9_]{3,50}$/.test(username)) {
        return res.status(400).json({
            success: false,
            message: 'Invalid field: "username" must be 3–50 characters and contain only letters, numbers, and underscores.'
        });
    }

    next();
};
