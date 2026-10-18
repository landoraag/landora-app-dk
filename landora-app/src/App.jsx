import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./context/AuthContext";
import Login from "./pages/Login";
import Register from "./pages/Register";
import Dashboard from "./pages/Dashboard";

function NoAccess() {
  const { user, logout, checkAccess } = useAuth();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <img src="/logomarca.png" alt="Landora" className="auth-logo" />
        <h3 className="noaccess-title">Sem acesso</h3>
        <p className="auth-sub">
          A conta <b>{user?.email}</b> não está na lista de acesso do Landora. Peça para um dos sócios liberar o seu e-mail em
          Perfil → Acesso ao app, e depois toque em “Tentar de novo”.
        </p>
        <div className="noaccess-actions">
          <button className="btn btn-gradient" onClick={() => checkAccess()}>
            Tentar de novo
          </button>
          <button className="btn-link" onClick={logout}>
            Sair
          </button>
        </div>
      </div>
    </div>
  );
}

function PrivateRoute({ children }) {
  const { user, loading, access } = useAuth();
  if (loading) return <div className="full-loader"><div className="spinner" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (access === "denied") return <NoAccess />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/registro" element={<Register />} />
      <Route
        path="/*"
        element={
          <PrivateRoute>
            <Dashboard />
          </PrivateRoute>
        }
      />
    </Routes>
  );
}
