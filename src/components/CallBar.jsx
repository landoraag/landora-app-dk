import { Link, useLocation } from "react-router-dom";
import { useCall } from "../context/CallContext";

// Barra que aparece nas outras abas enquanto você está em uma call.
export default function CallBar() {
  const { active, status, session, toggleMic, leave } = useCall();
  const { pathname } = useLocation();
  if (!active || status !== "live" || pathname.startsWith("/calls")) return null;

  const me = session?.localView();
  const count = (session?.snapshot().length || 0) + 1;

  return (
    <div className="call-bar">
      <span className="call-bar-name">📞 {active.name} · {count}</span>
      <button className="call-bar-btn" onClick={toggleMic}>{me?.micOn ? "🎤" : "🔇"}</button>
      <Link className="call-bar-btn" to="/calls">Abrir</Link>
      <button className="call-bar-btn leave" onClick={leave}>Sair</button>
    </div>
  );
}
