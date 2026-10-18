// Notificações no celular/computador (Firebase Cloud Messaging), sem cartão de crédito.
//
// Como funciona:
// 1. Cada aparelho que ativa as notificações ganha um "endereço" (token) do Firebase,
//    guardado em pushTokens/{token} junto com quem é o dono e o que ele quer receber.
// 2. Quando algo acontece no app (mensagem, call, tarefa, lead, venda), o app chama
//    notify(), que pede para a função na Vercel (api/notify.js) avisar os OUTROS aparelhos.
// 3. O arquivo /firebase-messaging-sw.js (gerado no build) mostra a notificação mesmo
//    com o app fechado.
//
// Configuração: já embutida abaixo (chave VAPID pública e endereço da função na Vercel).

import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { app, auth, db } from "./firebase";

// Chave pública "Web Push" do projeto (Firebase → Cloud Messaging). Não é segredo: vai dentro do app.
const PROJECT_VAPID_KEY = "BNhubiLxbeL2lijS2gUFhDa_gW5aUaKHJYxLLkGDuijVhqJFfhgKPJv-kKRxrREOoRE7JGxi-gNH-xqdg89tf_0";

// Uma chave válida tem 87 caracteres (letras, números, - e _) e começa com "B".
// Se a do .env vier com aspas, espaços ou o valor errado, ela é ignorada e vale a do projeto.
function pickVapidKey() {
  const fromEnv = String(import.meta.env.VITE_FIREBASE_VAPID_KEY || "")
    .trim()
    .replace(/^["']|["']$/g, "")
    .trim();
  if (/^B[A-Za-z0-9_-]{86}$/.test(fromEnv)) return fromEnv;
  if (fromEnv) console.warn("VITE_FIREBASE_VAPID_KEY no .env não parece uma chave válida; usando a chave do projeto.");
  return PROJECT_VAPID_KEY;
}
const VAPID_KEY = pickVapidKey();
// Endereço da função que envia os avisos (Vercel).
const NOTIFY_URL = import.meta.env.VITE_NOTIFY_URL || "https://landora-app-dk-iota.vercel.app/api/notify";
const TOKEN_KEY = "landora.push.token";

// Tipos de aviso (a chave é o que vai no Firestore e na função).
export const PUSH_KINDS = [
  { key: "chat", label: "Mensagens novas no chat" },
  { key: "call", label: "Alguém entrou numa call" },
  { key: "task", label: "Tarefas novas" },
  { key: "lead", label: "Leads novos" },
  { key: "sale", label: "Vendas novas" },
];
export const DEFAULT_PREFS = Object.fromEntries(PUSH_KINDS.map((k) => [k.key, true]));

const isElectron = () => typeof navigator !== "undefined" && /Electron/i.test(navigator.userAgent);
export const isIOS = () =>
  typeof navigator !== "undefined" &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
// Aberto pelo atalho da tela de início (no iPhone, só assim as notificações funcionam).
export const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true);

// Situação deste aparelho, para a tela saber o que mostrar.
//  "unconfigured" falta configurar as chaves | "unsupported" aparelho/navegador não permite
//  "ios-home" no iPhone, precisa abrir pelo atalho da tela de início | "denied" bloqueado nas configurações
//  "off" pode ativar | "on" já ativado
export function pushStatus() {
  if (!VAPID_KEY || !NOTIFY_URL) return "unconfigured";
  if (isElectron()) return "unsupported";
  if (isIOS() && !isStandalone()) return "ios-home";
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window) || !("PushManager" in window))
    return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission === "granted" && localStorage.getItem(TOKEN_KEY)) return "on";
  return "off";
}

export function currentToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

async function registerWorker() {
  return navigator.serviceWorker.register("/firebase-messaging-sw.js", { updateViaCache: "none" });
}

// Ativa neste aparelho. Precisa ser chamado dentro de um clique (o iPhone exige).
export async function enablePush({ uid, nickname, prefs = DEFAULT_PREFS }) {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    throw new Error(
      permission === "denied"
        ? "As notificações foram bloqueadas. Libere nas configurações do navegador/celular."
        : "Permissão não concedida."
    );
  }
  const registration = await registerWorker();
  await navigator.serviceWorker.ready;
  const { getMessaging, getToken } = await import("firebase/messaging");
  const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token) throw new Error("O Firebase não liberou as notificações para este aparelho.");

  const old = currentToken();
  if (old && old !== token) await deleteDoc(doc(db, "pushTokens", old)).catch(() => {});
  await setDoc(
    doc(db, "pushTokens", token),
    {
      uid,
      nickname: nickname || "",
      prefs,
      device: isIOS() ? "iPhone/iPad" : /Android/i.test(navigator.userAgent) ? "Android" : "Computador",
      userAgent: navigator.userAgent.slice(0, 200),
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  localStorage.setItem(TOKEN_KEY, token);
  return token;
}

export async function disablePush() {
  const token = currentToken();
  localStorage.removeItem(TOKEN_KEY);
  if (!token) return;
  await deleteDoc(doc(db, "pushTokens", token)).catch(() => {});
  try {
    const { getMessaging, deleteToken } = await import("firebase/messaging");
    await deleteToken(getMessaging(app));
  } catch {
    /* já removido */
  }
}

export async function savePushPrefs(prefs) {
  const token = currentToken();
  if (!token) return;
  await updateDoc(doc(db, "pushTokens", token), { prefs, updatedAt: serverTimestamp() });
}

// Mantém o token deste aparelho atualizado (o Firebase troca de vez em quando).
export async function refreshPushToken({ uid, nickname }) {
  if (pushStatus() !== "on") return;
  try {
    const registration = await registerWorker();
    const { getMessaging, getToken } = await import("firebase/messaging");
    const token = await getToken(getMessaging(app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
    const old = currentToken();
    if (token && token !== old) {
      await deleteDoc(doc(db, "pushTokens", old)).catch(() => {});
      await setDoc(doc(db, "pushTokens", token), { uid, nickname: nickname || "", prefs: DEFAULT_PREFS, updatedAt: serverTimestamp() }, { merge: true });
      localStorage.setItem(TOKEN_KEY, token);
    } else if (token) {
      await updateDoc(doc(db, "pushTokens", token), { uid, nickname: nickname || "", updatedAt: serverTimestamp() }).catch(() => {});
    }
  } catch (e) {
    console.warn("Não consegui atualizar o aviso deste aparelho:", e);
  }
}

// Pede para avisar os OUTROS aparelhos. Nunca trava o app: se falhar, só registra no console.
// kind: "chat" | "call" | "task" | "lead" | "sale"; url: caminho dentro do app (ex.: "/chat").
export function notify({ kind, title, body = "", url = "/", tag }) {
  if (!NOTIFY_URL || !auth.currentUser) return;
  auth.currentUser
    .getIdToken()
    .then((idToken) =>
      fetch(NOTIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ kind, title: String(title).slice(0, 120), body: String(body).slice(0, 240), url, tag }),
        keepalive: true,
      })
    )
    .then((res) => {
      if (res && !res.ok) console.warn("Aviso não enviado:", res.status);
    })
    .catch((e) => console.warn("Aviso não enviado:", e));
}
