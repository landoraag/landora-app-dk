// Música nas calls ("ouvir junto").
//
// Ninguém transmite áudio: o Firestore guarda só o estado da sala e cada pessoa toca o vídeo
// no próprio aparelho, pelo player oficial do YouTube. Assim a música não passa pelo
// anti-ruído, não pesa na call e cada um tem o próprio volume.
//
//   calls/{callId}/music/state  → { queue: [faixa], index, playing, pos, at, loop, v }
//       pos = segundos do vídeo no instante "at" (horário do servidor, em ms).
//       Tocando, a posição certa agora é pos + (agora - at) / 1000.
//   calls/{callId}/musicChat/{auto} → mensagens do painel (links, comandos e avisos)
//   musicPlaylists/{id}         → playlists próprias { name, ownerId, ownerName, shared, tracks }
//   musicClock/{uid}            → usado uma vez para acertar o relógio deste aparelho
//
// faixa = { key, yt, q?, title, author, thumb, duration, origin, originUrl, by, byName }

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "./firebase";

const API_URL = (import.meta.env.VITE_NOTIFY_URL || "https://landora-app-dk-iota.vercel.app/api/notify").replace(/\/notify$/, "/music");

export const musicStateRef = (callId) => doc(db, "calls", callId, "music", "state");
export const musicChatCol = (callId) => collection(db, "calls", callId, "musicChat");
export const MAX_QUEUE = 300;

/* ---------------- relógio ---------------- */
// Diferença entre o relógio deste aparelho e o do servidor (ms). Sem isso, um celular com o
// relógio 3 s adiantado tocaria 3 s na frente de todo mundo.
let skew = 0;
let skewPromise = null;
export const serverNow = () => Date.now() + skew;
export function syncClock(uid) {
  if (skewPromise || !uid) return skewPromise;
  skewPromise = (async () => {
    try {
      const ref = doc(db, "musicClock", uid);
      const t0 = Date.now();
      await setDoc(ref, { t: serverTimestamp() });
      const snap = await getDoc(ref);
      const t1 = Date.now();
      const server = snap.data()?.t?.toMillis?.();
      if (server) skew = server - (t0 + t1) / 2;
    } catch {
      skewPromise = null; // tenta de novo depois
    }
  })();
  return skewPromise;
}

export function currentPos(state) {
  if (!state) return 0;
  const base = Number(state.pos) || 0;
  if (!state.playing) return base;
  const at = typeof state.at === "number" ? state.at : state.at?.toMillis?.() || serverNow();
  return Math.max(0, base + (serverNow() - at) / 1000);
}

/* ---------------- servidor (busca / links) ---------------- */
async function api(body) {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Entre na sua conta.");
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Sem conexão com o servidor de música.");
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `O servidor de música falhou (${res.status}).`);
  return data;
}
export const searchMusic = (q, limit = 8) => api({ action: "search", q, limit }).then((d) => d.results || []);
export const resolveLink = (url) => api({ action: "resolve", url });

const URL_RE = /https?:\/\/\S+/i;
export const findUrl = (s) => String(s || "").match(URL_RE)?.[0] || null;
export function isMusicLink(s) {
  return /(?:youtube\.com|youtu\.be|music\.youtube\.com|open\.spotify\.com)/i.test(String(s || ""));
}

let keySeq = 0;
const newKey = () => `${Date.now().toString(36)}${(keySeq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function toTrack(t, who) {
  return {
    key: newKey(),
    yt: t.yt || null,
    ...(t.q ? { q: t.q } : {}),
    title: String(t.title || "Sem título").slice(0, 200),
    author: String(t.author || "").slice(0, 120),
    thumb: t.thumb || (t.yt ? `https://i.ytimg.com/vi/${t.yt}/mqdefault.jpg` : ""),
    duration: Math.round(Number(t.duration) || 0),
    origin: t.origin || "youtube",
    originUrl: t.originUrl || "",
    by: who?.uid || "",
    byName: who?.name || "",
  };
}

// Transforma um texto (link ou busca) em faixas.
export async function lookup(input) {
  const url = findUrl(input);
  if (url) {
    if (!isMusicLink(url)) throw new Error("Só dá para tocar links do YouTube ou do Spotify.");
    const r = await resolveLink(url);
    return { tracks: r.tracks || [], title: r.title || "" };
  }
  const q = String(input || "").trim();
  if (!q) throw new Error("Cole um link ou escreva o nome da música.");
  const results = await searchMusic(q, 1);
  if (!results.length) throw new Error(`Não achei nada para “${q}”.`);
  return { tracks: [results[0]], title: "" };
}

