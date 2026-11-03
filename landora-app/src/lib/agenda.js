// Regras da aba Agenda.
//
// Firestore: events/{id} -> {
//   title, type, date ("AAAA-MM-DD"), startTime ("HH:MM" ou "" = dia inteiro), endTime ("HH:MM" ou ""),
//   location, notes, gcalId (id do evento no Google Agenda, se estiver sincronizado),
//   createdBy, createdByNickname, createdAt
// }
// As tarefas com prazo (tasks.dueDate) aparecem na agenda sozinhas, no dia do prazo.

import { addDays, todayISO } from "./format";

export const EVENT_TYPES = [
  { key: "reuniao", label: "Reunião", icon: "🤝", cls: "ev-reuniao" },
  { key: "fazer", label: "Dia de fazer algo", icon: "🛠️", cls: "ev-fazer" },
  { key: "compromisso", label: "Compromisso", icon: "📌", cls: "ev-compromisso" },
  { key: "outro", label: "Outro", icon: "📅", cls: "ev-outro" },
];
export const typeOfEvent = (key) => EVENT_TYPES.find((t) => t.key === key) || EVENT_TYPES[2];

export const EMPTY_EVENT = (date = todayISO()) => ({
  title: "",
  type: "reuniao",
  date,
  allDay: false,
  startTime: "09:00",
  endTime: "10:00",
  location: "",
  notes: "",
});

export const TZ = "America/Sao_Paulo";
export const MONTHS = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];
export const WEEKDAYS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
export const WEEKDAYS_LONG = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];

const pad = (n) => String(n).padStart(2, "0");
export const monthKey = (y, m) => `${y}-${pad(m + 1)}`;

// "AAAA-MM-DD" -> { y, m (0-11), d }
export function parseISO(dateStr) {
  const [y, m, d] = String(dateStr).split("-").map(Number);
  return { y, m: m - 1, d };
}

// Grade do mês: lista de semanas (domingo a sábado); cada dia = { iso, day, inMonth }.
export function monthGrid(y, m) {
  const first = new Date(y, m, 1);
  const total = new Date(y, m + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < first.getDay(); i++) {
    const d = new Date(y, m, 1 - (first.getDay() - i));
    cells.push({ iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), inMonth: false });
  }
  for (let d = 1; d <= total; d++) cells.push({ iso: `${y}-${pad(m + 1)}-${pad(d)}`, day: d, inMonth: true });
  while (cells.length % 7) {
    const d = new Date(y, m + 1, cells.length - first.getDay() - total + 1);
    cells.push({ iso: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, day: d.getDate(), inMonth: false });
  }
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

export function longDayLabel(dateStr) {
  const { y, m, d } = parseISO(dateStr);
  const wd = new Date(y, m, d).getDay();
  return `${WEEKDAYS_LONG[wd]}, ${pad(d)}/${pad(m + 1)}`;
}

// Horário "HH:MM" mais uma hora (para quando o evento não tem fim).
export function plusOneHour(time) {
  const [h, mi] = String(time || "09:00").split(":").map(Number);
  return `${pad((h + 1) % 24)}:${pad(mi || 0)}`;
}

export const eventEnd = (e) => e.endTime || plusOneHour(e.startTime);

// Ordem do dia: sem horário primeiro, depois por horário.
export function sortEvents(list) {
  return [...list].sort((a, b) => (a.startTime || "").localeCompare(b.startTime || "") || (a.title || "").localeCompare(b.title || ""));
}

/* ---------------- Google Agenda ---------------- */

// Link "Adicionar ao Google Agenda": funciona sem configurar nada (abre o Google já preenchido).
export function googleTemplateLink(e) {
  const compact = (d) => d.replace(/-/g, "");
  let dates;
  if (e.startTime) {
    dates = `${compact(e.date)}T${e.startTime.replace(":", "")}00/${compact(e.date)}T${eventEnd(e).replace(":", "")}00`;
  } else {
    dates = `${compact(e.date)}/${compact(addDays(e.date, 1))}`;
  }
  const q = new URLSearchParams({ action: "TEMPLATE", text: e.title || "Compromisso", dates, ctz: TZ });
  if (e.notes) q.set("details", e.notes);
  if (e.location) q.set("location", e.location);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

// Corpo de um evento para a API do Google Agenda.
export function toGoogleEvent(e) {
  const body = { summary: e.title || "Compromisso", description: e.notes || "", location: e.location || "" };
  if (e.startTime) {
    body.start = { dateTime: `${e.date}T${e.startTime}:00`, timeZone: TZ };
    body.end = { dateTime: `${e.date}T${eventEnd(e)}:00`, timeZone: TZ };
  } else {
    body.start = { date: e.date };
    body.end = { date: addDays(e.date, 1) };
  }
  return body;
}

// Evento do Google -> formato da agenda (só leitura).
export function fromGoogleEvent(g) {
  const startDT = g.start?.dateTime;
  const date = (startDT || g.start?.date || "").slice(0, 10);
  const time = (iso) => (iso ? iso.slice(11, 16) : "");
  return {
    id: "g:" + g.id,
    gid: g.id,
    google: true,
    title: g.summary || "(sem título)",
    type: "outro",
    date,
    startTime: time(startDT),
    endTime: time(g.end?.dateTime),
    location: g.location || "",
    notes: g.description || "",
    link: g.htmlLink || "",
  };
}

/* ---------------- arquivo .ics (importa em qualquer agenda) ---------------- */
const icsEscape = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// events = compromissos da agenda; tasks = tarefas com prazo (viram eventos de dia inteiro).
export function buildICS(events, tasks = []) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const compact = (d) => d.replace(/-/g, "");
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Landora//Agenda//PT-BR", "CALSCALE:GREGORIAN", `X-WR-TIMEZONE:${TZ}`];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:event-${e.id}@landora`, `DTSTAMP:${stamp}`);
    if (e.startTime) {
      lines.push(`DTSTART;TZID=${TZ}:${compact(e.date)}T${e.startTime.replace(":", "")}00`);
      lines.push(`DTEND;TZID=${TZ}:${compact(e.date)}T${eventEnd(e).replace(":", "")}00`);
    } else {
      lines.push(`DTSTART;VALUE=DATE:${compact(e.date)}`, `DTEND;VALUE=DATE:${compact(addDays(e.date, 1))}`);
    }
    lines.push(`SUMMARY:${icsEscape(e.title)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    if (e.notes) lines.push(`DESCRIPTION:${icsEscape(e.notes)}`);
    lines.push("END:VEVENT");
  }
  for (const t of tasks) {
    lines.push("BEGIN:VEVENT", `UID:task-${t.id}@landora`, `DTSTAMP:${stamp}`);
    lines.push(`DTSTART;VALUE=DATE:${compact(t.dueDate)}`, `DTEND;VALUE=DATE:${compact(addDays(t.dueDate, 1))}`);
    lines.push(`SUMMARY:${icsEscape("📋 " + (t.title || "Tarefa"))}`);
    if (t.description) lines.push(`DESCRIPTION:${icsEscape(t.description)}`);
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n";
}
