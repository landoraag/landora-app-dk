import { useEffect, useRef, useState } from "react";
import { TOWER_LEVELS, TOWER_MODES, HILO_RANKS, MINES_SIZE } from "../lib/casino";
import {
  PLINKO_RISKS,
  POKER_NAMES,
  bingoGrid,
  bingoLetter,
  bingoLinesDone,
  crashMultiplierAt,
  trucoUnpack,
  wheelColor,
} from "../lib/gamesPure";
import { TURN_TIMEOUT, crashEndsAt, crashCash, crashFinalize, raceAction, raceScore, trucoTableAction, unoTableAction } from "../lib/tables";
import { PlayingCard, fmtX } from "./Casino";
import { BingoCardView } from "./CasinoClassics";
import { TrucoBoard, UnoBoard } from "./CasinoCards";
import Avatar from "./Avatar";

// Telas das mesas de desafio dos jogos novos (as regras e o que vai para o Firestore ficam em lib/tables.js).

const fx = (n) => `${Number(n).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}x`;
const nameOf = (t, uid) => t.players.find((p) => p.uid === uid)?.name || "?";
const photoOf = (t, uid) => t.players.find((p) => p.uid === uid)?.photo || "";

function useNow(active, ms = 1000) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const i = setInterval(() => setN(Date.now()), ms);
    return () => clearInterval(i);
  }, [active, ms]);
  return n;
}

// Revela o resultado aos poucos (só se a mesa acabou de terminar; quem abre depois vê tudo de uma vez).
function useStepper(total, t, ms) {
  const fresh = t.status === "done" && Date.now() - (t.updatedAt || 0) < 7000;
  const [n, setN] = useState(fresh ? 0 : total);
  useEffect(() => {
    if (n >= total) return undefined;
    const id = setTimeout(() => setN((x) => x + 1), ms);
    return () => clearTimeout(id);
  }, [n, total, ms]);
  return n;
}

