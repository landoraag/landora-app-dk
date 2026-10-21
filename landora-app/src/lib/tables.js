// Mesas de desafio (jogador contra jogador) do cassino: casinoTables/{id}.
//
// Todo mundo aposta o mesmo valor. A aposta sai da carteira de cada um ao entrar na mesa (fica
// "no pote") e o vencedor leva o pote inteiro — sem taxa da casa. Empate divide o pote.
// Se a mesa for cancelada antes de começar, todo mundo recebe a aposta de volta.
//
// Jogos:
// - Blackjack (mão contra mão, 2 a 6): cada um na sua vez pede cartas ou para. Ganha quem
//   chegar mais perto de 21 sem estourar. Se todos estourarem, todos recebem de volta.
// - Roleta russa (2 a 6): um revólver só, 1 bala em 6, cada um puxa na sua vez. Quem levar o
//   tiro perde; os sobreviventes dividem o pote.
// - Galinha (corrida, 2 a 6): cada um atravessa a sua estrada (mesma dificuldade). Ganha quem
//   sacar com mais faixas atravessadas; quem for atropelado fica com zero. Todos atropelados:
//   todos recebem de volta.
// - Cara ou coroa (só 2): quem cria escolhe o lado; quem entra fica com o outro e a moeda é
//   jogada na hora.
//
// - Jogos de resultado na hora (2 a 6, quem criou toca em Começar): Dados, Caça-níquel, Raspadinha,
//   Plinko, Keno, Bingo, Poker, Roleta (cada um escolhe um número: quem chegar mais perto da
//   bolinha leva) e Bacará (cada um escolhe Jogador ou Banca). Maior pontuação leva o pote.
// - Corridas (2 a 6, cada um joga o seu): Minas, Torre e Mais ou menos — ganha quem chegar mais
//   longe sem perder (igual à galinha).
// - Crash (2 a 6): um foguete só; cada um saca quando quiser; quem sacar no maior valor antes de
//   explodir leva o pote.
// - Truco (só 2, paulista, 6 ou 12 pontos) e Uno (2 a 4): jogos de turno com as regras completas.
//
// Se alguém sumir na sua vez, depois de um tempo os outros podem pular a vez dele.

