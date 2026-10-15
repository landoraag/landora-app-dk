export function formatBRL(value) {
  const n = Number(value) || 0;
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

export function formatDate(dateStr) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

export function formatDateShort(dateStr) {
  if (!dateStr) return "—";
  const [, m, d] = dateStr.split("-");
  return `${d}/${m}`;
}

export function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d - tz).toISOString().slice(0, 10);
}

export function addDays(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------- Filtro de intervalo (aba Vendas) ----------
export function matchesRange(dateStr, range, customStart, customEnd) {
  if (!dateStr) return false;
  const today = todayISO();
  if (range === "dia") return dateStr === today;
  if (range === "semana") return dateStr >= addDays(today, -7) && dateStr <= today;
  if (range === "mes") return dateStr >= addDays(today, -30) && dateStr <= today;
  if (range === "ano") return dateStr >= addDays(today, -365) && dateStr <= today;
  if (range === "custom") {
    if (!customStart || !customEnd) return true;
    return dateStr >= customStart && dateStr <= customEnd;
  }
  return true;
}

// ---------- Ciclo financeiro (dia de corte customizável) ----------
// resetDay: 1–28. Um ciclo vai do resetDay de um mês até o dia anterior ao
// resetDay do mês seguinte.
export function getCycleInfo(dateStr, resetDay = 1) {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDate();
  let startYear = d.getFullYear();
  let startMonth = d.getMonth();

  if (day < resetDay) {
    startMonth -= 1;
    if (startMonth < 0) {
      startMonth = 11;
      startYear -= 1;
    }
  }

  const start = new Date(startYear, startMonth, resetDay);
  const end = new Date(startYear, startMonth + 1, resetDay);
  const key = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}`;

  const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
  const label = `${monthNames[start.getMonth()]}/${start.getFullYear()}`;

  return {
    key,
    label,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

export function isDateInCycle(dateStr, cycleStart, cycleEnd) {
  return dateStr >= cycleStart && dateStr < cycleEnd;
}

export function generateId(prefix, existingIds = []) {
  let n = existingIds.length + 1;
  let id = `${prefix}-${String(n).padStart(3, "0")}`;
  while (existingIds.includes(id)) {
    n += 1;
    id = `${prefix}-${String(n).padStart(3, "0")}`;
  }
  return id;
}
