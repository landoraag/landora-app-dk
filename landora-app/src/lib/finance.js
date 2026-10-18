// Cálculos do financeiro (usados na aba Financeiro e na tela de Início).
import { addDays, getCycleInfo, todayISO } from "./format";

// Os últimos `count` ciclos (do mais antigo ao atual), respeitando o dia de corte.
export function getCyclesRange(resetDay, count = 6) {
  const cycles = [];
  let cursor = todayISO();
  for (let i = 0; i < count; i++) {
    const info = getCycleInfo(cursor, resetDay);
    cycles.unshift(info);
    cursor = addDays(info.start, -1);
  }
  return cycles;
}

export function subscriptionActiveInCycle(sub, cycle) {
  if (sub.startDate >= cycle.end) return false;
  if (sub.deactivatedAt && sub.deactivatedAt < cycle.start) return false;
  return true;
}

// Totais de um ciclo: entradas manuais, implantações, assinaturas, saídas e saldo.
export function cycleTotals(cycle, entries, subscriptions) {
  const cycleEntries = entries.filter((e) => e.date >= cycle.start && e.date < cycle.end);
  const manualIn = cycleEntries.filter((e) => e.type === "entrada" && e.source === "manual").reduce((s, e) => s + e.value, 0);
  const implant = cycleEntries.filter((e) => e.source === "implantacao").reduce((s, e) => s + e.value, 0);
  const saidas = cycleEntries.filter((e) => e.type === "saida").reduce((s, e) => s + e.value, 0);
  const assinaturas = subscriptions.filter((s) => subscriptionActiveInCycle(s, cycle)).reduce((s, sub) => s + sub.value, 0);
  const entradasTotal = manualIn + implant + assinaturas;
  return { manualIn, implant, saidas, assinaturas, entradasTotal, saldo: entradasTotal - saidas };
}
