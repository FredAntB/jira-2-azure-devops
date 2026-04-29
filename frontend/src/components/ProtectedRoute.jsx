import { Navigate, Outlet } from 'react-router-dom';

/**
 * ProtectedRoute — renders child routes only when a JWT is present in localStorage.
 * If the token is absent, redirects the user to /login.
 */
function ProtectedRoute() {
    const token = localStorage.getItem('token');

    if (!token) {
        return <Navigate to="/login" replace />;
    }

    return <Outlet />;
}

export default ProtectedRoute;
