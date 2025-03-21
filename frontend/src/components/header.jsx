import React from 'react';
import './header.css';
import '../styles/global.css';
import { Link, useNavigate } from "react-router-dom"; //Esto igual muy importante


function Header() {
  const navigate = useNavigate();

  const handleNavigationWithHash = (path, hash) => (e) => {
    e.preventDefault();
    navigate(path);
    setTimeout(() => {
      //Esto busca el hash luego de ir al path con rutas
      const section = document.querySelector(hash);
      if (section) {
        section.scrollIntoView({ behavior: 'smooth' });
      }
    }, 50);
  };

  return (
    <header className="header">
      <nav className="navbar">
        
        {/* Pestaña "Migrate" */}
        <Link to="/migrate">
          <div className="tab">
            <span>Migrate</span>
          </div>
        </Link>
        

        {/* Pestaña "API Token Management" con subsecciones (el style es para que no se desconfigure el color al añadir Link)*/}
        <div className="tab">
        <Link to="/token-manager" style={{ color: "inherit", textDecoration: "none" }}>
          <span>API Token Management</span>
        </Link>
          <div className="dropdown">
            <div className="dropdown-item" onClick={handleNavigationWithHash('/token-manager', '#jira-section')}>Jira</div>
            <div className="dropdown-item" onClick={handleNavigationWithHash('/token-manager', '#zephyr-section')}>Zephyr</div>
            <div className="dropdown-item" onClick={handleNavigationWithHash('/token-manager', '#azure-section')}>Azure Devops</div>
          </div>
        </div>
      </nav>
    </header>
  );
}

export default Header;