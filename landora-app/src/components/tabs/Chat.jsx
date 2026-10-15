import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";
import { uploadImage } from "../../lib/cloudinary";
import { shrinkImage } from "../../lib/image";

export default function Chat() {
  const { data: categories } = useCollection("channelCategories", "createdAt", "asc");
  const { data: channels } = useCollection("channels", "createdAt", "asc");
  const { data: allMessages } = useCollection("chatMessages", "createdAt", "asc");
  const { data: users } = useCollection("users", "createdAt", "asc");
  const { user, profile } = useAuth();
  const photos = Object.fromEntries(users.map((u) => [u.id, u.photoURL]));

  const [activeChannel, setActiveChannel] = useState(null);
  const [showSidebar, setShowSidebar] = useState(true);
  const [text, setText] = useState("");
  const [newCategoryName, setNewCategoryName] = useState(null); // string when creating
  const [newChannelFor, setNewChannelFor] = useState(null); // categoryId when creating
  const [newChannelName, setNewChannelName] = useState("");
  const bottomRef = useRef(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(null);
  const [chatError, setChatError] = useState("");

  useEffect(() => {
    if (!activeChannel && channels.length > 0) setActiveChannel(channels[0]);
  }, [channels, activeChannel]);

  const messages = allMessages.filter((m) => m.channelId === activeChannel?.id);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function handleSend(e) {
    e.preventDefault();
    if (!text.trim() || !activeChannel) return;
    await addDoc(collection(db, "chatMessages"), {
      channelId: activeChannel.id,
      text: text.trim(),
      senderId: user.uid,
      senderNickname: profile?.nickname || "—",
      createdAt: serverTimestamp(),
    });
    setText("");
  }

  async function sendImage(file) {
    if (!file || !activeChannel) return;
    setChatError("");
    if (!file.type.startsWith("image/")) return setChatError("Só dá para enviar imagens.");
    if (file.size > 20 * 1024 * 1024) return setChatError("Imagem grande demais (máximo 20 MB).");
    setUploading(true);
    try {
      const ready = await shrinkImage(file);
      const { url } = await uploadImage(ready, "landora/chat");
      await addDoc(collection(db, "chatMessages"), {
        channelId: activeChannel.id,
        text: text.trim(),
        imageUrl: url,
        senderId: user.uid,
        senderNickname: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });
      setText("");
    } catch (err) {
      console.error(err);
      setChatError(err.message || "Não foi possível enviar a imagem.");
    } finally {
      setUploading(false);
    }
  }

  function onPaste(e) {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) {
      e.preventDefault();
      sendImage(file);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) sendImage(file);
  }

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

  return (
    <div className="chat-shell">
      <aside className={"chat-sidebar" + (showSidebar ? " show" : "")}>
        <div className="chat-sidebar-head">
          <span>Canais</span>
          <button className="btn-link" onClick={() => setNewCategoryName("")}>+ categoria</button>
        </div>

        {newCategoryName !== null && (
          <form onSubmit={createCategory} className="chat-inline-form">
            <input autoFocus value={newCategoryName} onChange={(e) => setNewCategoryName(e.target.value)} placeholder="nome da categoria" />
            <button className="btn-link" type="submit">criar</button>
          </form>
        )}

        {categories.map((cat) => (
          <div key={cat.id} className="chat-category">
            <div className="chat-category-head">
              <span>{cat.name.toUpperCase()}</span>
              <button className="btn-link" onClick={() => setNewChannelFor(cat.id)}>+</button>
            </div>
            {newChannelFor === cat.id && (
              <form onSubmit={(e) => createChannel(e, cat.id)} className="chat-inline-form">
                <input autoFocus value={newChannelName} onChange={(e) => setNewChannelName(e.target.value)} placeholder="nome-do-canal" />
                <button className="btn-link" type="submit">criar</button>
              </form>
            )}
            {channels.filter((c) => c.categoryId === cat.id).map((ch) => (
              <div key={ch.id} className={"chat-channel" + (activeChannel?.id === ch.id ? " active" : "")}>
                <button onClick={() => { setActiveChannel(ch); setShowSidebar(false); }}>
                  # {ch.name}
                </button>
                <button className="chat-channel-del" onClick={() => deleteChannel(ch)}>✕</button>
              </div>
            ))}
          </div>
        ))}

        {uncategorized.length > 0 && (
          <div className="chat-category">
            <div className="chat-category-head"><span>SEM CATEGORIA</span></div>
            {uncategorized.map((ch) => (
              <div key={ch.id} className={"chat-channel" + (activeChannel?.id === ch.id ? " active" : "")}>
                <button onClick={() => { setActiveChannel(ch); setShowSidebar(false); }}># {ch.name}</button>
                <button className="chat-channel-del" onClick={() => deleteChannel(ch)}>✕</button>
              </div>
            ))}
          </div>
        )}

        {categories.length === 0 && <p className="muted empty">Crie uma categoria pra começar.</p>}
      </aside>

      <section className={"chat-main" + (!showSidebar ? " show" : "")} onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="chat-main-head">
          <button className="btn-link chat-back" onClick={() => setShowSidebar(true)}>‹ canais</button>
          <span>{activeChannel ? `# ${activeChannel.name}` : "Selecione um canal"}</span>
        </div>

        <div className="chat-messages">
          {messages.map((m) => (
            <div key={m.id} className={"chat-bubble" + (m.senderId === user.uid ? " mine" : "")}>
              <div className="chat-bubble-author">
                <Avatar src={photos[m.senderId]} name={m.senderNickname} size={18} />
                <span>{m.senderNickname}</span>
              </div>
              {m.imageUrl && (
                <img className="chat-img" src={m.imageUrl} alt="Imagem enviada" loading="lazy" onClick={() => setLightbox(m.imageUrl)} />
              )}
              {m.text && <div className="chat-bubble-text">{m.text}</div>}
            </div>
          ))}
          {activeChannel && messages.length === 0 && <p className="muted empty">Nenhuma mensagem em #{activeChannel.name} ainda.</p>}
          <div ref={bottomRef} />
        </div>

        {activeChannel && (
          <>
            {chatError && <p className="auth-error chat-error">{chatError}</p>}
            <form onSubmit={handleSend} className="chat-form">
              <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { sendImage(e.target.files?.[0]); e.target.value = ""; }} />
              <button type="button" className="chat-attach" disabled={uploading} onClick={() => fileRef.current?.click()} title="Enviar imagem (ou cole com Ctrl+V)">
                {uploading ? "⏳" : "📎"}
              </button>
              <input value={text} onChange={(e) => setText(e.target.value)} onPaste={onPaste} placeholder={`Mensagem em #${activeChannel.name}`} />
              <button className="btn btn-gradient" type="submit" disabled={uploading}>Enviar</button>
            </form>
          </>
        )}
      </section>
      {lightbox && (
        <div className="lightbox" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" />
          <a href={lightbox} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>Abrir original</a>
        </div>
      )}
    </div>
  );
}
