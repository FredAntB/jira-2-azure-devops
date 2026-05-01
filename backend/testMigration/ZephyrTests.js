import axios from "axios";

export class ZephyrTests {

    constructor(token, project) {
        this.token = token;
        this.projectKey = project;
        this.baseUrl = 'https://api.zephyrscale.smartbear.com/v2/'
    }

    async fetchZephyrData(fullUrl) {

        try {
            const response = await axios.get(fullUrl, {
                headers: {
                    Authorization: `Bearer ${this.token}`
                },
                params: {
                    projectKey: this.projectKey,
                }
            });

            return response.data;
        } catch (error) {
            console.error(`❌ Error fetching data from ${this.baseUrl}:`, error?.response?.data || error.message);
            return null;
        }
    }

    transformDataForAzure(field, zephyrData) {
        if (field === 'testplans') {
            return this.transformTestPlans(zephyrData);
        } else if (field === 'testcycles') {
            return this.transformTestCycles(zephyrData);
        }
        return zephyrData;
    }

    transformTestPlans(zephyrData) {
        return zephyrData.values.map(plan => ({
            id: plan.id,
            name: plan.name,
            description: plan.objective || "No description",
        }));
    }

    transformTestCycles(zephyrData) {
        return zephyrData.values.map(cycle => {
            // Zephyr Scale API returns testPlan as a single object { id, self },
            // not an array. Support both shapes defensively.
            let testPlanIds = [];
            if (cycle.links?.testPlans) {
                // Array shape (older API versions)
                testPlanIds = cycle.links.testPlans.map(plan => plan.testPlanId ?? plan.id);
            } else if (cycle.links?.testPlan) {
                // Single-object shape (current API)
                const tp = cycle.links.testPlan;
                const id = tp.testPlanId ?? tp.id;
                if (id) testPlanIds = [id];
            }

            return {
                id: cycle.id,
                key: cycle.key,
                testPlanIds,
                name: cycle.name,
                description: cycle.objective || "No description",
                suiteType: "staticTestSuite",
            };
        });
    }

    async extractField(endpoint) {
        const zephyrData = await this.fetchZephyrData(`${this.baseUrl}${endpoint}`);
        if (zephyrData) {
            var aux = this.transformDataForAzure(endpoint, zephyrData);
            //console.log(aux);
            return aux;
        }
    }

    async fetchTestSteps(testCaseKey) {
        const endpoint = `${this.baseUrl}testcases/${testCaseKey}/teststeps`;
        const testStepsData = await this.fetchZephyrData(endpoint);

        if (!testStepsData || !testStepsData.values) {
            return '';
        }

        const stepsXml = testStepsData.values.map((step, index) => {
            return `<step id=\"${index + 1}\" type=\"ActionStep\"> <parameterizedString isformatted=\"true\">${step.inline.description}</parameterizedString> <parameterizedString isformatted=\"true\">${step.inline.expectedResult}</parameterizedString> </step>`;
        }).join('');

        return `<steps id=\"0\" last=\"${testStepsData.total}\"> ${stepsXml}</steps>`;
    }

    async fetchNameFromFullUrl(fullUrl) {
        const testData = await this.fetchZephyrData(fullUrl);
        //console.log(testData);
        return testData && testData.name ? testData.name : '';
    }


