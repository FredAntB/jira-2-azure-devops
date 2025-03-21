import fetch from 'node-fetch';
import fs from 'fs';
import { pipeline } from 'stream';
import { promisify } from 'util';

const pipelineAsync = promisify(pipeline);

export const isEmptyString = (str) => {
    return str === null || str === undefined || str === '' || str.length === 0;
}

export const assert = (condition, message) => {
    if (!condition) {
        throw new Error(message || "Assertion failed...");
    }
}

export const repeatString = (str, times) => {
    let res = "";
    for (let i = 0; i < times; i++) {
        res += str;
    }
    return res;
}

export const getHttpRequest = async (URL, headers) => {
    const response = await fetch(URL, {
        method: 'GET',
        headers: headers
    });

    if (!response.ok) {
        throw new Error("Invalid information, try again...");
    }

    return response;
}

export const createDirectory = (dirpath) => {
    if (!fs.existsSync(dirpath)) {
        fs.mkdirSync(dirpath);
    }
}

export const deleteFile = (filepath) => {
    assert(fs.existsSync(filepath), "File does not exist...");
    fs.unlinkSync(filepath);
}

export const emptyLogFile = (filepath) => {
    assert(fs.existsSync(filepath), "File does not exist...");
    fs.writeFileSync(filepath, '', 'utf8');
}

export const emptyJSONFile = (filepath, default_value = null) => {
    assert(fs.existsSync(filepath), "File does not exist...");
    fs.writeFileSync
        (filepath, JSON.stringify(default_value ? default_value : {}, null, 2), 'utf8');
}

export const readArrayFromJSONFile = (filepath, property) => {
    if (!fs.existsSync(filepath)) {
        throw new Error("File does not exist...");
    }
    const data = fs.readFileSync(filepath);
    const array = JSON.parse(data)[property];
    return array ? array : [];
}

export const emptyArrayFromJSONFile = (filepath, property) => {
    if (!fs.existsSync(filepath)) {
        throw new Error("File does not exist...");
    }

    fs.writeFileSync(filepath, JSON.stringify({ [property]: [] }, null, 2), 'utf8');
}

export const appendToLogFile = (filepath, text) => {
    assert(!isEmptyString(filepath), "Invalid filepath...");
    assert(!isEmptyString(text), "Invalid text...");

    const formatter = new Intl.DateTimeFormat('en', {
        dateStyle: 'short',
        timeStyle: 'short',
    });
    const date = formatter.formatToParts().map(obj => obj.value).join('');

    text += " " + date + "\n" + repeatString("=", 12) + "\n";
    if (fs.existsSync(filepath)) {
        fs.appendFileSync(filepath, text, 'utf8');
    }
    else {
        fs.writeFileSync(filepath, text, 'utf8');
    }
}

export const downloadFile = async (download_url, destiny_file, headers = null, log_download = false, log_file = null) => {
    if (log_download && log_file) {
        appendToLogFile(log_file, `Downloading file from ${download_url} to ${destiny_file}`);
    }
    const response = await getHttpRequest(download_url, headers);

    if (!response.ok) {
        throw new Error(`Failed to download file from ${download_url}`);
    }

    const flags = fs.existsSync(destiny_file) ? { flags: 'w' } : { flags: 'wx' };

    const ws = fs.createWriteStream(destiny_file, flags);
    await pipelineAsync(response.body, ws);
}

const isUpercase = (character) => {
    return character === character.toUpperCase();
}


export const getSelectionPaths = (migrate_data, base_dir, file_type = null) => {
    assert(typeof migrate_data === 'object', "Invalid migrate_data...");

    if (!file_type) {
        file_type = "";
    }
    else if (file_type[0] !== ".") {
        file_type = "." + file_type;
    }

    let paths = [];
    Object.keys(migrate_data).forEach(key => {
        if (migrate_data[key]) {
            paths.push(base_dir + "/" + Array.from(key).map((char) => isUpercase(char) ? "_" + char : char).join("").toLowerCase() + file_type);
        }
    });

    return paths;
}