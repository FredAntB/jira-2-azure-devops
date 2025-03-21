import fs from 'fs';

async function getMemberId(token) {
    const url = 'https://app.vssps.visualstudio.com/_apis/profile/profiles/me?api-version=7.1-preview.1';
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.id;
}

async function getOrganizations(memberId, token) {
    const url = `https://app.vssps.visualstudio.com/_apis/accounts?memberId=${memberId}&api-version=6.0`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.value.map(org => org.accountName);
}

async function getProjects(organization, token) {
    const url = `https://dev.azure.com/${organization}/_apis/projects?api-version=7.0`;
    const response = await fetch(url, {
        headers: { 'Authorization': `Basic ${Buffer.from(':' + token).toString('base64')}` }
    });
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = await response.json();
    return data.value.map(proj => ({ organization: organization, project: proj.name }));
}

export async function fetchAllProjects(token, save_filepath) {
    try {
        const memberId = await getMemberId(token);
        const organizations = await getOrganizations(memberId, token);

        let allProjects = [];
        for (const org of organizations) {
            const projects = await getProjects(org, token);
            allProjects = allProjects.concat(projects);
        }

        await saveProjectsToFile(save_filepath, allProjects);
        return allProjects;
    } catch (error) {
        console.error('Error:', error.message);
        return [];
    }
}

async function saveProjectsToFile(filepath, data) {
    if (fs.existsSync(filepath)) {
        const existingData = fs.readFileSync(filepath, 'utf-8');
        const parsedExistingData = JSON.parse(existingData);

        if (Array.isArray(parsedExistingData.projects)) {
            parsedExistingData.projects = parsedExistingData.projects.concat(data);
        } else {
            parsedExistingData.projects = data;
        }

        fs.writeFileSync(filepath, JSON.stringify(parsedExistingData, null, 2));
    } else {
        const newData = { projects: data };
        fs.writeFileSync(filepath, JSON.stringify(newData, null, 2));
    }
    console.log(`projects saved to ${filepath}`);
}

// const token = '9fkaAPfbwe5oHbDvIQpVKAGX1saQCg23eUlHogQWW5nH0pOZgXyxJQQJ99BCACAAAAAcetVYAAAGAZDO2da2';
// fetchAllProjects(token).then(data => console.log(JSON.stringify(data, null, 2)));
