// Cassino do Landora: moedas de mentira, só para diversão da equipe.
//
// Carteira de cada pessoa: wallets/{uid} → { balance, nickname, photoURL, lastDaily, wins, losses, biggestWin }.
// A aposta sai da carteira quando o jogo começa (se fechar no meio, perde a aposta, como num
// cassino de verdade) e o prêmio entra quando o jogo termina. Cada resultado vira uma mensagem
// no canal #cassino.

import { addDoc, collection, doc, getDoc, increment, runTransaction, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { db } from "./firebase";

export const START_BALANCE = 1000;
export const DAILY_AMOUNT = 500;
export const CASINO_CHANNEL_ID = "cassino";
export const CASINO_CATEGORY_ID = "entretenimento";

export const ECONOMY_CHANNEL_ID = "economia";
export const isCasinoChannel = (ch) => !!ch && (ch.kind === "casino" || ch.id === CASINO_CHANNEL_ID);
export const isEconomyChannel = (ch) => !!ch && (ch.kind === "economy" || ch.id === ECONOMY_CHANNEL_ID);

// Quem administra a economia (dar/tirar moedas, zerar tudo).
export const ADMIN_EMAILS = ["muzelleitedavi@gmail.com"];
export const isAdminEmail = (email) => ADMIN_EMAILS.includes(String(email || "").toLowerCase());

export const coins = (n) => `🪙 ${Math.round(n || 0).toLocaleString("pt-BR")}`;

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
}

export async function claimDaily(uid) {
  return runTransaction(db, async (tx) => {
    const ref = walletRef(uid);
    const snap = await tx.get(ref);
    if (!snap.exists()) throw new Error("Carteira não encontrada.");
    const w = snap.data();
    if (w.lastDaily === todayKey()) throw new Error("Você já pegou o bônus de hoje. Volte amanhã!");
    tx.update(ref, { balance: (w.balance || 0) + DAILY_AMOUNT, lastDaily: todayKey() });
    return DAILY_AMOUNT;
  });
}

// Tira a aposta da carteira (falha se não tiver saldo).
export async function placeBet(uid, bet) {
  bet = Math.floor(bet);
  if (!(bet >= 1)) throw new Error("Aposte pelo menos 🪙 1.");
  return runTransaction(db, async (tx) => {
    const ref = walletRef(uid);
    const snap = await tx.get(ref);
    const bal = snap.exists() ? snap.data().balance || 0 : 0;
    if (bal < bet) throw new Error("Saldo insuficiente.");
    tx.update(ref, { balance: bal - bet });
    return bal - bet;
  });
}

// Paga o prêmio (payout = quanto volta para a carteira, já incluindo a aposta) e registra.
export async function settle(uid, bet, payout) {
  const net = payout - bet;
  const upd = net > 0 ? { wins: increment(1) } : net < 0 ? { losses: increment(1) } : {};
  if (payout > 0) upd.balance = increment(Math.floor(payout));
  if (Object.keys(upd).length) await updateDoc(walletRef(uid), upd);
  if (net > 0) {
    // maior prêmio (fora da transação: não precisa ser exato)
    const snap = await getDoc(walletRef(uid));
    if ((snap.data()?.biggestWin || 0) < net) await updateDoc(walletRef(uid), { biggestWin: net });
  }
}

// Publica o resultado no canal do cassino.
export async function postResult(user, profile, game, channelId = CASINO_CHANNEL_ID) {
  const net = Math.floor((game.payout || 0) - (game.bet || 0));
  const verb = game.text || (net > 0 ? `ganhou ${coins(net)}` : net < 0 ? `perdeu ${coins(-net)}` : "empatou");
  await addDoc(collection(db, "chatMessages"), {
    channelId,
    text: `${GAME_NAMES[game.type] || "🎲"} — ${profile?.nickname || "Alguém"} ${verb}`,
    game: { ...game, net },
    senderId: user.uid,
    senderNickname: profile?.nickname || "—",
    createdAt: serverTimestamp(),
  });
}

export const GAME_NAMES = {
  blackjack: "🃏 Blackjack",
  chicken: "🐔 Galinha",
  coinflip: "🪙 Cara ou coroa",
  roulette: "🔫 Roleta russa",
  daily: "🎁 Bônus diário",
  work: "💼 Trabalho",
  rob: "🦹 Roubo",
  pay: "💸 Pagamento",
  loan: "🤝 Empréstimo",
  admin: "⚙️ Administração",
  pvp: "⚔️ Desafio",
};

/* ---------------- Blackjack ---------------- */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

export function newDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ r, s });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function handValue(cards) {
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    if (c.r === "A") {
      aces += 1;
      total += 11;
    } else if (["J", "Q", "K"].includes(c.r)) total += 10;
    else total += Number(c.r);
  }
  while (total > 21 && aces > 0) {
    total -= 10;
    aces -= 1;
  }
  return { total, soft: aces > 0 };
}
export const isBlackjack = (cards) => cards.length === 2 && handValue(cards).total === 21;

// Banca compra até 17 (para em 17 "mole" também).
export function dealerPlay(dealer, deck) {
  const d = [...dealer];
  const k = [...deck];
  while (handValue(d).total < 17) d.push(k.pop());
  return { dealer: d, deck: k };
}

/* ---------------- Galinha ---------------- */
// Cada faixa atravessada multiplica o prêmio. Quanto mais difícil, maior a chance de ser
// atropelada em cada faixa, e mais rápido o prêmio cresce.
export const CHICKEN_LEVELS = {
  facil: { label: "Fácil", risk: 0.06, lanes: 20 },
  medio: { label: "Médio", risk: 0.14, lanes: 16 },
  dificil: { label: "Difícil", risk: 0.24, lanes: 12 },
  insano: { label: "Insano", risk: 0.38, lanes: 9 },
};
const EDGE = 0.97; // 3% fica com a casa
export const chickenMultiplier = (level, steps) =>
  steps <= 0 ? 1 : Math.floor((EDGE / Math.pow(1 - CHICKEN_LEVELS[level].risk, steps)) * 100) / 100;

/* ---------------- Cara ou coroa ---------------- */
export const COINFLIP_PAYOUT = 1.96;

/* ---------------- Roleta russa ---------------- */
// Tambor de 6 com 1 bala. Cada puxada que passa aumenta o prêmio; dá para sacar a qualquer hora.
export const ROULETTE_CHAMBERS = 6;
export const rouletteMultiplier = (survived) =>
  survived <= 0 ? 1 : Math.floor(((EDGE * ROULETTE_CHAMBERS) / (ROULETTE_CHAMBERS - survived)) * 100) / 100;
