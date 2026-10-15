import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { uploadImage } from "../../lib/cloudinary";

const STATUS = ["Novo", "Em contato", "Proposta", "Fechado", "Perdido"];
const STATUS_CLASS = {
  Novo: "st-novo",
  "Em contato": "st-contato",
  Proposta: "st-proposta",
  Fechado: "st-fechado",
  Perdido: "st-perdido",
};

const EMPTY = {
  name: "",
  company: "",
  phone: "",
  email: "",
  cnpj: "",
  industry: "",
  address: "",
  instagram: "",
  site: "",
  status: "Novo",
  notes: "",
};

const digits = (v) => (v || "").replace(/\D/g, "");

function formatPhone(v) {
  const d = digits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}

function formatCnpj(v) {
  return digits(v)
    .slice(0, 14)
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

function whatsappLink(phone) {
  const d = digits(phone);
  if (d.length < 10) return null;
  return `https://wa.me/${d.length > 11 && d.startsWith("55") ? d : "55" + d}`;
}

const instaLink = (v) => (v ? (v.startsWith("http") ? v : `https://instagram.com/${v.replace(/^@/, "")}`) : null);
const siteLink = (v) => (v ? (v.startsWith("http") ? v : `https://${v}`) : null);

export default function Leads() {
  const { user, profile } = useAuth();
  const { data: leads } = useCollection("leads", "createdAt", "desc");

  const [search, setSearch] = useState("");
  const [industryFilter, setIndustryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");

  const [view, setView] = useState(null); // lead aberto para ver detalhes
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null); // lead em edição (null = novo)
  const [form, setForm] = useState(EMPTY);
  const [imgs, setImgs] = useState({ logo: "", photo: "" }); // imagens atuais (url ou pré-visualização)
  const [files, setFiles] = useState({ logo: null, photo: null });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const industries = useMemo(
    () => [...new Set(leads.map((l) => (l.industry || "").trim()).filter(Boolean))].sort(),
    [leads]
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qd = digits(search);
    return leads.filter((l) => {
      if (industryFilter && (l.industry || "").trim() !== industryFilter) return false;
      if (statusFilter && l.status !== statusFilter) return false;
      if (!q) return true;
      const text = [l.name, l.company, l.industry, l.address, l.email].join(" ").toLowerCase();
      return text.includes(q) || (qd && (digits(l.phone).includes(qd) || digits(l.cnpj).includes(qd)));
    });
  }, [leads, search, industryFilter, statusFilter]);

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setImgs({ logo: "", photo: "" });
    setFiles({ logo: null, photo: null });
    setError("");
    setFormOpen(true);
  }

  function openEdit(l) {
    setView(null);
    setEditing(l);
    setForm({
      name: l.name || "",
      company: l.company || "",
      phone: l.phone || "",
      email: l.email || "",
      cnpj: l.cnpj || "",
      industry: l.industry || "",
      address: l.address || "",
      instagram: l.instagram || "",
      site: l.site || "",
      status: l.status || "Novo",
      notes: l.notes || "",
    });
    setImgs({ logo: l.logoUrl || "", photo: l.photoUrl || "" });
    setFiles({ logo: null, photo: null });
    setError("");
    setFormOpen(true);
  }

  function pickImage(kind, file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) return setError("Escolha um arquivo de imagem.");
    if (file.size > 10 * 1024 * 1024) return setError("A imagem é grande demais (máximo 10 MB).");
    setError("");
    setFiles((f) => ({ ...f, [kind]: file }));
    setImgs((i) => ({ ...i, [kind]: URL.createObjectURL(file) }));
  }

  function clearImage(kind) {
    setFiles((f) => ({ ...f, [kind]: null }));
    setImgs((i) => ({ ...i, [kind]: "" }));
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      let logoUrl = imgs.logo;
      let photoUrl = imgs.photo;
      if (files.logo) logoUrl = (await uploadImage(files.logo, "landora/leads")).url;
      if (files.photo) photoUrl = (await uploadImage(files.photo, "landora/leads")).url;
      const payload = { ...form, logoUrl, photoUrl };
      if (editing) {
        await updateDoc(doc(db, "leads", editing.id), { ...payload, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "leads"), {
          ...payload,
          createdBy: user.uid,
          createdByNickname: profile?.nickname || "",
          createdAt: serverTimestamp(),
        });
      }
      setFormOpen(false);
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar o lead.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(l) {
    if (!confirm(`Excluir o lead "${l.company || l.name}"?`)) return;
    await deleteDoc(doc(db, "leads", l.id));
    setView(null);
  }

  async function changeStatus(l, status) {
    await updateDoc(doc(db, "leads", l.id), { status, updatedAt: serverTimestamp() });
    setView({ ...l, status });
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Leads</h2>
          <p className="muted">Empresas que você pretende atender, com contato e fotos.</p>
        </div>
        <button className="btn btn-gradient" onClick={openNew}>
          + Novo lead
        </button>
      </header>

      <div className="leads-toolbar">
        <input
          className="leads-search"
          placeholder="Buscar por nome, empresa, telefone, CNPJ, endereço…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select value={industryFilter} onChange={(e) => setIndustryFilter(e.target.value)}>
          <option value="">Todos os ramos</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          {STATUS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <p className="muted leads-count">
        {filtered.length} {filtered.length === 1 ? "lead" : "leads"}
        {filtered.length !== leads.length ? ` de ${leads.length}` : ""}
      </p>

      <div className="leads-grid">
        {filtered.map((l) => (
          <div key={l.id} className="lead-card" onClick={() => setView(l)}>
            <div className="lead-cover">
              {l.photoUrl ? <img src={l.photoUrl} alt="" /> : <span className="muted">sem foto</span>}
              <span className={"lead-status " + (STATUS_CLASS[l.status] || "st-novo")}>{l.status || "Novo"}</span>
              {l.logoUrl && <img className="lead-logo" src={l.logoUrl} alt="" />}
            </div>
            <div className="lead-body">
              <div className="lead-company">{l.company || l.name}</div>
              {l.company && l.name && <div className="lead-name">{l.name}</div>}
              <div className="lead-meta">{[l.industry, l.phone].filter(Boolean).join(" · ") || "—"}</div>
            </div>
          </div>
        ))}
        {filtered.length === 0 && (
          <p className="muted empty">{leads.length === 0 ? "Nenhum lead cadastrado ainda." : "Nenhum lead com esse filtro."}</p>
        )}
      </div>

      {/* ---------- Detalhes ---------- */}
      {view && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setView(null)}>
              ✕
            </button>
            {view.photoUrl && <img className="lead-view-photo" src={view.photoUrl} alt="" />}
            <div className="lead-view-head">
              {view.logoUrl && <img className="lead-view-logo" src={view.logoUrl} alt="" />}
              <div>
                <h3>{view.company || view.name}</h3>
                {view.company && view.name && <div className="muted">{view.name}</div>}
              </div>
            </div>

            <label className="lead-status-select">
              Status
              <select value={view.status || "Novo"} onChange={(e) => changeStatus(view, e.target.value)}>
                {STATUS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            <dl className="lead-details">
              {view.industry && (<><dt>Ramo</dt><dd>{view.industry}</dd></>)}
              {view.phone && (<><dt>Telefone</dt><dd>{view.phone}</dd></>)}
              {view.email && (<><dt>E-mail</dt><dd>{view.email}</dd></>)}
              {view.cnpj && (<><dt>CNPJ</dt><dd>{view.cnpj}</dd></>)}
              {view.address && (<><dt>Endereço</dt><dd>{view.address}</dd></>)}
              {view.instagram && (
                <><dt>Instagram</dt><dd><a href={instaLink(view.instagram)} target="_blank" rel="noreferrer">{view.instagram}</a></dd></>
              )}
              {view.site && (
                <><dt>Site</dt><dd><a href={siteLink(view.site)} target="_blank" rel="noreferrer">{view.site}</a></dd></>
              )}
              {view.notes && (<><dt>Observações</dt><dd className="lead-notes">{view.notes}</dd></>)}
            </dl>

            <div className="modal-actions wrap">
              {whatsappLink(view.phone) && (
                <a className="btn btn-ghost" href={whatsappLink(view.phone)} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
              <button className="btn btn-ghost" onClick={() => openEdit(view)}>
                Editar
              </button>
              <button className="btn-link danger" onClick={() => handleDelete(view)}>
                Excluir
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- Formulário ---------- */}
      {formOpen && (
        <div className="modal-backdrop" onClick={() => !saving && setFormOpen(false)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setFormOpen(false)}>
              ✕
            </button>
            <form onSubmit={handleSave} className="lp-form">
              <h3>{editing ? "Editar lead" : "Novo lead"}</h3>

              <div className="two-col">
                <div className="lead-upload">
                  <span>Logo</span>
                  <div className="lead-upload-box logo">
                    {imgs.logo ? <img src={imgs.logo} alt="" /> : <em>sem logo</em>}
                  </div>
                  <div className="row-actions">
                    <label className="btn-link">
                      escolher
                      <input type="file" accept="image/*" hidden onChange={(e) => { pickImage("logo", e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                    {imgs.logo && (
                      <button type="button" className="btn-link danger" onClick={() => clearImage("logo")}>
                        remover
                      </button>
                    )}
                  </div>
                </div>
                <div className="lead-upload">
                  <span>Foto do estabelecimento</span>
                  <div className="lead-upload-box photo">
                    {imgs.photo ? <img src={imgs.photo} alt="" /> : <em>sem foto</em>}
                  </div>
                  <div className="row-actions">
                    <label className="btn-link">
                      escolher
                      <input type="file" accept="image/*" hidden onChange={(e) => { pickImage("photo", e.target.files?.[0]); e.target.value = ""; }} />
                    </label>
                    {imgs.photo && (
                      <button type="button" className="btn-link danger" onClick={() => clearImage("photo")}>
                        remover
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="two-col">
                <label>
                  Nome do contato
                  <input required value={form.name} onChange={set("name")} />
                </label>
                <label>
                  Empresa
                  <input required value={form.company} onChange={set("company")} />
                </label>
              </div>
              <div className="two-col">
                <label>
                  Telefone
                  <input value={form.phone} onChange={(e) => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(00) 00000-0000" inputMode="tel" />
                </label>
                <label>
                  E-mail
                  <input type="email" value={form.email} onChange={set("email")} />
                </label>
              </div>
              <div className="two-col">
                <label>
                  CNPJ
                  <input value={form.cnpj} onChange={(e) => setForm({ ...form, cnpj: formatCnpj(e.target.value) })} placeholder="00.000.000/0000-00" inputMode="numeric" />
                </label>
                <label>
                  Ramo
                  <input list="leads-industries" value={form.industry} onChange={set("industry")} placeholder="ex: Restaurante" />
                  <datalist id="leads-industries">
                    {industries.map((i) => (
                      <option key={i} value={i} />
                    ))}
                  </datalist>
                </label>
              </div>
              <label>
                Endereço
                <input value={form.address} onChange={set("address")} placeholder="Rua, número, bairro, cidade" />
              </label>
              <div className="two-col">
                <label>
                  Instagram
                  <input value={form.instagram} onChange={set("instagram")} placeholder="@empresa" />
                </label>
                <label>
                  Site
                  <input value={form.site} onChange={set("site")} placeholder="www.empresa.com.br" />
                </label>
              </div>
              <label>
                Status
                <select value={form.status} onChange={set("status")}>
                  {STATUS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Observações
                <textarea rows={3} value={form.notes} onChange={set("notes")} />
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
    </div>
  );
}
