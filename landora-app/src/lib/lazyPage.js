import { lazy } from "react";

// Depois de um deploy, o Firebase apaga os arquivos da versão anterior. Quem estava com o app
// aberto ainda procura os arquivos antigos das abas e o carregamento falha. Nesse caso
// recarregamos a página uma vez (pegando a versão nova) em vez de quebrar a tela.
const KEY = "landora.reloadedForUpdate";

export function reloadForNewVersion() {
  let last = 0;
  try {
    last = Number(sessionStorage.getItem(KEY) || 0);
  } catch {
    /* sem armazenamento */
  }
  // Evita ficar recarregando sem parar se o problema for outro.
  if (Date.now() - last < 15000) return false;
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* sem armazenamento */
  }
  window.location.reload();
  return true;
}

export const isChunkError = (e) =>
  /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading chunk|ChunkLoadError|Unable to preload CSS/i.test(
    String(e?.message || e)
  );

// Igual ao React.lazy, mas se o arquivo da aba sumiu (deploy novo), recarrega o app.
export function lazyPage(factory) {
  return lazy(() =>
    factory().catch((e) => {
      if (isChunkError(e) && reloadForNewVersion()) return new Promise(() => {}); // espera o recarregamento
      throw e;
    })
  );
}
