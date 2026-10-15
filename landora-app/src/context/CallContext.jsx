import { createContext, useCallback, useContext, useEffect, useReducer, useRef, useState } from "react";
import { CallSession } from "../lib/webrtc";
import { useAuth } from "./AuthContext";

const CallContext = createContext(null);

// Toca o áudio de um participante (voz ou áudio da tela). Fica aqui, no provider,
// para o som continuar mesmo quando você troca de aba do app durante a call.
function AudioSink({ track, volume = 1, sinkId = "" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (ref.current) ref.current.volume = Math.min(1, Math.max(0, volume));
  }, [volume, track]);
  useEffect(() => {
    const el = ref.current;
    if (el && el.setSinkId) el.setSinkId(sinkId || "").catch(() => {}); // escolhe o alto-falante/fone
  }, [sinkId, track]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play?.().catch(() => {});
  }, [track]);
  return <audio ref={ref} autoPlay style={{ display: "none" }} />;
}

export function CallProvider({ children }) {
  const { user, profile } = useAuth();
  const sessionRef = useRef(null);
  const [active, setActive] = useState(null); // { id, name, fixed }
  const [status, setStatus] = useState("idle"); // idle | joining | live
  const [error, setError] = useState("");
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

  const leave = useCallback(async () => {
    const s = sessionRef.current;
    sessionRef.current = null;
    setActive(null);
    setStatus("idle");
    if (s) await s.leave();
  }, []);

  const join = useCallback(
    async (call) => {
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
  const toggleNoise = run((s) => s.toggleNoise(), "Não consegui reabrir o microfone. Verifique a permissão do navegador.");
  const setMic = (id) => run((s) => s.setMic(id), "Não consegui trocar o microfone.")();
  const setQuality = (key) => run((s) => s.setQuality(key), "Não foi possível mudar a qualidade.")();

  const session = sessionRef.current;
  const peers = session ? session.snapshot() : [];

  return (
    <CallContext.Provider
      value={{ active, status, error, setError, join, leave, session, toggleMic, toggleCam, toggleScreen, toggleNoise, setQuality, setMic, getVolume, setVolume, outputId, setOutputId }}
    >
      {children}
      {peers.map((p) => (
        <span key={p.id}>
          <AudioSink track={p.tracks.audio} volume={getVolume(p.uid, "voice")} sinkId={outputId} />
          <AudioSink track={p.tracks.screenAudio} volume={getVolume(p.uid, "screen")} sinkId={outputId} />
        </span>
      ))}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
