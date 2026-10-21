import { useEffect, useRef, useState } from "react";
import {
  DICE_MAX,
  DICE_MIN,
  HILO_RANKS,
  MINES_OPTIONS,
  MINES_SIZE,
  SCRATCH_CELLS,
  SCRATCH_PRIZES,
  SLOT_PAIR_X,
  SLOT_SYMBOLS,
  TOWER_LEVELS,
  TOWER_MODES,
  coins,
  diceMultiplier,
  diceWins,
  drawHiloRank,
  hiloChance,
  hiloPay,
  hiloStep,
  minesMultiplier,
  placeMines,
  randInt,
  rollDice,
  scratchCard,
  slotsMultiplier,
  spinSlotReel,
  towerMultiplier,
} from "../lib/casino";
import { BetPicker, PlayingCard, ResultBanner, fmtX, useRound } from "./Casino";

// Jogos extras do cassino: Minas, Dados, Caça-níquel, Raspadinha, Mais ou menos e Torre.
// As regras e probabilidades ficam em lib/casino.js. Todos seguem o padrão dos outros jogos:
// a aposta sai da carteira quando a rodada começa e o prêmio entra quando termina.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const SUITS = ["♠", "♥", "♦", "♣"];
const randSuit = () => SUITS[randInt(4)];

