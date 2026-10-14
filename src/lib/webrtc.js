// Motor das calls do Landora.
//
// - A mídia (voz, câmera e tela) vai DIRETO entre os navegadores via WebRTC (peer-to-peer),
//   por isso não existe servidor no meio e quase não há atraso.
// - O Firestore é usado só no começo, para os navegadores "se apresentarem" (sinalização).
//   Depois que conectou, o Firestore não participa mais do áudio/vídeo.
// - Topologia "mesh": cada pessoa se conecta com todas as outras. Ótimo para 2 a 4 pessoas.
//
// Estrutura no Firestore:
//   calls/{callId}                         -> { name, fixed, createdBy, createdAt }
//   calls/{callId}/participants/{session}  -> presença (nickname, micOn, camOn, screenOn, lastSeen)
//   calls/{callId}/signals/{auto}          -> mensagens temporárias de conexão (apagadas após lidas)

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { playSound, unlockSounds } from "./sounds";

// Ordem fixa das faixas de cada conexão. Quem oferece cria nesta ordem e quem responde
// recebe na mesma ordem. Assim ligar/desligar câmera ou tela só troca a faixa
// (replaceTrack), sem renegociar nada — por isso é instantâneo.
const SLOTS = ["audio", "cam", "screen", "screenAudio"];
const SLOT_KIND = { audio: "audio", cam: "video", screen: "video", screenAudio: "audio" };

// "detail" deixa texto/interface nítidos; troque para "motion" se for compartilhar jogo/vídeo.
const SCREEN_CONTENT_HINT = "detail";

const HEARTBEAT_MS = 15000;
const STALE_MS = 45000;
const BITRATE = { cam: 1_800_000, screen: 5_000_000 };

function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function buildIceServers() {
  const servers = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
  const turn = import.meta.env.VITE_TURN_URL;
  if (turn) {
    servers.push({
      urls: turn.split(",").map((s) => s.trim()).filter(Boolean),
      username: import.meta.env.VITE_TURN_USERNAME,
      credential: import.meta.env.VITE_TURN_CREDENTIAL,
    });
  }
  return servers;
}

export class CallSession {
  constructor({ callId, fixed, uid, nickname, photoURL, onChange, onEvicted }) {
    this.callId = callId;
    this.fixed = !!fixed;
    this.uid = uid;
    this.nickname = nickname;
    this.photoURL = photoURL || null;
    this.onChange = onChange || (() => {});
    this.onEvicted = onEvicted || (() => {});

    this.sessionId = newId();
    this.joinedAt = Date.now();
    this.initialDone = false; // já recebeu a primeira lista de participantes (evita tocar som por quem já estava)
    this.registered = false;
    this.evicted = false;
    this.peers = new Map(); // sessionId -> peer
    this.local = { audio: null, cam: null, screen: null, screenAudio: null };
    this.alive = new Map(); // sessionId -> { stamp, seenAt }
    this.unsubs = [];
    this.queue = Promise.resolve();
    this.seq = 0;
    this.closed = false;
    this.notice = "";
  }

  // ---------- referências do Firestore ----------
  _participants() {
    return collection(db, "calls", this.callId, "participants");
  }
  _signals() {
    return collection(db, "calls", this.callId, "signals");
  }
  _me() {
    return doc(db, "calls", this.callId, "participants", this.sessionId);
  }
  _state() {
    return {
      micOn: !!(this.local.audio && this.local.audio.enabled),
      camOn: !!this.local.cam,
      screenOn: !!this.local.screen,
    };
  }

  // ---------- entrar / sair ----------
  async join() {
    unlockSounds();
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.local.audio = s.getAudioTracks()[0] || null;
    } catch {
      this.notice = "Sem acesso ao microfone — você entrou só para ouvir. Libere o microfone no navegador e clique em 🎤.";
    }

    await setDoc(this._me(), {
      uid: this.uid,
      nickname: this.nickname,
      photoURL: this.photoURL,
      joinedAt: this.joinedAt,
      lastSeen: Date.now(),
      ...this._state(),
    });

    this.heartbeat = setInterval(() => {
      updateDoc(this._me(), { lastSeen: Date.now() }).catch(() => {});
    }, HEARTBEAT_MS);
    this.sweeper = setInterval(() => this._sweep(), 10000);

