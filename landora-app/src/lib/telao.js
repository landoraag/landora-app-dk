// Telão: assistir vídeos juntos dentro da call.
//
// Igual à música, ninguém transmite o vídeo: cada pessoa carrega o vídeo direto da fonte
// (YouTube ou arquivo de vídeo) no próprio aparelho, na qualidade original. O Firestore só
// guarda o estado da sala, e todo mundo segue o mesmo ponto do vídeo.
//
//   calls/{callId}/telao/state → { queue: [video], index, playing, pos, at, v }
//       pos = segundos do vídeo no instante "at" (horário do servidor, em ms).
//
// video = { key, kind: "youtube" | "file", yt?, src?, title, thumb, duration, by, byName }

import { deleteDoc, doc, runTransaction } from "firebase/firestore";
import { db } from "./firebase";
import { currentPos, findUrl, resolveLink, serverNow } from "./music";

export { currentPos, serverNow };

export const telaoStateRef = (callId) => doc(db, "calls", callId, "telao", "state");
export const MAX_TELAO_QUEUE = 100;

const YT_RE = /(?:youtube\.com|youtu\.be|music\.youtube\.com)/i;
const FILE_RE = /\.(mp4|webm|ogv|ogg|mov|m4v)(?:[?#]|$)/i;

let seq = 0;
const newKey = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function ytId(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    if (u.searchParams.get("v")) return u.searchParams.get("v");
    const m = u.pathname.match(/\/(?:shorts|embed|live|v)\/([\w-]{6,})/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

function fileName(url) {
  try {
    const name = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    return name || "Vídeo";
  } catch {
    return "Vídeo";
  }
}

// Transforma um link em vídeos para a fila.
export async function lookupVideos(input, who) {
  const url = findUrl(input);
  if (!url) throw new Error("Cole o link de um vídeo do YouTube ou de um arquivo de vídeo (.mp4, .webm).");
  const by = { by: who?.uid || "", byName: who?.name || "" };

  if (YT_RE.test(url)) {
    try {
      const r = await resolveLink(url); // mesmo servidor da música: traz título, capa e playlists
      const list = (r.tracks || []).filter((t) => t.yt);
      if (list.length)
        return list.map((t) => ({
          key: newKey(),
          kind: "youtube",
          yt: t.yt,
          title: String(t.title || "Vídeo do YouTube").slice(0, 200),
          thumb: t.thumb || `https://i.ytimg.com/vi/${t.yt}/mqdefault.jpg`,
          duration: Math.round(Number(t.duration) || 0),
          ...by,
        }));
    } catch {
      /* servidor fora do ar: tenta só pelo link */
    }
    const id = ytId(url);
    if (!id) throw new Error("Não consegui achar o vídeo nesse link do YouTube.");
    return [{ key: newKey(), kind: "youtube", yt: id, title: "Vídeo do YouTube", thumb: `https://i.ytimg.com/vi/${id}/mqdefault.jpg`, duration: 0, ...by }];
  }

  if (FILE_RE.test(url)) {
    return [{ key: newKey(), kind: "file", src: url, title: fileName(url).slice(0, 200), thumb: "", duration: 0, ...by }];
  }

  throw new Error(
    "Por enquanto o Telão aceita links do YouTube e de arquivos de vídeo (.mp4, .webm). Netflix e outros streamings pagos não deixam passar o vídeo para outros apps."
  );
}

/* ---------------- estado da sala (sempre em transação) ---------------- */
const EMPTY = { queue: [], index: 0, playing: false, pos: 0, v: 0 };

async function mutate(callId, fn) {
  return runTransaction(db, async (tx) => {
    const ref = telaoStateRef(callId);
    const snap = await tx.get(ref);
    const cur = snap.exists() ? { ...EMPTY, ...snap.data() } : { ...EMPTY };
    const next = fn(cur, currentPos(cur));
    if (!next) return null;
    const out = { ...cur, ...next, v: (cur.v || 0) + 1, at: serverNow() };
    tx.set(ref, out);
    return out;
  });
}

export async function addVideos(callId, videos, { playNow = false } = {}) {
  if (!videos.length) throw new Error("Nada para adicionar.");
  return mutate(callId, (s, pos) => {
    if (s.queue.length + videos.length > MAX_TELAO_QUEUE) throw new Error(`A fila do Telão aceita até ${MAX_TELAO_QUEUE} vídeos.`);
    const queue = [...s.queue];
    const empty = !queue.length || s.index >= queue.length;
    if (playNow && !empty) {
      queue.splice(s.index + 1, 0, ...videos);
      return { queue, index: s.index + 1, playing: true, pos: 0 };
    }
    const at = queue.length;
    queue.push(...videos);
    if (empty) return { queue, index: at, playing: true, pos: 0 };
    return { queue, pos };
  });
}

export const setTelaoPlaying = (callId, playing) =>
  mutate(callId, (s, pos) => (s.queue[s.index] ? { playing, pos } : null));

export const seekTelao = (callId, seconds) =>
  mutate(callId, (s) => (s.queue[s.index] ? { pos: Math.max(0, seconds) } : null));

export const nudgeTelao = (callId, delta) =>
  mutate(callId, (s, pos) => (s.queue[s.index] ? { pos: Math.max(0, pos + delta) } : null));

export const jumpTelao = (callId, index) =>
  mutate(callId, (s) => (index >= 0 && index < s.queue.length ? { index, pos: 0, playing: true } : null));

export const skipTelao = (callId) =>
  mutate(callId, (s) => {
    if (!s.queue.length) return null;
    const i = s.index + 1;
    if (i >= s.queue.length) return { index: s.queue.length, playing: false, pos: 0 };
    return { index: i, pos: 0, playing: true };
  });

// Vídeo terminou. Só avança se ninguém já avançou.
export const telaoEnded = (callId, key) =>
  mutate(callId, (s) => {
    const cur = s.queue[s.index];
    if (!cur || cur.key !== key) return null;
    if (s.index + 1 < s.queue.length) return { index: s.index + 1, pos: 0, playing: true };
    return { index: s.queue.length, playing: false, pos: 0 };
  });

export const removeTelaoAt = (callId, i) =>
  mutate(callId, (s, pos) => {
    if (i < 0 || i >= s.queue.length) return null;
    const queue = s.queue.filter((_, k) => k !== i);
    if (i < s.index) return { queue, index: s.index - 1, pos };
    if (i === s.index) return { queue, pos: 0 };
    return { queue, pos };
  });

export const stopTelao = (callId) => mutate(callId, () => ({ queue: [], index: 0, playing: false, pos: 0 }));

export async function clearTelao(callId) {
  await deleteDoc(telaoStateRef(callId)).catch(() => {});
}
