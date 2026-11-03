import { useMemo, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { todayISO, formatDate } from "../../lib/format";
import { EMPTY_GOAL, GOAL_KINDS, GOAL_PERIODS, goalProgress, kindOf, periodOf } from "../../lib/goals";

function GoalFormModal({ goal, onClose }) {
  const { user, profile } = useAuth();
  const [form, setForm] = useState(() =>
    goal
      ? { title: goal.title || "", kind: goal.kind || "contatos", target: String(goal.target || ""), period: goal.period || "semana" }
      : { ...EMPTY_GOAL }
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const kind = kindOf(form.kind);

  async function handleSave(e) {
    e.preventDefault();
    const target = Number(form.target);
    if (!Number.isFinite(target) || target < 1) return setError("Coloque quanto você quer alcançar (1 ou mais).");
    setSaving(true);
    setError("");
    try {
      const payload = {
        title: form.title.trim() || kind.label,
        kind: form.kind,
        target: Math.round(target),
        period: form.period,
      };
      if (goal) {
        await updateDoc(doc(db, "goals", goal.id), { ...payload, updatedAt: serverTimestamp() });
      } else {
        await addDoc(collection(db, "goals"), {
          ...payload,
          createdBy: user.uid,
          createdByNickname: profile?.nickname || "",
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err) {
      console.error(err);
      setError(err.message || "Não foi possível salvar a meta.");
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Excluir a meta "${goal.title}"?`)) return;
    await deleteDoc(doc(db, "goals", goal.id));
    onClose();
  }

  return (
    <div className="modal-backdrop" onClick={() => !saving && onClose()}>
      <div className="modal-card wide" onClick={(e) => e.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Fechar">
          ✕
        </button>
        <form onSubmit={handleSave} className="lp-form">
          <h3>{goal ? "Editar meta" : "Nova meta"}</h3>

          <label>
            O que medir
            <select value={form.kind} onChange={set("kind")}>
              {GOAL_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.icon} {k.label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted goal-hint">
            {kind.auto
              ? "Conta sozinha: o app já conhece esse número (Vendas, Leads ou Agenda)."
              : "Você conta no botão +1 sempre que fizer um."}
          </p>

          <label>
            Nome da meta (opcional)
            <input value={form.title} onChange={set("title")} placeholder={`ex: ${kind.label} da semana`} />
          </label>

          <div className="two-col">
            <label>
              Quanto alcançar
              <input type="number" min="1" inputMode="numeric" value={form.target} onChange={set("target")} placeholder="ex: 20" />
            </label>
            <label>
              Período
              <select value={form.period} onChange={set("period")}>
                {GOAL_PERIODS.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {error && <p className="auth-error">{error}</p>}

          <div className="modal-actions">
            {goal && (
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

export default function Metas() {
  const { user, profile } = useAuth();
  const { data: goals, loading } = useCollection("goals", "createdAt", "asc");
  const { data: logs } = useCollection("goalLogs", "createdAt", "asc");
  const { data: sales } = useCollection("sales", "date", "desc");
  const { data: leads } = useCollection("leads", "createdAt", "desc");
  const { data: events } = useCollection("events", "date", "asc");

  const [modal, setModal] = useState(null); // null | "new" | meta
  const today = todayISO();

  const rows = useMemo(
    () => goals.map((g) => ({ goal: g, kind: kindOf(g.kind), p: goalProgress(g, { sales, leads, events, logs }, today) })),
    [goals, sales, leads, events, logs, today]
  );
  const reached = rows.filter((r) => r.p.done).length;

  async function addLog(goal, delta) {
    try {
      await addDoc(collection(db, "goalLogs"), {
        goalId: goal.id,
        delta,
        date: todayISO(),
        uid: user.uid,
        by: profile?.nickname || "",
        createdAt: serverTimestamp(),
      });
    } catch (e) {
      console.error(e);
      alert("Não deu para registrar. Tente de novo.");
    }
  }

  return (
    <div>
      <header className="content-header leads-head">
        <div>
          <h2>Metas</h2>
          <p className="muted">
            Contatos, prospecções, reuniões e vendas do período.
            {rows.length > 0 && (
              <span className="goal-reached-note">
                {" "}
                {reached} de {rows.length} batida{reached === 1 ? "" : "s"}.
              </span>
            )}
          </p>
        </div>
        <button className="btn btn-gradient" onClick={() => setModal("new")}>
          + Nova meta
        </button>
      </header>

      <div className="goal-grid">
        {rows.map(({ goal, kind, p }) => (
          <div key={goal.id} className={"goal-card" + (p.done ? " done" : "")}>
            <div className="goal-top">
              <span className="goal-icon" aria-hidden="true">
                {kind.icon}
              </span>
              <div className="goal-titles">
                <div className="goal-title">{goal.title || kind.label}</div>
                <div className="goal-sub muted">
                  {periodOf(goal.period).label} · {formatDate(p.range.start)}
                  {p.range.end !== p.range.start ? ` a ${formatDate(p.range.end)}` : ""}
                </div>
              </div>
              <button type="button" className="chat-icon-btn" onClick={() => setModal(goal)} aria-label="Editar meta" title="Editar meta">
                ✎
              </button>
            </div>

            <div className="goal-numbers">
              <b>{p.current}</b>
              <span className="muted"> / {p.target}</span>
              <span className="goal-pct">{p.pct}%</span>
            </div>
            <div className="goal-bar" role="progressbar" aria-valuemin={0} aria-valuemax={p.target} aria-valuenow={p.current}>
              <div className="goal-bar-fill" style={{ width: p.pct + "%" }} />
            </div>

            <div className="goal-foot">
              <span className="muted">
                {p.done
                  ? "🎉 Meta batida!"
                  : `Faltam ${p.left}${kind.unit ? " " + kind.unit : ""} · ${p.days} ${p.days === 1 ? "dia" : "dias"} para acabar`}
              </span>
              {!kind.auto && (
                <div className="goal-actions">
                  <button type="button" className="goal-step" onClick={() => addLog(goal, -1)} disabled={p.current <= 0} aria-label="Tirar 1" title="Tirar 1">
                    −
                  </button>
                  <button type="button" className="goal-step plus" onClick={() => addLog(goal, 1)} aria-label="Somar 1" title="Somar 1">
                    +1
                  </button>
                </div>
              )}
            </div>

            {p.people.length > 1 && (
              <div className="goal-people muted">{p.people.map(([name, n]) => `${name}: ${n}`).join(" · ")}</div>
            )}
          </div>
        ))}
      </div>

      {!loading && rows.length === 0 && (
        <p className="muted empty">Nenhuma meta ainda. Crie a primeira em “+ Nova meta”.</p>
      )}

      {modal && <GoalFormModal goal={modal === "new" ? null : modal} onClose={() => setModal(null)} />}
    </div>
  );
}
