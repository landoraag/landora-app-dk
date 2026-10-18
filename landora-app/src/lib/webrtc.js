// Motor das calls do Landora.
//
// - A mídia (voz, câmera e tela) vai DIRETO entre os navegadores via WebRTC (peer-to-peer),
//   por isso não existe servidor no meio e quase não há atraso.
// - O Firestore é usado só no começo, para os navegadores "se apresentarem" (sinalização).
//   Depois que conectou, o Firestore não participa mais do áudio/vídeo.
// - Topologia "mesh": cada pessoa se conecta com todas as outras. Ótimo para 2 a 4 pessoas.
// - Anti-ruído do microfone (estilo Krisp), em camadas, rodando no próprio navegador antes de a
//   voz ser enviada: 1) DeepFilterNet3 (IA mais forte), 2) RNNoise (IA leve, arquivos dentro do
//   site) e só se as duas falharem, 3) o filtro padrão do navegador.
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
// screen2/screen2Audio = segunda transmissão de tela (duas telas ou duas janelas ao mesmo tempo).
// Ficam no fim da lista: versões antigas do app simplesmente ignoram essas faixas extras.
const SLOTS = ["audio", "cam", "screen", "screenAudio", "screen2", "screen2Audio"];
const SLOT_KIND = {
  audio: "audio",
  cam: "video",
  screen: "video",
  screenAudio: "audio",
  screen2: "video",
  screen2Audio: "audio",
};
const SCREEN_SLOTS = [
  ["screen", "screenAudio"],
  ["screen2", "screen2Audio"],
];
const EMPTY_LOCAL = () => ({ audio: null, cam: null, screen: null, screenAudio: null, screen2: null, screen2Audio: null });

// "detail" deixa texto/interface nítidos; troque para "motion" se for compartilhar jogo/vídeo.
const SCREEN_CONTENT_HINT = "detail";

// Força padrão do anti-ruído (0 a 100). Mais alto corta mais barulho; perto de 100 a voz pode
// soar um pouco "seca". 80 é um bom equilíbrio. Cada pessoa ajusta a sua no painel ⚙️ Áudio.
const NOISE_LEVEL = 80;
// Tempo máximo esperando o modelo do DeepFilterNet baixar antes de passar para o RNNoise.
const DFN_TIMEOUT_MS = 12000;

function withTimeout(promise, ms, reason) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(reason)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Celular/tablet (tela de toque): a câmera é escolhida por direção (frontal/traseira).
const IS_TOUCH =
  typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(pointer: coarse)").matches;

const HEARTBEAT_MS = 15000;
const STALE_MS = 45000;
// Níveis de qualidade da câmera e da tela (resolução, quadros por segundo e velocidade máxima de envio).
// Qualidade maior = imagem mais nítida, mas usa mais internet de quem transmite.
const QUALITY = {
  equilibrada: {
    label: "Equilibrada",
    cam: { w: 1280, h: 720, fps: 30, bps: 2_500_000 },
    screen: { w: 1920, h: 1080, fps: 30, bps: 5_000_000 },
  },
  alta: {
    label: "Alta",
    cam: { w: 1920, h: 1080, fps: 30, bps: 4_000_000 },
    screen: { w: 1920, h: 1080, fps: 60, bps: 8_000_000 },
  },
  maxima: {
    label: "Máxima",
    cam: { w: 1920, h: 1080, fps: 30, bps: 6_000_000 },
    screen: { w: 2560, h: 1440, fps: 60, bps: 15_000_000 },
  },
};
export const QUALITY_OPTIONS = Object.entries(QUALITY).map(([key, v]) => ({ key, label: v.label }));

