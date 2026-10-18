import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { DEFAULT_PREFS, PUSH_KINDS, currentToken, disablePush, enablePush, isIOS, pushStatus, savePushPrefs } from "../lib/push";

const STATUS_TEXT = {
  unconfigured: "As notificações ainda não foram configuradas no servidor do app.",
  unsupported: "Este aparelho ou navegador não permite notificações de site. No app do Windows, use o site no navegador para receber avisos.",
  "ios-home":
    "No iPhone, as notificações só funcionam pelo atalho: toque em Compartilhar → “Adicionar à Tela de Início” e abra o Landora pelo ícone novo.",
  denied: "As notificações estão bloqueadas para o Landora. Libere nas configurações do navegador (ou do celular) e volte aqui.",
};

// Ativar/desativar notificações neste aparelho e escolher o que receber.
export default function NotificationSettings() {
  const { user, profile } = useAuth();
  const [status, setStatus] = useState(pushStatus);
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  const [busy, setBusy] = useState(false);
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
    try {
      await enablePush({ uid: user.uid, nickname: profile?.nickname, prefs });
      setStatus("on");
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
    await disablePush();
    setStatus(pushStatus());
    setBusy(false);
  }

  async function toggle(key) {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    savePushPrefs(next).catch(() => setErr("Não consegui salvar a preferência."));
  }

  return (
    <section className="notif-card">
      <div className="notif-head">
        <div>
          <h3>🔔 Notificações neste aparelho</h3>
          <p className="muted">
            {status === "on"
              ? "Ativadas. Você recebe avisos mesmo com o Landora fechado."
              : STATUS_TEXT[status] || "Receba avisos no celular ou no computador, mesmo com o Landora fechado."}
          </p>
        </div>
        {status === "on" ? (
          <button className="btn btn-ghost" disabled={busy} onClick={turnOff}>
            Desativar
          </button>
        ) : status === "off" ? (
          <button className="btn btn-gradient" disabled={busy} onClick={turnOn}>
            {busy ? "Ativando…" : "Ativar"}
          </button>
        ) : null}
      </div>

      {status === "on" && (
        <div className="notif-kinds">
          {PUSH_KINDS.map((k) => (
            <label key={k.key} className="notif-kind">
              <input type="checkbox" checked={prefs[k.key] !== false} onChange={() => toggle(k.key)} />
              <span>{k.label}</span>
            </label>
          ))}
        </div>
      )}
      {status === "ios-home" && isIOS() && <p className="hint">Precisa do iOS 16.4 ou mais novo.</p>}
      {err && <p className="auth-error">{err}</p>}
    </section>
  );
}
