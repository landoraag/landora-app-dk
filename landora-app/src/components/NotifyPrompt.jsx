import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import { pushStatus, refreshPushToken } from "../lib/push";

const DISMISS_KEY = "landora.push.promptDismissed";

// Convite discreto para ativar as notificações (aparece uma vez por aparelho, até dispensar).
// Também mantém o "endereço" deste aparelho atualizado quando as notificações já estão ativas.
export default function NotifyPrompt() {
  const { user, profile } = useAuth();
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!user) return;
    const st = pushStatus();
    if (st === "on") refreshPushToken({ uid: user.uid, nickname: profile?.nickname });
    let dismissed = false;
    try {
      dismissed = localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      /* sem armazenamento */
    }
    setShow(!dismissed && (st === "off" || st === "ios-home"));
  }, [user, profile?.nickname]);

  if (!show) return null;
  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* sem armazenamento */
    }
    setShow(false);
  };

  return (
    <div className="notify-prompt" role="status">
      <span>🔔 Quer receber avisos de mensagens, calls e tarefas neste aparelho?</span>
      <Link to="/perfil" onClick={dismiss}>
        Ativar
      </Link>
      <button type="button" onClick={dismiss} aria-label="Agora não">
        ✕
      </button>
    </div>
  );
}
