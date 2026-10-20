import { useCallback, useEffect, useRef, useState } from "react";
import { onSnapshot } from "firebase/firestore";
import { loadYT } from "../context/MusicContext";
import { fmtTime, syncClock } from "../lib/music";
import {
  addVideos,
  currentPos,
  jumpTelao,
  lookupVideos,
  nudgeTelao,
  removeTelaoAt,
  seekTelao,
  setTelaoPlaying,
  skipTelao,
  stopTelao,
  telaoEnded,
  telaoStateRef,
} from "../lib/telao";

const DRIFT = 1.2; // segundos de diferença tolerados antes de corrigir

function readVol() {
  try {
    const v = Number(localStorage.getItem("landora.telao.vol"));
    return Number.isFinite(v) && localStorage.getItem("landora.telao.vol") != null ? v : 80;
  } catch {
    return 80;
  }
}

// Estado do Telão da call (todo mundo assina o mesmo documento).
export function useTelao(callId, uid) {
  const [state, setState] = useState(null);
  useEffect(() => {
    setState(null);
    if (!callId) return undefined;
    syncClock(uid);
    return onSnapshot(
      telaoStateRef(callId),
      (snap) => setState(snap.exists() ? snap.data() : null),
      () => setState(null)
    );
  }, [callId, uid]);
  const current = state?.queue?.[state.index] || null;
  return { state, current };
}

