import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { onSnapshot } from "firebase/firestore";
import { useAuth } from "../context/AuthContext";
import { useCollection } from "../lib/useCollection";
import Avatar from "./Avatar";
import { CreateTable } from "./Tables";
import { MORE_GAMES } from "./CasinoMore";
import {
  CHICKEN_LEVELS,
  COINFLIP_PAYOUT,
  DAILY_AMOUNT,
  GAME_NAMES,
  ROULETTE_CHAMBERS,
  canClaimDaily,
  chickenMultiplier,
  claimDaily,
  coins,
  ensureWallet,
  handValue,
  isBlackjack,
  newDeck,
  placeBet,
  postResult,
  rand,
  randInt,
  rouletteMultiplier,
  settle,
  walletRef,
} from "../lib/casino";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fmtX = (x) => `${x.toFixed(2).replace(".", ",")}x`;

/* ---------------- carteira ---------------- */
export function useWallet() {
  const { user, profile } = useAuth();
  const [wallet, setWallet] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    ensureWallet(user, profile).catch((e) => console.error("carteira:", e));
    return onSnapshot(walletRef(user.uid), (snap) => setWallet(snap.exists() ? snap.data() : null), () => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, profile?.nickname, profile?.photoURL]);
  return wallet;
}

// Começa e termina uma rodada: tira a aposta, paga o prêmio e publica no #cassino.
export function useRound() {
  const { user, profile } = useAuth();
  return {
    start: (bet) => placeBet(user.uid, bet),
    finish: async (game) => {
      await settle(user.uid, game.bet, game.payout);
      postResult(user, profile, game).catch(() => {});
    },
  };
}

/* ---------------- escolher aposta ---------------- */
export function BetPicker({ value, onChange, balance, disabled }) {
  const set = (v) => onChange(Math.max(1, Math.min(Math.floor(v) || 0, Math.max(1, Math.floor(balance || 0)))));
  return (
    <div className="bet-picker">
      <label className="bet-input">
        <span>Aposta</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
        />
      </label>
      <div className="bet-chips">
        {[10, 50, 100, 500].map((v) => (
          <button type="button" key={v} disabled={disabled} onClick={() => set(v)}>
            {v}
          </button>
        ))}
        <button type="button" disabled={disabled} onClick={() => set(value / 2)}>
          ½
        </button>
        <button type="button" disabled={disabled} onClick={() => set(value * 2)}>
          2x
        </button>
        <button type="button" className="allin" disabled={disabled} onClick={() => set(balance)}>
          Tudo
        </button>
      </div>
    </div>
  );
}

export function ResultBanner({ net, label }) {
  if (net == null) return null;
  return (
    <div className={"casino-result " + (net > 0 ? "win" : net < 0 ? "lose" : "push")}>
      <b>{label}</b>
      <span>{net > 0 ? `+${coins(net)}` : net < 0 ? `-${coins(-net)}` : "Aposta devolvida"}</span>
    </div>
  );
}

/* ---------------- Blackjack ---------------- */
export function PlayingCard({ c, hidden, i }) {
  const red = c && (c.s === "♥" || c.s === "♦");
  return (
    <div className={"pcard" + (hidden ? " back" : "") + (red ? " red" : "")} style={{ "--i": i }}>
      {!hidden && (
        <>
          <span className="pc-corner">
            {c.r}
            <br />
            {c.s}
          </span>
          <span className="pc-suit">{c.s}</span>
        </>
      )}
    </div>
  );
}

