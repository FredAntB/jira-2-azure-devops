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
        const azureToken = parsedTokens.find(
          (token) => token.Application === "Azure Devops"
        );
        if (azureToken) {
          // Llenar los campos con los datos del token de Jira
          setApiToken(azureToken.Number);
          setEmail(azureToken.email);
          setUrl(azureToken.url);
        }
        return;
      }

      try {
        // Hacer la solicitud para obtener los tokens
        const response = await getTokens(username);

        if (response.success && response.tokens) {
          // Buscar el token de Azure
          const azureToken = response.tokens.find(
            (token) => token.Application === "Azure Devops"
          );
          if (azureToken) {
            // Llenar los campos con los datos del token de Azure
            setApiToken(azureToken.Number);
            setEmail(azureToken.email);
            setUrl(azureToken.url);
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
      // Obtener el ID del token de Azure del usuario
      const response = await axios.get("http://localhost:4000/api/tokens", {
        params: { username },
      });

      console.log("Respuesta del backend en deleteToken:", response.data); // Debug

      if (response.data.success && response.data.tokens) {
        // Buscar el token de Azure
        const azureToken = response.data.tokens.find(
          (token) => token.Application === "Azure Devops"
        );

        console.log("Token encontrado en deleteToken:", azureToken); // Debug

        if (!azureToken || !azureToken.id) {
          alert("No se encontró un token de Azure para este usuario.");
          return;
        }

        console.log("Intentando eliminar el token con ID:", azureToken.id); // Debug

        // Enviar solicitud para eliminar el token
        const deleteResponse = await axios.delete(
          "http://localhost:4000/api/delete-token",
          {
            data: { username, tokenId: azureToken.id, splitToken: false },
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
