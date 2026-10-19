// Regras compartilhadas das tarefas (aba Tarefas e lista de tarefas dentro de cada page).
//
// Firestore: tasks/{id} -> {
//   title, description, priority, status, dueDate ("AAAA-MM-DD" ou ""),
//   pageId, pageTitle (page ligada, opcional), createdBy, createdByNickname, createdAt, doneAt
// }

import { todayISO } from "./format";

// Níveis de importância, do mais para o menos importante.
export const PRIORITIES = [
  { key: "urgente", label: "Urgente", cls: "pr-urgente" },
  { key: "alta", label: "Alta", cls: "pr-alta" },
  { key: "media", label: "Média", cls: "pr-media" },
  { key: "baixa", label: "Baixa", cls: "pr-baixa" },
];
export const PRIORITY_RANK = Object.fromEntries(PRIORITIES.map((p, i) => [p.key, i]));
export const priorityOf = (key) => PRIORITIES.find((p) => p.key === key) || PRIORITIES[2];

export const TASK_STATUS = [
  { key: "todo", label: "A fazer" },
  { key: "doing", label: "Fazendo" },
  { key: "done", label: "Feita" },
];
export const statusLabel = (key) => TASK_STATUS.find((s) => s.key === key)?.label || "A fazer";

export const EMPTY_TASK = {
  title: "",
  description: "",
  priority: "media",
  status: "todo",
  dueDate: "",
  pageId: "",
};

export const isOverdue = (t) => !!t.dueDate && t.status !== "done" && t.dueDate < todayISO();

// Abertas primeiro; dentro disso, mais importante primeiro; depois, prazo mais próximo.
export function sortTasks(list) {
  const statusRank = { doing: 0, todo: 1, done: 2 };
  return [...list].sort((a, b) => {
    const s = (statusRank[a.status] ?? 1) - (statusRank[b.status] ?? 1);
    if (s) return s;
    const p = (PRIORITY_RANK[a.priority] ?? 2) - (PRIORITY_RANK[b.priority] ?? 2);
    if (p) return p;
    if (a.dueDate && b.dueDate) return a.dueDate.localeCompare(b.dueDate);
    if (a.dueDate) return -1;
    if (b.dueDate) return 1;
    return 0;
  });
}

// Agrupa as tarefas abertas (A fazer / Fazendo) por page e, dentro de cada page,
// por importância (Urgente → Alta → Média → Baixa). Grupos vazios ficam de fora.
// Pages com alteração mais importante vêm primeiro (empate: mais alterações, depois nome);
// tarefas sem page vão por último, em "Geral".
export const NO_PAGE_LABEL = "Geral (sem page)";
export function groupTasksForExport(list) {
  const open = sortTasks(list.filter((t) => t.status !== "done"));
  const byPage = new Map();
  open.forEach((t) => {
    const key = t.pageId || "";
    if (!byPage.has(key)) byPage.set(key, { page: t.pageTitle || (key ? "Page sem nome" : NO_PAGE_LABEL), noPage: !key, tasks: [] });
    byPage.get(key).tasks.push(t);
  });
  return [...byPage.values()]
    .map((pg) => ({ ...pg, top: Math.min(...pg.tasks.map((t) => PRIORITY_RANK[t.priority] ?? 2)) }))
    .sort((a, b) => a.noPage - b.noPage || a.top - b.top || b.tasks.length - a.tasks.length || a.page.localeCompare(b.page, "pt-BR"))
    .map(({ page, tasks }) => ({
      page,
      count: tasks.length,
      groups: PRIORITIES.map((p) => ({
        ...p,
        items: tasks
          .filter((t) => (PRIORITY_RANK[t.priority] !== undefined ? t.priority : "media") === p.key)
          .map((t) => ({
            title: t.title || "(sem título)",
            description: (t.description || "").trim().replace(/\n+/g, " "),
            extra: t.dueDate ? `prazo: ${t.dueDate.split("-").reverse().join("/")}` : "",
          })),
      })).filter((g) => g.items.length),
    }));
}

export const EXPORT_TITLE = "Alterações a serem feitas:";
export const exportNumber = (i) => String(i + 1).padStart(2, "0");

// Texto puro (.txt / área de transferência).
export function buildTasksExport(list) {
  const lines = [EXPORT_TITLE];
  const pages = groupTasksForExport(list);
  pages.forEach((pg) => {
    lines.push("", `===== ${pg.page.toUpperCase()} =====`);
    pg.groups.forEach((g) => {
      lines.push("", g.label);
      g.items.forEach((t, i) => {
        lines.push(`${exportNumber(i)} - ${t.title}${t.extra ? ` (${t.extra})` : ""}`);
        if (t.description) lines.push(`     ${t.description}`);
      });
    });
  });
  if (!pages.length) lines.push("", "Nenhuma alteração pendente.");
  return lines.join("\n") + "\n";
}
