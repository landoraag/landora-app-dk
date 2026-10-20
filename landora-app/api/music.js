// Música nas calls: busca no YouTube e leitura de links (YouTube e Spotify), sem chave de API.
//
// O app chama POST /api/music com o crachá de quem está logado:
//   { action: "search",  q: "nome da música" }        → { results: [faixa, ...] }
//   { action: "resolve", url: "https://..." }        → { tracks: [faixa, ...], title }
//
// faixa = { yt, title, author, thumb, duration, q?, origin, originUrl }
//   yt     = id do vídeo no YouTube (é ele que toca). Faixas vindas do Spotify chegam sem "yt" e
//            com "q" (artista + música): o app procura o vídeo na hora de tocar.
//
// Ninguém baixa nem retransmite áudio: cada pessoa toca o vídeo pelo player oficial do YouTube.
// Do Spotify só lemos nome e artista da página pública de "incorporar".

import { cors, serviceAccount, verifyIdTokenPayload } from "./_lib/google.js";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const HEADERS = { "User-Agent": UA, "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8", Cookie: "CONSENT=YES+1; SOCS=CAI" };
const MAX_TRACKS = 200;

async function getText(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(url, { headers: HEADERS, signal: ctrl.signal, redirect: "follow" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

// Pega um JSON grande de dentro do HTML, começando logo depois de "marker".
function jsonAfter(html, marker) {
  const at = html.indexOf(marker);
  if (at < 0) return null;
  let i = html.indexOf("{", at);
  if (i < 0) return null;
  const start = i;
  let depth = 0;
  let inStr = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

// Percorre o objeto inteiro e junta tudo que tiver a chave pedida.
function collect(obj, key, out = [], limit = 400) {
  if (!obj || typeof obj !== "object" || out.length >= limit) return out;
  if (Array.isArray(obj)) {
    for (const v of obj) collect(v, key, out, limit);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key && v && typeof v === "object") out.push(v);
    else collect(v, key, out, limit);
  }
  return out;
}

const text = (t) => (t?.simpleText ?? (t?.runs || []).map((r) => r.text).join("") ?? "").trim();
const parseLen = (s) => {
  if (!s) return 0;
  return String(s)
    .split(":")
    .map(Number)
    .reduce((acc, n) => acc * 60 + (Number.isFinite(n) ? n : 0), 0);
};
const thumbOf = (id) => `https://i.ytimg.com/vi/${id}/mqdefault.jpg`;

function ytTrack(v, origin = "youtube") {
  const id = v.videoId;
  return {
    yt: id,
    title: text(v.title) || "Sem título",
    author: text(v.ownerText) || text(v.shortBylineText) || text(v.longBylineText) || "",
    thumb: thumbOf(id),
    duration: Number(v.lengthSeconds) || parseLen(text(v.lengthText)),
    origin,
    originUrl: `https://www.youtube.com/watch?v=${id}`,
  };
}

/* ---------------- YouTube ---------------- */
export async function ytSearch(q, limit = 8) {
  const html = await getText(`https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&hl=pt-BR&gl=BR`);
  const data = jsonAfter(html, "ytInitialData");
  if (!data) throw new Error("O YouTube não respondeu a busca.");
  const seen = new Set();
  return collect(data, "videoRenderer")
    .filter((v) => v.videoId && !seen.has(v.videoId) && seen.add(v.videoId))
    // Pula transmissões ao vivo (não têm duração e não terminam).
    .filter((v) => v.lengthText)
    .slice(0, limit)
    .map((v) => ytTrack(v));
}

async function ytVideo(id) {
  try {
    const r = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`, { headers: HEADERS });
    const o = r.ok ? await r.json() : {};
    return { yt: id, title: o.title || "Vídeo do YouTube", author: o.author_name || "", thumb: thumbOf(id), duration: 0, origin: "youtube", originUrl: `https://www.youtube.com/watch?v=${id}` };
  } catch {
    return { yt: id, title: "Vídeo do YouTube", author: "", thumb: thumbOf(id), duration: 0, origin: "youtube", originUrl: `https://www.youtube.com/watch?v=${id}` };
  }
}

async function ytPlaylist(list) {
  const html = await getText(`https://www.youtube.com/playlist?list=${encodeURIComponent(list)}&hl=pt-BR`);
  const data = jsonAfter(html, "ytInitialData");
  if (!data) throw new Error("Não consegui abrir essa playlist (ela é pública?).");
  const title = text(collect(data, "playlistHeaderRenderer")[0]?.title) || collect(data, "pageHeaderViewModel")[0]?.title?.dynamicTextViewModel?.text?.content || "Playlist do YouTube";
  const seen = new Set();
  const tracks = collect(data, "playlistVideoRenderer")
    .filter((v) => v.videoId && v.isPlayable !== false && !seen.has(v.videoId) && seen.add(v.videoId))
    .slice(0, MAX_TRACKS)
    .map((v) => ytTrack(v));
  return { title, tracks };
}

/* ---------------- Spotify (página pública de incorporar) ---------------- */
function spotifyItem(name, artists, durationMs, url) {
  const artist = Array.isArray(artists) ? artists.map((a) => a?.name || a).filter(Boolean).join(", ") : String(artists || "");
  return {
    yt: null,
    q: `${artist} - ${name}`.replace(/^ - /, ""),
    title: name || "Música do Spotify",
    author: artist,
    thumb: "",
    duration: Math.round((Number(durationMs) || 0) / 1000),
    origin: "spotify",
    originUrl: url,
  };
}

async function spotify(kind, id) {
  const url = `https://open.spotify.com/${kind}/${id}`;
  const html = await getText(`https://open.spotify.com/embed/${kind}/${id}`);
  const next = jsonAfter(html, 'id="__NEXT_DATA__"');
  const entity = next?.props?.pageProps?.state?.data?.entity || collect(next, "entity")[0];
  if (!entity) throw new Error("Não consegui ler esse link do Spotify.");
  const cover =
    entity.coverArt?.sources?.[0]?.url || entity.visualIdentity?.image?.[0]?.url || entity.images?.[0]?.url || "";
  if (kind === "track") {
    const t = spotifyItem(entity.name || entity.title, entity.artists || entity.subtitle, entity.duration, url);
    t.thumb = cover;
    return { title: t.title, tracks: [t] };
  }
  const list = (entity.trackList || []).slice(0, MAX_TRACKS).map((t) => {
    const item = spotifyItem(t.title, t.subtitle, t.duration, t.uri ? `https://open.spotify.com/track/${String(t.uri).split(":").pop()}` : url);
    item.thumb = cover;
    return item;
  });
  if (!list.length) throw new Error("Essa playlist do Spotify está vazia ou é privada.");
  return { title: entity.name || entity.title || "Playlist do Spotify", tracks: list };
}

/* ---------------- ler um link ---------------- */
export function parseLink(raw) {
  let u;
  try {
    u = new URL(String(raw).trim());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\.|^m\.|^music\./, "");
  if (host === "youtu.be") return { type: "yt-video", id: u.pathname.slice(1).split("/")[0] };
  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const v = u.searchParams.get("v");
    const list = u.searchParams.get("list");
    if (u.pathname === "/playlist" && list) return { type: "yt-playlist", id: list };
    if (v) return { type: "yt-video", id: v, list };
    const m = u.pathname.match(/^\/(shorts|embed|live|v)\/([\w-]{6,})/);
    if (m) return { type: "yt-video", id: m[2] };
  }
  if (host === "open.spotify.com" || host === "spotify.link") {
    const m = u.pathname.match(/(?:\/intl-[a-z-]+)?\/(track|album|playlist)\/([A-Za-z0-9]+)/);
    if (m) return { type: "spotify", kind: m[1], id: m[2] };
  }
  return null;
}

async function resolve(url) {
  const p = parseLink(url);
  if (!p) throw new Error("Link não reconhecido. Use links do YouTube ou do Spotify.");
  if (p.type === "yt-video") return { title: "", tracks: [await ytVideo(p.id)] };
  if (p.type === "yt-playlist") return ytPlaylist(p.id);
  return spotify(p.kind, p.id);
}

export default async function handler(req, res) {
  const allowed = cors(req, res);
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, servico: "Música das calls" });
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST." });
  if (!allowed) return res.status(403).json({ error: "Origem não permitida." });

  try {
    const sa = serviceAccount();
    try {
      await verifyIdTokenPayload(String(req.headers.authorization || "").replace(/^Bearer\s+/i, ""), sa.project_id);
    } catch (e) {
      return res.status(401).json({ error: `Não autorizado (${e.message}).` });
    }
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : req.body || {};
    res.setHeader("Cache-Control", "no-store");
    if (body.action === "search") {
      const q = String(body.q || "").trim().slice(0, 200);
      if (!q) return res.status(400).json({ error: "Digite o que procurar." });
      return res.status(200).json({ results: await ytSearch(q, Math.min(10, Number(body.limit) || 8)) });
    }
    if (body.action === "resolve") return res.status(200).json(await resolve(body.url));
    return res.status(400).json({ error: "Ação desconhecida." });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message || "Falha ao buscar a música." });
  }
}
