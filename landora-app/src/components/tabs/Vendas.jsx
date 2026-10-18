import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { addDays, formatBRL, formatDate, matchesRange, todayISO } from "../../lib/format";
import { notify } from "../../lib/push";
import { C, ChartCard, GlassTooltip, LegendRows, StatCard, axisProps, makeStackShape, shortMoney } from "../charts/ChartKit";

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const MONTHS_FULL = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const STACK_KEYS = ["Implantação", "Assinatura"];
const stackShape = makeStackShape(STACK_KEYS);

// Período do filtro como intervalo de datas (para o gráfico mostrar também os dias sem venda).
function rangeBounds(range, customStart, customEnd) {
  const today = todayISO();
  if (range === "dia") return [today, today];
  if (range === "semana") return [addDays(today, -7), today];
  if (range === "mes") return [addDays(today, -30), today];
  if (range === "ano") return [addDays(today, -365), today];
  if (range === "custom" && customStart && customEnd) return customStart <= customEnd ? [customStart, customEnd] : [customEnd, customStart];
  return [addDays(today, -30), today];
}

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

  // Barras por dia (ou por mês, em períodos longos), separando implantação e assinatura.
  const { chartData, byMonth } = useMemo(() => {
    const [from, to] = rangeBounds(range, customStart, customEnd);
    const days = [];
    for (let d = from; d <= to && days.length < 400; d = addDays(d, 1)) days.push(d);
    const monthly = days.length > 62;
    const buckets = new Map();
    const keyOf = (d) => (monthly ? d.slice(0, 7) : d);
    days.forEach((d) => {
      const k = keyOf(d);
      if (!buckets.has(k)) buckets.set(k, { key: k, Implantação: 0, Assinatura: 0 });
    });
    for (const s of filtered) {
      const b = buckets.get(keyOf(s.date));
      if (!b) continue;
      b.Implantação += s.implantationValue || 0;
      b.Assinatura += s.subscriptionValue || 0;
    }
    const data = [...buckets.values()].map((b) => ({
      ...b,
      label: monthly ? MONTHS[Number(b.key.slice(5, 7)) - 1] : String(Number(b.key.slice(8, 10))),
      total: b.Implantação + b.Assinatura,
    }));
    return { chartData: data, byMonth: monthly };
  }, [filtered, range, customStart, customEnd]);

  const best = chartData.reduce((m, d) => (d.total > (m?.total || 0) ? d : m), null);
  const bestLabel = best
    ? byMonth
      ? `${MONTHS_FULL[Number(best.key.slice(5, 7)) - 1]} de ${best.key.slice(0, 4)}`
      : `Dia ${formatDate(best.key)}`
    : "Sem vendas no período";

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
      notify({
        kind: "sale",
        title: `💰 Nova venda: ${formatBRL(implantationValue + subscriptionValue)}`,
        body: [clientOf(form.clientId)?.name, pageOf(form.landingPageId)?.title, `por ${profile?.nickname || "alguém"}`]
          .filter(Boolean)
          .join(" · "),
        url: "/vendas",
        tag: "sales",
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

      <div className="kpi-row">
        <StatCard label="Total no período" value={formatBRL(totals.total)} accent={C.b} tone="tone-b" sub={`${filtered.length} ${filtered.length === 1 ? "venda" : "vendas"}`} />
        <StatCard label={byMonth ? "Melhor mês" : "Melhor dia"} value={formatBRL(best?.total || 0)} sub={bestLabel} />
        <StatCard label="Implantações" value={formatBRL(totals.implantation)} accent={C.a} />
        <StatCard label="Assinaturas" value={formatBRL(totals.subscription)} accent={C.b} />
      </div>

      <ChartCard title={byMonth ? "Vendas por mês" : "Vendas por dia"}>
        <div className="chart-box">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={chartData} barCategoryGap="22%" margin={{ top: 8, right: 4, left: -8, bottom: 0 }}>
              <CartesianGrid stroke={C.grid} vertical={false} />
              <XAxis dataKey="label" {...axisProps} interval="preserveStartEnd" minTickGap={8} />
              <YAxis {...axisProps} tickFormatter={shortMoney} width={44} />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.04)" }}
                content={
                  <GlassTooltip
                    labelFormatter={(l, p) => {
                      const k = p?.[0]?.payload?.key || "";
                      return byMonth ? `${MONTHS_FULL[Number(k.slice(5, 7)) - 1]} de ${k.slice(0, 4)}` : formatDate(k);
                    }}
                  />
                }
              />
              <Bar dataKey="Implantação" stackId="v" fill={C.a} shape={stackShape} maxBarSize={34} />
              <Bar dataKey="Assinatura" stackId="v" fill={C.b} shape={stackShape} maxBarSize={34} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <LegendRows
          items={[
            { name: "Implantação", color: C.a, value: totals.implantation },
            { name: "Assinatura", color: C.b, value: totals.subscription },
          ]}
        />
      </ChartCard>

      <h3 className="section-title">Histórico de vendas</h3>
      <div className="table-card">
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
      </div>

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
