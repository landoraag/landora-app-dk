// Peças compartilhadas pelas funções da Vercel (notificações e lembretes).
// Arquivos começando com "_" não viram endereço público na Vercel.
// Sem bibliotecas: usa só o que já vem no Node (crypto e fetch).

import crypto from "node:crypto";

export const APP_URL = (process.env.APP_URL || "https://landora-app-dk.web.app").replace(/\/$/, "");

/* ---------------- conta de serviço ---------------- */
export function serviceAccount() {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error("FIREBASE_SERVICE_ACCOUNT não configurada na Vercel.");
  const sa = JSON.parse(raw);
  sa.private_key = String(sa.private_key || "").replace(/\\n/g, "\n");
  return sa;
}

const b64url = (input) =>
  Buffer.from(typeof input === "string" ? input : JSON.stringify(input))
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

// Chave de acesso do Google (vale 1 hora; guardada enquanto a função estiver "quente").
let cachedAccess = { token: "", exp: 0 };
export async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedAccess.token && cachedAccess.exp - 60 > now) return cachedAccess.token;
  const unsigned = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  })}`;
  const signature = crypto
    .createSign("RSA-SHA256")
    .update(unsigned)
    .sign(sa.private_key, "base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Google recusou a conta de serviço: ${data.error_description || data.error || res.status}`);
  cachedAccess = { token: data.access_token, exp: now + (data.expires_in || 3600) };
  return cachedAccess.token;
}

/* ---------------- conferir quem está chamando ---------------- */
let cachedCerts = { certs: null, exp: 0 };
async function googleCerts() {
  if (cachedCerts.certs && cachedCerts.exp > Date.now()) return cachedCerts.certs;
  const res = await fetch("https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com");
  const certs = await res.json();
  const maxAge = Number((res.headers.get("cache-control") || "").match(/max-age=(\d+)/)?.[1] || 3600);
  cachedCerts = { certs, exp: Date.now() + maxAge * 1000 };
  return certs;
}

// Confere o "crachá" (ID token do Firebase Auth) e devolve o uid de quem chamou.
export async function verifyIdToken(idToken, projectId) {
  return (await verifyIdTokenPayload(idToken, projectId)).sub;
}

// Igual ao verifyIdToken, mas devolve tudo (uid em "sub", e-mail em "email").
export async function verifyIdTokenPayload(idToken, projectId) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw new Error("token inválido");
  const [h, p, s] = parts;
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  const payload = JSON.parse(Buffer.from(p, "base64url").toString());
  if (header.alg !== "RS256") throw new Error("algoritmo inválido");
  const cert = (await googleCerts())[header.kid];
  if (!cert) throw new Error("chave desconhecida");
  const ok = crypto.createVerify("RSA-SHA256").update(`${h}.${p}`).verify(cert, Buffer.from(s, "base64url"));
  if (!ok) throw new Error("assinatura inválida");
  const now = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`)
    throw new Error("token de outro projeto");
  if (!payload.sub || payload.exp < now || payload.iat > now + 300) throw new Error("token vencido");
  return payload;
}

// Lista de acesso do app (config/access). Sem lista = app aberto para qualquer conta logada.
export async function isAllowedEmail(projectId, token, email) {
  const res = await fetch(`${fsBase(projectId)}/config/access`, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 404) return true;
  const data = await res.json();
  if (!res.ok) throw new Error(`Firestore: ${data.error?.message || res.status}`);
  const emails = (data.fields?.emails?.arrayValue?.values || []).map((v) => String(v.stringValue || "").toLowerCase());
  return !!email && emails.includes(String(email).toLowerCase());
}

/* ---------------- Firestore (pela API REST) ---------------- */
export const fsBase = (projectId) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

export async function listDevices(projectId, token) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${fsBase(projectId)}/pushTokens?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Firestore: ${data.error?.message || res.status}`);
    for (const d of data.documents || []) {
      const f = d.fields || {};
      const prefs = {};
      for (const [k, v] of Object.entries(f.prefs?.mapValue?.fields || {})) prefs[k] = v.booleanValue !== false;
      out.push({ name: d.name, token: d.name.split("/").pop(), uid: f.uid?.stringValue || "", prefs });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

export async function deleteDevice(name, token) {
  await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(
    () => {}
  );
}

/* ---------------- envio ---------------- */
export async function sendOne(projectId, token, device, msg) {
  const link = `${APP_URL}${msg.url.startsWith("/") ? msg.url : "/"}`;
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token: device.token,
        notification: { title: msg.title, body: msg.body },
        data: { url: msg.url, kind: msg.kind },
        webpush: {
          headers: { Urgency: msg.kind === "call" ? "high" : "normal", TTL: msg.kind === "call" ? "300" : "86400" },
          notification: {
            icon: `${APP_URL}/icon-192.png`,
            badge: `${APP_URL}/favicon-64.png`,
            ...(msg.tag ? { tag: msg.tag, renotify: true } : {}),
          },
          fcm_options: { link },
        },
      },
    }),
  });
  if (res.ok) return "ok";
  const err = await res.json().catch(() => ({}));
  const code = err.error?.details?.find?.((d) => d.errorCode)?.errorCode || err.error?.status;
  // Aparelho que não recebe mais (desinstalou, limpou dados, tirou a permissão).
  // (Só esses casos: um erro de formato da mensagem não pode apagar o cadastro dos aparelhos.)
  if (res.status === 404 || code === "UNREGISTERED") return "gone";
  console.warn("FCM falhou:", res.status, err.error?.message);
  return "fail";
}

/* ---------------- quem pode chamar as funções (CORS) ---------------- */
export const ALLOWED = (process.env.ALLOWED_ORIGINS || `${APP_URL},https://landora-app-dk.firebaseapp.com,http://localhost:5173`)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);

export function cors(req, res) {
  const origin = String(req.headers.origin || "").replace(/\/$/, "");
  if (ALLOWED.includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Max-Age", "86400");
  return ALLOWED.includes(origin);
}
