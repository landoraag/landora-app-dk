// SoundOraPad: mesa de sons da call (tipo o Soundpad da Steam).
//
// Cada pessoa tem a própria lista de sons (arquivo de áudio/vídeo enviado ou trecho de um vídeo
// do YouTube). Quando alguém solta um som, o app grava um "disparo" no Firestore e cada aparelho
// da call toca o som na hora, com o volume que cada um escolheu. Ninguém transmite áudio pelo
// microfone, então o som não passa pelo anti-ruído e chega limpo.
//
//   soundpadSounds/{id}          → { ownerId, ownerName, name, emoji, kind, url?, yt?, start, end, createdAt }
//   calls/{callId}/soundpad/live → último disparo { id, by, byName, name, emoji, kind, url?, yt?, start, end, at }
//                                   ou { id, stop: true, by, byName, at } para calar todos os sons

import { addDoc, collection, deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { uploadFile } from "./cloudinary";
import { serverNow } from "./music";

export const MAX_SOUND_SECONDS = 30;
export const soundsCol = () => collection(db, "soundpadSounds");
export const soundpadLiveRef = (callId) => doc(db, "calls", callId, "soundpad", "live");

const YT_RE = /(?:youtube\.com|youtu\.be)/i;
const SOCIAL_RE = /(?:tiktok\.com|instagram\.com|facebook\.com|fb\.watch|kwai)/i;

export function ytId(url) {
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
// Link do YouTube com "?t=90" ou "&t=1m30s": usa como começo do trecho.
export function ytStart(url) {
  try {
    const t = new URL(url).searchParams.get("t") || "";
    const m = t.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
    if (!m) return 0;
    return (Number(m[1]) || 0) * 3600 + (Number(m[2]) || 0) * 60 + (Number(m[3]) || 0);
  } catch {
    return 0;
  }
}

export function checkLink(url) {
  if (YT_RE.test(url)) {
    const id = ytId(url);
    if (!id) throw new Error("Não achei o vídeo nesse link do YouTube.");
    return { yt: id, start: ytStart(url) };
  }
  if (SOCIAL_RE.test(url))
    throw new Error(
      "TikTok, Reels e Kwai não deixam outros apps tocarem os vídeos deles. Baixe o vídeo no celular (ou grave a tela) e envie o arquivo aqui: o app tira o áudio sozinho."
    );
  throw new Error("Cole um link do YouTube ou envie um arquivo de áudio/vídeo.");
}

// URL do Cloudinary que entrega só o áudio, em MP3, já cortado no trecho escolhido.
export function audioUrl(rawUrl, start = 0, end = 0) {
  if (!rawUrl || !rawUrl.includes("/upload/")) return rawUrl;
  const cut = [];
  if (start > 0) cut.push(`so_${Number(start).toFixed(1)}`);
  if (end > 0) cut.push(`eo_${Number(end).toFixed(1)}`);
  const base = rawUrl.replace(/\.[a-z0-9]+(\?.*)?$/i, ".mp3");
  return cut.length ? base.replace("/upload/", `/upload/${cut.join(",")}/`) : base;
}

export async function uploadSoundFile(file) {
  if (!/^(audio|video)\//.test(file.type) && !/\.(mp3|wav|ogg|m4a|aac|flac|opus|webm|mp4|mov|m4v|3gp)$/i.test(file.name))
    throw new Error("Envie um arquivo de áudio ou de vídeo.");
  if (file.size > 60 * 1024 * 1024) throw new Error("Arquivo muito grande (máximo 60 MB).");
  const r = await uploadFile(file, "landora/soundpad", "video"); // "video" no Cloudinary cobre áudio e vídeo
  return { url: r.url, duration: r.duration || 0 };
}

export async function createSound(user, data) {
  const name = String(data.name || "").trim().slice(0, 40) || "Som";
  const start = Math.max(0, Number(data.start) || 0);
  let end = Math.max(0, Number(data.end) || 0);
  if (end && end <= start) throw new Error("O fim do trecho precisa ser depois do começo.");
  if (!end) end = start + MAX_SOUND_SECONDS;
  if (end - start > MAX_SOUND_SECONDS) throw new Error(`Cada som pode ter até ${MAX_SOUND_SECONDS} segundos.`);
  if (data.duration && end > data.duration) end = data.duration;
  await addDoc(soundsCol(), {
    ownerId: user.uid,
    ownerName: user.name || "",
    name,
    emoji: String(data.emoji || "🔊").slice(0, 4),
    kind: data.kind,
    ...(data.kind === "youtube" ? { yt: data.yt } : { url: data.url }),
    start,
    end,
    createdAt: serverTimestamp(),
  });
}

export const updateSound = (id, patch) => updateDoc(doc(db, "soundpadSounds", id), patch);
export const deleteSound = (id) => deleteDoc(doc(db, "soundpadSounds", id));

const rid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export async function fireSound(callId, user, s) {
  await setDoc(soundpadLiveRef(callId), {
    id: rid(),
    by: user?.uid || "",
    byName: user?.name || "",
    name: s.name || "",
    emoji: s.emoji || "🔊",
    kind: s.kind,
    ...(s.kind === "youtube" ? { yt: s.yt } : { url: s.url }),
    start: s.start || 0,
    end: s.end || 0,
    at: serverNow(),
  });
}

export async function stopAllSounds(callId, user) {
  await setDoc(soundpadLiveRef(callId), { id: rid(), stop: true, by: user?.uid || "", byName: user?.name || "", at: serverNow() });
}

/* ---------------- preferências (só deste aparelho) ---------------- */
export function readPadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem("landora.soundpad") || "{}");
    return { on: p.on !== false, vol: Number.isFinite(p.vol) ? p.vol : 70 };
  } catch {
    return { on: true, vol: 70 };
  }
}
export function writePadPrefs(p) {
  try {
    localStorage.setItem("landora.soundpad", JSON.stringify(p));
  } catch {
    /* sem armazenamento */
  }
  window.dispatchEvent(new Event("landora-soundpad-prefs"));
}
