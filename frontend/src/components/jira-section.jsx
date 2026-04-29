import { useState, useEffect } from "react";
import "./jira-section.css";
import "../styles/global.css";
import axios from "axios";
import { getTokens, postTokens } from "../../utils/api";

function JiraSection() {
  // Estados para almacenar los valores ingresados
  const [apiToken, setApiToken] = useState("");
  const [email, setEmail] = useState("");
  const [url, setUrl] = useState("");

  // Load user tokens on component mount
  useEffect(() => {
    const fetchTokens = async () => {
      const username = localStorage.getItem("username");
      if (!username) {
        console.log("User is not logged in.");
        return;
      }

      const tokens = localStorage.getItem("tokens");
      if (tokens) {
        // Find the Jira token
        const parsedTokens = JSON.parse(tokens);
        const jiraToken = parsedTokens.find(
          (token) => token.Application === "Jira"
        );
        if (jiraToken) {
          // Populate fields with the Jira token data
          setApiToken(jiraToken.Number);
          setEmail(jiraToken.email);
          setUrl(jiraToken.url);
        }
        return;
      }

      try {
        // Fetch tokens from the backend
        const response = await getTokens(username);

        if (response.success && response.tokens) {
          // Find the Jira token
          const jiraToken = response.tokens.find(
            (token) => token.Application === "Jira"
          );
          if (jiraToken) {
            // Populate fields with the Jira token data
            setApiToken(jiraToken.Number);
            setEmail(jiraToken.email);
            setUrl(jiraToken.url);
          }
        }
      } catch (error) {
        console.error("Error fetching tokens:", error);
      }
    };

    fetchTokens();
  }); // Empty array [] ensures this only runs once on mount

  const handleSaveToken = async () => {
    const username = localStorage.getItem("username");
    if (!apiToken || !username) {
      alert("API Token is missing or the user is not logged in.");
      return;
    }

    try {
      const data = await postTokens(
        username,
        apiToken,
        "Jira",
        email || null,
        url || null
      );

      if (data[0]) {
        alert(data[1] || "Token saved successfully!");
      } else {
        alert("Error: " + (data[1] || "Unknown error"));
      }
    } catch (error) {
      console.error("Error while saving credentials:", error);
      alert(
        "Unable to save your credentials: " +
          (error.response?.data?.message || error.message)
      );
    }
  };

  const deleteToken = async () => {
    const username = localStorage.getItem("username");
    if (!username) {
      alert("The user has not logged in.");
      return;
    }

    try {
      // Fetch the Jira token ID for the user
      const response = await axios.get("http://localhost:4000/api/tokens", {
        params: { username },
      });

      console.log("Backend response in deleteToken:", response.data); // Debug

      if (response.data.success && response.data.tokens) {
        // Find the Jira token
        const jiraToken = response.data.tokens.find(
          (token) => token.Application === "Jira"
        );

        console.log("Token found in deleteToken:", jiraToken); // Debug

        if (!jiraToken || !jiraToken.id) {
          alert("No Jira token found for this user.");
          return;
        }

        console.log("Attempting to delete token with ID:", jiraToken.id); // Debug

        // Send request to delete the token
        const deleteResponse = await axios.delete(
          "http://localhost:4000/api/delete-token",
          {
            data: { username, tokenId: jiraToken.id, splitToken: false },
          }
        );

        if (deleteResponse.data.success) {
          alert("Token deleted successfully!");
          // Clear the form fields
          setApiToken("");
          setEmail("");
          setUrl("");
        } else {
          alert("Error: " + deleteResponse.data.message);
        }
      }
    } catch (error) {
      console.error("Error deleting token:", error);
      alert(
        "Unable to delete the token: " +
          (error.response?.data?.message || error.message)
      );
    }
  };

  return (
    <div className="jira-section">
      <h2>Jira</h2>
      <div className="input-group">
        <label htmlFor="api-jira-token">API Token:</label>
        <input
          type="password"
          id="api-jira-token"
          placeholder="Enter your Jira API token"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
        />

        <label htmlFor="email">Email:</label>
        <input
          type="email"
          id="email"
          placeholder="Enter the email you use in Jira"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        <label htmlFor="url">URL:</label>
        <input
          type="url"
          id="url"
          placeholder="Enter the URL of your Jira instance"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>
      <button className="save-button" onClick={handleSaveToken}>
        Save Jira Token
      </button>
      <button className="save-button" onClick={deleteToken}>
        Delete Jira Token
      </button>
    </div>
  );
}

export default JiraSection;
