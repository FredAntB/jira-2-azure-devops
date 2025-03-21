import React, { useEffect } from "react";
import "./token-manager.css";
import "../styles/global.css";
import JiraSection from "./jira-section";
import ZephyrSection from "./zephyr-section";
import AzureSection from "./azure-section";

function TokenManager() {
  useEffect(() => {
    document.body.classList.add("token-manager-page");

    return () => {
      document.body.classList.remove("token-manager-page");
    };
  }, []);

  return (
    <div className="SectionContainer">
      <section id="jira-section">
        <JiraSection/>
      </section>
      
      <section id="zephyr-section">
        <ZephyrSection />
      </section>
      
      <section id="azure-section">
        <AzureSection />
      </section>
      
    </div>
  );
}

export default TokenManager;
