import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import Icon from "./Icons";
import {
  DEFAULT_PREFS,
  PUSH_KINDS,
  currentToken,
  deviceLabel,
  disablePush,
  enablePush,
  isIOS,
  pushStatus,
  savePushPrefs,
  sendTestPush,
} from "../lib/push";

const STATUS_TEXT = {
  unconfigured: "As notificações ainda não foram configuradas no servidor do app.",
  unsupported:
    "Este aparelho ou navegador não permite notificações de site. No app do Windows, abra o Landora no Chrome ou no Edge para receber avisos.",
  "ios-home":
    "No iPhone, as notificações só funcionam pelo atalho: toque em Compartilhar → “Adicionar à Tela de Início” e abra o Landora pelo ícone novo.",
  denied: "As notificações estão bloqueadas para o Landora. Libere nas configurações do navegador (ou do celular) e volte aqui.",
  off: "Receba avisos de mensagens, calls, tarefas, leads e vendas, mesmo com o Landora fechado.",
};

const PILL = {
  on: { cls: "on", text: "Ativas neste aparelho" },
  off: { cls: "off", text: "Desativadas" },
  denied: { cls: "warn", text: "Bloqueadas" },
  "ios-home": { cls: "warn", text: "Falta o atalho" },
  unsupported: { cls: "off", text: "Indisponível aqui" },
  unconfigured: { cls: "off", text: "Não configurado" },
};

// Ativar/desativar notificações neste aparelho, escolher o que receber e testar.
export default function NotificationSettings() {
  const { user, profile } = useAuth();
  const [status, setStatus] = useState(pushStatus);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  useEffect(() => {
    const token = currentToken();
    if (status !== "on" || !token) return;
    getDoc(doc(db, "pushTokens", token))
      .then((snap) => snap.exists() && setPrefs({ ...DEFAULT_PREFS, ...(snap.data().prefs || {}) }))
      .catch(() => {});
  }, [status]);

  async function turnOn() {
    setBusy(true);
    setErr("");
    setMsg("");
    try {
      await enablePush({ uid: user.uid, nickname: profile?.nickname, prefs });
      setStatus("on");
      setMsg("Pronto! Use “Enviar teste” para conferir.");
    } catch (e) {
      console.error(e);
      setErr(e.message || "Não foi possível ativar as notificações.");
      setStatus(pushStatus());
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setErr("");
    setMsg("");
    await disablePush();
    setStatus(pushStatus());
    setBusy(false);
  }

  async function test() {
    setTesting(true);
    setErr("");
    setMsg("");
    try {
      const sent = await sendTestPush();
      setMsg(
        sent > 0
          ? `Teste enviado para ${sent} ${sent === 1 ? "aparelho seu" : "aparelhos seus"}. Deve chegar em alguns segundos.`
          : "Nenhum aparelho seu está cadastrado. Desative e ative de novo."
      );
    } catch (e) {
      setErr(e.message || "Não foi possível enviar o teste.");
    } finally {
      setTesting(false);
    }
  }

  function toggle(key) {
    const next = { ...prefs, [key]: prefs[key] === false };
    setPrefs(next);
    savePushPrefs(next).catch(() => setErr("Não consegui salvar a preferência."));
  }

  const pill = PILL[status] || PILL.off;
  const on = status === "on";

  return (
    <section className="notif-card">
      <div className="notif-top">
        <div className={"notif-icon" + (on ? " on" : "")}>
          <Icon name="bell" size={22} />
        </div>
        <div className="notif-title">
          <div className="notif-title-row">
            <h3>Notificações</h3>
            <span className={"notif-pill " + pill.cls}>
              <i />
              {pill.text}
            </span>
          </div>
          <p className="muted">{on ? "Você recebe avisos mesmo com o Landora fechado. Escolha abaixo o que quer receber." : STATUS_TEXT[status]}</p>
          {status === "ios-home" && isIOS() && <p className="hint">Precisa do iOS 16.4 ou mais novo.</p>}
        </div>
        <div className="notif-actions">
          {on && (
            <button className="btn btn-ghost" disabled={testing} onClick={test}>
              {testing ? "Enviando…" : "Enviar teste"}
            </button>
          )}
          {on ? (
            <button className="btn-link danger" disabled={busy} onClick={turnOff}>
              Desativar
            </button>
          ) : status === "off" ? (
            <button className="btn btn-gradient" disabled={busy} onClick={turnOn}>
              {busy ? "Ativando…" : "Ativar notificações"}
            </button>
          ) : null}
        </div>
      </div>

      {on && (
        <div className="notif-grid">
          {PUSH_KINDS.map((k) => {
            const checked = prefs[k.key] !== false;
            return (
              <button
                key={k.key}
                type="button"
                role="switch"
                aria-checked={checked}
                className={"notif-row" + (checked ? " checked" : "")}
                onClick={() => toggle(k.key)}
              >
                <span className="notif-row-icon">
                  <Icon name={k.icon} size={18} />
                </span>
                <span className="notif-row-text">
                  <b>{k.label}</b>
                  <span>{k.desc}</span>
                </span>
                <span className="switch" aria-hidden="true">
                  <span />
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="notif-foot">
        <span className="muted">Este aparelho: {deviceLabel()}</span>
        {msg && <span className="notif-ok">{msg}</span>}
        {err && <span className="auth-error">{err}</span>}
      </div>
    </section>
  );
}
