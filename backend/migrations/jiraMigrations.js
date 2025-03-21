import { retrieveAndWriteCustomFields, retrieveAndWriteWorkflows, retrieveAndWriteIssues } from "../api_calls/index.js";
import { assert, appendToLogFile } from "../utils/utils.js";

export const migrate = async (url, email, api_token, p_key, log_filepath, total_filepath, migrate_data = null, json_filepaths = null) => {
    assert(typeof migrate_data === "object", "Invalid migrate_data...");
    assert(typeof json_filepaths === "object", "Invalid json_filepaths...");

    if (Object.values(migrate_data).every(prop => prop === false)) {
        appendToLogFile(log_filepath, "No data to migrate...");
        return;
    }

    if (migrate_data.issues) {
        assert(migrate_data.customFields, "Cannot migrate issues without migrating custom fields...");
    }

    let index = 0;

    if (migrate_data.customFields) {
        const promise_cfr = retrieveAndWriteCustomFields(url, email, api_token, json_filepaths[index++], total_filepath)
            .then(() => {
                appendToLogFile(log_filepath, "Custom fields retrieved successfully...");
                if (migrate_data.issues) {
                    return retrieveAndWriteIssues(url, email, api_token, p_key, json_filepaths[index++], total_filepath, log_filepath, "All")
                }
                return;
            });

        const promise_wfr = promise_cfr.then(() => {
            if (migrate_data.issues) {
                appendToLogFile(log_filepath, "Issues retrieved succesfully...");
            }

            if (migrate_data.workflows) {
                return retrieveAndWriteWorkflows(url, email, api_token, p_key, json_filepaths[index], total_filepath);
            }
            else {
                return;
            }
        });

        if (migrate_data.workflows) {
            promise_wfr.then(() => {
                appendToLogFile(log_filepath, "Workflows retrieved successfully...");
            });
        }
    }
    else if (migrate_data.workflows) {
        retrieveAndWriteWorkflows(url, email, api_token, p_key, json_filepaths[index], total_filepath)
            .then(() => {
                appendToLogFile(log_filepath, "Workflows retrieved successfully...");
            });
    }
    // try {
    //     assert(migrate_data.every(prop => prop === true), "Not all data is migrated...");
    //     let index = 0;
    //     retrieveAndWriteCustomFields(url, email, api_token, json_filepaths[index], total_filepath)
    //         .then(() => {
    //             appendToLogFile(log_filepath, "Custom fields retrieved successfully...");
    //             index++;
    //             return retrieveAndWriteWorkflows(url, email, api_token, p_key, json_filepaths[index], total_filepath);
    //         })
    //         .then(() => {
    //             appendToLogFile(log_filepath, "Workflows retrieved successfully...");
    //             index++;
    //             return retrieveAndWriteIssues(url, email, api_token, p_key, json_filepaths[index], total_filepath, log_filepath, "All");
    //         })
    //         .then(() => {
    //             appendToLogFile(log_filepath, "Issues retrieved succesfully...");
    //         });
    // } catch (error) {
    //     assert("Not all data is migrated...");
    // }

}