// Faixa do Spotify ainda sem vídeo: procura a versão no YouTube.
export async function findVideoFor(track) {
  const res = await searchMusic(track.q || `${track.author} - ${track.title}`, 3);
  return res[0] || null;
}

/* ---------------- estado da sala (sempre em transação) ---------------- */
const EMPTY = { queue: [], index: 0, playing: false, pos: 0, loop: "off", v: 0 };

async function mutate(callId, fn) {
  return runTransaction(db, async (tx) => {
    const ref = musicStateRef(callId);
    const snap = await tx.get(ref);
    const cur = snap.exists() ? { ...EMPTY, ...snap.data() } : { ...EMPTY };
    const prev = { ...cur };
    const curPos = currentPos(cur);
    const next = fn(cur, curPos);
    if (!next) return null;
    const out = { ...prev, ...next, v: (prev.v || 0) + 1, at: serverNow() };
    tx.set(ref, out);
    return out;
  });
}

export async function addTracks(callId, tracks, { playNext = false, playNow = false } = {}) {
  if (!tracks.length) throw new Error("Nada para adicionar.");
  return mutate(callId, (s, pos) => {
    if (s.queue.length + tracks.length > MAX_QUEUE) throw new Error(`A fila aceita até ${MAX_QUEUE} músicas.`);
    const queue = [...s.queue];
    const empty = !queue.length || s.index >= queue.length;
    if (playNow && !empty) {
      queue.splice(s.index + 1, 0, ...tracks);
      return { queue, index: s.index + 1, playing: true, pos: 0 };
    }
    if (playNext && !empty) {
      queue.splice(s.index + 1, 0, ...tracks);
      return { queue, pos };
    }
    const at = queue.length;
    queue.push(...tracks);
    // Fila parada/terminada: começa a tocar o que acabou de entrar.
    if (empty) return { queue, index: at, playing: true, pos: 0 };
    return { queue, pos };
  });
}

export const setPlaying = (callId, playing) =>
  mutate(callId, (s, pos) => (s.queue[s.index] ? { playing, pos } : null));

export const seek = (callId, seconds) =>
  mutate(callId, (s) => (s.queue[s.index] ? { pos: Math.max(0, seconds) } : null));

export const jump = (callId, index) =>
  mutate(callId, (s) => (index >= 0 && index < s.queue.length ? { index, pos: 0, playing: true } : null));

export const skip = (callId, by = 1) =>
  mutate(callId, (s) => {
    if (!s.queue.length) return null;
    let i = s.index + by;
    if (i >= s.queue.length) {
      if (s.loop === "all") i = 0;
      else return { index: s.queue.length, playing: false, pos: 0 }; // acabou a fila
    }
    if (i < 0) i = 0;
    return { index: i, pos: 0, playing: true };
  });

// Chamado quando o vídeo termina. Só avança se ninguém já avançou (evita pular duas).
export const trackEnded = (callId, key) =>
  mutate(callId, (s) => {
    const cur = s.queue[s.index];
    if (!cur || cur.key !== key) return null;
    if (s.loop === "one") return { pos: 0, playing: true };
    if (s.index + 1 < s.queue.length) return { index: s.index + 1, pos: 0, playing: true };
    if (s.loop === "all") return { index: 0, pos: 0, playing: true };
    return { index: s.queue.length, playing: false, pos: 0 };
  });

export const removeAt = (callId, i) =>
  mutate(callId, (s, pos) => {
    if (i < 0 || i >= s.queue.length) throw new Error("Não existe essa posição na fila.");
    const queue = s.queue.filter((_, k) => k !== i);
    if (i < s.index) return { queue, index: s.index - 1, pos };
    if (i === s.index) return { queue, pos: 0 };
    return { queue, pos };
  });

export const moveTrack = (callId, from, to) =>
  mutate(callId, (s, pos) => {
    if (from === to || from < 0 || to < 0 || from >= s.queue.length || to >= s.queue.length) return null;
    const queue = [...s.queue];
    const [t] = queue.splice(from, 1);
    queue.splice(to, 0, t);
    const curKey = s.queue[s.index]?.key;
    const index = curKey ? queue.findIndex((x) => x.key === curKey) : s.index;
    return { queue, index: index < 0 ? s.index : index, pos };
  });

