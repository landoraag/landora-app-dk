import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { formatBRL, formatDate, formatDateShort, matchesRange, todayISO } from "../../lib/format";

const RANGES = [
  { key: "dia", label: "Último dia" },
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "ano", label: "Ano" },
  { key: "custom", label: "Personalizado" },
];

const EMPTY_FORM = { clientId: "", landingPageId: "", date: todayISO(), implantationValue: "", subscriptionValue: "" };

export default function Vendas() {
  const navigate = useNavigate();
  const { data: sales } = useCollection("sales", "date", "desc");
  const { data: clients } = useCollection("clients", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");
  const { profile } = useAuth();

  const [range, setRange] = useState("mes");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const filtered = useMemo(
    () => sales.filter((s) => matchesRange(s.date, range, customStart, customEnd)),
    [sales, range, customStart, customEnd]
  );

  const chartData = useMemo(() => {
    const map = new Map();
    for (const s of filtered) {
      const total = (s.implantationValue || 0) + (s.subscriptionValue || 0);
      map.set(s.date, (map.get(s.date) || 0) + total);
    }
    return Array.from(map.entries())
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([date, total]) => ({ date: formatDateShort(date), total }));
  }, [filtered]);

  const totals = filtered.reduce(
    (acc, s) => ({
      total: acc.total + (s.implantationValue || 0) + (s.subscriptionValue || 0),
      implantation: acc.implantation + (s.implantationValue || 0),
      subscription: acc.subscription + (s.subscriptionValue || 0),
    }),
    { total: 0, implantation: 0, subscription: 0 }
  );

  function pageOf(id) { return pages.find((p) => p.id === id); }
  function clientOf(id) { return clients.find((c) => c.id === id); }

  async function handleCreateSale(e) {
    e.preventDefault();
    setSaving(true);
    try {
      const implantationValue = Number(form.implantationValue) || 0;
      const subscriptionValue = Number(form.subscriptionValue) || 0;

      const saleRef = await addDoc(collection(db, "sales"), {
        clientId: form.clientId,
        landingPageId: form.landingPageId,
        date: form.date,
        implantationValue,
        subscriptionValue,
        createdBy: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });

      if (implantationValue > 0) {
        await addDoc(collection(db, "financeEntries"), {
          type: "entrada",
          value: implantationValue,
          date: form.date,
          description: `Implantação · ${pageOf(form.landingPageId)?.title || ""}`,
          source: "implantacao",
          saleId: saleRef.id,
          landingPageId: form.landingPageId,
          createdAt: serverTimestamp(),
        });
      }

      if (subscriptionValue > 0) {
        await addDoc(collection(db, "subscriptions"), {
          clientId: form.clientId,
          landingPageId: form.landingPageId,
          saleId: saleRef.id,
          value: subscriptionValue,
          startDate: form.date,
          active: true,
          deactivatedAt: null,
          createdAt: serverTimestamp(),
        });
      }

      setForm(EMPTY_FORM);
      setShowForm(false);
    } finally {
      setSaving(false);
    }
  }

  function goToPage(landingPageId) {
    navigate("/landing-pages", { state: { openPageId: landingPageId } });
  }

  return (
    <div>
      <header className="content-header row">
        <div>
          <h2>Vendas</h2>
          <p className="muted">Dashboard de vendas e histórico completo.</p>
        </div>
        <button className="btn btn-gradient" onClick={() => setShowForm(true)}>+ Nova venda</button>
      </header>

      <div className="filter-row">
        {RANGES.map((r) => (
          <button key={r.key} className={"period-tab" + (range === r.key ? " active" : "")} onClick={() => setRange(r.key)}>
            {r.label}
          </button>
        ))}
        {range === "custom" && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="muted">até</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      <div className="stat-row">
        <div className="stat"><span className="stat-label">Total no período</span><span className="stat-value mono">{formatBRL(totals.total)}</span></div>
        <div className="stat"><span className="stat-label">Implantações</span><span className="stat-value mono">{formatBRL(totals.implantation)}</span></div>
        <div className="stat"><span className="stat-label">Assinaturas</span><span className="stat-value mono">{formatBRL(totals.subscription)}</span></div>
      </div>

      <div className="chart-card">
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData}>
            <defs>
              <linearGradient id="salesGradient" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0%" stopColor="#1E3A8A" />
                <stop offset="100%" stopColor="#0057FF" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1F2937" strokeDasharray="3 3" />
            <XAxis dataKey="date" stroke="#8b93a3" fontSize={12} />
            <YAxis stroke="#8b93a3" fontSize={12} tickFormatter={(v) => `R$${v}`} width={70} />
            <Tooltip
              contentStyle={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 8, color: "#fff" }}
              formatter={(v) => formatBRL(v)}
            />
            <Line type="monotone" dataKey="total" stroke="url(#salesGradient)" strokeWidth={3} dot={{ r: 3, fill: "#0057FF" }} />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <h3 className="section-title">Histórico de vendas</h3>
      <table className="ledger-table">
        <thead>
          <tr>
            <th>Data</th>
            <th>Cliente</th>
            <th>Landing page</th>
            <th className="num">Implantação</th>
            <th className="num">Assinatura</th>
            <th className="num">Valor</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sales.map((s) => (
            <tr key={s.id}>
              <td>{formatDate(s.date)}</td>
              <td>{clientOf(s.clientId)?.name || "—"}</td>
              <td>{pageOf(s.landingPageId)?.title || "—"}</td>
              <td className="num mono">{formatBRL(s.implantationValue)}</td>
              <td className="num mono">{formatBRL(s.subscriptionValue)}</td>
              <td className="num mono positive">{formatBRL((s.implantationValue || 0) + (s.subscriptionValue || 0))}</td>
              <td><button className="btn-link" onClick={() => goToPage(s.landingPageId)}>ver página</button></td>
            </tr>
          ))}
          {sales.length === 0 && <tr><td colSpan={7} className="muted empty">Nenhuma venda registrada ainda.</td></tr>}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            <form onSubmit={handleCreateSale} className="lp-form">
              <h3>Nova venda</h3>

              <label>
                Cliente
                <select required value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}{c.brandName ? ` · ${c.brandName}` : ""}</option>)}
                </select>
                {clients.length === 0 && <span className="hint">Cadastre um cliente primeiro na aba Clientes.</span>}
              </label>

              <label>
                Landing page
                <select required value={form.landingPageId} onChange={(e) => setForm({ ...form, landingPageId: e.target.value })}>
                  <option value="">— selecione —</option>
                  {pages.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
                </select>
                {pages.length === 0 && <span className="hint">Cadastre a landing page primeiro na aba Landing Pages.</span>}
              </label>

              <div className="two-col">
                <label>
                  Data
                  <input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
                </label>
              </div>
              <div className="two-col">
                <label>
                  Valor de implantação
                  <input type="number" step="0.01" value={form.implantationValue} onChange={(e) => setForm({ ...form, implantationValue: e.target.value })} placeholder="0,00" />
                </label>
                <label>
                  Valor de assinatura (mensal)
                  <input type="number" step="0.01" value={form.subscriptionValue} onChange={(e) => setForm({ ...form, subscriptionValue: e.target.value })} placeholder="0,00" />
                </label>
              </div>

              <div className="modal-actions">
                <button className="btn btn-gradient" type="submit" disabled={saving || !clients.length || !pages.length}>
                  {saving ? "Salvando…" : "Registrar venda"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