import { addDoc, collection, doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import {
  CASINO_CHANNEL_ID,
  CHICKEN_LEVELS,
  MINES_SIZE,
  TOWER_LEVELS,
  TOWER_MODES,
  drawHiloRank,
  handValue,
  newDeck,
  rand,
  randInt,
  rollDice,
  scratchCard,
  slotsMultiplier,
  spinSlotReel,
  walletRef,
} from "./casino";
import {
  PLINKO_RISKS,
  applyTruco,
  bingoCard,
  bingoFlat,
  bingoLinesDone,
  bingoOrder,
  cmpPoker,
  crashMultiplierAt,
  crashPoint,
  crashSecondsFor,
  deck52,
  evalPoker,
  kenoDraw,
  kenoRandomPicks,
  playBaccarat,
  plinkoDrop,
  plinkoTable,
  POKER_NAMES,
  trucoActor,
  trucoBot,
  trucoNew,
  trucoPack,
  trucoUnpack,
  unoDraw,
  unoNew,
  unoPass,
  unoPlay,
  wheelDistance,
} from "./gamesPure";

// kind: instant (resolve ao começar) | race (cada um joga o seu) | turn (um de cada vez) | realtime (crash)
export const PVP_GAMES = {
  blackjack: { name: "Blackjack", icon: "🃏", min: 2, max: 6, kind: "turn", hint: "Chegue mais perto de 21 sem estourar" },
  roulette: { name: "Roleta russa", icon: "🔫", min: 2, max: 6, kind: "turn", hint: "1 bala em 6: quem levar o tiro perde" },
  chicken: { name: "Corrida da galinha", icon: "🐔", min: 2, max: 6, kind: "race", hint: "Quem parar mais longe sem ser atropelada" },
  coinflip: { name: "Cara ou coroa", icon: "💰", min: 2, max: 2, kind: "instant", hint: "50% para cada lado" },
  truco: { name: "Truco", icon: "♣️", min: 2, max: 2, kind: "turn", hint: "Truco paulista de 6 ou 12 pontos" },
  uno: { name: "Uno", icon: "🟥", min: 2, max: 4, kind: "turn", hint: "Seja o primeiro a ficar sem cartas" },
  poker: { name: "Poker", icon: "♠️", min: 2, max: 6, kind: "instant", hint: "Cinco cartas: vence a melhor mão" },
  baccarat: { name: "Bacará", icon: "🎴", min: 2, max: 6, kind: "instant", needsPick: true, hint: "Cada um escolhe Jogador ou Banca" },
  wheel: { name: "Roleta", icon: "🎡", min: 2, max: 6, kind: "instant", needsPick: true, hint: "Cada um escolhe um número: quem chegar mais perto leva" },
  dice: { name: "Dados", icon: "🎲", min: 2, max: 6, kind: "instant", hint: "Cada um rola de 0 a 100: o maior leva" },
  slots: { name: "Caça-níquel", icon: "🎰", min: 2, max: 6, kind: "instant", hint: "Cada um gira: o maior prêmio leva" },
  scratch: { name: "Raspadinha", icon: "🎫", min: 2, max: 6, kind: "instant", hint: "Cada um raspa uma cartela: o maior prêmio leva" },
  plinko: { name: "Plinko", icon: "🔻", min: 2, max: 6, kind: "instant", hint: "Cada um solta uma bolinha: a maior casa leva" },
  keno: { name: "Keno", icon: "🔢", min: 2, max: 6, kind: "instant", hint: "Cada um recebe 5 números: quem acertar mais leva" },
  bingo: { name: "Bingo", icon: "🎱", min: 2, max: 6, kind: "instant", hint: "Quem completar uma linha primeiro leva" },
  mines: { name: "Corrida de minas", icon: "💣", min: 2, max: 6, kind: "race", hint: "Quem abrir mais casas seguras sem explodir" },
  tower: { name: "Corrida da torre", icon: "🗼", min: 2, max: 6, kind: "race", hint: "Quem subir mais andares sem cair na bomba" },
  hilo: { name: "Mais ou menos", icon: "📈", min: 2, max: 6, kind: "race", hint: "Quem acertar mais palpites seguidos" },
  crash: { name: "Crash", icon: "🚀", min: 2, max: 6, kind: "realtime", hint: "Todos no mesmo foguete: saque no maior valor antes de explodir" },
};
export const MAX_HILO_STREAK = 12;
export const CRASH_COUNTDOWN = 3000;
export const clean = (o) => JSON.parse(JSON.stringify(o)); // o Firestore não aceita undefined
export const TURN_TIMEOUT = 45000;

const tableRef = (id) => doc(db, "casinoTables", id);
const now = () => Date.now();

async function debit(tx, uid, amount) {
  const ws = await tx.get(walletRef(uid));
  const bal = Math.floor(ws.data()?.balance || 0);
  if (!ws.exists()) throw new Error("Abra o cassino uma vez para criar sua carteira.");
  if (bal < amount) throw new Error("Saldo insuficiente na carteira.");
  return () => tx.update(walletRef(uid), { balance: bal - amount });
}

/* ---------------- criar / entrar / sair / cancelar ---------------- */
// Valida a escolha de quem entra (Roleta: número livre de 0 a 36; Bacará: Jogador ou Banca).
function checkPick(game, pick, players) {
  if (game === "wheel") {
    if (!Number.isInteger(pick) || pick < 0 || pick > 36) throw new Error("Escolha um número de 0 a 36.");
    if (players.some((p) => p.pick === pick)) throw new Error("Esse número já foi escolhido.");
  } else if (game === "baccarat") {
    if (!["player", "banker"].includes(pick)) throw new Error("Escolha Jogador ou Banca.");
  }
}

export async function createTable(me, { game, bet, maxPlayers, invited = [], level = "medio", side = "cara", pick = null }) {
  bet = Math.floor(Number(bet) || 0);
  const g = PVP_GAMES[game];
  if (!g) throw new Error("Jogo inválido.");
  if (bet < 1) throw new Error("Aposte pelo menos 💰 1.");
  if (g.needsPick) checkPick(game, pick, []);
  maxPlayers = Math.max(g.min, Math.min(g.max, Math.floor(maxPlayers) || g.min));
  const ref = doc(collection(db, "casinoTables"));
  await runTransaction(db, async (tx) => {
    const pay = await debit(tx, me.uid, bet);
    pay();
    tx.set(ref, {
      game,
      bet,
      maxPlayers,
      level,
      side,
      invited,
      hostId: me.uid,
      hostName: me.name,
      players: [{ uid: me.uid, name: me.name, photo: me.photo || "", ...(g.needsPick ? { pick } : {}) }],
      status: "lobby",
      state: null,
      result: null,
      createdAt: serverTimestamp(),
      updatedAt: now(),
    });
  });
  await addDoc(collection(db, "chatMessages"), {
    channelId: CASINO_CHANNEL_ID,
    text: `⚔️ ${me.name} abriu uma mesa de ${g.name} (💰 ${bet.toLocaleString("pt-BR")})`,
    table: ref.id,
    ...(invited.length ? { mentions: invited } : {}),
    senderId: me.uid,
    senderNickname: me.name,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function joinTable(id, me, pick = null) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(tableRef(id));
    const t = snap.data();
    if (!t || t.status !== "lobby") throw new Error("Essa mesa não está mais aberta.");
    if (t.players.some((p) => p.uid === me.uid)) throw new Error("Você já está nessa mesa.");
    if (t.players.length >= t.maxPlayers) throw new Error("A mesa está cheia.");
    if (t.invited?.length && !t.invited.includes(me.uid)) throw new Error("Essa mesa é só para convidados.");
    if (PVP_GAMES[t.game]?.needsPick) checkPick(t.game, pick, t.players);
    const pay = await debit(tx, me.uid, t.bet);
    const players = [...t.players, { uid: me.uid, name: me.name, photo: me.photo || "", ...(PVP_GAMES[t.game]?.needsPick ? { pick } : {}) }];
    pay();
    // Cara ou coroa: completou os 2, a moeda é jogada na hora.
    if (t.game === "coinflip") {
      const result = rand() < 0.5 ? "cara" : "coroa";
      const winner = result === t.side ? t.players[0].uid : me.uid;
      const pot = t.bet * 2;
      tx.update(walletRef(winner), { balance: increment(pot), wins: increment(1) });
      tx.update(tableRef(id), {
        players,
        status: "done",
        state: { result, sides: { [t.players[0].uid]: t.side, [me.uid]: t.side === "cara" ? "coroa" : "cara" } },
        result: { winners: [winner], payouts: { [winner]: pot }, text: `Deu ${result}!` },
        updatedAt: now(),
      });
      return;
    }
    tx.update(tableRef(id), { players, updatedAt: now() });
  });
}

export async function leaveTable(id, uid) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "lobby") throw new Error("A mesa já começou.");
    if (!t.players.some((p) => p.uid === uid)) return;
    tx.update(walletRef(uid), { balance: increment(t.bet) });
    const players = t.players.filter((p) => p.uid !== uid);
    if (!players.length || t.hostId === uid) {
      // quem criou saiu: cancela e devolve para todos
      for (const p of players) tx.update(walletRef(p.uid), { balance: increment(t.bet) });
      tx.update(tableRef(id), { status: "cancelled", players: t.players, updatedAt: now() });
    } else tx.update(tableRef(id), { players, updatedAt: now() });
  });
}

