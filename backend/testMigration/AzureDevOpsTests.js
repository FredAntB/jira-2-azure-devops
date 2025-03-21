import axios from 'axios';
import fs from "fs";


export class AzureDevOpsTests {
    constructor(pat, organization, project) {
        this.pat = pat;
        this.organization = organization;
        this.project = project;
        this.validateProjectInfo();
    }

    createAuthHeaders(contentType) {
        const auth = Buffer.from(`:${this.pat}`).toString('base64');
        return {
            'Content-Type': contentType || 'application/json',
            'Authorization': `Basic ${auth}`
        };
    }

    validateProjectInfo() {
        if (!this.pat) throw new Error('Personal Access Token is required');
        if (!this.organization) throw new Error('Organization is required');
        if (!this.project) throw new Error('Project is required');
    }

    // Utility
    async makeApiRequest(url, data, headers) {
        try {
            const response = await axios.post(url, data, { headers: headers });
            return response.data;
        } catch (error) {
            fs.writeFileSync('data.json', JSON.stringify(data, null, 2));
            fs.writeFileSync('error.json', JSON.stringify(error.response.data, null, 2));
            console.error('API Request Failed:', error.message);
            throw error;
        }
    }

    async  createTestPlan(testPlanData) {
      
      console.log('Creating test plan:', testPlanData);
      // Validate inputs
      if (!testPlanData.name || testPlanData.name === '') {
        throw new Error('Test plan name is required');
      }
      
      // Prepare request
      const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/testplan/plans?api-version=5.0`;
 
      try {
        return await this.makeApiRequest(url, testPlanData, this.createAuthHeaders('application/json'));
      } catch (error) {
        console.error('Failed to create test plan:', error.message);
        throw error;
      }
    }

    
    async createTestSuite(suiteData) {
        console.log('Creating test suite:', suiteData);
        if (!suiteData.planId) throw new Error('Plan ID is required');
        if (!suiteData.name) throw new Error('Suite name is required');
        if (!suiteData.type) throw new Error('Suite type is required');

        const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/testplan/Plans/${suiteData.planId}/suites?api-version=7.1`;
        
        const payload = {
            name: suiteData.name,
            suiteType: suiteData.type,
            parentSuite: { id: (suiteData.parentSuiteId || null)}
        };

        switch (suiteData.type) {
            case 'staticTestSuite':
                break;
            case 'requirementTestSuite':
                if (!suiteData.requirementId) throw new Error('Requirement ID is required for requirementTestSuite');
                payload.requirementId = suiteData.requirementId;
                break;
            case 'queryBasedSuite':
                if (!suiteData.queryString) throw new Error('Query string is required for queryBasedSuite');
                payload.queryString = suiteData.queryString;
                break;
            default:
                throw new Error('Invalid suite type');
        }

        try {
           
            return await this.makeApiRequest(url, payload, this.createAuthHeaders('application/json'));
        } catch (error) {
            console.error('Failed to create test suite');
            throw error;
        }
    }

    // Create Test Case
    async createTestCase(testCaseData) {
        /*
        if (!testCaseData.opp) 
            testCaseData.opp = 'add';
        if (!testCaseData.path)
            testCaseData.path =  '/fields/System.Title';

        if (!testCaseData.value) throw new Error('Test cases value is required');

        if (!testCaseSteps.opp)
            testCaseSteps.opp = 'add';
        if (!testCaseSteps.path)
            testCaseSteps.path = '/fields/Microsoft.VSTS.TCM.Steps';
s
        //if (!testCaseSteps.value) throw new Error('Test case steps are required');
        */
        const url =`https://dev.azure.com/${this.organization}/${this.project}/_apis/wit/workitems/$Test%20Case?api-version=7.1`;

        //const payload = [testCaseData, testCaseSteps];

        try {
            const result = await this.makeApiRequest(url, testCaseData, this.createAuthHeaders('application/json-patch+json'));
            console.log('Test Case Created:', result.id);
            return result;
        }
        catch (error) {
            console.error('Failed to create test case:', error.message);
            throw error;
        }    
    }

    
    //
    async  mapTestcaseToTestSuite(testPlanId, testSuiteId, testCaseIds) {
        const url = `https://dev.azure.com/${this.organization}/${this.project}/_apis/test/Plans/${testPlanId}/suites/${testSuiteId}/testcases/${testCaseIds}?api-version=7.1`; 
        try {
            const result = await this.makeApiRequest(url, {});
            console.log('Test Case Mapped:', result);
            return result;
        } catch (error) {
            console.error('Failed to map test case to test suite: aqui', error.message);
            throw error;
        }
    }
}

