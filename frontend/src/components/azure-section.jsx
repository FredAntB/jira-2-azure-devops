import { useState, useEffect } from "react"; // Importa useEffect
import axios from "axios";
import "./azure-section.css";
import "../styles/global.css";
import { getTokens, postTokens } from "../../utils/api";

function AzureSection() {
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
        // Find the Azure token
        const parsedTokens = JSON.parse(tokens);
        const azureToken = parsedTokens.find(
          (token) => token.Application === "Azure Devops"
        );
        if (azureToken) {
          // Populate fields with the Azure token data
          setApiToken(azureToken.Number);
          setEmail(azureToken.email);
          setUrl(azureToken.url);
        }
        return;
      }

      try {
        // Fetch tokens from the backend
        const response = await getTokens(username);

        if (response.success && response.tokens) {
          // Find the Azure token
          const azureToken = response.tokens.find(
            (token) => token.Application === "Azure Devops"
          );
          if (azureToken) {
            // Populate fields with the Azure token data
            setApiToken(azureToken.Number);
            setEmail(azureToken.email);
            setUrl(azureToken.url);
          }
        }
      } catch (error) {
        console.error("Error fetching tokens:", error);
      }
    };

    fetchTokens();
  }, []); // Empty array [] ensures this only runs once on mount

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
        "Azure Devops",
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
      alert("The user is not logged in.");
      return;
    }

    try {
      // Fetch the Azure token ID for the user
      const response = await axios.get("http://localhost:4000/api/tokens", {
        params: { username },
      });

      console.log("Backend response in deleteToken:", response.data); // Debug

      if (response.data.success && response.data.tokens) {
        // Find the Azure token
        const azureToken = response.data.tokens.find(
          (token) => token.Application === "Azure Devops"
        );

        console.log("Token found in deleteToken:", azureToken); // Debug

        if (!azureToken || !azureToken.id) {
          alert("No Azure token found for this user.");
          return;
        }

        console.log("Attempting to delete token with ID:", azureToken.id); // Debug

        // Send request to delete the token
        const deleteResponse = await axios.delete(
          "http://localhost:4000/api/delete-token",
          {
            data: { username, tokenId: azureToken.id, splitToken: false },
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
    <div className="azure-section">
      <h2>Azure DevOps</h2>
      <div className="input-group">
        <label htmlFor="api-token-azure">API Token:</label>
        <input
          type="password"
          id="api-token-azure"
          placeholder="Enter your Azure Token"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </div>
      <button className="save-button" onClick={handleSaveToken}>
        Save Azure Token
      </button>
      <button className="save-button" onClick={deleteToken}>
        Delete Azure Token
      </button>
    </div>
  );
}

export default AzureSection;