/* ---------------- começar ---------------- */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function startTable(id, uid) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "lobby") throw new Error("A mesa já começou.");
    if (t.hostId !== uid) throw new Error("Só quem criou a mesa pode começar.");
    if (t.players.length < PVP_GAMES[t.game].min) throw new Error("Espere mais alguém entrar.");
    let state;
    if (PVP_GAMES[t.game].kind === "instant" && t.game !== "coinflip") {
      // resultado na hora: sorteia tudo e já paga o pote
      const r = resolveInstant(t);
      payout(tx, id, t, r.winners, r.text, { state: clean(r.state) });
      return;
    }
    if (t.game === "blackjack") {
      const deck = newDeck();
      const hands = {};
      const done = {};
      for (const p of t.players) {
        hands[p.uid] = [deck.pop(), deck.pop()];
        done[p.uid] = handValue(hands[p.uid]).total === 21; // 21 de cara: já para
      }
      const order = t.players.map((p) => p.uid);
      state = { deck, hands, done, order, turn: nextTurn(order, done, -1), turnAt: now() };
    } else if (t.game === "roulette") {
      const order = shuffle(t.players.map((p) => p.uid));
      state = { order, turn: 0, chamber: 0, bullet: randInt(6), pulls: [], turnAt: now() };
    } else if (t.game === "chicken") {
      const runners = {};
      for (const p of t.players) runners[p.uid] = { steps: 0, dead: 0, done: false, at: now() };
      state = { runners, level: t.level || "medio" };
    } else if (t.game === "mines") {
      const runners = {};
      for (const p of t.players) runners[p.uid] = { open: [], dead: -1, done: false, at: now() };
      state = { runners, mines: Number(t.level) || 3 };
    } else if (t.game === "tower") {
      const runners = {};
      for (const p of t.players) runners[p.uid] = { floor: 0, dead: -1, picks: [], done: false, at: now() };
      state = { runners, mode: TOWER_MODES[t.level] ? t.level : "medio" };
    } else if (t.game === "hilo") {
      const runners = {};
      const start = { rank: drawHiloRank(), suit: ["♠", "♥", "♦", "♣"][randInt(4)] }; // todos largam da mesma carta
      for (const p of t.players) runners[p.uid] = { ...start, streak: 0, dead: false, done: false, history: [], at: now() };
      state = { runners };
    } else if (t.game === "crash") {
      state = { crash: crashPoint(), startAt: now() + CRASH_COUNTDOWN, cashed: {} };
    } else if (t.game === "truco") {
      const order = shuffle(t.players.map((p) => p.uid));
      state = clean({ ...trucoPack(trucoNew(t.level === "6" ? 6 : 12)), order, turnAt: now() });
    } else if (t.game === "uno") {
      const order = shuffle(t.players.map((p) => p.uid));
      state = clean(unoNew(order));
    }
    tx.update(tableRef(id), { status: "playing", state, updatedAt: now() });
    if (t.game === "blackjack" && state.turn === -1) finishBlackjack(tx, id, t, state);
  });
}

