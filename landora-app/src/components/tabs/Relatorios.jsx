import { useMemo, useRef, useState } from "react";
import html2canvas from "html2canvas";
import jsPDF from "jspdf";
import { useCollection } from "../../lib/useCollection";
import { formatBRL, formatDate, matchesRange, todayISO } from "../../lib/format";

const RANGES = [
  { key: "semana", label: "Semana" },
  { key: "mes", label: "Mês" },
  { key: "ano", label: "Ano" },
  { key: "custom", label: "Personalizado" },
];

export default function Relatorios() {
  const { data: sales } = useCollection("sales", "date", "desc");
  const { data: entries } = useCollection("financeEntries", "date", "desc");
  const { data: clients } = useCollection("clients", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");

  const [range, setRange] = useState("mes");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());
  const [exporting, setExporting] = useState(false);
  const reportRef = useRef(null);

  const filteredSales = useMemo(
    () => sales.filter((s) => matchesRange(s.date, range, customStart, customEnd)),
    [sales, range, customStart, customEnd]
  );
  const filteredEntries = useMemo(
    () => entries.filter((e) => matchesRange(e.date, range, customStart, customEnd)),
    [entries, range, customStart, customEnd]
  );

  const totals = {
    implantacao: filteredSales.reduce((s, v) => s + (v.implantationValue || 0), 0),
    assinatura: filteredSales.reduce((s, v) => s + (v.subscriptionValue || 0), 0),
    entradasManuais: filteredEntries.filter((e) => e.type === "entrada" && e.source === "manual").reduce((s, e) => s + e.value, 0),
    saidas: filteredEntries.filter((e) => e.type === "saida").reduce((s, e) => s + e.value, 0),
  };
  const totalEntradas = totals.implantacao + totals.assinatura + totals.entradasManuais;
  const saldo = totalEntradas - totals.saidas;

  function clientName(id) { return clients.find((c) => c.id === id)?.name || "—"; }
  function pageTitle(id) { return pages.find((p) => p.id === id)?.title || "—"; }

  async function exportAs(type) {
    setExporting(true);
    try {
      const canvas = await html2canvas(reportRef.current, { backgroundColor: "#0b0f17", scale: 2 });
      if (type === "png") {
        const link = document.createElement("a");
        link.download = `relatorio-landora-${todayISO()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
      } else {
        const imgData = canvas.toDataURL("image/png");
        const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: [canvas.width, canvas.height] });
        pdf.addImage(imgData, "PNG", 0, 0, canvas.width, canvas.height);
        pdf.save(`relatorio-landora-${todayISO()}.pdf`);
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <header className="content-header row">
        <div>
          <h2>Relatórios</h2>
          <p className="muted">Resumo de vendas e financeiro, exportável.</p>
        </div>
        <div className="row-actions">
          <button className="btn btn-ghost" disabled={exporting} onClick={() => exportAs("png")}>Exportar PNG</button>
          <button className="btn btn-gradient" disabled={exporting} onClick={() => exportAs("pdf")}>Exportar PDF</button>
        </div>
      </header>

      <div className="filter-row">
        {RANGES.map((r) => (
          <button key={r.key} className={"period-tab" + (range === r.key ? " active" : "")} onClick={() => setRange(r.key)}>{r.label}</button>
        ))}
        {range === "custom" && (
          <>
            <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
            <span className="muted">até</span>
            <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </>
        )}
      </div>

      <div ref={reportRef} className="report-sheet">
        <div className="report-header">
          <img src="/logomarca.png" alt="Landora" />
          <div>
            <h3>Relatório — {RANGES.find((r) => r.key === range)?.label || "Personalizado"}</h3>
            <span className="muted">Gerado em {formatDate(todayISO())}</span>
          </div>
        </div>

        <div className="report-kpis">
          <div className="report-kpi" style={{ "--k": "#0A9FE0" }}>
            <span>Implantações</span>
            <b>{formatBRL(totals.implantacao)}</b>
          </div>
          <div className="report-kpi" style={{ "--k": "#A855F7" }}>
            <span>Assinaturas (vendas do período)</span>
            <b>{formatBRL(totals.assinatura)}</b>
          </div>
          <div className="report-kpi" style={{ "--k": "#0057FF" }}>
            <span>Entradas manuais</span>
            <b>{formatBRL(totals.entradasManuais)}</b>
          </div>
          <div className="report-kpi" style={{ "--k": "#ef4444" }}>
            <span>Saídas</span>
            <b className="negative">{formatBRL(totals.saidas)}</b>
          </div>
        </div>

        <div className="report-total-card">
          <span>Saldo do período</span>
          <b className={saldo >= 0 ? "positive" : "negative"}>{formatBRL(saldo)}</b>
          <small>
            {formatBRL(totalEntradas)} de entradas · {filteredSales.length} {filteredSales.length === 1 ? "venda" : "vendas"}
          </small>
        </div>

        <h4 className="section-title">Vendas do período</h4>
        <div className="report-table">
          <table className="ledger-table">
            <thead><tr><th>Data</th><th>Cliente</th><th>Landing page</th><th className="num">Implantação</th><th className="num">Assinatura</th></tr></thead>
            <tbody>
              {filteredSales.map((s) => (
                <tr key={s.id}>
                  <td>{formatDate(s.date)}</td>
                  <td>{clientName(s.clientId)}</td>
                  <td>{pageTitle(s.landingPageId)}</td>
                  <td className="num mono">{formatBRL(s.implantationValue)}</td>
                  <td className="num mono">{formatBRL(s.subscriptionValue)}</td>
                </tr>
              ))}
              {filteredSales.length === 0 && <tr><td colSpan={5} className="muted empty">Nenhuma venda no período.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
