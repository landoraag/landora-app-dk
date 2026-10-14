import { useEffect, useRef, useState } from "react";
import { addDoc, collection, deleteDoc, doc, getDocs, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { useCall } from "../../context/CallContext";
import Avatar from "../Avatar";

const CAN_SHARE = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getDisplayMedia;

function VideoTile({ track, mirror }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play?.().catch(() => {});
  }, [track]);
  // O som vem dos <audio> do provider; o vídeo aqui fica sempre mudo.
  return <video ref={ref} className={mirror ? "mirror" : ""} autoPlay playsInline muted />;
}

function LiveCount({ callId }) {
  const [n, setN] = useState(0);
  useEffect(
    () =>
      onSnapshot(collection(db, "calls", callId, "participants"), (snap) => {
        setN(snap.docs.filter((d) => Math.abs(Date.now() - (d.data().lastSeen || 0)) < 90000).length);
      }),
    [callId]
  );
  return n > 0 ? <span className="call-live">● {n} na call</span> : <span className="muted">vazia</span>;
}

/* ---------------- Lista de calls ---------------- */
function Lobby({ calls }) {
  const { user, profile } = useAuth();
  const { join, leave, active, error } = useCall();
  const [name, setName] = useState("");
  const [fixed, setFixed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createAndJoin(e) {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    setBusy(true);
    try {
      const ref = await addDoc(collection(db, "calls"), {
        name: n,
        fixed,
        createdBy: user.uid,
        createdByNickname: profile?.nickname || "—",
        createdAt: serverTimestamp(),
      });
      setName("");
      await join({ id: ref.id, name: n, fixed });
    } finally {
      setBusy(false);
    }
  }

  async function removeCall(call) {
    if (!confirm(`Excluir a call "${call.name}"?`)) return;
    if (active?.id === call.id) await leave();
    const [parts, sigs] = await Promise.all([
      getDocs(collection(db, "calls", call.id, "participants")),
      getDocs(collection(db, "calls", call.id, "signals")),
    ]);
    await Promise.all([...parts.docs, ...sigs.docs].map((d) => deleteDoc(d.ref)));
    await deleteDoc(doc(db, "calls", call.id));
  }

  const fixedCalls = calls.filter((c) => c.fixed);
  const tempCalls = calls.filter((c) => !c.fixed);

  const renderCard = (c) => (
    <div key={c.id} className="call-card">
      <div className="call-card-main">
        <div className="call-card-name">
          {c.fixed ? "📌 " : "📞 "}
          {c.name}
        </div>
        <div className="call-card-meta">
          <LiveCount callId={c.id} />
          {c.createdByNickname ? <span className="muted"> · criada por {c.createdByNickname}</span> : null}
        </div>
      </div>
      <div className="row-actions">
        <button className="btn btn-gradient" onClick={() => join({ id: c.id, name: c.name, fixed: !!c.fixed })}>
          Entrar
        </button>
        <button className="btn-link danger" onClick={() => removeCall(c)}>
          Excluir
        </button>
      </div>
    </div>
  );

  return (
    <div>
      <div className="content-header">
        <h2>Calls</h2>
        <p className="muted">Voz, câmera e compartilhamento de tela direto entre vocês, sem atraso.</p>
      </div>

      {error && <p className="auth-error">{error}</p>}

      <form className="inline-form" onSubmit={createAndJoin}>
        <label className="grow">
          Nome da call
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ex: Reunião de vendas" />
        </label>
        <label className="call-check">
          <span>
            <input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> Call fixa
          </span>
          <span className="hint">Fica salva na lista. As temporárias somem quando todos saem.</span>
        </label>
        <button className="btn btn-gradient" type="submit" disabled={busy || !name.trim()}>
          Criar e entrar
        </button>
      </form>

      <h3 className="section-title">Calls fixas</h3>
      <div className="call-list">
        {fixedCalls.map(renderCard)}
        {fixedCalls.length === 0 && <p className="muted">Nenhuma call fixa ainda.</p>}
      </div>

      <h3 className="section-title">Calls temporárias</h3>
      <div className="call-list">
        {tempCalls.map(renderCard)}
        {tempCalls.length === 0 && <p className="muted">Nenhuma call temporária aberta.</p>}
      </div>
    </div>
  );
}

/* ---------------- Dentro da call ---------------- */
function ScreenTile({ s }) {
  const boxRef = useRef(null);
  return (
    <div className="call-screen" ref={boxRef}>
      {s.mine ? (
        <div className="call-screen-self">🖥️ Você está compartilhando a tela</div>
      ) : (
        <VideoTile track={s.track} />
      )}
      <div className="call-tile-name">🖥️ {s.nickname}</div>
      {!s.mine && (
        <button className="call-fs" onClick={() => boxRef.current?.requestFullscreen?.()} title="Tela cheia">
          ⛶
        </button>
      )}
    </div>
  );
}

function connLabel(p) {
  if (!p || p.connState === "connected") return "";
  if (p.connState === "failed") return " · falhou (rede bloqueando)";
  if (Date.now() - p.since > 12000) return " · sem conexão direta (veja TURN)";
  return " · conectando…";
}

function CamTile({ nickname, photoURL, camOn, micOn, track, mine, status }) {
  return (
    <div className="call-tile">
      {camOn && track ? (
        <VideoTile track={track} mirror={mine} />
      ) : (
        <Avatar src={photoURL} name={nickname} size={72} />
      )}
      <div className="call-tile-name">
        {nickname}
        {mine ? " (você)" : ""}
        {!micOn ? " 🔇" : ""}
        {status || ""}
      </div>
    </div>
  );
}

function InCall() {
  const { active, status, error, session, toggleMic, toggleCam, toggleScreen, leave } = useCall();
  const [, setTick] = useState(0);
  // Atualiza a tela a cada 2s para o aviso de conexão mudar sozinho.
  useEffect(() => {
    const i = setInterval(() => setTick((n) => n + 1), 2000);
    return () => clearInterval(i);
  }, []);

  if (!session || status === "joining") {
    return (
      <div className="full-loader">
        <div className="spinner" />
      </div>
    );
  }

  const peers = session.snapshot();
  const me = session.localView();

  const screens = [];
  if (me.screenOn) screens.push({ key: "me", mine: true, nickname: me.nickname });
  peers.forEach((p) => {
    if (p.screenOn && p.tracks.screen) screens.push({ key: p.id, nickname: p.nickname, track: p.tracks.screen });
  });

  return (
    <div className="call-shell">
      <div className="call-head">
        <div>
          <h2>📞 {active?.name}</h2>
          <p className="muted">
            {peers.length + 1} {peers.length === 0 ? "pessoa (só você por enquanto)" : "pessoas"}
          </p>
        </div>
      </div>

      {session.notice && <p className="call-notice">{session.notice}</p>}
      {error && <p className="auth-error">{error}</p>}

      <div className="call-stage">
        {screens.map((s) => (
          <ScreenTile key={s.key} s={s} />
        ))}
        <div className="call-grid">
          <CamTile mine nickname={me.nickname} photoURL={me.photoURL} camOn={me.camOn} micOn={me.micOn} track={me.camTrack} />
          {peers.map((p) => (
            <CamTile
              key={p.id}
              nickname={p.nickname}
              photoURL={p.photoURL}
              camOn={p.camOn}
              micOn={p.micOn}
              track={p.tracks.cam}
              status={connLabel(p)}
            />
          ))}
        </div>
      </div>

      <div className="call-controls">
        <button className={"ctrl-btn " + (me.micOn ? "on" : "off")} onClick={toggleMic}>
          {me.micOn ? "🎤 Microfone" : "🔇 Mudo"}
        </button>
        <button className={"ctrl-btn " + (me.camOn ? "on" : "")} onClick={toggleCam}>
          {me.camOn ? "🎥 Câmera ligada" : "🎥 Ligar câmera"}
        </button>
        {CAN_SHARE && (
          <button className={"ctrl-btn " + (me.screenOn ? "on" : "")} onClick={toggleScreen}>
            {me.screenOn ? "⏹ Parar tela" : "🖥️ Compartilhar tela"}
          </button>
        )}
        <button className="ctrl-btn leave" onClick={leave}>
          Sair da call
        </button>
      </div>
    </div>
  );
}

export default function Calls() {
  const { data: calls } = useCollection("calls", "createdAt", "asc");
  const { active } = useCall();
  return active ? <InCall /> : <Lobby calls={calls} />;
}
