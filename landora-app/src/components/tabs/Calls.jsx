import { useEffect, useRef, useState } from "react";
import { useCall } from "../../context/CallContext";
import Avatar from "../Avatar";
import { QUALITY_OPTIONS } from "../../lib/webrtc";
import VolumeMenu from "./VolumeMenu";
import MusicPanel from "../MusicPanel";
import { useMusic } from "../../context/MusicContext";

const CAN_SHARE = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;
const IS_TOUCH =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
const NO_SHARE_MSG =
  "O navegador deste aparelho não permite transmitir a tela por um site (é um bloqueio do próprio celular). " +
  "No computador funciona normalmente.";

// Tela cheia de verdade. Usa a tela cheia do navegador; no iPhone (que não deixa) usa a do vídeo;
// e, se nada disso existir, ocupa a janela inteira.
function useFullscreen(boxRef) {
  const [pseudo, setPseudo] = useState(false);
  const [native, setNative] = useState(false);

  useEffect(() => {
    const onChange = () => {
      const el = document.fullscreenElement || document.webkitFullscreenElement;
      setNative(!!el && el === boxRef.current);
    };
    document.addEventListener("fullscreenchange", onChange);
    document.addEventListener("webkitfullscreenchange", onChange);
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      document.removeEventListener("webkitfullscreenchange", onChange);
    };
  }, [boxRef]);

  useEffect(() => {
    if (!pseudo) return undefined;
    const onKey = (e) => e.key === "Escape" && setPseudo(false);
    window.addEventListener("keydown", onKey);
    // Trava a rolagem da página e esconde as barras do app enquanto ocupa a janela toda.
    document.documentElement.classList.add("has-pseudo-fs");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("has-pseudo-fs");
    };
  }, [pseudo]);

  const enter = (landscape) => {
    const box = boxRef.current;
    if (!box) return;
    const lock = () => {
      if (landscape && IS_TOUCH) screen.orientation?.lock?.("landscape").catch(() => {});
    };
    const req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) {
      try {
        const r = req.call(box, { navigationUI: "hide" });
        if (r && r.then) r.then(lock, () => setPseudo(true));
        else lock();
        return;
      } catch {
        /* tenta o próximo jeito */
      }
    }
    const v = box.querySelector("video");
    if (v && v.webkitEnterFullscreen) {
      try {
        v.webkitEnterFullscreen();
        return;
      } catch {
        /* tenta o próximo jeito */
      }
    }
    setPseudo(true);
  };

  const exit = () => {
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
      screen.orientation?.unlock?.();
    }
    setPseudo(false);
  };

  const on = native || pseudo;
  return { on, pseudo, toggle: (landscape) => (on ? exit() : enter(landscape)) };
}

// Quantas câmeras o aparelho tem. Antes da permissão o navegador esconde a lista,
// por isso a contagem é refeita quando a câmera liga (refreshKey).
function useVideoInputCount(refreshKey) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () =>
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((list) => alive && setN(list.filter((d) => d.kind === "videoinput").length))
        .catch(() => {});
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, [refreshKey]);
  return n;
}

function VideoTile({ track, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play?.().catch(() => {});
  }, [track]);
  // O som vem dos <audio> do provider; o vídeo aqui fica sempre mudo.
  return <video ref={ref} className={mirror ? "mirror" : ""} autoPlay playsInline muted />;
}

/* ---------------- Dentro da call ---------------- */
function useAudioDevices() {
  const [devices, setDevices] = useState({ inputs: [], outputs: [] });
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        if (!alive) return;
        const real = (d) => d.deviceId && d.deviceId !== "default" && d.deviceId !== "communications";
        setDevices({
          inputs: list.filter((d) => d.kind === "audioinput" && real(d)),
          outputs: list.filter((d) => d.kind === "audiooutput" && real(d)),
        });
      } catch {
        /* sem acesso à lista */
      }
    };
    load();
    navigator.mediaDevices?.addEventListener?.("devicechange", load);
    return () => {
      alive = false;
      navigator.mediaDevices?.removeEventListener?.("devicechange", load);
    };
  }, []);
  return devices;
}

