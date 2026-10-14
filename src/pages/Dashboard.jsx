import { Link, NavLink, Route, Routes, Navigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CallProvider } from "../context/CallContext";
import CallBar from "../components/CallBar";
import LandingPages from "../components/tabs/LandingPages";
import Clientes from "../components/tabs/Clientes";
import Vendas from "../components/tabs/Vendas";
import Financeiro from "../components/tabs/Financeiro";
import Relatorios from "../components/tabs/Relatorios";
import Chat from "../components/tabs/Chat";
import Calls from "../components/tabs/Calls";
import Perfil from "../components/tabs/Perfil";
import Avatar from "../components/Avatar";

const TABS = [
  { to: "/landing-pages", label: "Pages", icon: "🗂️" },
  { to: "/clientes", label: "Clientes", icon: "👤" },
  { to: "/vendas", label: "Vendas", icon: "💰" },
  { to: "/financeiro", label: "Financeiro", icon: "📊" },
  { to: "/relatorios", label: "Relatórios", icon: "📄" },
  { to: "/chat", label: "Chat", icon: "💬" },
  { to: "/calls", label: "Calls", icon: "📞" },
];

export default function Dashboard() {
  const { profile, logout } = useAuth();

  return (
    <CallProvider>
      <div className="shell">
        <aside className="sidebar">
          <div className="side-brand">
            <img src="/logo.png" alt="Landora" />
          </div>
          <nav className="side-nav">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => "side-link" + (isActive ? " active" : "")}>
                <span>{t.icon}</span> {t.label}
              </NavLink>
            ))}
          </nav>
          <div className="side-user">
            <NavLink to="/perfil" className="side-user-link" title="Meu perfil">
              <Avatar src={profile?.photoURL} name={profile?.nickname} size={32} />
              <span className="side-user-name">{profile?.nickname}</span>
            </NavLink>
            <button className="btn-link" onClick={logout}>Sair</button>
          </div>
        </aside>

        <main className="content">
          <div className="mobile-profile-row">
            <Link to="/perfil" title="Meu perfil">
              <Avatar src={profile?.photoURL} name={profile?.nickname} size={34} />
            </Link>
          </div>
          <Routes>
            <Route path="/" element={<Navigate to="/landing-pages" replace />} />
            <Route path="/landing-pages" element={<LandingPages />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/vendas" element={<Vendas />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/calls" element={<Calls />} />
            <Route path="/perfil" element={<Perfil />} />
          </Routes>
        </main>

        <CallBar />

        <nav className="bottom-nav">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => "bottom-link" + (isActive ? " active" : "")}>
              <span className="bottom-icon">{t.icon}</span>
              <span className="bottom-label">{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </CallProvider>
  );
}
