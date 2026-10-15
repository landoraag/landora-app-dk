import { useEffect, useRef, useState } from "react";
import { useCall } from "../../context/CallContext";

const levelIcon = (pct) => (pct === 0 ? "🔇" : pct < 34 ? "🔈" : pct < 67 ? "🔉" : "🔊");

function VolumeRow({ label, value, onChange }) {
  // Guarda o último volume audível para o botão de mudo voltar ao mesmo ponto.
  const lastLoud = useRef(value > 0 ? value : 100);
  useEffect(() => {
    if (value > 0) lastLoud.current = value;
  }, [value]);

  return (
    <div className="vm-row">
      <button
        type="button"
        className={"vm-mute" + (value === 0 ? " is-muted" : "")}
        onClick={() => onChange(value === 0 ? lastLoud.current : 0)}
        aria-label={value === 0 ? `Ativar som: ${label}` : `Silenciar: ${label}`}
        title={value === 0 ? "Ativar som" : "Silenciar"}
      >
        {levelIcon(value)}
      </button>
      <div className="vm-body">
        <div className="vm-label">
          <span>{label}</span>
          <b>{value}%</b>
        </div>
        <input
          className="vm-slider"
          type="range"
          min="0"
          max="100"
          step="1"
          value={value}
          style={{ "--p": `${value}%` }}
          aria-label={`Volume: ${label}`}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </div>
    </div>
  );
}

// Menu que abre com o botão direito (ou no botão 🔊) sobre uma pessoa:
// volume da voz e, se ela estiver transmitindo, da tela.
export default function VolumeMenu({ menu, onClose }) {
  const { getVolume, setVolume } = useCall();
  const [values, setValues] = useState(() => ({
    voice: Math.round(getVolume(menu.uid, "voice") * 100),
    screen: Math.round(getVolume(menu.uid, "screen") * 100),
  }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const change = (kind) => (pct) => {
    setValues((v) => ({ ...v, [kind]: pct }));
    setVolume(menu.uid, kind, pct / 100);
  };

  const reset = () => {
    setValues({ voice: 100, screen: 100 });
    setVolume(menu.uid, "voice", 1);
    setVolume(menu.uid, "screen", 1);
  };

  const atDefault = values.voice === 100 && (!menu.hasScreen || values.screen === 100);

  // Mantém o menu inteiro dentro da janela.
  const width = 288;
  const height = menu.hasScreen ? 232 : 160;
  const left = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  const top = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));

  return (
    <div
      className="vm-backdrop"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="vm-card"
        role="dialog"
        aria-label={`Volume de ${menu.name}`}
        style={{ left, top, width }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        <div className="vm-title">{menu.name}</div>
        <VolumeRow label="Voz" value={values.voice} onChange={change("voice")} />
        {menu.hasScreen && <VolumeRow label="Transmissão de tela" value={values.screen} onChange={change("screen")} />}
        <button type="button" className="vm-reset" onClick={reset} disabled={atDefault}>
          Restaurar para 100%
        </button>
      </div>
    </div>
  );
}