    /**
     * Fetch all test case keys assigned to a given test cycle.
     * Tries multiple strategies since the Zephyr Scale v2 API has no single
     * reliable endpoint for cycle→testCase membership.
     */
    async fetchTestCaseKeysForCycle(cycleKey, cycleId) {
        // Strategy 1: filter testcases by testCycleKey (key string e.g. "SCRUM-R1")
        try {
            const response = await axios.get(`${this.baseUrl}testcases`, {
                headers: { Authorization: `Bearer ${this.token}` },
                params: { projectKey: this.projectKey, testCycleKey: cycleKey }
            });
            const data = response.data;
            if (data?.values?.length > 0) {
                console.log(`[Zephyr] Strategy 1 (testCycleKey=${cycleKey}): found ${data.values.length} test case(s)`);
                return data.values.map(tc => tc.key).filter(Boolean);
            }
        } catch (error) {
            console.error(`❌ Strategy 1 failed for cycle ${cycleKey}:`, error?.response?.data || error.message);
        }

        // Strategy 2: filter testexecutions by testCycleKey (covers cases where test cases
        // were added to the cycle via the UI, which creates a "Not Executed" execution record)
        try {
            const response = await axios.get(`${this.baseUrl}testexecutions`, {
                headers: { Authorization: `Bearer ${this.token}` },
                params: { projectKey: this.projectKey, testCycleKey: cycleKey }
            });
            const data = response.data;
            if (data?.values?.length > 0) {
                console.log(`[Zephyr] Strategy 2 (testexecutions testCycleKey=${cycleKey}): found ${data.values.length} execution(s)`);
                return [...new Set(data.values.map(exec => exec.testCase?.key).filter(Boolean))];
            }
        } catch (error) {
            console.error(`❌ Strategy 2 failed for cycle ${cycleKey}:`, error?.response?.data || error.message);
        }

        // Strategy 3: filter testexecutions by numeric cycle ID
        if (cycleId) {
            try {
                const response = await axios.get(`${this.baseUrl}testexecutions`, {
                    headers: { Authorization: `Bearer ${this.token}` },
                    params: { projectKey: this.projectKey, testCycle: cycleId }
                });
                const data = response.data;
                if (data?.values?.length > 0) {
                    console.log(`[Zephyr] Strategy 3 (testexecutions testCycle=${cycleId}): found ${data.values.length} execution(s)`);
                    return [...new Set(data.values.map(exec => exec.testCase?.key).filter(Boolean))];
                }
            } catch (error) {
                console.error(`❌ Strategy 3 failed for cycle ${cycleId}:`, error?.response?.data || error.message);
            }
        }

        return [];
    }

    async fetchAndTransformTestCases() {
        const testCasesData = await this.fetchZephyrData(`${this.baseUrl}testcases`);
        if (!testCasesData || !testCasesData.values) {
            console.error('❌ Failed to retrieve test cases from Zephyr.');
            return [];
        }

        const transformedTestCases = await Promise.all(testCasesData.values.map(async (testCase) => {
            const testStepsXml = await this.fetchTestSteps(testCase.key);
            const priority = await this.fetchNameFromFullUrl(testCase.priority.self);
            const issueIds = testCase.links.issues.map(issue => issue.issueId);
            const priority1 = this.convertJiraPriorityToAzure(priority);

            // Extract the testCycleId from the Zephyr test case links
            const testCycleId = testCase.links?.testCycles?.[0]?.testCycleId ?? null;
            console.log(`[Zephyr] Test case ${testCase.key} links:`, JSON.stringify(testCase.links));

            const patchOps = [
                {
                    op: "add",
                    path: "/fields/System.Title",
                    value: testCase.name || "Untitled test case"
                },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: testCase.objective || "Test case imported from Zephyr"
                },
                {
                    "op": "add",
                    "path": "/fields/Microsoft.VSTS.Common.Priority",
                    "value": priority1
                },
                {
                    op: "add",
                    path: "/fields/Microsoft.VSTS.TCM.Steps",
                    value: testStepsXml || ""
                },
                {
                    op: "add",
                    path: "/fields/System.Tags",
                    value: "Importado;Zephyr"
                }
            ];

            return { patchOps, testCycleId, zephyrKey: testCase.key };
        }));

        return transformedTestCases;
    }
    convertJiraPriorityToAzure(jiraPriority) {
        const priorityMapping = {
            "Highest": 1,
            "High": 2,
            "Medium": 3,
            "Low": 4,
            "Lowest": 5
        };

        return priorityMapping[jiraPriority] || 3;
    }

    async getNumOf(field) {
        const testData = await this.fetchZephyrData(`${this.baseUrl}${field}`);
        //console.log(Num de ${field}: ${testData.total});
        return testData && testData.total ? testData.total : 0;
    }
}
