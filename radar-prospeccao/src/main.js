// Radar de Prospecção Landora — site (Firebase Auth + Firestore, coleções radar_*).
import "./style.css";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendPasswordResetEmail,
  signOut, updateProfile, sendEmailVerification,
} from "firebase/auth";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, onSnapshot, query, where, orderBy, limit,
} from "firebase/firestore";
import { connect } from "./fb.js";

// ============================== constantes ==============================
const STAGES = [
  { k: "novo", l: "Novo" }, { k: "contatado", l: "Contatado" }, { k: "respondeu", l: "Respondeu" }, { k: "reuniao", l: "Reunião marcada" },
  { k: "proposta", l: "Proposta enviada" }, { k: "fechado", l: "Venda fechada" }, { k: "perdido", l: "Sem interesse" }];
const STAGE_EVENT = { contatado: "contato", respondeu: "contato", reuniao: "reuniao", proposta: "proposta", fechado: "venda" };
const TAGS = [
  { k: "mensagem", l: "Mensagem enviada" }, { k: "respondeu", l: "Respondeu" }, { k: "voltar", l: "Voltar a falar" },
  { k: "comprou_outro", l: "Já comprou com outro" }, { k: "ja_tem_site", l: "Já tem site" },
  { k: "sem_interesse", l: "Não quer agora" }, { k: "numero_errado", l: "Número errado" }];
const HIDE_TAGS = ["comprou_outro", "ja_tem_site", "numero_errado"];
const FX = { A: { l: "Muito fácil", c: "pA" }, B: { l: "Fácil", c: "pB" }, C: { l: "Difícil", c: "pC" } };
const GOAL_KINDS = [
  { key: "contatos", label: "Contatos feitos", unit: "contatos", icon: "i-phone", auto: true, hint: "Conta sozinha: cada lead que vai para Contatado ou Respondeu." },
  { key: "prospeccoes", label: "Prospecções (leads novos)", unit: "prospecções", icon: "i-target", auto: true, hint: "Conta sozinha: leads que entram no funil e prospecções adicionadas no mapa." },
  { key: "reunioes", label: "Reuniões", unit: "reuniões", icon: "i-hand", auto: true, hint: "Conta sozinha: leads movidos para Reunião marcada." },
  { key: "propostas", label: "Propostas enviadas", unit: "propostas", icon: "i-doc", auto: true, hint: "Conta sozinha: leads movidos para Proposta enviada." },
  { key: "vendas", label: "Vendas feitas", unit: "vendas", icon: "i-money", auto: true, hint: "Conta sozinha: leads movidos para Venda fechada." },
  { key: "outro", label: "Outra meta", unit: "", icon: "i-star", auto: false, hint: "Você conta no botão +1 sempre que fizer um." }];
const GOAL_EVENT = { contatos: "contato", prospeccoes: "prospeccao", reunioes: "reuniao", propostas: "proposta", vendas: "venda" };
const PERIODS = [{ key: "dia", label: "Por dia" }, { key: "semana", label: "Por semana" }, { key: "mes", label: "Por mês" }];
const DIAS = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const GANCHO = {
  "Loja de Roupas": "Catálogo online com botão de WhatsApp: cliente vê as peças antes de ir à loja.",
  "Salão / Barbearia": "Agendamento online 24h e vitrine de cortes/serviços: menos tempo no WhatsApp.",
  "Lanchonete / Hamburgueria": "Cardápio próprio com pedido direto no WhatsApp, sem taxa de app de entrega.",
  "Oficina Mecânica": "Aparecer no Google quando alguém busca mecânico na cidade + orçamento por WhatsApp.",
  "Estética": "Página de procedimentos com antes/depois e agendamento online.",
  "Bar": "Agenda de eventos/música ao vivo, cardápio e reservas em um só link.",
  "Delivery / Marmitaria": "Cardápio do dia + pedido direto no WhatsApp, sem comissão de app.",
  "Material de Construção": "Catálogo de produtos e orçamento rápido por WhatsApp; aparecer no Google.",
  "Restaurante": "Cardápio, fotos, horário e reservas; ser achado por turistas e no Google Maps.",
  "Clínica Médica": "Página de especialidades e agendamento: passa confiança e reduz ligações.",
  "Padaria / Confeitaria": "Encomendas de bolos/salgados online com fotos e preços.",
  "Pet Shop": "Agendamento de banho e tosa online + vitrine de produtos.",
  "Lava-rápido / Estética Automotiva": "Tabela de serviços e agendamento de horário pelo celular.",
  "Advocacia": "Site institucional de áreas de atuação: credibilidade e contato discreto.",
  "Odontologia": "Página de tratamentos (implante, clareamento, aparelho) com agendamento online.",
  "Funilaria e Pintura": "Galeria de serviços feitos e orçamento por foto no WhatsApp.",
  "Academia": "Planos, horários e aula experimental agendada pelo site.",
  "Psicologia": "Página profissional com abordagem, atendimento online e agendamento.",
  "Revenda de Veículos": "Estoque online com fotos e botão de WhatsApp em cada carro.",
  "Móveis Planejados / Marcenaria": "Portfólio de projetos e pedido de orçamento: vende pelo visual.",
  "Buffet / Eventos": "Pacotes, fotos de eventos e pedido de orçamento com data.",
  "Contabilidade": "Site institucional + captação de MEI/abertura de empresa pelo Google.",
  "Loja de Móveis": "Catálogo online com preços/condições e WhatsApp.",
  "Acessórios Automotivos": "Catálogo de produtos/instalação e orçamento por WhatsApp.",
  "Fotografia": "Portfólio profissional e pacotes: é o cartão de visitas do fotógrafo.",
  "Ótica": "Vitrine de armações, convênios e agendamento de exame.",
  "Imobiliária / Corretor": "Portal próprio de imóveis com filtros e WhatsApp em cada anúncio.",
  "Fisioterapia / Pilates": "Página de tratamentos, convênios e agendamento online.",
  "Hotel / Pousada": "Reserva direta pelo site, sem pagar comissão para Booking.",
  "Veterinária": "Serviços, plantão/emergência e agendamento online.",
  "Estúdio de Tatuagem": "Portfólio por estilo e orçamento/agendamento online.",
  "Doceria": "Cardápio de doces e encomendas online para festas.",
  "Escola de Idiomas": "Cursos, turmas e aula experimental com inscrição online.",
  "Autoescola": "Categorias, preços e matrícula online.",
  "Revenda de Motos": "Estoque online com fotos e WhatsApp em cada moto.",
  "Nutrição": "Página profissional com planos e agendamento (presencial/online).",
  "Escola de Dança": "Turmas, horários e matrícula/aula experimental online." };
const ROUTES = [
  { k: "inicio", l: "Hoje", i: "i-home" }, { k: "busca", l: "Prospecções", i: "i-search" }, { k: "leads", l: "Meus leads", i: "i-star" },
  { k: "mapa", l: "Mapa", i: "i-map" }, { k: "funil", l: "Funil", i: "i-funnel" }, { k: "metas", l: "Metas", i: "i-target" },
  { k: "cidades", l: "Cidades", i: "i-city" }, { k: "equipe", l: "Equipe", i: "i-users" }];
const DEFAULT_Q = { texto: "", cidades: [], ramos: [], faixas: ["A", "B", "C"], contato: "todos", online: "todos", etapa: "todas", resp: "todos",
  mei: "todos", conferir: false, descartadas: false, esconder: true, org: "todas", notaMin: 0, notaMax: 100, idadeMin: "", idadeMax: "", bairro: "", ordem: "facil_az" };

// ============================== estado ==============================
const S = {
  fb: null, user: null, acesso: null, perfil: undefined, isAdmin: false, member: false,
  leads: [], byId: new Map(), meta: null, loadErr: null, loading: true,
  perfis: {}, funil: {}, eventos: [], metas: [], metaLogs: [], manuais: [], config: null, execucoes: [], pedidos: [],
  q: { ...DEFAULT_Q }, page: 60, unsub: [], _keepScroll: true,
};
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = (s) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const digits = (s) => String(s || "").replace(/\D/g, "");
const docId = (cnpj) => digits(cnpj);
const isoLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
const todayISO = () => isoLocal(new Date());
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoLocal(d); };
const fmtDate = (iso) => (iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "");
const nick = (uid) => S.perfis[uid]?.apelido || S.perfis[uid]?.nome || "—";
const icon = (id) => `<svg aria-hidden="true"><use href="#${id}"/></svg>`;
const uid = () => S.user?.uid || "";
function toast(t) { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2800); }
const waLink = (tel, text) => "https://wa.me/55" + digits(tel) + (text ? "?text=" + encodeURIComponent(text) : "");
const isCel = (t) => { const d = digits(t); return d.length === 11 && d[2] === "9"; };
const pref = {
  get(k, d) { try { const v = localStorage.getItem("radar." + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("radar." + k, JSON.stringify(v)); } catch (e) { /* sem armazenamento */ } } };
const fmtStamp = (s) => { if (!s) return "—"; const d = new Date(s); return isNaN(d) ? s : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }); };
const nowISO = () => new Date().toISOString();

// ============================== Firestore: escrita ==============================
const D = (p) => doc(S.fb.db, ...p.split("/"));
const C = (p) => collection(S.fb.db, p);
async function W(fn, okMsg) {
  try { await fn(); if (okMsg) toast(okMsg); return true; }
  catch (e) {
    console.warn(e);
    toast(e.code === "permission-denied" ? "Sem permissão para salvar isso. Peça a um administrador." : e.code === "unavailable" ? "Sem conexão. Tente de novo." : "Não consegui salvar. Tente de novo.");
    return false;
  }
}
async function logEvent(tipo, lead) {
  if (!uid()) return;
  await W(() => addDoc(C("radar_eventos"), { tipo, lead: lead ? leadKey(lead) : "", nome: lead?.n || "", uid: uid(), data: todayISO(), em: nowISO() }));
}