const nextTurn = (order, done, from) => {
  for (let i = from + 1; i < order.length; i++) if (!done[order[i]]) return i;
  return -1;
};

/* ---------------- pagar o pote ---------------- */
function payout(tx, id, t, winners, text, extra = {}) {
  const pot = t.bet * t.players.length;
  const payouts = {};
  if (!winners.length) {
    // ninguém ganhou: devolve a aposta de todos
    for (const p of t.players) payouts[p.uid] = t.bet;
  } else {
    const each = Math.floor(pot / winners.length);
    for (const w of winners) payouts[w] = each;
  }
  for (const [uid, v] of Object.entries(payouts)) {
    const won = winners.includes(uid);
    tx.update(walletRef(uid), { balance: increment(v), ...(won ? { wins: increment(1) } : {}) });
  }
  for (const p of t.players) if (winners.length && !winners.includes(p.uid)) tx.update(walletRef(p.uid), { losses: increment(1) });
  tx.update(tableRef(id), { status: "done", result: { winners, payouts, text }, updatedAt: now(), ...extra });
}

/* ---------------- Blackjack ---------------- */
function finishBlackjack(tx, id, t, state) {
  let best = -1;
  for (const uid of state.order) {
    const v = handValue(state.hands[uid]).total;
    if (v <= 21 && v > best) best = v;
  }
  const winners = best < 0 ? [] : state.order.filter((uid) => handValue(state.hands[uid]).total === best);
  const name = (uid) => t.players.find((p) => p.uid === uid)?.name || "?";
  const text = !winners.length ? "Todos estouraram — apostas devolvidas" : winners.length > 1 ? `Empate em ${best}: ${winners.map(name).join(" e ")}` : `${name(winners[0])} venceu com ${best}!`;
  payout(tx, id, t, winners, text, { state });
}

export async function bjAction(id, uid, action) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing") throw new Error("A mesa não está em jogo.");
    const s = { ...t.state, hands: { ...t.state.hands }, done: { ...t.state.done }, deck: [...t.state.deck] };
    const cur = s.order[s.turn];
    const forced = action === "skip";
    if (forced) {
      if (now() - s.turnAt < TURN_TIMEOUT) throw new Error("Ainda é a vez dele, espere um pouco.");
    } else if (cur !== uid) throw new Error("Não é a sua vez.");
    if (action === "hit") {
      s.hands[cur] = [...s.hands[cur], s.deck.pop()];
      const v = handValue(s.hands[cur]).total;
      if (v >= 21) s.done[cur] = true;
    } else s.done[cur] = true; // parar (ou pular a vez)
    if (s.done[cur]) {
      s.turn = nextTurn(s.order, s.done, s.turn);
      s.turnAt = now();
    }
    if (s.turn === -1) finishBlackjack(tx, id, t, s);
    else tx.update(tableRef(id), { state: s, updatedAt: now() });
  });
}

/* ---------------- Roleta russa ---------------- */
export async function rouletteAction(id, uid, action) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing") throw new Error("A mesa não está em jogo.");
    const s = { ...t.state, pulls: [...t.state.pulls] };
    const cur = s.order[s.turn];
    if (action === "skip") {
      if (now() - s.turnAt < TURN_TIMEOUT) throw new Error("Ainda é a vez dele, espere um pouco.");
    } else if (cur !== uid) throw new Error("Não é a sua vez.");
    const bang = s.chamber === s.bullet;
    s.pulls.push({ uid: cur, bang, forced: action === "skip" });
    if (bang) {
      const winners = s.order.filter((u) => u !== cur);
      const name = t.players.find((p) => p.uid === cur)?.name || "?";
      payout(tx, id, t, winners, `💥 ${name} levou o tiro!`, { state: { ...s, dead: cur } });
      return;
    }
    s.chamber += 1;
    s.turn = (s.turn + 1) % s.order.length;
    s.turnAt = now();
    tx.update(tableRef(id), { state: s, updatedAt: now() });
  });
}

