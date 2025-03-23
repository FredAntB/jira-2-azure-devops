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
            console.error(`❌ Error al obtener los datos de ${endpoint}:`, error?.response?.data || error.message);
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
            description: plan.objective || "Sin descripción",
        }));
    }

    transformTestCycles(zephyrData) {
        return zephyrData.values.map(cycle => ({
            id: cycle.id,
            testPlanIds: cycle.links?.testPlans?.map(plan => plan.testPlanId) || [],
            name: cycle.name,
            description: cycle.objective || "Sin descripción",
            suiteType: "staticTestSuite",
        }));
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


    async fetchAndTransformTestCases() {
        const testCasesData = await this.fetchZephyrData(`${this.baseUrl}testcases`);
        if (!testCasesData || !testCasesData.values) {
            console.error('❌ No se pudieron obtener los test cases.');
            return;
        }

        const transformedTestCases = await Promise.all(testCasesData.values.map(async (testCase) => {
            const testStepsXml = await this.fetchTestSteps(testCase.key);
            const priority = await this.fetchNameFromFullUrl(testCase.priority.self);
            const issueIds = testCase.links.issues.map(issue => issue.issueId);
            const priority1 = this.convertJiraPriorityToAzure(priority);
            return [
                {
                    op: "add",
                    path: "/fields/System.Title",
                    value: testCase.name || "Sin título"
                },
                {
                    op: "add",
                    path: "/fields/System.Description",
                    value: testCase.objective || "Caso de prueba importado desde Zephyr"
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
