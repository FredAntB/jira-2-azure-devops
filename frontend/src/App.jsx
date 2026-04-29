import './App.css';
import Login from './components/login.jsx';
import Migrate from './components/migrate.jsx';
import Header from './components/header.jsx';
import TokenManager from './components/token-manager.jsx';
import Progress from './components/progress.jsx';
import { BrowserRouter as Router, Routes, Route, Navigate, Outlet } from 'react-router-dom';
import CreateUser from './components/create-user.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';

function App() {
  return (
    <Router>
      <Routes>
        {/* Public routes */}
        <Route path="/" element={<CreateUser />} />
        <Route path="/login" element={<Login />} />

        {/* Protected routes — require a valid JWT in localStorage */}
        <Route element={<ProtectedRoute />}>
          <Route element={
            <>
              <Header />
              <Outlet />
            </>
          }>
            <Route path="/migrate" element={<Migrate />} />
            <Route path="/token-manager" element={<TokenManager />} />
            <Route path="/progress" element={<Progress />} />
          </Route>
        </Route>

        {/* Catch-all — redirect unknown paths to login */}
        <Route path="*" element={<Navigate to="/login" />} />
      </Routes>
    </Router>
  );
}

export default App;