/* ---------------- Corrida da galinha ---------------- */
function maybeFinishChicken(tx, id, t, s) {
  const rs = s.runners;
  if (!Object.values(rs).every((r) => r.done)) return false;
  let best = 0;
  for (const r of Object.values(rs)) if (!r.dead && r.steps > best) best = r.steps;
  const winners = best > 0 ? Object.keys(rs).filter((u) => !rs[u].dead && rs[u].steps === best) : [];
  const name = (uid) => t.players.find((p) => p.uid === uid)?.name || "?";
  const text = !winners.length
    ? "Todas foram atropeladas — apostas devolvidas"
    : winners.length > 1
      ? `Empate com ${best} faixas: ${winners.map(name).join(" e ")}`
      : `${name(winners[0])} venceu com ${best} faixas!`;
  payout(tx, id, t, winners, text, { state: s });
  return true;
}

export async function chickenAction(id, uid, action, target) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing") throw new Error("A mesa não está em jogo.");
    const s = { ...t.state, runners: { ...t.state.runners } };
    const who = action === "skip" ? target : uid;
    const r = { ...s.runners[who] };
    if (!r || r.done) throw new Error("Essa galinha já terminou.");
    const lv = CHICKEN_LEVELS[s.level];
    if (action === "skip") {
      if (now() - r.at < TURN_TIMEOUT) throw new Error("Espere um pouco, ele ainda pode jogar.");
      r.done = true; // saca onde estiver
    } else if (action === "go") {
      if (rand() < lv.risk) {
        r.dead = r.steps + 1;
        r.done = true;
      } else {
        r.steps += 1;
        if (r.steps >= lv.lanes) r.done = true;
      }
    } else if (action === "stop") {
      if (r.steps < 1) throw new Error("Atravesse pelo menos uma faixa.");
      r.done = true;
    }
    r.at = now();
    s.runners[who] = r;
    if (!maybeFinishChicken(tx, id, t, s)) tx.update(tableRef(id), { state: s, updatedAt: now() });
  });
}

/* ---------------- jogos de resultado na hora ---------------- */
const nameIn = (t, uid) => t.players.find((p) => p.uid === uid)?.name || "?";
const namesOf = (t, uids) => uids.map((u) => nameIn(t, u)).join(" e ");
const fmt2 = (n) => Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 });
// quem tem a maior pontuação (needPositive: se ninguém pontuou, ninguém ganha e todo mundo recebe de volta)
function topWinners(t, score, needPositive = false) {
  const ids = t.players.map((p) => p.uid);
  const max = Math.max(...ids.map((u) => score[u]));
  if (needPositive && max <= 0) return [];
  return ids.filter((u) => score[u] === max);
}
const verdict = (t, w, one, many) => (w.length > 1 ? `Empate: ${namesOf(t, w)} ${many}` : `${nameIn(t, w[0])} ${one}`);

