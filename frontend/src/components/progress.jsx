import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import "./progress.css";
import { endMigration, getMigrationStatus } from "../../utils/api";
import { useNavigate } from "react-router-dom";

export default function MigrationProgress() {
  const [isCompleted, setIsCompleted] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState(["Iniciando migración..."]);
  const navigate = useNavigate();

  const handleEndMigration = async () => {
    try {
      const data = await endMigration();
      alert(data.message);
    } catch (error) {
      console.error("Error ending migration:", error);
    }

    setIsCompleted(false);
    setProgress(0);

    navigate("/migrate");
  };

  useEffect(() => {
    const fetchMigrationStatus = async () => {
      try {
        const response = await getMigrationStatus();

        // console.dir(response, { depth: null });

        if (response === "migration not started...") {
          return;
        }

        if (response?.progress.toFixed(2) === "100.00") {
          setIsCompleted(true);
        } else if (response?.progress.toFixed(2) < "100.00") {
          setIsCompleted(false);
        }

        setProgress(response.progress.toFixed(2));
        setLogs(response.logs);
      } catch (error) {
        console.error("Error fetching migration status:", error);
      }
    };

    // Polling interval every 5 seconds
    const interval = setInterval(() => {
      fetchMigrationStatus();
    }, 5000);

    // Initial fetch
    fetchMigrationStatus();

    // Cleanup function to stop polling when unmounting
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="layout">
      <div className="migration-container">
        <div className="log-box">
          {logs.map((log, index) => (
            <div key={index} className="log-message">
              {log}
            </div>
          ))}
        </div>

        <div className="progress-bar">
          <div
            className="progress-fill"
            style={{ width: `${progress}%` }}
          ></div>
        </div>

        <div className="button-container">
          {isCompleted ? (
            <button
              className="finish-button"
              onClick={() => {
                handleEndMigration();
              }}
            >
              Finalizar Migración
            </button>
          ) : (
            <p className="progress-text">Progress: {progress}%</p>
          )}
        </div>
      </div>
    </div>
  );
}

MigrationProgress.propTypes = {
  apiUrl: PropTypes.string.isRequired,
};