// ============================== base de empresas ==============================
async function gunzipB64(s) {
  const bin = Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const stream = new Blob([bin]).stream().pipeThrough(new DecompressionStream("gzip"));
  return JSON.parse(await new Response(stream).text());
}
async function loadLeads() {
  S.loading = true;
  try {
    const m = await getDoc(D("radar_base/atual"));
    if (!m.exists()) { S.loadErr = "A base ainda não foi gerada. Ela aparece aqui depois da primeira atualização automática."; return; }
    const meta = m.data();
    const cached = await idb.get("base");
    let j;
    if (cached && cached.gerado === meta.gerado) j = cached.data;
    else {
      const parts = await Promise.all(Array.from({ length: meta.partes }, (_, i) => getDoc(D(`radar_base/atual/partes/${i}`))));
      j = await gunzipB64(parts.map((p) => p.data().d).join(""));
      idb.set("base", { gerado: meta.gerado, data: j });
    }
    S.meta = j.meta; S.leads = j.leads; S.byId.clear();
    for (const l of S.leads) {
      l._k = norm(l.n);
      l._t = norm([l.n, l.rz, l.r, l.a, l.b, l.d, (l.so || []).join(" "), l.id, l.ig, l.e].join(" ")) + " " + digits(l.id) + " " + (l.t || []).map(digits).join(" ");
      S.byId.set(docId(l.id), l);
    }
    S.loadErr = null;
  } catch (e) { console.warn(e); S.loadErr = "Não consegui carregar a base de empresas. Recarregue a página."; }
  finally { S.loading = false; }
}
const idb = { // cache local da base (economiza leituras do Firestore)
  open() { return new Promise((res, rej) => { const r = indexedDB.open("radar", 1); r.onupgradeneeded = () => r.result.createObjectStore("kv"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async get(k) { try { const db = await this.open(); return await new Promise((res) => { const r = db.transaction("kv").objectStore("kv").get(k); r.onsuccess = () => res(r.result); r.onerror = () => res(null); }); } catch (e) { return null; } },
  async set(k, v) { try { const db = await this.open(); db.transaction("kv", "readwrite").objectStore("kv").put(v, k); } catch (e) { /* sem cache */ } } };

function allLeads() {
  const man = S.manuais.filter((m) => m.status !== "incorporado").map((m) => ({
    id: "M-" + m.id, _manual: m, n: m.nome, r: m.ramo || "Outro", c: m.cidade || "", a: m.endereco || "", t: m.tel ? [m.tel] : [], w: isCel(m.tel) ? 1 : 0,
    f: m.faixa || "B", s: m.nota || 60, lat: m.lat, lon: m.lon, ob: m.obs || "", _k: norm(m.nome), _t: norm([m.nome, m.ramo, m.endereco, m.obs].join(" ")) + " " + digits(m.tel) }));
  return S.leads.concat(man);
}
const leadKey = (l) => (l._manual ? "M-" + l._manual.id : docId(l.id));
const F = (l) => S.funil[leadKey(l)] || {};
const stageOf = (l) => F(l).etapa || "novo";
const hasTag = (l, t) => (F(l).tags || []).includes(t);
const findLead = (k) => (k.startsWith("M-") ? allLeads().find((l) => leadKey(l) === k) : S.byId.get(k));

// ============================== assinaturas ==============================
function subscribe() {
  S.unsub.forEach((u) => u()); S.unsub = [];
  const sub = (q, fn) => S.unsub.push(onSnapshot(q, (s) => { fn(s.docs.map((d) => ({ id: d.id, ...d.data() }))); scheduleRender(); }, (e) => console.warn(e)));
  sub(C("radar_perfis"), (ds) => { S.perfis = Object.fromEntries(ds.map((d) => [d.id, d])); });
  sub(C("radar_funil"), (ds) => { S.funil = Object.fromEntries(ds.map((d) => [d.id, d])); });
  sub(query(C("radar_eventos"), where("data", ">=", addDays(todayISO(), -100))), (ds) => { S.eventos = ds; });
  sub(C("radar_metas"), (ds) => { S.metas = ds.sort((a, b) => (a.criadoEm || "").localeCompare(b.criadoEm || "")); });
  sub(query(C("radar_metaLogs"), where("date", ">=", addDays(todayISO(), -40))), (ds) => { S.metaLogs = ds; });
  sub(C("radar_manuais"), (ds) => { S.manuais = ds; });
  sub(query(C("radar_execucoes"), orderBy("fim", "desc"), limit(15)), (ds) => { S.execucoes = ds; });
  sub(query(C("radar_pedidos"), where("status", "==", "pendente")), (ds) => { S.pedidos = ds.sort((a, b) => (b.em || "").localeCompare(a.em || "")); });
  S.unsub.push(onSnapshot(D("radar_config/geral"), (s) => { S.config = s.exists() ? s.data() : null; scheduleRender(); }, (e) => console.warn(e)));
}
let _rt = null;
function scheduleRender() { if (_rt) return; _rt = requestAnimationFrame(() => { _rt = null; render(); }); }

// ============================== entrada: login, cadastro, aprovação ==============================
const AUTH_ERR = {
  "auth/invalid-credential": "E-mail ou senha incorretos.", "auth/wrong-password": "E-mail ou senha incorretos.", "auth/user-not-found": "E-mail ou senha incorretos.",
  "auth/invalid-email": "Esse e-mail não parece válido.", "auth/email-already-in-use": "Já existe uma conta com esse e-mail. Use “Entrar” ou “Esqueci a senha”.",
  "auth/weak-password": "A senha precisa ter pelo menos 6 caracteres.", "auth/too-many-requests": "Muitas tentativas. Espere alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem conexão com a internet." };
function authScreen(mode = "entrar", msg = "") {
  document.body.classList.add("is-auth");
  $("#root").innerHTML = `<div class="auth"><form class="auth-card" id="af" novalidate>
    <div><div class="eyebrow">Landora</div><h1>Radar de Prospecção</h1></div>
    ${mode !== "esqueci" ? `<div class="auth-tabs" role="tablist"><button type="button" data-m="entrar" aria-pressed="${mode === "entrar"}">Entrar</button><button type="button" data-m="criar" aria-pressed="${mode === "criar"}">Criar conta</button></div>` : `<p class="muted" style="margin:0">Digite seu e-mail. Vamos mandar um link para você criar uma senha nova.</p>`}
    ${mode === "criar" ? `<label class="f">Nome completo<input type="text" id="aNome" autocomplete="name" required></label>` : ""}
    <label class="f">E-mail<input type="email" id="aEmail" autocomplete="email" required></label>
    ${mode !== "esqueci" ? `<label class="f">Senha<input type="password" id="aSenha" autocomplete="${mode === "criar" ? "new-password" : "current-password"}" minlength="6" required></label>` : ""}
    ${mode === "criar" ? `<label class="f">Repita a senha<input type="password" id="aSenha2" autocomplete="new-password" required></label>` : ""}
    <p class="err" id="aErr" ${msg ? "" : "hidden"}>${esc(msg)}</p>
    <button class="btn pri" type="submit" id="aOk">${{ entrar: "Entrar", criar: "Criar conta", esqueci: "Enviar link" }[mode]}</button>
    ${mode === "entrar" ? `<button class="btn ghost" type="button" data-m="esqueci">Esqueci a senha</button>` : mode === "esqueci" ? `<button class="btn ghost" type="button" data-m="entrar">Voltar para entrar</button>` : `<p class="faint" style="margin:0;font-size:12.5px">Já usa o app Landora? Não precisa criar conta: use “Entrar” com o mesmo e-mail e senha do app. Contas novas esperam um administrador aprovar.</p>`}
  </form></div>`;
  const f = $("#af");
  f.querySelectorAll("[data-m]").forEach((b) => b.addEventListener("click", () => authScreen(b.dataset.m)));
  const err = (t) => { const e = $("#aErr"); e.hidden = false; e.textContent = t; };
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = $("#aEmail").value.trim(); const btn = $("#aOk"); btn.disabled = true;
    try {
      if (mode === "esqueci") { await sendPasswordResetEmail(S.fb.auth, email); authScreen("entrar", "Pronto: se esse e-mail tiver conta, o link chega em alguns minutos (veja o spam)."); return; }
      const senha = $("#aSenha").value;
      if (mode === "criar") {
        const nome = $("#aNome").value.trim();
        if (!nome) { err("Digite seu nome."); btn.disabled = false; return; }
        if (senha !== $("#aSenha2").value) { err("As duas senhas estão diferentes."); btn.disabled = false; return; }
        S._novoNome = nome;
        const cred = await createUserWithEmailAndPassword(S.fb.auth, email, senha);
        await updateProfile(cred.user, { displayName: nome }).catch(() => {});
        sendEmailVerification(cred.user).catch(() => {});
      } else await signInWithEmailAndPassword(S.fb.auth, email, senha);
    } catch (ex) { err(AUTH_ERR[ex.code] || "Não deu certo: " + (ex.message || ex.code)); btn.disabled = false; }
  });
}
async function afterLogin(user) {
  S.user = user;
  $("#root").innerHTML = `<div class="auth"><div class="auth-card"><p class="muted" style="margin:0">Entrando…</p></div></div>`;
  const [ac, pf, app] = await Promise.all([getDoc(D("radar_config/acesso")).catch(() => null), getDoc(D("radar_perfis/" + user.uid)).catch(() => null),
    getDoc(D("users/" + user.uid)).catch(() => null)]);
  // Já usa o app Landora: tem cadastro no app e está na lista de acesso do app (config/access).
  // Com a lista do app desligada não há entrada automática (as regras do Firestore exigem o mesmo).
  const appAccess = await getDoc(D("config/access")).catch(() => null);
  const emails = (appAccess?.exists() ? appAccess.data().emails || [] : []).map((x) => String(x).toLowerCase());
  S.appUser = !!app?.exists() && emails.includes((user.email || "").toLowerCase());
  S.acesso = ac?.exists() ? ac.data() : null;
  S.isAdmin = !!S.acesso && (S.acesso.admins || []).map((x) => x.toLowerCase()).includes((user.email || "").toLowerCase());
  S.perfil = pf?.exists() ? pf.data() : null;
  if (!S.perfil) {
    const appNome = S.appUser ? (app.data().nickname || "") : "";
    const nome = S._novoNome || user.displayName || appNome || "";
    const ok = await W(() => setDoc(D("radar_perfis/" + user.uid), { nome, apelido: appNome || nome.split(" ")[0] || "", email: (user.email || "").toLowerCase(), funcao: "", cidades: [], papel: S.isAdmin ? "gestor" : "vendedor", aprovado: S.isAdmin || S.appUser, doApp: S.appUser, criadoEm: nowISO() }));
    if (ok) S.perfil = (await getDoc(D("radar_perfis/" + user.uid))).data();
  }
  S.member = S.isAdmin || (!S.perfil?.bloqueado && (S.perfil?.aprovado === true || S.appUser));
  if (!S.member) return waitingScreen();
  document.body.classList.remove("is-auth");
  shell(); subscribe(); render();
  await loadLeads(); render();
}
function waitingScreen() {
  const semAdmin = !S.acesso;
  $("#root").innerHTML = `<div class="auth"><div class="auth-card">
    <div><div class="eyebrow">Radar de Prospecção</div><h1>${semAdmin ? "Primeiro acesso" : S.perfil?.bloqueado ? "Acesso bloqueado" : "Aguardando aprovação"}</h1></div>
    ${semAdmin ? `<p style="margin:0">O Radar ainda não tem administrador. Se você é o responsável, ative sua conta como administrador: depois é você quem aprova as próximas pessoas.</p>
      <button class="btn pri" id="wAdmin">Sou o administrador: ativar</button>`
      : S.perfil?.bloqueado ? `<p style="margin:0">O acesso da conta <b>${esc(S.user.email)}</b> ao Radar foi bloqueado por um administrador.</p>`
      : `<p style="margin:0">Sua conta <b>${esc(S.user.email)}</b> foi criada. Um administrador do Radar precisa aprovar o acesso na aba Equipe. Esta tela abre sozinha quando for aprovado.</p>
         <p class="faint" style="margin:0;font-size:12.5px">Se você já usa o app Landora, saia e entre com o mesmo e-mail e senha do app: o acesso é liberado na hora.</p>`}
    <button class="btn ghost" id="wOut">Sair</button></div></div>`;
  $("#wOut").addEventListener("click", () => signOut(S.fb.auth));
  $("#wAdmin")?.addEventListener("click", async () => {
    const ok = await W(() => setDoc(D("radar_config/acesso"), { admins: [(S.user.email || "").toLowerCase()], criadoEm: nowISO() }), "Você agora é administrador");
    if (ok) { await W(() => updateDoc(D("radar_perfis/" + S.user.uid), { aprovado: true, papel: "gestor" })); afterLogin(S.user); }
  });
  if (!semAdmin) {
    const u = onSnapshot(D("radar_perfis/" + S.user.uid), (s) => { if (s.data()?.aprovado && !s.data()?.bloqueado) { u(); afterLogin(S.user); } }, () => {});
  }
}

// ============================== estrutura ==============================
function shell() {
  $("#root").innerHTML = `<div class="app"><aside class="side">
    <div class="brand">Radar de Prospecção<small>Landora · busca de clientes</small></div>
    <nav class="nav" id="nav"></nav>
    <div class="side-foot"><div class="me-chip" id="meChip"></div><span id="dataStamp">—</span><button class="btn sm ghost" id="logout" style="color:inherit;justify-content:flex-start;padding-left:8px">Sair</button></div>
  </aside><main><div class="wrap" id="view"></div></main></div><nav class="tabbar" id="tabbar"></nav><div id="layer"></div>`;
  $("#logout").addEventListener("click", () => signOut(S.fb.auth));
}
function route() { const h = (location.hash || "").slice(1); return ROUTES.some((r) => r.k === h) ? h : "inicio"; }
function renderSidebar() {
  const r = route();
  const links = ROUTES.map((x) => `<a href="#${x.k}" ${x.k === r ? 'aria-current="page"' : ""}>${icon(x.i)}<span>${x.l}</span></a>`).join("");
  $("#nav").innerHTML = links; $("#tabbar").innerHTML = links;
  const me = S.perfis[uid()] || S.perfil || {};
  $("#meChip").innerHTML = `<span class="dot" style="background:#6FD3B8"></span><span>${esc(me.apelido || me.nome || S.user.email)}${S.isAdmin ? " · admin" : ""}</span>`;
  $("#dataStamp").textContent = S.meta ? `Base: ${fmtStamp(S.meta.gerado)} · Receita ${S.meta.mes_receita || ""}` : "—";
}
function render() {
  if (!S.member || !$("#view")) return;
  renderSidebar();
  const r = route();
  if (S._mapView && (r !== "mapa" || !S._mapReady)) { S._mapView.remove(); S._mapView = null; }
  if (r === "mapa" && S._mapView) { S._mapRedraw && S._mapRedraw(); return; }
  if (S._open && $("#layer").innerHTML && !S._typing) { const l = findLead(S._open); if (l) drawLead(l); }
  const banner = S.loadErr ? `<div class="notice ${S.leads.length ? "bad" : "warn"}">${esc(S.loadErr)}</div>` : S.loading ? `<div class="notice">Carregando a base de empresas…</div>` : "";
  const scroll = window.scrollY;
  $("#view").innerHTML = banner + ({ inicio: vInicio, busca: vBusca, leads: vLeads, mapa: vMapa, funil: vFunil, metas: vMetas, cidades: vCidades, equipe: vEquipe }[r])();
  ({ busca: wireBusca, leads: wireLeads, mapa: wireMapa, metas: wireMetas, cidades: wireCidades, equipe: wireEquipe, inicio: wireOpeners, funil: wireFunil }[r] || (() => {}))($("#view"));
  if (S._keepScroll) window.scrollTo(0, scroll);
}
window.addEventListener("hashchange", () => { S._keepScroll = false; window.scrollTo(0, 0); render(); S._keepScroll = true; });

// ============================== Hoje ==============================
function planoDoDia(n = 12) {
  const lim = addDays(todayISO(), -3), hoje = todayISO();
  const voltar = allLeads().filter((l) => { const f = F(l); return f.retorno && f.retorno <= hoje && (!f.resp || f.resp === uid()) && !["fechado", "perdido"].includes(f.etapa); });
  const ret = allLeads().filter((l) => { const f = F(l); return !f.retorno && ["contatado", "respondeu", "proposta"].includes(f.etapa) && (f.atualizado || "").slice(0, 10) <= lim && (!f.resp || f.resp === uid()); })
    .sort((a, b) => (F(a).atualizado || "").localeCompare(F(b).atualizado || ""));
  const follow = voltar.concat(ret).slice(0, 6);
  const cid = S.perfis[uid()]?.cidades?.length ? S.perfis[uid()].cidades : null;
  const pool = S.leads.filter((l) => !l.x && l.f === "A" && l.w && stageOf(l) === "novo" && !F(l).resp && !(F(l).tags || []).length && (!cid || cid.includes(l.c)))
    .sort((a, b) => (b.vs === "confirmado") - (a.vs === "confirmado") || b.s - a.s || a._k.localeCompare(b._k));
  const seen = new Map(), nomes = new Set(), novos = [];
  for (const l of pool) { if (nomes.has(l._k) || (seen.get(l.r) || 0) >= 2) continue; nomes.add(l._k); seen.set(l.r, (seen.get(l.r) || 0) + 1); novos.push(l); if (novos.length >= n - follow.length) break; }
  return { follow, novos };
}
function vInicio() {
  const Lx = S.leads.filter((l) => !l.x); const cnt = (f) => Lx.filter((l) => l.f === f).length;
  const fs = Object.values(S.funil);
  const { follow, novos } = planoDoDia();
  const ramos = Object.entries(Lx.filter((l) => l.f === "A").reduce((m, l) => ((m[l.r] = (m[l.r] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const mx = ramos[0]?.[1] || 1; const last = S.execucoes[0];
  const goals = S.metas.slice(0, 3).map((g) => goalProgress(g));
  const me = S.perfis[uid()] || {};
  const row = (l, i, isF) => { const f = F(l); return `<div class="plan-item"><span class="num">${i + 1}</span>
      <div style="min-width:0"><a href="#" data-open="${esc(leadKey(l))}" style="color:var(--ink);font-weight:600;text-decoration:none">${esc(l.n)}</a>
      <div class="faint" style="font-size:12.5px">${esc(l.r)} · ${esc(l.c)} · ${isF ? `<b style="color:var(--b)">${f.retorno ? "voltar a falar (" + fmtDate(f.retorno) + ")" : "retornar"}</b>` : l.vs === "confirmado" ? "verificado online" : l.vs === "nao_encontrado" ? "não achada online" : ""}</div></div>
      ${(l.t || [])[0] ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(l.t[0])}" data-wa="${esc(leadKey(l))}">WhatsApp</a>` : ""}</div>`; };
  return `
  <div class="head"><div><h2>Bom trabalho${me.apelido ? ", " + esc(me.apelido) : ""}</h2>
    <p class="muted">${S.meta ? `${Lx.length.toLocaleString("pt-BR")} empresas sem site em ${S.meta.cidades.map((c) => c.nome).join(", ")}. Base oficial da Receita Federal.` : "Carregando a base…"}</p></div>
    <a class="btn pri" href="#busca">${icon("i-search")} Buscar prospecções</a></div>
  <div class="grid g4">
    <div class="card kpi"><div class="n" style="color:var(--a)">${cnt("A").toLocaleString("pt-BR")}</div><div class="l">Muito fácil de vender</div></div>
    <div class="card kpi"><div class="n" style="color:var(--b)">${cnt("B").toLocaleString("pt-BR")}</div><div class="l">Fácil</div></div>
    <div class="card kpi"><div class="n">${fs.filter((f) => f.etapa && !["novo", "fechado", "perdido"].includes(f.etapa)).length}</div><div class="l">Em negociação</div></div>
    <div class="card kpi"><div class="n" style="color:var(--accent)">${fs.filter((f) => f.etapa === "fechado").length}</div><div class="l">Vendas fechadas</div></div>
  </div>
  <div class="grid g2">
    <div class="card"><div class="row"><div><div class="eyebrow">Plano de hoje</div><h3 style="font-size:17px;margin-top:2px">Quem chamar agora</h3></div><span class="sp"></span>
      <span class="faint" style="font-size:12px">Retornos primeiro, depois os mais fáceis</span></div>
      <div style="margin-top:8px">${follow.map((l, i) => row(l, i, true)).concat(novos.map((l, i) => row(l, i + follow.length, false))).join("") || `<div class="empty">Nada pendente. Use a busca para escolher novos leads.</div>`}</div></div>
    <div class="grid" style="align-content:start">
      <div class="card"><div class="eyebrow">Metas</div>
        ${goals.length ? goals.map((p) => `<div style="margin-top:10px"><div class="row" style="font-size:13.5px"><b>${esc(p.goal.title || p.kind.label)}</b><span class="sp"></span><span class="mono">${p.current}/${p.target}</span></div><div class="bar" style="margin-top:4px"><i style="width:${p.pct}%"></i></div></div>`).join("") : `<p class="muted" style="margin:8px 0 0">Nenhuma meta ainda. <a href="#metas">Criar a primeira</a>.</p>`}</div>
      <div class="card"><div class="eyebrow">Ramos com mais “Muito fácil”</div><div class="bars-mini" style="margin-top:10px">
        ${ramos.map(([r, n]) => `<div class="r"><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r)}</span><i style="width:${Math.max(4, (n / mx) * 100)}%;background:var(--a)"></i><span class="mono">${n}</span></div>`).join("")}</div></div>
      <div class="card" style="font-size:13px"><div class="eyebrow">Atualização automática</div><p style="margin:6px 0 0">${agendaResumo()}</p>
        ${last ? `<p class="muted" style="margin:6px 0 0">Última: ${fmtStamp(last.fim)} · ${esc(last.resumo || "")}</p>` : ""}</div>
    </div>
  </div>`;
}
function agendaResumo() {
  const cs = cityList(); if (!cs.length) return "Sem cidades configuradas.";
  const g = {}; for (const c of cs) { if (c.ativa === false) continue; const k = `${DIAS[c.dia ?? 1]} às ${c.hora || "14:00"}`; (g[k] = g[k] || []).push(c.nome); }
  return Object.entries(g).map(([k, v]) => `<b>${esc(v.join(", "))}</b>: toda ${k.toLowerCase()}`).join(" · ") + ". Se a Receita não publicou base nova, a atualização só confere e termina em segundos.";
}
function wireOpeners(root) {
  root.querySelectorAll("[data-open]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openLead(a.dataset.open); }));
  root.querySelectorAll("[data-wa]").forEach((a) => a.addEventListener("click", () => { const l = findLead(a.dataset.wa); if (l) markMessaged(l); }));
}
async function markMessaged(l) {
  const f = F(l); const tags = [...new Set([...(f.tags || []), "mensagem"])];
  const patch = { tags }; if (!f.etapa || f.etapa === "novo") { await setStage(l, "contatado", true, patch); } else await saveFunil(l, patch);
}

// ============================== Prospecções (busca) ==============================
function parseQuery(t) {
  const terms = [], neg = [], fields = []; const re = /(-)?(?:(\w+):)?(?:"([^"]+)"|(\S+))/g; let m;
  while ((m = re.exec(t))) { const v = norm(m[3] || m[4]); if (!v) continue; if (m[2]) fields.push({ f: norm(m[2]), v, neg: !!m[1] }); else (m[1] ? neg : terms).push(v); }
  return { terms, neg, fields };
}
const FIELD = { ramo: (l) => l.r, cidade: (l) => l.c, bairro: (l) => l.b || l.a, socio: (l) => (l.so || []).join(" ") + " " + (l.d || ""), rua: (l) => l.a, cnpj: (l) => digits(l.id), tel: (l) => (l.t || []).map(digits).join(" "), nome: (l) => l.n + " " + (l.rz || "") };
function filterLeads(q = S.q, base = allLeads()) {
  const p = parseQuery(q.texto); const year = new Date().getFullYear();
  const out = base.filter((l) => {
    if (l.x && !q.descartadas) return false;
    const tags = F(l).tags || [];
    if (q.esconder && tags.some((t) => HIDE_TAGS.includes(t))) return false;
    if (q.org === "fav" && !F(l).fav) return false;
    if (q.org === "nenhuma" && (tags.length || F(l).fav)) return false;
    if (!["todas", "fav", "nenhuma"].includes(q.org) && !tags.includes(q.org)) return false;
    if (q.cidades.length && !q.cidades.includes(l.c)) return false;
    if (q.ramos.length && !q.ramos.includes(l.r)) return false;
    if (!q.faixas.includes(l.f)) return false;
    if (l.s < q.notaMin || l.s > q.notaMax) return false;
    if (q.contato === "whats" && !l.w) return false;
    if (q.contato === "algum" && !(l.t || []).length) return false;
    if (q.contato === "sem" && (l.t || []).length) return false;
    if (q.online === "verificado" && l.vs !== "confirmado") return false;
    if (q.online === "ausente" && l.vs !== "nao_encontrado") return false;
    if (q.online === "nao" && l.vs) return false;
    if (q.online === "plataforma" && !l.pl) return false;
    if (q.conferir && !l.cs) return false;
    if (q.mei === "sim" && !l.mei) return false;
    if (q.mei === "nao" && l.mei) return false;
    if (q.bairro && !norm(l.b || l.a).includes(norm(q.bairro))) return false;
    if (q.idadeMin !== "" || q.idadeMax !== "") { const y = l.ab ? year - +l.ab.slice(-4) : null; if (y === null) return false; if (q.idadeMin !== "" && y < +q.idadeMin) return false; if (q.idadeMax !== "" && y > +q.idadeMax) return false; }
    if (q.etapa !== "todas") { const st = stageOf(l); if (q.etapa === "ativos" ? ["novo", "fechado", "perdido"].includes(st) : st !== q.etapa) return false; }
    if (q.resp !== "todos") { const r = F(l).resp || ""; if (q.resp === "meus" ? r !== uid() : q.resp === "livres" ? !!r : r !== q.resp) return false; }
    for (const t of p.terms) if (!l._t.includes(t)) return false;
    for (const t of p.neg) if (l._t.includes(t)) return false;
    for (const f of p.fields) { const g = FIELD[f.f]; const hit = g ? norm(g(l)).includes(f.v) || (/\d/.test(f.v) && digits(g(l)).includes(f.v)) : l._t.includes(f.v); if (hit === f.neg) return false; }
    return true;
  });
  const yr = (l, d) => +(l.ab || "").slice(-4) || d;
  const by = {
    facil_az: (a, b) => a.f.localeCompare(b.f) || a._k.localeCompare(b._k), dificil_az: (a, b) => b.f.localeCompare(a.f) || a._k.localeCompare(b._k),
    nota_desc: (a, b) => b.s - a.s || a._k.localeCompare(b._k), nota_asc: (a, b) => a.s - b.s || a._k.localeCompare(b._k),
    az: (a, b) => a._k.localeCompare(b._k), za: (a, b) => b._k.localeCompare(a._k),
    novas: (a, b) => yr(b, 0) - yr(a, 0) || b.s - a.s, antigas: (a, b) => yr(a, 9999) - yr(b, 9999) || b.s - a.s };
  return out.sort(by[q.ordem] || by.facil_az);
}
const ramosAll = () => [...new Set(S.leads.map((l) => l.r))].sort((a, b) => a.localeCompare(b));
const cidadesAll = () => [...new Set(S.leads.map((l) => l.c))].sort();
const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(cur) === String(v) ? "selected" : ""}>${l}</option>`;
function vBusca() {
  const q = S.q; const saved = pref.get("buscas", []);
  return `
  <div class="head"><div><h2>Prospecções</h2><p class="muted">Busque por nome, sócio, rua, bairro, CNPJ ou telefone. Use aspas para frases, <span class="mono">-palavra</span> para excluir e campos como <span class="mono">ramo:pizza</span>, <span class="mono">bairro:centro</span>, <span class="mono">socio:silva</span>.</p></div></div>
  <div class="card grid" style="gap:12px">
    <div class="search-bar"><input type="search" id="qText" placeholder="Ex.: hamburgueria centro -franquia" value="${esc(q.texto)}" aria-label="Buscar">
      <select id="qOrdem" aria-label="Ordem" style="flex:0 1 240px">
        ${opt("facil_az", "Mais fácil primeiro (A–Z)", q.ordem)}${opt("dificil_az", "Mais difícil primeiro (A–Z)", q.ordem)}${opt("nota_desc", "Maior nota primeiro", q.ordem)}${opt("nota_asc", "Menor nota primeiro", q.ordem)}${opt("az", "Nome A–Z", q.ordem)}${opt("za", "Nome Z–A", q.ordem)}${opt("novas", "Abertas há menos tempo", q.ordem)}${opt("antigas", "Mais antigas", q.ordem)}
      </select></div>
    <div class="row"><span class="eyebrow">Facilidade</span><div class="chips" id="qFaixas">${["A", "B", "C"].map((f) => `<button class="chip" data-f="${f}" aria-pressed="${q.faixas.includes(f)}">${FX[f].l}</button>`).join("")}</div>
      <span class="sp"></span><div class="chips" id="qCids">${cidadesAll().map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${q.cidades.includes(c)}">${esc(c)}</button>`).join("")}</div></div>
    <details class="adv" ${pref.get("advOpen", false) ? "open" : ""} id="adv"><summary>${icon("i-funnel")}<span>Busca avançada</span></summary>
      <div class="filters">
        <label class="f">Contato<select id="qContato">${opt("todos", "Todos", q.contato)}${opt("whats", "Com WhatsApp", q.contato)}${opt("algum", "Com algum telefone", q.contato)}${opt("sem", "Sem telefone (visita)", q.contato)}</select></label>
        <label class="f">Na internet<select id="qOnline">${opt("todos", "Todos", q.online)}${opt("verificado", "Verificado (Instagram/Facebook)", q.online)}${opt("ausente", "Não achada online", q.online)}${opt("nao", "Ainda não verificada", q.online)}${opt("plataforma", "Usa Goomer/Anota AI etc.", q.online)}</select></label>
        <label class="f">Organização<select id="qOrg">${opt("todas", "Todas", q.org)}${opt("fav", "Favoritos", q.org)}${opt("nenhuma", "Sem nenhuma marcação", q.org)}${TAGS.map((t) => opt(t.k, t.l, q.org)).join("")}</select></label>
        <label class="f">Etapa do funil<select id="qEtapa">${opt("todas", "Todas", q.etapa)}${opt("ativos", "Em negociação", q.etapa)}${STAGES.map((s) => opt(s.k, s.l, q.etapa)).join("")}</select></label>
        <label class="f">Responsável<select id="qResp">${opt("todos", "Todos", q.resp)}${opt("meus", "Os meus", q.resp)}${opt("livres", "Sem responsável", q.resp)}${Object.entries(S.perfis).filter(([, p]) => p.aprovado).map(([id, p]) => opt(id, esc(p.apelido || p.nome), q.resp)).join("")}</select></label>
        <label class="f">MEI<select id="qMei">${opt("todos", "Todos", q.mei)}${opt("sim", "Só MEI", q.mei)}${opt("nao", "Sem MEI", q.mei)}</select></label>
        <label class="f">Bairro<input type="text" id="qBairro" value="${esc(q.bairro)}" placeholder="Ex.: Centro"></label>
        <label class="f">Nota de facilidade (mín–máx)<div class="row" style="flex-wrap:nowrap"><input type="number" id="qNMin" min="0" max="100" value="${q.notaMin}"><input type="number" id="qNMax" min="0" max="100" value="${q.notaMax}"></div></label>
        <label class="f">Anos de empresa (mín–máx)<div class="row" style="flex-wrap:nowrap"><input type="number" id="qIMin" min="0" value="${q.idadeMin}" placeholder="0"><input type="number" id="qIMax" min="0" value="${q.idadeMax}" placeholder="∞"></div></label>
        <label class="f" style="grid-column:1/-1">Ramos <span class="faint">(nenhum marcado = todos)</span><div class="chips" id="qRamos">${ramosAll().map((r) => `<button class="chip" data-r="${esc(r)}" aria-pressed="${q.ramos.includes(r)}">${esc(r)}</button>`).join("")}</div></label>
        <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="qEsc" ${q.esconder ? "checked" : ""}> Esconder quem já comprou com outro, já tem site ou número errado</label>
        <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="qConf" ${q.conferir ? "checked" : ""}> Só com domínio a conferir</label>
        <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="qDesc" ${q.descartadas ? "checked" : ""}> Mostrar descartadas pela Receita (site / franquia)</label>
      </div></details>
    <div class="row"><span id="qCount" class="muted"></span><span class="sp"></span>
      <select id="qSaved" aria-label="Buscas salvas" style="width:auto"><option value="">Buscas salvas…</option>${saved.map((s, i) => `<option value="${i}">${esc(s.nome)}</option>`).join("")}</select>
      <button class="btn sm" id="qSave">Salvar busca</button><button class="btn sm" id="qClear">Limpar</button>
      <button class="btn sm" id="qMap">${icon("i-map")} Ver no mapa</button><button class="btn sm" id="qCsv">Baixar CSV</button></div>
  </div>
  <div class="list" id="results"></div>`;
}
function renderResults() {
  const el = $("#results"); if (!el) return;
  const res = filterLeads(); $("#qCount").textContent = `${res.length.toLocaleString("pt-BR")} empresa${res.length === 1 ? "" : "s"}`;
  const grouped = S.q.ordem === "facil_az" || S.q.ordem === "dificil_az"; let html = "", lastF = null;
  for (const l of res.slice(0, S.page)) {
    if (grouped && l.f !== lastF) { lastF = l.f; html += `<div class="group-h"><span class="pill ${FX[l.f].c}">${FX[l.f].l}</span><h3>${res.filter((x) => x.f === l.f).length.toLocaleString("pt-BR")} empresas</h3></div>`; }
    html += leadRow(l);
  }
  if (!res.length) html = `<div class="empty">Nenhuma empresa com esses filtros. Tente tirar um filtro ou usar menos palavras.</div>`;
  if (res.length > S.page) html += `<button class="btn" id="more" style="justify-self:center">Mostrar mais ${Math.min(60, res.length - S.page)}</button>`;
  el.innerHTML = html; wireRows(el);
  $("#more")?.addEventListener("click", () => { S.page += 60; renderResults(); });
}
function wireRows(el) {
  wireOpeners(el);
  el.querySelectorAll(".lead").forEach((r) => r.addEventListener("click", (e) => { if (e.target.closest("a,button")) return; openLead(r.dataset.k); }));
  el.querySelectorAll("[data-star]").forEach((b) => b.addEventListener("click", () => { const l = findLead(b.dataset.star); if (l) toggleFav(l); }));
}
function leadRow(l) {
  const f = F(l), st = stageOf(l), tel = (l.t || [])[0];
  const online = l._manual ? `<span class="pill pM">Adicionada no mapa</span>` : l.vs === "confirmado" ? `<span class="pill pN">Verificada online</span>` : l.vs === "nao_encontrado" ? `<span class="pill pB">Não achada online</span>` : "";
  const tags = (f.tags || []).map((t) => `<span class="pill pC">${esc(TAGS.find((x) => x.k === t)?.l || t)}${t === "voltar" && f.retorno ? " " + fmtDate(f.retorno) : ""}</span>`).join("");
  return `<div class="lead" data-k="${esc(leadKey(l))}" tabindex="0">
    <div class="score" style="background:var(--${l.f.toLowerCase()}-soft);color:var(--${l.f.toLowerCase()})" title="Nota de facilidade">${l.s}</div>
    <div style="min-width:0"><div class="nm">${esc(l.n)}</div><div class="sub">${esc(l.r)} · <b>${esc(l.c)}</b>${l.x ? ` · <span style="color:var(--bad)">${esc(l.x)}</span>` : ""}</div></div>
    <div class="c3 sub" style="min-width:0">${esc(l.a || "")}</div>
    <div class="c4">${online}${st !== "novo" ? `<span class="pill pC">${STAGES.find((s) => s.k === st).l}${f.resp ? " · " + esc(nick(f.resp)) : ""}</span>` : ""}${tags}${l.cs ? `<span class="pill pX" title="Existe ${esc(l.cs)}">Conferir site</span>` : ""}</div>
    <div class="row" style="gap:4px;flex-wrap:nowrap"><button class="star" data-star="${esc(leadKey(l))}" aria-pressed="${!!f.fav}" aria-label="Favorito" title="Favorito">★</button>${tel ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(tel)}" data-wa="${esc(leadKey(l))}" title="${esc(tel)}">${isCel(tel) ? "WhatsApp" : "Ligar"}</a>` : `<span class="pill pC">Visitar</span>`}</div>
  </div>`;
}
function wireBusca() {
  const q = S.q; let t = null; const upd = () => { S.page = 60; pref.set("q", q); renderResults(); };
  $("#qText").addEventListener("input", (e) => { q.texto = e.target.value; clearTimeout(t); t = setTimeout(upd, 160); });
  $("#qOrdem").addEventListener("change", (e) => { q.ordem = e.target.value; upd(); });
  const tog = (sel, attr, arr) => $(sel).addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; const v = b.dataset[attr]; const i = q[arr].indexOf(v); i >= 0 ? q[arr].splice(i, 1) : q[arr].push(v); b.setAttribute("aria-pressed", i < 0); upd(); });
  tog("#qFaixas", "f", "faixas"); tog("#qCids", "c", "cidades"); tog("#qRamos", "r", "ramos");
  const bind = (id, key, num) => $(id).addEventListener("input", (e) => { q[key] = num ? (e.target.value === "" ? "" : +e.target.value) : e.target.value; clearTimeout(t); t = setTimeout(upd, 200); });
  bind("#qContato", "contato"); bind("#qOnline", "online"); bind("#qOrg", "org"); bind("#qEtapa", "etapa"); bind("#qResp", "resp"); bind("#qMei", "mei"); bind("#qBairro", "bairro");
  bind("#qNMin", "notaMin", 1); bind("#qNMax", "notaMax", 1); bind("#qIMin", "idadeMin", 1); bind("#qIMax", "idadeMax", 1);
  $("#qConf").addEventListener("change", (e) => { q.conferir = e.target.checked; upd(); });
  $("#qDesc").addEventListener("change", (e) => { q.descartadas = e.target.checked; upd(); });
  $("#qEsc").addEventListener("change", (e) => { q.esconder = e.target.checked; upd(); });
  $("#adv").addEventListener("toggle", (e) => pref.set("advOpen", e.target.open));
  $("#qClear").addEventListener("click", () => { S.q = { ...DEFAULT_Q, cidades: [], ramos: [], faixas: ["A", "B", "C"] }; pref.set("q", S.q); render(); });
  $("#qMap").addEventListener("click", () => { pref.set("mapUseFilter", true); location.hash = "mapa"; });
  $("#qSave").addEventListener("click", () => modal(`<h3>Salvar esta busca</h3><label class="f">Nome<input type="text" id="svName" placeholder="Ex.: Hamburguerias Itapeva com WhatsApp"></label>
    <div class="row"><span class="sp"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="svOk">Salvar</button></div>`, (m) => {
    $("#svOk", m).addEventListener("click", () => { const b = pref.get("buscas", []); b.push({ nome: $("#svName", m).value.trim() || "Busca " + (b.length + 1), q: JSON.parse(JSON.stringify(q)) }); pref.set("buscas", b); closeLayer(); render(); toast("Busca salva neste aparelho"); }); }));
  $("#qSaved").addEventListener("change", (e) => { const b = pref.get("buscas", [])[+e.target.value]; if (b) { S.q = { ...DEFAULT_Q, ...b.q }; pref.set("q", S.q); render(); } });
  $("#qCsv").addEventListener("click", () => exportCsv(filterLeads()));
  renderResults();
}
function exportCsv(res) {
  const cols = ["Facilidade", "Nota", "Empresa", "Ramo", "Cidade", "Telefone", "WhatsApp", "E-mail", "Decisor", "Endereço", "Instagram", "Facebook", "Na internet", "Etapa", "Marcações", "Voltar em", "Responsável", "Anotação", "CNPJ", "Aberta em"];
  const rows = res.map((l) => { const f = F(l); return [FX[l.f].l, l.s, l.n, l.r, l.c, (l.t || []).join(" / "), l.w ? "sim" : "não", l.e || "", l.d || "", l.a || "", l.ig || "", l.fb || "",
    l.vs === "confirmado" ? "verificada" : l.vs === "nao_encontrado" ? "não achada" : "", STAGES.find((s) => s.k === stageOf(l)).l, [f.fav ? "Favorito" : "", ...(f.tags || []).map((t) => TAGS.find((x) => x.k === t)?.l || t)].filter(Boolean).join(", "),
    f.retorno || "", f.resp ? nick(f.resp) : "", f.nota || "", l._manual ? "" : l.id, l.ab || ""]; });
  const csv = "﻿" + [cols].concat(rows).map((r) => r.map((v) => { v = String(v ?? ""); return /[;"\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(";")).join("\n");
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = `prospeccoes_${todayISO()}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ============================== Meus leads (organização) ==============================
function leadLists() {
  const all = allLeads(); const hoje = todayISO();
  const withF = all.filter((l) => S.funil[leadKey(l)]);
  const lists = [
    { k: "fav", l: "Favoritos", items: withF.filter((l) => F(l).fav) },
    { k: "hoje", l: "Voltar a falar: hoje e atrasados", items: withF.filter((l) => F(l).retorno && F(l).retorno <= hoje && !["fechado", "perdido"].includes(F(l).etapa)) },
    ...TAGS.map((t) => ({ k: t.k, l: t.l, items: withF.filter((l) => hasTag(l, t.k)) })),
    { k: "meus", l: "Sob minha responsabilidade", items: withF.filter((l) => F(l).resp === uid() && !["fechado", "perdido"].includes(F(l).etapa)) },
    { k: "vendas", l: "Vendas fechadas", items: withF.filter((l) => F(l).etapa === "fechado") },
  ];
  for (const x of lists) x.items.sort((a, b) => (x.k === "hoje" || x.k === "voltar" ? (F(a).retorno || "").localeCompare(F(b).retorno || "") : (F(b).atualizado || "").localeCompare(F(a).atualizado || "")));
  return lists;
}
function vLeads() {
  const lists = leadLists(); const cur = pref.get("leadList", "fav"); const sel = lists.find((x) => x.k === cur) || lists[0];
  const fq = (S._leadsQ || "");
  const items = fq ? sel.items.filter((l) => l._t.includes(norm(fq))) : sel.items;
  const hoje = todayISO();
  return `<div class="head"><div><h2>Meus leads</h2><p class="muted">Organize quem já recebeu mensagem, quem respondeu, quando voltar a falar e quem já comprou com outro. As marcações são da equipe toda.</p></div>
    <button class="btn sm" id="lCsv">Baixar esta lista (CSV)</button></div>
  <div class="lists">
    <nav aria-label="Listas">${lists.map((x) => `<button data-list="${x.k}" aria-pressed="${x.k === sel.k}"><span>${esc(x.l)}</span><span class="pill ${x.k === "hoje" && x.items.length ? "pX" : "pC"}">${x.items.length}</span></button>`).join("")}</nav>
    <div class="grid" style="gap:10px;min-width:0">
      <div class="row"><h3 style="font-size:17px">${esc(sel.l)}</h3><span class="sp"></span><input type="search" id="lQ" placeholder="Filtrar esta lista" value="${esc(fq)}" style="width:min(260px,100%)"></div>
      <div class="card tbl-wrap" style="padding:0"><table class="t"><thead><tr><th></th><th>Empresa</th><th>Etapa</th><th>Marcações</th><th>Voltar em</th><th>Responsável</th><th>Última anotação</th><th></th></tr></thead><tbody>
      ${items.map((l) => { const f = F(l); const late = f.retorno && f.retorno < hoje; return `<tr>
        <td><button class="star" data-star="${esc(leadKey(l))}" aria-pressed="${!!f.fav}" aria-label="Favorito">★</button></td>
        <td style="min-width:180px"><a href="#" data-open="${esc(leadKey(l))}" style="color:var(--ink);font-weight:600;text-decoration:none">${esc(l.n)}</a><div class="faint" style="font-size:12px">${esc(l.r)} · ${esc(l.c)}</div></td>
        <td>${esc(STAGES.find((s) => s.k === stageOf(l)).l)}</td>
        <td style="min-width:160px">${(f.tags || []).map((t) => `<span class="pill pC" style="margin:1px">${esc(TAGS.find((x) => x.k === t)?.l || t)}</span>`).join("")}${f.concorrente ? `<div class="faint" style="font-size:12px">Comprou com: ${esc(f.concorrente)}</div>` : ""}</td>
        <td class="${late ? "late" : ""}">${f.retorno ? fmtDate(f.retorno) + (late ? " · atrasado" : "") : ""}</td>
        <td>${f.resp ? esc(nick(f.resp)) : '<span class="faint">—</span>'}</td>
        <td class="faint" style="font-size:12.5px;max-width:260px">${esc((f.nota || "").slice(0, 90))}</td>
        <td>${(l.t || [])[0] ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(l.t[0])}" data-wa="${esc(leadKey(l))}">WhatsApp</a>` : ""}</td></tr>`; }).join("") || `<tr><td colspan="8" class="muted" style="padding:20px">Nenhum lead aqui. Na ficha de uma empresa, marque com a estrela ou use os botões de organização.</td></tr>`}
      </tbody></table></div>
    </div></div>`;
}
function wireLeads(root) {
  wireRows(root);
  root.querySelectorAll("[data-list]").forEach((b) => b.addEventListener("click", () => { pref.set("leadList", b.dataset.list); S._leadsQ = ""; render(); }));
  let t; $("#lQ").addEventListener("input", (e) => { S._leadsQ = e.target.value; clearTimeout(t); t = setTimeout(() => { render(); const i = $("#lQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); });
  $("#lCsv").addEventListener("click", () => { const lists = leadLists(); const sel = lists.find((x) => x.k === pref.get("leadList", "fav")) || lists[0]; exportCsv(sel.items); });
}

// ============================== Ficha ==============================
function openLead(k) { const l = findLead(k); if (!l) return; S._open = k; drawLead(l); }
function drawLead(l) {
  const k = leadKey(l), f = F(l), st = f.etapa || "novo", tags = f.tags || [];
  const tels = (l.t || []).map((t) => `<div class="row" style="gap:6px"><span class="mono">${esc(t)}</span>${isCel(t) ? `<a class="btn sm" target="_blank" rel="noopener" href="${waLink(t)}" data-wa="${esc(k)}">WhatsApp</a>` : ""}<button class="btn sm ghost" data-copy="${esc(t)}">Copiar</button></div>`).join("")
    || `<span style="color:var(--bad)">Sem telefone confiável: o cadastro só tem o número do contador. Melhor visitar.</span>`;
  const hist = (f.hist || []).slice().reverse().slice(0, 8).map((h) => `<div class="faint" style="font-size:12.5px">${fmtStamp(h.em)} · ${esc(nick(h.por))} · ${esc(STAGES.find((s) => s.k === h.e)?.l || TAGS.find((s) => s.k === h.e)?.l || h.e)}</div>`).join("");
  const gm = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(l.n + " " + (l.a || "") + " " + l.c)}`;
  const focusId = document.activeElement?.id;
  layer(`<div class="drawer-bg" data-close></div><aside class="drawer" role="dialog" aria-label="${esc(l.n)}">
    <div class="row" style="align-items:flex-start"><div style="min-width:0;flex:1"><div class="row" style="gap:6px"><span class="pill ${FX[l.f].c}">${FX[l.f].l} · ${l.s}</span>${l._manual ? '<span class="pill pM">Adicionada no mapa</span>' : ""}${l.x ? `<span class="pill pX">${esc(l.x)}</span>` : ""}</div>
      <h2 style="font-size:22px;margin-top:8px">${esc(l.n)}</h2>${l.rz ? `<div class="muted" style="font-size:13px">${esc(l.rz)}</div>` : ""}</div>
      <button class="star" id="dStar" aria-pressed="${!!f.fav}" aria-label="Favorito" title="Favorito" style="font-size:26px">★</button>
      <button class="btn ghost" data-close aria-label="Fechar">✕</button></div>
    <div class="card" style="padding:12px;display:grid;gap:8px"><div class="eyebrow">Contato</div>${tels}${l.e ? `<div class="row"><span class="mono" style="font-size:13px">${esc(l.e)}</span><button class="btn sm ghost" data-copy="${esc(l.e)}">Copiar</button></div>` : ""}</div>
    <div><div class="eyebrow" style="margin-bottom:6px">Organização</div>
      <div class="tagbar" id="dTags">${TAGS.map((t) => `<button class="tag" data-t="${t.k}" aria-pressed="${tags.includes(t.k)}">${t.l}</button>`).join("")}</div>
      <div class="grid g2" style="margin-top:8px"><label class="f">Voltar a falar em<input type="date" id="dRet" value="${esc(f.retorno || "")}"></label>
        <label class="f">Comprou com quem (se já comprou)<input type="text" id="dConc" value="${esc(f.concorrente || "")}" placeholder="Ex.: agência X, sobrinho"></label></div></div>
    <div><div class="eyebrow" style="margin-bottom:6px">Etapa no funil ${f.resp ? `· responsável: <b>${esc(nick(f.resp))}</b>` : ""}</div>
      <div class="stages" id="stg">${STAGES.map((s) => `<button class="stage" data-s="${s.k}" aria-pressed="${s.k === st}">${s.l}</button>`).join("")}</div>
      <div class="row" style="margin-top:8px">${f.resp === uid() ? `<button class="btn sm" id="unclaim">Largar este lead</button>` : `<button class="btn sm" id="claim">${f.resp ? "Assumir no lugar de " + esc(nick(f.resp)) : "Assumir este lead"}</button>`}${hist ? `<details style="font-size:12.5px"><summary class="faint" style="cursor:pointer">Histórico</summary>${hist}</details>` : ""}</div></div>
    <label class="f">Anotações da equipe<textarea id="nota" placeholder="Ex.: falei com a dona, pediu retorno sexta à tarde">${esc(f.nota || "")}</textarea></label>
    <div class="row"><span class="sp"></span><button class="btn sm" id="saveNota">Salvar anotação e datas</button></div>
    <div class="card" style="padding:12px;display:grid;gap:8px"><div class="row"><div class="eyebrow">Abordagem sugerida</div><span class="sp"></span><button class="btn sm pri" id="msgBtn">Montar mensagem</button></div>
      <div style="font-size:13.5px"><b>Gancho:</b> ${esc(GANCHO[l.r] || "Site próprio com WhatsApp e Google: ser encontrado por quem procura.")}</div><div id="msgOut"></div></div>
    <dl class="kv">
      <dt>Ramo</dt><dd>${esc(l.r)}</dd><dt>Cidade</dt><dd>${esc(l.c)}${l.uf ? "/" + esc(l.uf) : ""}</dd>
      <dt>Endereço</dt><dd>${esc(l.a || "—")} · <a href="${gm}" target="_blank" rel="noopener">abrir no Google Maps</a></dd>
      ${l.d ? `<dt>Decisor</dt><dd>${esc(l.d)}</dd>` : ""}${(l.so || []).length > 1 ? `<dt>Sócios</dt><dd>${l.so.map(esc).join("<br>")}</dd>` : ""}
      <dt>Na internet</dt><dd>${l.vs === "confirmado" ? `Verificada${l.vd ? " em " + fmtDate(l.vd) : ""}. ` : l.vs === "nao_encontrado" ? "Não achada no Instagram nem no Facebook: argumento de venda. " : "Ainda não verificada. "}
        ${l.ig ? `<a target="_blank" rel="noopener" href="https://instagram.com/${esc(l.ig.replace("@", ""))}">${esc(l.ig)}</a> ` : ""}${l.fb ? `<a target="_blank" rel="noopener" href="https://${esc(l.fb.replace(/^https?:\/\//, ""))}">Facebook</a> ` : ""}${l.pl ? `· usa ${esc(l.pl)} ` : ""}${l.ob ? `<div class="faint">${esc(l.ob)}</div>` : ""}</dd>
      ${l.cs ? `<dt>Atenção</dt><dd style="color:var(--bad)">Existe o domínio ${esc(l.cs)}. Confira se o site está no ar antes do contato.</dd>` : ""}
      <dt>Por que essa nota</dt><dd>${(l.pq || []).map(esc).join(" · ") || "—"}</dd>
      ${l.id && !l._manual ? `<dt>CNPJ</dt><dd class="mono">${esc(l.id)} <button class="btn sm ghost" data-copy="${esc(l.id)}">Copiar</button></dd>` : ""}
      ${l.ab ? `<dt>Aberta em</dt><dd>${esc(l.ab)}${l.po ? " · " + esc(l.po) : ""}${l.mei ? " · MEI" : ""}</dd>` : ""}
      ${l._manual ? `<dt>Adicionada por</dt><dd>${esc(nick(l._manual.por))} em ${fmtStamp(l._manual.em)}. Fica até a próxima atualização, quando é procurada na Receita${l._manual.status === "nao_encontrado" ? " (na última não foi achada)" : ""}.</dd>` : ""}
    </dl>
    <div class="row">${!l._manual && !l.vs ? `<button class="btn sm" id="askVerif">Pedir verificação online</button>` : ""}${l._manual && (l._manual.por === uid() || S.isAdmin) ? `<button class="btn sm danger" id="delMan">Apagar prospecção</button>` : ""}</div>
  </aside>`, (el) => {
    wireOpeners(el);
    el.querySelectorAll("[data-copy]").forEach((b) => b.addEventListener("click", async () => { try { await navigator.clipboard.writeText(b.dataset.copy); toast("Copiado"); } catch (e) { toast("Selecione e copie: " + b.dataset.copy); } }));
    $("#dStar", el).addEventListener("click", () => toggleFav(l));
    $("#dTags", el).addEventListener("click", (e) => { const b = e.target.closest("[data-t]"); if (b) toggleTag(l, b.dataset.t); });
    $("#stg", el).addEventListener("click", (e) => { const b = e.target.closest("[data-s]"); if (b) setStage(l, b.dataset.s); });
    $("#claim", el)?.addEventListener("click", () => saveFunil(l, { resp: uid() }, "Lead assumido"));
    $("#unclaim", el)?.addEventListener("click", () => saveFunil(l, { resp: "" }, "Lead liberado"));
    el.querySelectorAll("textarea,input").forEach((i) => { i.addEventListener("focus", () => { S._typing = true; }); i.addEventListener("blur", () => { S._typing = false; }); });
    $("#saveNota", el).addEventListener("click", () => { const ret = $("#dRet", el).value; const f2 = F(l); let tags = f2.tags || [];
      if (ret && !tags.includes("voltar")) tags = [...tags, "voltar"]; if (!ret) tags = tags.filter((t) => t !== "voltar");
      const conc = $("#dConc", el).value.trim(); if (conc && !tags.includes("comprou_outro")) tags = [...tags, "comprou_outro"];
      saveFunil(l, { nota: $("#nota", el).value, retorno: ret, concorrente: conc, tags }, "Salvo"); });
    $("#msgBtn", el).addEventListener("click", () => showMsg(l, el, 0));
    $("#askVerif", el)?.addEventListener("click", () => W(() => addDoc(C("radar_pedidos"), { tipo: "verificar", alvo: l.id, nome: l.n, por: uid(), em: nowISO(), status: "pendente" }), "Pedido registrado: será verificada na próxima atualização"));
    $("#delMan", el)?.addEventListener("click", () => confirmBox("Apagar esta prospecção do mapa?", () => W(() => deleteDoc(D("radar_manuais/" + l._manual.id)), "Prospecção apagada").then(closeLayer)));
    if (focusId && $("#" + focusId, el)) $("#" + focusId, el).focus();
  });
}
async function saveFunil(l, patch, msg) {
  const k = leadKey(l); const cur = S.funil[k] || {};
  const body = { ...cur, nome: l.n, cidade: l.c, ...patch, atualizado: nowISO(), por: uid() }; delete body.id;
  return W(() => setDoc(D("radar_funil/" + k), body), msg);
}
async function setStage(l, s, silent, extra = {}) {
  const cur = F(l); if (cur.etapa === s && !Object.keys(extra).length) return;
  const hist = (cur.hist || []).concat([{ e: s, em: nowISO(), por: uid() }]).slice(-30);
  const patch = { etapa: s, hist, ...extra }; if (!cur.resp) patch.resp = uid();
  const ok = await saveFunil(l, patch, silent ? "Marcado: mensagem enviada" : "Etapa: " + STAGES.find((x) => x.k === s).l);
  if (ok && cur.etapa !== s) { if (!cur.etapa || cur.etapa === "novo") await logEvent("prospeccao", l); if (STAGE_EVENT[s]) await logEvent(STAGE_EVENT[s], l); }
}
async function toggleFav(l) { const f = F(l); await saveFunil(l, { fav: !f.fav }, f.fav ? "Tirado dos favoritos" : "Adicionado aos favoritos"); }
async function toggleTag(l, t) {
  const f = F(l); const has = (f.tags || []).includes(t); const tags = has ? f.tags.filter((x) => x !== t) : [...(f.tags || []), t];
  const patch = { tags, hist: (f.hist || []).concat(has ? [] : [{ e: t, em: nowISO(), por: uid() }]).slice(-30) };
  if (!has && t === "respondeu" && ["novo", "contatado"].includes(f.etapa || "novo")) return setStage(l, "respondeu", false, patch);
  if (!has && t === "mensagem" && (f.etapa || "novo") === "novo") return setStage(l, "contatado", true, patch);
  if (!has && (t === "comprou_outro" || t === "sem_interesse") && !["fechado"].includes(f.etapa)) patch.etapa = "perdido";
  await saveFunil(l, patch, (has ? "Desmarcado: " : "Marcado: ") + TAGS.find((x) => x.k === t).l);
}
function showMsg(l, el, v) {
  const me = S.perfis[uid()] || {}; const quem = me.apelido || me.nome || "";
  const pessoa = (l.d || "").replace(/\s*\(.*$/, "").split(";")[0].trim().split(" ")[0];
  const oi = pessoa && !/ltda|eireli|me$/i.test(pessoa) ? `Oi, ${pessoa[0].toUpperCase() + pessoa.slice(1).toLowerCase()}! ` : "Olá! ";
  const eu = quem ? `Aqui é ${quem}, da Landora. ` : "Aqui é da Landora. ";
  const ganho = (GANCHO[l.r] || "um site próprio com WhatsApp e Google").replace(/\.$/, "");
  const online = l.vs === "nao_encontrado" ? `Procurei a ${l.n} no Google e não achei uma página de vocês, então quem procura acaba indo para a concorrência. ` : l.ig ? `Vi o Instagram de vocês (${l.ig}) e dá para transformar esse público em pedidos com um site próprio. ` : "";
  const msgs = [
    `${oi}${eu}A gente faz sites para negócios de ${l.c}. ${online}Para ${l.r.toLowerCase()} costuma funcionar assim: ${ganho.charAt(0).toLowerCase() + ganho.slice(1)}. Posso te mandar um exemplo rápido?`,
    `${oi}${eu}${online}Montamos sites e páginas simples para empresas da região, com botão de WhatsApp e aparecendo no Google. Para a ${l.n} eu pensei em: ${ganho.charAt(0).toLowerCase() + ganho.slice(1)}. Faz sentido conversar 5 minutos essa semana?`,
    `${oi}${eu}Estou falando com empresas de ${l.r.toLowerCase()} em ${l.c} que ainda não têm site. ${online}Quer ver como ficaria a página da ${l.n}? Monto um modelo sem compromisso.`];
  const text = msgs[v % msgs.length]; const tel = (l.t || []).find(isCel);
  const out = $("#msgOut", el);
  out.innerHTML = `<div class="msg">${esc(text)}</div><div class="row" style="margin-top:6px"><button class="btn sm" id="cpMsg">Copiar</button>${tel ? `<a class="btn sm pri" target="_blank" rel="noopener" href="${waLink(tel, text)}" data-wa="${esc(leadKey(l))}">Abrir no WhatsApp com a mensagem</a>` : ""}<button class="btn sm ghost" id="again">Outra versão</button></div>`;
  $("#cpMsg", out).addEventListener("click", async () => { try { await navigator.clipboard.writeText(text); toast("Mensagem copiada"); } catch (e) { toast("Selecione o texto para copiar"); } });
  $("#again", out).addEventListener("click", () => showMsg(l, el, v + 1)); wireOpeners(out);
}

// ============================== camadas ==============================
function layer(html, wire) { const Lr = $("#layer"); Lr.innerHTML = html; Lr.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", closeLayer)); wire && wire(Lr); }
function closeLayer() { const Lr = $("#layer"); if (Lr) Lr.innerHTML = ""; S._open = null; S._typing = false; }
function modal(inner, wire) { S._open = null; layer(`<div class="modal-bg"><div class="modal" role="dialog">${inner}</div></div>`, (Lr) => { Lr.querySelector(".modal-bg").addEventListener("click", (e) => { if (e.target.classList.contains("modal-bg")) closeLayer(); }); wire && wire(Lr); }); }
function confirmBox(text, onYes) { modal(`<p style="margin:0">${esc(text)}</p><div class="row"><span class="sp"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="yes">Confirmar</button></div>`, (m) => $("#yes", m).addEventListener("click", () => { closeLayer(); onYes(); })); }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeLayer(); if (e.key === "Enter" && e.target.classList?.contains("lead")) openLead(e.target.dataset.k); });

// ============================== Mapa ==============================
const slug = (t) => norm(t).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
function vMapa() {
  return `<div class="head"><div><h2>Mapa</h2><p class="muted">Clique num ponto para abrir a ficha. Ative “Adicionar no mapa” e clique onde está uma empresa que não aparece: ela entra no banco de dados e fica até a próxima atualização.</p></div></div>
  <div class="card grid" style="gap:10px">
    <div class="row"><div class="chips" id="mCities"></div><label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="mUseF" ${pref.get("mapUseFilter", true) ? "checked" : ""}> Usar os filtros da busca</label>
      <span class="sp"></span><button class="btn sm" id="mAdd" aria-pressed="false">+ Adicionar no mapa</button><button class="btn sm" id="mRoute">Montar rota de visitas</button></div>
    <div id="map" role="application" aria-label="Mapa das prospecções"></div>
    <div class="map-legend"><span><span class="dot" style="background:var(--a)"></span> Muito fácil</span><span><span class="dot" style="background:var(--b)"></span> Fácil</span><span><span class="dot" style="background:var(--c)"></span> Difícil</span><span><span class="dot" style="background:var(--manual)"></span> Adicionada no mapa</span><span>Contorno escuro = já está no funil</span><span class="sp"></span><span id="mCount"></span></div>
    <div class="faint" style="font-size:12px">Posição pela rua do cadastro (aproximada). Mapa © OpenStreetMap contributors.</div>
  </div><div id="routeBox"></div>`;
}
function cityBounds() {
  const b = {}; for (const l of S.leads) { if (l.lat == null || l.gp === "cidade") continue; (b[l.c] = b[l.c] || []).push([l.lat, l.lon]); }
  const out = {};
  for (const [c, pts] of Object.entries(b)) { const la = pts.map((p) => p[0]).sort((x, y) => x - y), lo = pts.map((p) => p[1]).sort((x, y) => x - y); const q = (a, f) => a[Math.floor(f * (a.length - 1))];
    out[c] = L.latLngBounds([q(la, 0.1), q(lo, 0.1)], [q(la, 0.9), q(lo, 0.9)]); }
  return out;
}
function wireMapa() {
  const css = getComputedStyle(document.documentElement); const col = (n) => css.getPropertyValue("--" + n).trim();
  const map = L.map("map", { preferCanvas: true, maxZoom: 19, minZoom: 9 });
  S._mapView = map; S._mapReady = !!S.leads.length;
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  const cb = cityBounds();
  const start = pref.get("mapCity", null) || (S.perfis[uid()]?.cidades || [])[0] || (S.q.cidades.length === 1 ? S.q.cidades[0] : null) || Object.keys(cb).sort()[0];
  $("#mCities").innerHTML = Object.keys(cb).sort().map((n) => `<button class="chip" data-mc="${esc(n)}" aria-pressed="${n === start}">${esc(n)}</button>`).join("");
  $("#mCities").addEventListener("click", (e) => { const b = e.target.closest("[data-mc]"); if (!b) return; pref.set("mapCity", b.dataset.mc); map.fitBounds(cb[b.dataset.mc]); $("#mCities").querySelectorAll("[data-mc]").forEach((x) => x.setAttribute("aria-pressed", x === b)); });
  if (cb[start]) map.fitBounds(cb[start]); else map.setView([-23.98, -48.87], 13);
  const pts = L.layerGroup().addTo(map); const ord = { C: 0, B: 1, A: 2 };
  // Pontos pequenos com a cidade inteira na tela e um pouco maiores ao aproximar.
  const rad = (f) => { const z = map.getZoom(); const r = z >= 17 ? 5 : z >= 16 ? 4 : z >= 15 ? 3.2 : z >= 14 ? 2.6 : 2.2; return f === "A" ? r + 0.6 : r; };
  const draw = () => {
    pts.clearLayers(); let n = 0;
    const base = $("#mUseF")?.checked ? filterLeads() : allLeads().filter((l) => !l.x);
    for (const l of base.slice().sort((a, b) => (ord[a.f] ?? 1) - (ord[b.f] ?? 1))) {
      if (l.lat == null) continue; n++;
      const inF = stageOf(l) !== "novo" || F(l).fav; const c = l._manual ? col("manual") : col(l.f.toLowerCase());
      L.circleMarker([l.lat, l.lon], { radius: rad(l.f), color: inF ? col("ink") : c, weight: inF ? 1.6 : 0.6, fillColor: c, fillOpacity: 0.9, _f: l.f })
        .on("click", () => openLead(leadKey(l))).bindTooltip(`${l.n} · ${l.r}`, { direction: "top" }).addTo(pts);
    }
    const mc = $("#mCount"); if (mc) mc.textContent = `${n.toLocaleString("pt-BR")} no mapa`;
  };
  draw(); S._mapRedraw = draw;
  map.on("zoomend", () => pts.eachLayer((m) => m.setRadius(rad(m.options._f))));
  $("#mUseF").addEventListener("change", (e) => { pref.set("mapUseFilter", e.target.checked); draw(); });
  let adding = false; const addBtn = $("#mAdd");
  const setAdding = (v) => { adding = v; addBtn.setAttribute("aria-pressed", v); addBtn.classList.toggle("pri", v); addBtn.textContent = v ? "Clique no mapa…" : "+ Adicionar no mapa"; map.getContainer().style.cursor = v ? "crosshair" : ""; };
  addBtn.addEventListener("click", () => setAdding(!adding));
  map.on("click", (e) => { if (!adding) return; setAdding(false); addManual(e.latlng); });
  $("#mRoute").addEventListener("click", () => buildRoute(map));
}
function nearestCity(lat, lon) { let best = null, bd = 1e9; for (const l of S.leads) { if (l.lat == null) continue; const d = (l.lat - lat) ** 2 + (l.lon - lon) ** 2; if (d < bd) { bd = d; best = l; } } return best ? { c: best.c, uf: best.uf } : { c: "", uf: "SP" }; }
function addManual(ll) {
  const near = nearestCity(ll.lat, ll.lng);
  modal(`<h3>Nova prospecção neste ponto</h3>
    <label class="f">Nome da empresa<input type="text" id="mfN" placeholder="Como aparece na fachada"></label>
    <div class="grid g2"><label class="f">Ramo<select id="mfR">${ramosAll().map((r) => `<option>${esc(r)}</option>`).join("")}<option>Outro</option></select></label>
      <label class="f">Cidade<input type="text" id="mfC" value="${esc(near.c)}"></label></div>
    <div class="grid g2"><label class="f">Telefone / WhatsApp<input type="tel" id="mfT" placeholder="(15) 99999-9999"></label>
      <label class="f">Facilidade<select id="mfF"><option value="A">Muito fácil</option><option value="B" selected>Fácil</option><option value="C">Difícil</option></select></label></div>
    <label class="f">Endereço / referência<input type="text" id="mfA"></label>
    <label class="f">Observação<textarea id="mfO" placeholder="Ex.: dono atende à tarde, sem Instagram"></textarea></label>
    <p class="faint" style="margin:0;font-size:12.5px">Na próxima atualização ela é procurada na Receita: se for achada, passa a usar os dados oficiais e mantém o funil.</p>
    <div class="row"><span class="sp"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="mfOk">Adicionar</button></div>`, (m) => {
    $("#mfOk", m).addEventListener("click", async () => {
      const nome = $("#mfN", m).value.trim(); if (!nome) { $("#mfN", m).focus(); return; }
      const f = $("#mfF", m).value;
      const ok = await W(() => addDoc(C("radar_manuais"), { nome, ramo: $("#mfR", m).value, cidade: $("#mfC", m).value.trim(), uf: near.uf || "SP", tel: $("#mfT", m).value.trim(), endereco: $("#mfA", m).value.trim(), obs: $("#mfO", m).value.trim(), faixa: f, nota: { A: 80, B: 65, C: 45 }[f], lat: +ll.lat.toFixed(6), lon: +ll.lng.toFixed(6), por: uid(), em: nowISO(), status: "novo" }), "Prospecção adicionada");
      if (ok) { closeLayer(); await logEvent("prospeccao", { n: nome, _manual: { id: "novo" } }); }
    }); });
}
function buildRoute(map) {
  const c = map.getCenter(), view = map.getBounds();
  let pts = ($("#mUseF").checked ? filterLeads() : allLeads().filter((l) => !l.x)).filter((l) => l.lat != null && view.contains([l.lat, l.lon]) && !["fechado", "perdido"].includes(stageOf(l)));
  pts.sort((a, b) => b.s - a.s); pts = pts.slice(0, 40);
  const route = []; let cur = { lat: c.lat, lon: c.lng };
  while (route.length < 10 && pts.length) { let bi = 0, bd = 1e9; pts.forEach((p, i) => { const d = (p.lat - cur.lat) ** 2 + ((p.lon - cur.lon) * Math.cos((cur.lat * Math.PI) / 180)) ** 2; if (d < bd) { bd = d; bi = i; } }); cur = pts.splice(bi, 1)[0]; route.push(cur); }
  if (!route.length) { $("#routeBox").innerHTML = `<div class="empty">Nenhuma empresa nesta área do mapa. Afaste o zoom ou mude os filtros.</div>`; return; }
  const url = "https://www.google.com/maps/dir/" + route.map((p) => `${p.lat},${p.lon}`).join("/");
  $("#routeBox").innerHTML = `<div class="card"><div class="row"><div><div class="eyebrow">Rota de visitas</div><h3 style="font-size:17px">${route.length} paradas a partir do centro do mapa</h3></div><span class="sp"></span><a class="btn pri" target="_blank" rel="noopener" href="${url}">Abrir rota no Google Maps</a></div>
    <div style="margin-top:8px">${route.map((l, i) => `<div class="plan-item"><span class="num">${i + 1}</span><div style="min-width:0"><a href="#" data-open="${esc(leadKey(l))}" style="color:var(--ink);font-weight:600;text-decoration:none">${esc(l.n)}</a><div class="faint" style="font-size:12.5px">${esc(l.r)} · ${esc(l.a || "")}</div></div><span class="pill ${FX[l.f].c}">${FX[l.f].l}</span></div>`).join("")}</div>
    <p class="faint" style="font-size:12px;margin:8px 0 0">Empresas sem telefone confiável são as melhores para visitar: filtre “Sem telefone (visita)” na busca.</p></div>`;
  wireOpeners($("#routeBox"));
}

// ============================== Funil ==============================
function vFunil() {
  const by = {}; for (const s of STAGES) by[s.k] = [];
  for (const [k, f] of Object.entries(S.funil)) { if (!f.etapa || f.etapa === "novo") continue; const l = findLead(k); if (l && by[f.etapa]) by[f.etapa].push(l); }
  const mine = pref.get("funilMine", false);
  return `<div class="head"><div><h2>Funil de vendas</h2><p class="muted">Cada lead que muda de etapa conta sozinho nas metas.</p></div>
    <label class="row" style="gap:6px;font-size:13px"><input type="checkbox" id="fMine" ${mine ? "checked" : ""}> Só os meus</label></div>
  <div class="tbl-wrap"><div style="display:grid;grid-template-columns:repeat(6,minmax(200px,1fr));gap:12px;min-width:1220px">
  ${STAGES.filter((s) => s.k !== "novo").map((s) => { const arr = by[s.k].filter((l) => !mine || F(l).resp === uid()).sort((a, b) => (F(b).atualizado || "").localeCompare(F(a).atualizado || ""));
    return `<div class="card" style="padding:12px;display:grid;gap:8px;align-content:start"><div class="row"><b>${s.l}</b><span class="sp"></span><span class="pill pC">${arr.length}</span></div>
    ${arr.map((l) => `<a href="#" data-open="${esc(leadKey(l))}" style="display:block;text-decoration:none;color:var(--ink);border:1px solid var(--line);border-radius:8px;padding:8px;background:var(--panel-2)"><div style="font-weight:600;font-size:13.5px">${F(l).fav ? "★ " : ""}${esc(l.n)}</div><div class="faint" style="font-size:12px">${esc(l.r)} · ${esc(l.c)} · ${esc(nick(F(l).resp))} · ${fmtDate((F(l).atualizado || "").slice(0, 10))}</div></a>`).join("") || `<div class="faint" style="font-size:12.5px">Vazio</div>`}</div>`; }).join("")}
  </div></div>`;
}
function wireFunil(root) { wireOpeners(root); $("#fMine").addEventListener("change", (e) => { pref.set("funilMine", e.target.checked); render(); }); }

// ============================== Metas (mesma lógica do app Landora) ==============================
function periodRange(p, today = todayISO()) {
  if (p === "dia") return { start: today, end: today };
  const d = new Date(today + "T00:00:00");
  if (p === "mes") return { start: isoLocal(new Date(d.getFullYear(), d.getMonth(), 1)), end: isoLocal(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  const start = addDays(today, -((d.getDay() + 6) % 7)); return { start, end: addDays(start, 6) };
}
const inRange = (s, r) => !!s && s >= r.start && s <= r.end;
const kindOf = (k) => GOAL_KINDS.find((x) => x.key === k) || GOAL_KINDS[GOAL_KINDS.length - 1];
function goalProgress(goal, today = todayISO()) {
  const range = periodRange(goal.period, today), target = Math.max(1, +goal.target || 1), kind = kindOf(goal.kind), people = {}; let current = 0;
  if (kind.auto) { const tipo = GOAL_EVENT[goal.kind]; for (const e of S.eventos) { if (e.tipo !== tipo || !inRange(e.data, range) || (goal.dono && goal.dono !== e.uid)) continue; current++; const w = nick(e.uid); people[w] = (people[w] || 0) + 1; } }
  else { for (const l of S.metaLogs) { if (l.goalId !== goal.id || !inRange(l.date, range)) continue; const d = +l.delta || 0; current += d; const w = nick(l.uid); people[w] = (people[w] || 0) + d; } current = Math.max(0, current); }
  const days = Math.max(0, Math.round((new Date(range.end + "T00:00:00") - new Date(today + "T00:00:00")) / 864e5) + 1);
  return { goal, kind, range, target, current, pct: Math.min(100, Math.round((current / target) * 100)), done: current >= target, left: Math.max(0, target - current), days, people: Object.entries(people).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]) };
}
function vMetas() {
  const rows = S.metas.map((g) => goalProgress(g)); const reached = rows.filter((r) => r.done).length;
  return `<div class="head"><div><h2>Metas</h2><p class="muted">Contatos, prospecções, reuniões e vendas do período.${rows.length ? ` <b>${reached} de ${rows.length} batida${reached === 1 ? "" : "s"}.</b>` : ""}</p></div><button class="btn pri" id="gNew">+ Nova meta</button></div>
  <div class="goal-grid">${rows.map((p) => `
    <div class="card goal ${p.done ? "done" : ""}">
      <div class="top"><span class="ic">${icon(p.kind.icon)}</span><div style="flex:1;min-width:0"><div class="t">${esc(p.goal.title || p.kind.label)}</div>
        <div class="faint" style="font-size:12.5px">${PERIODS.find((x) => x.key === p.goal.period)?.label || ""} · ${fmtDate(p.range.start)}${p.range.end !== p.range.start ? " a " + fmtDate(p.range.end) : ""}${p.goal.dono ? " · só " + esc(nick(p.goal.dono)) : " · equipe"}</div></div>
        <button class="btn sm ghost" data-edit="${esc(p.goal.id)}" aria-label="Editar meta">✎</button></div>
      <div class="nums"><b>${p.current}</b><span class="muted"> / ${p.target}</span> <span class="pill ${p.done ? "pA" : "pN"}" style="float:right">${p.pct}%</span></div>
      <div class="bar" role="progressbar" aria-valuemin="0" aria-valuemax="${p.target}" aria-valuenow="${p.current}"><i style="width:${p.pct}%"></i></div>
      <div class="foot"><span class="muted">${p.done ? "Meta batida!" : `Faltam ${p.left}${p.kind.unit ? " " + p.kind.unit : ""} · ${p.days} ${p.days === 1 ? "dia" : "dias"} para acabar`}</span>
        ${!p.kind.auto ? `<span class="row" style="gap:6px"><button class="step" data-log="${esc(p.goal.id)}" data-d="-1" ${p.current <= 0 ? "disabled" : ""} aria-label="Tirar 1">−</button><button class="step plus" data-log="${esc(p.goal.id)}" data-d="1" aria-label="Somar 1">+1</button></span>` : ""}</div>
      ${p.people.length > 1 ? `<div class="faint" style="font-size:12.5px">${p.people.map(([n, c]) => `${esc(n)}: ${c}`).join(" · ")}</div>` : ""}
    </div>`).join("")}</div>
  ${!rows.length ? `<div class="empty">Nenhuma meta ainda. Crie a primeira em “+ Nova meta”. Ex.: 20 contatos por semana.</div>` : ""}`;
}
function wireMetas(root) {
  $("#gNew").addEventListener("click", () => goalForm(null));
  root.querySelectorAll("[data-edit]").forEach((b) => b.addEventListener("click", () => goalForm(S.metas.find((g) => g.id === b.dataset.edit))));
  root.querySelectorAll("[data-log]").forEach((b) => b.addEventListener("click", () => W(() => addDoc(C("radar_metaLogs"), { goalId: b.dataset.log, delta: +b.dataset.d, date: todayISO(), uid: uid(), em: nowISO() }))));
}
function goalForm(g) {
  const f = g ? { title: g.title || "", kind: g.kind, target: g.target, period: g.period, dono: g.dono || "" } : { title: "", kind: "contatos", target: "", period: "semana", dono: "" };
  modal(`<h3>${g ? "Editar meta" : "Nova meta"}</h3>
    <label class="f">O que medir<select id="gK">${GOAL_KINDS.map((k) => opt(k.key, k.label, f.kind)).join("")}</select></label>
    <p class="faint" id="gHint" style="margin:0;font-size:12.5px">${kindOf(f.kind).hint}</p>
    <label class="f">Nome da meta (opcional)<input type="text" id="gT" value="${esc(f.title)}" placeholder="ex: Contatos da semana"></label>
    <div class="grid g2"><label class="f">Quanto alcançar<input type="number" id="gN" min="1" inputmode="numeric" value="${esc(f.target)}" placeholder="ex: 20"></label>
      <label class="f">Período<select id="gP">${PERIODS.map((p) => opt(p.key, p.label, f.period)).join("")}</select></label></div>
    <label class="f">De quem<select id="gD"><option value="">Equipe toda</option>${Object.entries(S.perfis).filter(([, p]) => p.aprovado).map(([id, p]) => opt(id, esc(p.apelido || p.nome), f.dono)).join("")}</select></label>
    <p class="err" id="gErr" hidden></p>
    <div class="row">${g ? `<button class="btn danger" id="gDel">Excluir</button>` : ""}<span class="sp"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="gOk">Salvar</button></div>`, (m) => {
    $("#gK", m).addEventListener("change", (e) => { $("#gHint", m).textContent = kindOf(e.target.value).hint; });
    $("#gOk", m).addEventListener("click", async () => {
      const target = Math.round(+$("#gN", m).value); if (!(target >= 1)) { const er = $("#gErr", m); er.hidden = false; er.textContent = "Coloque quanto você quer alcançar (1 ou mais)."; return; }
      const kind = $("#gK", m).value; const body = { title: $("#gT", m).value.trim() || kindOf(kind).label, kind, target, period: $("#gP", m).value, dono: $("#gD", m).value };
      const ok = g ? await W(() => updateDoc(D("radar_metas/" + g.id), { ...body, atualizado: nowISO() }), "Meta salva") : await W(() => addDoc(C("radar_metas"), { ...body, criadoPor: uid(), criadoEm: nowISO() }), "Meta criada");
      if (ok) closeLayer(); });
    $("#gDel", m)?.addEventListener("click", () => confirmBox(`Excluir a meta "${g.title}"?`, () => W(() => deleteDoc(D("radar_metas/" + g.id)), "Meta excluída")));
  });
}

// ============================== Cidades ==============================
function cityList() {
  const base = S.config?.cidades || (S.meta?.cidades || [{ nome: "Itapeva", uf: "SP" }, { nome: "Piraju", uf: "SP" }]);
  return base.map((c) => ({ dia: 1, hora: "14:00", ativa: true, uf: "SP", ...c }));
}
let _cEdit = null;
function vCidades() {
  const cs = cityList(); const count = (c) => S.leads.filter((l) => l.c === c.nome && !l.x).length; const can = S.isAdmin;
  return `<div class="head"><div><h2>Cidades e atualização</h2><p class="muted">O robô confere a Receita Federal no dia e horário de cada cidade. Se a Receita não publicou base nova, ele só confere e termina em segundos. Quando há base nova ou cidade nova, baixa tudo de novo (30 a 60 min).</p></div></div>
  ${!can ? `<div class="notice">Só administradores mudam cidades e horários.</div>` : ""}
  <div class="card tbl-wrap"><table class="t"><thead><tr><th>Cidade</th><th>Empresas sem site</th><th>Dia</th><th>Horário</th><th>Ativa</th><th></th></tr></thead><tbody>
  ${cs.map((c, i) => `<tr><td><b>${esc(c.nome)}</b>/${esc(c.uf)}</td><td class="mono">${count(c) ? count(c).toLocaleString("pt-BR") : '<span class="faint">entra na próxima atualização</span>'}</td>
    <td><select data-i="${i}" data-k="dia" ${can ? "" : "disabled"} aria-label="Dia">${DIAS.map((d, j) => opt(j, d, c.dia)).join("")}</select></td>
    <td><input type="time" data-i="${i}" data-k="hora" value="${esc(c.hora)}" step="3600" ${can ? "" : "disabled"} aria-label="Horário" style="width:120px"></td>
    <td><input type="checkbox" data-i="${i}" data-k="ativa" ${c.ativa !== false ? "checked" : ""} ${can ? "" : "disabled"} aria-label="Ativa"></td>
    <td class="row" style="gap:6px;flex-wrap:nowrap"><button class="btn sm" data-now="${i}">Atualizar agora</button>${can && cs.length > 1 ? `<button class="btn sm ghost danger" data-rm="${i}" aria-label="Remover">✕</button>` : ""}</td></tr>`).join("")}
  </tbody></table>
  ${can ? `<div class="row" style="margin-top:12px"><input type="text" id="cNome" placeholder="Nova cidade (ex.: Avaré)" style="flex:1 1 200px;width:auto"><input type="text" id="cUf" value="SP" maxlength="2" style="width:64px" aria-label="UF"><button class="btn" id="cAdd">Adicionar cidade</button><span class="sp"></span><button class="btn pri" id="cSave">Salvar agenda</button></div>` : ""}
  <p class="faint" style="font-size:12.5px;margin:10px 0 0">Horário de Brasília, de hora em hora (minutos são ignorados). “Atualizar agora” entra na fila e roda em até 1 hora.</p></div>
  <div class="grid g2">
    <div class="card"><div class="eyebrow">Últimas atualizações</div>${S.execucoes.slice(0, 10).map((e) => `<div class="plan-item" style="grid-template-columns:minmax(0,1fr) auto"><div><b>${fmtStamp(e.fim)}</b> <span class="faint">${esc(e.motivo || "")}</span><div class="faint" style="font-size:12.5px">${esc(e.resumo || "")}</div></div><span class="pill ${e.ok ? "pA" : "pX"}">${e.ok ? "ok" : "falhou"}</span></div>`).join("") || `<p class="muted">Nenhuma ainda.</p>`}</div>
    <div class="card"><div class="eyebrow">Pedidos na fila</div>${S.pedidos.slice(0, 10).map((p) => `<div class="plan-item" style="grid-template-columns:minmax(0,1fr) auto"><div>${p.tipo === "verificar" ? "Verificar online" : "Atualizar"}: <b>${esc(p.nome || p.alvo)}</b><div class="faint" style="font-size:12.5px">${esc(nick(p.por))} · ${fmtStamp(p.em)}</div></div><span class="pill pB">na fila</span></div>`).join("") || `<p class="muted">Fila vazia.</p>`}</div>
  </div>`;
}
function wireCidades(root) {
  _cEdit = cityList();
  root.querySelectorAll("[data-now]").forEach((b) => b.addEventListener("click", () => { const c = _cEdit[+b.dataset.now];
    W(() => addDoc(C("radar_pedidos"), { tipo: "atualizar", alvo: `${c.nome}/${c.uf}`, nome: `${c.nome}/${c.uf}`, por: uid(), em: nowISO(), status: "pendente" }), "Na fila: roda em até 1 hora"); }));
  if (!S.isAdmin) return;
  root.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("change", () => { const c = _cEdit[+el.dataset.i]; c[el.dataset.k] = el.type === "checkbox" ? el.checked : el.dataset.k === "dia" ? +el.value : el.value.slice(0, 2) + ":00"; }));
  const save = (msg) => W(() => setDoc(D("radar_config/geral"), { cidades: _cEdit, atualizado: nowISO(), por: uid() }), msg);
  $("#cAdd").addEventListener("click", () => { const nome = $("#cNome").value.trim(), uf = ($("#cUf").value.trim() || "SP").toUpperCase(); if (!nome) return;
    if (_cEdit.some((c) => norm(c.nome) === norm(nome) && c.uf === uf)) { toast("Essa cidade já está na lista."); return; }
    _cEdit.push({ nome, uf, dia: 1, hora: "14:00", ativa: true }); save("Cidade adicionada: os dados chegam em até 1 hora (primeiro download leva 30 a 60 min)"); });
  root.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => { const c = _cEdit[+b.dataset.rm]; confirmBox(`Tirar ${c.nome} das atualizações?`, () => { _cEdit.splice(+b.dataset.rm, 1); save("Cidade removida"); }); }));
  $("#cSave").addEventListener("click", () => save("Agenda salva"));
}

// ============================== Equipe ==============================
function vEquipe() {
  const ps = Object.entries(S.perfis).sort((a, b) => (a[1].aprovado === b[1].aprovado ? (a[1].nome || "").localeCompare(b[1].nome || "") : a[1].aprovado ? 1 : -1));
  const r = periodRange("mes");
  const st = (id) => { const ev = S.eventos.filter((e) => e.uid === id && inRange(e.data, r)); return { cont: ev.filter((e) => e.tipo === "contato").length, reun: ev.filter((e) => e.tipo === "reuniao").length, vend: ev.filter((e) => e.tipo === "venda").length, ativos: Object.values(S.funil).filter((f) => f.resp === id && !["fechado", "perdido", "novo"].includes(f.etapa)).length }; };
  const pend = ps.filter(([, p]) => !p.aprovado && !p.bloqueado).length;
  return `<div class="head"><div><h2>Equipe</h2><p class="muted">Quem já usa o app Landora entra direto com o mesmo login. Contas novas ${S.isAdmin ? "você aprova aqui" : "um administrador aprova"}.</p></div>
    <button class="btn" id="eMe">Editar meu perfil</button></div>
  ${S.isAdmin && pend ? `<div class="notice warn">${pend} pessoa${pend > 1 ? "s" : ""} aguardando aprovação.</div>` : ""}
  <div class="card tbl-wrap"><table class="t"><thead><tr><th>Pessoa</th><th>Função</th><th>Cidades</th><th>Leads ativos</th><th>Contatos no mês</th><th>Reuniões</th><th>Vendas</th>${S.isAdmin ? "<th>Acesso</th>" : ""}</tr></thead><tbody>
  ${ps.map(([id, p]) => { const s = st(id); return `<tr><td><b>${esc(p.apelido || p.nome)}</b>${id === uid() ? ' <span class="pill pN">você</span>' : ""}<div class="faint" style="font-size:12px">${esc(p.nome || "")} · ${esc(p.email || "")}${p.doApp ? " · via app Landora" : ""}</div></td><td>${esc(p.funcao || "")}</td><td>${esc((p.cidades || []).join(", ") || "Todas")}</td>
    <td class="mono">${s.ativos}</td><td class="mono">${s.cont}</td><td class="mono">${s.reun}</td><td class="mono">${s.vend}</td>
    ${S.isAdmin ? `<td>${p.bloqueado ? `<span class="pill pX">bloqueado</span> <button class="btn sm" data-approve="${esc(id)}">Desbloquear</button>` : p.aprovado ? `<select data-role="${esc(id)}" aria-label="Papel">${opt("vendedor", "Vendedor", p.papel)}${opt("gestor", "Gestor", p.papel)}</select> ${id !== uid() ? `<button class="btn sm ghost danger" data-block="${esc(id)}">Bloquear</button>` : ""}` : `<button class="btn sm pri" data-approve="${esc(id)}">Aprovar</button> <button class="btn sm ghost danger" data-deny="${esc(id)}">Recusar</button>`}</td>` : ""}</tr>`; }).join("") || `<tr><td colspan="8" class="muted">Ninguém ainda.</td></tr>`}
  </tbody></table></div>
  ${S.isAdmin ? `<div class="card" style="font-size:13.5px"><div class="eyebrow">Administradores</div><p style="margin:6px 0">${esc((S.acesso?.admins || []).join(", "))}</p>
    <div class="row"><input type="email" id="admNew" placeholder="e-mail de outra pessoa da equipe" style="flex:1 1 220px;width:auto"><button class="btn sm" id="admAdd">Tornar administrador</button></div></div>` : ""}`;
}
function wireEquipe(root) {
  $("#eMe").addEventListener("click", profileForm);
  root.querySelectorAll("[data-approve]").forEach((b) => b.addEventListener("click", () => W(() => updateDoc(D("radar_perfis/" + b.dataset.approve), { aprovado: true, bloqueado: false, aprovadoPor: uid(), aprovadoEm: nowISO() }), "Acesso aprovado")));
  root.querySelectorAll("[data-deny]").forEach((b) => b.addEventListener("click", () => confirmBox("Recusar e apagar este cadastro do Radar?", () => W(() => deleteDoc(D("radar_perfis/" + b.dataset.deny)), "Cadastro recusado"))));
  root.querySelectorAll("[data-block]").forEach((b) => b.addEventListener("click", () => confirmBox("Bloquear o acesso desta pessoa ao Radar?", () => W(() => updateDoc(D("radar_perfis/" + b.dataset.block), { aprovado: false, bloqueado: true }), "Acesso bloqueado"))));
  root.querySelectorAll("[data-role]").forEach((s) => s.addEventListener("change", () => W(() => updateDoc(D("radar_perfis/" + s.dataset.role), { papel: s.value }), "Papel atualizado")));
  $("#admAdd")?.addEventListener("click", async () => { const e = $("#admNew").value.trim().toLowerCase(); if (!e.includes("@")) return;
    const admins = [...new Set([...(S.acesso?.admins || []), e])]; if (await W(() => updateDoc(D("radar_config/acesso"), { admins }), "Administrador adicionado")) { S.acesso = { ...S.acesso, admins }; render(); } });
}
function profileForm() {
  const p = S.perfis[uid()] || S.perfil || {};
  modal(`<h3>Meu perfil</h3>
    <label class="f">Nome completo<input type="text" id="pN" value="${esc(p.nome || "")}"></label>
    <div class="grid g2"><label class="f">Como quer ser chamado<input type="text" id="pA" value="${esc(p.apelido || "")}" placeholder="Ex.: Rafa"></label>
      <label class="f">Função<input type="text" id="pF" value="${esc(p.funcao || "")}" placeholder="Ex.: Vendas, Sócio"></label></div>
    <label class="f">Cidades em que prospecta <span class="faint">(nenhuma = todas)</span><div class="chips" id="pC">${cidadesAll().map((c) => `<button class="chip" data-c="${esc(c)}" aria-pressed="${(p.cidades || []).includes(c)}">${esc(c)}</button>`).join("")}</div></label>
    <div class="row"><button class="btn ghost" id="pPwd">Trocar senha</button><span class="sp"></span><button class="btn" data-close>Cancelar</button><button class="btn pri" id="pOk">Salvar</button></div>`, (m) => {
    $("#pC", m).addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); });
    $("#pPwd", m).addEventListener("click", () => W(() => sendPasswordResetEmail(S.fb.auth, S.user.email), "Enviamos um link para trocar a senha no seu e-mail"));
    $("#pOk", m).addEventListener("click", async () => { const nome = $("#pN", m).value.trim(); if (!nome) { $("#pN", m).focus(); return; }
      const cidades = [...m.querySelectorAll("#pC [aria-pressed=true]")].map((b) => b.dataset.c);
      if (await W(() => updateDoc(D("radar_perfis/" + uid()), { nome, apelido: $("#pA", m).value.trim() || nome.split(" ")[0], funcao: $("#pF", m).value.trim(), cidades }), "Perfil salvo")) closeLayer(); });
  });
}

// ============================== início ==============================
(async function boot() {
  try { S.q = { ...DEFAULT_Q, ...pref.get("q", {}), texto: "" }; } catch (e) { /* padrão */ }
  try { S.fb = await connect(); }
  catch (e) { $("#root").innerHTML = `<div class="auth"><div class="auth-card"><h1>Radar de Prospecção</h1><p class="err">Não consegui conectar ao Firebase. Confira a configuração (veja o README).</p></div></div>`; return; }
  onAuthStateChanged(S.fb.auth, (u) => {
    S.unsub.forEach((x) => x()); S.unsub = []; S.member = false;
    if (u) afterLogin(u); else authScreen("entrar");
  });
})();
