// Lembrete diário de tarefas (roda sozinho pela Vercel, por volta das 8h de Brasília).
//
// Lê as tarefas que não estão feitas e cujo prazo é hoje ou já passou, e manda um aviso
// para todos os aparelhos que deixaram "Lembrete de tarefas" ligado no Perfil.
// Sem tarefas para hoje/atrasadas: não manda nada.
//
// Quem chama: o agendamento da Vercel (vercel.json → "crons"). Para ninguém mais disparar,
// a Vercel envia "Authorization: Bearer <CRON_SECRET>" quando a variável CRON_SECRET existe.

import { accessToken, deleteDevice, fsBase, listDevices, sendOne, serviceAccount } from "./_lib/google.js";

const TZ = "America/Sao_Paulo";
const PRIORITY_RANK = { urgente: 0, alta: 1, media: 2, baixa: 3 };

// Data de hoje em Brasília no formato AAAA-MM-DD (o mesmo das tarefas).
function todayBR() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

async function listTasks(projectId, token) {
  const out = [];
  let pageToken = "";
  do {
    const url = `${fsBase(projectId)}/tasks?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(`Firestore: ${data.error?.message || res.status}`);
    for (const d of data.documents || []) {
      const f = d.fields || {};
      out.push({
        title: f.title?.stringValue || "Tarefa",
        status: f.status?.stringValue || "todo",
        dueDate: f.dueDate?.stringValue || "",
        priority: f.priority?.stringValue || "media",
        pageTitle: f.pageTitle?.stringValue || "",
      });
    }
    pageToken = data.nextPageToken || "";
  } while (pageToken);
  return out;
}

function authorized(req) {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.authorization === `Bearer ${secret}`;
  // Sem CRON_SECRET: aceita só o agendador da própria Vercel.
  return /vercel-cron/i.test(String(req.headers["user-agent"] || ""));
}

export default async function handler(req, res) {
  if (!authorized(req)) return res.status(401).json({ error: "Não autorizado." });
  try {
    const sa = serviceAccount();
    const projectId = sa.project_id;
    const token = await accessToken(sa);

    const today = todayBR();
    const open = (await listTasks(projectId, token)).filter((t) => t.status !== "done" && t.dueDate && t.dueDate <= today);
    if (!open.length) return res.status(200).json({ today, tasks: 0, sent: 0 });

    const late = open.filter((t) => t.dueDate < today);
    const due = open.filter((t) => t.dueDate === today);
    open.sort((a, b) => (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2) || a.dueDate.localeCompare(b.dueDate));

    const parts = [];
    if (due.length) parts.push(`${due.length} ${due.length === 1 ? "vence" : "vencem"} hoje`);
    if (late.length) parts.push(`${late.length} ${late.length === 1 ? "atrasada" : "atrasadas"}`);
    const top = open.slice(0, 3).map((t) => `• ${t.title}${t.pageTitle ? ` (${t.pageTitle})` : ""}`);
    if (open.length > 3) top.push(`… e mais ${open.length - 3}`);

    const msg = {
      kind: "reminder",
      title: `📋 Tarefas: ${parts.join(" e ")}`,
      body: top.join("\n").slice(0, 240),
      url: "/tarefas",
      tag: "reminder",
    };

    const devices = (await listDevices(projectId, token)).filter((d) => d.uid && d.prefs.reminder !== false);
    const results = await Promise.all(devices.map((d) => sendOne(projectId, token, d, msg).then((r) => [d, r])));
    await Promise.all(results.filter(([, r]) => r === "gone").map(([d]) => deleteDevice(d.name, token)));

    return res.status(200).json({ today, tasks: open.length, sent: results.filter(([, r]) => r === "ok").length });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Falha no lembrete." });
  }
}
