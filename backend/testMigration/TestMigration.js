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
        // Maps Azure suite ID → Azure plan ID, populated during migrateTestSuites
        this.testSuiteToPlanMapping = {};
        // Maps Zephyr plan ID → Azure root suite ID (returned by createTestPlan)
        this.testPlanRootSuiteMapping = {};
        // Maps Zephyr cycle ID → cycle key (e.g. "SCRUM-R1"), populated during migrateTestSuites
        this.zephyrCycleKeyById = {};
        // Maps Zephyr cycle key → cycle ID (reverse lookup)
        this.zephyrCycleIdByKey = {};

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
                    // Store the root suite ID returned by Azure — used as parentSuiteId for child suites
                    if (createdTestPlan.rootSuite?.id) {
                        this.testPlanRootSuiteMapping[createdTestPlan.id] = createdTestPlan.rootSuite.id;
                    }

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
                const zephyrPlanId = testCycle.testPlanIds?.[0];
                const testPlanId = zephyrPlanId ? this.testPlanMapping[zephyrPlanId] : undefined;

                if (!testPlanId) {
                    this.log(`SKIPPED: test suite "${testCycle.name}" — no matching Azure test plan found (Zephyr plan ID: ${zephyrPlanId ?? 'none'})`);
                    this.incrementFailedCount(data);
                    continue;
                }

                // Use the root suite ID returned by Azure when the plan was created.
                // Falling back to planId + 1 is fragile; the root suite ID is the correct parent.
                const rootSuiteId = this.testPlanRootSuiteMapping[testPlanId] || (testPlanId + 1);

                const testCycleData = {
                    name: testCycle.name,
                    type: 'staticTestSuite',
                    planId: testPlanId,
                    parentSuiteId: rootSuiteId
                };

                try {
                    this.log('Creating test suite:' + JSON.stringify(testCycleData));
                    const createdTestSuite = await this.azureHandler.createTestSuite(testCycleData);
                    this.testItemCreated('suite', createdTestSuite.id);
                    this.testCyclesMapping[(testCycle.id)] = createdTestSuite.id;
                    this.testSuiteToPlanMapping[createdTestSuite.id] = testPlanId;
                    // Store cycle key ↔ cycle ID for execution-based test case lookup
                    if (testCycle.key) {
                        this.zephyrCycleKeyById[testCycle.id] = testCycle.key;
                        this.zephyrCycleIdByKey[testCycle.key] = testCycle.id;
                    }

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

            // Build a cycle-key → [testCase keys] map by querying executions per cycle.
            // This is the reliable way to get cycle membership — the test case list endpoint
            // does not consistently populate links.testCycles.
            const cycleKeyToTestCaseKeys = {};
            for (const [zephyrCycleId, azureSuiteId] of Object.entries(this.testCyclesMapping)) {
                const cycleKey = this.zephyrCycleKeyById?.[zephyrCycleId];
                if (!cycleKey) {
                    this.log(`Cycle ID ${zephyrCycleId} has no key stored — skipping execution lookup`);
                    continue;
                }
                const tcKeys = await this.zephyrHandler.fetchTestCaseKeysForCycle(cycleKey, zephyrCycleId);
                cycleKeyToTestCaseKeys[cycleKey] = tcKeys;
                this.log(`Cycle "${cycleKey}" (id: ${zephyrCycleId}) → suite ${azureSuiteId}: ${tcKeys.length} test case(s)${tcKeys.length > 0 ? ': ' + tcKeys.join(', ') : ''}`);
            }

            // Build: Zephyr testCase key → [Azure suite IDs] (one-to-many: a test case can
            // belong to multiple cycles, so collect ALL suite IDs for each test case key)
            const testCaseKeyToSuiteIds = {};
            for (const [cycleKey, tcKeys] of Object.entries(cycleKeyToTestCaseKeys)) {
                const zephyrCycleId = this.zephyrCycleIdByKey?.[cycleKey];
                const azureSuiteId = zephyrCycleId ? this.testCyclesMapping[zephyrCycleId] : undefined;
                if (!azureSuiteId) continue;
                for (const tcKey of tcKeys) {
                    if (!testCaseKeyToSuiteIds[tcKey]) testCaseKeyToSuiteIds[tcKey] = [];
                    if (!testCaseKeyToSuiteIds[tcKey].includes(azureSuiteId)) {
                        testCaseKeyToSuiteIds[tcKey].push(azureSuiteId);
                    }
                }
            }

            // Map: Azure work item ID → [Azure suite IDs] (populated during creation below)
            const testCaseToSuiteIds = {};

            for (const testcase of testCases) {
                const testcaseObj = {
                    name: testcase.patchOps[0].value,
                    description: testcase.patchOps[1].value,
                    priority: testcase.patchOps[2].value
                };
                try {
                    this.log('Creating test case:' + JSON.stringify(testcaseObj));
                    const createdTestCase = await this.azureHandler.createTestCase(testcase.patchOps);
                    this.testItemCreated('Test Case', createdTestCase.id);

                    // Collect all suites this test case belongs to
                    const suiteIdsFromCycle = testcase.zephyrKey
                        ? (testCaseKeyToSuiteIds[testcase.zephyrKey] || [])
                        : [];

                    // Fallback: legacy testCycleId link
                    const suiteIdFromLink = testcase.testCycleId
                        ? this.testCyclesMapping[testcase.testCycleId]
                        : undefined;

                    const allSuiteIds = [...new Set([
                        ...suiteIdsFromCycle,
                        ...(suiteIdFromLink ? [suiteIdFromLink] : [])
                    ])];

                    if (allSuiteIds.length > 0) {
                        testCaseToSuiteIds[createdTestCase.id] = allSuiteIds;
                    }

                    data.migrated += 1;
                    fs.writeFileSync(this.total_filepath, JSON.stringify(data, null, 2), 'utf-8');
                } catch (error) {
                    this.log(`FAILED: test case "${testcaseObj.name}" - ${error.message}`);
                    this.incrementFailedCount(data);
                }
            }

            // Map each created test case to ALL its corresponding suites
            for (const [testCaseId, suiteIds] of Object.entries(testCaseToSuiteIds)) {
                for (const testSuiteId of suiteIds) {
                    try {
                        const testPlanId = this.testSuiteToPlanMapping[testSuiteId];
                        if (!testPlanId) {
                            this.log(`FAILED: cannot resolve test plan for suite ${testSuiteId} (test case ${testCaseId})`);
                            continue;
                        }
                        await this.azureHandler.mapTestcaseToTestSuite(testPlanId, testSuiteId, testCaseId);
                        this.log(`Mapped test case ${testCaseId} to suite ${testSuiteId} in plan ${testPlanId}`);
                    } catch (error) {
                        this.log(`FAILED: mapping test case ${testCaseId} to suite ${testSuiteId} - ${error.message}`);
                    }
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
