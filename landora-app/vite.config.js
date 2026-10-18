import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Cada "npm run build" ganha um número de versão novo. Ele vai dentro do app e também num
// arquivo /version.json publicado junto. O app aberto confere esse arquivo de tempos em tempos
// e, se mudou, sabe que saiu atualização (ver src/lib/useAppUpdate.js).
const BUILD_ID = String(Date.now());

// Mesma versão do Firebase do package.json (firebase ^10.14.0).
const FIREBASE_SW_VERSION = "10.14.0";

function versionFile() {
  return {
    name: "landora-version-file",
    apply: "build",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ version: BUILD_ID }) });
    },
  };
}

// Gera /firebase-messaging-sw.js: o "ajudante" que recebe as notificações com o app fechado.
// Ele precisa das chaves públicas do Firebase, que vêm do .env (as mesmas que o app já usa).
function firebaseMessagingWorker(env) {
  const config = {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  };
  const source = `// Gerado automaticamente no build (vite.config.js). Não edite à mão.
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_SW_VERSION}/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/${FIREBASE_SW_VERSION}/firebase-messaging-compat.js");

firebase.initializeApp(${JSON.stringify(config)});
// As notificações enviadas pela função (api/notify.js) já vêm prontas: o Firebase as mostra
// sozinho e, ao tocar, abre o app na página certa.
firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
`;
  return {
    name: "landora-firebase-messaging-sw",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "firebase-messaging-sw.js", source });
    },
    configureServer(server) {
      server.middlewares.use("/firebase-messaging-sw.js", (_req, res) => {
        res.setHeader("Content-Type", "application/javascript");
        res.end(source);
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [react(), versionFile(), firebaseMessagingWorker(env)],
    define: {
      __APP_VERSION__: JSON.stringify(BUILD_ID),
    },
  };
});
