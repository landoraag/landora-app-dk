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