/* ---------------- Minas ---------------- */
function Mines({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [count, setCount] = useState(3);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      setSt({ phase: "play", bet, count, mines: placeMines(count), open: [] });
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function finish(ns, payout, label) {
    setSt({ ...ns, phase: "done", payout, label, net: payout - ns.bet });
    await round
      .finish({
        type: "mines",
        bet: ns.bet,
        payout,
        detail: `${ns.count} ${ns.count === 1 ? "mina" : "minas"} · ${ns.open.length} ${ns.open.length === 1 ? "casa segura" : "casas seguras"}${payout > 0 ? ` (${fmtX(minesMultiplier(ns.count, ns.open.length))})` : ""}`,
      })
      .catch((e) => onError(e.message));
  }

  async function pick(i) {
    if (st.phase !== "play" || busy || st.open.includes(i)) return;
    setBusy(true);
    if (st.mines.has(i)) {
      await finish({ ...st, boom: i }, 0, "Boom! 💣");
    } else {
      const open = [...st.open, i];
      const ns = { ...st, open };
      if (open.length >= MINES_SIZE - st.count) await finish(ns, Math.floor(st.bet * minesMultiplier(st.count, open.length)), "Limpou o campo! 🏆");
      else setSt(ns);
    }
    setBusy(false);
  }

  async function cashout() {
    setBusy(true);
    const m = minesMultiplier(st.count, st.open.length);
    await finish(st, Math.floor(st.bet * m), `Sacou em ${fmtX(m)}`);
    setBusy(false);
  }

  const playing = st.phase === "play";
  const done = st.phase === "done";
  return (
    <div className="game mines">
      <div className="mines-grid">
        {Array.from({ length: MINES_SIZE }, (_, i) => {
          const open = st.open?.includes(i);
          const isMine = st.mines?.has(i);
          const show = open || (done && isMine);
          return (
            <button
              type="button"
              key={i}
              className={"mine-cell" + (open ? " safe" : "") + (done && isMine ? (st.boom === i ? " boom" : " mine") : "")}
              disabled={!playing || busy || open}
              onClick={() => pick(i)}
            >
              {show ? (open ? "💎" : st.boom === i ? "💥" : "💣") : ""}
            </button>
          );
        })}
      </div>

      {done && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <div className="game-actions">
          <button type="button" className="btn btn-cash" onClick={cashout} disabled={busy || st.open.length === 0}>
            Sacar {coins(Math.floor(st.bet * minesMultiplier(st.count, st.open.length)))}
          </button>
          <div className="mines-next">
            <span>Próxima casa</span>
            <b>{fmtX(minesMultiplier(st.count, st.open.length + 1))}</b>
          </div>
        </div>
      ) : (
        <>
          <div className="seg">
            {MINES_OPTIONS.map((n) => (
              <button type="button" key={n} className={count === n ? "sel" : ""} onClick={() => setCount(n)} disabled={busy}>
                {n} {n === 1 ? "mina" : "minas"}
              </button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {done ? "Jogar de novo" : "Começar"}
          </button>
          <p className="game-hint">Abra casas com 💎 e evite as 💣. Cada casa segura aumenta o prêmio; saque quando quiser. Mais minas, mais risco.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Dados ---------------- */
function Dice({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [chance, setChance] = useState(50);
  const [dir, setDir] = useState("under");
  const [st, setSt] = useState({ phase: "bet" });
  const [shown, setShown] = useState(null);
  const [busy, setBusy] = useState(false);
  const mult = diceMultiplier(chance);

  async function roll() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const result = rollDice();
    setSt({ phase: "roll" });
    for (let i = 0; i < 10; i++) {
      setShown(rollDice());
      await sleep(70);
    }
    setShown(result);
    const win = diceWins(result, chance, dir);
    const payout = win ? Math.floor(bet * mult) : 0;
    setSt({ phase: "done", net: payout - bet, label: win ? `Saiu ${result.toFixed(2)}: ganhou!` : `Saiu ${result.toFixed(2)}` });
    await round
      .finish({
        type: "dice",
        bet,
        payout,
        detail: `${dir === "under" ? `Abaixo de ${chance}` : `${100 - chance} ou mais`} (${chance}% · ${fmtX(mult)}) · saiu ${result.toFixed(2)}`,
      })
      .catch((e) => onError(e.message));
    setBusy(false);
  }

  const winLeft = dir === "under" ? 0 : 100 - chance;
  const win = st.phase === "done" && shown != null && diceWins(shown, chance, dir);
  return (
    <div className="game dice">
      <div className={"dice-number" + (st.phase === "done" ? (win ? " win" : " lose") : "")}>{shown == null ? "--" : shown.toFixed(2)}</div>
      <div className="dice-track">
        <i className="dice-zone" style={{ left: `${winLeft}%`, width: `${chance}%` }} />
        {shown != null && <b className="dice-pin" style={{ left: `${shown}%` }} />}
      </div>
      <div className="seg big">
        <button type="button" className={dir === "under" ? "sel" : ""} onClick={() => setDir("under")} disabled={busy}>
          Abaixo de {chance}
        </button>
        <button type="button" className={dir === "over" ? "sel" : ""} onClick={() => setDir("over")} disabled={busy}>
          {100 - chance} ou mais
        </button>
      </div>
      <label className="dice-slider">
        <span>
          Chance de ganhar <b>{chance}%</b>
        </span>
        <input type="range" min={DICE_MIN} max={DICE_MAX} step={1} value={chance} onChange={(e) => setChance(Number(e.target.value))} disabled={busy} />
        <small>
          Paga {fmtX(mult)} · ganha {coins(Math.floor(bet * mult))}
        </small>
      </label>

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={roll} disabled={busy || bet < 1}>
        {busy ? "Rolando…" : "Rolar os dados"}
      </button>
    </div>
  );
}

/* ---------------- Caça-níquel ---------------- */
function Slots({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [reels, setReels] = useState(["🍒", "🍋", "🍉"]);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const stopped = useRef(3);
  const flick = useRef(null);
  useEffect(() => () => clearInterval(flick.current), []);

  async function spin() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const result = [spinSlotReel(), spinSlotReel(), spinSlotReel()];
    setSt({ phase: "spin" });
    stopped.current = 0;
    flick.current = setInterval(() => {
      setReels((cur) => cur.map((s, i) => (i < stopped.current ? s : SLOT_SYMBOLS[randInt(SLOT_SYMBOLS.length)].s)));
    }, 80);
    for (let i = 0; i < 3; i++) {
      await sleep(650);
      stopped.current = i + 1;
      setReels((cur) => cur.map((s, j) => (j === i ? result[i] : s)));
    }
    clearInterval(flick.current);
    const mult = slotsMultiplier(result);
    const payout = Math.floor(bet * mult);
    setSt({
      phase: "done",
      net: payout - bet,
      label: mult >= SLOT_SYMBOLS[0].x ? `Trio! ${fmtX(mult)} 🎉` : mult > 0 ? `Dupla! ${fmtX(mult)}` : "Nada dessa vez",
    });
    await round.finish({ type: "slots", bet, payout, detail: `${result.join(" ")}${mult ? ` · ${fmtX(mult)}` : ""}` }).catch((e) => onError(e.message));
    setBusy(false);
  }

  return (
    <div className="game slots">
      <div className="slots-machine">
        {reels.map((s, i) => (
          <span key={i} className={"slots-reel" + (busy && i >= stopped.current ? " spin" : "")}>
            {s}
          </span>
        ))}
      </div>

      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={spin} disabled={busy || bet < 1}>
        {busy ? "Girando…" : "Girar"}
      </button>
      <div className="slots-pay">
        {[...SLOT_SYMBOLS].reverse().map((x) => (
          <span key={x.s}>
            {x.s}
            {x.s}
            {x.s} <b>{x.x}x</b>
          </span>
        ))}
        <span>
          Dois iguais <b>{fmtX(SLOT_PAIR_X)}</b>
        </span>
      </div>
    </div>
  );
}

/* ---------------- Raspadinha ---------------- */
function Scratch({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const finished = useRef(false);

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      finished.current = false;
      const card = scratchCard();
      setSt({ phase: "play", bet, card, rev: Array(SCRATCH_CELLS).fill(false) });
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function reveal(idxs) {
    if (st.phase !== "play" || finished.current) return;
    const rev = st.rev.map((r, i) => r || idxs.includes(i));
    if (!rev.every(Boolean)) return setSt({ ...st, rev });
    finished.current = true;
    const payout = Math.floor(st.bet * st.card.win);
    setSt({ ...st, rev, phase: "done", net: payout - st.bet, label: st.card.win ? `Três iguais! ${st.card.win}x 🎉` : "Sem prêmio" });
    await round
      .finish({ type: "scratch", bet: st.bet, payout, detail: st.card.win ? `Três vezes ${st.card.win}x` : "Nenhum trio" })
      .catch((e) => onError(e.message));
  }

  const playing = st.phase === "play";
  const done = st.phase === "done";
  const all = Array.from({ length: SCRATCH_CELLS }, (_, i) => i);
  return (
    <div className="game scratch">
      <div className="scratch-card">
        {all.map((i) => {
          const shown = st.rev?.[i];
          const v = st.card?.cells[i];
          return (
            <button
              type="button"
              key={i}
              className={"scratch-cell" + (shown ? " open" : "") + (shown && done && v === st.card.win ? " hit" : "")}
              disabled={!playing || shown}
              onClick={() => reveal([i])}
            >
              {shown ? `${v}x` : "?"}
            </button>
          );
        })}
      </div>

      {done && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <button type="button" className="btn btn-cash game-go" onClick={() => reveal(all)}>
          Raspar tudo
        </button>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {done ? "Outra raspadinha" : "Comprar raspadinha"}
          </button>
          <p className="game-hint">
            Toque nas casas para raspar. Três valores iguais ganham aquele valor da aposta (de {SCRATCH_PRIZES[0].x}x até {SCRATCH_PRIZES[SCRATCH_PRIZES.length - 1].x}x).
          </p>
        </>
      )}
    </div>
  );
}

/* ---------------- Mais ou menos ---------------- */
function HiLo({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      setSt({ phase: "play", bet, rank: drawHiloRank(), suit: randSuit(), mult: 1, streak: 0, history: [] });
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function finish(ns, payout, label) {
    setSt({ ...ns, phase: "done", payout, label, net: payout - ns.bet });
    await round
      .finish({
        type: "hilo",
        bet: ns.bet,
        payout,
        detail: `${ns.streak} ${ns.streak === 1 ? "acerto" : "acertos"} seguidos${payout > 0 ? ` (${fmtX(hiloPay(ns.mult, ns.streak))})` : ""}`,
      })
      .catch((e) => onError(e.message));
  }

  async function guess(dir) {
    if (hiloChance(st.rank, dir) <= 0) return;
    setBusy(true);
    const next = drawHiloRank();
    const suit = randSuit();
    const history = [...st.history, { rank: st.rank, suit: st.suit }].slice(-6);
    const ok = dir === "high" ? next > st.rank : next < st.rank;
    if (!ok) {
      await finish({ ...st, rank: next, suit, history }, 0, next === st.rank ? "Empate perde! 😬" : "Errou!");
    } else {
      setSt({ ...st, rank: next, suit, history, mult: st.mult * hiloStep(st.rank, dir), streak: st.streak + 1 });
    }
    setBusy(false);
  }

  async function cashout() {
    setBusy(true);
    const pay = hiloPay(st.mult, st.streak);
    await finish(st, Math.floor(st.bet * pay), `Sacou em ${fmtX(pay)}`);
    setBusy(false);
  }

  const playing = st.phase === "play";
  const done = st.phase === "done";
  const card = st.rank ? { r: HILO_RANKS[st.rank - 1], s: st.suit } : null;
  return (
    <div className="game hilo">
      <div className="hilo-table">
        {st.history?.length > 0 && (
          <div className="hilo-history">
            {st.history.map((h, i) => (
              <span key={i} className={h.suit === "♥" || h.suit === "♦" ? "red" : ""}>
                {HILO_RANKS[h.rank - 1]}
                {h.suit}
              </span>
            ))}
          </div>
        )}
        {card ? <PlayingCard c={card} i={0} key={`${st.streak}-${st.rank}-${st.suit}-${st.phase}`} /> : <div className="hilo-empty">📈</div>}
        {playing && (
          <div className="hilo-mult">
            {fmtX(hiloPay(st.mult, st.streak))} · {coins(Math.floor(st.bet * hiloPay(st.mult, st.streak)))}
          </div>
        )}
      </div>

      {done && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <>
          <div className="game-actions">
            <button type="button" className="btn btn-gradient" onClick={() => guess("high")} disabled={busy || hiloChance(st.rank, "high") <= 0}>
              ⬆️ Maior ({Math.round(hiloChance(st.rank, "high") * 100)}%)
              <small>{fmtX(hiloPay(st.mult * hiloStep(st.rank, "high"), st.streak + 1))}</small>
            </button>
            <button type="button" className="btn btn-gradient" onClick={() => guess("low")} disabled={busy || hiloChance(st.rank, "low") <= 0}>
              ⬇️ Menor ({Math.round(hiloChance(st.rank, "low") * 100)}%)
              <small>{fmtX(hiloPay(st.mult * hiloStep(st.rank, "low"), st.streak + 1))}</small>
            </button>
          </div>
          <button type="button" className="btn btn-cash game-go" onClick={cashout} disabled={busy || st.streak === 0}>
            Sacar {coins(Math.floor(st.bet * hiloPay(st.mult, st.streak)))}
          </button>
        </>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {done ? "Jogar de novo" : "Começar"}
          </button>
          <p className="game-hint">A próxima carta é maior ou menor? Cartas iguais perdem. Quanto mais arriscado o palpite, mais ele paga. Saque quando quiser.</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Torre ---------------- */
function Tower({ wallet, onError }) {
  const round = useRound();
  const [bet, setBet] = useState(100);
  const [mode, setMode] = useState("medio");
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
      setSt({ phase: "play", bet, mode, floor: 0, picks: [] });
    } catch (e) {
      onError(e.message);
    }
    setBusy(false);
  }

  async function finish(ns, payout, label) {
    setSt({ ...ns, phase: "done", payout, label, net: payout - ns.bet });
    await round
      .finish({
        type: "tower",
        bet: ns.bet,
        payout,
        detail: `${TOWER_MODES[ns.mode].label} · ${ns.dead != null ? `caiu no andar ${ns.dead + 1}` : `subiu ${ns.floor} ${ns.floor === 1 ? "andar" : "andares"} (${fmtX(towerMultiplier(ns.mode, ns.floor))})`}`,
      })
      .catch((e) => onError(e.message));
  }

  async function pick(tile) {
    if (st.phase !== "play" || busy) return;
    setBusy(true);
    const n = TOWER_MODES[st.mode].tiles;
    // chance de bomba = 1 / n; a bomba "pode estar" em qualquer casa
    const bombHit = randInt(n) === 0;
    if (bombHit) {
      await finish({ ...st, picks: [...st.picks, { tile, bomb: tile }], dead: st.floor }, 0, "Bomba! 💣");
    } else {
      let bomb = randInt(n - 1);
      if (bomb >= tile) bomb += 1; // a bomba fica em outra casa
      const ns = { ...st, picks: [...st.picks, { tile, bomb }], floor: st.floor + 1 };
      if (ns.floor >= TOWER_LEVELS) await finish(ns, Math.floor(st.bet * towerMultiplier(st.mode, ns.floor)), "Chegou ao topo! 🏆");
      else setSt(ns);
    }
    setBusy(false);
  }

  async function cashout() {
    setBusy(true);
    const m = towerMultiplier(st.mode, st.floor);
    await finish(st, Math.floor(st.bet * m), `Sacou em ${fmtX(m)}`);
    setBusy(false);
  }

  const playing = st.phase === "play";
  const done = st.phase === "done";
  const m = st.mode || mode;
  const tiles = TOWER_MODES[m].tiles;
  return (
    <div className="game tower">
      <div className="tower-rows">
        {Array.from({ length: TOWER_LEVELS }, (_, k) => TOWER_LEVELS - 1 - k).map((f) => {
          const cur = playing && f === st.floor;
          const passed = st.floor > f;
          const died = done && st.dead === f;
          const choice = st.picks?.[f];
          return (
            <div key={f} className={"tower-row" + (cur ? " cur" : "") + (passed ? " passed" : "") + (died ? " died" : "")}>
              <span className="tower-x">{fmtX(towerMultiplier(m, f + 1))}</span>
              <div className="tower-tiles" style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}>
                {Array.from({ length: tiles }, (_, t) => {
                  let label = "";
                  let cls = "";
                  if (choice && (passed || died)) {
                    if (choice.tile === t) {
                      label = died ? "💥" : "✅";
                      cls = died ? " boom" : " safe";
                    } else if (passed && choice.bomb === t) {
                      label = "💣";
                      cls = " mine";
                    }
                  }
                  return (
                    <button type="button" key={t} className={"tower-tile" + cls} disabled={!cur || busy} onClick={() => pick(t)}>
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {done && <ResultBanner net={st.net} label={st.label} />}

      {playing ? (
        <button type="button" className="btn btn-cash game-go" onClick={cashout} disabled={busy || st.floor === 0}>
          Sacar {coins(Math.floor(st.bet * towerMultiplier(st.mode, st.floor)))}
        </button>
      ) : (
        <>
          <div className="seg">
            {Object.entries(TOWER_MODES).map(([k, v]) => (
              <button type="button" key={k} className={mode === k ? "sel" : ""} onClick={() => setMode(k)} disabled={busy}>
                {v.label} ({v.tiles} casas)
              </button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {done ? "Jogar de novo" : "Começar"}
          </button>
          <p className="game-hint">Em cada andar, escolha uma casa: uma delas tem bomba. Suba até o topo ({TOWER_LEVELS} andares) ou saque antes.</p>
        </>
      )}
    </div>
  );
}

export const MORE_GAMES = [
  { id: "mines", name: "Minas", icon: "💣", desc: "Ache os diamantes", C: Mines },
  { id: "dice", name: "Dados", icon: "🎲", desc: "Escolha a chance", C: Dice },
  { id: "slots", name: "Caça-níquel", icon: "🎰", desc: "Até 150x", C: Slots },
  { id: "scratch", name: "Raspadinha", icon: "🎫", desc: "Até 100x", C: Scratch },
  { id: "hilo", name: "Mais ou menos", icon: "📈", desc: "Maior ou menor?", C: HiLo },
  { id: "tower", name: "Torre", icon: "🗼", desc: "Suba sem a bomba", C: Tower },
];