// Escolha do microfone (entrada) e do alto-falante/fone (saída).
const FEATURES = [
  { id: "music", icon: "🎵", label: "Música", desc: "Ouvir junto: YouTube, Spotify, fila e playlists" },
  { id: "telao", icon: "📺", label: "Telão", desc: "Uma tela grande compartilhada com todos da call" },
  { id: "soundpad", icon: "🎛️", label: "SoundOraPad", desc: "Mesa de áudio com efeitos sonoros para a call" },
];

function FeaturesMenu({ active, musicBadge, onPick, onClose }) {
  return (
    <div className="audio-panel features-menu">
      <div className="audio-panel-head">
        <b>✨ Funcionalidades</b>
        <button type="button" className="btn-link" onClick={onClose}>
          fechar
        </button>
      </div>
      {FEATURES.map((f) => (
        <button
          type="button"
          key={f.id}
          className={"feature-item" + (active === f.id ? " on" : "")}
          onClick={() => onPick(f.id)}
        >
          <span className="feature-icon">{f.icon}</span>
          <span className="feature-text">
            <b>
              {f.label}
              {f.id === "music" ? musicBadge : ""}
            </b>
            <small>{f.desc}</small>
          </span>
          {active === f.id && <span className="feature-open">aberto</span>}
        </button>
      ))}
    </div>
  );
}

function SoonPanel({ icon, title, text, onClose }) {
  return (
    <div className="music-panel side-panel feature-soon">
      <div className="music-head">
        <b>
          {icon} {title}
        </b>
        <button type="button" className="btn-link" onClick={onClose} style={{ marginLeft: "auto" }}>
          fechar
        </button>
      </div>
      <div className="feature-soon-body">
        <span className="feature-soon-icon">{icon}</span>
        <p>{text}</p>
        <span className="feature-soon-tag">Em breve</span>
      </div>
    </div>
  );
}

function TelaoPanel({ onClose }) {
  return <SoonPanel icon="📺" title="Telão" text="Uma tela grande compartilhada com todos da call." onClose={onClose} />;
}

function SoundOraPadPanel({ onClose }) {
  return (
    <SoonPanel icon="🎛️" title="SoundOraPad" text="Mesa de áudio com efeitos sonoros que todos na call ouvem." onClose={onClose} />
  );
}

