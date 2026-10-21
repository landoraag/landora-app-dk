import { useEffect, useRef, useState } from "react";
import { coins } from "../lib/casino";
import {
  BC_PAY,
  BINGO_BALLS_SOLO,
  BINGO_LETTERS,
  BINGO_PAY,
  KENO_DRAW,
  KENO_MAX_PICKS,
  KENO_POOL,
  PLINKO_RISKS,
  PLINKO_ROWS,
  POKER_NAMES,
  VPOKER_PAY,
  WHEEL_BETS,
  WHEEL_NUMBER_X,
  baccaratX,
  bcTotal,
  bingoCard,
  bingoLetter,
  bingoLinesDone,
  bingoOrder,
  bingoPayX,
  crashMultiplierAt,
  crashPoint,
  deck52,
  kenoDraw,
  kenoRandomPicks,
  kenoTable,
  playBaccarat,
  plinkoDrop,
  plinkoTable,
  randInt,
  videoPokerX,
  wheelColor,
  wheelPayoutX,
} from "../lib/gamesPure";
import { BetPicker, PlayingCard, ResultBanner, fmtX, useRound } from "./Casino";

// Jogos "clássicos de cassino": Roleta, Bacará, Vídeo Poker, Crash, Plinko, Keno e Bingo.
// Regras e probabilidades em lib/gamesPure.js. Mesmo padrão dos outros jogos: a aposta sai da
// carteira quando a rodada começa e o prêmio entra no fim. Se a pessoa fechar a janela no meio,
// a rodada é resolvida na hora (com o resultado que já estava sorteado), então não se perde nada.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fx = (n) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;

// Guarda uma função que fecha a rodada se o jogo for fechado no meio da animação.
export function useGuard() {
  const ref = useRef(null);
  useEffect(
    () => () => {
      const f = ref.current;
      ref.current = null;
      if (f) f();
    },
    []
  );
  return ref;
}

/* ---------------- Roleta ---------------- */
function Wheel({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [sel, setSel] = useState({ kind: "bet", id: "red" });
  const [shown, setShown] = useState(null);
  const [hist, setHist] = useState([]);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const mult = sel.kind === "number" ? WHEEL_NUMBER_X : WHEEL_BETS.find((b) => b.id === sel.id).x;
  const label = sel.kind === "number" ? `Número ${sel.n}` : WHEEL_BETS.find((b) => b.id === sel.id).label;

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
    const result = randInt(37);
    const x = wheelPayoutX(sel, result);
    const payout = Math.floor(bet * x);
    const game = { type: "wheel", bet, payout, detail: `${label} · saiu ${result} (${{ red: "vermelho", black: "preto", green: "verde" }[wheelColor(result)]})` };
    guard.current = () => round.finish(game).catch(() => {});
    setSt({ phase: "spin" });
    for (let i = 0; i < 16; i++) {
      setShown(randInt(37));
      await sleep(55 + i * 16);
    }
    setShown(result);
    setHist((h) => [result, ...h].slice(0, 10));
    setSt({ phase: "done", net: payout - bet, label: x ? `Saiu ${result}: ganhou! 🎉` : `Saiu ${result}` });
    guard.current = null;
    await round.finish(game).catch((e) => onError(e.message));
    setBusy(false);
  }

  return (
    <div className="game wheel">
      <div className={"wh-ball " + (shown == null ? "" : wheelColor(shown)) + (busy ? " spin" : "")}>{shown == null ? "🎡" : shown}</div>
      {hist.length > 0 && (
        <div className="wh-hist">
          {hist.map((n, i) => (
            <span key={i} className={"wh-num " + wheelColor(n)}>
              {n}
            </span>
          ))}
        </div>
      )}
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      <div className="wh-bets">
        {WHEEL_BETS.map((b) => (
          <button type="button" key={b.id} className={(sel.kind === "bet" && sel.id === b.id ? "sel " : "") + (b.id === "red" ? "red" : b.id === "black" ? "black" : "")} onClick={() => setSel({ kind: "bet", id: b.id })} disabled={busy}>
            {b.label}
            <small>{b.x}x</small>
          </button>
        ))}
      </div>
      <div className="wh-numbers">
        {Array.from({ length: 37 }, (_, n) => (
          <button type="button" key={n} className={"wh-num " + wheelColor(n) + (sel.kind === "number" && sel.n === n ? " sel" : "")} onClick={() => setSel({ kind: "number", n })} disabled={busy}>
            {n}
          </button>
        ))}
      </div>
      <p className="game-hint">
        Aposta: <b>{label}</b> · paga {fx(mult)} · ganha {coins(Math.floor(bet * mult))}
      </p>
      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={spin} disabled={busy || bet < 1}>
        {busy ? "Girando…" : "Girar a roleta"}
      </button>
    </div>
  );
}

