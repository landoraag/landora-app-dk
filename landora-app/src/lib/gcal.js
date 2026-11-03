// Ligação direta com o Google Agenda (opcional).
//
// Usa o "Entrar com o Google" do navegador (Google Identity Services) só para pedir permissão de
// mexer nos eventos da agenda de quem clicou em "Conectar". Nada passa por servidor: o navegador
// fala direto com a API do Google Agenda, e a chave de acesso fica só na memória (vale ~1 hora).
//
// Para ligar: crie um "ID do cliente OAuth" (aplicativo da Web) no Google Cloud, ative a
// "Google Calendar API", autorize o endereço do app em "Origens JavaScript autorizadas" e ponha o
// ID no .env como VITE_GOOGLE_CLIENT_ID. Sem isso, a agenda continua funcionando com o link
// "Adicionar ao Google Agenda" e com o arquivo .ics (ver lib/agenda.js).

import { fromGoogleEvent, toGoogleEvent } from "./agenda";

const CLIENT_ID = String(import.meta.env.VITE_GOOGLE_CLIENT_ID || "").trim();
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const API = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

export const gcalConfigured = CLIENT_ID.length > 0;

let token = { value: "", exp: 0 };
let gisPromise = null;

export const gcalConnected = () => !!token.value && token.exp - 30000 > Date.now();

function loadGis() {
  if (typeof window === "undefined") return Promise.reject(new Error("sem navegador"));
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (!gisPromise) {
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => {
        gisPromise = null;
        reject(new Error("Não consegui carregar o login do Google (internet ou bloqueador de anúncios)."));
      };
      document.head.appendChild(s);
    });
  }
  return gisPromise;
}

// Pede a permissão (abre a janelinha do Google). Chame a partir de um clique.
export async function gcalConnect() {
  if (!gcalConfigured) throw new Error("O Google Agenda ainda não foi configurado neste app.");
  await loadGis();
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: (resp) => {
        if (resp.error || !resp.access_token) return reject(new Error(resp.error_description || resp.error || "Permissão negada."));
        token = { value: resp.access_token, exp: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        resolve();
      },
      error_callback: (err) => reject(new Error(err?.type === "popup_closed" ? "Janela do Google fechada." : err?.message || "Não deu para conectar.")),
    });
    client.requestAccessToken({ prompt: gcalConnected() ? "" : "consent" });
  });
}

export function gcalDisconnect() {
  const t = token.value;
  token = { value: "", exp: 0 };
  try {
    if (t && window.google?.accounts?.oauth2) window.google.accounts.oauth2.revoke(t, () => {});
  } catch {
    /* sem problema */
  }
}

async function call(path, init = {}) {
  if (!gcalConnected()) {
    const err = new Error("Conexão com o Google vencida. Toque em “Conectar Google Agenda” de novo.");
    err.code = "auth";
    throw err;
  }
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token.value}`, "Content-Type": "application/json", ...(init.headers || {}) },
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    token = { value: "", exp: 0 };
    const err = new Error("Conexão com o Google vencida. Toque em “Conectar Google Agenda” de novo.");
    err.code = "auth";
    throw err;
  }
  if (!res.ok) throw new Error(data.error?.message || `Google Agenda recusou (${res.status}).`);
  return data;
}

// Eventos do Google entre duas datas (AAAA-MM-DD, fim exclusivo), já no formato da agenda.
export async function gcalList(startISO, endISO) {
  const q = new URLSearchParams({
    timeMin: new Date(`${startISO}T00:00:00-03:00`).toISOString(),
    timeMax: new Date(`${endISO}T00:00:00-03:00`).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "250",
  });
  const data = await call(`?${q.toString()}`);
  return (data.items || []).filter((g) => g.status !== "cancelled").map(fromGoogleEvent);
}

// Cria o evento no Google e devolve o id dele.
export async function gcalInsert(event) {
  const data = await call("", { method: "POST", body: JSON.stringify(toGoogleEvent(event)) });
  return data.id;
}

export async function gcalUpdate(gcalId, event) {
  await call(`/${encodeURIComponent(gcalId)}`, { method: "PATCH", body: JSON.stringify(toGoogleEvent(event)) });
}

export async function gcalRemove(gcalId) {
  try {
    await call(`/${encodeURIComponent(gcalId)}`, { method: "DELETE" });
  } catch (e) {
    if (e.code === "auth") throw e;
    /* já apagado no Google: segue */
  }
}
