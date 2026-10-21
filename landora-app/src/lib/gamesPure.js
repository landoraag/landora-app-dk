// Regras e probabilidades dos jogos novos do cassino (Roleta, Bacará, Vídeo Poker, Crash, Plinko,
// Keno, Bingo, Truco e Uno). Aqui não tem Firebase nem React: só lógica pura, para ser usada tanto
// pelos jogos solo (components/Casino*.jsx) quanto pelas mesas de desafio (lib/tablesMore.js).
//
// Todos pagam em média ~95-97% do que se aposta. `payout` é sempre o que volta para a carteira,
// já incluindo a aposta (como no resto do cassino).

export const EDGE = 0.97;

export function rand() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0] / 2 ** 32;
}
export const randInt = (n) => Math.floor(rand() * n);
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
const choose = (n, k) => {
  if (k < 0 || k > n) return 0;
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

/* ======================= baralho comum (52 cartas) ======================= */
const SUITS = ["♠", "♥", "♦", "♣"];
const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export function deck52() {
  const d = [];
  for (const s of SUITS) for (const r of RANKS) d.push({ r, s });
  return shuffle(d);
}

/* ======================= 🎡 Roleta (europeia, 0 a 36) ======================= */
export const WHEEL_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
export const wheelColor = (n) => (n === 0 ? "green" : WHEEL_RED.has(n) ? "red" : "black");
// ordem real dos números na roda (usada na animação e no "mais perto" dos desafios)
export const WHEEL_ORDER = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
export const WHEEL_BETS = [
  { id: "red", label: "Vermelho", x: 2, test: (n) => WHEEL_RED.has(n) },
  { id: "black", label: "Preto", x: 2, test: (n) => n > 0 && !WHEEL_RED.has(n) },
  { id: "even", label: "Par", x: 2, test: (n) => n > 0 && n % 2 === 0 },
  { id: "odd", label: "Ímpar", x: 2, test: (n) => n % 2 === 1 },
  { id: "low", label: "1–18", x: 2, test: (n) => n >= 1 && n <= 18 },
  { id: "high", label: "19–36", x: 2, test: (n) => n >= 19 },
  { id: "d1", label: "1ª dúzia", x: 3, test: (n) => n >= 1 && n <= 12 },
  { id: "d2", label: "2ª dúzia", x: 3, test: (n) => n >= 13 && n <= 24 },
  { id: "d3", label: "3ª dúzia", x: 3, test: (n) => n >= 25 },
];
export const WHEEL_NUMBER_X = 36;
// bet: { kind: "bet", id } ou { kind: "number", n }
export function wheelPayoutX(bet, result) {
  if (bet.kind === "number") return bet.n === result ? WHEEL_NUMBER_X : 0;
  const b = WHEEL_BETS.find((x) => x.id === bet.id);
  return b && b.test(result) ? b.x : 0;
}
// distância circular na roda: usada para saber quem chegou mais perto da bolinha
export function wheelDistance(a, b) {
  const n = WHEEL_ORDER.length;
  const d = Math.abs(WHEEL_ORDER.indexOf(a) - WHEEL_ORDER.indexOf(b));
  return Math.min(d, n - d);
}

/* ======================= 🎴 Bacará (punto banco) ======================= */
const bcVal = (c) => (c.r === "A" ? 1 : ["10", "J", "Q", "K"].includes(c.r) ? 0 : Number(c.r));
export const bcTotal = (cards) => cards.reduce((s, c) => s + bcVal(c), 0) % 10;
export const BC_PAY = { player: 2, banker: 1.95, tie: 9 };
export function playBaccarat(deck = deck52()) {
  const player = [deck.pop(), deck.pop()];
  const banker = [deck.pop(), deck.pop()];
  let pt = bcTotal(player);
  let bt = bcTotal(banker);
  if (pt < 8 && bt < 8) {
    let p3 = null;
    if (pt <= 5) {
      p3 = deck.pop();
      player.push(p3);
      pt = bcTotal(player);
    }
    let bankerDraws = false;
    if (p3 === null) bankerDraws = bt <= 5;
    else {
      const v = bcVal(p3);
      if (bt <= 2) bankerDraws = true;
      else if (bt === 3) bankerDraws = v !== 8;
      else if (bt === 4) bankerDraws = v >= 2 && v <= 7;
      else if (bt === 5) bankerDraws = v >= 4 && v <= 7;
      else if (bt === 6) bankerDraws = v === 6 || v === 7;
    }
    if (bankerDraws) {
      banker.push(deck.pop());
      bt = bcTotal(banker);
    }
  }
  return { player, banker, pt, bt, winner: pt > bt ? "player" : bt > pt ? "banker" : "tie" };
}
// multiplicador final de uma aposta no bacará (empate devolve a aposta de Jogador/Banca)
export function baccaratX(pick, winner) {
  if (pick === "tie") return winner === "tie" ? BC_PAY.tie : 0;
  if (winner === "tie") return 1;
  return pick === winner ? BC_PAY[pick] : 0;
}

/* ======================= ♠️ Poker de 5 cartas / Vídeo Poker ======================= */
const RV = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14 };
export const POKER_NAMES = ["Carta alta", "Par", "Dois pares", "Trinca", "Sequência", "Flush", "Full house", "Quadra", "Straight flush", "Royal flush"];
// devolve { cat: 0..9, key: [...] }; compare com cmpPoker (maior = melhor mão)
export function evalPoker(cards) {
  const vals = cards.map((c) => RV[c.r]).sort((a, b) => b - a);
  const flush = cards.every((c) => c.s === cards[0].s);
  const uniq = [...new Set(vals)];
  let straightHigh = 0;
  if (uniq.length === 5) {
    if (vals[0] - vals[4] === 4) straightHigh = vals[0];
    else if (vals[0] === 14 && vals[1] === 5 && vals[4] === 2) straightHigh = 5; // A-2-3-4-5
  }
  const count = {};
  for (const v of vals) count[v] = (count[v] || 0) + 1;
  // grupos ordenados por quantidade e depois pelo valor
  const groups = Object.entries(count)
    .map(([v, n]) => ({ v: Number(v), n }))
    .sort((a, b) => b.n - a.n || b.v - a.v);
  const key = groups.flatMap((g) => Array(1).fill(g.v));
  let cat = 0;
  if (straightHigh && flush) cat = straightHigh === 14 ? 9 : 8;
  else if (groups[0].n === 4) cat = 7;
  else if (groups[0].n === 3 && groups[1]?.n === 2) cat = 6;
  else if (flush) cat = 5;
  else if (straightHigh) cat = 4;
  else if (groups[0].n === 3) cat = 3;
  else if (groups[0].n === 2 && groups[1]?.n === 2) cat = 2;
  else if (groups[0].n === 2) cat = 1;
  return { cat, key: straightHigh ? [straightHigh] : key, pairRank: groups[0].n === 2 ? groups[0].v : 0 };
}
export function cmpPoker(a, b) {
  if (a.cat !== b.cat) return a.cat - b.cat;
  for (let i = 0; i < Math.max(a.key.length, b.key.length); i++) {
    const d = (a.key[i] || 0) - (b.key[i] || 0);
    if (d) return d;
  }
  return 0;
}
// Vídeo Poker: "Jacks or Better" (par de valetes ou melhor paga 1x = devolve a aposta)
export const VPOKER_PAY = [
  { cat: 9, x: 250 },
  { cat: 8, x: 50 },
  { cat: 7, x: 25 },
  { cat: 6, x: 9 },
  { cat: 5, x: 6 },
  { cat: 4, x: 4 },
  { cat: 3, x: 3 },
  { cat: 2, x: 2 },
  { cat: 1, x: 1, minPair: 11 },
];
export function videoPokerX(cards) {
  const ev = evalPoker(cards);
  for (const p of VPOKER_PAY) {
    if (ev.cat === p.cat && (!p.minPair || ev.pairRank >= p.minPair)) return { x: p.x, name: p.cat === 1 ? "Par de valetes ou melhor" : POKER_NAMES[p.cat], ev };
  }
  return { x: 0, name: ev.cat === 1 ? "Par baixo" : POKER_NAMES[ev.cat], ev };
}

