import { useEffect, useMemo, useRef, useState } from "react";
import { limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { useMusic } from "../context/MusicContext";
import { useCollection } from "../lib/useCollection";
import {
  addToPlaylist,
  addTracks,
  canEditPlaylist,
  clearQueue,
  createPlaylist,
  deletePlaylist,
  findPlaylist,
  fmtTime,
  jump,
  lookup,
  moveTrack,
  musicChatCol,
  parseTime,
  postMusicChat,
  removeAt,
  removeFromPlaylist,
  searchMusic,
  seek,
  setLoop,
  setPlaying,
  shuffle,
  skip,
  toTrack,
  updatePlaylist,
} from "../lib/music";

const LOOP_LABEL = { off: "sem repetir", one: "repetindo a música", all: "repetindo a fila" };
const LOOP_NEXT = { off: "all", all: "one", one: "off" };

export const MUSIC_HELP = [
  ["link ou nome", "toca (YouTube, Spotify ou busca pelo nome)"],
  ["/agora <música>", "toca agora, passando na frente"],
  ["/proxima <música>", "entra logo depois da atual"],
  ["/buscar <nome>", "mostra opções para escolher"],
  ["/pausar · /tocar", "pausa ou continua para todos"],
  ["/pular [n] · /voltar", "pula músicas ou volta uma"],
  ["/ir 1:30", "vai para um ponto da música"],
  ["/remover 3 · /mover 5 2", "mexe na fila"],
  ["/misturar · /loop [uma|fila|off]", "embaralha / repete"],
  ["/limpar", "esvazia a fila"],
  ["/vol 40", "volume da música só para você"],
  ["/tocando", "mostra o que está tocando"],
  ["/playlist salvar <nome>", "salva a fila como playlist"],
  ["/playlist tocar <nome>", "coloca a playlist na fila"],
  ["/playlist add <nome>", "guarda a música atual na playlist"],
];

function Thumb({ t }) {
  return t.thumb ? <img className="mq-thumb" src={t.thumb} alt="" loading="lazy" /> : <span className="mq-thumb ph">{t.origin === "spotify" ? "🟢" : "🎵"}</span>;
}

function useMusicChat(callId) {
  const [msgs, setMsgs] = useState([]);
  useEffect(() => {
    setMsgs([]);
    if (!callId) return undefined;
    const q = query(musicChatCol(callId), orderBy("createdAt", "desc"), limit(60));
    return onSnapshot(q, (s) => setMsgs(s.docs.map((d) => ({ id: d.id, ...d.data() })).reverse()), () => {});
  }, [callId]);
  return msgs;
}

export default function MusicPanel({ onClose }) {
  const m = useMusic();
  const { callId, state, current, me, listening, setListening, volume, setVolume, progress } = m;
  const { data: playlists } = useCollection("musicPlaylists", "createdAt", "desc");
  const visiblePl = useMemo(() => playlists.filter((p) => p.shared || p.ownerId === me.uid), [playlists, me.uid]);
  const chat = useMusicChat(callId);
  const [tab, setTab] = useState("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [local, setLocal] = useState([]); // respostas só para você (erros, ajuda, busca)
  const [results, setResults] = useState(null); // { q, list }
  const [openPl, setOpenPl] = useState(null);
  const listRef = useRef(null);

  const queue = state?.queue || [];
  const idx = state?.index ?? 0;

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, local.length, results, tab]);

  const say = (txt, bad) => setLocal((l) => [...l.slice(-12), { id: Math.random(), text: txt, bad, at: Date.now() }]);
  const announce = (txt) => postMusicChat(callId, { uid: "", name: "DJ Landora" }, txt, { bot: true }).catch(() => {});

  async function addFrom(input, opts = {}) {
    const { tracks, title } = await lookup(input);
    const list = tracks.map((t) => toTrack(t, me));
    await addTracks(callId, list, opts);
    if (list.length === 1) {
      const t = list[0];
      const where = opts.playNow ? "colocou para tocar agora" : opts.playNext ? "colocou como próxima" : "adicionou";
      announce(`🎵 ${me.name} ${where} “${t.title}”${t.author ? ` — ${t.author}` : ""}${t.origin === "spotify" ? " (do Spotify)" : ""}`);
    } else {
      announce(`📀 ${me.name} adicionou ${list.length} músicas${title ? ` de “${title}”` : ""}`);
    }
  }

  async function runCommand(raw) {
    const input = raw.trim();
    if (!input) return;
    if (!input.startsWith("/")) {
      await postMusicChat(callId, me, input);
      return addFrom(input);
    }
    const [cmdRaw, ...rest] = input.slice(1).split(/\s+/);
    const cmd = cmdRaw.toLowerCase();
    const arg = rest.join(" ").trim();
    const n = parseInt(arg, 10);
    switch (cmd) {
      case "play":
      case "p":
      case "tocar":
      case "resume":
      case "continuar":
        if (!arg) {
          await setPlaying(callId, true);
          return announce(`▶ ${me.name} deu play`);
        }
        await postMusicChat(callId, me, input);
        return addFrom(arg);
      case "agora":
      case "pn":
      case "playnow":
        if (!arg) throw new Error("Use /agora <link ou nome>.");
        await postMusicChat(callId, me, input);
        return addFrom(arg, { playNow: true });
      case "proxima":
      case "próxima":
      case "next":
        if (!arg) throw new Error("Use /proxima <link ou nome>.");
        await postMusicChat(callId, me, input);
        return addFrom(arg, { playNext: true });
      case "buscar":
      case "search":
      case "b": {
        if (!arg) throw new Error("Use /buscar <nome>.");
        const list = await searchMusic(arg, 6);
        if (!list.length) throw new Error(`Não achei nada para “${arg}”.`);
        setTab("chat");
        return setResults({ q: arg, list });
      }
      case "pause":
      case "pausar":
        await setPlaying(callId, false);
        return announce(`⏸ ${me.name} pausou`);
      case "skip":
      case "pular":
      case "s":
        await skip(callId, Number.isFinite(n) && n > 0 ? n : 1);
        return announce(`⏭ ${me.name} pulou${n > 1 ? ` ${n} músicas` : current ? ` “${current.title}”` : ""}`);
      case "voltar":
      case "back":
      case "prev":
        await skip(callId, -1);
        return announce(`⏮ ${me.name} voltou uma música`);
      case "ir":
      case "seek": {
        const sec = parseTime(arg);
        if (sec == null) throw new Error("Use /ir 1:30.");
        await seek(callId, sec);
        return announce(`⏩ ${me.name} foi para ${fmtTime(sec)}`);
      }
      case "fila":
      case "queue":
      case "q":
        return setTab("queue");
      case "remover":
      case "rm":
      case "remove": {
        if (!(n >= 1)) throw new Error("Use /remover <número da fila>.");
        const t = queue[n - 1];
        await removeAt(callId, n - 1);
        return announce(`🗑 ${me.name} tirou “${t?.title}” da fila`);
      }
      case "mover":
      case "move": {
        const [a, b] = rest.map((x) => parseInt(x, 10));
        if (!(a >= 1 && b >= 1)) throw new Error("Use /mover <de> <para>.");
        await moveTrack(callId, a - 1, b - 1);
        return announce(`↕ ${me.name} mudou a ordem da fila`);
      }
      case "limpar":
      case "clear":
        await clearQueue(callId);
        return announce(`🧹 ${me.name} limpou a fila`);
      case "misturar":
      case "shuffle":
        await shuffle(callId);
        return announce(`🔀 ${me.name} embaralhou a fila`);
      case "loop":
      case "repetir": {
        const map = { off: "off", nao: "off", não: "off", uma: "one", one: "one", musica: "one", música: "one", fila: "all", all: "all", tudo: "all" };
        const next = map[arg.toLowerCase()] || LOOP_NEXT[state?.loop || "off"];
        await setLoop(callId, next);
        return announce(`🔁 ${me.name}: ${LOOP_LABEL[next]}`);
      }
      case "vol":
      case "volume":
        if (!Number.isFinite(n)) throw new Error("Use /vol 0 a 100.");
        setVolume(n);
        return say(`🔊 Volume da música: ${Math.max(0, Math.min(100, n))}% (só para você)`);
      case "tocando":
      case "np":
      case "now":
        return say(current ? `🎶 Tocando: ${current.title}${current.author ? ` — ${current.author}` : ""} (${fmtTime(progress.t)} / ${fmtTime(progress.d)})` : "Nada tocando agora.");
      case "playlists":
        return setTab("playlists");
      case "playlist":
      case "pl":
        return playlistCommand(rest);
      case "ajuda":
      case "help":
      case "comandos":
        return setTab("help");
      default:
        throw new Error(`Comando “/${cmd}” não existe. Digite /ajuda.`);
    }
  }

  async function playlistCommand(rest) {
    const sub = (rest[0] || "").toLowerCase();
    const name = rest.slice(1).join(" ").trim();
    if (!sub) return setTab("playlists");
    if (["salvar", "save", "criar", "nova"].includes(sub)) {
      if (!name) throw new Error("Use /playlist salvar <nome>.");
      const tracks = sub === "salvar" || sub === "save" ? queue.slice(idx) : [];
      await createPlaylist(me, name, tracks);
      return say(`💾 Playlist “${name}” criada${tracks.length ? ` com ${tracks.length} músicas` : ""}.`);
    }
    const pl = findPlaylist(visiblePl, name);
    if (!name || !pl) throw new Error(name ? `Não achei a playlist “${name}”.` : "Diga o nome da playlist.");
    if (["tocar", "play", "carregar"].includes(sub)) return playPlaylist(pl);
    if (["add", "adicionar", "guardar"].includes(sub)) {
      if (!current) throw new Error("Nada tocando para guardar.");
      await addToPlaylist(pl.id, me.uid, [current]);
      return say(`➕ “${current.title}” entrou na playlist “${pl.name}”.`);
    }
    throw new Error("Use /playlist salvar | tocar | add <nome>.");
  }

  async function playPlaylist(pl, shuffleIt = false) {
    let tracks = (pl.tracks || []).map((t) => toTrack(t, me));
    if (!tracks.length) throw new Error("Essa playlist está vazia.");
    if (shuffleIt) tracks = [...tracks].sort(() => Math.random() - 0.5);
    await addTracks(callId, tracks);
    announce(`📀 ${me.name} colocou a playlist “${pl.name}” (${tracks.length} músicas)${shuffleIt ? " embaralhada" : ""}`);
  }

  async function submit(e) {
    e?.preventDefault();
    const v = text;
    if (!v.trim() || busy) return;
    setBusy(true);
    setText("");
    setResults(null);
    try {
      await runCommand(v);
    } catch (err) {
      say(err.message, true);
    }
    setBusy(false);
  }

  const guard = (fn) => async () => {
    try {
      await fn();
    } catch (err) {
      say(err.message, true);
    }
  };

  const feed = useMemo(() => {
    const a = chat.map((c) => ({ ...c, t: c.createdAt?.toMillis?.() || Date.now() }));
    const b = local.map((l) => ({ ...l, local: true, t: l.at }));
    return [...a, ...b].sort((x, y) => x.t - y.t);
  }, [chat, local]);

  if (!callId) return null;

  return (
    <div className="music-panel">
      <div className="music-head">
        <b>🎵 Música</b>
        <div className="music-tabs">
          {[
            ["chat", "Chat"],
            ["queue", `Fila${queue.length ? ` (${Math.max(0, queue.length - idx)})` : ""}`],
            ["playlists", "Playlists"],
            ["help", "Comandos"],
          ].map(([id, label]) => (
            <button type="button" key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
              {label}
            </button>
          ))}
        </div>
        {onClose && (
          <button type="button" className="btn-link" onClick={onClose}>
            fechar
          </button>
        )}
      </div>

      {current ? (
        <div className="music-now">
          <Thumb t={current} />
          <div className="music-now-info">
            <b>{current.title}</b>
            <span>
              {current.author}
              {current.byName ? ` · pedido por ${current.byName}` : ""}
            </span>
            <div className="music-bar">
              <i style={{ width: `${progress.d ? Math.min(100, (progress.t / progress.d) * 100) : 0}%` }} />
            </div>
          </div>
          <div className="music-now-ctrl">
            <button type="button" onClick={guard(() => skip(callId, -1))} title="Voltar">
              ⏮
            </button>
            <button type="button" className="main" onClick={guard(() => setPlaying(callId, !state?.playing))} title={state?.playing ? "Pausar para todos" : "Tocar para todos"}>
              {state?.playing ? "⏸" : "▶"}
            </button>
            <button type="button" onClick={guard(() => skip(callId, 1))} title="Pular">
              ⏭
            </button>
            <button type="button" className={state?.loop !== "off" && state?.loop ? "lit" : ""} onClick={guard(() => setLoop(callId, LOOP_NEXT[state?.loop || "off"]))} title={LOOP_LABEL[state?.loop || "off"]}>
              {state?.loop === "one" ? "🔂" : "🔁"}
            </button>
          </div>
        </div>
      ) : (
        <p className="music-empty">Nada tocando. Cole um link do YouTube ou do Spotify, ou escreva o nome de uma música.</p>
      )}

      <div className="music-listen">
        {listening ? (
          <>
            <span>🔊 {volume}%</span>
            <input className="vm-slider" type="range" min="0" max="100" value={volume} style={{ "--p": `${volume}%` }} onChange={(e) => setVolume(Number(e.target.value))} aria-label="Volume da música" />
            <button type="button" className="btn-link" onClick={() => setListening(false)}>
              não ouvir
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-gradient" onClick={() => setListening(true)}>
            🎧 Ouvir a música da call
          </button>
        )}
      </div>

      <div className="music-body" ref={listRef}>
        {tab === "chat" && (
          <div className="music-feed">
            {feed.length === 0 && <p className="muted">Mande um link ou um nome de música para começar. Digite /ajuda para ver os comandos.</p>}
            {feed.map((c) => (
              <div key={c.id} className={"mf-row" + (c.bot ? " bot" : "") + (c.local ? " local" : "") + (c.bad ? " bad" : "")}>
                {!c.bot && !c.local && <b>{c.name}</b>}
                <span>{c.text}</span>
              </div>
            ))}
            {results && (
              <div className="music-results">
                <div className="mr-head">
                  Resultados para “{results.q}”
                  <button type="button" className="btn-link" onClick={() => setResults(null)}>
                    fechar
                  </button>
                </div>
                {results.list.map((r) => (
                  <div key={r.yt} className="mr-row">
                    <Thumb t={r} />
                    <div className="mr-info">
                      <b>{r.title}</b>
                      <span>
                        {r.author} · {fmtTime(r.duration)}
                      </span>
                    </div>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={guard(async () => {
                        const t = toTrack(r, me);
                        await addTracks(callId, [t]);
                        announce(`🎵 ${me.name} adicionou “${t.title}”`);
                        setResults(null);
                      })}
                    >
                      + Fila
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "queue" && (
          <div className="music-queue">
            {queue.length === 0 && <p className="muted">A fila está vazia.</p>}
            {queue.map((t, i) => (
              <div key={t.key} className={"mq-row" + (i === idx ? " now" : "") + (i < idx ? " done" : "")}>
                <span className="mq-n">{i === idx ? (state?.playing ? "▶" : "⏸") : i + 1}</span>
                <Thumb t={t} />
                <button type="button" className="mq-info" onClick={guard(() => jump(callId, i))} title="Tocar esta">
                  <b>{t.title}</b>
                  <span>
                    {t.author}
                    {t.duration ? ` · ${fmtTime(t.duration)}` : ""}
                    {t.byName ? ` · ${t.byName}` : ""}
                    {t.origin === "spotify" ? " · Spotify" : ""}
                  </span>
                </button>
                <div className="mq-act">
                  {i > idx + 1 && (
                    <button type="button" title="Subir" onClick={guard(() => moveTrack(callId, i, i - 1))}>
                      ↑
                    </button>
                  )}
                  <button type="button" title="Tirar da fila" onClick={guard(() => removeAt(callId, i))}>
                    ✕
                  </button>
                </div>
              </div>
            ))}
            {queue.length > 0 && (
              <div className="music-queue-foot">
                <button type="button" className="btn btn-ghost" onClick={guard(() => shuffle(callId))}>
                  🔀 Misturar
                </button>
                <button type="button" className="btn btn-ghost" onClick={guard(() => clearQueue(callId))}>
                  🧹 Limpar
                </button>
              </div>
            )}
          </div>
        )}

        {tab === "playlists" && (
          <Playlists
            lists={visiblePl}
            me={me}
            current={current}
            queue={queue.slice(idx)}
            openId={openPl}
            setOpenId={setOpenPl}
            onPlay={(pl, sh) => guard(() => playPlaylist(pl, sh))()}
            onPlayTrack={(t) => guard(() => addTracks(callId, [toTrack(t, me)]).then(() => announce(`🎵 ${me.name} adicionou “${t.title}”`)))()}
            onError={(msg) => say(msg, true)}
            onInfo={(msg) => say(msg)}
          />
        )}

        {tab === "help" && (
          <div className="music-help">
            {MUSIC_HELP.map(([c, d]) => (
              <div key={c}>
                <code>{c}</code>
                <span>{d}</span>
              </div>
            ))}
            <p className="muted">
              Links do Spotify tocam a mesma música pelo YouTube (o Spotify não deixa outros apps tocarem as músicas dele). Cada
              pessoa ouve no próprio aparelho, então a música não passa pelo microfone nem pelo anti-ruído.
            </p>
          </div>
        )}
      </div>

      <form className="music-input" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Link do YouTube/Spotify, nome da música ou /comando"
          disabled={busy}
          enterKeyHint="send"
        />
        <button type="submit" className="btn btn-gradient" disabled={busy || !text.trim()}>
          {busy ? "…" : "Enviar"}
        </button>
      </form>
    </div>
  );
}

function Playlists({ lists, me, current, queue, openId, setOpenId, onPlay, onPlayTrack, onError, onInfo }) {
  const [name, setName] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const open = lists.find((p) => p.id === openId);
  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  };

  if (open) {
    const editable = canEditPlaylist(open, me.uid);
    const mine = open.ownerId === me.uid;
    return (
      <div className="music-pl">
        <button type="button" className="btn-link" onClick={() => setOpenId(null)}>
          ← todas as playlists
        </button>
        <div className="pl-head">
          <div>
            <b>{open.name}</b>
            <span>
              {(open.tracks || []).length} músicas · de {open.ownerName || "—"} · {open.shared ? "todos podem editar" : "só o dono edita"}
            </span>
          </div>
          <div className="pl-head-act">
            <button type="button" className="btn btn-gradient" disabled={busy} onClick={() => onPlay(open)}>
              ▶ Tocar
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onPlay(open, true)}>
              🔀
            </button>
          </div>
        </div>
        {editable && (
          <div className="pl-add">
            <input value={link} onChange={(e) => setLink(e.target.value)} placeholder="Link ou nome para adicionar" />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy || !link.trim()}
              onClick={() =>
                run(async () => {
                  const { tracks } = await lookup(link);
                  const total = await addToPlaylist(open.id, me.uid, tracks.map((t) => toTrack(t, me)));
                  setLink("");
                  onInfo(`➕ ${tracks.length} música(s) na “${open.name}” (agora com ${total}).`);
                })
              }
            >
              Adicionar
            </button>
            {current && (
              <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(async () => { await addToPlaylist(open.id, me.uid, [current]); onInfo(`➕ “${current.title}” entrou na playlist.`); })}>
                + Atual
              </button>
            )}
          </div>
        )}
        <div className="music-queue">
          {(open.tracks || []).map((t, i) => (
            <div key={t.key || i} className="mq-row">
              <span className="mq-n">{i + 1}</span>
              <Thumb t={t} />
              <button type="button" className="mq-info" onClick={() => onPlayTrack(t)} title="Pôr na fila">
                <b>{t.title}</b>
                <span>{t.author}</span>
              </button>
              {editable && (
                <div className="mq-act">
                  <button type="button" title="Tirar da playlist" onClick={() => run(() => removeFromPlaylist(open.id, me.uid, t.key))}>
                    ✕
                  </button>
                </div>
              )}
            </div>
          ))}
          {!(open.tracks || []).length && <p className="muted">Playlist vazia.</p>}
        </div>
        {mine && (
          <div className="music-queue-foot">
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => run(() => updatePlaylist(open.id, me.uid, { shared: !open.shared }))}>
              {open.shared ? "🔒 Só eu edito" : "👥 Todos editam"}
            </button>
            <button
              type="button"
              className="btn btn-ghost danger"
              disabled={busy}
              onClick={() => confirm(`Apagar a playlist “${open.name}”?`) && run(async () => { await deletePlaylist(open.id, me.uid); setOpenId(null); })}
            >
              Apagar
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="music-pl">
      <div className="pl-add">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome da nova playlist" maxLength={60} />
        <button type="button" className="btn btn-ghost" disabled={busy || !name.trim()} onClick={() => run(async () => { await createPlaylist(me, name, []); setName(""); })}>
          Criar vazia
        </button>
        <button
          type="button"
          className="btn btn-gradient"
          disabled={busy || !name.trim() || !queue.length}
          title="Salva a música atual e as próximas da fila"
          onClick={() => run(async () => { await createPlaylist(me, name, queue); setName(""); onInfo(`💾 Playlist “${name}” salva com ${queue.length} músicas.`); })}
        >
          Salvar a fila
        </button>
      </div>
      {lists.length === 0 && <p className="muted">Nenhuma playlist ainda. Monte uma fila e salve, ou crie uma vazia.</p>}
      {lists.map((p) => (
        <div key={p.id} className="pl-row">
          <button type="button" className="pl-open" onClick={() => setOpenId(p.id)}>
            <span className="pl-ico">📀</span>
            <span className="pl-info">
              <b>{p.name}</b>
              <span>
                {(p.tracks || []).length} músicas · {p.ownerName}
              </span>
            </span>
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => onPlay(p)} disabled={!(p.tracks || []).length}>
            ▶
          </button>
        </div>
      ))}
    </div>
  );
}