/* ---------------- O vídeo grande, no palco da call ---------------- */
export function TelaoStage({ callId, state, current, boxRef, fs }) {
  const ytHostRef = useRef(null);
  const ytRef = useRef(null);
  const ytReady = useRef(false);
  const videoRef = useRef(null);
  const loadedKey = useRef(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const playTry = useRef(0);
  const [needsTap, setNeedsTap] = useState(false);
  const [progress, setProgress] = useState({ t: 0, d: 0 });
  const [volume, setVolumeState] = useState(readVol);
  const volRef = useRef(volume);
  volRef.current = volume;
  const [err, setErr] = useState("");
  const kind = current?.kind || null;

  const setVolume = (v) => {
    const n = Math.max(0, Math.min(100, Math.round(v)));
    setVolumeState(n);
    try {
      localStorage.setItem("landora.telao.vol", String(n));
    } catch {
      /* sem armazenamento */
    }
  };

  // ---------- player do YouTube ----------
  useEffect(() => {
    if (kind !== "youtube" || ytRef.current) return undefined;
    let cancelled = false;
    loadYT().then((YT) => {
      if (cancelled || !ytHostRef.current || ytRef.current) return;
      const el = document.createElement("div");
      ytHostRef.current.innerHTML = "";
      ytHostRef.current.appendChild(el);
      ytRef.current = new YT.Player(el, {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            ytReady.current = true;
            ytRef.current?.setVolume(volRef.current);
            sync();
          },
          onStateChange: (e) => {
            if (e.data === 1) setNeedsTap(false);
            if (e.data === 0 && loadedKey.current) telaoEnded(callId, loadedKey.current).catch(() => {});
          },
          onError: (e) => {
            const key = loadedKey.current;
            if (!key) return;
            setErr([101, 150].includes(e.data) ? "O dono desse vídeo não deixa ele tocar fora do YouTube." : "Esse vídeo não está disponível.");
            telaoEnded(callId, key).catch(() => {});
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  // Saiu do YouTube (ou do Telão): desmonta o player.
  useEffect(() => {
    if (kind === "youtube") return undefined;
    try {
      ytRef.current?.destroy?.();
    } catch {
      /* já foi */
    }
    ytRef.current = null;
    ytReady.current = false;
    loadedKey.current = null;
    return undefined;
  }, [kind]);
  useEffect(
    () => () => {
      try {
        ytRef.current?.destroy?.();
      } catch {
        /* já foi */
      }
      ytRef.current = null;
    },
    []
  );

  // Volume só para você.
  useEffect(() => {
    if (ytReady.current) ytRef.current?.setVolume?.(volume);
    if (videoRef.current) videoRef.current.volume = volume / 100;
  }, [volume, kind]);

  // ---------- sincronizar com a sala ----------
  const sync = useCallback(() => {
    const s = stateRef.current;
    const t = s?.queue?.[s.index];
    if (!t) return;
    const want = currentPos(s);

    if (t.kind === "youtube") {
      const p = ytRef.current;
      if (!p || !ytReady.current || !p.getPlayerState) return;
      if (loadedKey.current !== t.key) {
        loadedKey.current = t.key;
        playTry.current = Date.now();
        setErr("");
        if (s.playing) p.loadVideoById({ videoId: t.yt, startSeconds: want });
        else p.cueVideoById({ videoId: t.yt, startSeconds: want });
        return;
      }
      const ps = p.getPlayerState();
      const now = p.getCurrentTime?.() || 0;
      const dur = p.getDuration?.() || 0;
      setProgress({ t: now, d: dur || t.duration || 0 });
      if (s.playing) {
        if (dur && want >= dur - 0.5) return;
        if (ps !== 1 && ps !== 3) {
          p.playVideo();
          if (Date.now() - playTry.current > 3500) setNeedsTap(true);
        } else playTry.current = Date.now();
        if (ps === 1 && Math.abs(now - want) > DRIFT) p.seekTo(want, true);
      } else {
        setNeedsTap(false);
        if (ps === 1 || ps === 3) p.pauseVideo();
        if (Math.abs(now - want) > DRIFT) p.seekTo(want, true);
      }
      return;
    }

    const v = videoRef.current;
    if (!v) return;
    if (loadedKey.current !== t.key) {
      loadedKey.current = t.key;
      playTry.current = Date.now();
      setErr("");
      v.src = t.src;
      v.volume = volRef.current / 100;
      try {
        v.currentTime = want;
      } catch {
        /* ainda carregando */
      }
    }
    const dur = Number.isFinite(v.duration) ? v.duration : 0;
    setProgress({ t: v.currentTime || 0, d: dur });
    if (v.readyState >= 1 && Math.abs((v.currentTime || 0) - want) > DRIFT && !(dur && want >= dur - 0.5)) {
      try {
        v.currentTime = want;
      } catch {
        /* ainda carregando */
      }
    }
    if (s.playing && v.paused && !v.ended) {
      v.play()
        .then(() => setNeedsTap(false))
        .catch(() => setNeedsTap(true));
    } else if (!s.playing && !v.paused) {
      v.pause();
      setNeedsTap(false);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [state, sync]);
  useEffect(() => {
    if (!current) return undefined;
    const i = setInterval(sync, 1000);
    return () => clearInterval(i);
  }, [current, sync]);

  const tapToPlay = () => {
    setNeedsTap(false);
    playTry.current = Date.now();
    if (kind === "youtube") ytRef.current?.playVideo?.();
    else videoRef.current?.play?.().catch(() => setNeedsTap(true));
  };

  if (!current) return null;
  const playing = !!state?.playing;
  const pct = progress.d ? Math.min(100, (progress.t / progress.d) * 100) : 0;

  const onSeekBar = (e) => {
    if (!progress.d) return;
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    seekTelao(callId, x * progress.d).catch(() => {});
  };

  return (
    <div className={"telao-stage" + (fs?.on ? " is-fs" : "")} ref={boxRef}>
      <div className="telao-video">
        <div ref={ytHostRef} className="telao-yt" style={{ display: kind === "youtube" ? "block" : "none" }} />
        {kind === "file" && (
          <video
            ref={videoRef}
            className="telao-file"
            playsInline
            onEnded={() => loadedKey.current && telaoEnded(callId, loadedKey.current).catch(() => {})}
            onError={() => {
              setErr("Não consegui abrir esse arquivo de vídeo.");
            }}
            onLoadedMetadata={sync}
          />
        )}
        {needsTap && (
          <button type="button" className="music-tap" onClick={tapToPlay}>
            ▶ Toque para assistir
          </button>
        )}
        {err && <p className="telao-err">{err}</p>}
      </div>
      <div className="telao-bar">
        <button type="button" title={playing ? "Pausar para todos" : "Tocar para todos"} onClick={() => setTelaoPlaying(callId, !playing).catch(() => {})}>
          {playing ? "⏸" : "▶"}
        </button>
        <button type="button" title="Voltar 10 segundos (para todos)" onClick={() => nudgeTelao(callId, -10).catch(() => {})}>
          ⏪
        </button>
        <button type="button" title="Avançar 10 segundos (para todos)" onClick={() => nudgeTelao(callId, 10).catch(() => {})}>
          ⏩
        </button>
        <button type="button" title="Próximo vídeo" onClick={() => skipTelao(callId).catch(() => {})}>
          ⏭
        </button>
        <span className="telao-time">{fmtTime(progress.t)}</span>
        <div className="telao-seek" onClick={onSeekBar} title="Ir para este ponto (para todos)">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="telao-time">{fmtTime(progress.d)}</span>
        <input
          className="vm-slider telao-vol"
          type="range"
          min="0"
          max="100"
          value={volume}
          onChange={(e) => setVolume(Number(e.target.value))}
          aria-label="Volume do Telão (só para você)"
          title={`Volume: ${volume}% (só para você)`}
          style={{ "--p": `${volume}%` }}
        />
        {fs && (
          <button type="button" title={fs.on ? "Sair da tela cheia" : "Tela cheia"} onClick={() => fs.toggle(true)}>
            {fs.on ? "🗗" : "⛶"}
          </button>
        )}
      </div>
    </div>
  );
}

/* ---------------- Painel lateral: link e fila ---------------- */
export function TelaoPanel({ callId, state, current, me, onClose }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const queue = state?.queue || [];
  const idx = state?.index ?? 0;

  const submit = async (playNow) => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsg("");
    try {
      const vids = await lookupVideos(text, me);
      await addVideos(callId, vids, { playNow });
      setText("");
      setMsg(vids.length > 1 ? `${vids.length} vídeos adicionados.` : "");
    } catch (e) {
      setMsg(e.message || "Não deu certo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="music-panel side-panel telao-panel">
      <div className="music-head">
        <b>📺 Telão</b>
        <button type="button" className="btn-link" onClick={onClose} style={{ marginLeft: "auto" }}>
          fechar
        </button>
      </div>

      <form
        className="music-input"
        onSubmit={(e) => {
          e.preventDefault();
          submit(false);
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Cole o link do YouTube ou de um vídeo .mp4" disabled={busy} />
        <button className="btn" type="submit" disabled={busy || !text.trim()}>
          {busy ? "…" : "Adicionar"}
        </button>
      </form>
      {text.trim() && current && (
        <button type="button" className="btn-link" onClick={() => submit(true)} disabled={busy} style={{ alignSelf: "flex-start" }}>
          ▶ Passar agora, na frente da fila
        </button>
      )}
      {msg && <p className="music-empty">{msg}</p>}

      <div className="music-body">
        {!queue.length || idx >= queue.length ? (
          <p className="music-empty">
            Cole um link para todo mundo da call assistir junto. Cada pessoa carrega o vídeo direto do YouTube, na qualidade original,
            e o play, a pausa e o ponto do vídeo ficam iguais para todos.
          </p>
        ) : null}
        <div className="music-queue">
          {queue.map((v, i) => (
            <div key={v.key} className={"telao-q" + (i === idx ? " on" : "") + (i < idx ? " done" : "")}>
              {v.thumb ? <img className="mq-thumb" src={v.thumb} alt="" loading="lazy" /> : <span className="mq-thumb ph">🎬</span>}
              <button type="button" className="telao-q-info" onClick={() => jumpTelao(callId, i).catch(() => {})} title="Assistir este agora">
                <b>{v.title}</b>
                <span>
                  {i === idx ? "▶ passando agora" : v.duration ? fmtTime(v.duration) : v.kind === "file" ? "arquivo de vídeo" : "YouTube"}
                  {v.byName ? ` · ${v.byName}` : ""}
                </span>
              </button>
              <button type="button" className="btn-link" title="Tirar da fila" onClick={() => removeTelaoAt(callId, i).catch(() => {})}>
                ✕
              </button>
            </div>
          ))}
        </div>
        {queue.length > 0 && (
          <div className="music-queue-foot">
            <button type="button" className="btn btn-ghost" onClick={() => stopTelao(callId).catch(() => {})}>
              Desligar o Telão
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