/* ======================= 🚀 Crash ======================= */
export const CRASH_RATE = 0.12; // o foguete sobe como e^(0,12 × segundos)
export const crashMultiplierAt = (seconds) => Math.exp(CRASH_RATE * Math.max(0, seconds));
export const crashSecondsFor = (mult) => Math.log(Math.max(1, mult)) / CRASH_RATE;
export function crashPoint() {
  const u = rand();
  return Math.min(1000, Math.max(1, Math.floor((EDGE * 100) / (1 - u)) / 100));
}

/* ======================= 🔻 Plinko ======================= */
export const PLINKO_ROWS = 10;
export const PLINKO_RISKS = {
  baixo: { label: "Baixo", s: 0.33 },
  medio: { label: "Médio", s: 0.62 },
  alto: { label: "Alto", s: 0.8 },
};
// multiplicadores de cada casa (11 casas), calibrados para pagar ~EDGE em média
export const plinkoTable = (() => {
  const mid = PLINKO_ROWS / 2;
  const out = {};
  for (const [k, { s }] of Object.entries(PLINKO_RISKS)) {
    const shape = Array.from({ length: PLINKO_ROWS + 1 }, (_, i) => Math.exp(s * Math.pow(Math.abs(i - mid), 1.35)));
    const p = Array.from({ length: PLINKO_ROWS + 1 }, (_, i) => choose(PLINKO_ROWS, i) / 2 ** PLINKO_ROWS);
    const scale = EDGE / shape.reduce((sum, v, i) => sum + v * p[i], 0);
    out[k] = shape.map((v) => Math.round(v * scale * 100) / 100);
  }
  return out;
})();
export function plinkoDrop() {
  const path = Array.from({ length: PLINKO_ROWS }, () => (rand() < 0.5 ? 0 : 1));
  return { path, slot: path.reduce((a, b) => a + b, 0) };
}

