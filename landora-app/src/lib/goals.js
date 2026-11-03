// Regras da aba Metas.
//
// Firestore:
//   goals/{id}    -> { title, kind, target, period, createdBy, createdByNickname, createdAt }
//   goalLogs/{id} -> { goalId, delta (+1 / -1), date ("AAAA-MM-DD"), uid, by (apelido), createdAt }
//
// O período é sempre o ATUAL (hoje, esta semana ou este mês): quando vira o dia/semana/mês a conta
// recomeça do zero sozinha — a meta continua a mesma, só o progresso é refeito.
//
// De onde vem o progresso:
//   vendas      -> automático: vendas registradas na aba Vendas dentro do período
//   prospeccoes -> automático: leads cadastrados na aba Leads dentro do período
//   reunioes    -> automático: reuniões da aba Agenda que já aconteceram dentro do período
//   contatos    -> manual: botão +1 (cada contato feito)
//   outro       -> manual: botão +1

import { addDays, todayISO } from "./format";

export const GOAL_KINDS = [
  { key: "contatos", label: "Contatos feitos", unit: "contatos", icon: "📞", auto: false },
  { key: "prospeccoes", label: "Prospecções (leads novos)", unit: "prospecções", icon: "🎯", auto: true },
  { key: "reunioes", label: "Reuniões", unit: "reuniões", icon: "🤝", auto: true },
  { key: "vendas", label: "Vendas feitas", unit: "vendas", icon: "💰", auto: true },
  { key: "outro", label: "Outra meta", unit: "", icon: "⭐", auto: false },
];
export const kindOf = (key) => GOAL_KINDS.find((k) => k.key === key) || GOAL_KINDS[GOAL_KINDS.length - 1];

export const GOAL_PERIODS = [
  { key: "dia", label: "Por dia", now: "hoje" },
  { key: "semana", label: "Por semana", now: "esta semana" },
  { key: "mes", label: "Por mês", now: "este mês" },
];
export const periodOf = (key) => GOAL_PERIODS.find((p) => p.key === key) || GOAL_PERIODS[1];

export const EMPTY_GOAL = { title: "", kind: "contatos", target: "", period: "semana" };

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);

// Começo e fim (inclusive) do período atual, no formato AAAA-MM-DD.
export function periodRange(period, today = todayISO()) {
  if (period === "dia") return { start: today, end: today };
  const d = new Date(today + "T00:00:00");
  if (period === "mes") {
    return { start: iso(new Date(d.getFullYear(), d.getMonth(), 1)), end: iso(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
  }
  // semana: segunda a domingo
  const back = (d.getDay() + 6) % 7;
  const start = addDays(today, -back);
  return { start, end: addDays(start, 6) };
}

export const inRange = (dateStr, { start, end }) => !!dateStr && dateStr >= start && dateStr <= end;

// Dias que faltam para o período acabar (contando hoje).
export function daysLeft(range, today = todayISO()) {
  const a = new Date(today + "T00:00:00");
  const b = new Date(range.end + "T00:00:00");
  return Math.max(0, Math.round((b - a) / 86400000) + 1);
}

// Data "AAAA-MM-DD" de um Timestamp do Firestore (ou null se ainda estiver salvando).
export function tsToISO(ts) {
  const d = ts?.toDate?.();
  return d ? iso(d) : "";
}

// Calcula o progresso de uma meta no período atual.
// data = { sales, leads, events, logs } (listas já carregadas do Firestore).
export function goalProgress(goal, data, today = todayISO()) {
  const range = periodRange(goal.period, today);
  const target = Math.max(1, Number(goal.target) || 1);
  let current = 0;
  const people = {};

  if (goal.kind === "vendas") {
    current = (data.sales || []).filter((s) => inRange(s.date, range)).length;
  } else if (goal.kind === "prospeccoes") {
    current = (data.leads || []).filter((l) => inRange(tsToISO(l.createdAt), range)).length;
  } else if (goal.kind === "reunioes") {
    current = (data.events || []).filter(
      (e) => e.type === "reuniao" && !e.cancelled && inRange(e.date, range) && e.date <= today
    ).length;
  } else {
    for (const l of data.logs || []) {
      if (l.goalId !== goal.id || !inRange(l.date, range)) continue;
      const delta = Number(l.delta) || 0;
      current += delta;
      const who = l.by || "—";
      people[who] = (people[who] || 0) + delta;
    }
    current = Math.max(0, current);
  }

  return {
    range,
    target,
    current,
    pct: Math.min(100, Math.round((current / target) * 100)),
    done: current >= target,
    left: Math.max(0, target - current),
    days: daysLeft(range, today),
    people: Object.entries(people)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1]),
  };
}
