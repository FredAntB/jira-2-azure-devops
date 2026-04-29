import { appendToLogFile } from '../utils/utils.js';
import { AzureDevOpsTests } from './AzureDevOpsTests.js';
import { ZephyrTests } from './ZephyrTests.js';
import fs from 'fs';


export class TestsMigration {

    constructor(jiraToken, jiraProject, azureToken, azureOrganization, azureProject, log_filepath, total_filepath) {
        this.jiraToken = jiraToken;
        this.jiraProject = jiraProject;
        this.azureToken = azureToken;
        this.azureOrganization = azureOrganization;
        this.azureProject = azureProject;
        this.log_filepath = log_filepath;
        this.total_filepath = total_filepath;
        this.azureHandler = new AzureDevOpsTests(azureToken, azureOrganization, azureProject);
        this.testPlanMapping = {};
        this.testCyclesMapping = {};

        // Null-check for Zephyr token: log a warning if absent so migrate* methods can return early
        if (!jiraToken) {
            this.log('Warning: Zephyr token is null or undefined. Test migration will be skipped.');
            this.zephyrHandler = null;
        } else {
            this.zephyrHandler = new ZephyrTests(jiraToken, jiraProject);
        }
    }

    async migrateTestPlans() {
        if (!this.zephyrHandler) {
            this.log('Skipping test plan migration: Zephyr token is not available.');
            return;
        }

        try {
            const testPlans = await this.zephyrHandler.extractField('testplans');

            const totalData = fs.readFileSync(this.total_filepath, 'utf-8');
            const data = JSON.parse(totalData);
            data.total += await this.zephyrHandler.getNumOf('testplans');
            fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');

            this.log('Migrating test plans');
            for (const testPlan of testPlans) {
                const testPlanData = {
                    name: testPlan.name,
                    description: testPlan.description
                };
                try {
                    this.log('Creating test plan:' + JSON.stringify(testPlan));
                    const createdTestPlan = await this.azureHandler.createTestPlan(testPlanData);
                    this.testItemCreated('plan', createdTestPlan.id);
                    this.testPlanMapping[(testPlan.id)] = createdTestPlan.id;

                    data.migrated += 1;
                    fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');
                } catch (error) {
                    this.log(`FAILED: test plan "${testPlan.name || testPlan.id}" - ${error.message}`);
                    this.incrementFailedCount(data);
                    // Continue to the next test plan — do not abort the loop
                }
            }
        } catch (error) {
            this.log('Failed to obtain Zephyr Jira Test Plans');
            console.error('Failed to create test plans', error.message);
        }
    }

    async migrateTestSuites() {
        if (!this.zephyrHandler) {
            this.log('Skipping test suite migration: Zephyr token is not available.');
            return;
        }

        try {
            const testCycles = await this.zephyrHandler.extractField('testcycles');
            this.log('Migrating test cycles (test suites)');

            const totalData = fs.readFileSync(this.total_filepath, 'utf-8');
            const data = JSON.parse(totalData);
            data.total += await this.zephyrHandler.getNumOf('testcycles');
            fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');

            for (const testCycle of testCycles) {
                const testPlanId = this.testPlanMapping[testCycle.testPlanIds[0]];
                const testCycleData = {
                    name: testCycle.name,
                    type: testCycle.suiteType,
                    planId: testPlanId,
                    parentSuiteId: testPlanId + 1
                };

                try {
                    this.log('Creating test suite:' + JSON.stringify(testCycleData));
                    const createdTestSuite = await this.azureHandler.createTestSuite(testCycleData);
                    this.testItemCreated('suite', createdTestSuite.id);
                    this.testCyclesMapping[(testCycle.id)] = createdTestSuite.id;

                    data.migrated += 1;
                    fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');
                } catch (error) {
                    this.log(`FAILED: test suite "${testCycle.name || testCycle.id}" - ${error.message}`);
                    this.incrementFailedCount(data);
                    // Continue to the next test suite — do not abort the loop
                }
            }
        } catch (error) {
            this.log('Failed to obtain Zephyr Jira Test Cycles');
            console.error('Failed to create test suites', error.message);
        }
    }

    async migrateTestCases() {
        if (!this.zephyrHandler) {
            this.log('Skipping test case migration: Zephyr token is not available.');
            return;
        }

        try {
            const testCases = await this.zephyrHandler.fetchAndTransformTestCases();

            const totalData = fs.readFileSync(this.total_filepath, 'utf-8');
            const data = JSON.parse(totalData);
            data.total += await this.zephyrHandler.getNumOf('testcases');
            fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');

            // Build a mapping of testCaseId → testSuiteId for post-creation mapping
            const testCaseToSuiteMapping = {};

            for (const testcase of testCases) {
                const testcaseObj = {
                    name: testcase[0].value,
                    description: testcase[1].value,
                    priority: testcase[2].value
                };
                try {
                    this.log('Creating test case:' + JSON.stringify(testcaseObj));
                    const createdTestCase = await this.azureHandler.createTestCase(testcase);
                    this.testItemCreated('Test Case', createdTestCase.id);

                    // Record the mapping from test case to its suite using the testCycleId
                    if (testcase.testCycleId && this.testCyclesMapping[testcase.testCycleId]) {
                        testCaseToSuiteMapping[createdTestCase.id] = this.testCyclesMapping[testcase.testCycleId];
                    }

                    data.migrated += 1;
                    fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');
                } catch (error) {
                    this.log(`FAILED: test case "${testcaseObj.name}" - ${error.message}`);
                    this.incrementFailedCount(data);
                    // Continue to the next test case — do not abort the loop
                }
            }

            // Map each created test case to its corresponding test suite
            for (const [testCaseId, testSuiteId] of Object.entries(testCaseToSuiteMapping)) {
                try {
                    // Resolve the test plan ID from the suite mapping
                    const testPlanId = Object.values(this.testPlanMapping)[0]; // Use first plan as fallback
                    await this.azureHandler.mapTestcaseToTestSuite(testPlanId, testSuiteId, testCaseId);
                    this.log(`Mapped test case ${testCaseId} to suite ${testSuiteId}`);
                } catch (error) {
                    this.log(`FAILED: mapping test case ${testCaseId} to suite ${testSuiteId} - ${error.message}`);
                    // Continue mapping remaining test cases — do not abort the loop
                }
            }

        } catch (error) {
            this.log('Failed to obtain Zephyr Jira Test Cases');
            console.error('Failed to create test cases', error.message);
        }
    }

    /**
     * Increments the `failed` counter in total.json using the already-parsed data object,
     * then writes it back to disk.
     */
    incrementFailedCount(data) {
        try {
            data.failed = (data.failed || 0) + 1;
            fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');
        } catch (err) {
            console.error(`Failed to update failed count in total.json: ${err.message}`);
        }
    }

    testItemCreated(type, id) {
        this.log(`New test item created: { type: ${type}, id: ${id} }`);
    }

    log(content) {
        appendToLogFile(this.log_filepath, content);
    }
}