/* ---------------- escolha de número/lado (Roleta e Bacará) ---------------- */
export function PickSelector({ game, players = [], value, onChange }) {
  if (game === "baccarat") {
    return (
      <div className="pvp-row">
        <span>Sua aposta</span>
        <div className="seg small">
          {[
            ["player", "Jogador"],
            ["banker", "Banca"],
          ].map(([k, l]) => (
            <button type="button" key={k} className={value === k ? "sel" : ""} onClick={() => onChange(k)}>
              {l}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const taken = new Set(players.map((p) => p.pick));
  return (
    <div className="pick-wheel">
      <span>Escolha seu número (quem chegar mais perto da bolinha leva o pote)</span>
      <div className="wh-numbers">
        {Array.from({ length: 37 }, (_, n) => (
          <button type="button" key={n} className={"wh-num " + wheelColor(n) + (value === n ? " sel" : "")} disabled={taken.has(n)} onClick={() => onChange(n)}>
            {n}
          </button>
        ))}
      </div>
    </div>
  );
}
export const pickLabel = (game, pick) => (game === "baccarat" ? (pick === "player" ? "Jogador" : "Banca") : `nº ${pick}`);

/* ---------------- resultado na hora ---------------- */
function Row({ t, uid, me, children }) {
  const win = t.result?.winners?.includes(uid);
  return (
    <div className={"inst-row" + (win ? " win" : "") + (uid === me.uid ? " me" : "")}>
      <div className="inst-who">
        <Avatar src={photoOf(t, uid)} name={nameOf(t, uid)} size={24} />
        <span>{nameOf(t, uid)}</span>
        {win && <i>👑</i>}
      </div>
      <div className="inst-res">{children}</div>
    </div>
  );
}

function SimpleRows({ t, me, cell }) {
  const step = useStepper(t.players.length, t, 650);
  return (
    <div className="inst">
      {t.players.map((p, i) => (
        <Row key={p.uid} t={t} uid={p.uid} me={me}>
          {i < step ? cell(p.uid) : <span className="inst-wait">…</span>}
        </Row>
      ))}
    </div>
  );
}

function KenoView({ t, me }) {
  const s = t.state;
  const total = s.draw.length + t.players.length;
  const step = useStepper(total, t, 280);
  const shown = s.draw.slice(0, Math.min(step, s.draw.length));
  const rowsShown = Math.max(0, step - s.draw.length);
  return (
    <div className="inst">
      <div className="inst-chips draw">
        {s.draw.map((n, i) => (
          <i key={n} className={i < shown.length ? "on" : ""}>
            {i < shown.length ? n : "?"}
          </i>
        ))}
      </div>
      {t.players.map((p, i) => (
        <Row key={p.uid} t={t} uid={p.uid} me={me}>
          <div className="inst-chips">
            {s.picks[p.uid].map((n) => (
              <i key={n} className={shown.includes(n) ? "hit" : ""}>
                {n}
              </i>
            ))}
          </div>
          <b>{i < rowsShown ? `${s.hits[p.uid]} ${s.hits[p.uid] === 1 ? "acerto" : "acertos"}` : "…"}</b>
        </Row>
      ))}
    </div>
  );
}

function BingoView({ t, me }) {
  const s = t.state;
  const step = useStepper(s.balls.length, t, 120);
  const drawn = s.balls.slice(0, step);
  const last = drawn[drawn.length - 1];
  return (
    <div className="inst">
      <div className="bingo-draw">
        {last ? (
          <span className="bingo-ball" key={last}>
            <small>{bingoLetter(last)}</small>
            {last}
          </span>
        ) : null}
        <span className="bingo-count">{step}ª bola</span>
      </div>
      <div className="inst-bingo">
        {t.players.map((p) => {
          const grid = bingoGrid(s.cards[p.uid]);
          const lines = bingoLinesDone(grid, drawn);
          return (
            <div key={p.uid} className={"inst-bingo-card" + (step >= s.balls.length && t.result?.winners?.includes(p.uid) ? " win" : "") + (p.uid === me.uid ? " me" : "")}>
              <div className="inst-who">
                <Avatar src={p.photo} name={p.name} size={20} />
                <span>{p.name}</span>
                <i>{lines ? `${lines} ${lines === 1 ? "linha" : "linhas"}` : ""}</i>
              </div>
              <BingoCardView card={grid} drawn={drawn} small />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WheelView({ t, me }) {
  const s = t.state;
  const step = useStepper(2, t, 1200);
  return (
    <div className="inst">
      <div className={"wh-ball " + (step >= 1 ? wheelColor(s.result) : "") + (step < 1 ? " spin" : "")}>{step >= 1 ? s.result : "🎡"}</div>
      {step >= 2 &&
        t.players.map((p) => (
          <Row key={p.uid} t={t} uid={p.uid} me={me}>
            <span className={"wh-num " + wheelColor(s.picks[p.uid])}>{s.picks[p.uid]}</span>
            <b>{s.dist[p.uid] === 0 ? "acertou!" : `${s.dist[p.uid]} ${s.dist[p.uid] === 1 ? "casa" : "casas"} de distância`}</b>
          </Row>
        ))}
    </div>
  );
}

function BaccaratView({ t, me }) {
  const s = t.state;
  const step = useStepper(3, t, 900);
  return (
    <div className="inst">
      <div className="bj-table">
        {["player", "banker"].map((side, k) => (
          <div className="bj-hand" key={side}>
            <div className="bj-label">
              {side === "player" ? "Jogador" : "Banca"} {step > k && <b>{side === "player" ? s.pt : s.bt}</b>}
              {step >= 3 && s.winner === side && <span className="bj-tag">venceu</span>}
            </div>
            <div className="bj-cards">{step > k && s[side].map((c, i) => <PlayingCard key={i} c={c} i={i} />)}</div>
          </div>
        ))}
      </div>
      {step >= 3 && (
        <div className="inst">
          {t.players.map((p) => (
            <Row key={p.uid} t={t} uid={p.uid} me={me}>
              <span>apostou {pickLabel("baccarat", s.picks[p.uid])}</span>
            </Row>
          ))}
        </div>
      )}
    </div>
  );
}

export function InstantTable({ t, me }) {
  const s = t.state;
  if (!s) return null;
  switch (t.game) {
    case "dice":
      return <SimpleRows t={t} me={me} cell={(u) => <b className="inst-big">{s.rolls[u].toFixed(2)}</b>} />;
    case "slots":
      return (
        <SimpleRows
          t={t}
          me={me}
          cell={(u) => (
            <>
              <span className="inst-reels">{s.reels[u].join(" ")}</span>
              <b>{s.mult[u] ? fx(s.mult[u]) : "—"}</b>
            </>
          )}
        />
      );
    case "scratch":
      return (
        <SimpleRows
          t={t}
          me={me}
          cell={(u) => (
            <>
              <span className="inst-cells">{s.cards[u].cells.map((c, i) => <i key={i} className={c === s.win[u] && s.win[u] ? "hit" : ""}>{c}x</i>)}</span>
              <b>{s.win[u] ? `trio ${s.win[u]}x` : "sem trio"}</b>
            </>
          )}
        />
      );
    case "plinko":
      return (
        <SimpleRows
          t={t}
          me={me}
          cell={(u) => (
            <>
              <span className="inst-reels">{PLINKO_RISKS[s.risk]?.label}</span>
              <b>casa {fx(s.drops[u].x)}</b>
            </>
          )}
        />
      );
    case "poker":
      return (
        <SimpleRows
          t={t}
          me={me}
          cell={(u) => (
            <div className="inst-poker">
              <div className="inst-cards">
                {s.hands[u].map((c, i) => (
                  <PlayingCard key={i} c={c} i={i} />
                ))}
              </div>
              <b>{POKER_NAMES[s.cats[u]]}</b>
            </div>
          )}
        />
      );
    case "keno":
      return <KenoView t={t} me={me} />;
    case "bingo":
      return <BingoView t={t} me={me} />;
    case "wheel":
      return <WheelView t={t} me={me} />;
    case "baccarat":
      return <BaccaratView t={t} me={me} />;
    default:
      return null;
  }
}

/* ---------------- corridas ---------------- */
function RaceList({ t, me, busy, act, detail }) {
  const s = t.state;
  const now = useNow(t.status === "playing");
  return (
    <div className="race">
      {t.players.map((p) => {
        const r = s.runners[p.uid];
        const idle = t.status === "playing" && !r.done && now - r.at > TURN_TIMEOUT && p.uid !== me.uid;
        const sc = raceScore(t.game, r);
        return (
          <div key={p.uid} className={"race-row" + (p.uid === me.uid ? " me" : "") + (t.result?.winners.includes(p.uid) ? " win" : "")}>
            <div className="race-name">
              <Avatar src={p.photo} name={p.name} size={22} />
              <span>{p.name}</span>
              <b>{sc < 0 ? "💥" : sc}</b>
            </div>
            <div className="race-state">
              {detail(r)}
              {idle && t.players.some((x) => x.uid === me.uid) && (
                <button type="button" className="btn-link" disabled={busy} onClick={act(() => raceAction(t.id, me.uid, "skip", null, p.uid))}>
                  forçar parada
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function MinesTable({ t, me, busy, act }) {
  const s = t.state;
  if (!s) return null;
  const mine = s.runners[me.uid];
  const playing = t.status === "playing" && mine && !mine.done;
  return (
    <div className="game mines">
      {mine && (
        <div className="mines-grid">
          {Array.from({ length: MINES_SIZE }, (_, i) => {
            const open = mine.open.includes(i);
            const boom = mine.dead === i;
            return (
              <button type="button" key={i} className={"mine-cell" + (open ? " safe" : "") + (boom ? " boom" : "")} disabled={!playing || busy || open} onClick={act(() => raceAction(t.id, me.uid, "pick", i))}>
                {open ? "💎" : boom ? "💥" : ""}
              </button>
            );
          })}
        </div>
      )}
      {playing && (
        <button type="button" className="btn btn-cash game-go" disabled={busy || mine.open.length < 1} onClick={act(() => raceAction(t.id, me.uid, "stop"))}>
          Parar aqui ({mine.open.length} {mine.open.length === 1 ? "casa" : "casas"})
        </button>
      )}
      <RaceList t={t} me={me} busy={busy} act={act} detail={(r) => (r.done ? (r.dead >= 0 ? "explodiu" : `parou com ${r.open.length}`) : `${r.open.length} ${r.open.length === 1 ? "casa segura" : "casas seguras"}…`)} />
      <p className="game-hint">{s.mines} {s.mines === 1 ? "mina" : "minas"} · ganha quem abrir mais casas seguras sem explodir</p>
    </div>
  );
}

export function TowerTable({ t, me, busy, act }) {
  const s = t.state;
  if (!s) return null;
  const mine = s.runners[me.uid];
  const playing = t.status === "playing" && mine && !mine.done;
  const tiles = TOWER_MODES[s.mode].tiles;
  return (
    <div className="game tower">
      {mine && (
        <div className="tower-rows">
          {Array.from({ length: TOWER_LEVELS }, (_, k) => TOWER_LEVELS - 1 - k).map((f) => {
            const cur = playing && f === mine.floor;
            const passed = mine.floor > f;
            const died = mine.dead === f;
            const choice = mine.picks[f];
            return (
              <div key={f} className={"tower-row" + (cur ? " cur" : "") + (passed ? " passed" : "") + (died ? " died" : "")}>
                <span className="tower-x">{f + 1}º</span>
                <div className="tower-tiles" style={{ gridTemplateColumns: `repeat(${tiles}, minmax(0, 1fr))` }}>
                  {Array.from({ length: tiles }, (_, k) => {
                    let label = "";
                    let cls = "";
                    if (choice && (passed || died)) {
                      if (choice.tile === k) {
                        label = died ? "💥" : "✅";
                        cls = died ? " boom" : " safe";
                      } else if (passed && choice.bomb === k) {
                        label = "💣";
                        cls = " mine";
                      }
                    }
                    return (
                      <button type="button" key={k} className={"tower-tile" + cls} disabled={!cur || busy} onClick={act(() => raceAction(t.id, me.uid, "pick", k))}>
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {playing && (
        <button type="button" className="btn btn-cash game-go" disabled={busy || mine.floor < 1} onClick={act(() => raceAction(t.id, me.uid, "stop"))}>
          Parar aqui ({mine.floor} {mine.floor === 1 ? "andar" : "andares"})
        </button>
      )}
      <RaceList t={t} me={me} busy={busy} act={act} detail={(r) => (r.done ? (r.dead >= 0 ? `caiu no andar ${r.dead + 1}` : `parou no andar ${r.floor}`) : `andar ${r.floor}…`)} />
      <p className="game-hint">{TOWER_MODES[s.mode].label} · ganha quem subir mais andares sem cair na bomba</p>
    </div>
  );
}

export function HiloTable({ t, me, busy, act }) {
  const s = t.state;
  if (!s) return null;
  const mine = s.runners[me.uid];
  const playing = t.status === "playing" && mine && !mine.done;
  return (
    <div className="game hilo">
      {mine && (
        <div className="hilo-table">
          {mine.history.length > 0 && (
            <div className="hilo-history">
              {mine.history.map((h, i) => (
                <span key={i} className={h.suit === "♥" || h.suit === "♦" ? "red" : ""}>
                  {HILO_RANKS[h.rank - 1]}
                  {h.suit}
                </span>
              ))}
            </div>
          )}
          <PlayingCard c={{ r: HILO_RANKS[mine.rank - 1], s: mine.suit }} i={0} key={`${mine.streak}-${mine.rank}-${mine.suit}`} />
          <div className="hilo-mult">{mine.dead ? "Errou! 😬" : `${mine.streak} ${mine.streak === 1 ? "acerto" : "acertos"} seguidos`}</div>
        </div>
      )}
      {playing && (
        <>
          <div className="game-actions">
            <button type="button" className="btn btn-gradient" disabled={busy || mine.rank >= 13} onClick={act(() => raceAction(t.id, me.uid, "guess", "high"))}>
              ⬆️ Maior ({Math.round(((13 - mine.rank) / 13) * 100)}%)
            </button>
            <button type="button" className="btn btn-gradient" disabled={busy || mine.rank <= 1} onClick={act(() => raceAction(t.id, me.uid, "guess", "low"))}>
              ⬇️ Menor ({Math.round(((mine.rank - 1) / 13) * 100)}%)
            </button>
          </div>
          <button type="button" className="btn btn-cash game-go" disabled={busy || mine.streak < 1} onClick={act(() => raceAction(t.id, me.uid, "stop"))}>
            Parar aqui ({mine.streak})
          </button>
        </>
      )}
      <RaceList t={t} me={me} busy={busy} act={act} detail={(r) => (r.done ? (r.dead ? "errou" : `parou com ${r.streak}`) : `${r.streak} ${r.streak === 1 ? "acerto" : "acertos"}…`)} />
      <p className="game-hint">Todos começam da mesma carta. Cartas iguais perdem. Ganha quem tiver mais acertos seguidos.</p>
    </div>
  );
}

/* ---------------- Crash ---------------- */
export function CrashTable({ t, me, busy, act }) {
  const s = t.state;
  const live = t.status === "playing";
  const now = useNow(live, 60);
  const finalizing = useRef(false);
  // depois que o foguete explode, qualquer um que estiver olhando fecha a mesa
  useEffect(() => {
    if (!s || !live || finalizing.current) return;
    if (now >= crashEndsAt(s) + 400) {
      finalizing.current = true;
      crashFinalize(t.id).catch(() => {});
    }
  }, [now, live, s, t.id]);
  if (!s) return null;
  const sec = (now - s.startAt) / 1000;
  const started = sec >= 0;
  const m = started ? crashMultiplierAt(sec) : 1;
  const boom = !live || (started && m >= s.crash);
  const shown = boom ? s.crash : m;
  const inside = t.players.some((p) => p.uid === me.uid);
  const cashed = s.cashed || {};

  return (
    <div className="game crash">
      <div className={"crash-screen" + (boom ? " boom" : "")}>
        <span className={"crash-rocket" + (started && !boom ? " fly" : "")}>{boom ? "💥" : "🚀"}</span>
        <b className="crash-mult">{started || boom ? fmtX(shown) : `${Math.max(0, Math.ceil(-sec))}…`}</b>
        {!started && live && <small>Decolando em instantes…</small>}
      </div>
      {live && inside && !cashed[me.uid] && !boom && started && (
        <button type="button" className="btn btn-cash game-go" disabled={busy} onClick={act(() => crashCash(t.id, me.uid))}>
          Sacar em {fmtX(m)}
        </button>
      )}
      <div className="race">
        {t.players.map((p) => (
          <div key={p.uid} className={"race-row" + (p.uid === me.uid ? " me" : "") + (t.result?.winners.includes(p.uid) ? " win" : "")}>
            <div className="race-name">
              <Avatar src={p.photo} name={p.name} size={22} />
              <span>{p.name}</span>
              <b>{cashed[p.uid] ? fmtX(cashed[p.uid]) : boom ? "💥" : "no foguete"}</b>
            </div>
          </div>
        ))}
      </div>
      <p className="game-hint">Todos no mesmo foguete. Quem sacar no maior valor antes de explodir leva o pote. Quem não sacar perde.</p>
    </div>
  );
}

/* ---------------- Truco e Uno ---------------- */
function TurnClock({ t, me, turnAt, curUid, onSkip, busy }) {
  const now = useNow(t.status === "playing");
  if (t.status !== "playing") return null;
  const left = Math.max(0, Math.ceil((turnAt + TURN_TIMEOUT - now) / 1000));
  const inside = t.players.some((p) => p.uid === me.uid);
  return (
    <div className="pvp-clock-row">
      <span>
        {curUid === me.uid ? "Sua vez" : `Vez de ${nameOf(t, curUid)}`} · {left > 0 ? `${left}s` : "tempo esgotado"}
      </span>
      {inside && curUid !== me.uid && left === 0 && (
        <button type="button" className="btn-link" disabled={busy} onClick={onSkip}>
          jogar por ele
        </button>
      )}
    </div>
  );
}

export function TrucoTable({ t, me, busy, act }) {
  if (!t.state) return null;
  const s = trucoUnpack(t.state);
  const seat = s.order.indexOf(me.uid);
  const names = s.order.map((u) => nameOf(t, u));
  const actorSeat = s.hand.pending ? 1 - s.hand.pending.from : s.hand.turn;
  if (seat < 0) {
    return (
      <div className="game">
        <p className="truco-msg">
          Assistindo · {names[0]} {s.score[0]} × {s.score[1]} {names[1]} (até {s.target})
        </p>
        <p className="game-hint">Só quem está jogando vê as cartas.</p>
      </div>
    );
  }
  return (
    <div className="game">
      <TrucoBoard st={s} me={seat} names={names} busy={busy} waiting={t.status !== "playing"} onAction={(a) => act(() => trucoTableAction(t.id, me.uid, a))()} />
      <TurnClock t={t} me={me} turnAt={s.turnAt} curUid={s.order[actorSeat]} busy={busy} onSkip={act(() => trucoTableAction(t.id, me.uid, { type: "skip" }))} />
    </div>
  );
}

export function UnoTable({ t, me, busy, act }) {
  const s = t.state;
  if (!s) return null;
  const info = {};
  t.players.forEach((p) => (info[p.uid] = { name: p.name, photo: p.photo }));
  return (
    <div className="game">
      <UnoBoard
        st={s}
        meId={me.uid}
        info={info}
        busy={busy}
        waiting={t.status !== "playing"}
        onPlay={(i, color) => act(() => unoTableAction(t.id, me.uid, { type: "play", idx: i, color }))()}
        onDraw={() => act(() => unoTableAction(t.id, me.uid, { type: "draw" }))()}
        onPass={() => act(() => unoTableAction(t.id, me.uid, { type: "pass" }))()}
      />
      <TurnClock t={t} me={me} turnAt={s.turnAt} curUid={s.players[s.turn]} busy={busy} onSkip={act(() => unoTableAction(t.id, me.uid, { type: "skip" }))} />
    </div>
  );
}
