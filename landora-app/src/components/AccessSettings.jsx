import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import Icon from "./Icons";

const norm = (e) => String(e || "").trim().toLowerCase();
const validEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

// "Acesso ao app": quem pode ver e mexer nos dados do Landora.
export default function AccessSettings() {
  const { user, profile, access, checkAccess } = useAuth();
  const me = norm(user?.email);
  const [list, setList] = useState(null); // e-mails da lista (proteção ativa)
  const [draft, setDraft] = useState([]); // e-mails escolhidos antes de ativar
  const [newEmail, setNewEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // Proteção ativa: acompanha a lista.
  useEffect(() => {
    if (access !== "member") return undefined;
    return onSnapshot(
      doc(db, "config", "access"),
      (snap) => setList(snap.exists() ? (snap.data().emails || []).map(norm) : []),
      () => setList([])
    );
  }, [access]);

  // Proteção ainda não ativa: sugere os e-mails de quem já tem conta.
  useEffect(() => {
    if (access !== "open") return;
    getDocs(collection(db, "users"))
      .then((snap) => {
        const emails = snap.docs.map((d) => norm(d.data().email)).filter(validEmail);
        setDraft([...new Set([me, ...emails])].filter(Boolean));
      })
      .catch(() => setDraft([me]));
  }, [access, me]);

  const current = access === "member" ? list || [] : draft;
  const sorted = useMemo(() => [...current].sort((a, b) => (a === me ? -1 : b === me ? 1 : a.localeCompare(b))), [current, me]);

  async function save(emails, okMsg) {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      const clean = [...new Set(emails.map(norm).filter(validEmail))];
      if (!clean.includes(me)) clean.unshift(me);
      if (access === "member") {
        await updateDoc(doc(db, "config", "access"), { emails: clean, updatedAt: serverTimestamp(), updatedBy: profile?.nickname || me });
      } else {
        await setDoc(doc(db, "config", "access"), { emails: clean, createdAt: serverTimestamp(), updatedBy: profile?.nickname || me });
        await checkAccess();
      }
      setMsg(okMsg);
    } catch (e) {
      console.error(e);
      setErr(
        e?.code === "permission-denied"
          ? "O servidor recusou. As regras de segurança novas precisam ser publicadas primeiro (npm run deploy)."
          : e.message || "Não foi possível salvar."
      );
    } finally {
      setBusy(false);
    }
  }

  function add(e) {
    e.preventDefault();
    const em = norm(newEmail);
    if (!validEmail(em)) return setErr("Digite um e-mail válido.");
    if (current.includes(em)) return setErr("Esse e-mail já está na lista.");
    setNewEmail("");
    setErr("");
    if (access === "member") save([...current, em], `${em} agora tem acesso.`);
    else setDraft([...draft, em]);
  }

  function remove(em) {
    if (em === me) return;
    if (access === "member") {
      if (!confirm(`Tirar o acesso de ${em}? A pessoa deixa de ver qualquer dado do Landora.`)) return;
      save(current.filter((x) => x !== em), `${em} não tem mais acesso.`);
    } else setDraft(draft.filter((x) => x !== em));
  }

  const on = access === "member";

  return (
    <section className="notif-card access-card">
      <div className="notif-top">
        <div className={"notif-icon" + (on ? " on" : " warn")}>
          <Icon name="lock" size={22} />
        </div>
        <div className="notif-title">
          <div className="notif-title-row">
            <h3>Acesso ao app</h3>
            <span className={"notif-pill " + (on ? "on" : "warn")}>
              <i />
              {on ? "Protegido" : "Aberto"}
            </span>
          </div>
          <p className="muted">
            {on
              ? "Só os e-mails abaixo veem e alteram os dados do Landora. Quem criar conta com outro e-mail não vê nada."
              : "Hoje qualquer pessoa que criar uma conta pelo link do app vê e altera todos os dados (inclusive o Financeiro). Confira os e-mails abaixo e ative a proteção."}
          </p>
        </div>
        {!on && (
          <div className="notif-actions">
            <button className="btn btn-gradient" disabled={busy || !draft.length} onClick={() => save(draft, "Proteção ativada!")}>
              {busy ? "Ativando…" : "Ativar proteção"}
            </button>
          </div>
        )}
      </div>

      <div className="access-list">
        {sorted.map((em) => (
          <div key={em} className="access-row">
            <span className="access-email">{em}</span>
            {em === me ? (
              <span className="access-you">você</span>
            ) : (
              <button type="button" className="access-remove" onClick={() => remove(em)} disabled={busy} aria-label={`Tirar ${em}`}>
                <Icon name="close" size={15} />
              </button>
            )}
          </div>
        ))}
        {on && list === null && <p className="muted">Carregando…</p>}
      </div>

      <form className="access-add" onSubmit={add}>
        <input
          type="email"
          value={newEmail}
          onChange={(e) => setNewEmail(e.target.value)}
          placeholder="e-mail de um sócio (ex.: nome@gmail.com)"
          autoComplete="off"
        />
        <button className="btn btn-ghost" type="submit" disabled={busy || !newEmail.trim()}>
          {on ? "Liberar acesso" : "Adicionar"}
        </button>
      </form>

      {(msg || err) && (
        <div className="notif-foot">
          {msg && <span className="notif-ok">{msg}</span>}
          {err && <span className="auth-error">{err}</span>}
        </div>
      )}
    </section>
  );
}
