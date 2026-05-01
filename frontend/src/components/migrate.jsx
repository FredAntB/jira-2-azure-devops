import { useState, useEffect } from "react";
import "./migrate.css";
import "../styles/global.css";
import imageMigrate from "../assets/migrate-image.png";
import { startMigration, getJiraProjects, getAzureProjects, refreshJiraProjects, refreshAzureProjects } from "../../utils/api";
import { useNavigate } from "react-router-dom";

const Migrate = () => {
  const [jiraProject, setJiraProject] = useState("");
  const [azureProject, setAzureProject] = useState("option1");
  const [advancedOptions, setAdvancedOptions] = useState({
    customFields: false,
    issues: false,
    workflows: false,
  });

  const [showAdvancedOptions, setShowAdvancedOptions] = useState(false);
  const [migrationStatus, setMigrationStatus] = useState(null);
  const [jiraRefreshing, setJiraRefreshing] = useState(false);
  const [azureRefreshing, setAzureRefreshing] = useState(false);
  const navigate = useNavigate();

  const [jiraProjects, setJiraProjects] = useState([]);
  const [azureProjects, setAzureProjects] = useState([]);

  useEffect(() => {
    async function retrieveProjects() {
      const local_projects = localStorage.getItem("projects");

      if (local_projects) {
        const parsedProjects = JSON.parse(local_projects);
        setJiraProjects(parsedProjects.filter((project) => project.key));
        setAzureProjects(
          parsedProjects.filter((project) => project.organization)
        );

        const firstJira = parsedProjects.filter((project) => project.key)[0];
        if (firstJira) setJiraProject(firstJira.key);

        const azure_p = parsedProjects.filter(
          (project) => project.organization
        )[0];
        if (azure_p) setAzureProject(`${azure_p.organization}/${azure_p.project}`);
        return;
      }

      const data_jira = await getJiraProjects();
      setJiraProjects(data_jira.projects);
      if (data_jira.projects.length > 0) {
        setJiraProject(data_jira.projects[0].key);
      }

      const data_azure = await getAzureProjects();
      setAzureProjects(data_azure.projects);
      if (data_azure.projects.length > 0) {
        const azure_p = data_azure.projects[0];
        setAzureProject(`${azure_p.organization}/${azure_p.project}`);
      }
    }
    retrieveProjects();
  }, []);

  const handleRefreshJira = async () => {
    setJiraRefreshing(true);
    try {
      const data = await refreshJiraProjects();
      setJiraProjects(data.projects);
      if (data.projects.length > 0) {
        setJiraProject(data.projects[0].key);
      }
    } catch (error) {
      console.error("Error refreshing Jira projects:", error);
    } finally {
      setJiraRefreshing(false);
    }
  };

  const handleRefreshAzure = async () => {
    setAzureRefreshing(true);
    try {
      const data = await refreshAzureProjects();
      setAzureProjects(data.projects);
      if (data.projects.length > 0) {
        const azure_p = data.projects[0];
        setAzureProject(`${azure_p.organization}/${azure_p.project}`);
      }
    } catch (error) {
      console.error("Error refreshing Azure projects:", error);
    } finally {
      setAzureRefreshing(false);
    }
  };

  const toggleAdvancedOptions = () => {
    setShowAdvancedOptions(!showAdvancedOptions);
  };

  const handleJiraProjectChange = (e) => {
    setJiraProject(e.target.value);
  };

  const handleAzureProjectChange = (e) => {
    setAzureProject(e.target.value);
  };

  const handleCheckboxChange = (e) => {
    const { name, checked } = e.target;
    setAdvancedOptions((prevOptions) => ({
      ...prevOptions,
      [name]: checked,
    }));
  };

  const handleMigrateClick = async () => {
    setMigrationStatus("Migrating...");
    try {
      const success = await startMigration(
        jiraProject,
        azureProject,
        showAdvancedOptions ? advancedOptions : null
      );
      if (success) {
        setMigrationStatus("Successful");

        navigate("/progress");
      } else {
        setMigrationStatus("Failed");
      }
    } catch (error) {
      console.error("Error during migration:", error);
      setMigrationStatus("Failed");
    }
  };

  return (
    <div className="layout">
      <div className="left-container">
        <img src={imageMigrate} />
      </div>

      <div className="right-container">
        <label className="migrate-text">Jira Project:</label>
        <div className="dropdown-row">
          <select
            className="combo-box"
            value={jiraProject}
            onChange={handleJiraProjectChange}
          >
            {jiraProjects.length === 0 ? (
              <option value="option1">
                Please register your Jira Credentials First
              </option>
            ) : (
              jiraProjects.map((project) => (
                <option key={project.id} value={project.key}>
                  {project.name}
                </option>
              ))
            )}
          </select>
          <button
            className="refresh-button"
            onClick={handleRefreshJira}
            disabled={jiraRefreshing}
            title="Refresh Jira projects"
          >
            {jiraRefreshing ? "⟳" : "↺"}
          </button>
        </div>

        <label className="migrate-text">Azure Project:</label>
        <div className="dropdown-row">
          <select
            className="combo-box"
            value={azureProject}
            onChange={handleAzureProjectChange}
          >
            {azureProjects.length === 0 ? (
              <option value="option1">
                Please register your Azure Devops Credentials First
              </option>
            ) : (
              azureProjects.map((project) => (
                <option
                  key={project.project}
                  value={`${project.organization}/${project.project}`}
                >
                  {`${project.organization}/${project.project}`}
                </option>
              ))
            )}
          </select>
          <button
            className="refresh-button"
            onClick={handleRefreshAzure}
            disabled={azureRefreshing}
            title="Refresh Azure DevOps projects"
          >
            {azureRefreshing ? "⟳" : "↺"}
          </button>
        </div>

        <div className="button-container">
          <button onClick={toggleAdvancedOptions} className="button-blue">
            {showAdvancedOptions ? "Hide" : "Advanced"}
          </button>
          <button onClick={handleMigrateClick} className="button-blue">
            Migrate
          </button>
        </div>

        {showAdvancedOptions && (
          <div
            className={`advanced-options ${showAdvancedOptions ? "show" : ""}`}
          >
            <label>
              <input
                type="checkbox"
                name="customFields"
                checked={advancedOptions.customFields}
                onChange={handleCheckboxChange}
              />
              Custom Fields
            </label>
            {!!advancedOptions.customFields && (
              <label>
                <input
                  type="checkbox"
                  name="issues"
                  checked={advancedOptions.issues}
                  onChange={handleCheckboxChange}
                />
                Issues
              </label>
            )}
            <label>
              <input
                type="checkbox"
                name="workflows"
                checked={advancedOptions.workflows}
                onChange={handleCheckboxChange}
              />
              Workflows
            </label>
          </div>
        )}

        {migrationStatus && (
          <p className="migration-status">{migrationStatus}</p>
        )}
      </div>
    </div>
  );
};

export default Migrate;
