import axios from 'axios';

const API_URL = "http://localhost:4000/api";

// Create an axios instance
const api = axios.create({
    baseURL: API_URL,
    headers: {
        "Content-Type": "application/json"
    }
});

export const getTokens = async (username) => {
    const tokensResponse = await api.get(`/tokens?username=${username}`);
    return tokensResponse.data;
}

// Helper function for POST requests
const postRequest = async (path, body) => {
    try {
        const response = await api.post(path, body);
        return response;
    } catch (e) {
        return e.response;
    }
};

export const postLoginCredentials = async (username, password) => {
    const response = await postRequest("/login", { username, password });

    if (response.status === 200) {
        return [response.data.success, response.data.user];
    }
    else {
        return [response.data.success, response.data.message];
    }
}

// public functions for api requests
// this is done with the purpose to not display the API url in the frontend
export const postTokens = async (username, api_token, application, email, url) => {
    const response = await postRequest("/save-token", {
        username,
        token: api_token,
        application,
        email,
        url
    });

    if (response.status === 401 && response.data.message === "AUTHENTICATED_FAILED" && application === "Jira") {
        return [response.data.success, "The provided Jira API token is invalid... Please try again..."];
    }

    /*
    if (response.status === 200) {
        return response.data.success, response.data.message;
    }
    else {
        return response.data.success, response.data.message;
    }*/
    return [response.data.success, response.data.message];
};

export const getJiraProjects = async () => {
    const response = await api.get("/jira/projects");

    if (response.status === 200) {
        return response.data;
    } else {
        return response.data;
    }
};

export const getAzureProjects = async () => {
    const response = await api.get("/azure/projects");

    if (response.status === 200) {
        return response.data;
    } else {
        return response.data;
    }
};

export const startMigration = async (origin, destination, options) => {

    try {
        const response = await postRequest("/migration", {
            start: true,
            origin,
            destination,
            options
        });

        if (response && response.status === 200) {
            console.log("Success:", response.data);
            return true;
        } else {
            console.error("Migration failed:", response);
            return false;
        }
    } catch (error) {
        console.error("Error in startMigration:", error);
        return false;
    }
};

export const getMigrationStatus = async () => {
    const response = await api.get("/migration-status");

    console.dir(response, { depth: null });

    if (response.status === 200) {
        return response.data;
    }
    else {
        return "migration not started...";//throw new Error("Error fetching migration status...");
    }
}

export const endMigration = async () => {
    const response = await postRequest("/end-migration", {
        finish: true
    });

    if (response.status === 200) {
        return response.data;
    }
    else {
        throw new Error("Error ending migration...");
    }
}