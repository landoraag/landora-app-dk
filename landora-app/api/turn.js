// Servidor TURN da Cloudflare para as calls: a "ponte" usada quando a internet de alguém
// (4G, rede de empresa, alguns roteadores) bloqueia a conexão direta entre os aparelhos.
//
// O app chama POST /api/turn (com o crachá de quem está logado) ao entrar numa call e recebe
// credenciais temporárias (valem 24 h). A chave da Cloudflare fica só aqui, nunca vai para o app.
//
// Variáveis de ambiente (painel da Vercel):
//   CLOUDFLARE_TURN_KEY_ID      "Turn Token ID" da Cloudflare (Realtime → TURN)
//   CLOUDFLARE_TURN_API_TOKEN   "API Token" da mesma chave
//   FIREBASE_SERVICE_ACCOUNT    (já existe) para conferir quem está chamando

import { accessToken, cors, isAllowedEmail, serviceAccount, verifyIdTokenPayload } from "./_lib/google.js";

const KEY_ID = process.env.CLOUDFLARE_TURN_KEY_ID;
const API_TOKEN = process.env.CLOUDFLARE_TURN_API_TOKEN;
const TTL = 86400; // 24 h: mais que qualquer call

export default async function handler(req, res) {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  // Checagem de saúde (abrir no navegador): diz só se está configurado.
  if (req.method === "GET") return res.status(200).json({ ok: true, servico: "TURN das calls", configurado: !!(KEY_ID && API_TOKEN) });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!allowed) return res.status(403).json({ error: "Origem não permitida." });
  if (!KEY_ID || !API_TOKEN) return res.status(503).json({ error: "TURN não configurado na Vercel.", configurado: false });

  try {
    const sa = serviceAccount();
    let payload;
    try {
      payload = await verifyIdTokenPayload(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), sa.project_id);
    } catch (e) {
      return res.status(401).json({ error: `Não autorizado (${e.message}).` });
    }
    const gToken = await accessToken(sa);
    if (!(await isAllowedEmail(sa.project_id, gToken, payload.email))) return res.status(403).json({ error: "Sem acesso ao Landora." });

    const cf = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${KEY_ID}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: TTL }),
    });
    const data = await cf.json().catch(() => ({}));
    if (!cf.ok) return res.status(502).json({ error: `Cloudflare recusou (${cf.status}).` });

    // A porta 53 é bloqueada pelos navegadores e só atrasaria a conexão: fica de fora.
    const iceServers = (Array.isArray(data.iceServers) ? data.iceServers : [data.iceServers].filter(Boolean)).map((s) => ({
      ...s,
      urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter((u) => u && !/:53(\?|$)/.test(u)),
    }));
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).json({ iceServers, ttl: TTL });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Falha ao gerar o TURN." });
  }
}
