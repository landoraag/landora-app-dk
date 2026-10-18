// Anti-ruído de verdade para o microfone, usando RNNoise (rede neural pequena que separa voz de ruído).
// É bem mais forte que o filtro padrão do navegador: corta teclado, ventilador, ar-condicionado,
// barulho de rua e de fundo, e preserva a voz. Roda no seu computador, nada é enviado para servidor.
//
// Esta parte é carregada só quando o anti-ruído é usado (import dinâmico em webrtc.js).

import { RnnoiseWorkletNode, loadRnnoise } from "@sapphi-red/web-noise-suppressor";
import rnnoiseWorkletPath from "@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url";
import rnnoiseWasmPath from "@sapphi-red/web-noise-suppressor/rnnoise.wasm?url";
import rnnoiseWasmSimdPath from "@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url";

let wasmBinaryPromise = null;

// O RNNoise não tem "força" própria. Para ajustar a força, misturamos a voz limpa com um pouco
// da voz original: 100 = só a limpa, 0 = só a original.
// O caminho original ganha um pequeno atraso para ficar alinhado com o da IA (evita som "metálico").
const RNNOISE_DELAY_S = 0.01;

// Recebe a faixa "crua" do microfone e devolve { track, close, setLevel } com a faixa já limpa.
export async function createDenoiser(rawTrack, level = 80) {
  const ctx = new AudioContext({ sampleRate: 48000, latencyHint: "interactive" }); // o RNNoise exige 48 kHz
  try {
    await ctx.resume();
    await ctx.audioWorklet.addModule(rnnoiseWorkletPath);
    if (!wasmBinaryPromise) {
      wasmBinaryPromise = loadRnnoise({ url: rnnoiseWasmPath, simdUrl: rnnoiseWasmSimdPath });
    }
    const wasmBinary = await wasmBinaryPromise;

    const source = ctx.createMediaStreamSource(new MediaStream([rawTrack]));
    const node = new RnnoiseWorkletNode(ctx, { wasmBinary, maxChannels: 1 });
    const dest = ctx.createMediaStreamDestination();
    const wet = ctx.createGain();
    const dry = ctx.createGain();
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = RNNOISE_DELAY_S;
    source.connect(node);
    node.connect(wet).connect(dest);
    source.connect(delay).connect(dry).connect(dest);

    const setLevel = (v) => {
      const k = Math.min(1, Math.max(0, v / 100));
      wet.gain.setTargetAtTime(k, ctx.currentTime, 0.05);
      dry.gain.setTargetAtTime(1 - k, ctx.currentTime, 0.05);
    };
    wet.gain.value = Math.min(1, Math.max(0, level / 100));
    dry.gain.value = 1 - wet.gain.value;

    return {
      track: dest.stream.getAudioTracks()[0],
      setLevel,
      close() {
        try {
          node.destroy?.();
          source.disconnect();
        } catch {
          /* já desmontado */
        }
        ctx.close().catch(() => {});
      },
    };
  } catch (e) {
    wasmBinaryPromise = null;
    ctx.close().catch(() => {});
    throw e;
  }
}
