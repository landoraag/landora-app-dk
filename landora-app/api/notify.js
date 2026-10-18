// Função da Vercel (grátis, sem cartão) que envia as notificações do Landora.
//
// O app chama POST /api/notify com { kind, title, body, url, tag } e o "crachá" (ID token)
// de quem está logado. A função:
//   1. confere que o pedido veio de alguém logado no Landora (não dá para forjar);
//   2. lê os aparelhos cadastrados em pushTokens (Firestore);
//   3. envia a notificação para todos, MENOS os aparelhos de quem fez a ação,
//      respeitando o que cada um escolheu receber;
//   4. apaga aparelhos que não existem mais (app desinstalado, permissão retirada).
//
// Sem bibliotecas: usa só o que já vem no Node (crypto e fetch).
//
// Variáveis de ambiente (configuradas no painel da Vercel):
//   FIREBASE_SERVICE_ACCOUNT  conteúdo do arquivo JSON da "conta de serviço" do Firebase
//   APP_URL                   endereço do app (padrão: https://landora-app-dk.web.app)
//   ALLOWED_ORIGINS           (opcional) sites que podem chamar esta função, separados por vírgula

import crypto from "node:crypto";

const APP_URL = (process.env.APP_URL || "https://landora-app-dk.web.app").replace(/\/$/, "");
const ALLOWED = (process.env.ALLOWED_ORIGINS || `${APP_URL},https://landora-app-dk.firebaseapp.com,http://localhost:5173`)
  .split(",")
  .map((s) => s.trim().replace(/\/$/, ""))
  .filter(Boolean);
const KINDS = new Set(["chat", "call", "task", "lead", "sale"]);

/* ---------------- conta de serviço ---------------- */
function serviceAccount() {
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
async function accessToken(sa) {
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
async function verifyIdToken(idToken, projectId) {
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
  return payload.sub;
}

/* ---------------- Firestore (pela API REST) ---------------- */
const fsBase = (projectId) => `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function listDevices(projectId, token) {
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

async function deleteDevice(name, token) {
  await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }).catch(
    () => {}
  );
}

/* ---------------- envio ---------------- */
async function sendOne(projectId, token, device, msg) {
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

function cors(req, res) {
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

export default async function handler(req, res) {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  // Checagem de saúde: abrir este endereço no navegador mostra se a configuração está ok
  // (sem revelar nada da chave).
  if (req.method === "GET") {
    let configured = false;
    let projectId = "";
    try {
      const sa = serviceAccount();
      configured = !!(sa.client_email && sa.private_key);
      projectId = sa.project_id || "";
    } catch {
      configured = false;
    }
    return res.status(200).json({ ok: true, servico: "notificações do Landora", configurado: configured, projeto: projectId || null });
  }
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!allowed) return res.status(403).json({ error: "Origem não permitida." });

  try {
    const sa = serviceAccount();
    const projectId = sa.project_id;

    const idToken = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    let senderUid;
    try {
      senderUid = await verifyIdToken(idToken, projectId);
    } catch (e) {
      return res.status(401).json({ error: `Não autorizado (${e.message}).` });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    const kind = String(body.kind || "");
    if (!KINDS.has(kind)) return res.status(400).json({ error: "Tipo de aviso desconhecido." });
    const msg = {
      kind,
      title: String(body.title || "Landora").slice(0, 120),
      body: String(body.body || "").slice(0, 240),
      url: String(body.url || "/").slice(0, 200),
      tag: body.tag ? String(body.tag).slice(0, 60) : "",
    };

    const token = await accessToken(sa);
    const devices = (await listDevices(projectId, token)).filter((d) => d.uid && d.uid !== senderUid && d.prefs[kind] !== false);

    const results = await Promise.all(devices.map((d) => sendOne(projectId, token, d, msg).then((r) => [d, r])));
    await Promise.all(results.filter(([, r]) => r === "gone").map(([d]) => deleteDevice(d.name, token)));

    const sent = results.filter(([, r]) => r === "ok").length;
    return res.status(200).json({ sent, devices: devices.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Falha ao enviar." });
  }
}
