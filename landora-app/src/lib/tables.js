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
// Se alguém sumir na sua vez, depois de um tempo os outros podem pular a vez dele.

import { addDoc, collection, doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { CASINO_CHANNEL_ID, CHICKEN_LEVELS, handValue, newDeck, rand, randInt, walletRef } from "./casino";

export const PVP_GAMES = {
  blackjack: { name: "Blackjack", icon: "🃏", min: 2, max: 6 },
  roulette: { name: "Roleta russa", icon: "🔫", min: 2, max: 6 },
  chicken: { name: "Corrida da galinha", icon: "🐔", min: 2, max: 6 },
  coinflip: { name: "Cara ou coroa", icon: "💰", min: 2, max: 2 },
};
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
export async function createTable(me, { game, bet, maxPlayers, invited = [], level = "medio", side = "cara" }) {
  bet = Math.floor(Number(bet) || 0);
  const g = PVP_GAMES[game];
  if (!g) throw new Error("Jogo inválido.");
  if (bet < 1) throw new Error("Aposte pelo menos 💰 1.");
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
      players: [{ uid: me.uid, name: me.name, photo: me.photo || "" }],
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

export async function joinTable(id, me) {
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(tableRef(id));
    const t = snap.data();
    if (!t || t.status !== "lobby") throw new Error("Essa mesa não está mais aberta.");
    if (t.players.some((p) => p.uid === me.uid)) throw new Error("Você já está nessa mesa.");
    if (t.players.length >= t.maxPlayers) throw new Error("A mesa está cheia.");
    if (t.invited?.length && !t.invited.includes(me.uid)) throw new Error("Essa mesa é só para convidados.");
    const pay = await debit(tx, me.uid, t.bet);
    const players = [...t.players, { uid: me.uid, name: me.name, photo: me.photo || "" }];
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
