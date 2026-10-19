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

// Monta o texto "Alterações a serem feitas", agrupado por importância
// (Urgente → Alta → Média → Baixa) e numerado dentro de cada grupo.
// Só entram tarefas abertas (A fazer / Fazendo).
export function buildTasksExport(list) {
  const open = sortTasks(list.filter((t) => t.status !== "done"));
  const lines = ["Alterações a serem feitas:"];
  PRIORITIES.forEach((p) => {
    const group = open.filter((t) => (PRIORITY_RANK[t.priority] !== undefined ? t.priority : "media") === p.key);
    if (!group.length) return;
    lines.push("", p.label);
    group.forEach((t, i) => {
      const extra = [t.pageTitle && `page: ${t.pageTitle}`, t.dueDate && `prazo: ${t.dueDate.split("-").reverse().join("/")}`]
        .filter(Boolean)
        .join(" · ");
      lines.push(`${String(i + 1).padStart(2, "0")} - ${t.title}${extra ? ` (${extra})` : ""}`);
      if (t.description?.trim()) lines.push(`     ${t.description.trim().replace(/\n+/g, " ")}`);
    });
  });
  if (lines.length === 1) lines.push("", "Nenhuma alteração pendente.");
  return lines.join("\n") + "\n";
}