/* ======================= 🔢 Keno ======================= */
export const KENO_POOL = 40;
export const KENO_DRAW = 10;
export const KENO_MAX_PICKS = 5;
const kenoMinHits = (n) => (n <= 1 ? 1 : n === 2 ? 2 : n === 3 ? 2 : Math.floor(n / 2) + 1);
// tabela[n][h] = multiplicador com n números escolhidos e h acertos
export const kenoTable = (() => {
  const out = {};
  for (let n = 1; n <= KENO_MAX_PICKS; n++) {
    const probs = [];
    for (let h = 0; h <= Math.min(n, KENO_DRAW); h++) probs.push((choose(n, h) * choose(KENO_POOL - n, KENO_DRAW - h)) / choose(KENO_POOL, KENO_DRAW));
    const min = kenoMinHits(n);
    const raw = probs.map((p, h) => (h >= min ? Math.pow(1 / p, 0.8) : 0));
    const scale = 0.95 / raw.reduce((s, v, h) => s + v * probs[h], 0);
    out[n] = raw.map((v) => Math.min(1000, Math.round(v * scale * 100) / 100));
  }
  return out;
})();
export const kenoDraw = () => shuffle(Array.from({ length: KENO_POOL }, (_, i) => i + 1)).slice(0, KENO_DRAW);
export const kenoRandomPicks = (n) => shuffle(Array.from({ length: KENO_POOL }, (_, i) => i + 1)).slice(0, n);

/* ======================= 🎱 Bingo (cartela 5x5, 75 bolas) ======================= */
export const BINGO_LETTERS = ["B", "I", "N", "G", "O"];
export const BINGO_BALLS_SOLO = 40;
// cartela: 5 colunas (B=1-15, I=16-30, N=31-45, G=46-60, O=61-75); centro livre (null)
export function bingoCard() {
  const cols = BINGO_LETTERS.map((_, c) => shuffle(Array.from({ length: 15 }, (_, i) => c * 15 + i + 1)).slice(0, 5));
  return Array.from({ length: 5 }, (_, r) => cols.map((col, c) => (r === 2 && c === 2 ? null : col[r])));
}
const BINGO_LINES = (() => {
  const L = [];
  for (let i = 0; i < 5; i++) {
    L.push(Array.from({ length: 5 }, (_, j) => [i, j]));
    L.push(Array.from({ length: 5 }, (_, j) => [j, i]));
  }
  L.push(Array.from({ length: 5 }, (_, j) => [j, j]));
  L.push(Array.from({ length: 5 }, (_, j) => [j, 4 - j]));
  return L;
})();
export function bingoLinesDone(card, drawn) {
  const set = drawn instanceof Set ? drawn : new Set(drawn);
  return BINGO_LINES.filter((line) => line.every(([r, c]) => card[r][c] === null || set.has(card[r][c]))).length;
}
export const bingoFull = (card, drawn) => {
  const set = drawn instanceof Set ? drawn : new Set(drawn);
  return card.every((row) => row.every((n) => n === null || set.has(n)));
};
export const bingoOrder = () => shuffle(Array.from({ length: 75 }, (_, i) => i + 1));
export const bingoLetter = (n) => BINGO_LETTERS[Math.min(4, Math.floor((n - 1) / 15))];
// pagamento do bingo solo (linhas completas dentro das BINGO_BALLS_SOLO primeiras bolas)
export const BINGO_PAY = [
  { lines: 1, x: 1.5 },
  { lines: 2, x: 2.5 },
  { lines: 3, x: 6 },
  { lines: 4, x: 15 },
  { lines: 5, x: 40 },
  { lines: 6, x: 120 },
];
export const bingoPayX = (lines) => {
  let x = 0;
  for (const p of BINGO_PAY) if (lines >= p.lines) x = p.x;
  return x;
};