export function resolveInstant(t) {
  const ids = t.players.map((p) => p.uid);
  switch (t.game) {
    case "dice": {
      const rolls = {};
      ids.forEach((u) => (rolls[u] = rollDice()));
      const w = topWinners(t, rolls);
      return { state: { rolls }, winners: w, text: verdict(t, w, `tirou ${fmt2(rolls[w[0]])}!`, `com ${fmt2(rolls[w[0]])}`) };
    }
    case "slots": {
      const reels = {};
      const mult = {};
      ids.forEach((u) => {
        reels[u] = [spinSlotReel(), spinSlotReel(), spinSlotReel()];
        mult[u] = slotsMultiplier(reels[u]);
      });
      const w = topWinners(t, mult, true);
      const text = !w.length ? "Ninguém pontuou — apostas devolvidas" : verdict(t, w, `levou com ${reels[w[0]].join(" ")} (${fmt2(mult[w[0]])}x)`, `com ${fmt2(mult[w[0]])}x`);
      return { state: { reels, mult }, winners: w, text };
    }
    case "scratch": {
      const cards = {};
      const win = {};
      ids.forEach((u) => {
        cards[u] = scratchCard();
        win[u] = cards[u].win;
      });
      const w = topWinners(t, win, true);
      const text = !w.length ? "Ninguém achou um trio — apostas devolvidas" : verdict(t, w, `raspou ${win[w[0]]}x!`, `com ${win[w[0]]}x`);
      return { state: { cards, win }, winners: w, text };
    }
    case "plinko": {
      const risk = PLINKO_RISKS[t.level] ? t.level : "medio";
      const drops = {};
      const mult = {};
      ids.forEach((u) => {
        const d = plinkoDrop();
        mult[u] = plinkoTable[risk][d.slot];
        drops[u] = { ...d, x: mult[u] };
      });
      const w = topWinners(t, mult);
      return { state: { risk, drops }, winners: w, text: verdict(t, w, `caiu na casa ${fmt2(mult[w[0]])}x!`, `na casa ${fmt2(mult[w[0]])}x`) };
    }
    case "keno": {
      const draw = kenoDraw();
      const picks = {};
      const hits = {};
      ids.forEach((u) => {
        picks[u] = kenoRandomPicks(5);
        hits[u] = picks[u].filter((n) => draw.includes(n)).length;
      });
      const w = topWinners(t, hits, true);
      const text = !w.length ? "Ninguém acertou — apostas devolvidas" : verdict(t, w, `acertou ${hits[w[0]]}!`, `com ${hits[w[0]]} acertos`);
      return { state: { draw, picks, hits }, winners: w, text };
    }
    case "bingo": {
      const cards = {};
      const grids = {};
      ids.forEach((u) => {
        const c = bingoCard();
        grids[u] = c;
        cards[u] = bingoFlat(c);
      });
      const order = bingoOrder();
      const drawn = new Set();
      let w = [];
      let n = 0;
      for (; n < order.length; n++) {
        drawn.add(order[n]);
        w = ids.filter((u) => bingoLinesDone(grids[u], drawn) >= 1);
        if (w.length) break;
      }
      return { state: { cards, balls: order.slice(0, n + 1) }, winners: w, text: verdict(t, w, `fez linha na ${n + 1}ª bola!`, `fizeram linha na ${n + 1}ª bola`) };
    }
    case "poker": {
      const deck = deck52();
      const hands = {};
      const evs = {};
      ids.forEach((u) => {
        hands[u] = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
        evs[u] = evalPoker(hands[u]);
      });
      let best = evs[ids[0]];
      for (const u of ids) if (cmpPoker(evs[u], best) > 0) best = evs[u];
      const w = ids.filter((u) => cmpPoker(evs[u], best) === 0);
      const cats = {};
      ids.forEach((u) => (cats[u] = evs[u].cat));
      return { state: { hands, cats }, winners: w, text: verdict(t, w, `venceu com ${POKER_NAMES[best.cat]}!`, `com ${POKER_NAMES[best.cat]}`) };
    }
    case "wheel": {
      const result = randInt(37);
      const picks = {};
      const dist = {};
      const score = {};
      t.players.forEach((p) => {
        picks[p.uid] = p.pick;
        dist[p.uid] = wheelDistance(p.pick, result);
        score[p.uid] = -dist[p.uid];
      });
      const w = topWinners(t, score);
      const exact = dist[w[0]] === 0;
      return { state: { result, picks, dist }, winners: w, text: `Saiu ${result} — ${w.length > 1 ? `${namesOf(t, w)} chegaram igualmente perto` : `${nameIn(t, w[0])} ${exact ? "acertou em cheio!" : "chegou mais perto"}`}` };
    }
    case "baccarat": {
      const r = playBaccarat();
      const picks = {};
      t.players.forEach((p) => (picks[p.uid] = p.pick));
      const w = r.winner === "tie" ? [] : ids.filter((u) => picks[u] === r.winner);
      const side = r.winner === "player" ? "Jogador" : "Banca";
      const text = r.winner === "tie" ? `Empate ${r.pt} a ${r.bt} — apostas devolvidas` : !w.length ? `${side} venceu (${r.pt} a ${r.bt}), mas ninguém apostou nele — apostas devolvidas` : `${side} venceu (${r.pt} a ${r.bt}): ${namesOf(t, w)}`;
      return { state: { player: r.player, banker: r.banker, pt: r.pt, bt: r.bt, winner: r.winner, picks }, winners: w, text };
    }
    default:
      throw new Error("Jogo inválido.");
  }
}

