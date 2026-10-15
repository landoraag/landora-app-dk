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

// Recebe a faixa "crua" do microfone e devolve { track, close } com a faixa já limpa.
export async function createDenoiser(rawTrack) {
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
    source.connect(node);
    node.connect(dest);

    return {
      track: dest.stream.getAudioTracks()[0],
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