function loadPref(key, fallback) {
  try {
    return localStorage.getItem("landora.call." + key) || fallback;
  } catch {
    return fallback;
  }
}
function savePref(key, value) {
  try {
    localStorage.setItem("landora.call." + key, value);
  } catch {
    /* sem armazenamento: tudo bem */
  }
}

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
    this.local = EMPTY_LOCAL();
    this.alive = new Map(); // sessionId -> { stamp, seenAt }
    this.unsubs = [];
    this.queue = Promise.resolve();
    this.seq = 0;
    this.closed = false;
    this.notice = "";
    const savedQuality = loadPref("quality", "equilibrada");
    this.quality = QUALITY[savedQuality] ? savedQuality : "equilibrada";
    this.noiseOn = loadPref("noise", "on") !== "off"; // anti-ruído do microfone
    this.noiseLoading = false; // true enquanto o modelo de IA do anti-ruído carrega
    this._dfnFailed = false; // se o DeepFilterNet não rodar neste navegador, não tenta de novo
    this._rnnFailed = false; // idem para o RNNoise
    this.noiseEngine = ""; // qual anti-ruído está ativo: "dfn", "rnnoise" ou "browser"
    const savedLevel = Number(loadPref("noiseLevel", String(NOISE_LEVEL)));
    this.noiseLevel = Number.isFinite(savedLevel) ? Math.min(100, Math.max(0, savedLevel)) : NOISE_LEVEL;
    this._chains = new Map(); // faixa processada -> { raw, close } (para desligar tudo direito)
    this.micId = loadPref("micId", ""); // microfone escolhido ("" = padrão do sistema)
    this.camId = loadPref("camId", ""); // câmera escolhida no computador ("" = padrão)
    this.facing = "user"; // no celular: "user" = frontal, "environment" = traseira
  }

  // browserNS = usar o filtro de ruído embutido do navegador (só como plano B).
  _audioConstraints(browserNS) {
    const c = {
      echoCancellation: true,
      noiseSuppression: !!browserNS,
      autoGainControl: true,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
    };
    if (this.micId) c.deviceId = { exact: this.micId };
    return c;
  }

  // Abre o microfone escolhido; se ele não existir mais (desconectado), volta para o padrão do sistema.
  async _openRawMic(browserNS) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: this._audioConstraints(browserNS) });
    } catch (e) {
      if (this.micId && (e.name === "OverconstrainedError" || e.name === "NotFoundError")) {
        this.micId = "";
        savePref("micId", "");
        return await navigator.mediaDevices.getUserMedia({ audio: this._audioConstraints(browserNS) });
      }
      throw e;
    }
  }

  // Camada 1: DeepFilterNet3 (IA mais forte). Baixa o modelo de um servidor externo,
  // então pode falhar (internet lenta, servidor fora do ar, bloqueio). Devolve { track, close }.
  async _startDeepFilter(rawTrack) {
    const { DeepFilterNet3Core } = await import("deepfilternet3-noise-filter");
    const ctx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    let proc = null;
    const close = () => {
      try {
        proc?.destroy();
      } catch {
        /* já encerrado */
      }
      ctx.close().catch(() => {});
    };
    try {
      proc = new DeepFilterNet3Core({ sampleRate: 48000, noiseReductionLevel: this.noiseLevel });
      await withTimeout(proc.initialize(), DFN_TIMEOUT_MS, "o modelo de IA demorou demais para baixar");
      const node = await proc.createAudioWorkletNode(ctx);
      proc.setSuppressionLevel(this.noiseLevel);
      const src = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
      const dst = ctx.createMediaStreamDestination();
      src.connect(node).connect(dst);
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const track = dst.stream.getAudioTracks()[0];
      if (!track) throw new Error("o DeepFilterNet não gerou faixa de áudio");
      const setLevel = (v) => {
        try {
          proc.setSuppressionLevel(v);
        } catch {
          /* processador encerrado */
        }
      };
      return { track, close, setLevel };
    } catch (e) {
      close();
      throw e;
    }
  }

  // Camada 2: RNNoise (IA leve). Os arquivos ficam dentro do próprio site, não depende de
  // nenhum servidor de fora — funciona em praticamente qualquer navegador moderno.
  async _startRnnoise(rawTrack) {
    const { createDenoiser } = await import("./denoise");
    return createDenoiser(rawTrack, this.noiseLevel);
  }

  // Devolve um MediaStream com a faixa de voz já pronta para enviar.
  // Anti-ruído ligado: microfone -> IA (DeepFilterNet3, ou RNNoise se ele falhar) -> faixa limpa.
  // Só se as duas IAs falharem é que usa o filtro embutido do navegador.
  async _getMic() {
    // Anti-ruído desligado: voz crua, sem nenhum filtro de ruído.
    if (!this.noiseOn) return this._openRawMic(false);
    // As duas IAs já falharam neste navegador: filtro padrão do navegador.
    if (this._dfnFailed && this._rnnFailed) return this._openRawMic(true);

    const raw = await this._openRawMic(false);
    const rawTrack = raw.getAudioTracks()[0];
    this.noiseLoading = true;
    this.onChange();
    try {
      const engines = [
        ["dfn", "_dfnFailed", () => this._startDeepFilter(rawTrack)],
        ["rnnoise", "_rnnFailed", () => this._startRnnoise(rawTrack)],
      ];
      for (const [name, failFlag, start] of engines) {
        if (this[failFlag]) continue;
        try {
          const chain = await start();
          this._chains.set(chain.track, { raw, close: chain.close, setLevel: chain.setLevel });
          this.noiseEngine = name;
          return new MediaStream([chain.track]);
        } catch (e) {
          console.warn(`Anti-ruído "${name}" não funcionou:`, e);
          this[failFlag] = true;
        }
      }
      // Nenhuma IA funcionou: usa o filtro do navegador.
      raw.getTracks().forEach((t) => t.stop());
      this.noiseEngine = "browser";
      this.notice = "O anti-ruído com IA não funcionou neste navegador. Usando o filtro padrão.";
      return this._openRawMic(true);
    } finally {
      this.noiseLoading = false;
      this.onChange();
    }
  }

  // Força do anti-ruído (0 a 100), ajustada na hora, sem reabrir o microfone.
  setNoiseLevel(value) {
    const v = Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
    this.noiseLevel = v;
    savePref("noiseLevel", String(v));
    this._chains.get(this.local.audio)?.setLevel?.(v);
    this.onChange();
  }

  // Para uma faixa de voz e desmonta o anti-ruído ligado a ela (se houver).
  _stopAudioTrack(track) {
    if (!track) return;
    track.stop();
    const chain = this._chains.get(track);
    if (!chain) return;
    this._chains.delete(track);
    chain.raw.getTracks().forEach((t) => t.stop());
    chain.close();
  }

  // Troca o microfone durante a call.
  async setMic(deviceId) {
    this.micId = deviceId || "";
    savePref("micId", this.micId);
    const old = this.local.audio;
    const wasOn = old ? old.enabled : true;
    const s = await this._getMic();
    const fresh = s.getAudioTracks()[0];
    fresh.enabled = wasOn;
    this.notice = "";
    await this._setLocalTrack("audio", fresh);
    this._stopAudioTrack(old);
    await this._push();
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
      screen2On: !!this.local.screen2,
    };
  }

  // ---------- entrar / sair ----------
  async join() {
    unlockSounds();
    try {
      const s = await this._getMic();
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
    this._stopAudioTrack(this.local.audio);
    SLOTS.filter((k) => k !== "audio").forEach((k) => this.local[k] && this.local[k].stop());
    this.local = EMPTY_LOCAL();

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
          if (!!peer.info?.screen2On !== !!data.screen2On) playSound(data.screen2On ? "screenOn" : "screenOff");
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
    SLOTS.forEach((slot) => pc.addTransceiver(SLOT_KIND[slot], { direction: "sendrecv" }));
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
    for (const slot of ["cam", "screen", "screen2"]) {
      const sender = ts[SLOTS.indexOf(slot)]?.sender;
      if (!sender) continue;
      const q = QUALITY[this.quality][slot === "cam" ? "cam" : "screen"];
      try {
        const params = sender.getParameters();
        if (!params.encodings || !params.encodings.length) params.encodings = [{}];
        params.encodings[0].maxBitrate = q.bps;
        params.encodings[0].maxFramerate = q.fps;
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
      const s = await this._getMic();
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
      const t = await this._openCam();
      await this._setLocalTrack("cam", t);
    }
    playSound(this.local.cam ? "camOn" : "camOff");
    await this._push();
  }

  _camBase() {
    const q = QUALITY[this.quality].cam;
    return { width: { ideal: q.w }, height: { ideal: q.h }, frameRate: { ideal: q.fps } };
  }

  // Abre a câmera: no celular pela direção (frontal/traseira), no computador pela câmera escolhida.
  async _openCam() {
    const base = this._camBase();
    const tries = [];
    if (IS_TOUCH) {
      tries.push({ ...base, facingMode: { exact: this.facing } });
      tries.push({ ...base, facingMode: this.facing });
    } else if (this.camId) {
      tries.push({ ...base, deviceId: { exact: this.camId } });
    }
    tries.push(base);
    let lastErr = null;
    for (const video of tries) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ video });
        const t = s.getVideoTracks()[0];
        t.contentHint = "motion";
        const f = t.getSettings?.().facingMode;
        if (f === "user" || f === "environment") this.facing = f;
        return t;
      } catch (e) {
        lastErr = e;
        if (e?.name === "NotAllowedError") break; // sem permissão: não adianta tentar outras
      }
    }
    throw lastErr;
  }

  // Vira a câmera (frontal <-> traseira no celular; próxima câmera no computador).
  async flipCam() {
    const old = this.local.cam;
    if (!old) return;
    if (IS_TOUCH) {
      this.facing = this.facing === "environment" ? "user" : "environment";
    } else {
      const cams = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
      if (cams.length < 2) throw new Error("Só existe uma câmera neste aparelho.");
      const cur = old.getSettings?.().deviceId || this.camId;
      const i = cams.findIndex((c) => c.deviceId === cur);
      this.camId = cams[(i + 1) % cams.length].deviceId;
      savePref("camId", this.camId);
    }
    // Muitos celulares não abrem duas câmeras ao mesmo tempo: fecha a atual antes.
    old.stop();
    let fresh;
    try {
      fresh = await this._openCam();
    } catch (e) {
      // Não deu: volta para a câmera anterior.
      if (IS_TOUCH) this.facing = this.facing === "environment" ? "user" : "environment";
      fresh = await this._openCam().catch(() => null);
      await this._setLocalTrack("cam", fresh);
      await this._push();
      throw e;
    }
    await this._setLocalTrack("cam", fresh);
    await this._push();
  }

  async toggleScreen() {
    if (this.local.screen || this.local.screen2) return this.stopAllScreens();
    return this.startScreen();
  }

  // Começa uma transmissão de tela no primeiro espaço livre (até duas ao mesmo tempo).
  async startScreen() {
    const pair = SCREEN_SLOTS.find(([v]) => !this.local[v]);
    if (!pair) throw new Error("Já existem duas transmissões de tela.");
    const [vSlot, aSlot] = pair;
    const s = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { max: QUALITY[this.quality].screen.w },
        height: { max: QUALITY[this.quality].screen.h },
        frameRate: { ideal: QUALITY[this.quality].screen.fps, max: QUALITY[this.quality].screen.fps },
      },
      // O som do computador não deve ser "tratado" como voz (senão música e vídeos ficam abafados).
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    const v = s.getVideoTracks()[0];
    v.contentHint = SCREEN_CONTENT_HINT;
    v.onended = () => this.stopScreen(vSlot); // botão "parar compartilhamento" do próprio navegador
    await this._setLocalTrack(vSlot, v);
    await this._setLocalTrack(aSlot, s.getAudioTracks()[0] || null);
    playSound("screenOn");
    await this._push();
  }

  async toggleNoise() {
    this.noiseOn = !this.noiseOn;
    savePref("noise", this.noiseOn ? "on" : "off");
    const old = this.local.audio;
    if (old) {
      // Reabre o microfone com a nova configuração (liga ou desliga o anti-ruído de IA).
      const wasOn = old.enabled;
      const s = await this._getMic();
      const fresh = s.getAudioTracks()[0];
      fresh.enabled = wasOn;
      await this._setLocalTrack("audio", fresh);
      this._stopAudioTrack(old);
    }
    this.onChange();
  }

  async setQuality(key) {
    if (!QUALITY[key]) return;
    this.quality = key;
    savePref("quality", key);
    const q = QUALITY[key];
    // Ajusta o que já está sendo transmitido, sem precisar desligar e ligar de novo.
    if (this.local.cam) {
      await this.local.cam
        .applyConstraints({ width: { ideal: q.cam.w }, height: { ideal: q.cam.h }, frameRate: { ideal: q.cam.fps } })
        .catch(() => {});
    }
    for (const slot of ["screen", "screen2"]) {
      if (!this.local[slot]) continue;
      await this.local[slot]
        .applyConstraints({ width: { max: q.screen.w }, height: { max: q.screen.h }, frameRate: { ideal: q.screen.fps, max: q.screen.fps } })
        .catch(() => {});
    }
    for (const peer of this.peers.values()) await this._tune(peer);
    this.onChange();
  }

  // Para uma transmissão de tela ("screen" = a primeira, "screen2" = a segunda).
  async stopScreen(vSlot = "screen") {
    const pair = SCREEN_SLOTS.find(([v]) => v === vSlot);
    if (!pair) return;
    const [, aSlot] = pair;
    if (!this.local[vSlot] && !this.local[aSlot]) return;
    const v = this.local[vSlot];
    const a = this.local[aSlot];
    await this._setLocalTrack(vSlot, null);
    await this._setLocalTrack(aSlot, null);
    if (v) v.stop();
    if (a) a.stop();
    playSound("screenOff");
    await this._push();
  }

  async stopAllScreens() {
    await this.stopScreen("screen2");
    await this.stopScreen("screen");
  }

  // ---------- leitura para a interface ----------
  localView() {
    return {
      nickname: this.nickname,
      photoURL: this.photoURL,
      ...this._state(),
      camTrack: this.local.cam,
      micTrack: this.local.audio,
      // Câmera traseira não fica espelhada (o texto apareceria invertido).
      camMirror: !!this.local.cam && !(IS_TOUCH && this.facing === "environment"),
    };
  }

  snapshot() {
    return [...this.peers.values()].map((p) => ({
      id: p.id,
      nickname: p.info?.nickname || "…",
      photoURL: p.info?.photoURL || null,
      uid: p.info?.uid || p.id,
      micOn: !!p.info?.micOn,
      camOn: !!p.info?.camOn,
      screenOn: !!p.info?.screenOn,
      screen2On: !!p.info?.screen2On,
      tracks: p.tracks,
      connState: p.connState,
      since: p.since,
    }));
  }
}
