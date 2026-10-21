import { useEffect, useRef, useState } from "react";
import { coins } from "../lib/casino";
import {
  TRUCO_CALL_NAME,
  applyTruco,
  UNO_COLORS,
  UNO_COLOR_NAME,
  randInt,
  trucoActor,
  trucoBot,
  trucoCanRaise,
  trucoNew,
  unoBot,
  unoCanPlay,
  unoDraw,
  unoLabel,
  unoNew,
  unoPass,
  unoPlay,
} from "../lib/gamesPure";
import { BetPicker, PlayingCard, ResultBanner, fmtX, useRound } from "./Casino";
import { useGuard } from "./CasinoClassics";
import Avatar from "./Avatar";

// Truco (2 jogadores) e Uno (2 a 4). Aqui ficam o jogo solo contra bots e os tabuleiros
// (TrucoBoard e UnoBoard) que as mesas de desafio também usam. As regras estão em lib/gamesPure.js.

/* ======================= Truco ======================= */
export function trucoSummary(st, names, me) {
  const who = (i) => (i === me ? "Você" : names[i]);
  const l = st.lastHand;
  if (!l) return "";
  return l.why === "run" ? `Última mão: ${who(1 - l.winner)} correu — ${who(l.winner)} levou ${l.pts} ${l.pts === 1 ? "ponto" : "pontos"}` : `Última mão: ${who(l.winner)} levou (+${l.pts})`;
}

