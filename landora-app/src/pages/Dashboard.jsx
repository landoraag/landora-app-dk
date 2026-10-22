import { Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { lazyPage } from "../lib/lazyPage";
import { useWarmCollections } from "../lib/useCollection";
import ErrorBoundary from "../components/ErrorBoundary";
import { NavLink, Route, Routes, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { CallProvider } from "../context/CallContext";
import CallBar from "../components/CallBar";
import UpdateBanner from "../components/UpdateBanner";
import NotifyPrompt from "../components/NotifyPrompt";
// Cada aba é baixada à parte (o app abre bem mais rápido, principalmente no 4G). Logo depois
// que o app abre, as outras abas são baixadas em segundo plano, para a troca de tela ser
// instantânea (sem a rodinha de carregando no meio da animação).
const PAGE_LOADERS = {
  Inicio: () => import("../components/tabs/Inicio"),
  LandingPages: () => import("../components/tabs/LandingPages"),
  Clientes: () => import("../components/tabs/Clientes"),
  Vendas: () => import("../components/tabs/Vendas"),
  Financeiro: () => import("../components/tabs/Financeiro"),
  Relatorios: () => import("../components/tabs/Relatorios"),
  Chat: () => import("../components/tabs/Chat"),
  Perfil: () => import("../components/tabs/Perfil"),
  Leads: () => import("../components/tabs/Leads"),
  Tarefas: () => import("../components/tabs/Tarefas"),
};
const Inicio = lazyPage(PAGE_LOADERS.Inicio);
const LandingPages = lazyPage(PAGE_LOADERS.LandingPages);
const Clientes = lazyPage(PAGE_LOADERS.Clientes);
const Vendas = lazyPage(PAGE_LOADERS.Vendas);
const Financeiro = lazyPage(PAGE_LOADERS.Financeiro);
const Relatorios = lazyPage(PAGE_LOADERS.Relatorios);
const Chat = lazyPage(PAGE_LOADERS.Chat);
const Perfil = lazyPage(PAGE_LOADERS.Perfil);
const Leads = lazyPage(PAGE_LOADERS.Leads);
const Tarefas = lazyPage(PAGE_LOADERS.Tarefas);
const PATH_LOADER = {
  "/inicio": PAGE_LOADERS.Inicio,
  "/landing-pages": PAGE_LOADERS.LandingPages,
  "/clientes": PAGE_LOADERS.Clientes,
  "/vendas": PAGE_LOADERS.Vendas,
  "/financeiro": PAGE_LOADERS.Financeiro,
  "/relatorios": PAGE_LOADERS.Relatorios,
  "/chat": PAGE_LOADERS.Chat,
  "/perfil": PAGE_LOADERS.Perfil,
  "/leads": PAGE_LOADERS.Leads,
  "/tarefas": PAGE_LOADERS.Tarefas,
};
const WARM = [
  ["landingPages", "createdAt", "desc"],
  ["sales", "date", "desc"],
  ["financeEntries", "date", "desc"],
  ["clients", "createdAt", "desc"],
  ["tasks", "createdAt", "desc"],
  ["subscriptions", "createdAt", "desc"],
  ["settings"],
  ["leads", "createdAt", "desc"],
  ["channels", "createdAt", "asc"],
  ["chatMessages", "createdAt", "asc", 300],
  ["calls", "createdAt", "asc"],
  ["channelCategories", "createdAt", "asc"],
  ["users", "createdAt", "asc"],
];
function preloadPages() {
  for (const load of Object.values(PAGE_LOADERS)) load().catch(() => {});
}
const CAN_VT = typeof document !== "undefined" && typeof document.startViewTransition === "function";
const REDUCED_MOTION =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
import Avatar from "../components/Avatar";
import Icon from "../components/Icons";

const TABS = [
  { to: "/inicio", label: "Início", icon: "home" },
  { to: "/landing-pages", label: "Pages", icon: "pages" },
  { to: "/tarefas", label: "Tarefas", icon: "tarefas" },
  { to: "/leads", label: "Leads", icon: "leads" },
  { to: "/clientes", label: "Clientes", icon: "clientes" },
  { to: "/vendas", label: "Vendas", icon: "vendas" },
  { to: "/financeiro", label: "Financeiro", icon: "financeiro" },
  { to: "/relatorios", label: "Relatórios", icon: "relatorios" },
  { to: "/chat", label: "Chat", icon: "chat" },
];

// Celular: estas ficam no menu de baixo; as outras vão para o menu ☰.
const MOBILE_BOTTOM = ["/chat", "/financeiro", "/relatorios"];
const MOBILE_DRAWER = TABS.filter((t) => !MOBILE_BOTTOM.includes(t.to));
const MOBILE_BOTTOM_TABS = MOBILE_BOTTOM.map((to) => TABS.find((t) => t.to === to));

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
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false); // menu ☰ do celular

  // Fecha o menu ☰ ao trocar de aba; Esc também fecha.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname]);
  // Cada aba abre no topo.
  // (Com chaves de propósito: navegadores novos fazem scrollTo devolver uma Promise, e um efeito
  // não pode devolver nada além de uma função; isso quebrava a tela ao trocar de aba.)
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  useEffect(() => {
    if (!drawerOpen) return undefined;
    const onKey = (e) => e.key === "Escape" && setDrawerOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawerOpen]);
  // Listas usadas pelas abas ficam sempre carregadas: a troca de tela já mostra tudo pronto.
  useWarmCollections(WARM);

  // Baixa as outras abas em segundo plano, 2,5 s depois de abrir.
  useEffect(() => {
    const t = setTimeout(preloadPages, 2500);
    return () => clearTimeout(t);
  }, []);

  // Troca de tela animada: o navegador "fotografa" a tela atual e faz a passagem suave para a
  // nova (View Transitions). Navegadores antigos usam a animação de entrada simples (.page-anim).
  const vtPending = useRef(false);
  useEffect(() => {
    if (!CAN_VT || REDUCED_MOTION) return undefined;
    const onClick = (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest?.("a[href]");
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.hasAttribute("data-no-vt")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return; // mesma tela: sem animação
      e.preventDefault();
      vtPending.current = true;
      try {
        document.startViewTransition(async () => {
          // Espera a aba nova estar baixada (no máx. 1,5 s): assim a passagem já mostra a tela
          // pronta, e não a rodinha de carregando.
          const load = PATH_LOADER[url.pathname];
          if (load) await Promise.race([load().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
          flushSync(() => {
            setDrawerOpen(false);
            navigate(url.pathname + url.search + url.hash);
          });
        });
      } catch {
        vtPending.current = false;
        navigate(url.pathname + url.search + url.hash);
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, [navigate]);
  // Se a troca veio com a passagem suave, a tela nova não precisa da animação de entrada extra.
  const enterClass = useMemo(() => (vtPending.current ? " vt-nav" : ""), [location.key]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    vtPending.current = false;
  }, [location.key]);

  const drawerHasActive = MOBILE_DRAWER.some((t) => location.pathname.startsWith(t.to));
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

  // Destaque da aba aberta no menu lateral: um "bloco" só que desliza até o item clicado.
  const sideNavRef = useRef(null);
  const [indicator, setIndicator] = useState(null);
  useLayoutEffect(() => {
    const nav = sideNavRef.current;
    const el = nav?.querySelector(".side-link.active");
    setIndicator(el ? { top: el.offsetTop, height: el.offsetHeight } : null);
  }, [location.pathname, collapsed, query]);

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
            <nav className="side-nav" ref={sideNavRef}>
              <span
                className={"side-indicator" + (indicator ? "" : " hidden")}
                style={indicator ? { transform: `translateY(${indicator.top}px)`, height: indicator.height } : undefined}
                aria-hidden="true"
              />
              {items.map((t, i) => (
                <NavLink
                  key={t.to}
                  to={t.to}
                  style={{ "--i": i }}
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

        {/* ---------- Celular: barra do topo com o menu ☰ ---------- */}
        <header className="mobile-topbar">
          <button
            type="button"
            className={"topbar-menu" + (drawerHasActive ? " has-active" : "")}
            onClick={() => setDrawerOpen(true)}
            aria-label="Abrir menu"
            aria-expanded={drawerOpen}
          >
            <Icon name="menu" size={22} strokeWidth={2} />
          </button>
          <NavLink to="/inicio" className="topbar-logo-link" aria-label="Início">
            <img className="topbar-logo" src="/logomarca.png" alt="Landora" />
          </NavLink>
          <span className="topbar-page">{TABS.find((t) => location.pathname.startsWith(t.to))?.label || (location.pathname.startsWith("/perfil") ? "Perfil" : "")}</span>
        </header>

        <div className={"drawer-backdrop" + (drawerOpen ? " open" : "")} onClick={() => setDrawerOpen(false)} aria-hidden="true" />
        <nav className={"drawer" + (drawerOpen ? " open" : "")} aria-label="Menu" aria-hidden={!drawerOpen}>
          <div className="drawer-head">
            <img src="/logomarca.png" alt="Landora" />
            <button type="button" className="drawer-close" onClick={() => setDrawerOpen(false)} aria-label="Fechar menu">
              <Icon name="close" size={20} />
            </button>
          </div>
          <div className="drawer-section" style={{ "--i": 0 }}>Menu</div>
          {MOBILE_DRAWER.map((t, i) => (
            <NavLink
              key={t.to}
              to={t.to}
              style={{ "--i": i + 1 }}
              tabIndex={drawerOpen ? 0 : -1}
              className={({ isActive }) => "drawer-link" + (isActive ? " active" : "")}
            >
              <Icon name={t.icon} size={20} />
              <span>{t.label}</span>
            </NavLink>
          ))}
          <div className="drawer-foot" style={{ "--i": MOBILE_DRAWER.length + 1 }}>
            <NavLink to="/perfil" tabIndex={drawerOpen ? 0 : -1} className="drawer-user">
              <Avatar src={profile?.photoURL} name={profile?.nickname} size={34} />
              <span>{profile?.nickname}</span>
            </NavLink>
            <button type="button" className="drawer-logout" onClick={logout} tabIndex={drawerOpen ? 0 : -1}>
              <Icon name="logout" size={18} /> Sair
            </button>
          </div>
        </nav>

        <main className="content">
          <ErrorBoundary resetKey={location.pathname}>
          <Suspense
            fallback={
              <div className="tab-loading">
                <div className="spinner" />
              </div>
            }
          >
          {/* A chave muda a cada aba: a animação de entrada roda de novo em toda troca de tela. */}
          <div key={location.pathname} className={"page-anim" + (location.pathname.startsWith("/chat") ? " no-slide" : "") + enterClass}>
          <Routes>
            <Route path="/" element={<Navigate to="/inicio" replace />} />
            <Route path="/inicio" element={<Inicio />} />
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
          </div>
          </Suspense>
          </ErrorBoundary>
        </main>

        <CallBar />
        <UpdateBanner />
        <NotifyPrompt />

        <nav className="bottom-nav">
          {MOBILE_BOTTOM_TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => "bottom-link" + (isActive ? " active" : "")}>
              <span className="bottom-icon"><Icon name={t.icon} size={22} /></span>
              <span className="bottom-label">{t.label}</span>
            </NavLink>
          ))}
          <NavLink to="/perfil" className={({ isActive }) => "bottom-link bottom-profile" + (isActive ? " active" : "")}>
            <span className="bottom-icon"><Avatar src={profile?.photoURL} name={profile?.nickname} size={24} /></span>
            <span className="bottom-label">Perfil</span>
          </NavLink>
        </nav>
      </div>
    </CallProvider>
  );
}
