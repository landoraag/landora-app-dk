// Cassino do Landora: moedas de mentira, só para diversão da equipe.
//
// Carteira de cada pessoa: wallets/{uid} → { balance, nickname, photoURL, lastDaily, wins, losses, biggestWin }.
// A aposta sai da carteira quando o jogo começa (se fechar no meio, perde a aposta, como num
// cassino de verdade) e o prêmio entra quando o jogo termina. Cada resultado vira uma mensagem
// no canal #cassino.

import { addDoc, collection, deleteDoc, doc, getDoc, getDocs, increment, runTransaction, serverTimestamp, setDoc, updateDoc, writeBatch } from "firebase/firestore";
import { db } from "./firebase";

export const START_BALANCE = 22000;
export const DAILY_AMOUNT = 500;
export const CASINO_CHANNEL_ID = "cassino";
export const CASINO_CATEGORY_ID = "entretenimento";

export const ECONOMY_CHANNEL_ID = "economia";
export const isCasinoChannel = (ch) => !!ch && (ch.kind === "casino" || ch.id === CASINO_CHANNEL_ID);
export const isEconomyChannel = (ch) => !!ch && (ch.kind === "economy" || ch.id === ECONOMY_CHANNEL_ID);

// Quem administra a economia (dar/tirar moedas, zerar tudo). Por enquanto ninguém: o modo admin
// do Davi foi removido (aqui e em firestore.rules). Para dar o poder a alguém, ponha o e-mail aqui
// E na função isEconomyAdmin() de firestore.rules.
export const ADMIN_EMAILS = [];
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || "").toLowerCase());

export const coins = (n) => `💰 ${Math.round(n || 0).toLocaleString("pt-BR")}`;

// Número aleatório "de verdade" (não dá para prever como o Math.random).
export function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}
export const randInt = (n) => Math.floor(rand() * n);

const todayKey = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
export const canClaimDaily = (wallet) => !!wallet && wallet.lastDaily !== todayKey();

/* ---------------- carteira ---------------- */
export const walletRef = (uid) => doc(db, "wallets", uid);

// Cria a carteira na primeira vez (com saldo inicial) e mantém nome/foto atualizados.
export async function ensureWallet(user, profile) {
  if (!user?.uid) return;
  const ref = walletRef(user.uid);
  const snap = await getDoc(ref);
  const info = { nickname: profile?.nickname || "—", photoURL: profile?.photoURL || "" };
  if (!snap.exists()) {
    await setDoc(ref, { ...info, balance: START_BALANCE, bank: 0, lastDaily: "", wins: 0, losses: 0, biggestWin: 0, createdAt: serverTimestamp() });
  } else {
    const d = snap.data();
    if (d.nickname !== info.nickname || d.photoURL !== info.photoURL) await updateDoc(ref, info);
  }
  // Zera a economia uma única vez para todo mundo (ver abaixo). Não trava a abertura da tela.
  runEconomyResetOnce()
    .then(() => runSocialResetOnce())
    .catch((e) => console.error("reset da economia:", e));
}

/* ---------------- resets únicos da economia ---------------- */
// Quem abrir a economia/cassino primeiro depois da atualização roda o reset (não há mais admin).
// A marca meta/{id} garante que cada reset rode uma vez só; se der erro, a marca some e outra
// pessoa tenta de novo.
async function runOnce(id, job) {
  const mark = doc(db, "meta", id);
  const claimed = await runTransaction(db, async (tx) => {
    if ((await tx.get(mark)).exists()) return false;
    tx.set(mark, { status: "running", startedAt: Date.now() });
    return true;
  });
  if (!claimed) return false;
  try {
    const info = await job();
    await updateDoc(mark, { status: "done", finishedAt: Date.now(), ...info });
    return true;
  } catch (e) {
    await deleteDoc(mark).catch(() => {});
    throw e;
  }
}
async function commitInChunks(ops) {
  for (let i = 0; i < ops.length; i += 400) {
    const batch = writeBatch(db);
    ops.slice(i, i + 400).forEach(([ref, data]) => batch.update(ref, data));
    await batch.commit();
  }
}

// 21/10/2026 (1): todo mundo volta para 🪙 22.000 na carteira, banco zerado e nível 1 (XP zerado).
// Empréstimos em aberto são cancelados (as carteiras foram zeradas, as dívidas não fazem sentido).
export const runEconomyResetOnce = () =>
  runOnce("economia-22k-2026-10-21", async () => {
    const [wallets, loans] = await Promise.all([getDocs(collection(db, "wallets")), getDocs(collection(db, "loans"))]);
    await commitInChunks([
      ...wallets.docs.map((d) => [d.ref, { balance: START_BALANCE, bank: 0, xp: 0, lastWork: 0 }]),
      ...loans.docs.filter((d) => ["pending", "active"].includes(d.data().status)).map((d) => [d.ref, { status: "cancelled" }]),
    ]);
    return { wallets: wallets.size };
  });

// 21/10/2026 (2): pontos sociais e o quanto cada um doou voltam a zero, e o total arrecadado de
// cada causa da caridade também. Itens, cursos, casa, carro e persona continuam.
export const runSocialResetOnce = () =>
  runOnce("economia-social-2026-10-21", async () => {
    const [wallets, causes] = await Promise.all([getDocs(collection(db, "wallets")), getDocs(collection(db, "charity"))]);
    await commitInChunks([
      ...wallets.docs.map((d) => [d.ref, { social: 0, donated: 0 }]),
      ...causes.docs.map((d) => [d.ref, { total: 0, donations: 0 }]),
    ]);
    return { wallets: wallets.size, causes: causes.size };
  });