export function TrucoBoard({ st, me, names, onAction, busy, waiting }) {
  const h = st.hand;
  const opp = 1 - me;
  const mine = h.cards[me];
  const myTurn = !st.over && !h.pending && h.turn === me;
  const mustAnswer = !st.over && h.pending && h.pending.from !== me;
  const waitingAnswer = !st.over && h.pending && h.pending.from === me;
  const nextCall = h.value < 12 ? { 1: 3, 3: 6, 6: 9, 9: 12 }[h.value] : null;
  const canRaise = trucoCanRaise(st, me);
  const msg = st.log || trucoSummary(st, names, me);
  return (
    <div className="truco">
      <div className="truco-score">
        <span className={"ts-side" + (h.turn === me && !h.pending ? " cur" : "")}>
          Você <b>{st.score[me]}</b>
        </span>
        <span className="ts-mid">até {st.target}</span>
        <span className={"ts-side" + (h.turn === opp && !h.pending ? " cur" : "")}>
          {names[opp]} <b>{st.score[opp]}</b>
        </span>
      </div>

      <div className="truco-felt">
        <div className="truco-opp">
          {h.cards[opp].map((_, i) => (
            <PlayingCard key={i} hidden i={i} />
          ))}
        </div>
        <div className="truco-mid">
          <div className="truco-vira">
            <PlayingCard c={h.vira} i={0} />
            <small>vira · manilha {h.manilha}</small>
          </div>
          {(() => {
            // sem cartas na mesa: mostra a última vaza (esmaecida) para dar para ver o que foi jogado
            const ghost = !h.cur[0] && !h.cur[1] && st.lastVaza;
            const c = (i) => h.cur[i] || (ghost ? st.lastVaza.plays[i] : null);
            return (
              <div className={"truco-table" + (ghost ? " ghost" : "")}>
                <div className="tt-slot">{c(opp) ? <PlayingCard c={c(opp)} i={0} /> : <span className="tt-empty" />}</div>
                <div className="tt-slot">{c(me) ? <PlayingCard c={c(me)} i={0} /> : <span className="tt-empty" />}</div>
              </div>
            );
          })()}
          <div className="truco-info">
            <span className="truco-value">Vale {h.value}</span>
            <span className="truco-vazas">
              {[0, 1, 2].map((k) => {
                const v = h.vazas[k];
                return (
                  <i key={k} className={v ? (v.winner === me ? "w" : v.winner === opp ? "l" : "t") : ""}>
                    {v ? (v.winner === me ? "✔" : v.winner === opp ? "✖" : "=") : "·"}
                  </i>
                );
              })}
            </span>
          </div>
        </div>
        <div className="truco-hand">
          {mine.map((c, i) => (
            <button type="button" key={c.r + c.s} className="truco-card" disabled={!myTurn || busy || waiting} onClick={() => onAction({ type: "play", idx: i })}>
              <PlayingCard c={c} i={i} />
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="truco-msg">{msg}</p>}
      {mustAnswer && (
        <div className="truco-ask">
          <b>
            {names[h.pending.from]}: {TRUCO_CALL_NAME[h.pending.value]}
          </b>
          <div className="game-actions">
            <button type="button" className="btn btn-gradient" disabled={busy} onClick={() => onAction({ type: "accept" })}>
              Aceitar ({h.pending.value})
            </button>
            {h.pending.value < 12 && (
              <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => onAction({ type: "raise_back" })}>
                {TRUCO_CALL_NAME[{ 3: 6, 6: 9, 9: 12 }[h.pending.value]]}
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onAction({ type: "run" })}>
              Correr
            </button>
          </div>
        </div>
      )}
      {waitingAnswer && <p className="game-hint">Você pediu {TRUCO_CALL_NAME[h.pending.value]} — esperando a resposta…</p>}
      {myTurn && !waiting && (
        <div className="game-actions">
          {canRaise && nextCall && (
            <button type="button" className="btn btn-danger-solid" disabled={busy} onClick={() => onAction({ type: "raise" })}>
              {TRUCO_CALL_NAME[nextCall]} ({nextCall})
            </button>
          )}
          <span className="truco-turn">Sua vez: jogue uma carta</span>
        </div>
      )}
    </div>
  );
}

function Truco({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [target, setTarget] = useState(12);
  const [st, setSt] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const bust = useRef(0);
  const NAMES = ["Você", "Bot"];

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const s = trucoNew(target);
    // o humano é sempre o jogador 0
    const meta = { bet, target };
    setSt(s);
    setRes(null);
    guard.current = () => round.finish({ type: "truco", bet: meta.bet, payout: 0, detail: `Truco de ${meta.target} pontos: saiu no meio da partida` }).catch(() => {});
    bust.current = meta;
    setBusy(false);
  }

  async function end(s) {
    const { bet: b, target: t } = bust.current;
    const won = s.winner === 0;
    const payout = won ? Math.floor(b * 1.9) : 0;
    guard.current = null;
    setRes({ net: payout - b, label: won ? `Você ganhou ${s.score[0]} a ${s.score[1]}! 🏆` : `O bot ganhou ${s.score[1]} a ${s.score[0]}` });
    await round.finish({ type: "truco", bet: b, payout, detail: `Truco de ${t} pontos · ${s.score[0]} × ${s.score[1]} contra o bot` }).catch((e) => onError(e.message));
  }

  const apply = (p, a) => {
    try {
      const ns = applyTruco(st, p, a);
      setSt(ns);
      if (ns.over) end(ns);
    } catch (e) {
      onError(e.message);
    }
  };

  // a vez do bot
  useEffect(() => {
    if (!st || st.over) return undefined;
    if (trucoActor(st) !== 1) return undefined;
    const t = setTimeout(() => apply(1, trucoBot(st, 1)), 900 + randInt(600));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  const playing = st && !st.over;
  return (
    <div className="game truco-game">
      {st && <TrucoBoard st={st} me={0} names={NAMES} busy={false} waiting={trucoActor(st) === 1} onAction={(a) => apply(0, a)} />}
      {res && <ResultBanner net={res.net} label={res.label} />}
      {!playing && (
        <>
          <div className="seg">
            {[6, 12].map((n) => (
              <button type="button" key={n} className={target === n ? "sel" : ""} onClick={() => setTarget(n)} disabled={busy}>
                {n === 6 ? "Rápido (6 pontos)" : "Completo (12 pontos)"}
              </button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {st?.over ? "Jogar de novo" : "Começar a partida"}
          </button>
          <p className="game-hint">Truco paulista contra o bot. Quem chegar primeiro a {target} pontos leva {fmtX(1.9)} da aposta. Manilhas: a carta seguinte à vira (♣ zap é a mais forte). Peça TRUCO para valer mais pontos!</p>
        </>
      )}
    </div>
  );
}

/* ======================= Uno ======================= */
export function UnoCard({ card, onClick, disabled, dim, back, small, glow }) {
  return (
    <button type="button" className={"uno-card" + (back ? " back" : " c-" + card.c) + (dim ? " dim" : "") + (small ? " small" : "") + (glow ? " glow" : "")} onClick={onClick} disabled={disabled}>
      {back ? <span className="uno-logo">UNO</span> : <span className="uno-ico">{unoLabel(card)}</span>}
    </button>
  );
}

export function UnoBoard({ st, meId, info, onPlay, onDraw, onPass, busy, waiting }) {
  const [pickIdx, setPickIdx] = useState(null);
  const myIdx = st.players.indexOf(meId);
  const myTurn = !st.winner && st.turn === myIdx && !waiting;
  const hand = st.hands[meId] || [];
  const curId = st.players[st.turn];
  useEffect(() => setPickIdx(null), [st.turn, hand.length]);

  function tap(i) {
    const c = hand[i];
    if (!myTurn || busy || !unoCanPlay(c, st, hand)) return;
    if (st.drawn && i !== hand.length - 1) return;
    if (c.c === "W") return setPickIdx(i);
    onPlay(i, null);
  }
  const others = st.players.filter((id) => id !== meId);
  return (
    <div className="uno">
      <div className="uno-others">
        {others.map((id) => (
          <div key={id} className={"uno-opp" + (id === curId && !st.winner ? " cur" : "") + (st.winner === id ? " win" : "")}>
            <Avatar src={info[id]?.photo} name={info[id]?.name} size={26} />
            <span className="uno-opp-name">{info[id]?.name || "?"}</span>
            <b className="uno-count">{st.hands[id]?.length ?? 0} 🂠</b>
            {st.hands[id]?.length === 1 && <i className="uno-alert">UNO!</i>}
          </div>
        ))}
      </div>

      <div className={"uno-center c-" + st.color}>
        <div className="uno-pile">
          <UnoCard back small disabled={!myTurn || busy || st.drawn} onClick={onDraw} />
          <small>{st.draw.length} no monte</small>
        </div>
        <div className="uno-top">
          <UnoCard card={st.top} disabled glow />
          <small>
            cor: <b>{UNO_COLOR_NAME[st.color]}</b> {st.dir === 1 ? "↻" : "↺"}
          </small>
        </div>
      </div>

      {st.log && <p className="truco-msg">{st.log}</p>}
      <div className={"pvp-turn" + (myTurn ? " mine" : "")}>
        {st.winner ? <b>{st.winner === meId ? "Você ganhou! 🏆" : `${info[st.winner]?.name} ganhou`}</b> : myTurn ? <b>Sua vez!</b> : <span>Vez de <b>{info[curId]?.name}</b></span>}
      </div>

      {pickIdx != null && (
        <div className="uno-colors">
          <span>Escolha a cor:</span>
          {UNO_COLORS.map((c) => (
            <button type="button" key={c} className={"uno-color c-" + c} onClick={() => (onPlay(pickIdx, c), setPickIdx(null))}>
              {UNO_COLOR_NAME[c]}
            </button>
          ))}
        </div>
      )}

      <div className="uno-hand">
        {hand.map((c, i) => (
          <UnoCard key={i + c.c + c.v} card={c} dim={!myTurn || !unoCanPlay(c, st, hand) || (st.drawn && i !== hand.length - 1)} disabled={!myTurn || busy} onClick={() => tap(i)} />
        ))}
      </div>
      {myTurn && st.drawn && (
        <button type="button" className="btn btn-ghost game-go" disabled={busy} onClick={onPass}>
          Passar a vez
        </button>
      )}
      {myTurn && !st.drawn && <p className="game-hint">Jogue uma carta da mesma cor, número ou símbolo — ou compre no monte.</p>}
    </div>
  );
}

function Uno({ wallet, onError }) {
  const round = useRound();
  const guard = useGuard();
  const [bet, setBet] = useState(100);
  const [bots, setBots] = useState(1);
  const [st, setSt] = useState(null);
  const [res, setRes] = useState(null);
  const [busy, setBusy] = useState(false);
  const meta = useRef(null);
  const ME = "eu";
  const info = { eu: { name: "Você" }, b1: { name: "Bot 1" }, b2: { name: "Bot 2" }, b3: { name: "Bot 3" } };

  async function start() {
    onError("");
    setBusy(true);
    try {
      await round.start(bet);
    } catch (e) {
      onError(e.message);
      setBusy(false);
      return;
    }
    const ids = [ME, ...["b1", "b2", "b3"].slice(0, bots)];
    const s = unoNew(ids);
    s.turn = randInt(ids.length);
    meta.current = { bet, bots };
    guard.current = () => round.finish({ type: "uno", bet, payout: 0, detail: `Uno contra ${bots} ${bots === 1 ? "bot" : "bots"}: saiu no meio da partida` }).catch(() => {});
    setSt(s);
    setRes(null);
    setBusy(false);
  }

  async function end(s) {
    const { bet: b, bots: nb } = meta.current;
    const won = s.winner === ME;
    const payout = won ? Math.floor(b * (nb + 1) * 0.95) : 0;
    guard.current = null;
    setRes({ net: payout - b, label: won ? "Você ganhou o Uno! 🏆" : `${info[s.winner].name} ganhou` });
    await round.finish({ type: "uno", bet: b, payout, detail: `Uno contra ${nb} ${nb === 1 ? "bot" : "bots"} · ${won ? "ganhou" : `${info[s.winner].name} ganhou`}` }).catch((e) => onError(e.message));
  }

  const run = (fn) => {
    try {
      const ns = fn(st);
      setSt(ns);
      if (ns.winner) end(ns);
    } catch (e) {
      onError(e.message);
    }
  };

  useEffect(() => {
    if (!st || st.winner) return undefined;
    const cur = st.players[st.turn];
    if (cur === ME) return undefined;
    const t = setTimeout(() => {
      const a = unoBot(st, cur);
      run((s) => (a.type === "play" ? unoPlay(s, cur, a.idx, a.color) : a.type === "draw" ? unoDraw(s, cur) : unoPass(s, cur)));
    }, 900 + randInt(500));
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st]);

  const playing = st && !st.winner;
  return (
    <div className="game uno-game">
      {st && (
        <UnoBoard
          st={st}
          meId={ME}
          info={info}
          busy={false}
          onPlay={(i, color) => run((s) => unoPlay(s, ME, i, color))}
          onDraw={() => run((s) => unoDraw(s, ME))}
          onPass={() => run((s) => unoPass(s, ME))}
        />
      )}
      {res && <ResultBanner net={res.net} label={res.label} />}
      {!playing && (
        <>
          <div className="seg">
            {[1, 2, 3].map((n) => (
              <button type="button" key={n} className={bots === n ? "sel" : ""} onClick={() => setBots(n)} disabled={busy}>
                {n} {n === 1 ? "bot" : "bots"} · {fmtX((n + 1) * 0.95)}
              </button>
            ))}
          </div>
          <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
          <button type="button" className="btn btn-gradient game-go" onClick={start} disabled={busy || bet < 1}>
            {st?.winner ? "Jogar de novo" : "Começar o Uno"}
          </button>
          <p className="game-hint">Seja o primeiro a ficar sem cartas. Contra mais bots o prêmio é maior. Ganhou: recebe {coins(Math.floor(bet * (bots + 1) * 0.95))}.</p>
        </>
      )}
    </div>
  );
}

export const CARD_GAMES = [
  { id: "truco", name: "Truco", icon: "♣️", desc: "Contra o bot", C: Truco },
  { id: "uno", name: "Uno", icon: "🟥", desc: "Fique sem cartas", C: Uno },
];