function AudioPanel({ onClose }) {
  const { session, outputId, setOutputId, setMic, setNoiseLevel } = useCall();
  const [level, setLevel] = useState(session?.noiseLevel ?? 80);
  const { inputs, outputs } = useAudioDevices();
  const canSink = typeof HTMLMediaElement !== "undefined" && "setSinkId" in HTMLMediaElement.prototype;
  const currentMic = session?.local?.audio?.getSettings?.().deviceId || session?.micId || "";

  return (
    <div className="audio-panel">
      <div className="audio-panel-head">
        <b>Áudio</b>
        <button type="button" className="btn-link" onClick={onClose}>
          fechar
        </button>
      </div>
      <label>
        Microfone (entrada)
        <select value={currentMic} onChange={(e) => setMic(e.target.value)}>
          <option value="">Padrão do sistema</option>
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || `Microfone ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <div className="audio-noise">
        <div className="audio-noise-head">
          <span>Força do anti-ruído</span>
          <b>{session?.noiseOn ? `${level}%` : "desligado"}</b>
        </div>
        <input
          className="vm-slider"
          type="range"
          min="0"
          max="100"
          step="5"
          value={level}
          disabled={!session?.noiseOn}
          style={{ "--p": `${level}%` }}
          aria-label="Força do anti-ruído"
          onChange={(e) => {
            const v = Number(e.target.value);
            setLevel(v);
            setNoiseLevel(v);
          }}
        />
        <div className="audio-noise-scale">
          <span>Suave (voz natural)</span>
          <span>Forte (corta tudo)</span>
        </div>
        {!session?.noiseOn && <p className="hint">Ligue o anti-ruído no botão 🎧 para ajustar.</p>}
      </div>
      {canSink ? (
        <label>
          Alto-falante ou fone (saída)
          <select value={outputId} onChange={(e) => setOutputId(e.target.value)}>
            <option value="">Padrão do sistema</option>
            {outputs.map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `Saída ${i + 1}`}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="muted">Este navegador não permite escolher a saída de áudio.</p>
      )}
    </div>
  );
}

function ScreenTile({ s, onMenu, onStop }) {
  const boxRef = useRef(null);
  const fs = useFullscreen(boxRef);
  return (
    <div
      className={"call-screen" + (fs.on ? " is-fs" : "") + (fs.pseudo ? " pseudo-fs" : "")}
      ref={boxRef}
      onContextMenu={onMenu}
      onDoubleClick={s.mine ? undefined : () => fs.toggle(true)}
    >
      {s.mine ? (
        <div className="call-screen-self">
          🖥️ Você está transmitindo {s.label ? `a ${s.label.toLowerCase()}` : "a tela"}
          {onStop && (
            <button type="button" className="btn-link danger" onClick={onStop}>
              parar
            </button>
          )}
        </div>
      ) : (
        <VideoTile track={s.track} />
      )}
      <div className="call-tile-name">
        🖥️ {s.nickname}
        {s.label ? ` · ${s.label}` : ""}
      </div>
      {onMenu && (
        <button type="button" className="vol-btn vol-left" onClick={onMenu} title="Volume">
          🔊
        </button>
      )}
      {!s.mine && (
        <button
          type="button"
          className="call-fs"
          onClick={() => fs.toggle(true)}
          title={fs.on ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={fs.on ? "Sair da tela cheia" : "Tela cheia"}
        >
          {fs.on ? "✕" : "⛶"}
        </button>
      )}
    </div>
  );
}

function connLabel(p) {
  if (!p || p.connState === "connected") return "";
  if (p.connState === "failed") return " · falhou (rede bloqueando)";
  if (Date.now() - p.since > 12000) return " · sem conexão direta (veja TURN)";
  return " · conectando…";
}

function CamTile({ nickname, photoURL, camOn, micOn, track, mine, mirror, speaking, status, onMenu }) {
  const boxRef = useRef(null);
  const fs = useFullscreen(boxRef);
  const hasVideo = camOn && track;
  return (
    <div
      ref={boxRef}
      className={"call-tile" + (speaking ? " speaking" : "") + (fs.on ? " is-fs" : "") + (fs.pseudo ? " pseudo-fs" : "")}
      onContextMenu={onMenu}
      onDoubleClick={hasVideo ? () => fs.toggle(false) : undefined}
    >
      {hasVideo ? (
        <VideoTile track={track} mirror={mirror} />
      ) : (
        <Avatar src={photoURL} name={nickname} size={72} />
      )}
      {hasVideo && (
        <button
          type="button"
          className="call-fs"
          onClick={() => fs.toggle(false)}
          title={fs.on ? "Sair da tela cheia" : "Tela cheia"}
          aria-label={fs.on ? "Sair da tela cheia" : "Tela cheia"}
        >
          {fs.on ? "✕" : "⛶"}
        </button>
      )}
      <div className="call-tile-name">
        {nickname}
        {mine ? " (você)" : ""}
        {!micOn ? " 🔇" : ""}
        {status || ""}
      </div>
      {!mine && onMenu && (
        <button type="button" className="vol-btn" onClick={onMenu} title="Volume">
          🔊
        </button>
      )}
    </div>
  );
}

// Tela da call (usada dentro do Chat, quando você está num canal de voz).
export function InCall() {
  const {
    active,
    status,
    error,
    setError,
    session,
    toggleMic,
    toggleCam,
    flipCam,
    toggleScreen,
    addScreen,
    stopScreen,
    toggleNoise,
    setQuality,
    leave,
    speaking,
    pip,
  } = useCall();
  const camCount = useVideoInputCount(!!session?.local?.cam);
  const [menu, setMenu] = useState(null);
  const [showAudio, setShowAudio] = useState(false);
  // Painel lateral de funcionalidades: "music" | "telao" | "soundpad" | null
  const [feature, setFeatureState] = useState(() => {
    try {
      const saved = localStorage.getItem("landora.call.feature");
      if (saved && FEATURES.some((f) => f.id === saved)) return saved;
      if (localStorage.getItem("landora.music.panel") === "1") return "music";
    } catch {
      /* sem armazenamento */
    }
    return null;
  });
  const [showFeatures, setShowFeatures] = useState(false);
  const music = useMusic();
  const setFeature = (id) => {
    setFeatureState(id);
    setShowFeatures(false);
    try {
      localStorage.setItem("landora.call.feature", id || "");
      localStorage.removeItem("landora.music.panel");
    } catch {
      /* sem armazenamento */
    }
  };
  const musicBadge = music?.current ? (music.state?.playing ? " ▶" : " ⏸") : "";
  const [, setTick] = useState(0);
  // Atualiza a tela a cada 2s para o aviso de conexão mudar sozinho.
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(i);
  }, []);

  if (!session || status === "joining") {
    return (
      <div className="call-loading">
        <div className="spinner" />
      </div>
    );
  }

  const peers = session.snapshot();
  const me = session.localView();

  const openMenu = (e, info) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, ...info });
  };

  const both = me.screenOn && me.screen2On;
  const screens = [];
  if (me.screenOn) screens.push({ key: "me", mine: true, slot: "screen", nickname: me.nickname, label: both ? "Tela 1" : "" });
  if (me.screen2On) screens.push({ key: "me2", mine: true, slot: "screen2", nickname: me.nickname, label: me.screenOn ? "Tela 2" : "" });
  peers.forEach((p) => {
    const two = p.screenOn && p.screen2On && p.tracks.screen && p.tracks.screen2;
    if (p.screenOn && p.tracks.screen)
      screens.push({ key: p.id, uid: p.uid, nickname: p.nickname, track: p.tracks.screen, label: two ? "Tela 1" : "" });
    if (p.screen2On && p.tracks.screen2)
      screens.push({ key: p.id + ":2", uid: p.uid, nickname: p.nickname, track: p.tracks.screen2, label: two ? "Tela 2" : "" });
  });
  const sharing = me.screenOn || me.screen2On;
  const canFlip = me.camOn && (IS_TOUCH || camCount > 1);

  return (
    <div className="call-shell">
      <div className="call-head">
        <div>
          <h2>🔊 {active?.name}</h2>
          <p className="muted">
            {peers.length + 1} {peers.length === 0 ? "pessoa (só você por enquanto)" : "pessoas"}
          </p>
        </div>
      </div>

      {session.notice && <p className="call-notice">{session.notice}</p>}
      {error && <p className="auth-error">{error}</p>}

      <div className={"call-main" + (feature ? " with-side" : "")}>
      <div className="call-stage">
        {screens.length > 0 && (
        <div className={"call-screens" + (screens.length > 1 ? " multi" : "")}>
        {screens.map((s) => (
          <ScreenTile
            key={s.key}
            s={s}
            onStop={s.mine ? () => stopScreen(s.slot) : undefined}
            onMenu={s.uid ? (e) => openMenu(e, { uid: s.uid, name: s.nickname, hasScreen: true }) : undefined}
          />
        ))}
        </div>
        )}
        <div className="call-grid">
          <CamTile
            mine
            nickname={me.nickname}
            photoURL={me.photoURL}
            camOn={me.camOn}
            micOn={me.micOn}
            track={me.camTrack}
            mirror={me.camMirror}
            speaking={speaking.has("me")}
          />
          {peers.map((p) => (
            <CamTile
              key={p.id}
              nickname={p.nickname}
              photoURL={p.photoURL}
              camOn={p.camOn}
              micOn={p.micOn}
              track={p.tracks.cam}
              speaking={speaking.has(p.id)}
              status={connLabel(p)}
              onMenu={(e) => openMenu(e, { uid: p.uid, name: p.nickname, hasScreen: p.screenOn || p.screen2On })}
            />
          ))}
        </div>
      </div>
      {feature === "music" && <MusicPanel onClose={() => setFeature(null)} />}
      {feature === "telao" && <TelaoPanel onClose={() => setFeature(null)} />}
      {feature === "soundpad" && <SoundOraPadPanel onClose={() => setFeature(null)} />}
      </div>

      <div className="call-controls">
        <button className={"ctrl-btn " + (me.micOn ? "on" : "off")} onClick={toggleMic}>
          {me.micOn ? "🎤 Microfone" : "🔇 Mudo"}
        </button>
        <button className={"ctrl-btn " + (me.camOn ? "on" : "")} onClick={toggleCam}>
          {me.camOn ? "🎥 Câmera ligada" : "🎥 Ligar câmera"}
        </button>
        {canFlip && (
          <button className="ctrl-btn" onClick={flipCam} title="Trocar entre câmera frontal e traseira">
            🔄 Virar câmera
          </button>
        )}
        <button
          className={"ctrl-btn " + (sharing ? "on" : "")}
          onClick={CAN_SHARE ? toggleScreen : () => setError(NO_SHARE_MSG)}
        >
          {sharing ? (both ? "⏹ Parar as telas" : "⏹ Parar tela") : "🖥️ Compartilhar tela"}
        </button>
        {CAN_SHARE && sharing && !both && (
          <button className="ctrl-btn" onClick={addScreen} title="Transmitir mais uma tela ou janela ao mesmo tempo">
            ➕ Mais uma tela
          </button>
        )}
        {pip.supported && pip.available && (
          <button
            className={"ctrl-btn " + (pip.active ? "on" : "")}
            onClick={pip.active ? pip.exit : pip.enter}
            title="Abre a transmissão numa janelinha que fica por cima das outras"
          >
            {pip.active ? "🗗 Fechar miniatura" : "🗗 Miniatura"}
          </button>
        )}
        <button
          className={"ctrl-btn " + (feature || showFeatures ? "on" : "")}
          onClick={() => {
            setShowFeatures((v) => !v);
            setShowAudio(false);
          }}
          title="Música, Telão e SoundOraPad"
        >
          ✨ Funcionalidades{musicBadge}
        </button>
        <button className={"ctrl-btn " + (showAudio ? "on" : "")} onClick={() => {
            setShowAudio((v) => !v);
            setShowFeatures(false);
          }}>
          ⚙️ Áudio
        </button>
        <button
          className={"ctrl-btn " + (session.noiseOn ? "on" : "")}
          onClick={toggleNoise}
          disabled={session.noiseLoading}
          title={
            "Reduz ruído de fundo com IA (teclado, ventilador, barulho da rua)" +
            (session.noiseOn && session.noiseEngine
              ? " · Em uso: " +
                ({ dfn: "DeepFilterNet (máximo)", rnnoise: "RNNoise", browser: "filtro do navegador" }[
                  session.noiseEngine
                ] || "")
              : "")
          }
        >
          {session.noiseLoading
            ? "🎧 Anti-ruído: carregando…"
            : !session.noiseOn
              ? "🎧 Anti-ruído IA: desligado"
              : session.noiseEngine === "browser"
                ? "🎧 Anti-ruído: básico"
                : "🎧 Anti-ruído IA: ligado"}
        </button>
        <label className="ctrl-select" title="Qualidade da câmera e da tela que você transmite">
          <span>Qualidade</span>
          <select value={session.quality} onChange={(e) => setQuality(e.target.value)}>
            {QUALITY_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button className="ctrl-btn leave" onClick={leave}>
          Sair da call
        </button>
        {showAudio && <AudioPanel onClose={() => setShowAudio(false)} />}
        {showFeatures && (
          <FeaturesMenu
            active={feature}
            musicBadge={musicBadge}
            onPick={(id) => setFeature(feature === id ? null : id)}
            onClose={() => setShowFeatures(false)}
          />
        )}
      </div>
      {menu && <VolumeMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
