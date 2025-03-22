import { useState, useEffect } from "react";
import "./login.css";
import loginImage from "../assets/login-image.jpg";
import { useNavigate } from "react-router-dom";
import {
  getJiraProjects,
  getAzureProjects,
  getTokens,
  postLoginCredentials,
} from "../../utils/api";

function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    document.body.classList.add("login-page");
    return () => {
      document.body.classList.remove("login-page");
    };
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const data = await postLoginCredentials(username, password);

      console.dir(data, { depth: null });

      const success = data[0];

      if (!success) {
        setError(data[1]);
        throw new Error(data[1]);
      }

      alert(`Welcome ${data[1]}`);

      // Store username in localStorage
      localStorage.setItem("username", username);

      try {
        // Fetch tokens after successful login
        const tokensResponse = await getTokens(username);

        if (tokensResponse.success) {
          localStorage.setItem("tokens", JSON.stringify(tokensResponse.tokens));

          // Fetch Jira projects
          const jiraProjectsData = await getJiraProjects();
          if (jiraProjectsData.projects.length > 0) {
            localStorage.setItem(
              "jira_projects",
              JSON.stringify(jiraProjectsData.projects)
            );
          }

          // Fetch Azure projects
          const azureProjectsData = await getAzureProjects();
          if (azureProjectsData.projects.length > 0) {
            localStorage.setItem(
              "azure_projects",
              JSON.stringify(azureProjectsData.projects)
            );
          }
        }
      } catch (err) {
        console.log(err);
      }

      navigate("/migrate");
    } catch (err) {
      console.error("Error en el login:", err);
      setError(err.message || "Error en el login");
    }
  };

  return (
    <div className="login-container">
      <div className="login-header">
        <img
          src={loginImage}
          alt="UPB Migration Tool"
          className="login-image"
        />
        <h1>UPB Migration Tool</h1>
      </div>
      <div className="login-box">
        <h2>Log in</h2>
        {error && (
          <p className="error-message" style={{ color: "black" }}>
            {error}
          </p>
        )}
        <form onSubmit={handleLogin}>
          <div className="input-group">
            <input
              type="text"
              id="username"
              placeholder="Enter your email/username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <input
              type="password"
              id="password"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="login-button">
            Entrar
          </button>
        </form>
        <p onClick={() => navigate("/")}> Need to create an account </p>
      </div>
    </div>
  );
}

export default Login;
