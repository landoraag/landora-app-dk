import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { todayISO } from "../../lib/format";
import { isOverdue, sortTasks } from "../../lib/tasks";
import {
  EMPTY_EVENT,
  EVENT_TYPES,
  MONTHS,
  WEEKDAYS_SHORT,
  buildICS,
  googleTemplateLink,
  longDayLabel,
  monthGrid,
  parseISO,
  sortEvents,
  typeOfEvent,
} from "../../lib/agenda";
import {
  gcalConfigured,
  gcalConnect,
  gcalConnected,
  gcalDisconnect,
  gcalInsert,
  gcalList,
  gcalRemove,
  gcalUpdate,
} from "../../lib/gcal";
import { TaskFormModal, TaskItem } from "../TaskParts";

const timeLabel = (e) => (e.startTime ? (e.endTime ? `${e.startTime}–${e.endTime}` : e.startTime) : "Dia inteiro");

/* ---------------- formulário de compromisso ---------------- */
function EventFormModal({ event, presetDate, googleOn, onClose, onDone }) {
  const { user, profile } = useAuth();
  const [form, setForm] = useState(() =>
    event
      ? {
          title: event.title || "",
          type: event.type || "compromisso",
          date: event.date || presetDate,
          allDay: !event.startTime,
          startTime: event.startTime || "09:00",
          endTime: event.endTime || "",
          location: event.location || "",
          notes: event.notes || "",
        }
      : EMPTY_EVENT(presetDate)
  );
  const [sync, setSync] = useState(!!event?.gcalId || googleOn);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  const draft = () => ({
    title: form.title.trim(),
    type: form.type,
    date: form.date,
    startTime: form.allDay ? "" : form.startTime,
    endTime: form.allDay ? "" : form.endTime,
    location: form.location.trim(),
    notes: form.notes.trim(),
  });

  async function handleSave(e) {
    e.preventDefault();
    const data = draft();
    if (!data.title) return setError("Dê um título para o compromisso.");
    if (!data.date) return setError("Escolha o dia.");
    if (!form.allDay && !data.startTime) return setError("Escolha o horário (ou marque “Dia inteiro”).");
    if (data.endTime && data.endTime <= data.startTime) return setError("O horário de fim precisa ser depois do início.");
    setSaving(true);
    setError("");
    let id = event?.id;
    try {
      if (event) {
        await updateDoc(doc(db, "events", event.id), { ...data, updatedAt: serverTimestamp() });
      } else {
        const ref = await addDoc(collection(db, "events"), {
          ...data,
          gcalId: "",
          createdBy: user.uid,
          createdByNickname: profile?.nickname || "",
          createdAt: serverTimestamp(),
        });
        id = ref.id;
      }
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar.");
      setSaving(false);
      return;
    }

    // Google Agenda (se estiver conectado): o compromisso já está salvo, então um erro aqui só avisa.
    let msg = "Salvo!";
    if (gcalConnected() && (sync || event?.gcalId)) {
      try {
        if (event?.gcalId) {
          await gcalUpdate(event.gcalId, data);
          msg = "Salvo e atualizado no Google Agenda!";
        } else if (sync) {
          const gcalId = await gcalInsert(data);
          await updateDoc(doc(db, "events", id), { gcalId });
          msg = "Salvo e enviado ao Google Agenda!";
        }
      } catch (err) {
        console.error(err);
        msg = `Salvo, mas não foi para o Google Agenda: ${err.message}`;
      }
    }
    onDone(msg, data.date);
  }

  async function handleDelete() {
    if (!confirm(`Excluir "${event.title}"?`)) return;
    setSaving(true);
    let msg = "Excluído.";
    try {
      if (event.gcalId && gcalConnected()) await gcalRemove(event.gcalId);
      else if (event.gcalId) msg = "Excluído aqui. No Google Agenda ele continua (conecte para apagar lá também).";
      await deleteDoc(doc(db, "events", event.id));
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível excluir.");
      setSaving(false);
      return;
    }
    onDone(msg);
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <form onSubmit={handleSave} className="lp-form">
          <h3>{event ? "Editar compromisso" : "Novo compromisso"}</h3>

          <label>
            Título
            <input autoFocus value={form.title} onChange={set("title")} placeholder="ex: Reunião com a Padaria Central" />
          </label>

          <div className="task-pr-pick" role="radiogroup" aria-label="Tipo">
            <span>Tipo</span>
            <div className="agenda-type-pick">
              {EVENT_TYPES.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="radio"
                  aria-checked={form.type === t.key}
                  className={"task-pr-opt " + t.cls + (form.type === t.key ? " sel" : "")}
                  onClick={() => setForm({ ...form, type: t.key })}
                >
                  {t.icon} {t.label}
                </button>
              ))}
            </div>
          </div>

          <div className="two-col">
            <label>
              Dia
              <input type="date" value={form.date} onChange={set("date")} />
            </label>
            <label className="agenda-allday">
              <span>Horário</span>
              <span className="agenda-check">
                <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} />
                Dia inteiro (sem horário)
              </span>
            </label>
          </div>

          {!form.allDay && (
            <div className="two-col">
              <label>
                Começa às
                <input type="time" value={form.startTime} onChange={set("startTime")} />
              </label>
              <label>
                Termina às (opcional)
                <input type="time" value={form.endTime} onChange={set("endTime")} />
              </label>
            </div>
          )}

          <label>
            Local ou link da chamada (opcional)
            <input value={form.location} onChange={set("location")} placeholder="ex: Google Meet, endereço…" />
          </label>

          <label>
            Anotações
            <textarea rows={3} value={form.notes} onChange={set("notes")} placeholder="Pauta, o que levar, contato…" />
          </label>

          {gcalConfigured && (
            <label className="agenda-check agenda-sync">
              <input
                type="checkbox"
                checked={sync}
                disabled={!googleOn || !!event?.gcalId}
                onChange={(e) => setSync(e.target.checked)}
              />
              {event?.gcalId
                ? "Ligado ao Google Agenda (as mudanças vão para lá)"
                : googleOn
                  ? "Enviar para o Google Agenda"
                  : "Conecte o Google Agenda (botão no topo) para enviar automático"}
            </label>
          )}

          {event && (
            <a className="btn-link agenda-gcal-link" href={googleTemplateLink(draft())} target="_blank" rel="noreferrer">
              ➕ Adicionar ao Google Agenda (abre o Google)
            </a>
          )}

          {error && <p className="auth-error">{error}</p>}

          <div className="modal-actions">
            {event && (
              <button type="button" className="btn-link danger task-del" onClick={handleDelete} disabled={saving}>
                Excluir
              </button>
            )}
            <button type="button" className="btn-link" onClick={onClose} disabled={saving}>
              cancelar
            </button>
            <button className="btn btn-gradient" type="submit" disabled={saving}>
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ---------------- aba ---------------- */
export default function Agenda() {
  const navigate = useNavigate();
  const { data: events } = useCollection("events", "date", "asc");
  const { data: tasks } = useCollection("tasks", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");

  const today = todayISO();
  const t0 = parseISO(today);
  const [ym, setYm] = useState({ y: t0.y, m: t0.m });
  const [selected, setSelected] = useState(today);
  const [modal, setModal] = useState(null); // null | { event?: evento }
  const [taskModal, setTaskModal] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [msg, setMsg] = useState("");
  const [googleOn, setGoogleOn] = useState(gcalConnected());
  const [gEvents, setGEvents] = useState([]);
  const [gTick, setGTick] = useState(0);

  const flash = (text) => {
    setMsg(text);
    setTimeout(() => setMsg(""), 3500);
  };

  const weeks = useMemo(() => monthGrid(ym.y, ym.m), [ym]);
  const rangeStart = weeks[0][0].iso;
  const rangeEnd = weeks[weeks.length - 1][6].iso;

  // Eventos que vêm do Google (só leitura) para o mês na tela.
  useEffect(() => {
    if (!googleOn || !gcalConnected()) {
      setGEvents([]);
      return undefined;
    }
    let alive = true;
    const next = new Date(rangeEnd + "T00:00:00");
    next.setDate(next.getDate() + 1);
    const endExclusive = new Date(next.getTime() - next.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    gcalList(rangeStart, endExclusive)
      .then((list) => alive && setGEvents(list))
      .catch((e) => {
        console.error(e);
        if (!alive) return;
        if (e.code === "auth") setGoogleOn(false);
        flash(e.message);
      });
    return () => {
      alive = false;
    };
  }, [googleOn, rangeStart, rangeEnd, gTick]);

  // Tudo agrupado por dia.
  const byDay = useMemo(() => {
    const map = {};
    const slot = (d) => (map[d] ||= { events: [], tasks: [], google: [] });
    const linked = new Set(events.map((e) => e.gcalId).filter(Boolean));
    events.forEach((e) => e.date && slot(e.date).events.push(e));
    tasks.forEach((t) => t.dueDate && t.status !== "done" && slot(t.dueDate).tasks.push(t));
    gEvents.forEach((g) => g.date && !linked.has(g.gid) && slot(g.date).google.push(g));
    return map;
  }, [events, tasks, gEvents]);

  const dayData = byDay[selected] || { events: [], tasks: [], google: [] };
  const dayItems = sortEvents([...dayData.events, ...dayData.google]);
  const dayTasks = sortTasks(dayData.tasks);
  const overdue = useMemo(() => sortTasks(tasks.filter(isOverdue)), [tasks]);

  function go(delta) {
    const d = new Date(ym.y, ym.m + delta, 1);
    setYm({ y: d.getFullYear(), m: d.getMonth() });
  }
  function goToday() {
    setYm({ y: t0.y, m: t0.m });
    setSelected(today);
  }
  function pick(iso, inMonth) {
    setSelected(iso);
    if (!inMonth) {
      const p = parseISO(iso);
      setYm({ y: p.y, m: p.m });
    }
  }

  async function connectGoogle() {
    setMenuOpen(false);
    try {
      await gcalConnect();
      setGoogleOn(true);
      setGTick((n) => n + 1);
      flash("Google Agenda conectado!");
    } catch (e) {
      console.error(e);
      flash(e.message);
    }
  }
  function disconnectGoogle() {
    setMenuOpen(false);
    gcalDisconnect();
    setGoogleOn(false);
    setGEvents([]);
    flash("Google Agenda desconectado.");
  }
  function downloadICS() {
    setMenuOpen(false);
    const text = buildICS(
      events.filter((e) => e.date),
      tasks.filter((t) => t.dueDate && t.status !== "done")
    );
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/calendar;charset=utf-8" }));
    a.download = `agenda-landora-${today}.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
    flash("Arquivo da agenda baixado! Importe no Google Agenda (Configurações → Importar).");
  }

  const monthCount = useMemo(() => {
    const prefix = `${ym.y}-${String(ym.m + 1).padStart(2, "0")}`;
    return Object.entries(byDay).reduce(
      (n, [d, v]) => (d.startsWith(prefix) ? n + v.events.length + v.tasks.length : n),
      0
    );
  }, [byDay, ym]);

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Agenda</h2>
          <p className="muted">
            Reuniões, dias de fazer algo e prazos das tarefas.
            {overdue.length > 0 && (
              <span className="task-late-note">
                {" "}
                {overdue.length} tarefa{overdue.length > 1 ? "s" : ""} atrasada{overdue.length > 1 ? "s" : ""}.
              </span>
            )}
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {msg && <span className="muted agenda-msg">{msg}</span>}
          <div style={{ position: "relative" }}>
            <button
              type="button"
              className="btn agenda-gbtn"
              onClick={() => setMenuOpen((v) => !v)}
              aria-expanded={menuOpen}
              title="Google Agenda"
            >
              📆 Google Agenda{googleOn ? " ✓" : ""}
            </button>
            {menuOpen && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setMenuOpen(false)} />
                <div className="agenda-menu">
                  {gcalConfigured &&
                    (googleOn ? (
                      <>
                        <button type="button" className="btn-link" onClick={() => { setMenuOpen(false); setGTick((n) => n + 1); }}>
                          ↻ Atualizar eventos do Google
                        </button>
                        <button type="button" className="btn-link" onClick={disconnectGoogle}>
                          ⏏ Desconectar
                        </button>
                      </>
                    ) : (
                      <button type="button" className="btn-link" onClick={connectGoogle}>
                        🔗 Conectar Google Agenda
                      </button>
                    ))}
                  <button type="button" className="btn-link" onClick={downloadICS}>
                    ⬇ Baixar agenda (.ics)
                  </button>
                  <p className="muted agenda-menu-note">
                    {gcalConfigured
                      ? googleOn
                        ? "Conectado: o que você marcar “Enviar para o Google” vai direto para a sua agenda, e os eventos de lá aparecem aqui."
                        : "Conecte para enviar compromissos ao Google e ver os eventos de lá aqui."
                      : "Sem conexão direta ainda: use “Adicionar ao Google Agenda” em cada compromisso ou baixe o .ics e importe."}
                  </p>
                </div>
              </>
            )}
          </div>
          <button className="btn btn-gradient" onClick={() => setModal({ event: null })}>
            + Novo compromisso
          </button>
        </div>
      </header>

      <div className="agenda-nav">
        <button type="button" className="agenda-nav-btn" onClick={() => go(-1)} aria-label="Mês anterior">
          ‹
        </button>
        <h3 className="agenda-month">
          {MONTHS[ym.m]} {ym.y}
          <span className="muted agenda-count">{monthCount} no mês</span>
        </h3>
        <button type="button" className="agenda-nav-btn" onClick={() => go(1)} aria-label="Próximo mês">
          ›
        </button>
        <button type="button" className="btn-link" onClick={goToday}>
          Hoje
        </button>
      </div>

      <div className="agenda-grid" role="grid" aria-label={`${MONTHS[ym.m]} ${ym.y}`}>
        {WEEKDAYS_SHORT.map((w) => (
          <div key={w} className="agenda-wd">
            {w}
          </div>
        ))}
        {weeks.flat().map((c) => {
          const v = byDay[c.iso];
          const evs = v ? sortEvents([...v.events, ...v.google]) : [];
          const nTasks = v ? v.tasks.length : 0;
          const total = evs.length + nTasks;
          return (
            <button
              key={c.iso}
              type="button"
              className={
                "agenda-cell" +
                (c.inMonth ? "" : " out") +
                (c.iso === today ? " today" : "") +
                (c.iso === selected ? " sel" : "")
              }
              onClick={() => pick(c.iso, c.inMonth)}
              onDoubleClick={() => setModal({ event: null, date: c.iso })}
              aria-label={`${c.day}, ${total} item${total === 1 ? "" : "s"}`}
              aria-pressed={c.iso === selected}
            >
              <span className="agenda-day">{c.day}</span>
              <span className="agenda-chips">
                {evs.slice(0, 2).map((e) => (
                  <span key={e.id} className={"agenda-chip " + (e.google ? "ev-google" : typeOfEvent(e.type).cls)}>
                    {e.startTime ? e.startTime + " " : ""}
                    {e.title}
                  </span>
                ))}
                {nTasks > 0 && evs.length < 2 && (
                  <span className="agenda-chip ev-task">
                    📋 {nTasks} prazo{nTasks > 1 ? "s" : ""}
                  </span>
                )}
                {evs.length > 2 || (evs.length >= 2 && nTasks > 0) ? (
                  <span className="agenda-more">+{evs.length - 2 + (evs.length >= 2 ? nTasks : 0)}</span>
                ) : null}
              </span>
              {total > 0 && (
                <span className="agenda-dots" aria-hidden="true">
                  {evs.slice(0, 3).map((e) => (
                    <i key={e.id} className={e.google ? "ev-google" : typeOfEvent(e.type).cls} />
                  ))}
                  {nTasks > 0 && <i className="ev-task" />}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <section className="agenda-day-panel">
        <div className="agenda-day-head">
          <h3>
            {longDayLabel(selected)}
            {selected === today && <span className="agenda-today-tag">hoje</span>}
          </h3>
          <button type="button" className="btn-link" onClick={() => setModal({ event: null, date: selected })}>
            + Marcar neste dia
          </button>
        </div>

        {dayItems.length === 0 && dayTasks.length === 0 && (
          <p className="muted empty">Nada marcado para este dia.</p>
        )}

        <div className="agenda-list">
          {dayItems.map((e) => {
            const tp = typeOfEvent(e.type);
            return (
              <div
                key={e.id}
                className={"agenda-item " + (e.google ? "ev-google" : tp.cls)}
                onClick={() => !e.google && setModal({ event: e })}
                style={{ cursor: e.google ? "default" : "pointer" }}
              >
                <div className="agenda-time">{timeLabel(e)}</div>
                <div className="agenda-main">
                  <div className="agenda-title">{e.title}</div>
                  <div className="task-meta">
                    <span className="task-chip">{e.google ? "📆 Google Agenda" : `${tp.icon} ${tp.label}`}</span>
                    {e.location && <span className="task-chip">📍 {e.location}</span>}
                    {e.gcalId && <span className="task-chip agenda-synced">✓ no Google</span>}
                  </div>
                  {e.notes && <div className="agenda-notes muted">{e.notes}</div>}
                </div>
                {e.google ? (
                  e.link && (
                    <a className="btn-link" href={e.link} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()}>
                      abrir
                    </a>
                  )
                ) : (
                  <a
                    className="btn-link agenda-add-g"
                    href={googleTemplateLink(e)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    title="Adicionar ao Google Agenda"
                  >
                    ➕ Google
                  </a>
                )}
              </div>
            );
          })}
        </div>

        {dayTasks.length > 0 && (
          <>
            <div className="agenda-sub">📋 Tarefas com prazo neste dia</div>
            <div className="task-list">
              {dayTasks.map((t) => (
                <TaskItem
                  key={t.id}
                  task={t}
                  onOpen={setTaskModal}
                  onGoPage={(pageId) => navigate("/landing-pages", { state: { openPageId: pageId } })}
                />
              ))}
            </div>
          </>
        )}
      </section>

      {overdue.length > 0 && (
        <section className="agenda-day-panel agenda-overdue">
          <div className="agenda-day-head">
            <h3>⚠️ Atrasadas</h3>
          </div>
          <div className="task-list">
            {overdue.map((t) => (
              <TaskItem
                key={t.id}
                task={t}
                onOpen={setTaskModal}
                onGoPage={(pageId) => navigate("/landing-pages", { state: { openPageId: pageId } })}
              />
            ))}
          </div>
        </section>
      )}

      {modal && (
        <EventFormModal
          event={modal.event}
          presetDate={modal.date || selected}
          googleOn={googleOn}
          onClose={() => setModal(null)}
          onDone={(text, date) => {
            setModal(null);
            flash(text);
            if (date) {
              setSelected(date);
              const p = parseISO(date);
              setYm({ y: p.y, m: p.m });
            }
          }}
        />
      )}
      {taskModal && <TaskFormModal task={taskModal} pages={pages} onClose={() => setTaskModal(null)} />}
    </div>
  );
}
