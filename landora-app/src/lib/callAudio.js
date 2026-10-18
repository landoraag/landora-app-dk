// Som da call passando pelo "Web Audio" do navegador. Isso permite:
// - volume acima de 100% (até 200%), que um <audio> comum não deixa;
// - medir o nível da voz de cada pessoa (borda azul de quem está falando).
//
// Um único AudioContext para a call inteira (mais leve e evita limites do navegador).

let ctx = null;

export function getAudioCtx() {
  if (!ctx) {
    const C = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
    if (!C) return null;
    try {
      ctx = new C({ latencyHint: "interactive" });
    } catch {
      return null;
    }
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Chame dentro de um clique (ex.: botão "Entrar"): o Safari só libera som depois de um toque.
export function unlockAudio() {
  getAudioCtx();
}

function makeLevelReader(analyser) {
  const buf = new Float32Array(analyser.fftSize);
  return () => {
    analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
    return Math.sqrt(sum / buf.length); // 0 = silêncio
  };
}

// Toca uma faixa de áudio de outra pessoa.
// Devolve { setVolume(0..2), setSink(deviceId), level(), close() }.
export function createPlayer(track) {
  const c = getAudioCtx();

  if (!c) {
    // Navegador sem Web Audio: volume limitado a 100% e sem medidor.
    const el = new Audio();
    el.autoplay = true;
    el.srcObject = new MediaStream([track]);
    el.play?.().catch(() => {});
    return {
      setVolume: (v) => (el.volume = Math.min(1, Math.max(0, v))),
      setSink: (id) => el.setSinkId?.(id || "").catch(() => {}),
      level: () => 0,
      close: () => {
        el.pause();
        el.srcObject = null;
      },
    };
  }

  // O Chrome só deixa o áudio de uma call (WebRTC) chegar ao Web Audio se a faixa também
  // estiver ligada a um elemento de mídia. Este fica mudo, só para "destravar".
  const kick = new Audio();
  kick.muted = true;
  kick.srcObject = new MediaStream([track]);
  kick.play?.().catch(() => {});

  const src = c.createMediaStreamSource(new MediaStream([track]));
  const gain = c.createGain();
  const analyser = c.createAnalyser();
  analyser.fftSize = 512;
  const dest = c.createMediaStreamDestination();
  src.connect(analyser); // mede antes do volume: dá para ver quem fala mesmo com o som dele baixo
  src.connect(gain);
  gain.connect(dest);

  // A saída final vai para um <audio>, que permite escolher o alto-falante/fone (setSinkId).
  const out = new Audio();
  out.autoplay = true;
  out.srcObject = dest.stream;
  out.play?.().catch(() => {});

  return {
    setVolume: (v) => {
      gain.gain.value = Math.min(2, Math.max(0, v));
    },
    setSink: (id) => out.setSinkId?.(id || "").catch(() => {}),
    level: makeLevelReader(analyser),
    close: () => {
      try {
        src.disconnect();
        gain.disconnect();
      } catch {
        /* já desligado */
      }
      out.pause();
      out.srcObject = null;
      kick.pause();
      kick.srcObject = null;
    },
  };
}

// Só mede o nível (para o seu próprio microfone). Devolve { level(), close() }.
export function createMeter(track) {
  const c = getAudioCtx();
  if (!c) return { level: () => 0, close: () => {} };
  const src = c.createMediaStreamSource(new MediaStream([track]));
  const analyser = c.createAnalyser();
  analyser.fftSize = 512;
  src.connect(analyser);
  return {
    level: makeLevelReader(analyser),
    close: () => {
      try {
        src.disconnect();
      } catch {
        /* já desligado */
      }
    },
  };
}
