import { useEffect, useRef, useState } from "react";
import { Link, NavLink, Route, Routes, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CallProvider } from "../context/CallContext";
import CallBar from "../components/CallBar";
import UpdateBanner from "../components/UpdateBanner";
import NotifyPrompt from "../components/NotifyPrompt";
import LandingPages from "../components/tabs/LandingPages";
import Clientes from "../components/tabs/Clientes";
import Vendas from "../components/tabs/Vendas";
import Financeiro from "../components/tabs/Financeiro";
import Relatorios from "../components/tabs/Relatorios";
import Chat from "../components/tabs/Chat";
import Perfil from "../components/tabs/Perfil";
import Leads from "../components/tabs/Leads";
import Tarefas from "../components/tabs/Tarefas";
import Avatar from "../components/Avatar";
import Icon from "../components/Icons";

const TABS = [
  { to: "/landing-pages", label: "Pages", icon: "pages" },
  { to: "/tarefas", label: "Tarefas", icon: "tarefas" },
  { to: "/leads", label: "Leads", icon: "leads" },
  { to: "/clientes", label: "Clientes", icon: "clientes" },
  { to: "/vendas", label: "Vendas", icon: "vendas" },
  { to: "/financeiro", label: "Financeiro", icon: "financeiro" },
  { to: "/relatorios", label: "Relatórios", icon: "relatorios" },
  { to: "/chat", label: "Chat", icon: "chat" },
];

// lembra se o menu ficou aberto ou fechado
const COLLAPSE_KEY = "landora:sidebar-collapsed";
function readCollapsed() {
  try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
}
// busca sem diferenciar acento/maiúscula
const norm = (str) => str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

export default function Dashboard() {
  const { profile, logout } = useAuth();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const focusSearchNext = useRef(false);

  useEffect(() => {
    try { localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0"); } catch { /* ignora */ }
  }, [collapsed]);

  // ao abrir o menu pelo ícone de lupa, já foca no campo de busca
  useEffect(() => {
    if (!collapsed && focusSearchNext.current) {
      focusSearchNext.current = false;
      searchRef.current?.focus();
    }
  }, [collapsed]);

  const q = norm(query.trim());
  const items = q ? TABS.filter((t) => norm(t.label).includes(q)) : TABS;

  function toggleSidebar() {
    setQuery("");
    setCollapsed((c) => !c);
  }
  function openSearch() {
    focusSearchNext.current = true;
    setCollapsed(false);
  }
  function onSearchKey(e) {
    if (e.key === "Escape") { setQuery(""); e.currentTarget.blur(); }
    if (e.key === "Enter" && items[0]) { navigate(items[0].to); setQuery(""); e.currentTarget.blur(); }
  }

  return (
    <CallProvider>
      <div className="shell">
        <aside className={"sidebar" + (collapsed ? " collapsed" : "")}>
          <div className="side-panel">
            <button
              type="button"
              className="side-toggle"
              onClick={toggleSidebar}
              aria-label={collapsed ? "Abrir menu" : "Fechar menu"}
              aria-expanded={!collapsed}
            >
              <Icon name="chevron" size={16} strokeWidth={2.2} />
            </button>

            <div className="side-brand">
              <img className="side-logo-full" src="/logomarca.png" alt="Landora" />
              <img className="side-logo-mark" src="/icone.png" alt="Landora Icon" />
            </div>

            {collapsed ? (
              <button type="button" className="side-search-btn" onClick={openSearch} title="Buscar" aria-label="Buscar no menu">
                <Icon name="search" size={20} />
              </button>
            ) : (
              <label className="side-search">
                <Icon name="search" size={19} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKey}
                  placeholder="Buscar"
                  aria-label="Buscar no menu"
                />
              </label>
            )}

            <div className="side-section">Menu</div>
            <nav className="side-nav">
              {items.map((t) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  title={collapsed ? t.label : undefined}
                  onClick={() => setQuery("")}
                  className={({ isActive }) => "side-link" + (isActive ? " active" : "")}
                >
                  <Icon name={t.icon} size={20} />
                  <span className="side-label">{t.label}</span>
                </NavLink>
              ))}
              {items.length === 0 && <p className="side-empty">Nada encontrado</p>}
            </nav>

            <div className="side-user">
              <NavLink to="/perfil" className="side-user-link" title="Meu perfil">
                <Avatar src={profile?.photoURL} name={profile?.nickname} size={34} />
                <span className="side-label side-user-name">{profile?.nickname}</span>
              </NavLink>
              <button type="button" className="side-logout" onClick={logout} title="Sair" aria-label="Sair">
                <Icon name="logout" size={18} />
              </button>
            </div>
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
            <Route path="/tarefas" element={<Tarefas />} />
            <Route path="/leads" element={<Leads />} />
            <Route path="/clientes" element={<Clientes />} />
            <Route path="/vendas" element={<Vendas />} />
            <Route path="/financeiro" element={<Financeiro />} />
            <Route path="/relatorios" element={<Relatorios />} />
            <Route path="/chat" element={<Chat />} />
            {/* As calls agora são canais de voz dentro do Chat. */}
            <Route path="/calls" element={<Navigate to="/chat" replace />} />
            <Route path="/perfil" element={<Perfil />} />
          </Routes>
        </main>

        <CallBar />
        <UpdateBanner />
        <NotifyPrompt />

        <nav className="bottom-nav">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => "bottom-link" + (isActive ? " active" : "")}>
              <span className="bottom-icon"><Icon name={t.icon} size={22} /></span>
              <span className="bottom-label">{t.label}</span>
            </NavLink>
          ))}
        </nav>
      </div>
    </CallProvider>
  );
}
