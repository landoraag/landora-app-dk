// Sons curtos das calls, gerados pelo próprio navegador (não precisa de arquivo de áudio).
// Cada som é uma sequência de notas: [frequência em Hz, atraso em segundos, duração em segundos].

const SOUNDS = {
  join: [[523, 0, 0.12], [784, 0.1, 0.2]], // sobe: alguém entrou
  leave: [[784, 0, 0.12], [523, 0.1, 0.2]], // desce: alguém saiu
  camOn: [[660, 0, 0.1], [880, 0.08, 0.14]],
  camOff: [[880, 0, 0.1], [660, 0.08, 0.14]],
  screenOn: [[440, 0, 0.09], [660, 0.08, 0.09], [880, 0.16, 0.16]],
  screenOff: [[880, 0, 0.09], [660, 0.08, 0.09], [440, 0.16, 0.16]],
};

let ctx = null;

function getCtx() {
  if (!ctx) {
    const AC = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

// Chame logo após um clique do usuário, para o navegador liberar o som.
export function unlockSounds() {
  getCtx();
}

export function playSound(name) {
  const seq = SOUNDS[name];
  const c = getCtx();
  if (!seq || !c) return;
  const t0 = c.currentTime;
  seq.forEach(([freq, delay, dur]) => {
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    const start = t0 + delay;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14, start + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    osc.connect(gain).connect(c.destination);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  });
}
