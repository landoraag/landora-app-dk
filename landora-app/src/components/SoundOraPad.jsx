import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot } from "firebase/firestore";
import { loadYT } from "../context/MusicContext";
import { useCollection } from "../lib/useCollection";
import { findUrl, fmtTime, parseTime, serverNow } from "../lib/music";
import {
  MAX_SOUND_SECONDS,
  audioUrl,
  checkLink,
  createSound,
  deleteSound,
  fireSound,
  readPadPrefs,
  soundpadLiveRef,
  stopAllSounds,
  uploadSoundFile,
  writePadPrefs,
} from "../lib/soundpad";

/* ---------------- Toca os sons que alguém soltou (fica ativo durante a call toda) ---------------- */
export function SoundpadListener({ callId, sinkId = "" }) {
  const active = useRef(new Set()); // funções que param cada som tocando
  const lastId = useRef(null);
  const first = useRef(true);
  const hostRef = useRef(null);
  const sinkRef = useRef(sinkId);
  sinkRef.current = sinkId;
  const [toast, setToast] = useState(null);

  const stopAll = () => {
    active.current.forEach((f) => f());
    active.current.clear();
  };

  const play = (d, vol) => {
    if (d.kind === "youtube") {
      loadYT().then((YT) => {
        if (!hostRef.current) return;
        const el = document.createElement("div");
        hostRef.current.appendChild(el);
        let player = null;
        let timer = null;
        const stop = () => {
          clearTimeout(timer);
          active.current.delete(stop);
          try {
            player?.destroy?.();
          } catch {
            /* já foi */
          }
          el.remove();
        };
        active.current.add(stop);
        const start = Math.max(0, Math.floor(d.start || 0));
        const end = Math.ceil(d.end || start + MAX_SOUND_SECONDS);
        timer = setTimeout(stop, (end - start + 8) * 1000);
        player = new YT.Player(el, {
          width: 200,
          height: 113,
          videoId: d.yt,
          playerVars: { autoplay: 1, controls: 0, playsinline: 1, start, end, rel: 0 },
          events: {
            onReady: (e) => {
              e.target.setVolume(vol);
              e.target.playVideo();
            },
            onStateChange: (e) => e.data === 0 && stop(),
            onError: stop,
          },
        });
      });
      return;
    }
    const a = new Audio(audioUrl(d.url, d.start, d.end));
    a.volume = Math.max(0, Math.min(1, vol / 100));
    if (sinkRef.current) a.setSinkId?.(sinkRef.current).catch(() => {});
    const stop = () => {
      active.current.delete(stop);
      a.pause();
      a.src = "";
    };
    active.current.add(stop);
    a.onended = stop;
    a.onerror = stop;
    a.play().catch(stop);
  };

  useEffect(() => {
    first.current = true;
    lastId.current = null;
    if (!callId) return undefined;
    const unsub = onSnapshot(
      soundpadLiveRef(callId),
      (snap) => {
        const d = snap.data();
        if (first.current) {
          // O que já estava lá antes de você entrar não toca.
          first.current = false;
          lastId.current = d?.id || null;
          return;
        }
        if (!d || d.id === lastId.current) return;
        lastId.current = d.id;
        if (Math.abs(serverNow() - (d.at || 0)) > 8000) return; // disparo velho
        if (d.stop) {
          stopAll();
          setToast({ id: d.id, text: `🔇 ${d.byName || "Alguém"} calou os sons` });
          return;
        }
        setToast({ id: d.id, text: `${d.emoji || "🔊"} ${d.name || "Som"} · ${d.byName || "alguém"}` });
        const prefs = readPadPrefs();
        if (prefs.on) play(d, prefs.vol);
      },
      () => {}
    );
    return () => {
      unsub();
      stopAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId]);

  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast((cur) => (cur?.id === toast.id ? null : cur)), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (!callId) return null;
  return createPortal(
    <>
      <div ref={hostRef} className="pad-yt-host" aria-hidden="true" />
      {toast && (
        <div key={toast.id} className="pad-toast">
          {toast.text}
        </div>
      )}
    </>,
    document.body
  );
}

/* ---------------- Painel: sua lista de sons ---------------- */
const EMOJIS = ["🔊", "🧨", "😂", "📯", "👏", "💥", "🐐", "🚨", "🥁", "😱", "🤡", "🎺"];

function usePadPrefs() {
  const [prefs, setPrefs] = useState(readPadPrefs);
  useEffect(() => {
    const on = () => setPrefs(readPadPrefs());
    window.addEventListener("landora-soundpad-prefs", on);
    return () => window.removeEventListener("landora-soundpad-prefs", on);
  }, []);
  const update = (patch) => {
    const next = { ...readPadPrefs(), ...patch };
    writePadPrefs(next);
    setPrefs(next);
  };
  return [prefs, update];
}

function NewSound({ me, onDone }) {
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("🔊");
  const [link, setLink] = useState("");
  const [file, setFile] = useState(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const save = async (e) => {
    e.preventDefault();
    if (busy) return;
    setErr("");
    const s = start.trim() ? parseTime(start) : 0;
    const en = end.trim() ? parseTime(end) : 0;
    if (s == null || en == null) return setErr("Use o formato 0:05 ou 5 para o começo e o fim.");
    setBusy(true);
    try {
      if (file) {
        const up = await uploadSoundFile(file);
        await createSound(me, { name: name || file.name.replace(/\.[^.]+$/, ""), emoji, kind: "file", url: up.url, duration: up.duration, start: s, end: en });
      } else {
        const url = findUrl(link);
        if (!url) throw new Error("Escolha um arquivo ou cole um link do YouTube.");
        const yt = checkLink(url);
        await createSound(me, { name: name || "Som do YouTube", emoji, kind: "youtube", yt: yt.yt, start: s || yt.start, end: en });
      }
      onDone();
    } catch (e2) {
      setErr(e2.message || "Não deu certo.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="pad-new" onSubmit={save}>
      <div className="pad-new-row">
        <select value={emoji} onChange={(e) => setEmoji(e.target.value)} aria-label="Ícone">
          {EMOJIS.map((x) => (
            <option key={x} value={x}>
              {x}
            </option>
          ))}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: Rojão)" maxLength={40} />
      </div>
      <label className="pad-file">
        <input
          type="file"
          accept="audio/*,video/*"
          onChange={(e) => {
            setFile(e.target.files?.[0] || null);
            if (e.target.files?.[0]) setLink("");
          }}
        />
        <span>{file ? `📎 ${file.name}` : "📎 Enviar arquivo de áudio ou vídeo (do TikTok, Reels, celular…)"}</span>
      </label>
      {!file && <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="…ou cole um link do YouTube" />}
      <div className="pad-new-row">
        <input value={start} onChange={(e) => setStart(e.target.value)} placeholder="Começo (0:00)" inputMode="numeric" />
        <input value={end} onChange={(e) => setEnd(e.target.value)} placeholder={`Fim (até ${MAX_SOUND_SECONDS}s)`} inputMode="numeric" />
      </div>
      {err && <p className="auth-error">{err}</p>}
      <div className="pad-new-row">
        <button type="button" className="btn btn-ghost" onClick={onDone} disabled={busy}>
          Cancelar
        </button>
        <button type="submit" className="btn btn-gradient" disabled={busy || (!file && !link.trim())}>
          {busy ? (file ? "Enviando…" : "Salvando…") : "Salvar som"}
        </button>
      </div>
    </form>
  );
}

export function SoundOraPadPanel({ callId, me, onClose }) {
  const { data } = useCollection("soundpadSounds", "createdAt", "asc");
  const mine = useMemo(() => data.filter((s) => s.ownerId === me?.uid), [data, me?.uid]);
  const [prefs, setPrefs] = usePadPrefs();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [cool, setCool] = useState(false);
  const [err, setErr] = useState("");
  const mineRef = useRef(mine);
  mineRef.current = mine;

  const fire = (s) => {
    if (cool || !callId) return;
    setCool(true);
    setTimeout(() => setCool(false), 900); // evita metralhadora de sons
    setErr("");
    fireSound(callId, me, s).catch(() => setErr("Não consegui soltar o som. Tente de novo."));
  };
  const fireRef = useRef(fire);
  fireRef.current = fire;

  // Atalhos: teclas 1 a 9 soltam os primeiros sons (com o painel aberto).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const tag = e.target?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || e.target?.isContentEditable) return;
      const n = Number(e.key);
      if (n >= 1 && n <= 9 && mineRef.current[n - 1]) fireRef.current(mineRef.current[n - 1]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const lengthOf = (s) => (s.end ? fmtTime(s.end - (s.start || 0)) : "");

  return (
    <div className="music-panel side-panel pad-panel">
      <div className="music-head">
        <b>🎛️ SoundOraPad</b>
        <button type="button" className="btn-link" onClick={onClose} style={{ marginLeft: "auto" }}>
          fechar
        </button>
      </div>

      <div className="pad-prefs">
        <label className="pad-toggle">
          <input type="checkbox" checked={prefs.on} onChange={(e) => setPrefs({ on: e.target.checked })} />
          <span>Ouvir os sons</span>
        </label>
        <input
          className="vm-slider"
          type="range"
          min="0"
          max="100"
          value={prefs.vol}
          onChange={(e) => setPrefs({ vol: Number(e.target.value) })}
          disabled={!prefs.on}
          aria-label="Volume dos sons (só para você)"
          title={`Volume dos sons: ${prefs.vol}% (só para você)`}
          style={{ "--p": `${prefs.vol}%` }}
        />
        <button type="button" className="btn-link" onClick={() => stopAllSounds(callId, me).catch(() => {})} title="Para todos os sons tocando, para todo mundo">
          🔇 Calar
        </button>
      </div>

      <div className="music-body">
        {adding ? (
          <NewSound me={me} onDone={() => setAdding(false)} />
        ) : (
          <>
            {!mine.length && (
              <p className="music-empty">
                Monte sua mesa de sons: envie um áudio ou vídeo (do TikTok, Reels, celular) ou cole um link do YouTube. Depois é só clicar
                e todo mundo da call escuta na hora.
              </p>
            )}
            <div className="pad-grid">
              {mine.map((s, i) => (
                <div key={s.id} className="pad-cell">
                  <button type="button" className="pad-btn" onClick={() => fire(s)} disabled={cool || editing} title={`Soltar “${s.name}” para todos`}>
                    <span className="pad-emoji">{s.emoji || "🔊"}</span>
                    <span className="pad-name">{s.name}</span>
                    <small>
                      {i < 9 ? `tecla ${i + 1}` : ""}
                      {i < 9 && lengthOf(s) ? " · " : ""}
                      {lengthOf(s)}
                      {s.kind === "youtube" ? " · YT" : ""}
                    </small>
                  </button>
                  {editing && (
                    <button
                      type="button"
                      className="pad-del"
                      title="Apagar este som"
                      onClick={() => window.confirm(`Apagar “${s.name}”?`) && deleteSound(s.id).catch(() => {})}
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {err && <p className="auth-error">{err}</p>}
            <div className="music-queue-foot">
              {mine.length > 0 && (
                <button type="button" className="btn btn-ghost" onClick={() => setEditing((v) => !v)}>
                  {editing ? "Pronto" : "Editar"}
                </button>
              )}
              <button type="button" className="btn btn-gradient" onClick={() => setAdding(true)}>
                + Novo som
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
