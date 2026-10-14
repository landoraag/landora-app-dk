import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import Avatar from "../Avatar";

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

      <section className={"chat-main" + (!showSidebar ? " show" : "")}>
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
              <div className="chat-bubble-text">{m.text}</div>
            </div>
          ))}
          {activeChannel && messages.length === 0 && <p className="muted empty">Nenhuma mensagem em #{activeChannel.name} ainda.</p>}
          <div ref={bottomRef} />
        </div>

        {activeChannel && (
          <form onSubmit={handleSend} className="chat-form">
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={`Mensagem em #${activeChannel.name}`} />
            <button className="btn btn-gradient" type="submit">Enviar</button>
          </form>
        )}
      </section>
    </div>
  );
}