    this.unsubs.push(onSnapshot(this._participants(), (snap) => this._onParticipants(snap)));
    this.unsubs.push(
      onSnapshot(query(this._signals(), where("to", "==", this.sessionId)), (snap) => this._onSignals(snap))
    );
    playSound("join");
    this.onChange();
  }

  async leave() {
    if (this.closed) return;
    if (!this.evicted) playSound("leave");
    this.closed = true;
    clearInterval(this.heartbeat);
    clearInterval(this.sweeper);
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
    for (const id of [...this.peers.keys()]) this._dropPeer(id, true);
    Object.values(this.local).forEach((t) => t && t.stop());
    this.local = { audio: null, cam: null, screen: null, screenAudio: null };

    try {
      await deleteDoc(this._me());
      // Call temporária some quando o último sai. Call fixa continua existindo.
      if (!this.fixed) {
        const left = await getDocs(this._participants());
        const alive = left.docs.filter((d) => Math.abs(Date.now() - (d.data().lastSeen || 0)) < 90000);
        if (alive.length === 0) {
          await Promise.all(left.docs.map((d) => deleteDoc(d.ref)));
          await deleteDoc(doc(db, "calls", this.callId));
        }
      }
    } catch (e) {
      console.warn("Falha ao limpar a call:", e);
    }
  }

  // ---------- presença ----------
  _isAlive(id) {
    const a = this.alive.get(id);
    return !!a && performance.now() - a.seenAt < STALE_MS;
  }

  _evict() {
    if (this.evicted) return;
    this.evicted = true;
    this.onEvicted();
  }

  _onParticipants(snap) {
    if (this.closed) return;
    const now = performance.now();

    // Uma sessão por pessoa: vale a mais nova. As antigas (página atualizada, aba fechada
    // sem avisar) são lixo e são apagadas, para não aparecerem como "pessoa fantasma".
    const newest = new Map(); // uid -> documento
    let meSeen = false;
    let newerMine = false;
    snap.docs.forEach((d) => {
      if (d.id === this.sessionId) {
        meSeen = true;
        return;
      }
      const data = d.data();
      if (data.uid === this.uid) {
        if ((data.joinedAt || 0) > this.joinedAt) newerMine = true;
        else deleteDoc(d.ref).catch(() => {});
        return;
      }
      const cur = newest.get(data.uid);
      if (!cur) {
        newest.set(data.uid, d);
      } else if ((data.joinedAt || 0) > (cur.data().joinedAt || 0)) {
        deleteDoc(cur.ref).catch(() => {});
        newest.set(data.uid, d);
      } else {
        deleteDoc(d.ref).catch(() => {});
      }
    });

    if (newerMine) {
      // Você abriu a call em outra aba ou aparelho: esta sessão sai.
      this._evict();
      return;
    }
    if (meSeen) this.registered = true;
    else if (this.registered) {
      // Meu registro sumiu (alguém o limpou por engano): registra de novo.
      setDoc(this._me(), {
        uid: this.uid,
        nickname: this.nickname,
        photoURL: this.photoURL,
        joinedAt: this.joinedAt,
        lastSeen: Date.now(),
        ...this._state(),
      }).catch(() => {});
    }

    const present = new Set();
    newest.forEach((d) => {
      const data = d.data();
      present.add(d.id);

      // "Vivo" = o carimbo lastSeen mudou recentemente (não depende do relógio dos aparelhos).
      const prev = this.alive.get(d.id);
      if (!prev || prev.stamp !== data.lastSeen) {
        const looksOld = !prev && Math.abs(Date.now() - (data.lastSeen || 0)) > 90000;
        this.alive.set(d.id, { stamp: data.lastSeen, seenAt: looksOld ? now - STALE_MS * 2 : now });
      }

      let peer = this.peers.get(d.id);
      if (peer) {
        if (this.initialDone) {
          if (!!peer.info?.camOn !== !!data.camOn) playSound(data.camOn ? "camOn" : "camOff");
          if (!!peer.info?.screenOn !== !!data.screenOn) playSound(data.screenOn ? "screenOn" : "screenOff");
        }
        peer.info = data;
        peer.seenInDoc = true;
      } else if (this._isAlive(d.id)) {
        peer = this._createPeer(d.id, data);
        peer.seenInDoc = true;
        if (this.initialDone) playSound("join");
        // Regra fixa para não haver duas ofertas ao mesmo tempo: quem tem o id maior oferece.
        if (peer.initiator) this._startOffer(peer).catch((e) => console.error("Oferta falhou:", e));
      }
    });

    for (const [id, peer] of this.peers) {
      if (peer.seenInDoc && !present.has(id)) this._dropPeer(id);
    }
    this.initialDone = true;
    this.onChange();
  }

  _sweep() {
    if (this.closed) return;
    for (const [id, peer] of this.peers) {
      // Se a mídia ainda está conectada, o par está vivo (aba em segundo plano pode atrasar o batimento).
      if (!this._isAlive(id) && peer.pc.connectionState !== "connected") {
        this._dropPeer(id);
        deleteDoc(doc(db, "calls", this.callId, "participants", id)).catch(() => {});
      }
    }
    this.onChange();
  }

  // ---------- conexões ----------
  _createPeer(id, info) {
    const pc = new RTCPeerConnection({ iceServers: buildIceServers(), bundlePolicy: "max-bundle" });
    const peer = {
      id,
      info,
      pc,
      tracks: {},
      pending: [],
      connState: "new",
      initiator: this.sessionId > id,
      seenInDoc: false,
      since: Date.now(),
    };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate) this._send(id, "cand", e.candidate.toJSON());
    };

    pc.ontrack = (e) => {
      const slot = SLOTS[pc.getTransceivers().indexOf(e.transceiver)];
      if (!slot) return;
      if (SLOT_KIND[slot] === "video") {
        try {
          e.receiver.playoutDelayHint = 0; // pede ao navegador para exibir o quadro o mais rápido possível
        } catch {
          /* não suportado */
        }
      }
      peer.tracks[slot] = e.track;
      this.onChange();
    };

    pc.onconnectionstatechange = () => {
      peer.connState = pc.connectionState;
      if (pc.connectionState === "connected") this._tune(peer);
      if (pc.connectionState === "failed" && peer.initiator && !this.closed) {
        this._restartIce(peer).catch(() => {});
      }
      this.onChange();
    };

    return peer;
  }

  _dropPeer(id, silent = false) {
    const peer = this.peers.get(id);
    if (!peer) return;
    if (!silent && peer.seenInDoc && this.initialDone && !this.closed) playSound("leave");
    try {
      peer.pc.close();
    } catch {
      /* já fechada */
    }
    this.peers.delete(id);
    this.onChange();
  }

  async _startOffer(peer) {
    const pc = peer.pc;
    pc.addTransceiver("audio", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    pc.addTransceiver("video", { direction: "sendrecv" });
    pc.addTransceiver("audio", { direction: "sendrecv" });
    await this._attachLocal(peer);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    this._send(peer.id, "desc", pc.localDescription.toJSON());
  }

  async _restartIce(peer) {
    const pc = peer.pc;
    const offer = await pc.createOffer({ iceRestart: true });
    await pc.setLocalDescription(offer);
    this._send(peer.id, "desc", pc.localDescription.toJSON());
  }

  async _attachLocal(peer) {
    const ts = peer.pc.getTransceivers();
    await Promise.all(
      SLOTS.map((slot, i) => (ts[i] ? ts[i].sender.replaceTrack(this.local[slot] || null) : null))
    );
  }

  async _tune(peer) {
    const ts = peer.pc.getTransceivers();
    for (const slot of ["cam", "screen"]) {
      const sender = ts[SLOTS.indexOf(slot)]?.sender;
      if (!sender) continue;
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = BITRATE[slot];
        await sender.setParameters(params);
      } catch {
        /* alguns navegadores não permitem ajustar */
      }
    }
  }

  // ---------- sinalização ----------
  _send(to, kind, payload) {
    addDoc(this._signals(), {
      from: this.sessionId,
      to,
      kind,
      payload: JSON.stringify(payload),
      n: this.seq++,
    }).catch((e) => console.warn("Sinal não enviado:", e));
  }

  _onSignals(snap) {
    const added = snap
      .docChanges()
      .filter((c) => c.type === "added")
      .map((c) => ({ ref: c.doc.ref, ...c.doc.data() }))
      .sort((a, b) => a.n - b.n);

    for (const s of added) {
      // Processa um por vez, na ordem, para a negociação não se embaralhar.
      this.queue = this.queue.then(() => this._handleSignal(s)).catch((e) => console.error("Sinal falhou:", e));
    }
  }

  async _handleSignal(s) {
    deleteDoc(s.ref).catch(() => {});
    if (this.closed) return;

    let peer = this.peers.get(s.from);
    if (!peer) peer = this._createPeer(s.from, { nickname: "…" });

    const payload = JSON.parse(s.payload);
    if (s.kind === "desc") await this._onDescription(peer, payload);
    else await this._onCandidate(peer, payload);
  }

  async _onDescription(peer, desc) {
    const pc = peer.pc;
    if (desc.type === "offer") {
      if (pc.signalingState !== "stable") await pc.setLocalDescription({ type: "rollback" });
      await pc.setRemoteDescription(desc);
      pc.getTransceivers().forEach((t) => {
        t.direction = "sendrecv";
      });
      await this._attachLocal(peer);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this._send(peer.id, "desc", pc.localDescription.toJSON());
    } else {
      await pc.setRemoteDescription(desc);
    }
    await this._flushCandidates(peer);
  }

  async _onCandidate(peer, cand) {
    if (!peer.pc.remoteDescription) {
      peer.pending.push(cand);
      return;
    }
    try {
      await peer.pc.addIceCandidate(cand);
    } catch (e) {
      console.warn("Candidato ignorado:", e);
    }
  }

  async _flushCandidates(peer) {
    const list = peer.pending.splice(0);
    for (const c of list) {
      try {
        await peer.pc.addIceCandidate(c);
      } catch (e) {
        console.warn("Candidato ignorado:", e);
      }
    }
  }

  // ---------- controles locais ----------
  async _setLocalTrack(slot, track) {
    this.local[slot] = track;
    const i = SLOTS.indexOf(slot);
    await Promise.all(
      [...this.peers.values()].map((p) => {
        const t = p.pc.getTransceivers()[i];
        return t ? t.sender.replaceTrack(track) : null;
      })
    );
  }

  async _push() {
    try {
      await updateDoc(this._me(), { ...this._state(), lastSeen: Date.now() });
    } catch {
      /* sessão encerrada */
    }
    this.onChange();
  }

  async toggleMic() {
    if (!this.local.audio) {
      const s = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.notice = "";
      await this._setLocalTrack("audio", s.getAudioTracks()[0]);
    } else {
      this.local.audio.enabled = !this.local.audio.enabled;
    }
    await this._push();
  }

  async toggleCam() {
    if (this.local.cam) {
      const t = this.local.cam;
      await this._setLocalTrack("cam", null);
      t.stop();
    } else {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      });
      const t = s.getVideoTracks()[0];
      t.contentHint = "motion";
      await this._setLocalTrack("cam", t);
    }
    playSound(this.local.cam ? "camOn" : "camOff");
    await this._push();
  }

  async toggleScreen() {
    if (this.local.screen) return this.stopScreen();
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: { frameRate: { ideal: 30, max: 60 } },
      audio: true,
    });
    const v = s.getVideoTracks()[0];
    v.contentHint = SCREEN_CONTENT_HINT;
    v.onended = () => this.stopScreen(); // botão "parar compartilhamento" do próprio navegador
    await this._setLocalTrack("screen", v);
    await this._setLocalTrack("screenAudio", s.getAudioTracks()[0] || null);
    playSound("screenOn");
    await this._push();
  }

  async stopScreen() {
    if (!this.local.screen && !this.local.screenAudio) return;
    const v = this.local.screen;
    const a = this.local.screenAudio;
    await this._setLocalTrack("screen", null);
    await this._setLocalTrack("screenAudio", null);
    if (v) v.stop();
    if (a) a.stop();
    playSound("screenOff");
    await this._push();
  }

  // ---------- leitura para a interface ----------
  localView() {
    return {
      nickname: this.nickname,
      photoURL: this.photoURL,
      ...this._state(),
      camTrack: this.local.cam,
    };
  }

  snapshot() {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      nickname: p.info?.nickname || "…",
      photoURL: p.info?.photoURL || null,
      micOn: !!p.info?.micOn,
      camOn: !!p.info?.camOn,
      screenOn: !!p.info?.screenOn,
      tracks: p.tracks,
      connState: p.connState,
      since: p.since,
    }));
  }
}
