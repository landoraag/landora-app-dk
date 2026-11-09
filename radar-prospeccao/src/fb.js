// Conexão com o Firebase (projeto landora-app-dk, o mesmo do app Landora).
// No Firebase Hosting a configuração vem de /__/firebase/init.json, servido pelo próprio Hosting.
// Para rodar local (npm run dev), crie .env.local com VITE_FIREBASE_API_KEY, VITE_FIREBASE_APP_ID etc.
// VITE_USE_EMULATOR=1 liga os emuladores locais de Auth e Firestore.
import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
import { getFirestore, connectFirestoreEmulator } from "firebase/firestore";

async function loadConfig() {
  const env = import.meta.env;
  if (env.VITE_FIREBASE_API_KEY) {
    return {
      apiKey: env.VITE_FIREBASE_API_KEY,
      authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "landora-app-dk.firebaseapp.com",
      projectId: env.VITE_FIREBASE_PROJECT_ID || "landora-app-dk",
      appId: env.VITE_FIREBASE_APP_ID,
      messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    };
  }
  const r = await fetch("/__/firebase/init.json");
  if (!r.ok) throw new Error("Configuração do Firebase não encontrada");
  return r.json();
}

export async function connect() {
  const app = initializeApp(await loadConfig());
  const auth = getAuth(app);
  const db = getFirestore(app);
  if (import.meta.env.VITE_USE_EMULATOR) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8080);
  }
  return { app, auth, db };
}
