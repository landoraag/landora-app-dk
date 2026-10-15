import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, updateDoc, where, writeBatch } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { uploadImage } from "../../lib/cloudinary";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { todayISO } from "../../lib/format";

const EMPTY_FORM = { title: "", description: "", category: "", city: "", link: "" };

export default function LandingPages() {
  const { data: pages, loading } = useCollection("landingPages", "createdAt", "desc");
  const { profile } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  const [modal, setModal] = useState(null); // null | "new" | page object
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [saving, setSaving] = useState(false);

  const categories = useMemo(
    () => Array.from(new Set(pages.map((p) => p.category).filter(Boolean))),
    [pages]
  );

  useEffect(() => {
    const targetId = location.state?.openPageId;
    if (targetId && pages.length > 0) {
      const page = pages.find((p) => p.id === targetId);
      if (page) openView(page);
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state, pages]);

  function openNew() {
    setForm(EMPTY_FORM);
    setImageFile(null);
    setImagePreview(null);
    setEditing(true);
    setModal("new");
  }

  function openView(page) {
    setForm({
      title: page.title || "",
      description: page.description || "",
      category: page.category || "",
      city: page.city || "",
      link: page.link || "",
    });
    setImageFile(null);
    setImagePreview(null);
    setEditing(false);
    setModal(page);
  }

  function closeModal() {
    setModal(null);
    setEditing(false);
  }

  function handleImageChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    try {
      let imageUrl = modal !== "new" ? modal.imageUrl : null;

      if (imageFile) {
        const uploaded = await uploadImage(imageFile);
        imageUrl = uploaded.url;
      }

      if (modal === "new") {
        await addDoc(collection(db, "landingPages"), {
          ...form,
          imageUrl: imageUrl || null,
          active: true,
          createdBy: profile?.nickname || "—",
          createdAt: serverTimestamp(),
        });
      } else {
        await updateDoc(doc(db, "landingPages", modal.id), {
          ...form,
          imageUrl: imageUrl || null,
        });
      }
      closeModal();
    } catch (err) {
      alert(err.message || "Não foi possível salvar. Confira a configuração do Cloudinary no .env.");
    } finally {
      setSaving(false);
    }
  }

  async function deactivateSubscriptionsOf(landingPageId) {
    const snap = await getDocs(query(collection(db, "subscriptions"), where("landingPageId", "==", landingPageId), where("active", "==", true)));
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.update(d.ref, { active: false, deactivatedAt: todayISO() }));
    await batch.commit();
  }

  async function handleDelete(page) {
    if (!confirm(`Excluir "${page.title}"? As assinaturas recorrentes ligadas a ela serão desativadas.`)) return;
    await deactivateSubscriptionsOf(page.id);
    await deleteDoc(doc(db, "landingPages", page.id));
    closeModal();
  }

  async function toggleActive(page) {
    const nextActive = !(page.active !== false);
    await updateDoc(doc(db, "landingPages", page.id), { active: nextActive });
    if (!nextActive) await deactivateSubscriptionsOf(page.id);
  }

  return (
    <div>
      <header className="content-header row">
        <div>
          <h2>Landing Pages</h2>
          <p className="muted">Todos os banners criados e implantados para clientes.</p>
        </div>
        <button className="btn btn-gradient" onClick={openNew}>+ Nova</button>
      </header>

      <div className="lp-grid">
        {pages.map((p) => (
          <button key={p.id} className={"lp-card" + (p.active === false ? " inactive" : "")} onClick={() => openView(p)}>
            <div className="lp-card-img" style={{ backgroundImage: p.imageUrl ? `url(${p.imageUrl})` : undefined }}>
              {!p.imageUrl && <span className="lp-card-noimg">sem imagem</span>}
              {p.active === false && <span className="lp-badge-off">inativa</span>}
            </div>
            <div className="lp-card-body">
              <div className="lp-card-title">{p.title}</div>
              <div className="lp-card-meta">{p.category} · {p.city}</div>
            </div>
          </button>
        ))}
        {!loading && pages.length === 0 && <p className="muted empty">Nenhuma landing page cadastrada ainda.</p>}
      </div>

      {modal && (
        <div className="modal-backdrop" onClick={closeModal}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={closeModal}>✕</button>

            {editing ? (
              <form onSubmit={handleSave} className="lp-form">
                <h3>{modal === "new" ? "Nova landing page" : "Editar landing page"}</h3>

                <label>
                  Imagem de capa
                  <input type="file" accept="image/*" onChange={handleImageChange} />
                </label>
                {(imagePreview || (modal !== "new" && modal.imageUrl)) && (
                  <img className="lp-form-preview" src={imagePreview || modal.imageUrl} alt="" />
                )}

                <label>
                  Título
                  <input required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
                </label>
                <label>
                  Descrição
                  <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
                </label>
                <div className="two-col">
                  <label>
                    Categoria
                    <input list="lp-categories" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
                    <datalist id="lp-categories">
                      {categories.map((c) => <option key={c} value={c} />)}
                    </datalist>
                  </label>
                  <label>
                    Cidade
                    <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} />
                  </label>
                </div>
                <label>
                  Link da página
                  <input type="url" required value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} placeholder="https://..." />
                </label>

                <div className="modal-actions">
                  {modal !== "new" && (
                    <button type="button" className="btn-link" onClick={() => setEditing(false)}>cancelar</button>
                  )}
                  <button className="btn btn-gradient" type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</button>
                </div>
              </form>
            ) : (
              <div className="lp-view">
                {modal.imageUrl && <img className="lp-view-img" src={modal.imageUrl} alt="" />}
                <h3>{modal.title}</h3>
                <div className="lp-card-meta">{modal.category} · {modal.city}</div>
                <p className="lp-view-desc">{modal.description || "Sem descrição."}</p>

                <div className="modal-actions wrap">
                  <a className="btn btn-gradient" href={modal.link} target="_blank" rel="noreferrer">Abrir página</a>
                  <button className="btn btn-ghost" onClick={() => toggleActive(modal)}>
                    {modal.active === false ? "Reativar" : "Desativar"}
                  </button>
                  <button className="btn btn-ghost" onClick={() => setEditing(true)}>Editar</button>
                  <button className="btn-link danger" onClick={() => handleDelete(modal)}>Excluir</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
