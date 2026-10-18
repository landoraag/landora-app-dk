import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { CallSession } from "../lib/webrtc";
import { createMeter, createPlayer, getAudioCtx, unlockAudio } from "../lib/callAudio";
import { useAuth } from "./AuthContext";
import { notify } from "../lib/push";

const CallContext = createContext(null);

// Nível de voz acima do qual a pessoa conta como "falando" (borda azul).
const SPEAK_LEVEL = 0.018;
// Continua azul por um instante depois da última sílaba, para não piscar.
const SPEAK_HOLD_MS = 400;

// Toca o áudio de um participante (voz ou áudio da tela), com volume de 0 a 200%.
// Fica aqui, no provider, para o som continuar mesmo quando você troca de aba do app.
function AudioSink({ track, volume = 1, sinkId = "", meterKey, meters }) {
  const playerRef = useRef(null);
  useEffect(() => {
    if (!track) return undefined;
    const pl = createPlayer(track);
    playerRef.current = pl;
    if (meterKey && meters) meters.set(meterKey, pl);
    return () => {
      if (meterKey && meters && meters.get(meterKey) === pl) meters.delete(meterKey);
      pl.close();
      playerRef.current = null;
    };
  }, [track, meterKey, meters]);
  useEffect(() => {
    playerRef.current?.setVolume(volume);
  }, [volume, track]);
  useEffect(() => {
    playerRef.current?.setSink(sinkId); // escolhe o alto-falante/fone
  }, [sinkId, track]);
  return null;
}

// Escolhe o vídeo que aparece na miniatura: primeiro uma transmissão de tela, senão uma câmera.
function featuredTrack(peers) {
  for (const p of peers) {
    if (p.screenOn && p.tracks.screen) return p.tracks.screen;
    if (p.screen2On && p.tracks.screen2) return p.tracks.screen2;
  }
  for (const p of peers) if (p.camOn && p.tracks.cam) return p.tracks.cam;
  return null;
}

