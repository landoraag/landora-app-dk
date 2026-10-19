import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCollection } from "../../lib/useCollection";
import { PRIORITIES, buildTasksExport, isOverdue, sortTasks } from "../../lib/tasks";
import { exportTasksPDF, exportTasksPNG } from "../../lib/tasksExport";
import { TaskFormModal, TaskItem } from "../TaskParts";

export default function Tarefas() {
  const navigate = useNavigate();
  const { data: tasks, loading } = useCollection("tasks", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");

  const [search, setSearch] = useState("");
  const [prFilter, setPrFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [modal, setModal] = useState(null); // null | "new" | tarefa

  // Usa o título atual da page (se ela foi renomeada depois de criar a tarefa).
  const pageTitles = useMemo(() => Object.fromEntries(pages.map((p) => [p.id, p.title])), [pages]);
  const withTitles = useMemo(
    () => tasks.map((t) => (t.pageId && pageTitles[t.pageId] ? { ...t, pageTitle: pageTitles[t.pageId] } : t)),
    [tasks, pageTitles]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sortTasks(
      withTitles.filter((t) => {
        if (prFilter && t.priority !== prFilter) return false;
        if (pageFilter === "none" && t.pageId) return false;
        if (pageFilter && pageFilter !== "none" && t.pageId !== pageFilter) return false;
        if (!q) return true;
        return [t.title, t.description, t.pageTitle].join(" ").toLowerCase().includes(q);
      })
    );
  }, [withTitles, search, prFilter, pageFilter]);

  const open = filtered.filter((t) => t.status !== "done");
  const done = filtered.filter((t) => t.status === "done");
  const lateCount = tasks.filter(isOverdue).length;

  const counts = useMemo(() => {
    const c = {};
    tasks.forEach((t) => {
      if (t.status !== "done") c[t.priority] = (c[t.priority] || 0) + 1;
    });
    return c;
  }, [tasks]);

  const [exportMsg, setExportMsg] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const flash = (msg) => {
    setExportMsg(msg);
    setTimeout(() => setExportMsg(""), 2500);
  };
  const exportAs = async (format) => {
    setExportOpen(false);
    try {
      if (format === "pdf") return exportTasksPDF(withTitles), flash("PDF baixado!");
      if (format === "png") return exportTasksPNG(withTitles), flash("Imagem baixada!");
      const text = buildTasksExport(withTitles);
      if (format === "copy") {
        await navigator.clipboard.writeText(text);
        return flash("Copiado!");
      }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
      a.download = `alteracoes-${new Date().toISOString().slice(0, 10)}.txt`;
      a.click();
      URL.revokeObjectURL(a.href);
      flash("Arquivo baixado!");
    } catch (e) {
      console.error(e);
      flash("Não deu para exportar.");
    }
  };

  const goPage = (pageId) => navigate("/landing-pages", { state: { openPageId: pageId } });

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Tarefas</h2>
          <p className="muted">
            O que falta fazer, por importância.
            {lateCount > 0 && <span className="task-late-note"> {lateCount} atrasada{lateCount > 1 ? "s" : ""}.</span>}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {exportMsg && <span className="muted">{exportMsg}</span>}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="chat-icon-btn"
              style={{ border: "1px solid var(--border)", borderRadius: 8 }}
              onClick={() => setExportOpen((v) => !v)}
              title="Exportar alterações"
              aria-label="Exportar alterações"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" y1="15" x2="12" y2="3" />
              </svg>
            </button>
            {exportOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setExportOpen(false)} />
                <div
                  style={{
                    position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 41, minWidth: 180,
                    background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8,
                    boxShadow: "0 8px 24px rgba(0,0,0,.18)", padding: 4, display: "flex", flexDirection: "column",
                  }}
                >
                  {[
                    ["pdf", "📄 PDF"],
                    ["png", "🖼️ Imagem (PNG)"],
                    ["txt", "📝 Texto (.txt)"],
                    ["copy", "📋 Copiar texto"],
                  ].map(([k, label]) => (
                    <button
                      key={k}
                      type="button"
                      className="btn-link"
                      style={{ textAlign: "left", padding: "8px 10px", borderRadius: 6, color: "inherit" }}
                      onClick={() => exportAs(k)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
          <button className="btn btn-gradient" onClick={() => setModal("new")}>
            + Nova tarefa
          </button>
        </div>
      </header>

      <div className="task-summary">
        {PRIORITIES.map((p) => (
          <button
            key={p.key}
            type="button"
            className={"task-sum " + p.cls + (prFilter === p.key ? " sel" : "")}
            onClick={() => setPrFilter(prFilter === p.key ? "" : p.key)}
            aria-pressed={prFilter === p.key}
          >
            <b>{counts[p.key] || 0}</b>
            <span>{p.label}</span>
          </button>
        ))}
      </div>

      <div className="leads-toolbar">
        <input
          className="leads-search"
          placeholder="Buscar tarefa…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={pageFilter} onChange={(e) => setPageFilter(e.target.value)}>
          <option value="">Todas as pages</option>
          <option value="none">Sem page</option>
          {pages.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div className="task-list">
        {open.map((t) => (
          <TaskItem key={t.id} task={t} onOpen={setModal} onGoPage={goPage} />
        ))}
        {!loading && open.length === 0 && (
          <p className="muted empty">
            {tasks.length === 0 ? "Nenhuma tarefa ainda. Crie a primeira em “+ Nova tarefa”." : "Nada pendente com esse filtro. 🎉"}
          </p>
        )}
      </div>

      {done.length > 0 && (
        <>
          <button type="button" className="btn-link task-done-toggle" onClick={() => setShowDone((v) => !v)}>
            {showDone ? "▾" : "▸"} Concluídas ({done.length})
          </button>
          {showDone && (
            <div className="task-list">
              {done.map((t) => (
                <TaskItem key={t.id} task={t} onOpen={setModal} onGoPage={goPage} />
              ))}
            </div>
          )}
        </>
      )}

      {modal && (
        <TaskFormModal task={modal === "new" ? null : modal} pages={pages} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
