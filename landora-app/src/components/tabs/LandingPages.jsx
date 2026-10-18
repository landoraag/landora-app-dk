import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { uploadImage } from "../../lib/cloudinary";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { todayISO } from "../../lib/format";
import { sortTasks } from "../../lib/tasks";
import { TaskFormModal, TaskItem } from "../TaskParts";

const EMPTY_FORM = { title: "", description: "", category: "", city: "", link: "" };

const siteLink = (v) => (v ? (v.startsWith("http") ? v : `https://${v}`) : "");

export default function LandingPages() {
  const { data: pages, loading } = useCollection("landingPages", "createdAt", "desc");
  const { data: tasks } = useCollection("tasks", "createdAt", "desc");
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [view, setView] = useState(null); // page aberta para ver detalhes
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // page em edição (null = nova)
  const [form, setForm] = useState(EMPTY_FORM);
  const [image, setImage] = useState(""); // url atual ou pré-visualização
  const [imageFile, setImageFile] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [taskModal, setTaskModal] = useState(null); // null | "new" | tarefa

  const categories = useMemo(
    () => Array.from(new Set(pages.map((p) => p.category).filter(Boolean))).sort(),
    [pages]
  );

  // Mantém o modal de detalhes com os dados mais novos (ex.: depois de editar).
  const viewPage = view ? pages.find((p) => p.id === view.id) || view : null;
  const pageTasks = useMemo(
    () => (viewPage ? sortTasks(tasks.filter((t) => t.pageId === viewPage.id)) : []),
    [tasks, viewPage]
  );
  const openTaskCount = useMemo(() => {
    const c = {};
    tasks.forEach((t) => {
      if (t.pageId && t.status !== "done") c[t.pageId] = (c[t.pageId] || 0) + 1;
    });
    return c;
  }, [tasks]);

  // Abrir uma page vinda de outra aba (ex.: clique numa tarefa).
  useEffect(() => {
    const targetId = location.state?.openPageId;
    if (targetId && pages.length > 0) {
      const page = pages.find((p) => p.id === targetId);
      if (page) setView(page);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, pages]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setImage("");
    setImageFile(null);
    setError("");
    setFormOpen(true);
  }

  function openEdit(page) {
    setView(null);
    setEditing(page);
    setForm({
      title: page.title || "",
      description: page.description || "",
      category: page.category || "",
      city: page.city || "",
      link: page.link || "",
    });
    setImage(page.imageUrl || "");
    setImageFile(null);
    setError("");
    setFormOpen(true);
  }

  function pickImage(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Escolha um arquivo de imagem.");
    if (file.size > 10 * 1024 * 1024) return setError("A imagem é grande demais (máximo 10 MB).");
    setError("");
    setImageFile(file);
    setImage(URL.createObjectURL(file));
  }

  function clearImage() {
    setImageFile(null);
    setImage("");
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let imageUrl = image || null;
      if (imageFile) imageUrl = (await uploadImage(imageFile)).url;
      const payload = { ...form, link: siteLink(form.link.trim()), imageUrl };

      if (editing) {
        await updateDoc(doc(db, "landingPages", editing.id), { ...payload, updatedAt: serverTimestamp() });
        // Atualiza o nome da page nas tarefas ligadas a ela.
        if (editing.title !== payload.title) {
          const linked = tasks.filter((t) => t.pageId === editing.id);
          if (linked.length) {
            const batch = writeBatch(db);
            linked.forEach((t) => batch.update(doc(db, "tasks", t.id), { pageTitle: payload.title }));
            await batch.commit();
          }
        }
      } else {
        await addDoc(collection(db, "landingPages"), {
          ...payload,
          active: true,
          createdBy: profile?.nickname || "—",
          createdAt: serverTimestamp(),
        });
      }
      setFormOpen(false);
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar. Confira a configuração do Cloudinary no .env.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateSubscriptionsOf(landingPageId) {
    const snap = await getDocs(
      query(collection(db, "subscriptions"), where("landingPageId", "==", landingPageId), where("active", "==", true))
    );
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.update(d.ref, { active: false, deactivatedAt: todayISO() }));
    await batch.commit();
  }

  async function handleDelete(page) {
    if (!confirm(`Excluir "${page.title}"? As assinaturas recorrentes ligadas a ela serão desativadas.`)) return;
    await deactivateSubscriptionsOf(page.id);
    // As tarefas continuam existindo, só deixam de estar ligadas a esta page.
    const linked = tasks.filter((t) => t.pageId === page.id);
    if (linked.length) {
      const batch = writeBatch(db);
      linked.forEach((t) => batch.update(doc(db, "tasks", t.id), { pageId: "", pageTitle: "" }));
      await batch.commit();
    }
    await deleteDoc(doc(db, "landingPages", page.id));
    setView(null);
  }

  async function toggleActive(page) {
    const nextActive = !(page.active !== false);
    await updateDoc(doc(db, "landingPages", page.id), { active: nextActive });
    if (!nextActive) await deactivateSubscriptionsOf(page.id);
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Landing Pages</h2>
          <p className="muted">Todos os banners criados e implantados para clientes.</p>
        </div>
        <button className="btn btn-gradient" onClick={openNew}>
          + Nova page
        </button>
      </header>

      <div className="lp-grid">
        {pages.map((p) => (
          <button key={p.id} className={"lp-card" + (p.active === false ? " inactive" : "")} onClick={() => setView(p)}>
            <div className="lp-card-img" style={{ backgroundImage: p.imageUrl ? `url(${p.imageUrl})` : undefined }}>
              {!p.imageUrl && <span className="lp-card-noimg">sem imagem</span>}
              {p.active === false && <span className="lp-badge-off">inativa</span>}
              {openTaskCount[p.id] > 0 && (
                <span className="lp-badge-tasks" title="Tarefas pendentes">
                  ✅ {openTaskCount[p.id]}
                </span>
              )}
            </div>
            <div className="lp-card-body">
              <div className="lp-card-title">{p.title}</div>
              <div className="lp-card-meta">{[p.category, p.city].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          </button>
        ))}
        {!loading && pages.length === 0 && <p className="muted empty">Nenhuma landing page cadastrada ainda.</p>}
      </div>

      {/* ---------- Detalhes ---------- */}
      {viewPage && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setView(null)} aria-label="Fechar">
              ✕
            </button>
            {viewPage.imageUrl && <img className="lp-view-img" src={viewPage.imageUrl} alt="" />}
            <h3>{viewPage.title}</h3>
            <div className="lp-card-meta">
              {[viewPage.category, viewPage.city].filter(Boolean).join(" · ") || "—"}
              {viewPage.active === false ? " · inativa" : ""}
            </div>
            <p className="lp-view-desc">{viewPage.description || "Sem descrição."}</p>

            <div className="modal-actions wrap">
              {viewPage.link && (
                <a className="btn btn-gradient" href={siteLink(viewPage.link)} target="_blank" rel="noreferrer">
                  Abrir página
                </a>
              )}
              <button className="btn btn-ghost" onClick={() => toggleActive(viewPage)}>
                {viewPage.active === false ? "Reativar" : "Desativar"}
              </button>
              <button className="btn btn-ghost" onClick={() => openEdit(viewPage)}>
                Editar
              </button>
              <button className="btn-link danger" onClick={() => handleDelete(viewPage)}>
                Excluir
              </button>
            </div>

            <div className="lp-tasks">
              <div className="lp-tasks-head">
                <b>Tarefas e alterações</b>
                <button type="button" className="btn-link" onClick={() => setTaskModal("new")}>
                  + Nova tarefa
                </button>
              </div>
              <div className="task-list compact">
                {pageTasks.map((t) => (
                  <TaskItem key={t.id} task={t} onOpen={setTaskModal} showPage={false} />
                ))}
                {pageTasks.length === 0 && <p className="muted">Nenhuma tarefa ligada a esta page.</p>}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Formulário ---------- */}
      {formOpen && (
        <div className="modal-backdrop" onClick={() => !saving && setFormOpen(false)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setFormOpen(false)} aria-label="Fechar">
              ✕
            </button>
            <form onSubmit={handleSave} className="lp-form">
              <h3>{editing ? "Editar landing page" : "Nova landing page"}</h3>

              <div className="lead-upload">
                <span>Imagem de capa</span>
                <label className="lead-upload-box cover" title="Escolher imagem">
                  {image ? <img src={image} alt="" /> : <em>Clique para escolher a imagem de capa</em>}
                  <input
                    type="file"
                    accept="image/*"
                    hidden
                    onChange={(e) => {
                      pickImage(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
                <div className="row-actions">
                  <label className="btn-link">
                    {image ? "trocar" : "escolher"}
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(e) => {
                        pickImage(e.target.files?.[0]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  {image && (
                    <button type="button" className="btn-link danger" onClick={clearImage}>
                      remover
                    </button>
                  )}
                </div>
              </div>

              <label>
                Título
                <input required value={form.title} onChange={set("title")} placeholder="ex: Pizzaria do Zé — Delivery" />
              </label>
              <div className="two-col">
                <label>
                  Categoria
                  <input list="lp-categories" value={form.category} onChange={set("category")} placeholder="ex: Restaurante" />
                  <datalist id="lp-categories">
                    {categories.map((c) => (
                      <option key={c} value={c} />
                    ))}
                  </datalist>
                </label>
                <label>
                  Cidade
                  <input value={form.city} onChange={set("city")} placeholder="ex: Ourinhos" />
                </label>
              </div>
              <label>
                Link da página
                <input required value={form.link} onChange={set("link")} placeholder="www.site.com.br" inputMode="url" />
              </label>
              <label>
                Descrição
                <textarea rows={3} value={form.description} onChange={set("description")} placeholder="Para quem é, o que oferece, observações…" />
              </label>

              {error && <p className="auth-error">{error}</p>}

              <div className="modal-actions">
                <button type="button" className="btn-link" onClick={() => setFormOpen(false)} disabled={saving}>
                  cancelar
                </button>
                <button className="btn btn-gradient" type="submit" disabled={saving}>
                  {saving ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {taskModal && viewPage && (
        <TaskFormModal
          task={taskModal === "new" ? null : taskModal}
          presetPageId={viewPage.id}
          pages={pages}
          onClose={() => setTaskModal(null)}
        />
      )}
    </div>
  );
}
