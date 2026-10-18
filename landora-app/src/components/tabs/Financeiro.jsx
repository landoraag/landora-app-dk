import { useEffect, useMemo, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { formatBRL, formatDate, addDays, todayISO } from "../../lib/format";
import { cycleTotals as calcCycleTotals, getCyclesRange } from "../../lib/finance";
import { downloadXlsx } from "../../lib/xlsx";
import { C, ChartCard, GlassTooltip, LegendRows, RingGauge, StatCard, axisProps, shortMoney } from "../charts/ChartKit";

// Todos os dias de um ciclo (do início até o dia anterior ao próximo corte).
function daysOf(cycle) {
  const out = [];
  for (let d = cycle.start; d < cycle.end; d = addDays(d, 1)) out.push(d);
  return out;
}


export default function Financeiro() {
  const { data: entries } = useCollection("financeEntries", "date", "desc");
  const { data: subscriptions } = useCollection("subscriptions", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");
  const { data: clients } = useCollection("clients", "createdAt", "desc");
  const { data: settingsDocs } = useCollection("settings");
  const { data: sales } = useCollection("sales", "date", "desc");

  const settings = settingsDocs.find((s) => s.id === "finance") || { resetDay: 1 };
  const [resetDayDraft, setResetDayDraft] = useState(settings.resetDay);
  useEffect(() => {
    setResetDayDraft(settings.resetDay);
  }, [settings.resetDay]);

  const cycles = useMemo(() => getCyclesRange(settings.resetDay || 1, 6), [settings.resetDay, entries.length]);
  const [selectedCycleKey, setSelectedCycleKey] = useState(null);
  const activeCycle = cycles.find((c) => c.key === selectedCycleKey) || cycles[cycles.length - 1];

  const [showForm, setShowForm] = useState(false);
  const [daily, setDaily] = useState(false); // gráfico do ciclo: acumulado (false) ou por dia (true)
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

  const cycleTotals = (cycle) => calcCycleTotals(cycle, entries, subscriptions);

  const chartData = cycles.map((c) => {
    const t = cycleTotals(c);
    return { label: c.label, Entradas: Math.round(t.entradasTotal), Saídas: Math.round(t.saidas) };
  });
  const sixTotals = chartData.reduce((acc, d) => ({ in: acc.in + d.Entradas, out: acc.out + d.Saídas }), { in: 0, out: 0 });

  const current = cycleTotals(activeCycle);

  // Dia a dia do ciclo escolhido. Assinaturas contam no primeiro dia do ciclo.
  // Dias que ainda não chegaram ficam vazios, para a linha parar em "hoje".
  const dayData = useMemo(() => {
    const today = todayISO();
    const inCycle = entries.filter((e) => e.date >= activeCycle.start && e.date < activeCycle.end);
    let accIn = 0;
    let accOut = 0;
    return daysOf(activeCycle).map((d, i) => {
      const dayIn =
        inCycle.filter((e) => e.date === d && e.type === "entrada").reduce((s, e) => s + e.value, 0) +
        (i === 0 ? current.assinaturas : 0);
      const dayOut = inCycle.filter((e) => e.date === d && e.type === "saida").reduce((s, e) => s + e.value, 0);
      accIn += dayIn;
      accOut += dayOut;
      const future = d > today;
      return {
        date: d,
        day: Number(d.slice(8, 10)),
        Entradas: future ? null : daily ? dayIn : accIn,
        Saídas: future ? null : daily ? dayOut : accOut,
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, activeCycle.key, current.assinaturas, daily]);

  const spentPct = current.entradasTotal > 0 ? (current.saidas / current.entradasTotal) * 100 : 0;
  const activeSubs = subscriptions.filter((s) => s.active);

  function pageTitle(id) { return pages.find((p) => p.id === id)?.title || "—"; }
  function clientName(id) { return clients.find((c) => c.id === id)?.name || "—"; }

  // Cópia de segurança em Excel: resumo dos ciclos, lançamentos, vendas, assinaturas e clientes.
  function exportExcel() {
    const resumo = cycles.map((c) => ({ label: c.label, start: c.start, end: addDays(c.end, -1), ...cycleTotals(c) }));
    downloadXlsx(`Landora-financeiro-${todayISO()}`, [
      {
        name: "Resumo por ciclo",
        columns: [
          { header: "Ciclo", key: "label" },
          { header: "Início", key: "start", type: "date" },
          { header: "Fim", key: "end", type: "date" },
          { header: "Entradas manuais", key: "manualIn", type: "money", width: 18 },
          { header: "Implantações", key: "implant", type: "money", width: 16 },
          { header: "Assinaturas", key: "assinaturas", type: "money", width: 16 },
          { header: "Total de entradas", key: "entradasTotal", type: "money", width: 18 },
          { header: "Saídas", key: "saidas", type: "money", width: 14 },
          { header: "Saldo", key: "saldo", type: "money", width: 14 },
        ],
        rows: resumo,
      },
      {
        name: "Lançamentos",
        columns: [
          { header: "Data", key: "date", type: "date" },
          { header: "Tipo", value: (e) => (e.type === "entrada" ? "Entrada" : "Saída") },
          { header: "Descrição", value: (e) => e.description || (e.source === "implantacao" ? "Implantação (automático)" : ""), width: 44 },
          { header: "Origem", value: (e) => (e.source === "implantacao" ? "Venda" : "Manual") },
          { header: "Valor", key: "value", type: "money", width: 14 },
        ],
        rows: [...entries].sort((a, b) => (a.date < b.date ? 1 : -1)),
      },
      {
        name: "Vendas",
        columns: [
          { header: "Data", key: "date", type: "date" },
          { header: "Cliente", value: (v) => clientName(v.clientId), width: 28 },
          { header: "Landing page", value: (v) => pageTitle(v.landingPageId), width: 32 },
          { header: "Implantação", key: "implantationValue", type: "money", width: 16 },
          { header: "Assinatura mensal", key: "subscriptionValue", type: "money", width: 18 },
          { header: "Vendido por", key: "createdBy", width: 18 },
        ],
        rows: sales,
      },
      {
        name: "Assinaturas",
        columns: [
          { header: "Cliente", value: (x) => clientName(x.clientId), width: 28 },
          { header: "Landing page", value: (x) => pageTitle(x.landingPageId), width: 32 },
          { header: "Valor mensal", key: "value", type: "money", width: 16 },
          { header: "Desde", key: "startDate", type: "date" },
          { header: "Situação", value: (x) => (x.active ? "Ativa" : "Desativada") },
          { header: "Desativada em", key: "deactivatedAt", type: "date", width: 16 },
        ],
        rows: subscriptions,
      },
      {
        name: "Clientes",
        columns: [
          { header: "Nome", key: "name", width: 28 },
          { header: "Marca", key: "brandName", width: 24 },
          { header: "Telefone", key: "phone", width: 18 },
          { header: "E-mail", key: "email", width: 30 },
          { header: "Local", key: "location", width: 24 },
        ],
        rows: clients,
      },
    ]);
  }

  return (
    <div>
      <header className="content-header row">
        <div>
          <h2>Financeiro</h2>
          <p className="muted">Ciclo mensal com dia de corte customizável.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-ghost" onClick={exportExcel} title="Baixa uma planilha com resumo, lançamentos, vendas, assinaturas e clientes">
            ⬇ Exportar Excel
          </button>
          <button className="btn btn-gradient" onClick={() => setShowForm(true)}>+ Lançamento</button>
        </div>
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

      <div className="filter-row">
        {cycles.map((c) => (
          <button key={c.key} className={"period-tab" + (c.key === activeCycle.key ? " active" : "")} onClick={() => setSelectedCycleKey(c.key)}>
            {c.label}
          </button>
        ))}
      </div>

      <div className="kpi-row">
        <StatCard label="Entrou" value={formatBRL(current.entradasTotal)} accent={C.a} tone="tone-a" sub={`Implantações ${formatBRL(current.implant)}`} />
        <StatCard label="Saiu" value={formatBRL(current.saidas)} accent={C.b} tone="tone-b" />
        <StatCard label="Assinaturas" value={formatBRL(current.assinaturas)} accent={C.brand} sub={`Entradas manuais ${formatBRL(current.manualIn)}`} />
        <StatCard
          label={`Saldo do ciclo ${activeCycle.label}`}
          value={formatBRL(current.saldo)}
          tone={current.saldo >= 0 ? "" : "negative"}
        />
      </div>

      <div className="dash-grid">
        <ChartCard
          title={daily ? "Movimento por dia" : "Acumulado do ciclo"}
          subtitle={
            <>
              <span className="legend-inline"><i style={{ background: C.a }} /> Entrada</span>
              <span className="legend-inline"><i style={{ background: C.b }} /> Saída</span>
            </>
          }
          action={
            <button type="button" className="pill-btn" onClick={() => setDaily((v) => !v)}>
              {daily ? "Acumulado ›" : "Por dia ›"}
            </button>
          }
        >
          <div className="chart-box">
            <ResponsiveContainer width="100%" height={250}>
              {daily ? (
                <BarChart data={dayData} barGap={2} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={6} />
                  <YAxis {...axisProps} tickFormatter={shortMoney} width={44} />
                  <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<GlassTooltip labelFormatter={(l, p) => formatDate(p?.[0]?.payload?.date)} />} />
                  <Bar dataKey="Entradas" fill={C.a} radius={[4, 4, 0, 0]} maxBarSize={14} />
                  <Bar dataKey="Saídas" fill={C.b} radius={[4, 4, 0, 0]} maxBarSize={14} />
                </BarChart>
              ) : (
                <AreaChart data={dayData} margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fin-in" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.a} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={C.a} stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="fin-out" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={C.b} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={C.b} stopOpacity={0} />
                    </linearGradient>
                    <filter id="fin-glow" x="-10%" y="-30%" width="120%" height="160%">
                      <feGaussianBlur stdDeviation="3" result="b" />
                      <feMerge>
                        <feMergeNode in="b" />
                        <feMergeNode in="SourceGraphic" />
                      </feMerge>
                    </filter>
                  </defs>
                  <CartesianGrid stroke={C.grid} vertical={false} />
                  <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={6} />
                  <YAxis {...axisProps} tickFormatter={shortMoney} width={44} />
                  <Tooltip
                    cursor={{ stroke: "rgba(255,255,255,0.25)", strokeDasharray: "3 3" }}
                    content={<GlassTooltip labelFormatter={(l, p) => `Até ${formatDate(p?.[0]?.payload?.date)}`} />}
                  />
                  <Area type="monotone" dataKey="Entradas" stroke={C.a} strokeWidth={2} fill="url(#fin-in)" filter="url(#fin-glow)" connectNulls={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#0b0f17" }} />
                  <Area type="monotone" dataKey="Saídas" stroke={C.b} strokeWidth={2} fill="url(#fin-out)" filter="url(#fin-glow)" connectNulls={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "#0b0f17" }} />
                </AreaChart>
              )}
            </ResponsiveContainer>
          </div>
        </ChartCard>

        <ChartCard className="ring-card">
          <RingGauge pct={spentPct} label={"da entrada\njá saiu"} />
          <p className="ring-note">
            {current.entradasTotal > 0
              ? `${formatBRL(current.saidas)} de ${formatBRL(current.entradasTotal)}`
              : "Sem entradas neste ciclo ainda."}
          </p>
        </ChartCard>
      </div>

      <ChartCard title="Últimos 6 ciclos" subtitle="Entradas e saídas de cada ciclo">
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={chartData} barGap={2} barCategoryGap="28%" margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axisProps} />
              <YAxis {...axisProps} tickFormatter={shortMoney} width={44} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,0.04)" }} content={<GlassTooltip />} />
              <Bar dataKey="Entradas" fill={C.a} radius={[5, 5, 0, 0]} maxBarSize={30} />
              <Bar dataKey="Saídas" fill={C.b} radius={[5, 5, 0, 0]} maxBarSize={30} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <LegendRows
          items={[
            { name: "Entradas", color: C.a, value: sixTotals.in },
            { name: "Saídas", color: C.b, value: sixTotals.out },
          ]}
        />
      </ChartCard>

      <h3 className="section-title">Assinaturas recorrentes ativas</h3>
      <div className="table-card">
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
      </div>

      <h3 className="section-title">Lançamentos do ciclo</h3>
      <div className="table-card">
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
      </div>

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