function Blackjack({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);

  async function deal() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const deck = newDeck();
    const player = [deck.pop(), deck.pop()];
    const dealer = [deck.pop(), deck.pop()];
    const s = { phase: "play", deck, player, dealer, bet, doubled: false };
    setSt(s);
    setBusy(false);
    if (isBlackjack(player) || isBlackjack(dealer)) {
      await sleep(600);
      const pb = isBlackjack(player);
      const bb = isBlackjack(dealer);
      const payout = pb && bb ? bet : pb ? Math.floor(bet * 2.5) : 0;
      await end({ ...s }, payout, pb && bb ? "Os dois com Blackjack" : pb ? "BLACKJACK! 🎉" : "Banca fez Blackjack");
    }
  }

  async function end(s, payout, label) {
    const fin = { ...s, phase: "done", payout, label, net: payout - s.bet };
    setSt(fin);
    await round.finish({
      type: "blackjack",
      bet: s.bet,
      payout,
      detail: `Você ${handValue(s.player).total} × Banca ${handValue(s.dealer).total} — ${label}`,
    }).catch((e) => onError(e.message));
  }

  async function stand(s = st) {
    setBusy(true);
    let { dealer, deck } = s;
    // a banca vira a carta e compra uma por vez (com pausa, para dar emoção)
    setSt({ ...s, phase: "dealer" });
    await sleep(500);
    while (handValue(dealer).total < 17) {
      dealer = [...dealer, deck[deck.length - 1]];
      deck = deck.slice(0, -1);
      setSt({ ...s, phase: "dealer", dealer, deck });
      await sleep(550);
    }
    const p = handValue(s.player).total;
    const d = handValue(dealer).total;
    const ns = { ...s, dealer, deck };
    if (d > 21) await end(ns, s.bet * 2, "Banca estourou!");
    else if (p > d) await end(ns, s.bet * 2, "Você venceu!");
    else if (p === d) await end(ns, s.bet, "Empate");
    else await end(ns, 0, "Banca venceu");
    setBusy(false);
  }

  async function hit() {
    const deck = [...st.deck];
    const player = [...st.player, deck.pop()];
    const ns = { ...st, deck, player };
    setSt(ns);
    const t = handValue(player).total;
    if (t > 21) {
      setBusy(true);
      await sleep(400);
      await end(ns, 0, "Estourou!");
      setBusy(false);
    } else if (t === 21) await stand(ns);
  }

  async function double() {
    onError("");
    try {
      await round.start(st.bet);
    } catch (e) {
      onError(e.message);
      return;
    }
    const deck = [...st.deck];
    const player = [...st.player, deck.pop()];
    const ns = { ...st, deck, player, bet: st.bet * 2, doubled: true };
    setSt(ns);
    if (handValue(player).total > 21) {
      setBusy(true);
      await sleep(400);
      await end(ns, 0, "Estourou!");
      setBusy(false);
    } else await stand(ns);
  }

  const playing = st.phase === "play";
  const hideHole = st.phase === "play";
  const pv = st.player ? handValue(st.player) : null;
  const dv = st.dealer ? handValue(hideHole ? st.dealer.slice(0, 1) : st.dealer) : null;

  return (
    <div className="game bj">
      {st.phase !== "bet" && (
        <div className="bj-table">
          <div className="bj-hand">
            <div className="bj-label">
              Banca <b>{dv?.total}</b>
            </div>
            <div className="bj-cards">
              {st.dealer.map((c, i) => (
                <PlayingCard key={i} c={c} i={i} hidden={hideHole && i === 1} />
              ))}
            </div>
          </div>
          <div className="bj-hand">
            <div className="bj-label">
              Você <b>{pv?.total}</b>
              {st.doubled && <span className="bj-tag">dobrou</span>}
            </div>
            <div className="bj-cards">
              {st.player.map((c, i) => (
                <PlayingCard key={i} c={c} i={i} />
              ))}
            </div>
          </div>
        </div>
      )}

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <div className="game-actions">
          <button type="button" className="btn btn-gradient" onClick={hit} disabled={busy}>
            Pedir carta
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => stand()} disabled={busy}>
            Parar
          </button>
          {st.player.length === 2 && !st.doubled && (
            <button type="button" className="btn btn-ghost" onClick={double} disabled={busy || (wallet?.balance || 0) < st.bet}>
              Dobrar
            </button>
          )}
        </div>
      ) : st.phase === "dealer" ? (
        <p className="game-hint">A banca está jogando…</p>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={deal} disabled={busy || bet < 1}>
            {st.phase === "done" ? "Jogar de novo" : "Distribuir cartas"}
          </button>
          <p className="game-hint">Blackjack paga 3 para 2 · Banca para no 17</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Galinha ---------------- */
function Chicken({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [level, setLevel] = useState("medio");
  const [st, setSt] = useState({ phase: "bet", steps: 0 });
  const [busy, setBusy] = useState(false);
  const roadRef = useRef(null);
  const cfg = CHICKEN_LEVELS[level];
  const lanes = cfg.lanes;

  // a estrada acompanha a galinha
  useEffect(() => {
    const road = roadRef.current;
    const cur = road?.querySelector(".lane.cur, .lane.dead");
    if (road && cur) road.scrollTo({ left: cur.offsetLeft - road.clientWidth / 2 + cur.clientWidth / 2, behavior: "smooth" });
  }, [st.steps, st.phase]);

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      setSt({ phase: "play", steps: 0, bet, level });
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function finish(ns, payout, label) {
    const fin = { ...ns, phase: "done", payout, label, net: payout - ns.bet };
    setSt(fin);
    await round
      .finish({
        type: "chicken",
        bet: ns.bet,
        payout,
        detail: `${CHICKEN_LEVELS[ns.level].label} · ${ns.dead ? `atropelada na faixa ${ns.dead}` : `atravessou ${ns.steps} ${ns.steps === 1 ? "faixa" : "faixas"} (${fmtX(chickenMultiplier(ns.level, ns.steps))})`}`,
      })
      .catch((e) => onError(e.message));
  }

  async function advance() {
    setBusy(true);
    const next = st.steps + 1;
    setSt({ ...st, jumping: true });
    await sleep(320);
    if (rand() < CHICKEN_LEVELS[st.level].risk) {
      await finish({ ...st, jumping: false, dead: next }, 0, "Atropelada! 🚗💥");
    } else {
      const ns = { ...st, jumping: false, steps: next };
      if (next >= lanes) await finish(ns, Math.floor(st.bet * chickenMultiplier(st.level, next)), "Atravessou tudo! 🏆");
      else setSt(ns);
    }
    setBusy(false);
  }

  async function cashout() {
    setBusy(true);
    await finish(st, Math.floor(st.bet * chickenMultiplier(st.level, st.steps)), `Sacou em ${fmtX(chickenMultiplier(st.level, st.steps))}`);
    setBusy(false);
  }

  const lv = st.phase === "bet" ? level : st.level;
  const playing = st.phase === "play";
  return (
    <div className="game chicken">
      <div className="road" ref={roadRef}>
        <div className={"lane side" + (st.steps === 0 && !st.dead ? " cur" : "")}>
          {st.steps === 0 && !st.dead && <span className={"hen" + (st.jumping ? " jump" : "")}>🐔</span>}
        </div>
        {Array.from({ length: CHICKEN_LEVELS[lv].lanes }, (_, i) => {
          const n = i + 1;
          const passed = n <= st.steps;
          const cur = n === st.steps && !st.dead;
          const dead = st.dead === n;
          return (
            <div key={n} className={"lane" + (passed ? " passed" : "") + (cur ? " cur" : "") + (dead ? " dead" : "") + (n === CHICKEN_LEVELS[lv].lanes ? " last" : "")}>
              <span className="lane-x">{fmtX(chickenMultiplier(lv, n))}</span>
              {!passed && !dead && <span className="car" style={{ animationDelay: `${(n * 0.37) % 1.6}s`, animationDuration: `${1.4 + ((n * 0.53) % 1.2)}s` }}>🚗</span>}
              {cur && <span className={"hen" + (st.jumping ? " jump" : "")}>🐔</span>}
              {dead && (
                <span className="crash">
                  🚗<b>💥</b>
                </span>
              )}
              {passed && !cur && <span className="egg">·</span>}
            </div>
          );
        })}
      </div>

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <div className="game-actions">
          <button type="button" className="btn btn-gradient" onClick={advance} disabled={busy}>
            Atravessar ({fmtX(chickenMultiplier(st.level, st.steps + 1))})
          </button>
          <button type="button" className="btn btn-cash" onClick={cashout} disabled={busy || st.steps === 0}>
            Sacar {coins(Math.floor(st.bet * chickenMultiplier(st.level, st.steps)))}
          </button>
        </div>
      ) : (
        <>
          <div className="seg">
            {Object.entries(CHICKEN_LEVELS).map(([k, v]) => (
              <button type="button" key={k} className={level === k ? "sel" : ""} onClick={() => setLevel(k)} disabled={busy}>
                {v.label}
              </button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {st.phase === "done" ? "Jogar de novo" : "Começar"}
          </button>
          <p className="game-hint">Cada faixa aumenta o prêmio. Saque antes de ser atropelada!</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Cara ou coroa ---------------- */
function Coinflip({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [side, setSide] = useState("cara");
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const [spins, setSpins] = useState(0);

  async function flip() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const result = rand() < 0.5 ? "cara" : "coroa";
    // gira várias voltas e para no lado sorteado
    setSpins((s) => s + 5 + (result === "coroa" ? 0.5 : 0) - (s % 1));
    setSt({ phase: "flip", result });
    await sleep(1700);
    const win = result === side;
    const payout = win ? Math.floor(bet * COINFLIP_PAYOUT) : 0;
    setSt({ phase: "done", result, net: payout - bet, label: `Deu ${result}!` });
    await round
      .finish({ type: "coinflip", bet, payout, detail: `Escolheu ${side} · deu ${result}` })
      .catch((e) => onError(e.message));
    setBusy(false);
  }

  return (
    <div className="game coinflip">
      <div className="coin-stage">
        <div className="coin" style={{ transform: `rotateY(${spins * 360}deg)` }}>
          <div className="coin-face cara">
            <b>L</b>
            <span>CARA</span>
          </div>
          <div className="coin-face coroa">
            <b>👑</b>
            <span>COROA</span>
          </div>
        </div>
        <div className="coin-shadow" />
      </div>

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      <div className="seg big">
        {["cara", "coroa"].map((s) => (
          <button type="button" key={s} className={side === s ? "sel" : ""} onClick={() => setSide(s)} disabled={busy}>
            {s === "cara" ? "Cara" : "Coroa"}
          </button>
        ))}
      </div>
      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={flip} disabled={busy || bet < 1}>
        {busy ? "Girando…" : "Jogar a moeda"}
      </button>
      <p className="game-hint">Acertou: recebe {fmtX(COINFLIP_PAYOUT)} da aposta</p>
    </div>
  );
}

/* ---------------- Roleta russa ---------------- */
function Roulette({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [st, setSt] = useState({ phase: "bet", pulled: 0 });
  const [busy, setBusy] = useState(false);
  const [rot, setRot] = useState(0);
  const [fx, setFx] = useState(""); // "click" | "bang"

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      setSt({ phase: "play", pulled: 0, bet, bullet: randInt(ROULETTE_CHAMBERS) });
      setRot((r) => r + 720 + randInt(6) * 60); // gira o tambor
      setFx("");
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function finish(ns, payout, label) {
    setSt({ ...ns, phase: "done", net: payout - ns.bet, label });
    await round
      .finish({
        type: "roulette",
        bet: ns.bet,
        payout,
        detail: ns.dead ? `💥 Bang na ${ns.pulled + 1}ª puxada` : `Sobreviveu a ${ns.pulled} ${ns.pulled === 1 ? "puxada" : "puxadas"} (${fmtX(rouletteMultiplier(ns.pulled))})`,
      })
      .catch((e) => onError(e.message));
  }

  async function pull() {
    setBusy(true);
    setFx("");
    setRot((r) => r + 60);
    await sleep(650);
    if (st.pulled === st.bullet) {
      setFx("bang");
      await sleep(250);
      await finish({ ...st, dead: true }, 0, "BANG! 💀");
    } else {
      setFx("click");
      const pulled = st.pulled + 1;
      const ns = { ...st, pulled };
      if (pulled >= ROULETTE_CHAMBERS - 1) await finish(ns, Math.floor(st.bet * rouletteMultiplier(pulled)), "Sobreviveu a tudo! 😎");
      else setSt(ns);
    }
    setBusy(false);
  }

  async function cashout() {
    setBusy(true);
    await finish(st, Math.floor(st.bet * rouletteMultiplier(st.pulled)), `Saiu vivo com ${fmtX(rouletteMultiplier(st.pulled))}`);
    setBusy(false);
  }

  const playing = st.phase === "play";
  return (
    <div className={"game roulette" + (fx === "bang" ? " bang" : "")}>
      <div className="rr-stage">
        <div className="rr-cylinder" style={{ transform: `rotate(${rot}deg)` }}>
          {Array.from({ length: ROULETTE_CHAMBERS }, (_, i) => (
            <span
              key={i}
              className={"rr-chamber" + (st.phase !== "bet" && i < st.pulled ? " empty" : "") + (st.dead && i === st.pulled ? " shot" : "")}
              style={{ "--a": `${i * 60}deg` }}
            />
          ))}
          <span className="rr-pin" />
        </div>
        {fx === "click" && <span className="rr-fx click">*click*</span>}
        {fx === "bang" && <span className="rr-fx bang">BANG!</span>}
      </div>

      <div className="rr-steps">
        {Array.from({ length: ROULETTE_CHAMBERS - 1 }, (_, i) => (
          <span key={i} className={i < st.pulled ? "ok" : ""}>
            {fmtX(rouletteMultiplier(i + 1))}
          </span>
        ))}
      </div>

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <div className="game-actions">
          <button type="button" className="btn btn-danger-solid" onClick={pull} disabled={busy}>
            Puxar o gatilho
          </button>
          <button type="button" className="btn btn-cash" onClick={cashout} disabled={busy || st.pulled === 0}>
            Sacar {coins(Math.floor(st.bet * rouletteMultiplier(st.pulled)))}
          </button>
        </div>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {st.phase === "done" ? "Jogar de novo" : "Carregar o revólver"}
          </button>
          <p className="game-hint">1 bala em 6. Cada puxada que passa aumenta o prêmio.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Ranking ---------------- */
export function Ranking() {
  const { user } = useAuth();
  const { data } = useCollection("wallets");
  const total = (w) => (w.balance || 0) + (w.bank || 0);
  const list = useMemo(() => [...data].sort((a, b) => total(b) - total(a)), [data]);
  return (
    <div className="ranking">
      {list.map((w, i) => (
        <div key={w.id} className={"rank-row" + (w.id === user.uid ? " me" : "")}>
          <span className="rank-pos">{i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}º`}</span>
          <Avatar src={w.photoURL} name={w.nickname} size={30} />
          <div className="rank-name">
            <b>{w.nickname}</b>
            <span>
              carteira {coins(w.balance)} · banco {coins(w.bank || 0)} · {w.wins || 0} vitórias
            </span>
          </div>
          <b className="rank-bal">{coins(total(w))}</b>
        </div>
      ))}
      {list.length === 0 && <p className="muted">Ninguém jogou ainda.</p>}
    </div>
  );
}

/* ---------------- painel do cassino (topo do canal) ---------------- */
const GAMES = [
  { id: "blackjack", name: "Blackjack", icon: "🃏", desc: "Chegue a 21", C: Blackjack },
  { id: "chicken", name: "Galinha", icon: "🐔", desc: "Atravesse a estrada", C: Chicken },
  { id: "coinflip", name: "Cara ou coroa", icon: "💰", desc: "50% de chance", C: Coinflip },
  { id: "roulette", name: "Roleta russa", icon: "🔫", desc: "1 bala em 6", C: Roulette },
  ...MORE_GAMES,
];

export function CasinoBar() {
  const { user, profile } = useAuth();
  const wallet = useWallet();
  const [open, setOpen] = useState(null); // id do jogo ou "ranking"
  const [error, setError] = useState("");
  const [dailyMsg, setDailyMsg] = useState("");

  async function daily() {
    setDailyMsg("");
    try {
      await claimDaily(user.uid);
      setDailyMsg(`+${coins(DAILY_AMOUNT)}`);
      postResult(user, profile, { type: "daily", bet: 0, payout: DAILY_AMOUNT, detail: "Pegou o bônus do dia" }).catch(() => {});
      setTimeout(() => setDailyMsg(""), 2500);
    } catch (e) {
      setDailyMsg(e.message);
      setTimeout(() => setDailyMsg(""), 3000);
    }
  }

  const game = GAMES.find((g) => g.id === open);
  return (
    <div className="casino-bar">
      <div className="casino-top">
        <div className="casino-wallet">
          <span>Seu saldo</span>
          <b>{wallet ? coins(wallet.balance) : "…"}</b>
        </div>
        <button type="button" className={"casino-daily" + (canClaimDaily(wallet) ? " ready" : "")} onClick={daily} disabled={!wallet}>
          🎁 {canClaimDaily(wallet) ? `Bônus diário (+${DAILY_AMOUNT})` : "Bônus pego hoje"}
        </button>
        <button type="button" className="casino-rank-btn" onClick={() => setOpen("ranking")}>
          🏆 Ranking
        </button>
        <button type="button" className="casino-pvp-btn" onClick={() => setOpen("pvp")}>
          ⚔️ Desafiar
        </button>
        {dailyMsg && <span className="casino-toast">{dailyMsg}</span>}
      </div>
      <div className="casino-games">
        {GAMES.map((g) => (
          <button type="button" key={g.id} className={"casino-game g-" + g.id} onClick={() => (setError(""), setOpen(g.id))}>
            <span className="cg-icon">{g.icon}</span>
            <span className="cg-text">
              <b>{g.name}</b>
              <span>{g.desc}</span>
            </span>
          </button>
        ))}
      </div>

      {open && (
        createPortal(
        <div className="modal-backdrop casino-backdrop" onClick={() => setOpen(null)}>
          <div className={"casino-modal" + (game ? " g-" + game.id : "")} onClick={(e) => e.stopPropagation()}>
            <header className="casino-modal-head">
              <h3>{game ? `${game.icon} ${game.name}` : open === "pvp" ? "⚔️ Novo desafio" : "🏆 Ranking"}</h3>
              <span className="casino-modal-bal">{wallet ? coins(wallet.balance) : ""}</span>
              <button type="button" className="modal-close" onClick={() => setOpen(null)} aria-label="Fechar">
                ✕
              </button>
            </header>
            {error && <p className="auth-error">{error}</p>}
            {game ? (
              <game.C wallet={wallet} onError={setError} />
            ) : open === "pvp" ? (
              <CreateTable wallet={wallet} onDone={() => setOpen(null)} />
            ) : (
              <Ranking />
            )}
          </div>
        </div>,
        document.body
        )
      )}
    </div>
  );
}

/* ---------------- resultado publicado no chat ---------------- */
export function GameResultCard({ game }) {
  const net = game.net ?? game.payout - game.bet;
  return (
    <div className={"game-card " + (net > 0 ? "win" : net < 0 ? "lose" : "push") + " t-" + game.type}>
      <div className="gc-head">
        <b>{GAME_NAMES[game.type] || "🎲 Jogo"}</b>
        {!["pay", "loan", "admin", "persona", "use"].includes(game.type) && (
          <span className="gc-net">{net > 0 ? `+${coins(net)}` : net < 0 ? `-${coins(-net)}` : coins(0)}</span>
        )}
      </div>
      {game.detail && <div className="gc-detail">{game.detail}</div>}
      {game.bet > 0 && <div className="gc-bet">Aposta {coins(game.bet)}</div>}
    </div>
  );
}
