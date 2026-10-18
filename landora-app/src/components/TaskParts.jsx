import { useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { formatDate } from "../lib/format";
import { EMPTY_TASK, PRIORITIES, TASK_STATUS, isOverdue, priorityOf, statusLabel } from "../lib/tasks";
import { notify } from "../lib/push";

// Marca/desmarca uma tarefa como feita.
export async function toggleTaskDone(task) {
  const done = task.status !== "done";
  await updateDoc(doc(db, "tasks", task.id), {
    status: done ? "done" : "todo",
    doneAt: done ? serverTimestamp() : null,
    updatedAt: serverTimestamp(),
  });
}

// Uma linha de tarefa (usada na aba Tarefas e dentro da page).
export function TaskItem({ task, onOpen, onGoPage, showPage = true }) {
  const pr = priorityOf(task.priority);
  const done = task.status === "done";
  const late = isOverdue(task);
  return (
    <div className={"task-item " + pr.cls + (done ? " done" : "")} onClick={() => onOpen?.(task)}>
      <button
        type="button"
        className={"task-check" + (done ? " on" : "")}
        onClick={(e) => {
          e.stopPropagation();
          toggleTaskDone(task);
        }}
        aria-label={done ? "Marcar como não feita" : "Marcar como feita"}
        title={done ? "Marcar como não feita" : "Marcar como feita"}
      >
        {done ? "✓" : ""}
      </button>
      <div className="task-main">
        <div className="task-title">{task.title}</div>
        <div className="task-meta">
          <span className={"task-pr " + pr.cls}>{pr.label}</span>
          {task.status === "doing" && <span className="task-chip doing">Fazendo</span>}
          {task.dueDate && (
            <span className={"task-chip" + (late ? " late" : "")}>
              {late ? "Atrasada · " : "Prazo "}
              {formatDate(task.dueDate)}
            </span>
          )}
          {showPage && task.pageId && (
            <button
              type="button"
              className="task-chip page"
              onClick={(e) => {
                e.stopPropagation();
                onGoPage?.(task.pageId);
              }}
              title="Abrir a page"
            >
              🗂️ {task.pageTitle || "Page"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Formulário para criar ou editar uma tarefa.
// task = tarefa existente (editar) ou null (nova). presetPageId já liga a nova tarefa a uma page.
export function TaskFormModal({ task, presetPageId = "", pages = [], onClose }) {
  const { user, profile } = useAuth();
  const [form, setForm] = useState(() =>
    task
      ? {
          title: task.title || "",
          description: task.description || "",
          priority: task.priority || "media",
          status: task.status || "todo",
          dueDate: task.dueDate || "",
          pageId: task.pageId || "",
        }
      : { ...EMPTY_TASK, pageId: presetPageId }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function handleSave(e) {
    e.preventDefault();
    if (!form.title.trim()) return setError("Dê um título para a tarefa.");
    setSaving(true);
    setError("");
    try {
      const page = pages.find((p) => p.id === form.pageId);
      const payload = { ...form, title: form.title.trim(), pageTitle: page?.title || "" };
      if (task) {
        const wasDone = task.status === "done";
        const isDone = form.status === "done";
        await updateDoc(doc(db, "tasks", task.id), {
          ...payload,
          ...(wasDone !== isDone ? { doneAt: isDone ? serverTimestamp() : null } : {}),
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, "tasks"), {
          ...payload,
          doneAt: form.status === "done" ? serverTimestamp() : null,
          createdBy: user.uid,
          createdByNickname: profile?.nickname || "",
          createdAt: serverTimestamp(),
        });
        notify({
          kind: "task",
          title: `✅ Nova tarefa · ${priorityOf(payload.priority).label}`,
          body: `${payload.title}${payload.pageTitle ? ` (${payload.pageTitle})` : ""} — por ${profile?.nickname || "alguém"}`,
          url: "/tarefas",
          tag: "tasks",
        });
      }
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar a tarefa.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir a tarefa "${task.title}"?`)) return;
    await deleteDoc(doc(db, "tasks", task.id));
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <form onSubmit={handleSave} className="lp-form">
          <h3>{task ? "Editar tarefa" : "Nova tarefa"}</h3>

          <label>
            O que precisa ser feito
            <input autoFocus value={form.title} onChange={set("title")} placeholder="ex: Trocar as fotos do banner" />
          </label>

          <div className="task-pr-pick" role="radiogroup" aria-label="Importância">
            <span>Importância</span>
            <div>
              {PRIORITIES.map((p) => (
                <button
                  key={p.key}
                  type="button"
                  role="radio"
                  aria-checked={form.priority === p.key}
                  className={"task-pr-opt " + p.cls + (form.priority === p.key ? " sel" : "")}
                  onClick={() => setForm({ ...form, priority: p.key })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="two-col">
            <label>
              Status
              <select value={form.status} onChange={set("status")}>
                {TASK_STATUS.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Prazo (opcional)
              <input type="date" value={form.dueDate} onChange={set("dueDate")} />
            </label>
          </div>

          <label>
            Ligada à page (opcional)
            <select value={form.pageId} onChange={set("pageId")}>
              <option value="">Nenhuma page</option>
              {pages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                  {p.city ? ` · ${p.city}` : ""}
                </option>
              ))}
            </select>
          </label>

          <label>
            Detalhes / alterações
            <textarea
              rows={4}
              value={form.description}
              onChange={set("description")}
              placeholder="Descreva as alterações, textos, links, etc."
            />
          </label>

          {task && (
            <p className="muted task-foot">
              Status atual: {statusLabel(task.status)}
              {task.createdByNickname ? ` · criada por ${task.createdByNickname}` : ""}
            </p>
          )}

          {error && <p className="auth-error">{error}</p>}

          <div className="modal-actions">
            {task && (
              <button type="button" className="btn-link danger task-del" onClick={handleDelete} disabled={saving}>
                Excluir
              </button>
            )}
            <button type="button" className="btn-link" onClick={onClose} disabled={saving}>
              cancelar
            </button>
            <button className="btn btn-gradient" type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
