import { useState, useEffect } from "react";
import "./zephyr-section.css";
import "../styles/global.css";
import { getTokens, postTokens, deleteToken as deleteTokenApi } from "../../utils/api";

function ZephyrSection() {
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
        // Find the Zephyr token
        const parsedTokens = JSON.parse(tokens);
        const zephyrToken = parsedTokens.find(
          (token) => token.Application === "Zephyr"
        );
        if (zephyrToken) {
          // Populate fields with the Zephyr token data
          setApiToken(zephyrToken.Number);
          setEmail(zephyrToken.email);
          setUrl(zephyrToken.url);
        }
        return;
      }

      try {
        // Fetch tokens from the backend
        const response = await getTokens(username);

        if (response.success && response.tokens) {
          // Find the Zephyr token
          const zephyrToken = response.tokens.find(
            (token) => token.Application === "Zephyr"
          );
          if (zephyrToken) {
            // Populate fields with the Zephyr token data
            setApiToken(zephyrToken.Number);
            setEmail(zephyrToken.email);
            setUrl(zephyrToken.url);
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
        "Zephyr",
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
      const data = await deleteTokenApi(username, "Zephyr");
      if (data.success) {
        alert("Token deleted successfully!");
        setApiToken("");
        setEmail("");
        setUrl("");
      } else {
        alert("Error: " + data.message);
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
    <div className="zephyr-section">
      <h2>Zephyr</h2>
      <div className="input-group">
        <label htmlFor="api-token">API Token:</label>
        <input
          type="password"
          id="api-token"
          placeholder="Enter your Zephyr API token"
          value={apiToken}
          onChange={(e) => setApiToken(e.target.value)}
        />
      </div>
      <button className="save-button" onClick={handleSaveToken}>
        Save Zephyr Token
      </button>
      <button className="save-button" onClick={deleteToken}>
        Delete Zephyr Token
      </button>
    </div>
  );
}

export default ZephyrSection;
