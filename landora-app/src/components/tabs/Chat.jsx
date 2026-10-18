import { useEffect, useMemo, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";
import Icon from "../Icons";
import { downloadUrl, uploadFile, uploadImage } from "../../lib/cloudinary";
import { shrinkImage } from "../../lib/image";
import { CAN_RECORD, useRecorder } from "../../lib/useRecorder";

// Mensagem no Firestore (chatMessages/{id}):
//   channelId, text, images: [url], audio: { url, duration },
//   replyTo: { id, nickname, preview }, edited, editedAt, pinned, pinnedAt, pinnedBy,
//   senderId, senderNickname, createdAt
// Mensagens antigas usam imageUrl (uma imagem só) — continuam aparecendo normalmente.

const MAX_IMAGES = 6;

const imagesOf = (m) => (m.images?.length ? m.images : m.imageUrl ? [m.imageUrl] : []);

function previewOf(m) {
  if (m.text) return m.text.length > 90 ? m.text.slice(0, 90) + "…" : m.text;
  if (imagesOf(m).length) return "📷 Imagem";
  if (m.audio) return "🎤 Áudio";
  return "Mensagem";
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
function Message({ m, mine, photo, selected, onSelect, onReply, onEdit, onDelete, onPin, onOpenImage, onJump, editing, onSaveEdit, onCancelEdit, setRef }) {
  const [draft, setDraft] = useState(m.text || "");
  const imgs = imagesOf(m);

  useEffect(() => {
    if (editing) setDraft(m.text || "");
  }, [editing, m.text]);

  const copy = () => navigator.clipboard?.writeText(m.text || "").catch(() => {});

  return (
    <div
      ref={setRef}
      className={"chat-msg" + (mine ? " mine" : "") + (selected ? " selected" : "") + (m.pinned ? " pinned" : "")}
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
        ) : (
          m.text && (
            <div className="chat-bubble-text">
              {m.text}
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
          {mine && (
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
          {m.text && (
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

/* ---------------- Aba Chat ---------------- */
export default function Chat() {
  const { data: categories } = useCollection("channelCategories", "createdAt", "asc");
  const { data: channels } = useCollection("channels", "createdAt", "asc");
  const { data: allMessages } = useCollection("chatMessages", "createdAt", "asc");
  const { data: users } = useCollection("users", "createdAt", "asc");
  const { user, profile } = useAuth();
  const photos = useMemo(() => Object.fromEntries(users.map((u) => [u.id, u.photoURL])), [users]);

  const [activeChannel, setActiveChannel] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [newCategoryName, setNewCategoryName] = useState(null); // string quando criando
  const [newChannelFor, setNewChannelFor] = useState(null); // categoryId quando criando
  const [newChannelName, setNewChannelName] = useState("");

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
  const fileRef = useRef(null);
  const inputRef = useRef(null);
  const msgRefs = useRef(new Map());

  useEffect(() => {
    if (!activeChannel && channels.length > 0) setActiveChannel(channels[0]);
  }, [channels, activeChannel]);

  const messages = useMemo(
    () => allMessages.filter((m) => m.channelId === activeChannel?.id),
    [allMessages, activeChannel]
  );
  const pinned = useMemo(() => messages.filter((m) => m.pinned), [messages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
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
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  /* ----- anexos ----- */
  function addFiles(files) {
    const imgs = [...files].filter((f) => f.type.startsWith("image/"));
    if (!imgs.length) return setChatError("Só dá para anexar imagens.");
    setChatError("");
    const room = MAX_IMAGES - attachments.length;
    if (room <= 0) return setChatError(`No máximo ${MAX_IMAGES} imagens por mensagem.`);
    const big = imgs.find((f) => f.size > 20 * 1024 * 1024);
    if (big) return setChatError("Imagem grande demais (máximo 20 MB).");
    const next = imgs.slice(0, room).map((file) => ({ id: Math.random().toString(36).slice(2), file, url: URL.createObjectURL(file) }));
    setAttachments((a) => [...a, ...next]);
    if (imgs.length > room) setChatError(`Só couberam ${room} — o máximo é ${MAX_IMAGES} imagens por mensagem.`);
    inputRef.current?.focus();
  }
  function removeAttachment(id) {
    setAttachments((a) => {
      const gone = a.find((x) => x.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return a.filter((x) => x.id !== id);
    });
  }

  function onPaste(e) {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) {
      e.preventDefault();
      addFiles(files);
    }
  }
  function onDrop(e) {
    e.preventDefault();
    const files = [...(e.dataTransfer?.files || [])].filter((f) => f.type.startsWith("image/"));
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
      for (const a of attachments) {
        const ready = await shrinkImage(a.file);
        images.push((await uploadImage(ready, "landora/chat")).url);
      }
      let audio = null;
      if (voice) {
        const up = await uploadFile(voice.file, "landora/chat-audio");
        audio = { url: up.url, duration: Math.round(up.duration || voice.duration) };
      }
      await addDoc(collection(db, "chatMessages"), {
        channelId: activeChannel.id,
        text: body,
        ...(images.length ? { images } : {}),
        ...(audio ? { audio } : {}),
        ...(replyTo ? { replyTo: { id: replyTo.id, nickname: replyTo.senderNickname, preview: previewOf(replyTo) } } : {}),
        senderId: user.uid,
        senderNickname: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });
      attachments.forEach((a) => URL.revokeObjectURL(a.url));
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
    if (!v && !imagesOf(m).length && !m.audio) return setChatError("A mensagem não pode ficar vazia. Use excluir.");
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
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlashId(id);
    setTimeout(() => setFlashId((f) => (f === id ? null : f)), 1600);
  }

  /* ----- canais ----- */
  async function createCategory(e) {
    e.preventDefault();
    if (!newCategoryName?.trim()) return;
    await addDoc(collection(db, "channelCategories"), { name: newCategoryName.trim(), createdAt: serverTimestamp() });
    setNewCategoryName(null);
  }

  async function createChannel(e, categoryId) {
    e.preventDefault();
    if (!newChannelName.trim()) return;
    const ref = await addDoc(collection(db, "channels"), { name: newChannelName.trim(), categoryId, createdAt: serverTimestamp() });
    setNewChannelName("");
    setNewChannelFor(null);
    setActiveChannel({ id: ref.id, name: newChannelName.trim(), categoryId });
    setShowSidebar(false);
  }

  async function deleteChannel(ch) {
    if (!confirm(`Excluir o canal #${ch.name}? As mensagens ficarão órfãs mas não serão exibidas.`)) return;
    await deleteDoc(doc(db, "channels", ch.id));
    if (activeChannel?.id === ch.id) setActiveChannel(null);
  }

  const uncategorized = channels.filter((c) => !c.categoryId || !categories.find((cat) => cat.id === c.categoryId));
  const renderChannel = (ch) => (
    <div key={ch.id} className={"chat-channel" + (activeChannel?.id === ch.id ? " active" : "")}>
      <button
        onClick={() => {
          setActiveChannel(ch);
          setShowSidebar(false);
        }}
      >
        <Icon name="hash" size={15} />
        <span className="chat-channel-name">{ch.name}</span>
      </button>
      <button className="chat-channel-del" onClick={() => deleteChannel(ch)} title="Excluir canal" aria-label={`Excluir #${ch.name}`}>
        <Icon name="close" size={13} />
      </button>
    </div>
  );

  const canSend = !sending && !recorder.recording && (text.trim() || attachments.length || voice);

  return (
    <div className="chat-shell">
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
              <button className="chat-category-add" onClick={() => setNewChannelFor(cat.id)} title="Novo canal" aria-label="Novo canal">
                <Icon name="plus" size={14} />
              </button>
            </div>
            {newChannelFor === cat.id && (
              <form onSubmit={(e) => createChannel(e, cat.id)} className="chat-inline-form">
                <input autoFocus value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="nome-do-canal" />
                <button className="btn-link" type="submit">
                  criar
                </button>
              </form>
            )}
            <div className="chat-category-list">{channels.filter((c) => c.categoryId === cat.id).map(renderChannel)}</div>
          </div>
        ))}

        {uncategorized.length > 0 && (
          <div className="chat-category">
            <div className="chat-category-head">
              <span>Sem categoria</span>
            </div>
            <div className="chat-category-list">{uncategorized.map(renderChannel)}</div>
          </div>
        )}

        {categories.length === 0 && <p className="muted empty">Crie uma categoria pra começar.</p>}
      </aside>

      <section
        className={"chat-main" + (!showSidebar ? " show" : "")}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
      >
        <div className="chat-main-head">
          <button className="btn-link chat-back" onClick={() => setShowSidebar(true)}>
            ‹ canais
          </button>
          <span className="chat-main-title">{activeChannel ? `# ${activeChannel.name}` : "Selecione um canal"}</span>
          {pinned.length > 0 && (
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

        <div className="chat-messages" onClick={(e) => e.target === e.currentTarget && setSelectedId(null)}>
          {messages.map((m) => (
            <Message
              key={m.id}
              m={m}
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
          <div ref={bottomRef} />
        </div>

        {activeChannel && (
          <div className="chat-composer">
            {chatError && <p className="auth-error chat-error">{chatError}</p>}

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
                {attachments.map((a) => (
                  <div key={a.id} className="chat-att">
                    <img src={a.url} alt="" />
                    <button type="button" onClick={() => removeAttachment(a.id)} disabled={sending} aria-label="Remover imagem">
                      <Icon name="close" size={13} strokeWidth={2.4} />
                    </button>
                  </div>
                ))}
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
                  accept="image/*"
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
                  title="Anexar imagem (ou cole com Ctrl+V / arraste para cá)"
                  aria-label="Anexar imagem"
                >
                  <Icon name="paperclip" />
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    // Cresce conforme o texto (até um limite) e volta ao normal depois de enviar.
                    e.target.style.height = "auto";
                    e.target.style.height = Math.min(e.target.scrollHeight, 140) + "px";
                  }}
                  onPaste={onPaste}
                  onKeyDown={(e) => {
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
      </section>

      {viewer && <ImageViewer viewer={viewer} onClose={() => setViewer(null)} onReply={startReply} />}
    </div>
  );
}