/* ======================= ♣️ Truco paulista (2 jogadores) ======================= */
export const TRUCO_RANKS = ["4", "5", "6", "7", "Q", "J", "K", "A", "2", "3"]; // do mais fraco ao mais forte
export const TRUCO_SUITS = ["♦", "♠", "♥", "♣"]; // ordem das manilhas: ouros < espadas < copas < paus (zap)
const TRUCO_NEXT = { 1: 3, 3: 6, 6: 9, 9: 12 };
export const TRUCO_CALL_NAME = { 3: "TRUCO!", 6: "SEIS!", 9: "NOVE!", 12: "DOZE!" };
export function trucoDeck() {
  const d = [];
  for (const s of TRUCO_SUITS) for (const r of TRUCO_RANKS) d.push({ r, s });
  return shuffle(d);
}
export const trucoManilhaRank = (vira) => TRUCO_RANKS[(TRUCO_RANKS.indexOf(vira.r) + 1) % TRUCO_RANKS.length];
export const trucoStrength = (card, manilha) => (card.r === manilha ? 100 + TRUCO_SUITS.indexOf(card.s) : TRUCO_RANKS.indexOf(card.r));

function trucoDealHand(st, mao) {
  const deck = trucoDeck();
  const vira = deck.pop();
  return {
    ...st,
    hand: {
      cards: [[deck.pop(), deck.pop(), deck.pop()], [deck.pop(), deck.pop(), deck.pop()]],
      vira,
      manilha: trucoManilhaRank(vira),
      cur: [null, null], // cartas jogadas na vaza atual
      vazas: [], // [{ winner: 0|1|-1, plays: [c0, c1] }]
      mao,
      lead: mao, // quem abre a vaza atual
      turn: mao,
      value: 1,
      lastRaiser: -1,
      pending: null, // { from, value }
    },
  };
}
// target: pontos para ganhar a partida (12 completo, 6 rápido)
export function trucoNew(target = 12) {
  const mao = randInt(2);
  return { ...trucoDealHand({ target, score: [0, 0], over: false, winner: null, log: "", handNo: 1 }, mao) };
}
export function trucoHandWinner(vazas, mao) {
  const w = vazas.map((v) => v.winner);
  const [a, b, c] = w;
  const w0 = w.filter((x) => x === 0).length;
  const w1 = w.filter((x) => x === 1).length;
  if (vazas.length >= 2) {
    if (w0 >= 2) return 0;
    if (w1 >= 2) return 1;
    if (a === -1 && b !== -1) return b;
    if (a !== -1 && b === -1) return a;
    if (a === -1 && b === -1) return vazas.length === 3 ? (c !== -1 ? c : mao) : null;
  }
  if (vazas.length === 3) return c !== -1 ? c : a;
  return null;
}
// why: "play" (ganhou jogando) ou "run" (o outro correu). A UI monta a frase com os nomes.
function trucoEndHand(st, winner, pts, why) {
  const score = [...st.score];
  score[winner] += pts;
  const lastHand = { winner, pts, why };
  if (score[winner] >= st.target) return { ...st, score, over: true, winner, lastHand, hand: { ...st.hand, ended: true } };
  return { ...trucoDealHand({ ...st, score, handNo: st.handNo + 1 }, 1 - st.hand.mao), lastHand };
}
// p joga a carta de índice idx
export function trucoPlay(st, p, idx) {
  const h = st.hand;
  if (st.over || h.pending || h.turn !== p) throw new Error("Não é a sua vez.");
  const card = h.cards[p][idx];
  if (!card) throw new Error("Carta inválida.");
  const cards = h.cards.map((c) => [...c]);
  cards[p].splice(idx, 1);
  const cur = [...h.cur];
  cur[p] = card;
  if (cur[0] && cur[1]) {
    const s0 = trucoStrength(cur[0], h.manilha);
    const s1 = trucoStrength(cur[1], h.manilha);
    const winner = s0 === s1 ? -1 : s0 > s1 ? 0 : 1;
    const vazas = [...h.vazas, { winner, plays: [cur[0], cur[1]] }];
    const hw = trucoHandWinner(vazas, h.mao);
    const lead = winner === -1 ? h.lead : winner; // empate: abre quem já abriu
    const nh = { ...h, cards, cur: [null, null], vazas, lead, turn: lead };
    const lastVaza = { plays: [cur[0], cur[1]], winner }; // a UI mostra a última vaza mesmo depois da mão acabar
    if (hw != null) return trucoEndHand({ ...st, hand: nh, lastVaza }, hw, h.value, "play");
    return { ...st, hand: nh, lastVaza, log: "" };
  }
  return { ...st, hand: { ...h, cards, cur, turn: 1 - p }, log: "" };
}
export const trucoCanRaise = (st, p) => {
  const h = st.hand;
  return !st.over && !h.pending && h.turn === p && h.value < 12 && h.lastRaiser !== p;
};
export function trucoRaise(st, p) {
  if (!trucoCanRaise(st, p)) throw new Error("Você não pode pedir agora.");
  const h = st.hand;
  return { ...st, hand: { ...h, pending: { from: p, value: TRUCO_NEXT[h.value] } }, log: TRUCO_CALL_NAME[TRUCO_NEXT[h.value]] };
}
// p responde ao pedido do adversário: "accept" | "run" | "raise"
export function trucoRespond(st, p, action) {
  const h = st.hand;
  if (st.over || !h.pending || h.pending.from === p) throw new Error("Não há pedido para você responder.");
  const pend = h.pending;
  if (action === "accept") return { ...st, hand: { ...h, value: pend.value, lastRaiser: pend.from, pending: null, turn: pend.from }, log: "Aceitou!" };
  if (action === "run") return trucoEndHand(st, pend.from, h.value, "run");
  if (action === "raise") {
    const nv = TRUCO_NEXT[pend.value];
    if (!nv) throw new Error("Não dá para aumentar mais.");
    return { ...st, hand: { ...h, value: pend.value, lastRaiser: pend.from, pending: { from: p, value: nv } }, log: TRUCO_CALL_NAME[nv] };
  }
  throw new Error("Ação inválida.");
}
// quem precisa agir agora: quem responde a um pedido ou, sem pedido, o dono da vez
export const trucoActor = (st) => (st.hand.pending ? 1 - st.hand.pending.from : st.hand.turn);
export function applyTruco(st, p, a) {
  if (a.type === "play") return trucoPlay(st, p, a.idx);
  if (a.type === "raise") return trucoRaise(st, p);
  if (a.type === "accept") return trucoRespond(st, p, "accept");
  if (a.type === "run") return trucoRespond(st, p, "run");
  if (a.type === "raise_back") return trucoRespond(st, p, "raise");
  throw new Error("Ação inválida.");
}
// O Firestore não aceita array dentro de array: a mão de cada jogador vira {0: [...], 1: [...]}
export const trucoPack = (st) => ({ ...st, hand: { ...st.hand, cards: { 0: st.hand.cards[0], 1: st.hand.cards[1] } } });
export const trucoUnpack = (st) => ({ ...st, hand: { ...st.hand, cards: [st.hand.cards[0], st.hand.cards[1]] } });
// idem para a cartela do bingo (5x5 vira uma lista de 25, linha por linha)
export const bingoFlat = (card) => card.flat();
export const bingoGrid = (flat) => Array.from({ length: 5 }, (_, r) => flat.slice(r * 5, r * 5 + 5));

