import { useEffect, useRef, useState } from "react";

// Grava áudio do microfone (mensagem de voz).
// start() começa, stop() devolve { file, url, duration }, cancel() descarta.
function pickMime() {
  if (typeof MediaRecorder === "undefined") return "";
  const options = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  return options.find((m) => MediaRecorder.isTypeSupported?.(m)) || "";
}

export const CAN_RECORD =
  typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;

export function useRecorder() {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef(null);

  const cleanup = () => {
    const r = rec.current;
    if (!r) return;
    clearInterval(r.timer);
    r.stream.getTracks().forEach((t) => t.stop());
    rec.current = null;
    setRecording(false);
    setSeconds(0);
  };

  useEffect(() => cleanup, []);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = pickMime();
    const mr = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 64000 } : undefined);
    const chunks = [];
    mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const startedAt = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250);
    rec.current = { mr, stream, chunks, startedAt, timer };
    mr.start(250);
    setSeconds(0);
    setRecording(true);
  }

  function stop() {
    const r = rec.current;
    if (!r) return Promise.resolve(null);
    return new Promise((resolve) => {
      r.mr.onstop = () => {
        const type = r.mr.mimeType || "audio/webm";
        const ext = type.includes("mp4") ? "m4a" : type.includes("ogg") ? "ogg" : "webm";
        const blob = new Blob(r.chunks, { type });
        const duration = (Date.now() - r.startedAt) / 1000;
        cleanup();
        if (blob.size < 500 || duration < 0.6) return resolve(null); // toque acidental
        const file = new File([blob], `audio.${ext}`, { type });
        resolve({ file, url: URL.createObjectURL(blob), duration });
      };
      r.mr.stop();
    });
  }

  function cancel() {
    const r = rec.current;
    if (!r) return;
    r.mr.onstop = null;
    try {
      r.mr.stop();
    } catch {
      /* já parado */
    }
    cleanup();
  }

  return { recording, seconds, start, stop, cancel };
}