/* ---------------- corridas: minas, torre e mais ou menos ---------------- */
export const raceScore = (game, r) => (game === "mines" ? (r.dead >= 0 ? -1 : r.open.length) : game === "tower" ? (r.dead >= 0 ? -1 : r.floor) : r.dead ? -1 : r.streak);
const RACE_UNITS = { mines: ["casa segura", "casas seguras"], tower: ["andar", "andares"], hilo: ["acerto", "acertos"] };
function maybeFinishRace(tx, id, t, s) {
  const rs = s.runners;
  if (!Object.values(rs).every((r) => r.done)) return false;
  const scores = {};
  for (const u of Object.keys(rs)) scores[u] = raceScore(t.game, rs[u]);
  const best = Math.max(0, ...Object.values(scores));
  const winners = best > 0 ? Object.keys(rs).filter((u) => scores[u] === best) : [];
  const unit = RACE_UNITS[t.game][best === 1 ? 0 : 1];
  const text = !winners.length ? "Ninguém pontuou — apostas devolvidas" : winners.length > 1 ? `Empate com ${best} ${unit}: ${namesOf(t, winners)}` : `${nameIn(t, winners[0])} venceu com ${best} ${unit}!`;
  payout(tx, id, t, winners, text, { state: clean(s) });
  return true;
}

// action: "pick" (arg = casa/casa do andar), "guess" (arg = "high" | "low"), "stop" ou "skip" (target = quem sumiu)
export async function raceAction(id, uid, action, arg, target) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing") throw new Error("A mesa não está em jogo.");
    const s = { ...t.state, runners: { ...t.state.runners } };
    const who = action === "skip" ? target : uid;
    if (!s.runners[who]) throw new Error("Você não está nessa mesa.");
    const r = { ...s.runners[who] };
    if (r.done) throw new Error("Essa jogada já terminou.");
    if (action === "skip") {
      if (now() - r.at < TURN_TIMEOUT) throw new Error("Espere um pouco, ele ainda pode jogar.");
      r.done = true; // para onde estiver
    } else if (t.game === "mines") {
      if (action === "pick") {
        const cell = Number(arg);
        if (!(cell >= 0 && cell < MINES_SIZE) || r.open.includes(cell)) throw new Error("Casa inválida.");
        const k = r.open.length;
        if (rand() < (MINES_SIZE - s.mines - k) / (MINES_SIZE - k)) {
          r.open = [...r.open, cell];
          if (r.open.length >= MINES_SIZE - s.mines) r.done = true;
        } else {
          r.dead = cell;
          r.done = true;
        }
      } else if (action === "stop") {
        if (r.open.length < 1) throw new Error("Abra pelo menos uma casa.");
        r.done = true;
      }
    } else if (t.game === "tower") {
      if (action === "pick") {
        const n = TOWER_MODES[s.mode].tiles;
        const tile = Number(arg);
        if (!(tile >= 0 && tile < n)) throw new Error("Casa inválida.");
        if (randInt(n) === 0) {
          r.picks = [...r.picks, { tile, bomb: tile }];
          r.dead = r.floor;
          r.done = true;
        } else {
          let bomb = randInt(n - 1);
          if (bomb >= tile) bomb += 1;
          r.picks = [...r.picks, { tile, bomb }];
          r.floor += 1;
          if (r.floor >= TOWER_LEVELS) r.done = true;
        }
      } else if (action === "stop") {
        if (r.floor < 1) throw new Error("Suba pelo menos um andar.");
        r.done = true;
      }
    } else if (t.game === "hilo") {
      if (action === "guess") {
        if ((arg === "high" ? 13 - r.rank : r.rank - 1) <= 0) throw new Error("Esse palpite é impossível.");
        const next = drawHiloRank();
        const suit = ["♠", "♥", "♦", "♣"][randInt(4)];
        const ok = arg === "high" ? next > r.rank : next < r.rank;
        r.history = [...r.history, { rank: r.rank, suit: r.suit }].slice(-6);
        r.rank = next;
        r.suit = suit;
        if (ok) {
          r.streak += 1;
          if (r.streak >= MAX_HILO_STREAK) r.done = true;
        } else {
          r.dead = true;
          r.done = true;
        }
      } else if (action === "stop") {
        if (r.streak < 1) throw new Error("Acerte pelo menos um palpite.");
        r.done = true;
      }
    }
    r.at = now();
    s.runners[who] = r;
    if (!maybeFinishRace(tx, id, t, s)) tx.update(tableRef(id), { state: clean(s), updatedAt: now() });
  });
}

