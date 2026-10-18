import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { addDoc, collection, deleteDoc, deleteField, doc, getDoc, getDocs, onSnapshot, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";
import Icon from "../Icons";
import { downloadUrl, uploadFile, uploadImage } from "../../lib/cloudinary";
import { shrinkImage } from "../../lib/image";
import { CAN_RECORD, useRecorder } from "../../lib/useRecorder";
import { useCall } from "../../context/CallContext";
import { InCall } from "./Calls";
import { useVoiceMembers } from "../../lib/useVoiceMembers";
import { notify } from "../../lib/push";
import { CasinoBar, GameResultCard } from "../Casino";
import { CASINO_CATEGORY_ID, CASINO_CHANNEL_ID, isCasinoChannel } from "../../lib/casino";

// Garante que a categoria "Entretenimento" e o canal #cassino existam (uma vez por sessão).
let casinoEnsured = false;
function ensureCasinoChannel() {
  if (casinoEnsured) return;
  casinoEnsured = true;
  (async () => {
    const cat = doc(db, "channelCategories", CASINO_CATEGORY_ID);
    if (!(await getDoc(cat)).exists()) await setDoc(cat, { name: "Entretenimento", createdAt: serverTimestamp() });
    const ch = doc(db, "channels", CASINO_CHANNEL_ID);
    if (!(await getDoc(ch)).exists()) await setDoc(ch, { name: "cassino", categoryId: CASINO_CATEGORY_ID, kind: "casino", createdAt: serverTimestamp() });
  })().catch((e) => {
    casinoEnsured = false;
    console.error("cassino:", e);
  });
}

// Mensagem no Firestore (chatMessages/{id}):
//   channelId, text, images: [url], files: [{ url, name, size, type }], audio: { url, duration },
//   replyTo: { id, nickname, preview }, edited, editedAt, pinned, pinnedAt, pinnedBy,
//   senderId, senderNickname, createdAt
// Mensagens antigas usam imageUrl (uma imagem só) — continuam aparecendo normalmente.

const MAX_ATTACH = 6; // anexos por mensagem (imagens + arquivos)
const MAX_IMAGE_MB = 20;
const MAX_FILE_MB = 10; // limite do plano gratuito do Cloudinary para documentos
// Tipos de arquivo aceitos além de imagens.
const DOC_ACCEPT =
  ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.7z,.odt,.ods,.odp,.rtf";
const DOC_EXTS = DOC_ACCEPT.split(",").map((e) => e.slice(1));

const imagesOf = (m) => (m.images?.length ? m.images : m.imageUrl ? [m.imageUrl] : []);
const extOf = (name = "") => (name.includes(".") ? name.split(".").pop().toLowerCase() : "");
const isImageFile = (f) => f.type.startsWith("image/") && !/svg/.test(f.type);
const isDocFile = (f) => DOC_EXTS.includes(extOf(f.name));

function fileSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

// Cor e rótulo do cartão de cada tipo de arquivo.
function fileKind(name) {
  const e = extOf(name);
  if (e === "pdf") return { label: "PDF", cls: "fk-pdf" };
  if (["doc", "docx", "odt", "rtf", "txt"].includes(e)) return { label: e.toUpperCase(), cls: "fk-doc" };
  if (["xls", "xlsx", "ods", "csv"].includes(e)) return { label: e.toUpperCase(), cls: "fk-xls" };
  if (["ppt", "pptx", "odp"].includes(e)) return { label: e.toUpperCase(), cls: "fk-ppt" };
  if (["zip", "rar", "7z"].includes(e)) return { label: e.toUpperCase(), cls: "fk-zip" };
  return { label: (e || "ARQ").toUpperCase(), cls: "fk-doc" };
}

function previewOf(m) {
  if (m.text) return m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text;
  if (imagesOf(m).length) return "📷 Imagem";
  if (m.files?.length) return `📎 ${m.files[0].name}${m.files.length > 1 ? ` +${m.files.length - 1}` : ""}`;
  if (m.audio) return "🎤 Áudio";
  return "Mensagem";
}

/* ---------- @menções ---------- */
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const msOf = (m) => m.createdAt?.toMillis?.() ?? (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : Date.now());

// Quem foi marcado com @Nome no texto.
// (O nome precisa terminar ali: "@Kauan" não marca alguém chamado "Ka".)
function findMentions(text, people) {
  return people
    .filter((p) => p.nickname && new RegExp(`@${escapeRe(p.nickname)}(?![\\p{L}\\p{N}_])`, "iu").test(text || ""))
    .map((p) => p.id);
}

// Texto da mensagem com as @menções destacadas.
function MessageText({ text, people, myName }) {
  const names = people.map((p) => p.nickname).filter(Boolean).sort((a, b) => b.length - a.length);
  if (!names.length || !text.includes("@")) return text;
  const re = new RegExp(`@(${names.map(escapeRe).join("|")})(?![\\p{L}\\p{N}_])`, "giu");
  const out = [];
  let last = 0;
  let mt;
  while ((mt = re.exec(text))) {
    if (mt.index > last) out.push(text.slice(last, mt.index));
    const isMe = myName && mt[1].toLowerCase() === myName.toLowerCase();
    out.push(
      <span key={mt.index} className={"chat-mention" + (isMe ? " me" : "")}>
        {mt[0]}
      </span>
    );
    last = mt.index + mt[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function FileCard({ file }) {
  const k = fileKind(file.name);
  return (
    <a className="chat-file" href={file.url} target="_blank" rel="noreferrer" download={file.name} title={`Baixar ${file.name}`}>
      <span className={"chat-file-icon " + k.cls}>{k.label}</span>
      <span className="chat-file-info">
        <b>{file.name}</b>
        <span>{fileSize(file.size)}</span>
      </span>
      <Icon name="download" size={17} />
    </a>
  );
}

const mmss = (s) => {
  const n = Math.max(0, Math.round(s || 0));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
};

function timeOf(m) {
  const d = m.createdAt?.toDate?.();
  if (!d) return "";
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return sameDay ? hm : `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hm}`;
}

/* ---------------- Visualizador de imagem (zoom, baixar, responder) ---------------- */
function ImageViewer({ viewer, onClose, onReply }) {
  const { images, index: startIndex, message } = viewer;
  const [index, setIndex] = useState(startIndex);
  const [zoom, setZoom] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const url = images[index];

  const reset = () => {
    setZoom(1);
    setPos({ x: 0, y: 0 });
  };
  const zoomBy = (f) =>
    setZoom((z) => {
      const nz = Math.min(6, Math.max(1, +(z * f).toFixed(2)));
      if (nz === 1) setPos({ x: 0, y: 0 });
      return nz;
    });
  const go = (d) => {
    setIndex((i) => (i + d + images.length) % images.length);
    reset();
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
      if (e.key === "+" || e.key === "=") zoomBy(1.25);
      if (e.key === "-") zoomBy(0.8);
      if (e.key === "ArrowRight" && images.length > 1) go(1);
      if (e.key === "ArrowLeft" && images.length > 1) go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images.length, onClose]);

  const onPointerDown = (e) => {
    if (zoom === 1) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX - pos.x, y: e.clientY - pos.y };
  };
  const onPointerMove = (e) => {
    if (!drag.current) return;
    setPos({ x: e.clientX - drag.current.x, y: e.clientY - drag.current.y });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="iv-backdrop" onClick={onClose}>
      <div className="iv-top" onClick={(e) => e.stopPropagation()}>
        <div className="iv-who">
          <b>{message.senderNickname}</b>
          <span>{timeOf(message)}</span>
        </div>
        <div className="iv-tools">
          <button type="button" onClick={() => zoomBy(0.8)} disabled={zoom <= 1} title="Diminuir zoom" aria-label="Diminuir zoom">
            <Icon name="zoomOut" />
          </button>
          <button type="button" className="iv-zoom-val" onClick={reset} title="Tamanho original da tela">
            {Math.round(zoom * 100)}%
          </button>
          <button type="button" onClick={() => zoomBy(1.25)} disabled={zoom >= 6} title="Aumentar zoom" aria-label="Aumentar zoom">
            <Icon name="zoomIn" />
          </button>
          <a href={downloadUrl(url)} download title="Baixar" aria-label="Baixar">
            <Icon name="download" />
          </a>
          <button
            type="button"
            onClick={() => {
              onReply(message);
              onClose();
            }}
            title="Responder"
            aria-label="Responder"
          >
            <Icon name="reply" />
          </button>
          <button type="button" onClick={onClose} title="Fechar (Esc)" aria-label="Fechar">
            <Icon name="close" />
          </button>
        </div>
      </div>

      <div
        className={"iv-stage" + (zoom > 1 ? " zoomed" : "")}
        onClick={(e) => e.stopPropagation()}
        onWheel={(e) => zoomBy(e.deltaY < 0 ? 1.15 : 0.87)}
        onDoubleClick={() => (zoom > 1 ? reset() : setZoom(2.5))}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <img
          src={url}
          alt=""
          draggable={false}
          style={{ transform: `translate(${pos.x}px, ${pos.y}px) scale(${zoom})` }}
        />
      </div>

      {images.length > 1 && (
        <>
          <button type="button" className="iv-nav prev" onClick={(e) => (e.stopPropagation(), go(-1))} aria-label="Anterior">
            ‹
          </button>
          <button type="button" className="iv-nav next" onClick={(e) => (e.stopPropagation(), go(1))} aria-label="Próxima">
            ›
          </button>
          <div className="iv-count">
            {index + 1} / {images.length}
          </div>
        </>
      )}
      {message.text && (
        <div className="iv-caption" onClick={(e) => e.stopPropagation()}>
          {message.text}
        </div>
      )}
    </div>
  );
}

/* ---------------- Uma mensagem ---------------- */
function Message({ m, mine, photo, people, myName, mentionsMe, selected, onSelect, onReply, onEdit, onDelete, onPin, onOpenImage, onJump, editing, onSaveEdit, onCancelEdit, setRef }) {
  const [draft, setDraft] = useState(m.text || "");
  const imgs = imagesOf(m);

  useEffect(() => {
    if (editing) setDraft(m.text || "");
  }, [editing, m.text]);

  const copy = () => navigator.clipboard?.writeText(m.text || "").catch(() => {});

  return (
    <div
      ref={setRef}
      className={"chat-msg" + (mine ? " mine" : "") + (selected ? " selected" : "") + (m.pinned ? " pinned" : "") + (mentionsMe ? " mentions-me" : "")}
      onClick={(e) => {
        if (e.target.closest("button, a, img, audio, textarea")) return;
        onSelect();
      }}
    >
      <div className="chat-bubble">
        <div className="chat-bubble-author">
          <Avatar src={photo} name={m.senderNickname} size={18} />
          <span>{m.senderNickname}</span>
          <time>{timeOf(m)}</time>
          {m.pinned && (
            <span className="chat-pin-tag" title="Mensagem fixada">
              <Icon name="pin" size={12} />
            </span>
          )}
        </div>

        {m.replyTo && (
          <button type="button" className="chat-quote" onClick={() => onJump(m.replyTo.id)}>
            <b>{m.replyTo.nickname}</b>
            <span>{m.replyTo.preview}</span>
          </button>
        )}

        {imgs.length > 0 && (
          <div className={"chat-imgs n" + Math.min(imgs.length, 4)}>
            {imgs.slice(0, 4).map((url, i) => (
              <button type="button" key={url + i} className="chat-img-btn" onClick={() => onOpenImage(m, imgs, i)}>
                <img src={url} alt="Imagem enviada" loading="lazy" />
                {i === 3 && imgs.length > 4 && <span className="chat-img-more">+{imgs.length - 4}</span>}
              </button>
            ))}
          </div>
        )}

        {m.files?.length > 0 && (
          <div className="chat-files">
            {m.files.map((f, i) => (
              <FileCard key={f.url + i} file={f} />
            ))}
          </div>
        )}

        {m.audio?.url && (
          <div className="chat-audio">
            <Icon name="mic" size={16} />
            <audio controls preload="metadata" src={m.audio.url} />
          </div>
        )}

        {editing ? (
          <div className="chat-edit">
            <textarea
              autoFocus
              rows={2}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSaveEdit(draft);
                }
                if (e.key === "Escape") onCancelEdit();
              }}
            />
            <div className="chat-edit-actions">
              <span className="hint">Enter salva · Esc cancela</span>
              <button type="button" className="btn-link" onClick={onCancelEdit}>
                cancelar
              </button>
              <button type="button" className="btn-link" onClick={() => onSaveEdit(draft)}>
                salvar
              </button>
            </div>
          </div>
        ) : m.game ? (
          <GameResultCard game={m.game} />
        ) : (
          m.text && (
            <div className="chat-bubble-text">
              <MessageText text={m.text} people={people} myName={myName} />
              {m.edited && <span className="chat-edited"> (editada)</span>}
            </div>
          )
        )}
      </div>

      {!editing && (
        <div className="chat-actions" role="toolbar" aria-label="Ações da mensagem">
          <button type="button" onClick={() => onReply(m)} title="Responder" aria-label="Responder">
            <Icon name="reply" size={16} />
          </button>
          {mine && !m.game && (
            <button type="button" onClick={() => onEdit(m)} title="Editar" aria-label="Editar">
              <Icon name="edit" size={16} />
            </button>
          )}
          <button
            type="button"
            className={m.pinned ? "on" : ""}
            onClick={() => onPin(m)}
            title={m.pinned ? "Desafixar" : "Fixar"}
            aria-label={m.pinned ? "Desafixar" : "Fixar"}
          >
            <Icon name="pin" size={16} />
          </button>
          {m.text && !m.game && (
            <button type="button" onClick={copy} title="Copiar texto" aria-label="Copiar texto">
              <Icon name="copy" size={16} />
            </button>
          )}
          {mine && (
            <button type="button" className="danger" onClick={() => onDelete(m)} title="Excluir" aria-label="Excluir">
              <Icon name="trash" size={16} />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ---------------- Canais de voz (as calls) ---------------- */
// Canal de voz = uma call (coleção "calls"). Fixo fica salvo; temporário some quando todos saem.

function VoiceChannel({ c, selected, live, speakingIds, mySessionId, onOpen, onDelete }) {
  const members = useVoiceMembers(c.id);
  return (
    <div className={"chat-voice" + (selected ? " active" : "") + (live ? " live" : "")}>
      <div className="chat-channel">
        <button onClick={() => onOpen(c)} title={live ? "Abrir a call" : "Entrar no canal de voz"}>
          <Icon name="volume" size={15} />
          <span className="chat-channel-name">{c.name}</span>
          {!c.fixed && <span className="chat-voice-tag">temp.</span>}
          {members.length > 0 && <span className="chat-voice-count">{members.length}</span>}
        </button>
        <button className="chat-channel-del" onClick={() => onDelete(c)} title="Excluir canal de voz" aria-label={`Excluir ${c.name}`}>
          <Icon name="close" size={13} />
        </button>
      </div>
      {members.length > 0 && (
        <div className="chat-voice-members">
          {members.map((m) => {
            const talking = live && speakingIds.has(m.id === mySessionId ? "me" : m.id);
            return (
              <div key={m.id} className={"chat-voice-member" + (talking ? " speaking" : "")}>
                <Avatar src={m.photoURL} name={m.nickname} size={20} />
                <span>{m.nickname}</span>
                <span className="chat-voice-icons">
                  {(m.screenOn || m.screen2On) && <span title="Transmitindo a tela">🖥️</span>}
                  {m.camOn && <span title="Câmera ligada">🎥</span>}
                  {!m.micOn && <span title="Microfone desligado">🔇</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Painel de um canal de voz em que você ainda não entrou.
function VoiceLobby({ c, onJoin, error }) {
  const members = useVoiceMembers(c.id);
  return (
    <div className="voice-lobby">
      <div className="voice-lobby-icon">
        <Icon name="volume" size={34} />
      </div>
      <h3>{c.name}</h3>
      <p className="muted">
        {members.length === 0
          ? "Ninguém aqui ainda."
          : `${members.length} ${members.length === 1 ? "pessoa" : "pessoas"} na call: ${members.map((m) => m.nickname).join(", ")}`}
      </p>
      <p className="hint">{c.fixed ? "Canal fixo — fica salvo na lista." : "Canal temporário — some quando todos saem."}</p>
      {error && <p className="auth-error">{error}</p>}
      <button className="btn btn-gradient" onClick={() => onJoin(c)}>
        Entrar na call
      </button>
    </div>
  );
}

/* ---------------- Aba Chat ---------------- */
export default function Chat() {
  const { data: categories } = useCollection("channelCategories", "createdAt", "asc");
  const { data: channels } = useCollection("channels", "createdAt", "asc");
  const { data: allMessages } = useCollection("chatMessages", "createdAt", "asc");
  const { data: users } = useCollection("users", "createdAt", "asc");
  const { data: calls, loading: callsLoading } = useCollection("calls", "createdAt", "asc");
  const { user, profile } = useAuth();
  const call = useCall();
  const location = useLocation();
  const navigate = useNavigate();
  const photos = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.photoURL])), [users]);
  const people = useMemo(() => users.filter((u) => u.nickname).map((u) => ({ id: u.id, nickname: u.nickname, photoURL: u.photoURL })), [users]);
  const myName = profile?.nickname || "";

  const [activeChannel, setActiveChannel] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  // No computador: lista de canais recolhida enquanto a call está aberta (para a call ocupar a tela).
  const [channelsHidden, setChannelsHidden] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState(null); // string quando criando
  const [newChannelFor, setNewChannelFor] = useState(null); // categoryId quando criando
  const [newChannelName, setNewChannelName] = useState("");
  const [newChannelType, setNewChannelType] = useState("text"); // "text" | "voice"
  const [newChannelTemp, setNewChannelTemp] = useState(false); // canal de voz temporário
  const [voiceId, setVoiceId] = useState(null); // canal de voz aberto na área principal

  // Caixa de mensagem
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState([]); // [{ id, file, url }]
  const [voice, setVoice] = useState(null); // { file, url, duration } gravado e ainda não enviado
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const recorder = useRecorder();

  // Mensagens
  const [selectedId, setSelectedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [showPinned, setShowPinned] = useState(false);
  const [flashId, setFlashId] = useState(null);

  const bottomRef = useRef(null);
  const shellRef = useRef(null);
  const listRef = useRef(null); // a lista de mensagens (só ela rola)

  // Rola a lista de mensagens até o fim, sem mexer na página.
  const scrollListToEnd = (smooth) => {
    const c = listRef.current;
    if (c) c.scrollTo({ top: c.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  };

  // A página atrás do chat não rola (no celular aparecia uma segunda barra de rolagem).
  useEffect(() => {
    document.documentElement.classList.add("chat-open");
    return () => document.documentElement.classList.remove("chat-open");
  }, []);

  // Celular: quando o teclado abre, o chat encolhe para a caixa de mensagem ficar logo acima dele
  // (o Safari do iPhone não faz isso sozinho).
  useEffect(() => {
    const vv = window.visualViewport;
    const el = shellRef.current;
    if (!vv || !el) return undefined;
    const update = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      el.style.setProperty("--kb", kb > 80 ? `${Math.round(kb)}px` : "0px");
      if (kb > 80) scrollListToEnd(false);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const msgRefs = useRef(new Map());

  // Veio de uma notificação: /chat?c=<canal de texto> ou /chat?v=<canal de voz>.
  const linkTarget = useRef(new URLSearchParams(location.search));
  useEffect(() => {
    const params = linkTarget.current;
    const c = params.get("c");
    const v = params.get("v");
    if (c && channels.length) {
      const ch = channels.find((x) => x.id === c);
      if (ch) {
        setActiveChannel(ch);
        setShowSidebar(false);
      }
      params.delete("c");
    }
    if (v && !callsLoading) {
      if (calls.find((x) => x.id === v)) {
        setVoiceId(v);
        setShowSidebar(false);
      }
      params.delete("v");
    }
    if ((c || v) && !params.get("c") && !params.get("v") && location.search) navigate(location.pathname, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, calls, callsLoading]);

  useEffect(() => {
    if (!activeChannel && channels.length > 0) setActiveChannel(channels[0]);
  }, [channels, activeChannel]);

  useEffect(() => {
    ensureCasinoChannel();
  }, []);
  const inCasino = !voiceId && isCasinoChannel(activeChannel);

  const messages = useMemo(
    () => allMessages.filter((m) => m.channelId === activeChannel?.id),
    [allMessages, activeChannel]
  );
  const pinned = useMemo(() => messages.filter((m) => m.pinned), [messages]);

  /* ----- não lidas: até onde cada pessoa já leu em cada canal (chatReads/{uid}) ----- */
  const [reads, setReads] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, "chatReads", user.uid),
      (snap) => {
        if (snap.exists()) setReads(snap.data());
        else {
          // Primeira vez: só conta como "não lida" o que chegar daqui pra frente.
          const first = { __since: Date.now() };
          setReads(first);
          setDoc(doc(db, "chatReads", user.uid), first, { merge: true }).catch(() => {});
        }
      },
      () => setReads({ __since: Date.now() })
    );
  }, [user]);

  const unread = useMemo(() => {
    const out = {};
    if (!reads) return out;
    for (const m of allMessages) {
      if (m.senderId === user.uid) continue;
      const seen = Math.max(reads[m.channelId] || 0, reads.__since || 0);
      if (msOf(m) <= seen) continue;
      const o = (out[m.channelId] ||= { count: 0, mention: false });
      o.count += 1;
      if (m.mentions?.includes(user.uid)) o.mention = true;
    }
    return out;
  }, [allMessages, reads, user.uid]);

  // Marca o canal aberto como lido (quando a tela está visível).
  useEffect(() => {
    if (!activeChannel || voiceId || !reads) return undefined;
    const mark = () => {
      if (document.visibilityState !== "visible") return;
      if (!unread[activeChannel.id] && reads[activeChannel.id]) return;
      setDoc(doc(db, "chatReads", user.uid), { [activeChannel.id]: Date.now() }, { merge: true }).catch(() => {});
    };
    mark();
    document.addEventListener("visibilitychange", mark);
    return () => document.removeEventListener("visibilitychange", mark);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeChannel?.id, voiceId, messages.length, !!reads]);

  /* ----- busca no canal ----- */
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const shownMessages = useMemo(() => {
    const q = searchQ.trim().toLowerCase();
    if (!searchOpen || !q) return messages;
    return messages.filter((m) =>
      [m.text, m.senderNickname, ...(m.files || []).map((f) => f.name)].join(" ").toLowerCase().includes(q)
    );
  }, [messages, searchOpen, searchQ]);

  /* ----- "fulano está digitando…" (typing/{canal}) ----- */
  // Quem digita grava um sinal a cada ~2 s. Quem lê anota QUANDO RECEBEU cada sinal, pelo
  // próprio relógio, em vez de comparar com o relógio de quem digita: os relógios de celular e
  // computador costumam estar alguns segundos diferentes, e isso fazia o aviso não aparecer.
  const TYPING_SHOW_MS = 5000;
  const [typingSeen, setTypingSeen] = useState({}); // uid -> { name, at (do sinal), receivedAt (meu relógio) }
  const [, setTypingTick] = useState(0);
  useEffect(() => {
    if (!activeChannel || voiceId) return undefined;
    setTypingSeen({});
    let first = true;
    return onSnapshot(
      doc(db, "typing", activeChannel.id),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        const now = Date.now();
        setTypingSeen((prev) => {
          const next = {};
          for (const [uid, v] of Object.entries(data)) {
            if (uid === user.uid || !v || !v.at) continue;
            const old = prev[uid];
            if (old && old.at === v.at) {
              next[uid] = old; // mesmo sinal de antes: mantém a hora em que chegou
            } else if (first && Math.abs(now - v.at) > 60000) {
              continue; // sinal antigo, de alguém que fechou o app no meio da digitação
            } else {
              next[uid] = { name: v.name || "Alguém", at: v.at, receivedAt: now };
            }
          }
          first = false;
          return next;
        });
      },
      () => {}
    );
  }, [activeChannel?.id, voiceId, user.uid]);
  useEffect(() => {
    const i = setInterval(() => setTypingTick((n) => n + 1), 1000);
    return () => clearInterval(i);
  }, []);
  const typingNames = Object.values(typingSeen)
    .filter((v) => Date.now() - v.receivedAt < TYPING_SHOW_MS)
    .map((v) => v.name);

  const lastTypingWrite = useRef(0);
  const typingChannel = useRef(null);
  function signalTyping(value) {
    if (!activeChannel) return;
    const now = Date.now();
    if (!value.trim()) return clearTyping();
    if (now - lastTypingWrite.current < 2000) return;
    lastTypingWrite.current = now;
    typingChannel.current = activeChannel.id;
    setDoc(doc(db, "typing", activeChannel.id), { [user.uid]: { name: myName || "Alguém", at: now } }, { merge: true }).catch(() => {});
  }
  function clearTyping() {
    const ch = typingChannel.current;
    if (!ch || !lastTypingWrite.current) return;
    lastTypingWrite.current = 0;
    typingChannel.current = null;
    updateDoc(doc(db, "typing", ch), { [user.uid]: deleteField() }).catch(() => {});
  }
  // Trocou de canal ou saiu do chat: some o "digitando" de quem estava escrevendo.
  useEffect(
    () => () => {
      clearTyping();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activeChannel?.id]
  );

  /* ----- autocompletar de @menção ----- */
  const [mentionQuery, setMentionQuery] = useState(null); // texto depois do @ (null = fechado)
  const [mentionIndex, setMentionIndex] = useState(0);
  const mentionOptions = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return people.filter((p) => p.id !== user.uid && p.nickname.toLowerCase().includes(q)).slice(0, 6);
  }, [mentionQuery, people, user.uid]);
  function updateMentionQuery(value, caret) {
    const before = value.slice(0, caret);
    const mt = before.match(/(^|\s)@([^\s@]{0,30})$/);
    setMentionQuery(mt ? mt[2] : null);
    setMentionIndex(0);
  }
  function pickMention(p) {
    const el = inputRef.current;
    const caret = el ? el.selectionStart : text.length;
    const before = text.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${p.nickname} `);
    const next = before + text.slice(caret);
    setText(next);
    setMentionQuery(null);
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(before.length, before.length);
    });
  }

  // Ao abrir um canal vai direto para o fim; mensagem nova chega rolando suave.
  const lastChannel = useRef(null);
  useEffect(() => {
    const changed = lastChannel.current !== activeChannel?.id;
    lastChannel.current = activeChannel?.id;
    scrollListToEnd(!changed);
    // depois que imagens carregarem, garante o fim
    if (changed) setTimeout(() => scrollListToEnd(false), 350);
  }, [messages.length, activeChannel?.id]);

  // Trocar de canal limpa o que estava em andamento.
  useEffect(() => {
    setReplyTo(null);
    setEditingId(null);
    setSelectedId(null);
    setShowPinned(false);
  }, [activeChannel?.id]);

  // Libera as pré-visualizações locais ao sair.
  useEffect(
    () => () => {
      attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /* ----- anexos ----- */
  function addFiles(list) {
    const all = [...list];
    const ok = all.filter((f) => isImageFile(f) || isDocFile(f));
    setChatError("");
    if (!ok.length) return setChatError("Esse tipo de arquivo não é aceito. Envie imagens, PDF, Word, Excel, PowerPoint, TXT ou ZIP.");
    const room = MAX_ATTACH - attachments.length;
    if (room <= 0) return setChatError(`No máximo ${MAX_ATTACH} anexos por mensagem.`);
    const tooBig = ok.find((f) => f.size > (isImageFile(f) ? MAX_IMAGE_MB : MAX_FILE_MB) * 1024 * 1024);
    if (tooBig)
      return setChatError(
        `"${tooBig.name}" é grande demais (máximo ${isImageFile(tooBig) ? MAX_IMAGE_MB : MAX_FILE_MB} MB).`
      );
    const next = ok.slice(0, room).map((file) => ({
      id: Math.random().toString(36).slice(2),
      file,
      kind: isImageFile(file) ? "image" : "file",
      url: isImageFile(file) ? URL.createObjectURL(file) : "",
    }));
    setAttachments((a) => [...a, ...next]);
    if (ok.length > room) setChatError(`Só couberam ${room} — o máximo é ${MAX_ATTACH} anexos por mensagem.`);
    else if (ok.length < all.length) setChatError("Alguns arquivos foram ignorados porque o tipo não é aceito.");
    inputRef.current?.focus();
  }
  function removeAttachment(id) {
    setAttachments((a) => {
      const gone = a.find((x) => x.id === id);
      if (gone?.url) URL.revokeObjectURL(gone.url);
      return a.filter((x) => x.id !== id);
    });
  }

  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }
  function onDrop(e) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])];
    if (files.length) addFiles(files);
  }

  /* ----- áudio ----- */
  async function startRecording() {
    setChatError("");
    try {
      await recorder.start();
    } catch (e) {
      console.warn(e);
      setChatError("Não consegui acessar o microfone. Verifique a permissão do navegador.");
    }
  }
  async function stopRecording() {
    const result = await recorder.stop();
    if (result) setVoice(result);
  }
  function discardVoice() {
    if (voice) URL.revokeObjectURL(voice.url);
    setVoice(null);
  }

  /* ----- enviar ----- */
  async function handleSend(e) {
    e?.preventDefault();
    if (!activeChannel || sending) return;
    const body = text.trim();
    if (!body && !attachments.length && !voice) return;
    setSending(true);
    setChatError("");
    try {
      const images = [];
      const files = [];
      for (const a of attachments) {
        if (a.kind === "image") {
          const ready = await shrinkImage(a.file);
          images.push((await uploadImage(ready, "landora/chat")).url);
        } else {
          const up = await uploadFile(a.file, "landora/chat-files", "raw");
          files.push({ url: up.url, name: a.file.name, size: a.file.size, type: a.file.type || "" });
        }
      }
      const mentions = findMentions(body, people).filter((id) => id !== user.uid);
      let audio = null;
      if (voice) {
        const up = await uploadFile(voice.file, "landora/chat-audio");
        audio = { url: up.url, duration: Math.round(up.duration || voice.duration) };
      }
      await addDoc(collection(db, "chatMessages"), {
        channelId: activeChannel.id,
        text: body,
        ...(images.length ? { images } : {}),
        ...(files.length ? { files } : {}),
        ...(audio ? { audio } : {}),
        ...(replyTo ? { replyTo: { id: replyTo.id, nickname: replyTo.senderNickname, preview: previewOf(replyTo) } } : {}),
        ...(mentions.length ? { mentions } : {}),
        senderId: user.uid,
        senderNickname: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });
      const preview =
        body ||
        (images.length ? `📷 ${images.length > 1 ? `${images.length} imagens` : "Imagem"}` : files.length ? `📎 ${files[0].name}` : audio ? "🎤 Mensagem de voz" : "");
      // Quem foi @mencionado recebe um aviso próprio; os outros, o aviso normal do canal.
      if (mentions.length) {
        notify({
          kind: "mention",
          title: `${profile?.nickname || "Alguém"} mencionou você em #${activeChannel.name}`,
          body: preview,
          url: `/chat?c=${activeChannel.id}`,
          tag: `mention-${activeChannel.id}`,
          to: mentions,
        });
      }
      notify({
        kind: "chat",
        title: `${profile?.nickname || "Alguém"} em #${activeChannel.name}`,
        body: preview,
        url: `/chat?c=${activeChannel.id}`,
        tag: `chat-${activeChannel.id}`,
        exclude: mentions,
      });
      clearTyping();
      setMentionQuery(null);
      attachments.forEach((a) => a.url && URL.revokeObjectURL(a.url));
      setAttachments([]);
      discardVoice();
      setText("");
      setReplyTo(null);
      if (inputRef.current) inputRef.current.style.height = "auto";
      inputRef.current?.focus();
    } catch (err) {
      console.error(err);
      setChatError(err.message || "Não foi possível enviar a mensagem.");
    } finally {
      setSending(false);
    }
  }

  /* ----- ações nas mensagens ----- */
  function startReply(m) {
    setReplyTo(m);
    setSelectedId(null);
    inputRef.current?.focus();
  }
  async function saveEdit(m, value) {
    const v = value.trim();
    setEditingId(null);
    if (v === (m.text || "")) return;
    if (!v && !imagesOf(m).length && !m.files?.length && !m.audio) return setChatError("A mensagem não pode ficar vazia. Use excluir.");
    await updateDoc(doc(db, "chatMessages", m.id), { text: v, edited: true, editedAt: serverTimestamp() });
  }
  async function removeMessage(m) {
    if (!confirm("Excluir esta mensagem?")) return;
    setSelectedId(null);
    await deleteDoc(doc(db, "chatMessages", m.id));
  }
  async function togglePin(m) {
    setSelectedId(null);
    await updateDoc(doc(db, "chatMessages", m.id), {
      pinned: !m.pinned,
      pinnedAt: m.pinned ? null : serverTimestamp(),
      pinnedBy: m.pinned ? null : profile?.nickname || "",
    });
  }
  function jumpTo(id) {
    const el = msgRefs.current.get(id);
    if (!el) return setChatError("Essa mensagem não existe mais.");
    setShowPinned(false);
    const c = listRef.current;
    if (c) {
      const top = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop;
      c.scrollTo({ top: top - c.clientHeight / 2 + el.offsetHeight / 2, behavior: "smooth" });
    }
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1600);
  }

  /* ----- canais de voz ----- */
  const voiceChannel = voiceId ? calls.find((c) => c.id === voiceId) : null;
  const inThisCall = !!voiceChannel && call.active?.id === voiceChannel.id;

  // Canal de voz sumiu (temporário em que todos saíram, ou excluído): volta para o texto.
  useEffect(() => {
    if (voiceId && !callsLoading && !calls.find((c) => c.id === voiceId) && call.active?.id !== voiceId) setVoiceId(null);
  }, [voiceId, calls, callsLoading, call.active]);

  // Ao abrir a call, recolhe a lista de canais; ao sair dela, mostra de novo.
  useEffect(() => {
    setChannelsHidden(inThisCall);
  }, [inThisCall]);

  // Esconde a barrinha da call enquanto a call está aberta aqui.
  useEffect(() => {
    call.setCallVisible(inThisCall);
    return () => call.setCallVisible(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inThisCall]);

  // Veio pela barrinha ("Abrir"): mostra a call em andamento.
  useEffect(() => {
    if (location.state?.openCall) {
      if (call.active) {
        setVoiceId(call.active.id);
        setShowSidebar(false);
      }
      navigate(location.pathname, { replace: true, state: {} });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  function openVoice(c) {
    setVoiceId(c.id);
    setShowSidebar(false);
    if (call.active?.id !== c.id) call.join({ id: c.id, name: c.name, fixed: !!c.fixed });
  }
  function openText(ch) {
    setActiveChannel(ch);
    setVoiceId(null);
    setShowSidebar(false);
  }
  async function deleteVoice(c) {
    if (!confirm(`Excluir o canal de voz "${c.name}"?`)) return;
    if (call.active?.id === c.id) await call.leave();
    if (voiceId === c.id) setVoiceId(null);
    const [parts, sigs] = await Promise.all([
      getDocs(collection(db, "calls", c.id, "participants")),
      getDocs(collection(db, "calls", c.id, "signals")),
    ]);
    await Promise.all([...parts.docs, ...sigs.docs].map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "calls", c.id));
  }

  /* ----- canais ----- */
  async function createCategory(e) {
    e.preventDefault();
    if (!newCategoryName?.trim()) return;
    await addDoc(collection(db, "channelCategories"), { name: newCategoryName.trim(), createdAt: serverTimestamp() });
    setNewCategoryName(null);
  }

  function startNewChannel(categoryId) {
    setNewChannelFor(categoryId);
    setNewChannelName("");
    setNewChannelType("text");
    setNewChannelTemp(false);
  }

  async function createChannel(e, categoryId) {
    e.preventDefault();
    const name = newChannelName.trim();
    if (!name) return;
    setNewChannelName("");
    setNewChannelFor(null);
    if (newChannelType === "voice") {
      const fixed = !newChannelTemp;
      const ref = await addDoc(collection(db, "calls"), {
        name,
        fixed,
        categoryId: categoryId || "",
        createdBy: user.uid,
        createdByNickname: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });
      openVoice({ id: ref.id, name, fixed });
      return;
    }
    const ref = await addDoc(collection(db, "channels"), { name, categoryId: categoryId || "", createdAt: serverTimestamp() });
    openText({ id: ref.id, name, categoryId });
  }

  async function deleteChannel(ch) {
    if (!confirm(`Excluir o canal #${ch.name}? As mensagens ficarão órfãs mas não serão exibidas.`)) return;
    await deleteDoc(doc(db, "channels", ch.id));
    if (activeChannel?.id === ch.id) setActiveChannel(null);
  }

  const catIds = new Set(categories.map((c) => c.id));
  const uncategorized = channels.filter((c) => !c.categoryId || !catIds.has(c.categoryId));
  const uncategorizedVoice = calls.filter((c) => !c.categoryId || !catIds.has(c.categoryId));
  const renderChannel = (ch) => (
    <div key={ch.id} className={"chat-channel" + (!voiceId && activeChannel?.id === ch.id ? " active" : "")}>
      <button onClick={() => openText(ch)}>
        {isCasinoChannel(ch) ? <span className="chat-casino-ico">🎰</span> : <Icon name="hash" size={15} />}
        <span className="chat-channel-name">{ch.name}</span>
        {unread[ch.id] && !(activeChannel?.id === ch.id && !voiceId) && (
          <span className={"chat-unread" + (unread[ch.id].mention ? " mention" : "")} title={`${unread[ch.id].count} não lida(s)`}>
            {unread[ch.id].mention ? "@" : ""}
            {unread[ch.id].count > 99 ? "99+" : unread[ch.id].count}
          </span>
        )}
      </button>
      {!isCasinoChannel(ch) && (
        <button className="chat-channel-del" onClick={() => deleteChannel(ch)} title="Excluir canal" aria-label={`Excluir #${ch.name}`}>
          <Icon name="close" size={13} />
        </button>
      )}
    </div>
  );

  const renderVoice = (c) => (
    <VoiceChannel
      key={c.id}
      c={c}
      selected={voiceId === c.id}
      live={call.active?.id === c.id}
      speakingIds={call.speaking}
      mySessionId={call.session?.sessionId}
      onOpen={openVoice}
      onDelete={deleteVoice}
    />
  );

  const renderNewChannelForm = (categoryId) => (
    <form onSubmit={(e) => createChannel(e, categoryId)} className="chat-new-channel">
      <div className="chat-type-pick" role="radiogroup" aria-label="Tipo de canal">
        <button type="button" role="radio" aria-checked={newChannelType === "text"} className={newChannelType === "text" ? "sel" : ""} onClick={() => setNewChannelType("text")}>
          <Icon name="hash" size={14} /> Texto
        </button>
        <button type="button" role="radio" aria-checked={newChannelType === "voice"} className={newChannelType === "voice" ? "sel" : ""} onClick={() => setNewChannelType("voice")}>
          <Icon name="volume" size={14} /> Voz
        </button>
      </div>
      <input
        autoFocus
        value={newChannelName}
        onChange={(e) => setNewChannelName(e.target.value)}
        placeholder={newChannelType === "voice" ? "ex: Reunião de vendas" : "nome-do-canal"}
      />
      {newChannelType === "voice" && (
        <label className="chat-temp-check">
          <input type="checkbox" checked={newChannelTemp} onChange={(e) => setNewChannelTemp(e.target.checked)} />
          Temporário <span className="hint">(some quando todos saem)</span>
        </label>
      )}
      <div className="chat-new-actions">
        <button type="button" className="btn-link" onClick={() => setNewChannelFor(null)}>
          cancelar
        </button>
        <button className="btn-link" type="submit" disabled={!newChannelName.trim()}>
          {newChannelType === "voice" ? "criar e entrar" : "criar"}
        </button>
      </div>
    </form>
  );

  const canSend = !sending && !recorder.recording && (text.trim() || attachments.length || voice);

  return (
    <div ref={shellRef} className={"chat-shell" + (inThisCall ? " in-call" : "") + (channelsHidden ? " channels-hidden" : "")}>
      <aside className={"chat-sidebar" + (showSidebar ? " show" : "")}>
        <div className="chat-sidebar-head">
          <span>Canais</span>
          <button className="btn-link" onClick={() => setNewCategoryName("")}>
            + categoria
          </button>
        </div>

        {newCategoryName !== null && (
          <form onSubmit={createCategory} className="chat-inline-form">
            <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="nome da categoria" />
            <button className="btn-link" type="submit">
              criar
            </button>
          </form>
        )}

        {categories.map((cat) => (
          <div key={cat.id} className="chat-category">
            <div className="chat-category-head">
              <span>{cat.name}</span>
              <button className="chat-category-add" onClick={() => startNewChannel(cat.id)} title="Novo canal" aria-label="Novo canal">
                <Icon name="plus" size={14} />
              </button>
            </div>
            {newChannelFor === cat.id && renderNewChannelForm(cat.id)}
            <div className="chat-category-list">
              {channels.filter((c) => c.categoryId === cat.id).map(renderChannel)}
              {calls.filter((c) => c.categoryId === cat.id).map(renderVoice)}
            </div>
          </div>
        ))}

        {(uncategorized.length > 0 || uncategorizedVoice.length > 0 || newChannelFor === "none") && (
          <div className="chat-category">
            <div className="chat-category-head">
              <span>Sem categoria</span>
              <button className="chat-category-add" onClick={() => startNewChannel("none")} title="Novo canal" aria-label="Novo canal">
                <Icon name="plus" size={14} />
              </button>
            </div>
            {newChannelFor === "none" && renderNewChannelForm("")}
            <div className="chat-category-list">
              {uncategorized.map(renderChannel)}
              {uncategorizedVoice.map(renderVoice)}
            </div>
          </div>
        )}

        {categories.length === 0 && uncategorizedVoice.length === 0 && uncategorized.length === 0 && (
          <p className="muted empty">Crie uma categoria pra começar.</p>
        )}
      </aside>

      <section
        className={"chat-main" + (!showSidebar ? " show" : "")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={voiceId ? (e) => e.preventDefault() : onDrop}
      >
        <div className="chat-main-head">
          <button
            type="button"
            className="chat-channels-toggle"
            onClick={() => setChannelsHidden((v) => !v)}
            title={channelsHidden ? "Mostrar canais" : "Recolher canais"}
            aria-label={channelsHidden ? "Mostrar canais" : "Recolher canais"}
            aria-expanded={!channelsHidden}
          >
            <Icon name="chevron" size={16} strokeWidth={2.2} />
          </button>
          <button className="btn-link chat-back" onClick={() => setShowSidebar(true)}>
            ‹ canais
          </button>
          <span className="chat-main-title">
            {voiceId ? `🔊 ${voiceChannel?.name || call.active?.name || "Canal de voz"}` : activeChannel ? `# ${activeChannel.name}` : "Selecione um canal"}
          </span>
          {!voiceId && activeChannel && (
            <button
              type="button"
              className={"chat-head-btn" + (searchOpen ? " on" : "")}
              onClick={() => {
                setSearchOpen((v) => !v);
                setSearchQ("");
              }}
              title="Buscar mensagens"
              aria-label="Buscar mensagens"
            >
              <Icon name="search" size={16} />
            </button>
          )}
          {!voiceId && pinned.length > 0 && (
            <button
              type="button"
              className={"chat-pins-btn" + (showPinned ? " on" : "")}
              onClick={() => setShowPinned((v) => !v)}
              title="Mensagens fixadas"
            >
              <Icon name="pin" size={15} /> {pinned.length}
            </button>
          )}
        </div>

        {voiceId ? (
          inThisCall || call.active?.id === voiceId ? (
            <div className="chat-call">
              <InCall />
            </div>
          ) : voiceChannel ? (
            <VoiceLobby c={voiceChannel} onJoin={openVoice} error={call.error} />
          ) : (
            <div className="call-loading">
              <div className="spinner" />
            </div>
          )
        ) : (
        <>
        {searchOpen && (
          <div className="chat-search">
            <Icon name="search" size={15} />
            <input
              autoFocus
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (setSearchOpen(false), setSearchQ(""))}
              placeholder={`Buscar em #${activeChannel?.name || ""}`}
            />
            {searchQ.trim() && (
              <span className="chat-search-count">
                {shownMessages.length} {shownMessages.length === 1 ? "resultado" : "resultados"}
              </span>
            )}
            <button type="button" onClick={() => (setSearchOpen(false), setSearchQ(""))} aria-label="Fechar busca">
              <Icon name="close" size={15} />
            </button>
          </div>
        )}
        {showPinned && (
          <div className="chat-pins">
            <div className="chat-pins-head">
              <b>Fixadas em #{activeChannel?.name}</b>
              <button type="button" className="btn-link" onClick={() => setShowPinned(false)}>
                fechar
              </button>
            </div>
            {pinned.map((m) => (
              <button type="button" key={m.id} className="chat-pin-item" onClick={() => jumpTo(m.id)}>
                <b>{m.senderNickname}</b>
                <span>{previewOf(m)}</span>
              </button>
            ))}
          </div>
        )}

        {inCasino && <CasinoBar />}
        <div ref={listRef} className="chat-messages" onClick={(e) => e.target === e.currentTarget && setSelectedId(null)}>
          {shownMessages.map((m) => (
            <Message
              key={m.id}
              m={m}
              people={people}
              myName={myName}
              mentionsMe={m.mentions?.includes(user.uid)}
              mine={m.senderId === user.uid}
              photo={photos[m.senderId]}
              selected={selectedId === m.id || flashId === m.id}
              onSelect={() => setSelectedId((s) => (s === m.id ? null : m.id))}
              onReply={startReply}
              onEdit={(msg) => {
                setEditingId(msg.id);
                setSelectedId(null);
              }}
              onDelete={removeMessage}
              onPin={togglePin}
              onOpenImage={(msg, images, index) => setViewer({ message: msg, images, index })}
              onJump={jumpTo}
              editing={editingId === m.id}
              onSaveEdit={(v) => saveEdit(m, v)}
              onCancelEdit={() => setEditingId(null)}
              setRef={(el) => (el ? msgRefs.current.set(m.id, el) : msgRefs.current.delete(m.id))}
            />
          ))}
          {activeChannel && messages.length === 0 && <p className="muted empty">Nenhuma mensagem em #{activeChannel.name} ainda.</p>}
          {searchOpen && searchQ.trim() && messages.length > 0 && shownMessages.length === 0 && (
            <p className="muted empty">Nada encontrado para “{searchQ.trim()}”.</p>
          )}
          <div ref={bottomRef} />
        </div>

        {activeChannel && (
          <div className="chat-composer">
            {typingNames.length > 0 && (
              <div className="chat-typing" aria-live="polite">
                <span className="chat-typing-dots">
                  <i />
                  <i />
                  <i />
                </span>
                {typingNames.length === 1 ? `${typingNames[0]} está digitando…` : `${typingNames.join(", ")} estão digitando…`}
              </div>
            )}
            {chatError && <p className="auth-error chat-error">{chatError}</p>}
            {mentionOptions.length > 0 && (
              <div className="chat-mention-list" role="listbox" aria-label="Mencionar alguém">
                {mentionOptions.map((p, i) => (
                  <button
                    type="button"
                    key={p.id}
                    role="option"
                    aria-selected={i === mentionIndex}
                    className={i === mentionIndex ? "sel" : ""}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      pickMention(p);
                    }}
                  >
                    <Avatar src={p.photoURL} name={p.nickname} size={22} />
                    <span>{p.nickname}</span>
                  </button>
                ))}
              </div>
            )}

            {replyTo && (
              <div className="chat-replying">
                <Icon name="reply" size={15} />
                <div>
                  <b>Respondendo {replyTo.senderNickname}</b>
                  <span>{previewOf(replyTo)}</span>
                </div>
                <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancelar resposta">
                  <Icon name="close" size={15} />
                </button>
              </div>
            )}

            {(attachments.length > 0 || voice) && (
              <div className="chat-attachments">
                {attachments.map((a) =>
                  a.kind === "image" ? (
                    <div key={a.id} className="chat-att">
                      <img src={a.url} alt="" />
                      <button type="button" onClick={() => removeAttachment(a.id)} disabled={sending} aria-label="Remover imagem">
                        <Icon name="close" size={13} strokeWidth={2.4} />
                      </button>
                    </div>
                  ) : (
                    <div key={a.id} className="chat-att-file">
                      <span className={"chat-file-icon " + fileKind(a.file.name).cls}>{fileKind(a.file.name).label}</span>
                      <span className="chat-file-info">
                        <b>{a.file.name}</b>
                        <span>{fileSize(a.file.size)}</span>
                      </span>
                      <button type="button" onClick={() => removeAttachment(a.id)} disabled={sending} aria-label={`Remover ${a.file.name}`}>
                        <Icon name="close" size={14} />
                      </button>
                    </div>
                  )
                )}
                {voice && (
                  <div className="chat-att-voice">
                    <Icon name="mic" size={16} />
                    <audio controls src={voice.url} />
                    <span>{mmss(voice.duration)}</span>
                    <button type="button" onClick={discardVoice} disabled={sending} aria-label="Descartar áudio">
                      <Icon name="trash" size={15} />
                    </button>
                  </div>
                )}
              </div>
            )}

            {recorder.recording ? (
              <div className="chat-form recording">
                <button type="button" className="chat-icon-btn" onClick={recorder.cancel} title="Descartar" aria-label="Descartar gravação">
                  <Icon name="trash" />
                </button>
                <div className="chat-rec">
                  <span className="chat-rec-dot" />
                  Gravando… {mmss(recorder.seconds)}
                </div>
                <button type="button" className="chat-send" onClick={stopRecording} title="Parar gravação" aria-label="Parar gravação">
                  <Icon name="stop" />
                </button>
              </div>
            ) : (
              <form onSubmit={handleSend} className="chat-form">
                <input
                  ref={fileRef}
                  type="file"
                  accept={"image/*," + DOC_ACCEPT}
                  multiple
                  hidden
                  onChange={(e) => {
                    addFiles(e.target.files || []);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="chat-icon-btn"
                  disabled={sending}
                  onClick={() => fileRef.current?.click()}
                  title="Anexar imagem ou arquivo — PDF, Word, Excel, ZIP… (ou cole / arraste para cá)"
                  aria-label="Anexar imagem ou arquivo"
                >
                  <Icon name="paperclip" />
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    signalTyping(e.target.value);
                    updateMentionQuery(e.target.value, e.target.selectionStart);
                    // Cresce conforme o texto (até um limite) e volta ao normal depois de enviar.
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                  }}
                  onPaste={onPaste}
                  onBlur={clearTyping}
                  onKeyDown={(e) => {
                    // Lista de @menção aberta: setas escolhem, Enter/Tab confirma, Esc fecha.
                    if (mentionOptions.length) {
                      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                        e.preventDefault();
                        const d = e.key === "ArrowDown" ? 1 : -1;
                        setMentionIndex((i) => (i + d + mentionOptions.length) % mentionOptions.length);
                        return;
                      }
                      if (e.key === "Enter" || e.key === "Tab") {
                        e.preventDefault();
                        pickMention(mentionOptions[mentionIndex] || mentionOptions[0]);
                        return;
                      }
                      if (e.key === "Escape") {
                        setMentionQuery(null);
                        return;
                      }
                    }
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                    if (e.key === "Escape" && replyTo) setReplyTo(null);
                  }}
                  placeholder={attachments.length || voice ? "Adicione uma legenda (opcional)…" : `Mensagem em #${activeChannel.name}`}
                />
                {CAN_RECORD && !text.trim() && !attachments.length && !voice ? (
                  <button type="button" className="chat-icon-btn" onClick={startRecording} title="Gravar áudio" aria-label="Gravar áudio">
                    <Icon name="mic" />
                  </button>
                ) : (
                  <button className="chat-send" type="submit" disabled={!canSend} title="Enviar" aria-label="Enviar">
                    {sending ? <span className="chat-spin" /> : <Icon name="send" size={18} />}
                  </button>
                )}
              </form>
            )}
          </div>
        )}
        </>
        )}
      </section>

      {viewer && <ImageViewer viewer={viewer} onClose={() => setViewer(null)} onReply={startReply} />}
    </div>
  );
}
