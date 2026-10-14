import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { formatBRL, formatDate, getCycleInfo, addDays, todayISO } from "../../lib/format";

function getCyclesRange(resetDay, count = 6) {
  const cycles = [];
  let cursor = todayISO();
  for (let i = 0; i < count; i++) {
    const info = getCycleInfo(cursor, resetDay);
    cycles.unshift(info);
    cursor = addDays(info.start, -1);
  }
  return cycles;
}

function subscriptionActiveInCycle(sub, cycle) {
  if (sub.startDate >= cycle.end) return false;
  if (sub.deactivatedAt && sub.deactivatedAt < cycle.start) return false;
  return true;
}

export default function Financeiro() {
  const { data: entries } = useCollection("financeEntries", "date", "desc");
  const { data: subscriptions } = useCollection("subscriptions", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");
  const { data: clients } = useCollection("clients", "createdAt", "desc");
  const { data: settingsDocs } = useCollection("settings");

  const settings = settingsDocs.find((s) => s.id === "finance") || { resetDay: 1 };
  const [resetDayDraft, setResetDayDraft] = useState(settings.resetDay);
  useEffect(() => setResetDayDraft(settings.resetDay), [settings.resetDay]);

  const cycles = useMemo(() => getCyclesRange(settings.resetDay || 1, 6), [settings.resetDay, entries.length]);
  const [selectedCycleKey, setSelectedCycleKey] = useState(null);
  const activeCycle = cycles.find((c) => c.key === selectedCycleKey) || cycles[cycles.length - 1];

  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ type: "entrada", value: "", date: todayISO(), description: "" });

  async function saveResetDay() {
    await setDoc(doc(db, "settings", "finance"), { resetDay: Number(resetDayDraft) });
  }

  async function handleAddEntry(e) {
    e.preventDefault();
    await addDoc(collection(db, "financeEntries"), {
      type: form.type,
      value: Number(form.value),
      date: form.date,
      description: form.description.trim(),
      source: "manual",
      createdAt: serverTimestamp(),
    });
    setForm({ type: "entrada", value: "", date: todayISO(), description: "" });
    setShowForm(false);
  }

  async function deactivateSubscription(sub) {
    if (!confirm("Desativar esta assinatura? Ela para de contar receita a partir de hoje.")) return;
    await updateDoc(doc(db, "subscriptions", sub.id), { active: false, deactivatedAt: todayISO() });
  }

  function cycleTotals(cycle) {
    const cycleEntries = entries.filter((e) => e.date >= cycle.start && e.date < cycle.end);
    const manualIn = cycleEntries.filter((e) => e.type === "entrada" && e.source === "manual").reduce((s, e) => s + e.value, 0);
    const implant = cycleEntries.filter((e) => e.source === "implantacao").reduce((s, e) => s + e.value, 0);
    const saidas = cycleEntries.filter((e) => e.type === "saida").reduce((s, e) => s + e.value, 0);
    const assinaturas = subscriptions.filter((s) => subscriptionActiveInCycle(s, cycle)).reduce((s, sub) => s + sub.value, 0);
    const entradasTotal = manualIn + implant + assinaturas;
    return { manualIn, implant, saidas, assinaturas, entradasTotal, saldo: entradasTotal - saidas };
  }

  const chartData = cycles.map((c) => {
    const t = cycleTotals(c);
    return { label: c.label, Entradas: Math.round(t.entradasTotal), Saídas: Math.round(t.saidas) };
  });

  const current = cycleTotals(activeCycle);
  const activeSubs = subscriptions.filter((s) => s.active);

  function pageTitle(id) { return pages.find((p) => p.id === id)?.title || "—"; }
  function clientName(id) { return clients.find((c) => c.id === id)?.name || "—"; }

  return (
    <div>
      <header className="content-header row">
        <div>
          <h2>Financeiro</h2>
          <p className="muted">Ciclo mensal com dia de corte customizável.</p>
        </div>
        <button className="btn btn-gradient" onClick={() => setShowForm(true)}>+ Lançamento</button>
      </header>

      <div className="inline-form">
        <label>
          Dia de corte do ciclo
          <select value={resetDayDraft} onChange={(e) => setResetDayDraft(e.target.value)}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Dia {d}</option>)}
          </select>
        </label>
        <button className="btn btn-ghost" onClick={saveResetDay}>Salvar dia de corte</button>
        <span className="muted">Ciclo atual: {activeCycle.label} ({formatDate(activeCycle.start)} até o dia anterior a {formatDate(activeCycle.end)})</span>
      </div>

      <div className="chart-card">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={chartData}>
            <defs>
              <linearGradient id="inGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0057FF" />
                <stop offset="100%" stopColor="#1E3A8A" />
              </linearGradient>
              <linearGradient id="outGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#6B7280" />
                <stop offset="100%" stopColor="#374151" />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#1F2937" strokeDasharray="3 3" />
            <XAxis dataKey="label" stroke="#8b93a3" fontSize={12} />
            <YAxis stroke="#8b93a3" fontSize={12} tickFormatter={(v) => `R$${v}`} width={70} />
            <Tooltip contentStyle={{ background: "#111827", border: "1px solid #1F2937", borderRadius: 8, color: "#fff" }} formatter={(v) => formatBRL(v)} />
            <Legend />
            <Bar dataKey="Entradas" fill="url(#inGradient)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="Saídas" fill="url(#outGradient)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="filter-row">
        {cycles.map((c) => (
          <button key={c.key} className={"period-tab" + (c.key === activeCycle.key ? " active" : "")} onClick={() => setSelectedCycleKey(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="stat-row">
        <div className="stat"><span className="stat-label">Entradas manuais</span><span className="stat-value mono">{formatBRL(current.manualIn)}</span></div>
        <div className="stat"><span className="stat-label">Implantações</span><span className="stat-value mono">{formatBRL(current.implant)}</span></div>
        <div className="stat"><span className="stat-label">Assinaturas recorrentes</span><span className="stat-value mono">{formatBRL(current.assinaturas)}</span></div>
        <div className="stat"><span className="stat-label">Saídas</span><span className="stat-value mono negative">{formatBRL(current.saidas)}</span></div>
      </div>
      <div className="balance-banner">
        <span>Saldo do ciclo {activeCycle.label}</span>
        <strong className={"mono " + (current.saldo >= 0 ? "positive" : "negative")}>{formatBRL(current.saldo)}</strong>
      </div>

      <h3 className="section-title">Assinaturas recorrentes ativas</h3>
      <table className="ledger-table">
        <thead>
          <tr><th>Cliente</th><th>Landing page</th><th className="num">Valor mensal</th><th>Desde</th><th></th></tr>
        </thead>
        <tbody>
          {activeSubs.map((s) => (
            <tr key={s.id}>
              <td>{clientName(s.clientId)}</td>
              <td>{pageTitle(s.landingPageId)}</td>
              <td className="num mono">{formatBRL(s.value)}</td>
              <td>{formatDate(s.startDate)}</td>
              <td><button className="btn-link danger" onClick={() => deactivateSubscription(s)}>desativar</button></td>
            </tr>
          ))}
          {activeSubs.length === 0 && <tr><td colSpan={5} className="muted empty">Nenhuma assinatura ativa.</td></tr>}
        </tbody>
      </table>

      <h3 className="section-title">Lançamentos do ciclo</h3>
      <table className="ledger-table">
        <thead><tr><th>Data</th><th>Tipo</th><th>Descrição</th><th className="num">Valor</th></tr></thead>
        <tbody>
          {entries.filter((e) => e.date >= activeCycle.start && e.date < activeCycle.end).map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.date)}</td>
              <td>{e.type === "entrada" ? "Entrada" : "Saída"}</td>
              <td className="muted">{e.description || (e.source === "implantacao" ? "Implantação (automático)" : "—")}</td>
              <td className={"num mono " + (e.type === "entrada" ? "positive" : "negative")}>{e.type === "entrada" ? "+" : "−"} {formatBRL(e.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {showForm && (
        <div className="modal-backdrop" onClick={() => setShowForm(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowForm(false)}>✕</button>
            <form onSubmit={handleAddEntry} className="lp-form">
              <h3>Novo lançamento</h3>
              <label>
                Tipo
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                  <option value="entrada">Entrada</option>
                  <option value="saida">Saída</option>
                </select>
              </label>
              <div className="two-col">
                <label>Data<input type="date" required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
                <label>Valor<input type="number" step="0.01" required value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
              </div>
              <label>Descrição<input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
              <div className="modal-actions">
                <button className="btn btn-gradient" type="submit">Registrar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