/* ---------------- Crash: um foguete para todos ---------------- */
function finalizeCrash(tx, id, t, s) {
  const cashed = s.cashed || {};
  const vals = Object.values(cashed);
  const best = vals.length ? Math.max(...vals) : 0;
  const winners = best > 0 ? Object.keys(cashed).filter((u) => cashed[u] === best) : [];
  const boom = `${fmt2(s.crash)}x`;
  const text = !winners.length ? `O foguete explodiu em ${boom} e ninguém sacou — apostas devolvidas` : winners.length > 1 ? `Explodiu em ${boom}. Empate: ${namesOf(t, winners)} sacaram em ${fmt2(best)}x` : `Explodiu em ${boom}. ${nameIn(t, winners[0])} sacou em ${fmt2(best)}x e levou o pote!`;
  payout(tx, id, t, winners, text, { state: clean({ ...s, cashed }) });
}
export const crashEndsAt = (s) => s.startAt + crashSecondsFor(s.crash) * 1000;

export async function crashCash(id, uid) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing") throw new Error("A mesa não está em jogo.");
    if (!t.players.some((p) => p.uid === uid)) throw new Error("Você não está nessa mesa.");
    const s = { ...t.state, cashed: { ...(t.state.cashed || {}) } };
    if (s.cashed[uid]) throw new Error("Você já sacou.");
    const sec = (now() - s.startAt) / 1000;
    if (sec < 0) throw new Error("Espere a decolagem.");
    const m = Math.floor(crashMultiplierAt(sec) * 100) / 100;
    if (m >= s.crash) return finalizeCrash(tx, id, t, s); // já tinha explodido
    s.cashed[uid] = m;
    if (Object.keys(s.cashed).length >= t.players.length) finalizeCrash(tx, id, t, s);
    else tx.update(tableRef(id), { state: clean(s), updatedAt: now() });
  });
}
// qualquer pessoa pode fechar a mesa depois que o foguete explodiu (ninguém precisa estar com ela aberta)
export async function crashFinalize(id) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing" || t.game !== "crash") return;
    if (now() < crashEndsAt(t.state) + 400) return;
    finalizeCrash(tx, id, t, t.state);
  });
}

/* ---------------- Truco (2) ---------------- */
// a = { type: "play", idx } | "raise" | "accept" | "run" | "raise_back" | "skip" (pular vez de quem sumiu)
export async function trucoTableAction(id, uid, a) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing" || t.game !== "truco") throw new Error("A mesa não está em jogo.");
    const s = trucoUnpack(t.state);
    let p = s.order.indexOf(uid);
    if (p < 0 && a.type !== "skip") throw new Error("Você não está nessa mesa.");
    let act = a;
    if (a.type === "skip") {
      if (now() - s.turnAt < TURN_TIMEOUT) throw new Error("Ainda é a vez dele, espere um pouco.");
      p = trucoActor(s);
      act = trucoBot(s, p); // quem sumiu joga "no automático"
    } else if (trucoActor(s) !== p) throw new Error("Não é a sua vez.");
    const ns = { ...applyTruco(s, p, act), order: s.order, turnAt: now() };
    if (ns.over) {
      const w = s.order[ns.winner];
      payout(tx, id, t, [w], `${nameIn(t, w)} ganhou o truco por ${ns.score[ns.winner]} a ${ns.score[1 - ns.winner]}!`, { state: clean(trucoPack(ns)) });
    } else tx.update(tableRef(id), { state: clean(trucoPack(ns)), updatedAt: now() });
  });
}

/* ---------------- Uno (2 a 4) ---------------- */
// a = { type: "play", idx, color } | "draw" | "pass" | "skip"
export async function unoTableAction(id, uid, a) {
  return runTransaction(db, async (tx) => {
    const t = (await tx.get(tableRef(id))).data();
    if (!t || t.status !== "playing" || t.game !== "uno") throw new Error("A mesa não está em jogo.");
    const s = t.state;
    let ns;
    if (a.type === "skip") {
      if (now() - s.turnAt < TURN_TIMEOUT) throw new Error("Ainda é a vez dele, espere um pouco.");
      const cur = s.players[s.turn];
      ns = unoDraw(s, cur);
      if (ns.drawn) ns = unoPass(ns, cur); // comprou e não jogou: passa a vez
    } else {
      if (!s.players.includes(uid)) throw new Error("Você não está nessa mesa.");
      if (a.type === "play") ns = unoPlay(s, uid, a.idx, a.color);
      else if (a.type === "draw") ns = unoDraw(s, uid);
      else if (a.type === "pass") ns = unoPass(s, uid);
      else throw new Error("Ação inválida.");
    }
    if (ns.winner) payout(tx, id, t, [ns.winner], `${nameIn(t, ns.winner)} ficou sem cartas e ganhou o Uno!`, { state: clean(ns) });
    else tx.update(tableRef(id), { state: clean(ns), updatedAt: now() });
  });
}
