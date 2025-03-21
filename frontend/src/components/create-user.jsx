import { useState, useEffect } from "react";
import "./create-user.css";
import loginImage from "../assets/login-image.jpg";
import { useNavigate } from 'react-router-dom';


function CreateUser() {
  const [username, setUsername] = useState("");
  const [password1, setPassword1] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
      document.body.classList.add("create-user-page");
      return () => {
        document.body.classList.remove("create-user-page");
      };
    }, []);

    const handleCreateUser = async (e) => {
      e.preventDefault();
      setError("");
    
      if (password1 !== password2) {
        setError("Passwords do not match.");
        return;
      }
    
      try {
        const response = await fetch("http://localhost:4000/api/register", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            username,
            password: password1,
          }),
        });
    
        const data = await response.json();
    
        if (!response.ok) {
          throw new Error(data.message || "Error registering user.");
        }
    
        alert(`User ${username} registered successfully!`);
        navigate("/login");
      } catch (error) {
        setError(error.message);
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
        <h2 className="title">Create Account</h2>
        {error && (
          <p className="error-message" style={{ color: "black" }}>
            {error}
          </p>
        )}
        <form onSubmit={handleCreateUser}>
          <div className="input-group">
          <label className="label">Username:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
            <label className="label">Password:</label>
            <input
              type="password"
              id="password"
              value={password1}
              onChange={(e) => setPassword1(e.target.value)}
              required
            />
          </div>
          <div className="input-group">
          <label className="label">Confirm Password:</label>
            <input
              type="password"
              id="confirm-password"
              value={password2}
              onChange={(e) => setPassword2(e.target.value)}
              required
            />
          </div>
          <button type="submit" className="register-button">
            Register
          </button>
        </form>
        <p onClick={() => navigate('/login')}> Already have an account </p>
      </div>
    </div>
  );
}

export default CreateUser;