export const shuffle = (callId) =>
  mutate(callId, (s, pos) => {
    const done = s.queue.slice(0, s.index + 1);
    const rest = s.queue.slice(s.index + 1);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    return { queue: [...done, ...rest], pos };
  });

export const setLoop = (callId, loop) => mutate(callId, (s, pos) => ({ loop, pos }));

export const clearQueue = (callId) => mutate(callId, () => ({ queue: [], index: 0, playing: false, pos: 0 }));

// Faixa do Spotify já encontrada no YouTube: guarda o vídeo para todo mundo.
export const patchTrack = (callId, key, patch) =>
  mutate(callId, (s, pos) => {
    const i = s.queue.findIndex((t) => t.key === key);
    if (i < 0 || s.queue[i].yt) return null;
    const queue = [...s.queue];
    queue[i] = { ...queue[i], ...patch };
    return { queue, pos: i === s.index ? 0 : pos };
  });

export async function postMusicChat(callId, user, text, extra = {}) {
  await addDoc(musicChatCol(callId), {
    text: String(text || "").slice(0, 500),
    uid: user?.uid || "",
    name: user?.name || "",
    createdAt: serverTimestamp(),
    ...extra,
  });
}

// Call temporária acabou: apaga a música junto.
export async function clearMusic(callId) {
  await deleteDoc(musicStateRef(callId)).catch(() => {});
}

/* ---------------- playlists próprias ---------------- */
const plRef = (id) => doc(db, "musicPlaylists", id);
const cleanTrack = ({ key, by, byName, ...t }) => ({ ...t, key: newKey() }); // eslint-disable-line no-unused-vars

export async function createPlaylist(user, name, tracks = [], shared = true) {
  const n = String(name || "").trim().slice(0, 60);
  if (!n) throw new Error("Dê um nome para a playlist.");
  const ref = await addDoc(collection(db, "musicPlaylists"), {
    name: n,
    ownerId: user.uid,
    ownerName: user.name || "",
    shared,
    tracks: tracks.slice(0, 500).map(cleanTrack),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return ref.id;
}

export const canEditPlaylist = (pl, uid) => !!pl && (pl.ownerId === uid || pl.shared);

export async function addToPlaylist(id, uid, tracks) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(plRef(id));
    const pl = snap.data();
    if (!pl) throw new Error("Playlist não encontrada.");
    if (!canEditPlaylist(pl, uid)) throw new Error("Só o dono pode mexer nessa playlist.");
    const list = [...(pl.tracks || []), ...tracks.map(cleanTrack)];
    if (list.length > 500) throw new Error("Uma playlist aceita até 500 músicas.");
    tx.update(plRef(id), { tracks: list, updatedAt: serverTimestamp() });
    return list.length;
  });
}

export async function removeFromPlaylist(id, uid, key) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(plRef(id));
    const pl = snap.data();
    if (!pl || !canEditPlaylist(pl, uid)) throw new Error("Sem permissão.");
    tx.update(plRef(id), { tracks: (pl.tracks || []).filter((t) => t.key !== key), updatedAt: serverTimestamp() });
  });
}

export async function updatePlaylist(id, uid, patch) {
  const snap = await getDoc(plRef(id));
  const pl = snap.data();
  if (!pl || pl.ownerId !== uid) throw new Error("Só o dono pode fazer isso.");
  await updateDoc(plRef(id), { ...patch, updatedAt: serverTimestamp() });
}

export async function deletePlaylist(id, uid) {
  const snap = await getDoc(plRef(id));
  if (snap.data()?.ownerId !== uid) throw new Error("Só o dono pode apagar.");
  await deleteDoc(plRef(id));
}

export const findPlaylist = (lists, name) => {
  const n = String(name || "").trim().toLowerCase();
  return lists.find((p) => p.name.toLowerCase() === n) || lists.find((p) => p.name.toLowerCase().includes(n));
};

/* ---------------- formatação ---------------- */
export function fmtTime(s) {
  s = Math.max(0, Math.floor(Number(s) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
export function parseTime(str) {
  const parts = String(str || "").trim().split(":").map(Number);
  if (!parts.length || parts.some((n) => !Number.isFinite(n))) return null;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}
