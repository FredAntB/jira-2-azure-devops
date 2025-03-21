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

  // Obtener los tokens del usuario al cargar el componente
  useEffect(() => {
    const fetchTokens = async () => {
      const username = localStorage.getItem("username");
      if (!username) {
        console.log("Usuario no ha iniciado sesión.");
        return;
      }

      const tokens = localStorage.getItem("tokens");
      if (tokens) {
        // Buscar el token de Jira
        const parsedTokens = JSON.parse(tokens);
        const jiraToken = parsedTokens.find((token) => token.Application === "Jira");
        if (jiraToken) {
          // Llenar los campos con los datos del token de Jira
          setApiToken(jiraToken.Number);
          setEmail(jiraToken.email);
          setUrl(jiraToken.url);
        }
        return;
      }

      try {
        // Hacer la solicitud para obtener los tokens
        const response = await getTokens(username);

        if (response.success && response.tokens) {
          // Buscar el token de Jira
          const jiraToken = response.tokens.find(
            (token) => token.Application === "Jira"
          );
          if (jiraToken) {
            // Llenar los campos con los datos del token de Jira
            setApiToken(jiraToken.Number);
            setEmail(jiraToken.email);
            setUrl(jiraToken.url);
          }
        }
      } catch (error) {
        console.error("Error al obtener los tokens:", error);
      }
    };

    fetchTokens();
  }, []); // El array vacío [] asegura que esto solo se ejecute una vez al montar el componente

  const handleSaveToken = async () => {
    const username = localStorage.getItem("username");
    if (!apiToken || !username) {
      alert("Falta ingresar el API Token o el usuario no ha iniciado sesión.");
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
      alert("El usuario no ha iniciado sesión.");
      return;
    }

    try {
      // Obtener el ID del token de Jira del usuario
      const response = await axios.get("http://localhost:4000/api/tokens", {
        params: { username },
      });

      console.log("Respuesta del backend en deleteToken:", response.data); // Debug

      if (response.data.success && response.data.tokens) {
        // Buscar el token de Jira
        const jiraToken = response.data.tokens.find(
          (token) => token.Application === "Jira"
        );

        console.log("Token encontrado en deleteToken:", jiraToken); // Debug

        if (!jiraToken || !jiraToken.id) {
          alert("No se encontró un token de Jira para este usuario.");
          return;
        }

        console.log("Intentando eliminar el token con ID:", jiraToken.id); // Debug

        // Enviar solicitud para eliminar el token
        const deleteResponse = await axios.delete(
          "http://localhost:4000/api/delete-token",
          {
            data: { username, tokenId: jiraToken.id },
          }
        );

        if (deleteResponse.data.success) {
          alert("Token eliminado correctamente!");
          // Limpiar los campos del formulario
          setApiToken("");
          setEmail("");
          setUrl("");
        } else {
          alert("Error: " + deleteResponse.data.message);
        }
      }
    } catch (error) {
      console.error("Error al eliminar el token:", error);
      alert(
        "No se pudo eliminar el token: " +
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
