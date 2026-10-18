import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Cada "npm run build" ganha um número de versão novo. Ele vai dentro do app e também num
// arquivo /version.json publicado junto. O app aberto confere esse arquivo de tempos em tempos
// e, se mudou, sabe que saiu atualização (ver src/lib/useAppUpdate.js).
const BUILD_ID = String(Date.now());

function versionFile() {
  return {
    name: "landora-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  plugins: [react(), versionFile()],
  define: {
    __APP_VERSION__: JSON.stringify(BUILD_ID),
  },
});
