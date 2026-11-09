import { defineConfig } from "vite";
// Nomes fixos para o código principal: a aba Prospecção do app Landora carrega
// https://radar-landora.web.app/assets/radar.js e radar.css, sempre a versão mais nova.
export default defineConfig({
  build: {
    outDir: "dist", chunkSizeWarningLimit: 1200,
    rollupOptions: { output: {
      entryFileNames: "assets/radar.js",
      chunkFileNames: "assets/[name]-[hash].js",
      assetFileNames: (a) => (a.name && a.name.endsWith(".css") ? "assets/radar.css" : "assets/[name]-[hash][extname]"),
    } },
  },
});
