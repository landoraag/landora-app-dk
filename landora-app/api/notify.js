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
// Sem bibliotecas: as partes de Google/Firestore/FCM ficam em _lib/google.js.
//
// Variáveis de ambiente (configuradas no painel da Vercel):
//   FIREBASE_SERVICE_ACCOUNT  conteúdo do arquivo JSON da "conta de serviço" do Firebase
//   APP_URL                   endereço do app (padrão: https://landora-app-dk.web.app)
//   ALLOWED_ORIGINS           (opcional) sites que podem chamar esta função, separados por vírgula

import { accessToken, cors, deleteDevice, isAllowedEmail, listDevices, sendOne, serviceAccount, verifyIdTokenPayload } from "./_lib/google.js";
const KINDS = new Set(["chat", "mention", "call", "task", "lead", "sale", "test"]);

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
    let senderEmail;
    try {
      const payload = await verifyIdTokenPayload(idToken, projectId);
      senderUid = payload.sub;
      senderEmail = payload.email;
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
    // Proteção de acesso ativa: conta fora da lista não manda avisos.
    if (!(await isAllowedEmail(projectId, token, senderEmail))) return res.status(403).json({ error: "Sem acesso ao Landora." });
    // "test" vai só para os aparelhos de quem pediu (botão "Enviar teste" no Perfil);
    // os outros tipos vão para todo mundo, menos quem fez a ação.
    // "to": só estas pessoas (ex.: quem foi @mencionado); "exclude": nunca estas (evita aviso duplicado).
    const toList = Array.isArray(body.to) ? body.to.map(String).slice(0, 50) : null;
    const exclude = new Set(Array.isArray(body.exclude) ? body.exclude.map(String).slice(0, 50) : []);
    const all = await listDevices(projectId, token);
    const devices =
      kind === "test"
        ? all.filter((d) => d.uid === senderUid)
        : all.filter(
            (d) =>
              d.uid &&
              d.uid !== senderUid &&
              !exclude.has(d.uid) &&
              (!toList || toList.includes(d.uid)) &&
              d.prefs[kind] !== false
          );

    const results = await Promise.all(devices.map((d) => sendOne(projectId, token, d, msg).then((r) => [d, r])));
    await Promise.all(results.filter(([, r]) => r === "gone").map(([d]) => deleteDevice(d.name, token)));

    const sent = results.filter(([, r]) => r === "ok").length;
    return res.status(200).json({ sent, devices: devices.length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Falha ao enviar." });
  }
}