// Bot do truco: devolve { type: "play", idx } | { type: "raise" } | { type: "accept" | "run" | "raise_back" }
export function trucoBot(st, p) {
  const h = st.hand;
  const mine = h.cards[p];
  const str = mine.map((c) => trucoStrength(c, h.manilha));
  const norm = (s) => (s >= 100 ? 10 + (s - 100) : s); // manilha vale mais que qualquer outra
  const sorted = [...str].sort((a, b) => b - a);
  const power = (sorted[0] != null ? norm(sorted[0]) : 0) * 0.6 + (sorted[1] != null ? norm(sorted[1]) : 0) * 0.4; // 0..~13
  if (h.pending && h.pending.from !== p) {
    const v = h.pending.value;
    const need = v === 3 ? 8.2 : v === 6 ? 9.6 : v === 9 ? 11 : 12;
    const bluff = rand() < 0.1;
    if (power >= need + 2.2 && h.pending.value < 12 && h.lastRaiser !== p && rand() < 0.45) return { type: "raise_back" };
    return power >= need - (h.vazas.some((x) => x.winner === p) ? 2 : 0) || bluff ? { type: "accept" } : { type: "run" };
  }
  // posso pedir?
  if (trucoCanRaise(st, p)) {
    const need = h.value === 1 ? 9.8 : h.value === 3 ? 11.2 : 12.4;
    const won = h.vazas.filter((x) => x.winner === p).length;
    if ((power + won * 1.5 >= need && rand() < 0.55) || rand() < 0.04) return { type: "raise" };
  }
  // qual carta jogar
  const opp = h.cur[1 - p];
  const order = mine.map((c, i) => ({ i, s: str[i] })).sort((a, b) => a.s - b.s);
  if (opp) {
    const os = trucoStrength(opp, h.manilha);
    const beat = order.find((x) => x.s > os);
    return { type: "play", idx: (beat || order[0]).i };
  }
  if (h.vazas.length === 0) return { type: "play", idx: (order.length > 1 && rand() < 0.5 ? order[order.length - 2] : order[order.length - 1]).i };
  return { type: "play", idx: order[order.length - 1].i };
}

