import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { formatBRL, formatDate } from "../../lib/format";
import Avatar from "../Avatar";
import Icon from "../Icons";

const EMPTY = { name: "", phone: "", location: "", email: "", brandName: "" };

const digits = (v) => (v || "").replace(/\D/g, "");
function formatPhone(v) {
  const d = digits(v).slice(0, 11);
  if (d.length <= 2) return d;
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`;
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
}
function whatsappLink(phone) {
  const d = digits(phone);
  if (d.length < 10) return null;
  return `https://wa.me/${d.length > 11 && d.startsWith("55") ? d : "55" + d}`;
}

export default function Clientes() {
  const navigate = useNavigate();
  const { data: clientes, loading } = useCollection("clients", "createdAt", "desc");
  const { data: sales } = useCollection("sales", "date", "desc");
  const { data: subscriptions } = useCollection("subscriptions", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");

  const [search, setSearch] = useState("");
  const [view, setView] = useState(null); // ficha aberta
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Resumo de cada cliente: vendas, total vendido e assinatura ativa.
  const stats = useMemo(() => {
    const out = {};
    for (const s of sales) {
      const o = (out[s.clientId] ||= { sales: [], total: 0, monthly: 0 });
      o.sales.push(s);
      o.total += (s.implantationValue || 0) + (s.subscriptionValue || 0);
    }
    for (const sub of subscriptions) {
      if (!sub.active) continue;
      const o = (out[sub.clientId] ||= { sales: [], total: 0, monthly: 0 });
      o.monthly += sub.value || 0;
    }
    return out;
  }, [sales, subscriptions]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const qd = digits(search);
    if (!q) return clientes;
    return clientes.filter(
      (c) =>
        [c.name, c.brandName, c.email, c.location].join(" ").toLowerCase().includes(q) || (qd && digits(c.phone).includes(qd))
    );
  }, [clientes, search]);

  const pageTitle = (id) => pages.find((p) => p.id === id)?.title || "—";
  const viewClient = view ? clientes.find((c) => c.id === view.id) || view : null;

  function openNew() {
    setEditing(null);
    setForm(EMPTY);
    setError("");
    setFormOpen(true);
  }
  function openEdit(c) {
    setView(null);
    setEditing(c);
    setForm({ name: c.name || "", phone: c.phone || "", location: c.location || "", email: c.email || "", brandName: c.brandName || "" });
    setError("");
    setFormOpen(true);
  }

  async function handleSave(e) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) await updateDoc(doc(db, "clients", editing.id), { ...form, updatedAt: serverTimestamp() });
      else await addDoc(collection(db, "clients"), { ...form, createdAt: serverTimestamp() });
      setFormOpen(false);
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar o cliente.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(c) {
    if (!confirm(`Remover "${c.name}"? Vendas já lançadas não serão alteradas.`)) return;
    await deleteDoc(doc(db, "clients", c.id));
    setView(null);
  }

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Clientes</h2>
          <p className="muted">Quem já comprou com vocês, com vendas e assinaturas.</p>
        </div>
        <button className="btn btn-gradient" onClick={openNew}>
          + Novo cliente
        </button>
      </header>

      <div className="leads-toolbar">
        <input
          className="leads-search"
          placeholder="Buscar por nome, marca, telefone, e-mail, cidade…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>
      <p className="muted leads-count">
        {filtered.length} {filtered.length === 1 ? "cliente" : "clientes"}
        {filtered.length !== clientes.length ? ` de ${clientes.length}` : ""}
      </p>

      <div className="client-grid">
        {filtered.map((c) => {
          const st = stats[c.id];
          const wa = whatsappLink(c.phone);
          return (
            <div key={c.id} className="client-card" onClick={() => setView(c)}>
              <div className="client-top">
                <Avatar name={c.brandName || c.name} size={44} />
                <div className="client-names">
                  <b>{c.name}</b>
                  <span>{c.brandName || "—"}</span>
                </div>
                {wa && (
                  <a className="client-wa" href={wa} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="WhatsApp">
                    <Icon name="chat" size={16} />
                  </a>
                )}
              </div>
              <div className="client-info">
                {c.phone && <span>📞 {c.phone}</span>}
                {c.location && <span>📍 {c.location}</span>}
              </div>
              <div className="client-chips">
                <span className="client-chip">
                  {st?.sales.length || 0} {st?.sales.length === 1 ? "venda" : "vendas"}
                </span>
                {st?.monthly > 0 && <span className="client-chip sub">{formatBRL(st.monthly)}/mês</span>}
              </div>
            </div>
          );
        })}
        {!loading && filtered.length === 0 && (
          <p className="muted empty">{clientes.length === 0 ? "Nenhum cliente cadastrado ainda." : "Nenhum cliente com essa busca."}</p>
        )}
      </div>

      {/* ---------- Ficha do cliente ---------- */}
      {viewClient && (
        <div className="modal-backdrop" onClick={() => setView(null)}>
          <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setView(null)} aria-label="Fechar">
              ✕
            </button>
            <div className="client-view-head">
              <Avatar name={viewClient.brandName || viewClient.name} size={56} />
              <div>
                <h3>{viewClient.name}</h3>
                <div className="muted">{viewClient.brandName || "Sem marca cadastrada"}</div>
              </div>
            </div>

            <dl className="lead-details">
              {viewClient.phone && (<><dt>Telefone</dt><dd>{viewClient.phone}</dd></>)}
              {viewClient.email && (<><dt>E-mail</dt><dd>{viewClient.email}</dd></>)}
              {viewClient.location && (<><dt>Localização</dt><dd>{viewClient.location}</dd></>)}
              <dt>Total vendido</dt>
              <dd>{formatBRL(stats[viewClient.id]?.total || 0)}</dd>
              <dt>Assinatura ativa</dt>
              <dd>{stats[viewClient.id]?.monthly ? `${formatBRL(stats[viewClient.id].monthly)} por mês` : "Nenhuma"}</dd>
            </dl>

            <h4 className="client-sales-title">Vendas</h4>
            <div className="home-list">
              {(stats[viewClient.id]?.sales || []).map((s) => (
                <button
                  type="button"
                  key={s.id}
                  className="home-row home-row-btn"
                  onClick={() => navigate("/landing-pages", { state: { openPageId: s.landingPageId } })}
                  title="Abrir a page"
                >
                  <div className="home-row-main">
                    <b>{pageTitle(s.landingPageId)}</b>
                    <span>
                      {formatDate(s.date)} · implantação {formatBRL(s.implantationValue || 0)}
                      {s.subscriptionValue ? ` · ${formatBRL(s.subscriptionValue)}/mês` : ""}
                    </span>
                  </div>
                  <b className="home-money">{formatBRL((s.implantationValue || 0) + (s.subscriptionValue || 0))}</b>
                </button>
              ))}
              {!stats[viewClient.id]?.sales.length && <p className="home-empty">Nenhuma venda para este cliente ainda.</p>}
            </div>

            <div className="modal-actions wrap">
              {whatsappLink(viewClient.phone) && (
                <a className="btn btn-ghost" href={whatsappLink(viewClient.phone)} target="_blank" rel="noreferrer">
                  WhatsApp
                </a>
              )}
              <button className="btn btn-ghost" onClick={() => openEdit(viewClient)}>
                Editar
              </button>
              <button className="btn-link danger" onClick={() => handleDelete(viewClient)}>
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
            <button className="modal-close" onClick={() => setFormOpen(false)} aria-label="Fechar">
              ✕
            </button>
            <form onSubmit={handleSave} className="lp-form">
              <h3>{editing ? "Editar cliente" : "Novo cliente"}</h3>
              <div className="two-col">
                <label>
                  Nome
                  <input required autoFocus value={form.name} onChange={set("name")} />
                </label>
                <label>
                  Marca
                  <input value={form.brandName} onChange={set("brandName")} placeholder="nome da empresa/marca" />
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
              <label>
                Localização
                <input value={form.location} onChange={set("location")} placeholder="cidade, bairro…" />
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
