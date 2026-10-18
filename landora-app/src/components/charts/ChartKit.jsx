// Peças visuais dos gráficos (estilo escuro com brilho, inspirado no Ora Finance).
// Cores validadas para fundo escuro, inclusive para daltonismo (ciano + roxo).
import { formatBRL } from "../../lib/format";

export const C = {
  a: "#0A9FE0", // série 1 (entradas, implantações)
  b: "#A855F7", // série 2 (saídas, assinaturas)
  brand: "#0057FF",
  grid: "rgba(255,255,255,0.06)",
  axis: "#6b7385",
};

export const axisProps = {
  stroke: C.axis,
  tick: { fill: C.axis, fontSize: 11 },
  tickLine: false,
  axisLine: false,
};

// Valores curtos no eixo: 1.400 -> 1,4k
export const shortMoney = (v) => {
  const n = Number(v) || 0;
  if (Math.abs(n) >= 1000) return `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1).replace(".", ",")}k`;
  return String(Math.round(n));
};

// Cartão de número com a faixa colorida de brilho no topo.
export function StatCard({ label, value, sub, accent, tone }) {
  return (
    <div className="kpi" style={{ "--accent": accent || "rgba(255,255,255,0.55)" }}>
      <span className="kpi-label">{label}</span>
      <strong className={"kpi-value" + (tone ? " " + tone : "")}>{value}</strong>
      {sub && <span className="kpi-sub">{sub}</span>}
    </div>
  );
}

export function ChartCard({ title, subtitle, action, children, className = "" }) {
  return (
    <section className={"glass-card " + className}>
      {(title || action) && (
        <header className="glass-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="glass-sub">{subtitle}</div>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

// Tooltip escuro com brilho (usado em todos os gráficos).
export function GlassTooltip({ active, payload, label, labelFormatter, valueFormatter = formatBRL }) {
  if (!active || !payload?.length) return null;
  const rows = payload.filter((p) => p.value !== null && p.value !== undefined);
  if (!rows.length) return null;
  return (
    <div className="glass-tip">
      <div className="glass-tip-title">{labelFormatter ? labelFormatter(label, payload) : label}</div>
      {rows.map((p) => (
        <div key={p.dataKey} className="glass-tip-row">
          <span className="dot" style={{ background: p.color || p.fill || p.stroke }} />
          <span className="name">{p.name}</span>
          <b>{valueFormatter(p.value)}</b>
        </div>
      ))}
    </div>
  );
}

// Legenda em linhas: cor · nome · % · valor (como nas inspirações).
export function LegendRows({ items }) {
  const total = items.reduce((s, i) => s + (i.value || 0), 0);
  return (
    <div className="legend-rows">
      {items.map((i) => (
        <div key={i.name} className="legend-row">
          <span className="dot" style={{ background: i.color, boxShadow: `0 0 10px ${i.color}` }} />
          <span className="name">{i.name}</span>
          <span className="pct">{total ? Math.round(((i.value || 0) / total) * 100) : 0}%</span>
          <b>{formatBRL(i.value || 0)}</b>
        </div>
      ))}
    </div>
  );
}

// Anel de porcentagem com brilho.
export function RingGauge({ pct, label, color = C.brand, size = 200 }) {
  const p = Math.max(0, Number.isFinite(pct) ? pct : 0);
  const stroke = 16;
  const r = (size - stroke) / 2 - 8;
  const circ = 2 * Math.PI * r;
  const shown = Math.min(1, p / 100);
  const over = p > 100;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(p)}% ${label || ""}`}>
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="6" result="b" />
            <feMerge>
              <feMergeNode in="b" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={over ? "#ef4444" : color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${circ * shown} ${circ}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          filter="url(#ring-glow)"
          style={{ transition: "stroke-dasharray .6s ease" }}
        />
      </svg>
      <div className="ring-center">
        <b>{Math.round(p)}%</b>
        {label && <span>{label}</span>}
      </div>
    </div>
  );
}

// Barra empilhada: só o pedaço de cima tem o topo arredondado, e há 2px de respiro entre pedaços.
export function makeStackShape(keys) {
  return function StackShape(props) {
    const { x, y, width, height, fill, payload, dataKey } = props;
    if (!height || height <= 0 || !width) return null;
    const idx = keys.indexOf(dataKey);
    const isTop = !keys.slice(idx + 1).some((k) => (payload?.[k] || 0) > 0);
    const hasBelow = keys.slice(0, idx).some((k) => (payload?.[k] || 0) > 0);
    const h = Math.max(0, hasBelow ? height - 2 : height);
    if (h <= 0) return null;
    const r = isTop ? Math.min(5, width / 2, h) : 0;
    const d = `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + h} Z`;
    return <path d={d} fill={fill} />;
  };
}