/* ======================= 🟥 Uno ======================= */
export const UNO_COLORS = ["R", "Y", "G", "B"];
export const UNO_COLOR_NAME = { R: "Vermelho", Y: "Amarelo", G: "Verde", B: "Azul" };
export function unoDeck() {
  const d = [];
  for (const c of UNO_COLORS) {
    d.push({ c, v: "0" });
    for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) d.push({ c, v: String(n) });
    for (const v of ["S", "R", "D"]) for (let k = 0; k < 2; k++) d.push({ c, v });
  }
  for (let k = 0; k < 4; k++) {
    d.push({ c: "W", v: "W" });
    d.push({ c: "W", v: "F" });
  }
  return shuffle(d);
}
export const unoLabel = (card) => (card.v === "S" ? "⊘" : card.v === "R" ? "⇄" : card.v === "D" ? "+2" : card.v === "W" ? "★" : card.v === "F" ? "+4" : card.v);
// jogada legal? (+4 só se não houver carta da cor atual)
export function unoCanPlay(card, st, hand) {
  if (card.c === "W") {
    if (card.v === "F") return !hand.some((c) => c.c === st.color);
    return true;
  }
  return card.c === st.color || card.v === st.top.v;
}
export function unoNew(players) {
  let draw = unoDeck();
  const hands = {};
  for (const id of players) hands[id] = Array.from({ length: 7 }, () => draw.pop());
  let first = draw.pop();
  while (first.c === "W" || ["S", "R", "D"].includes(first.v)) {
    draw = shuffle([first, ...draw]);
    first = draw.pop();
  }
  return { players, hands, draw, discard: [first], top: first, color: first.c, dir: 1, turn: 0, drawn: false, winner: null, log: "", turnAt: Date.now() };
}
function unoTake(st, n) {
  // devolve [cartas, estado] — reembaralha o descarte quando o monte acaba
  let draw = [...st.draw];
  let discard = [...st.discard];
  const got = [];
  for (let i = 0; i < n; i++) {
    if (!draw.length) {
      const keep = discard.pop();
      draw = shuffle(discard);
      discard = [keep];
    }
    if (draw.length) got.push(draw.pop());
  }
  return [got, { ...st, draw, discard }];
}
const unoNextIdx = (st, from, steps = 1) => {
  const n = st.players.length;
  return (((from + st.dir * steps) % n) + n) % n;
};
export function unoPlay(st, uid, idx, chosenColor) {
  const me = st.players.indexOf(uid);
  if (st.winner || me !== st.turn) throw new Error("Não é a sua vez.");
  const hand = st.hands[uid];
  const card = hand[idx];
  if (!card) throw new Error("Carta inválida.");
  if (st.drawn && idx !== hand.length - 1) throw new Error("Jogue a carta que comprou ou passe a vez.");
  if (!unoCanPlay(card, st, hand)) throw new Error("Essa carta não pode ser jogada agora.");
  if (card.c === "W" && !UNO_COLORS.includes(chosenColor)) throw new Error("Escolha uma cor.");
  let ns = { ...st, hands: { ...st.hands, [uid]: hand.filter((_, i) => i !== idx) }, discard: [...st.discard, card], top: card, color: card.c === "W" ? chosenColor : card.c, drawn: false, turnAt: Date.now() };
  let log = "";
  if (!ns.hands[uid].length) return { ...ns, winner: uid, log: "UNO! Acabaram as cartas!" };
  let steps = 1;
  if (card.v === "R") {
    if (st.players.length === 2) steps = 2;
    else ns.dir = -st.dir;
    log = "Inverteu!";
  } else if (card.v === "S") {
    steps = 2;
    log = "Pulou a vez!";
  } else if (card.v === "D" || card.v === "F") {
    const victim = st.players[unoNextIdx(ns, me)];
    const [got, s2] = unoTake(ns, card.v === "D" ? 2 : 4);
    ns = { ...s2, hands: { ...s2.hands, [victim]: [...s2.hands[victim], ...got] } };
    steps = 2;
    log = card.v === "D" ? "+2!" : "+4!";
  }
  ns.turn = unoNextIdx(ns, me, steps);
  if (ns.hands[uid].length === 1) log = (log ? log + " " : "") + "UNO!";
  return { ...ns, log };
}
// compra 1 carta; se der para jogar, o jogador decide entre jogar ou passar
export function unoDraw(st, uid) {
  const me = st.players.indexOf(uid);
  if (st.winner || me !== st.turn) throw new Error("Não é a sua vez.");
  if (st.drawn) throw new Error("Você já comprou. Jogue a carta ou passe a vez.");
  const [got, s2] = unoTake(st, 1);
  const hand = [...s2.hands[uid], ...got];
  const ns = { ...s2, hands: { ...s2.hands, [uid]: hand }, log: "Comprou uma carta", turnAt: Date.now() };
  const c = got[0];
  if (c && unoCanPlay(c, ns, hand)) return { ...ns, drawn: true };
  return { ...ns, drawn: false, turn: unoNextIdx(ns, me) };
}
export function unoPass(st, uid) {
  const me = st.players.indexOf(uid);
  if (st.winner || me !== st.turn) throw new Error("Não é a sua vez.");
  if (!st.drawn) throw new Error("Compre uma carta antes de passar.");
  return { ...st, drawn: false, turn: unoNextIdx(st, me), log: "Passou a vez", turnAt: Date.now() };
}
export function unoBot(st, uid) {
  const hand = st.hands[uid];
  if (st.drawn) {
    // acabou de comprar: joga se der (é sempre a última carta)
    const c = hand[hand.length - 1];
    if (unoCanPlay(c, st, hand)) return { type: "play", idx: hand.length - 1, color: bestColor(hand) };
    return { type: "pass" };
  }
  const playable = hand.map((c, i) => ({ c, i })).filter((x) => unoCanPlay(x.c, st, hand));
  if (!playable.length) return { type: "draw" };
  // prefere cartas de ação quando o adversário está perto de ganhar; coringas por último
  const next = st.players[unoNextIdx(st, st.players.indexOf(uid))];
  const danger = st.hands[next].length <= 2;
  const score = (x) => (x.c.c === "W" ? (danger ? 2 : -3) : ["S", "R", "D"].includes(x.c.v) ? (danger ? 4 : 1) : 0) + rand();
  playable.sort((a, b) => score(b) - score(a));
  const pick = playable[0];
  return { type: "play", idx: pick.i, color: bestColor(hand.filter((_, i) => i !== pick.i)) };
}
function bestColor(hand) {
  const n = { R: 0, Y: 0, G: 0, B: 0 };
  for (const c of hand) if (n[c.c] != null) n[c.c]++;
  const max = Math.max(...Object.values(n));
  const best = UNO_COLORS.filter((c) => n[c] === max);
  return best[randInt(best.length)];
}
