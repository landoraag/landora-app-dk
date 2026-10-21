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
  if (!(bet >= 1)) throw new Error("Aposte pelo menos 💰 1.");
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
  coinflip: "💰 Cara ou coroa",
  roulette: "🔫 Roleta russa",
  mines: "💣 Minas",
  dice: "🎲 Dados",
  slots: "🎰 Caça-níquel",
  scratch: "🎫 Raspadinha",
  hilo: "📈 Mais ou menos",
  tower: "🗼 Torre",
  daily: "🎁 Bônus diário",
  work: "💼 Trabalho",
  rob: "🕵️ Roubo",
  pay: "💸 Pagamento",
  loan: "🤝 Empréstimo",
  admin: "⚙️ Administração",
  pvp: "⚔️ Desafio",
  shop: "🛍️ Compras",
  use: "🎒 Inventário",
  charity: "💝 Caridade",
  persona: "🧑 Persona",
  levelup: "⭐ Subiu de nível",
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

/* ---------------- jogos novos: regras e probabilidades ---------------- */
// Todos pagam em média ~94-97% do que se aposta (a casa fica com 3-6%). `payout` é sempre o que
// volta para a carteira, já incluindo a aposta (como no resto do cassino).
// (usa a EDGE de cima: 3% fica com a casa)

// 💣 Minas: grade 5x5 com N minas escondidas. Cada casa segura aumenta o prêmio; saque quando quiser.
export const MINES_SIZE = 25;
export const MINES_OPTIONS = [1, 3, 5, 10];
export function minesMultiplier(mines, picks) {
  let m = EDGE;
  for (let i = 0; i < picks; i++) m *= (MINES_SIZE - i) / (MINES_SIZE - mines - i);
  return m;
}
export function placeMines(mines) {
  const cells = Array.from({ length: MINES_SIZE }, (_, i) => i);
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return new Set(cells.slice(0, mines));
}

// 🎲 Dados: sorteia de 0,00 a 99,99. "Abaixo": ganha se sair menos que a chance. "Acima": ganha se
// sair 100 menos a chance ou mais. Quanto menor a chance, maior o prêmio.
export const DICE_MIN = 2;
export const DICE_MAX = 95;
export const diceMultiplier = (chance) => (EDGE * 100) / chance;
export function rollDice() {
  return randInt(10000) / 100;
}
export const diceWins = (roll, chance, dir) => (dir === "under" ? roll < chance : roll >= 100 - chance);

// 🎰 Caça-níquel: 3 rolos. Três iguais pagam o valor do símbolo; só dois iguais pagam 1,2x.
export const SLOT_SYMBOLS = [
  { s: "🍒", w: 30, x: 5 },
  { s: "🍋", w: 24, x: 8 },
  { s: "🍉", w: 18, x: 12 },
  { s: "🔔", w: 12, x: 20 },
  { s: "⭐", w: 8, x: 40 },
  { s: "🍀", w: 5, x: 80 },
  { s: "💎", w: 3, x: 150 },
];
export const SLOT_PAIR_X = 1.2;
export function spinSlotReel() {
  let r = randInt(100);
  for (const sym of SLOT_SYMBOLS) {
    if (r < sym.w) return sym.s;
    r -= sym.w;
  }
  return SLOT_SYMBOLS[0].s;
}
export function slotsMultiplier(reels) {
  const [a, b, c] = reels;
  if (a === b && b === c) return SLOT_SYMBOLS.find((x) => x.s === a).x;
  if (a === b || b === c || a === c) return SLOT_PAIR_X;
  return 0;
}

// 🎫 Raspadinha: 6 casas. Três valores iguais ganham aquele valor da aposta. O resultado é sorteado
// antes e a cartela é montada de acordo (nunca sobra um segundo trio por acaso).
export const SCRATCH_PRIZES = [
  { x: 2, p: 0.11 },
  { x: 5, p: 0.045 },
  { x: 10, p: 0.018 },
  { x: 25, p: 0.007 },
  { x: 100, p: 0.0012 },
];
export const SCRATCH_CELLS = 6;
export function scratchCard() {
  let r = rand();
  let win = 0;
  for (const pr of SCRATCH_PRIZES) {
    if (r < pr.p) {
      win = pr.x;
      break;
    }
    r -= pr.p;
  }
  const values = SCRATCH_PRIZES.map((p) => p.x);
  const count = {};
  const cells = [];
  if (win) {
    for (let i = 0; i < 3; i++) cells.push(win);
    count[win] = 3;
  }
  while (cells.length < SCRATCH_CELLS) {
    const v = values[randInt(values.length)];
    if ((count[v] || 0) >= 2) continue;
    count[v] = (count[v] || 0) + 1;
    cells.push(v);
  }
  for (let i = cells.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [cells[i], cells[j]] = [cells[j], cells[i]];
  }
  return { cells, win };
}

// 📈 Mais ou menos: a próxima carta é maior ou menor? Empate perde. Cada acerto multiplica o prêmio
// pela chance daquele palpite (com a margem da casa). Saque quando quiser.
export const HILO_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const hiloChance = (rank, dir) => (dir === "high" ? 13 - rank : rank - 1) / 13; // rank 1..13
// hiloStep: quanto o palpite multiplica o prêmio bruto (1 / chance). A margem da casa entra uma
// vez só, no total (hiloPay), como nos outros jogos de sacar.
export const hiloStep = (rank, dir) => 1 / hiloChance(rank, dir);
export const hiloPay = (raw, streak) => (streak > 0 ? EDGE * raw : 1);
export function drawHiloRank() {
  return 1 + randInt(13);
}

// 🗼 Torre: em cada andar escolha 1 entre N casas; uma tem bomba. Sobe até o topo ou saque antes.
export const TOWER_LEVELS = 8;
export const TOWER_MODES = {
  facil: { label: "Fácil", tiles: 4 },
  medio: { label: "Médio", tiles: 3 },
  dificil: { label: "Difícil", tiles: 2 },
};
export const towerMultiplier = (mode, floors) => EDGE * Math.pow(TOWER_MODES[mode].tiles / (TOWER_MODES[mode].tiles - 1), floors);