export function CallProvider({ children }) {
  const { user, profile } = useAuth();
  const sessionRef = useRef(null);
  const [active, setActive] = useState(null); // { id, name, fixed }
  const [status, setStatus] = useState("idle"); // idle | joining | live
  const [error, setError] = useState("");
  // true enquanto a tela da call está aberta no Chat (aí a barrinha da call não aparece).
  const [callVisible, setCallVisible] = useState(false);
  const [, bump] = useReducer((x) => x + 1, 0);

  // Volume de cada pessoa (voz e transmissão de tela), lembrado neste aparelho.
  const [volumes, setVolumes] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("landora.call.volumes") || "{}");
    } catch {
      return {};
    }
  });
  const setVolume = useCallback((uid, kind, value) => {
    setVolumes((prev) => {
      const next = { ...prev, [uid]: { ...(prev[uid] || {}), [kind]: value } };
      try {
        localStorage.setItem("landora.call.volumes", JSON.stringify(next));
      } catch {
        /* sem armazenamento */
      }
      return next;
    });
  }, []);
  const getVolume = (uid, kind) => volumes[uid]?.[kind] ?? 1;

  // Alto-falante/fone de saída escolhido ("" = padrão do sistema).
  const [outputId, setOutputIdState] = useState(() => {
    try {
      return localStorage.getItem("landora.call.outputId") || "";
    } catch {
      return "";
    }
  });
  const setOutputId = (id) => {
    setOutputIdState(id);
    try {
      localStorage.setItem("landora.call.outputId", id);
    } catch {
      /* sem armazenamento */
    }
  };

  // ---------- quem está falando (borda azul) ----------
  const metersRef = useRef(new Map()); // sessionId da pessoa -> tocador com medidor
  const [speaking, setSpeaking] = useState(() => new Set());
  useEffect(() => {
    if (status !== "live") {
      setSpeaking((prev) => (prev.size ? new Set() : prev));
      return undefined;
    }
    const lastLoud = new Map();
    let localTrack = null;
    let localMeter = null;
    const tick = () => {
      const s = sessionRef.current;
      const now = performance.now();
      // Seu próprio microfone.
      const mic = s?.local?.audio || null;
      if (mic !== localTrack) {
        localMeter?.close();
        localTrack = mic;
        localMeter = mic ? createMeter(mic) : null;
      }
      if (localMeter && mic.enabled && localMeter.level() > SPEAK_LEVEL) lastLoud.set("me", now);
      // As outras pessoas (só conta se o microfone delas estiver ligado).
      const micOn = new Map((s ? s.snapshot() : []).map((p) => [p.id, p.micOn]));
      metersRef.current.forEach((pl, id) => {
        if (micOn.get(id) && pl.level() > SPEAK_LEVEL) lastLoud.set(id, now);
      });
      const next = new Set();
      lastLoud.forEach((t, id) => {
        if (now - t < SPEAK_HOLD_MS) next.add(id);
      });
      setSpeaking((prev) => (prev.size === next.size && [...next].every((id) => prev.has(id)) ? prev : next));
    };
    const i = setInterval(tick, 100);
    return () => {
      clearInterval(i);
      localMeter?.close();
    };
  }, [status]);

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setActive(null);
    setStatus("idle");
    if (s) await s.leave();
  }, []);

  const join = useCallback(
    async (call) => {
      unlockAudio(); // precisa acontecer ainda dentro do clique em "Entrar"
      if (sessionRef.current) await leave();
      setError("");
      setStatus("joining");
      setActive(call);
      const s = new CallSession({
        callId: call.id,
        fixed: call.fixed,
        uid: user.uid,
        nickname: profile?.nickname || user.email,
        photoURL: profile?.photoURL,
        onChange: bump,
        onEvicted: () => {
          setError("Você entrou nesta call em outra aba ou aparelho, então saiu desta.");
          leave();
        },
      });
      sessionRef.current = s;
      try {
        await s.join();
        setStatus("live");
        notify({
          kind: "call",
          title: `🔊 ${profile?.nickname || "Alguém"} entrou em ${call.name}`,
          body: "Toque para abrir a call.",
          url: `/chat?v=${call.id}`,
          tag: `call-${call.id}`,
        });
      } catch (e) {
        console.error(e);
        setError("Não foi possível entrar na call. Tente de novo.");
        sessionRef.current = null;
        await s.leave();
        setActive(null);
        setStatus("idle");
      }
    },
    [user, profile, leave]
  );

  // Fechar a aba / sair do app encerra a presença na call.
  useEffect(() => {
    const onHide = () => sessionRef.current?.leave();
    window.addEventListener("pagehide", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      sessionRef.current?.leave();
      sessionRef.current = null;
    };
  }, []);

  const run = (fn, friendly, ignoreCancel) => async () => {
    const s = sessionRef.current;
    if (!s) return;
    setError("");
    try {
      await fn(s);
    } catch (e) {
      const cancelled = e?.name === "NotAllowedError" || e?.name === "AbortError";
      if (!(ignoreCancel && cancelled)) {
        console.warn(e);
        setError(friendly);
      }
    } finally {
      bump();
    }
  };

  const toggleMic = run((s) => s.toggleMic(), "Não consegui acessar o microfone. Verifique a permissão do navegador.");
  const toggleCam = run((s) => s.toggleCam(), "Não consegui acessar a câmera. Verifique a permissão do navegador.");
  const toggleScreen = run((s) => s.toggleScreen(), "Não foi possível compartilhar a tela.", true);
  const addScreen = run((s) => s.startScreen(), "Não foi possível compartilhar a segunda tela.", true);
  const stopScreen = (slot) => run((s) => s.stopScreen(slot), "Não foi possível parar a transmissão.")();
  const flipCam = run((s) => s.flipCam(), "Não consegui trocar de câmera.");
  const toggleNoise = run((s) => s.toggleNoise(), "Não consegui reabrir o microfone. Verifique a permissão do navegador.");
  const setMic = (id) => run((s) => s.setMic(id), "Não consegui trocar o microfone.")();
  const setQuality = (key) => run((s) => s.setQuality(key), "Não foi possível mudar a qualidade.")();
  const setNoiseLevel = (v) => sessionRef.current?.setNoiseLevel(v);

  const session = sessionRef.current;
  const peers = session ? session.snapshot() : [];

  // ---------- miniatura (Picture-in-Picture) ----------
  // Quando alguém transmite e você sai do app/site, a transmissão continua numa janelinha.
  const pipRef = useRef(null);
  const pipTrack = status === "live" ? featuredTrack(peers) : null;
  const [inPip, setInPip] = useState(false);
  const pipSupported = typeof document !== "undefined" && !!document.pictureInPictureEnabled;

  useEffect(() => {
    const el = pipRef.current;
    if (!el) return;
    el.srcObject = pipTrack ? new MediaStream([pipTrack]) : null;
    if (pipTrack) el.play?.().catch(() => {});
    else if (document.pictureInPictureElement === el) document.exitPictureInPicture().catch(() => {});
  }, [pipTrack]);

  const enterPip = useCallback(async () => {
    const el = pipRef.current;
    if (!el || !el.srcObject || !document.pictureInPictureEnabled) return false;
    if (document.pictureInPictureElement === el) return true;
    try {
      if (el.readyState < 1) await new Promise((r) => el.addEventListener("loadedmetadata", r, { once: true }));
      await el.requestPictureInPicture();
      return true;
    } catch (e) {
      console.warn("Miniatura não abriu:", e);
      return false;
    }
  }, []);
  const exitPip = useCallback(() => {
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
  }, []);

  useEffect(() => {
    const el = pipRef.current;
    if (!el) return undefined;
    const on = () => setInPip(true);
    const off = () => setInPip(false);
    el.addEventListener("enterpictureinpicture", on);
    el.addEventListener("leavepictureinpicture", off);
    return () => {
      el.removeEventListener("enterpictureinpicture", on);
      el.removeEventListener("leavepictureinpicture", off);
    };
  }, []);

  // Abre sozinha ao sair: Chrome/Edge (troca de aba ou de app) e o app de computador (minimizar).
  useEffect(() => {
    if (status !== "live" || !pipTrack) return undefined;
    window.__landoraPip = () => enterPip(); // chamado pelo app de computador ao minimizar/perder o foco
    window.__landoraPipExit = () => exitPip();
    let handlerSet = false;
    try {
      navigator.mediaSession?.setActionHandler?.("enterpictureinpicture", () => enterPip());
      handlerSet = true;
    } catch {
      /* navegador sem miniatura automática */
    }
    const onVis = () => {
      if (document.visibilityState === "hidden") enterPip();
      else exitPip();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      delete window.__landoraPip;
      delete window.__landoraPipExit;
      if (handlerSet) {
        try {
          navigator.mediaSession.setActionHandler("enterpictureinpicture", null);
        } catch {
          /* nada */
        }
      }
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [status, pipTrack, enterPip, exitPip]);

  // Saiu da call: fecha a miniatura.
  useEffect(() => {
    if (status !== "live") exitPip();
  }, [status, exitPip]);

  // Alguns navegadores pausam o som até um toque na página: retoma no próximo clique.
  useEffect(() => {
    if (status !== "live") return undefined;
    const resume = () => getAudioCtx();
    window.addEventListener("pointerdown", resume);
    return () => window.removeEventListener("pointerdown", resume);
  }, [status]);

  return (
    <CallContext.Provider
      value={{
        active,
        status,
        error,
        setError,
        join,
        leave,
        session,
        toggleMic,
        toggleCam,
        flipCam,
        toggleScreen,
        addScreen,
        stopScreen,
        toggleNoise,
        setQuality,
        setNoiseLevel,
        setMic,
        getVolume,
        setVolume,
        outputId,
        setOutputId,
        speaking,
        callVisible,
        setCallVisible,
        pip: { supported: pipSupported, available: !!pipTrack, active: inPip, enter: enterPip, exit: exitPip },
      }}
    >
      {children}
      {peers.map((p) => (
        <span key={p.id}>
          <AudioSink
            track={p.tracks.audio}
            volume={getVolume(p.uid, "voice")}
            sinkId={outputId}
            meterKey={p.id}
            meters={metersRef.current}
          />
          <AudioSink track={p.tracks.screenAudio} volume={getVolume(p.uid, "screen")} sinkId={outputId} />
          <AudioSink track={p.tracks.screen2Audio} volume={getVolume(p.uid, "screen")} sinkId={outputId} />
        </span>
      ))}
      <video ref={pipRef} className="pip-source" muted playsInline autoPlay aria-hidden="true" />
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