/* ---------------- Bacará ---------------- */
const BC_LABEL = { player: "Jogador", banker: "Banca", tie: "Empate" };
function Baccarat({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [pick, setPick] = useState("player");
  const [st, setSt] = useState({ phase: "bet", player: [], banker: [] });
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
    const r = playBaccarat();
    const x = baccaratX(pick, r.winner);
    const payout = Math.floor(bet * x);
    const game = { type: "baccarat", bet, payout, detail: `Apostou ${BC_LABEL[pick]} · Jogador ${r.pt} × Banca ${r.bt} (${r.winner === "tie" ? "empate" : r.winner === "player" ? "Jogador venceu" : "Banca venceu"})` };
    guard.current = () => round.finish(game).catch(() => {});
    // as cartas saem na ordem real: J1, B1, J2, B2, depois a terceira de cada lado (se houver)
    const seq = [["player", 0], ["banker", 0], ["player", 1], ["banker", 1]];
    if (r.player[2]) seq.push(["player", 2]);
    if (r.banker[2]) seq.push(["banker", 2]);
    const shown = { player: [], banker: [] };
    setSt({ phase: "deal", player: [], banker: [] });
    for (const [side, i] of seq) {
      await sleep(550);
      shown[side] = [...shown[side], r[side][i]];
      setSt({ phase: "deal", player: shown.player, banker: shown.banker });
    }
    await sleep(500);
    guard.current = null;
    setSt({ phase: "done", player: r.player, banker: r.banker, net: payout - bet, label: r.winner === "tie" ? "Empate" : r.winner === "player" ? "Jogador venceu" : "Banca venceu" });
    await round.finish(game).catch((e) => onError(e.message));
    setBusy(false);
  }

  const show = st.phase !== "bet";
  return (
    <div className="game bacc">
      {show && (
        <div className="bj-table">
          {["player", "banker"].map((side) => (
            <div className="bj-hand" key={side}>
              <div className="bj-label">
                {BC_LABEL[side]} <b>{st[side].length ? bcTotal(st[side]) : ""}</b>
                {pick === side && <span className="bj-tag">sua aposta</span>}
              </div>
              <div className="bj-cards">
                {st[side].map((c, i) => (
                  <PlayingCard key={i} c={c} i={i} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      <div className="seg big">
        {["player", "banker", "tie"].map((k) => (
          <button type="button" key={k} className={pick === k ? "sel" : ""} onClick={() => setPick(k)} disabled={busy}>
            {BC_LABEL[k]}
            <small>{fx(BC_PAY[k])}</small>
          </button>
        ))}
      </div>
      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={deal} disabled={busy || bet < 1}>
        {busy ? "Distribuindo…" : st.phase === "done" ? "Jogar de novo" : "Dar as cartas"}
      </button>
      <p className="game-hint">Chegue mais perto de 9 (só conta o último dígito da soma; 10, J, Q e K valem 0). No empate, aposta em Jogador ou Banca é devolvida. Banca paga 1,95x.</p>
    </div>
  );
}

/* ---------------- Vídeo Poker ---------------- */
function VideoPoker({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
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
    const deck = deck52();
    const hand = [deck.pop(), deck.pop(), deck.pop(), deck.pop(), deck.pop()];
    setSt({ phase: "hold", deck, hand, held: [false, false, false, false, false], bet });
    // se fechar a janela agora, a mão vale como está
    const r = videoPokerX(hand);
    const game = { type: "vpoker", bet, payout: Math.floor(bet * r.x), detail: `${r.name}${r.x ? ` (${fx(r.x)})` : ""}` };
    guard.current = () => round.finish(game).catch(() => {});
    setBusy(false);
  }

  async function draw() {
    setBusy(true);
    const deck = [...st.deck];
    const hand = st.hand.map((c, i) => (st.held[i] ? c : deck.pop()));
    const r = videoPokerX(hand);
    const payout = Math.floor(st.bet * r.x);
    guard.current = null;
    setSt({ ...st, phase: "done", hand, deck, net: payout - st.bet, label: r.x ? `${r.name}! ${fx(r.x)}` : r.name });
    await round.finish({ type: "vpoker", bet: st.bet, payout, detail: `${r.name}${r.x ? ` (${fx(r.x)})` : ""}` }).catch((e) => onError(e.message));
    setBusy(false);
  }

  const hold = st.phase === "hold";
  return (
    <div className="game vpoker">
      {st.hand && (
        <div className="vp-hand">
          {st.hand.map((c, i) => (
            <button type="button" key={i + "-" + c.r + c.s} className={"vp-card" + (st.held[i] ? " held" : "")} disabled={!hold} onClick={() => setSt({ ...st, held: st.held.map((h, j) => (j === i ? !h : h)) })}>
              <PlayingCard c={c} i={i} />
              <span className="vp-tag">{st.held[i] ? "SEGURA" : hold ? "toque" : ""}</span>
            </button>
          ))}
        </div>
      )}
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      {hold ? (
        <>
          <p className="game-hint">Toque nas cartas que quer segurar e depois troque as outras (uma troca só).</p>
          <button type="button" className="btn btn-gradient game-go" onClick={draw} disabled={busy}>
            Trocar cartas
          </button>
        </>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={deal} disabled={busy || bet < 1}>
            {st.phase === "done" ? "Jogar de novo" : "Distribuir"}
          </button>
        </>
      )}
      <div className="slots-pay">
        {VPOKER_PAY.map((p) => (
          <span key={p.cat}>
            {p.minPair ? "Par de valetes+" : POKER_NAMES[p.cat]} <b>{p.x}x</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---------------- Crash ---------------- */
function Crash({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [auto, setAuto] = useState("");
  const [st, setSt] = useState({ phase: "bet" });
  const [mult, setMult] = useState(1);
  const [hist, setHist] = useState([]);
  const live = useRef(null);
  const raf = useRef(0);
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  async function finish(L, cashAt) {
    if (L.done) return;
    L.done = true;
    cancelAnimationFrame(raf.current);
    guard.current = null;
    const payout = cashAt ? Math.floor(L.bet * cashAt) : 0;
    setHist((h) => [L.crash, ...h].slice(0, 8));
    setMult(cashAt || L.crash);
    setSt({ phase: "done", net: payout - L.bet, label: cashAt ? `Sacou em ${fmtX(cashAt)} 🚀` : `Explodiu em ${fmtX(L.crash)} 💥`, crash: L.crash, cashAt });
    await round
      .finish({ type: "crash", bet: L.bet, payout, detail: cashAt ? `Sacou em ${fmtX(cashAt)} · explodiu em ${fmtX(L.crash)}` : `Explodiu em ${fmtX(L.crash)} antes de sacar` })
      .catch((e) => onError(e.message));
  }

  async function start() {
    onError("");
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      return;
    }
    const L = { bet, crash: crashPoint(), t0: performance.now(), done: false, auto: Math.max(1.01, Number(String(auto).replace(",", ".")) || 0) };
    if (!(Number(String(auto).replace(",", ".")) > 1)) L.auto = 0;
    live.current = L;
    guard.current = () => finish(L, 0);
    setSt({ phase: "fly", bet });
    setMult(1);
    const tick = () => {
      if (L.done) return;
      const m = crashMultiplierAt((performance.now() - L.t0) / 1000);
      if (L.auto && L.auto < L.crash && m >= L.auto) return void finish(L, L.auto);
      if (m >= L.crash) return void finish(L, 0);
      setMult(m);
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
  }

  function cash() {
    const L = live.current;
    if (!L || L.done) return;
    const m = crashMultiplierAt((performance.now() - L.t0) / 1000);
    if (m >= L.crash) return void finish(L, 0);
    finish(L, Math.floor(m * 100) / 100);
  }

  const fly = st.phase === "fly";
  return (
    <div className="game crash">
      <div className={"crash-screen" + (st.phase === "done" ? (st.cashAt ? " win" : " boom") : "")}>
        <span className={"crash-rocket" + (fly ? " fly" : "")} style={fly ? { transform: `translate(${Math.min(70, Math.log(mult) * 40)}px, ${-Math.min(60, Math.log(mult) * 34)}px) rotate(-8deg)` } : undefined}>
          {st.phase === "done" && !st.cashAt ? "💥" : "🚀"}
        </span>
        <b className="crash-mult">{fmtX(mult)}</b>
        {fly && <small>Quanto mais espera, mais paga… mas pode explodir!</small>}
      </div>
      {hist.length > 0 && (
        <div className="crash-hist">
          {hist.map((c, i) => (
            <span key={i} className={c >= 2 ? "hi" : ""}>
              {fmtX(c)}
            </span>
          ))}
        </div>
      )}
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}

      {fly ? (
        <button type="button" className="btn btn-cash game-go" onClick={cash}>
          Sacar {coins(Math.floor(st.bet * mult))}
        </button>
      ) : (
        <>
          <label className="crash-auto">
            <span>Sacar sozinho em (opcional)</span>
            <input type="number" inputMode="decimal" min="1.01" step="0.1" placeholder="ex.: 2" value={auto} onChange={(e) => setAuto(e.target.value)} />
            <i>x</i>
          </label>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={false} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={bet < 1}>
            {st.phase === "done" ? "Decolar de novo" : "Decolar"}
          </button>
          <p className="game-hint">O foguete sobe e o multiplicador cresce. Saque antes de ele explodir!</p>
        </>
      )}
    </div>
  );
}

/* ---------------- Plinko ---------------- */
const PL_GAP = 26;
const PL_TOP = 22;
const PL_ROW = 23;
function Plinko({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [risk, setRisk] = useState("medio");
  const [st, setSt] = useState({ phase: "bet" });
  const [ball, setBall] = useState(null); // { x, y }
  const [busy, setBusy] = useState(false);
  const table = plinkoTable[risk];

  async function drop() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const { path, slot } = plinkoDrop();
    const x = table[slot];
    const payout = Math.floor(bet * x);
    const game = { type: "plinko", bet, payout, detail: `${PLINKO_RISKS[risk].label} · caiu na casa ${fx(x)}` };
    guard.current = () => round.finish(game).catch(() => {});
    setSt({ phase: "drop", slot: null });
    let s = 0;
    setBall({ x: 0, y: -6 });
    await sleep(180);
    for (let r = 0; r < PLINKO_ROWS; r++) {
      setBall({ x: (s - r / 2) * PL_GAP, y: PL_TOP + r * PL_ROW });
      await sleep(150);
      s += path[r];
    }
    setBall({ x: (s - PLINKO_ROWS / 2) * PL_GAP, y: PL_TOP + PLINKO_ROWS * PL_ROW });
    await sleep(350);
    guard.current = null;
    setSt({ phase: "done", slot, net: payout - bet, label: `Casa ${fx(x)}${x >= 1 ? "" : " 😬"}` });
    await round.finish(game).catch((e) => onError(e.message));
    setBusy(false);
  }

  const W = PL_GAP * (PLINKO_ROWS + 1);
  const H = PL_TOP + PLINKO_ROWS * PL_ROW + 42;
  return (
    <div className="game plinko">
      <svg className="pl-board" viewBox={`${-W / 2} 0 ${W} ${H}`} role="img" aria-label="Tabuleiro do Plinko">
        {Array.from({ length: PLINKO_ROWS }, (_, r) =>
          Array.from({ length: r + 1 }, (_, j) => <circle key={r + "-" + j} className="pl-peg" cx={(j - r / 2) * PL_GAP} cy={PL_TOP + r * PL_ROW} r="2.4" />)
        )}
        {table.map((m, i) => {
          const cx = (i - PLINKO_ROWS / 2) * PL_GAP;
          const y = PL_TOP + PLINKO_ROWS * PL_ROW + 12;
          return (
            <g key={i} className={"pl-slot" + (m >= 1 ? " hi" : " lo") + (st.phase === "done" && st.slot === i ? " hit" : "")}>
              <rect x={cx - PL_GAP / 2 + 1.5} y={y} width={PL_GAP - 3} height="22" rx="5" />
              <text x={cx} y={y + 14} textAnchor="middle">
                {m >= 100 ? Math.round(m) : m}
              </text>
            </g>
          );
        })}
        {ball && <circle className="pl-ball" cx="0" cy="0" r="5" style={{ transform: `translate(${ball.x}px, ${ball.y}px)` }} />}
      </svg>
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}
      <div className="seg">
        {Object.entries(PLINKO_RISKS).map(([k, v]) => (
          <button type="button" key={k} className={risk === k ? "sel" : ""} onClick={() => setRisk(k)} disabled={busy}>
            Risco {v.label.toLowerCase()}
          </button>
        ))}
      </div>
      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={drop} disabled={busy || bet < 1}>
        {busy ? "Caindo…" : st.phase === "done" ? "Soltar outra bolinha" : "Soltar a bolinha"}
      </button>
      <p className="game-hint">Quanto mais para as pontas, mais paga. No risco alto o meio paga quase nada.</p>
    </div>
  );
}

/* ---------------- Keno ---------------- */
function Keno({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [picks, setPicks] = useState([]);
  const [drawn, setDrawn] = useState([]);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const n = picks.length;

  const toggle = (k) => setPicks((p) => (p.includes(k) ? p.filter((x) => x !== k) : p.length >= KENO_MAX_PICKS ? p : [...p, k]));

  async function play() {
    if (!n) return onError("Escolha de 1 a " + KENO_MAX_PICKS + " números.");
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const result = kenoDraw();
    const hits = picks.filter((p) => result.includes(p)).length;
    const x = kenoTable[n][hits] || 0;
    const payout = Math.floor(bet * x);
    const game = { type: "keno", bet, payout, detail: `${n} ${n === 1 ? "número" : "números"} · ${hits} ${hits === 1 ? "acerto" : "acertos"}${x ? ` (${fx(x)})` : ""}` };
    guard.current = () => round.finish(game).catch(() => {});
    setDrawn([]);
    setSt({ phase: "draw" });
    for (let i = 0; i < result.length; i++) {
      await sleep(230);
      setDrawn(result.slice(0, i + 1));
    }
    await sleep(300);
    guard.current = null;
    setSt({ phase: "done", net: payout - bet, label: x ? `${hits} acertos! ${fx(x)} 🎉` : `${hits} ${hits === 1 ? "acerto" : "acertos"}` });
    await round.finish(game).catch((e) => onError(e.message));
    setBusy(false);
  }

  return (
    <div className="game keno">
      <div className="keno-grid">
        {Array.from({ length: KENO_POOL }, (_, i) => i + 1).map((k) => {
          const mine = picks.includes(k);
          const out = drawn.includes(k);
          return (
            <button type="button" key={k} className={"keno-cell" + (mine ? " mine" : "") + (out ? " out" : "") + (mine && out ? " hit" : "")} onClick={() => toggle(k)} disabled={busy}>
              {k}
            </button>
          );
        })}
      </div>
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}
      <div className="game-actions">
        <button type="button" className="btn btn-ghost" onClick={() => setPicks(kenoRandomPicks(Math.max(1, n || 5)))} disabled={busy}>
          🎲 Aleatório
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => (setPicks([]), setDrawn([]))} disabled={busy}>
          Limpar
        </button>
      </div>
      {n > 0 && (
        <div className="slots-pay">
          {kenoTable[n].map((m, h) => (m ? <span key={h}>{h} acertos <b>{fx(m)}</b></span> : null))}
        </div>
      )}
      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      <button type="button" className="btn btn-gradient game-go" onClick={play} disabled={busy || bet < 1 || !n}>
        {busy ? "Sorteando…" : `Sortear (${n}/${KENO_MAX_PICKS})`}
      </button>
      <p className="game-hint">Escolha de 1 a {KENO_MAX_PICKS} números. São sorteados {KENO_DRAW} de {KENO_POOL}. Quanto mais acertar, mais paga.</p>
    </div>
  );
}

/* ---------------- Bingo ---------------- */
export function BingoCardView({ card, drawn, small }) {
  const set = new Set(drawn);
  return (
    <div className={"bingo-card" + (small ? " small" : "")}>
      {BINGO_LETTERS.map((l) => (
        <b key={l} className="bingo-head">
          {l}
        </b>
      ))}
      {card.map((row, r) =>
        row.map((n, c) => (
          <span key={r + "-" + c} className={"bingo-cell" + (n === null ? " free" : set.has(n) ? " on" : "")}>
            {n === null ? "★" : n}
          </span>
        ))
      )}
    </div>
  );
}
function Bingo({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [st, setSt] = useState({ phase: "bet" });
  const [busy, setBusy] = useState(false);
  const skip = useRef(false);

  async function play() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const card = bingoCard();
    const balls = bingoOrder().slice(0, BINGO_BALLS_SOLO);
    const lines = bingoLinesDone(card, balls);
    const x = bingoPayX(lines);
    const payout = Math.floor(bet * x);
    const game = { type: "bingo", bet, payout, detail: `${lines} ${lines === 1 ? "linha" : "linhas"} em ${BINGO_BALLS_SOLO} bolas${x ? ` (${fx(x)})` : ""}` };
    guard.current = () => round.finish(game).catch(() => {});
    skip.current = false;
    setSt({ phase: "draw", card, drawn: [] });
    for (let i = 0; i < balls.length; i++) {
      if (!skip.current) await sleep(170);
      setSt({ phase: "draw", card, drawn: balls.slice(0, i + 1) });
    }
    await sleep(300);
    guard.current = null;
    setSt({ phase: "done", card, drawn: balls, lines, net: payout - bet, label: x ? `${lines} ${lines === 1 ? "linha" : "linhas"}! ${fx(x)} 🎉` : "Nenhuma linha" });
    await round.finish(game).catch((e) => onError(e.message));
    setBusy(false);
  }

  const last = st.drawn?.[st.drawn.length - 1];
  const lines = st.card ? bingoLinesDone(st.card, st.drawn) : 0;
  return (
    <div className="game bingo">
      {st.card && (
        <>
          <div className="bingo-draw">
            {last ? (
              <span className="bingo-ball" key={last}>
                <small>{bingoLetter(last)}</small>
                {last}
              </span>
            ) : null}
            <div className="bingo-last">
              {st.drawn
                .slice(-8, -1)
                .reverse()
                .map((n) => (
                  <i key={n}>{n}</i>
                ))}
            </div>
            <span className="bingo-count">
              {st.drawn.length}/{BINGO_BALLS_SOLO} bolas · {lines} {lines === 1 ? "linha" : "linhas"}
            </span>
          </div>
          <BingoCardView card={st.card} drawn={st.drawn} />
        </>
      )}
      {st.phase === "done" && <ResultBanner net={st.net} label={st.label} />}
      {st.phase === "draw" ? (
        <button type="button" className="btn btn-ghost game-go" onClick={() => (skip.current = true)}>
          Pular animação
        </button>
      ) : (
        <>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={play} disabled={busy || bet < 1}>
            {st.phase === "done" ? "Outra cartela" : "Comprar cartela"}
          </button>
          <div className="slots-pay">
            {BINGO_PAY.map((p) => (
              <span key={p.lines}>
                {p.lines}+ {p.lines === 1 ? "linha" : "linhas"} <b>{fx(p.x)}</b>
              </span>
            ))}
          </div>
          <p className="game-hint">São sorteadas {BINGO_BALLS_SOLO} bolas de 75. Linha, coluna ou diagonal completa vale prêmio (o centro é livre).</p>
        </>
      )}
    </div>
  );
}

export const CLASSIC_GAMES = [
  { id: "wheel", name: "Roleta", icon: "🎡", desc: "Cor, número ou dúzia", C: Wheel },
  { id: "baccarat", name: "Bacará", icon: "🎴", desc: "Jogador ou Banca", C: Baccarat },
  { id: "vpoker", name: "Vídeo Poker", icon: "♠️", desc: "Até 250x", C: VideoPoker },
  { id: "crash", name: "Crash", icon: "🚀", desc: "Saque a tempo", C: Crash },
  { id: "plinko", name: "Plinko", icon: "🔻", desc: "Até 93x", C: Plinko },
  { id: "keno", name: "Keno", icon: "🔢", desc: "Escolha seus números", C: Keno },
  { id: "bingo", name: "Bingo", icon: "🎱", desc: "Complete linhas", C: Bingo },
];
