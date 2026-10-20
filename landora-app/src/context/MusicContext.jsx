import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "./AuthContext";
import {
  currentPos,
  findVideoFor,
  fmtTime,
  musicStateRef,
  patchTrack,
  postMusicChat,
  setPlaying,
  skip,
  syncClock,
  trackEnded,
} from "../lib/music";

// Toca a música da call no aparelho de cada pessoa (player oficial do YouTube) e mantém todo
// mundo no mesmo ponto da faixa. Fica no nível do app para continuar tocando quando você troca
// de aba. O player aparece numa janelinha no canto (o YouTube exige que ele fique visível).

const MusicContext = createContext(null);
const DRIFT = 1.6; // segundos de diferença tolerados antes de corrigir

function readLocal(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function writeLocal(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* sem armazenamento */
  }
}

// Carrega a API do player do YouTube uma vez só.
let ytReady = null;
export function loadYT() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT);
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT);
    };
    const s = document.createElement("script");
    s.src = "https://www.youtube.com/iframe_api";
    s.async = true;
    s.onerror = () => {
      ytReady = null;
    };
    document.head.appendChild(s);
  });
  return ytReady;
}

export function MusicProvider({ callId, children }) {
  const { user, profile } = useAuth();
  const me = { uid: user?.uid, name: profile?.nickname || user?.email || "Alguém" };
  const [state, setState] = useState(null);
  const [listening, setListeningState] = useState(() => readLocal("landora.music.on", true));
  const [volume, setVolumeState] = useState(() => readLocal("landora.music.vol", 60));
  const [compact, setCompactState] = useState(() => readLocal("landora.music.compact", false));
  const [needsTap, setNeedsTap] = useState(false);
  const [progress, setProgress] = useState({ t: 0, d: 0 });

  const hostRef = useRef(null);
  const playerRef = useRef(null);
  const readyRef = useRef(false);
  const loadedKey = useRef(null);
  const stateRef = useRef(null);
  const playTry = useRef(0);
  const resolving = useRef(new Set());
  const errored = useRef(new Set());

  const setListening = (v) => {
    setListeningState(v);
    writeLocal("landora.music.on", v);
  };
  const setVolume = (v) => {
    const n = Math.max(0, Math.min(100, Math.round(v)));
    setVolumeState(n);
    writeLocal("landora.music.vol", n);
  };
  const setCompact = (v) => {
    setCompactState(v);
    writeLocal("landora.music.compact", v);
  };

  // ---------- estado da sala ----------
  useEffect(() => {
    setState(null);
    loadedKey.current = null;
    if (!callId) return undefined;
    syncClock(user?.uid);
    return onSnapshot(
      musicStateRef(callId),
      (snap) => setState(snap.exists() ? snap.data() : null),
      () => setState(null)
    );
  }, [callId, user?.uid]);
  stateRef.current = state;

  const current = state?.queue?.[state.index] || null;
  const active = !!callId && !!current;

  // ---------- faixa do Spotify sem vídeo: procura no YouTube ----------
  useEffect(() => {
    if (!callId || !state?.queue) return;
    // A atual e a próxima (para não ter pausa na troca).
    [state.queue[state.index], state.queue[state.index + 1]].forEach((t) => {
      if (!t || t.yt || resolving.current.has(t.key)) return;
      resolving.current.add(t.key);
      findVideoFor(t)
        .then((v) => {
          if (v) return patchTrack(callId, t.key, { yt: v.yt, thumb: t.thumb || v.thumb, duration: t.duration || v.duration });
          return trackEnded(callId, t.key).then((r) => {
            if (r) postMusicChat(callId, { uid: "", name: "DJ Landora" }, `⚠️ Não achei “${t.title}” no YouTube. Pulei para a próxima.`, { bot: true });
          });
        })
        .catch(() => resolving.current.delete(t.key));
    });
  }, [callId, state]);

  // ---------- cria o player ----------
  const needPlayer = active && listening;
  useEffect(() => {
    if (!needPlayer || playerRef.current) return undefined;
    let cancelled = false;
    loadYT().then((YT) => {
      if (cancelled || !hostRef.current || playerRef.current) return;
      const el = document.createElement("div");
      hostRef.current.innerHTML = "";
      hostRef.current.appendChild(el);
      playerRef.current = new YT.Player(el, {
        width: "100%",
        height: "100%",
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, playsinline: 1, rel: 0, modestbranding: 1, iv_load_policy: 3, fs: 0 },
        events: {
          onReady: () => {
            readyRef.current = true;
            playerRef.current?.setVolume(volumeRef.current);
            sync();
          },
          onStateChange: (e) => {
            if (e.data === 1) setNeedsTap(false);
            if (e.data === 0) {
              const key = loadedKey.current;
              if (key && callIdRef.current) trackEnded(callIdRef.current, key).catch(() => {});
            }
          },
          onError: (e) => {
            const key = loadedKey.current;
            const s = stateRef.current;
            const t = s?.queue?.find((x) => x.key === key);
            if (!key || !t || errored.current.has(key)) return;
            errored.current.add(key);
            const why = [101, 150].includes(e.data) ? "o dono do vídeo não deixa tocar fora do YouTube" : "o vídeo não está disponível";
            trackEnded(callIdRef.current, key)
              .then((r) => {
                if (r) postMusicChat(callIdRef.current, { uid: "", name: "DJ Landora" }, `⚠️ Pulei “${t.title}”: ${why}.`, { bot: true });
              })
              .catch(() => {});
          },
        },
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needPlayer]);

  // Saiu da call ou desligou a música: desmonta o player.
  useEffect(() => {
    if (needPlayer) return;
    try {
      playerRef.current?.destroy?.();
    } catch {
      /* já foi */
    }
    playerRef.current = null;
    readyRef.current = false;
    loadedKey.current = null;
    setNeedsTap(false);
  }, [needPlayer]);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const callIdRef = useRef(callId);
  callIdRef.current = callId;
  useEffect(() => {
    if (readyRef.current) playerRef.current?.setVolume?.(volume);
  }, [volume]);

  // ---------- sincronizar com a sala ----------
  const sync = useCallback(() => {
    const p = playerRef.current;
    const s = stateRef.current;
    if (!p || !readyRef.current || !p.getPlayerState) return;
    const t = s?.queue?.[s.index];
    if (!t || !t.yt) {
      if (loadedKey.current) p.stopVideo?.();
      loadedKey.current = null;
      return;
    }
    const want = currentPos(s);
    if (loadedKey.current !== t.key) {
      loadedKey.current = t.key;
      playTry.current = Date.now();
      if (s.playing) p.loadVideoById({ videoId: t.yt, startSeconds: want });
      else p.cueVideoById({ videoId: t.yt, startSeconds: want });
      return;
    }
    const ps = p.getPlayerState(); // -1 não começou, 0 acabou, 1 tocando, 2 pausado, 3 carregando, 5 pronto
    const now = p.getCurrentTime?.() || 0;
    const dur = p.getDuration?.() || 0;
    setProgress({ t: now, d: dur || t.duration || 0 });
    if (s.playing) {
      if (dur && want >= dur - 0.5) return; // já está no fim: o "acabou" cuida
      if (ps !== 1 && ps !== 3) {
        p.playVideo();
        // Navegador bloqueou o som automático: pede um toque.
        if (Date.now() - playTry.current > 3500) setNeedsTap(true);
      } else playTry.current = Date.now();
      if (ps === 1 && Math.abs(now - want) > DRIFT) p.seekTo(want, true);
    } else {
      setNeedsTap(false);
      if (ps === 1 || ps === 3) p.pauseVideo();
      if (Math.abs(now - want) > DRIFT) p.seekTo(want, true);
    }
  }, []);

  useEffect(() => {
    sync();
  }, [state, sync]);
  useEffect(() => {
    if (!needPlayer) return undefined;
    const i = setInterval(sync, 1000);
    return () => clearInterval(i);
  }, [needPlayer, sync]);

  const tapToPlay = () => {
    setNeedsTap(false);
    playTry.current = Date.now();
    playerRef.current?.playVideo?.();
  };

  const value = {
    callId,
    state,
    current,
    me,
    listening,
    setListening,
    volume,
    setVolume,
    progress,
    position: () => currentPos(stateRef.current),
  };

  return (
    <MusicContext.Provider value={value}>
      {children}
      {needPlayer &&
        createPortal(
          <div className={"music-mini" + (compact ? " compact" : "")}>
            <div className="music-mini-video">
              <div ref={hostRef} className="music-mini-host" />
              {needsTap && (
                <button type="button" className="music-tap" onClick={tapToPlay}>
                  ▶ Toque para ouvir
                </button>
              )}
            </div>
            <div className="music-mini-info">
              <b title={current.title}>{current.title}</b>
              <span>
                {current.author ? `${current.author} · ` : ""}
                {fmtTime(progress.t)} / {fmtTime(progress.d)}
              </span>
            </div>
            <div className="music-mini-ctrl">
              <button type="button" title={state?.playing ? "Pausar para todos" : "Tocar para todos"} onClick={() => setPlaying(callId, !state?.playing).catch(() => {})}>
                {state?.playing ? "⏸" : "▶"}
              </button>
              <button type="button" title="Pular" onClick={() => skip(callId, 1).catch(() => {})}>
                ⏭
              </button>
              <input
                className="vm-slider"
                type="range"
                min="0"
                max="100"
                value={volume}
                onChange={(e) => setVolume(Number(e.target.value))}
                aria-label="Volume da música (só para você)"
                title={`Volume da música: ${volume}% (só para você)`}
                style={{ "--p": `${volume}%` }}
              />
              <button type="button" title={compact ? "Aumentar" : "Diminuir"} onClick={() => setCompact(!compact)}>
                {compact ? "⤢" : "⤡"}
              </button>
              <button type="button" title="Parar de ouvir (só você)" onClick={() => setListening(false)}>
                ✕
              </button>
            </div>
          </div>,
          document.body
        )}
    </MusicContext.Provider>
  );
}

export function useMusic() {
  return useContext(MusicContext);
}
