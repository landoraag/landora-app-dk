import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useCollection } from "../lib/useCollection";
import { notify } from "../lib/push";
import { CASINO_CHANNEL_ID, CHICKEN_LEVELS, MINES_OPTIONS, TOWER_MODES, chickenMultiplier, coins, handValue } from "../lib/casino";
import { PLINKO_RISKS } from "../lib/gamesPure";
import {
  PVP_GAMES,
  TURN_TIMEOUT,
  bjAction,
  chickenAction,
  crashEndsAt,
  crashFinalize,
  createTable,
  joinTable,
  leaveTable,
  rouletteAction,
  startTable,
} from "../lib/tables";
import { BetPicker, PlayingCard, fmtX } from "./Casino";
import { CrashTable, HiloTable, InstantTable, MinesTable, PickSelector, TowerTable, TrucoTable, UnoTable, pickLabel } from "./TablesMore";
import Avatar from "./Avatar";

const useMe = () => {
  const { user, profile } = useAuth();
  return { uid: user.uid, name: profile?.nickname || "—", photo: profile?.photoURL || "" };
};

function useNow(active) {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setN(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return n;
}

/* ---------------- criar desafio ---------------- */
const DEFAULT_LEVEL = { chicken: "medio", mines: "3", tower: "medio", plinko: "medio", truco: "12" };
// o que aparece embaixo do nome do jogo no cartão da mesa
export function tableSub(t) {
  const lv = t.level;
  if (t.game === "chicken") return CHICKEN_LEVELS[lv]?.label;
  if (t.game === "mines") return `${lv} ${Number(lv) === 1 ? "mina" : "minas"}`;
  if (t.game === "tower") return TOWER_MODES[lv]?.label;
  if (t.game === "plinko") return `risco ${PLINKO_RISKS[lv]?.label?.toLowerCase()}`;
  if (t.game === "truco") return `${lv === "6" ? 6 : 12} pontos`;
  return "";
}

export function CreateTable({ wallet, onDone }) {
  const me = useMe();
  const { data: users } = useCollection("users", "createdAt", "asc");
  const people = users.filter((u) => u.id !== me.uid && u.nickname);
  const [game, setGame] = useState("blackjack");
  const [bet, setBet] = useState(100);
  const [maxPlayers, setMaxPlayers] = useState(2);
  const [level, setLevel] = useState("medio");
  const [side, setSide] = useState("cara");
  const [pick, setPick] = useState(null);
  const [open, setOpen] = useState(true);
  const [invited, setInvited] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const g = PVP_GAMES[game];
  const duel = g.max === 2; // só 2 jogadores (cara ou coroa, truco)

  function chooseGame(k) {
    setGame(k);
    setLevel(DEFAULT_LEVEL[k] || "medio");
    setPick(k === "baccarat" ? "player" : null);
    setInvited([]);
    setMaxPlayers((n) => Math.min(Math.max(n, PVP_GAMES[k].min), PVP_GAMES[k].max));
  }

  async function create() {
    setError("");
    if (!open && !invited.length) return setError("Escolha quem você quer desafiar.");
    if (g.needsPick && pick == null) return setError(game === "wheel" ? "Escolha o seu número." : "Escolha Jogador ou Banca.");
    setBusy(true);
    try {
      const inv = open ? [] : invited;
      const max = duel ? 2 : open ? Math.min(g.max, maxPlayers) : Math.min(g.max, Math.max(g.min, inv.length + 1));
      await createTable(me, { game, bet, maxPlayers: max, invited: inv, level, side, pick });
      if (inv.length)
        notify({
          kind: "mention",
          title: `⚔️ ${me.name} te desafiou no ${g.name}`,
          body: `Aposta de ${coins(bet)} — abra o #cassino para aceitar`,
          url: `/chat?c=${CASINO_CHANNEL_ID}`,
          tag: "casino-pvp",
          to: inv,
        });
      onDone();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  }

  const toggle = (uid) => setInvited((l) => (l.includes(uid) ? l.filter((x) => x !== uid) : [...l, uid]));
  const Seg = ({ value, onChange, items }) => (
    <div className="seg">
      {items.map(([k, label]) => (
        <button type="button" key={k} className={value === k ? "sel" : ""} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="game pvp-create">
      <div className="pvp-games">
        {Object.entries(PVP_GAMES).map(([k, v]) => (
          <button type="button" key={k} className={"pvp-game" + (game === k ? " sel" : "")} onClick={() => chooseGame(k)}>
            <span>{v.icon}</span>
            <b>{v.name}</b>
          </button>
        ))}
      </div>
      {g.hint && <p className="game-hint pvp-hint">{g.hint}</p>}

      {game === "chicken" && <Seg value={level} onChange={setLevel} items={Object.entries(CHICKEN_LEVELS).map(([k, v]) => [k, v.label])} />}
      {game === "mines" && <Seg value={level} onChange={setLevel} items={MINES_OPTIONS.map((n) => [String(n), `${n} ${n === 1 ? "mina" : "minas"}`])} />}
      {game === "tower" && <Seg value={level} onChange={setLevel} items={Object.entries(TOWER_MODES).map(([k, v]) => [k, `${v.label} (${v.tiles} casas)`])} />}
      {game === "plinko" && <Seg value={level} onChange={setLevel} items={Object.entries(PLINKO_RISKS).map(([k, v]) => [k, `Risco ${v.label.toLowerCase()}`])} />}
      {game === "truco" && <Seg value={level} onChange={setLevel} items={[["6", "Rápido (6 pontos)"], ["12", "Completo (12 pontos)"]]} />}
      {game === "coinflip" && <Seg value={side} onChange={setSide} items={["cara", "coroa"].map((s) => [s, `Eu fico com ${s}`])} />}
      {g.needsPick && <PickSelector game={game} players={[]} value={pick} onChange={setPick} />}

      <div className="seg">
        <button type="button" className={open ? "sel" : ""} onClick={() => setOpen(true)}>
          🌐 Aberto a todos
        </button>
        <button type="button" className={!open ? "sel" : ""} onClick={() => setOpen(false)}>
          🎯 Desafiar pessoas
        </button>
      </div>

      {open ? (
        !duel && (
          <div className="pvp-row">
            <span>Jogadores</span>
            <div className="seg small">
              {Array.from({ length: g.max - g.min + 1 }, (_, i) => g.min + i).map((n) => (
                <button type="button" key={n} className={maxPlayers === n ? "sel" : ""} onClick={() => setMaxPlayers(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
        )
      ) : (
        <div className="pvp-people">
          {people.map((p) => (
            <button
              type="button"
              key={p.id}
              className={"pvp-person" + (invited.includes(p.id) ? " sel" : "")}
              onClick={() => (duel ? setInvited([p.id]) : toggle(p.id))}
              disabled={!duel && !invited.includes(p.id) && invited.length >= g.max - 1}
            >
              <Avatar src={p.photoURL} name={p.nickname} size={26} />
              <span>{p.nickname}</span>
            </button>
          ))}
          {!people.length && <p className="muted">Ninguém mais na equipe ainda.</p>}
        </div>
      )}

      <BetPicker value={bet} onChange={setBet} balance={wallet?.balance} disabled={busy} />
      {error && <p className="auth-error">{error}</p>}
      <button type="button" className="btn btn-gradient game-go" onClick={create} disabled={busy || bet < 1}>
        Criar mesa · todos apostam {coins(bet)}
      </button>
      <p className="game-hint">O vencedor leva o pote inteiro. Cancelou antes de começar: todos recebem de volta.</p>
    </div>
  );
}

/* ---------------- cartão da mesa (aparece no chat) ---------------- */
function useTable(id) {
  const [t, setT] = useState(undefined);
  useEffect(() => onSnapshot(doc(db, "casinoTables", id), (s) => setT(s.exists() ? { id: s.id, ...s.data() } : null), () => setT(null)), [id]);
  return t;
}

const STATUS = { lobby: "Esperando jogadores", playing: "Em jogo", done: "Terminou", cancelled: "Cancelada" };

export function TableCard({ id }) {
  const me = useMe();
  const t = useTable(id);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState(false);
  const [pick, setPick] = useState(null);
  const prev = useRef(null);

  // Quando a mesa começa, abre sozinho para quem está jogando.
  useEffect(() => {
    if (!t) return;
    const mine = t.players.some((p) => p.uid === me.uid);
    if (prev.current === "lobby" && t.status !== "lobby" && t.status !== "cancelled" && mine) setView(true);
    prev.current = t.status;
  }, [t?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Crash: se o foguete já explodiu e ninguém fechou a mesa, quem estiver com o chat aberto fecha
  useEffect(() => {
    if (t && t.game === "crash" && t.status === "playing" && t.state) {
      const left = crashEndsAt(t.state) + 400 - Date.now();
      const id = setTimeout(() => crashFinalize(t.id).catch(() => {}), Math.max(0, left) + 50);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [t?.status, t?.state?.startAt]); // eslint-disable-line react-hooks/exhaustive-deps

  if (t === undefined) return <div className="table-card loading">Carregando mesa…</div>;
  if (t === null) return <div className="table-card">Mesa não encontrada.</div>;

  const g = PVP_GAMES[t.game];
  const inside = t.players.some((p) => p.uid === me.uid);
  const host = t.hostId === me.uid;
  const invitedOnly = t.invited?.length > 0;
  const canJoin = t.status === "lobby" && !inside && t.players.length < t.maxPlayers && (!invitedOnly || t.invited.includes(me.uid));
  const act = (fn) => async () => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const myPay = t.result?.payouts?.[me.uid];

  return (
    <div className={"table-card st-" + t.status}>
      <div className="tc-head">
        <span className="tc-icon">{g.icon}</span>
        <div className="tc-title">
          <b>{g.name}</b>
          <span>
            {coins(t.bet)} cada · pote {coins(t.bet * t.players.length)}
            {tableSub(t) ? ` · ${tableSub(t)}` : ""}
          </span>
        </div>
        <span className={"tc-status s-" + t.status}>{STATUS[t.status]}</span>
      </div>

      <div className="tc-players">
        {t.players.map((p) => (
          <span key={p.uid} className={"tc-player" + (t.result?.winners?.includes(p.uid) ? " win" : "")} title={p.name}>
            <Avatar src={p.photo} name={p.name} size={26} />
            <span>{p.name}</span>
            {p.pick != null && <em className="tc-pick">{pickLabel(t.game, p.pick)}</em>}
            {t.result?.winners?.includes(p.uid) && <i>👑</i>}
          </span>
        ))}
        {t.status === "lobby" &&
          Array.from({ length: t.maxPlayers - t.players.length }, (_, i) => <span key={"e" + i} className="tc-player empty">vaga</span>)}
      </div>
      {invitedOnly && t.status === "lobby" && <div className="tc-note">🎯 Só para convidados</div>}
      {t.game === "coinflip" && t.status === "lobby" && <div className="tc-note">{t.hostName} fica com {t.side}; quem entrar fica com {t.side === "cara" ? "coroa" : "cara"}</div>}
      {t.result && (
        <div className="tc-result">
          <b>{t.result.text}</b>
          {inside && myPay != null && <span className="tc-mine">{myPay > t.bet ? `Você ganhou ${coins(myPay - t.bet)}` : "Sua aposta voltou"}</span>}
          {inside && myPay == null && <span className="tc-mine lose">Você perdeu {coins(t.bet)}</span>}
        </div>
      )}
      {error && <p className="auth-error">{error}</p>}

      {canJoin && g.needsPick && <PickSelector game={t.game} players={t.players} value={pick} onChange={setPick} />}
      <div className="tc-actions">
        {canJoin && (
          <button type="button" className="btn btn-gradient" disabled={busy || (g.needsPick && pick == null)} onClick={act(() => joinTable(id, me, pick))}>
            Entrar · {coins(t.bet)}
          </button>
        )}
        {t.status === "lobby" && inside && !host && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={act(() => leaveTable(id, me.uid))}>
            Sair
          </button>
        )}
        {t.status === "lobby" && host && (
          <>
            {t.game !== "coinflip" && (
              <button type="button" className="btn btn-gradient" disabled={busy || t.players.length < g.min} onClick={act(() => startTable(id, me.uid))}>
                {t.players.length < g.min ? "Esperando adversário…" : `Começar (${t.players.length})`}
              </button>
            )}
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={act(() => leaveTable(id, me.uid))}>
              Cancelar
            </button>
          </>
        )}
        {(t.status === "playing" || t.status === "done") && (
          <button type="button" className={"btn " + (t.status === "playing" && inside ? "btn-gradient" : "btn-ghost")} onClick={() => setView(true)}>
            {t.status === "playing" ? (inside ? "Abrir mesa" : "Assistir") : "Ver mesa"}
          </button>
        )}
      </div>

      {view && <TableModal t={t} me={me} onClose={() => setView(false)} />}
    </div>
  );
}

/* ---------------- a mesa aberta ---------------- */
function TableModal({ t, me, onClose }) {
  const g = PVP_GAMES[t.game];
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const act = (fn) => async () => {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    }
    setBusy(false);
  };
  const props = { t, me, busy, act };
  return (
    createPortal(
    <div className="modal-backdrop casino-backdrop" onClick={onClose}>
      <div className={"casino-modal pvp g-" + t.game} onClick={(e) => e.stopPropagation()}>
        <header className="casino-modal-head">
          <h3>
            {g.icon} {g.name}
          </h3>
          <span className="casino-modal-bal">pote {coins(t.bet * t.players.length)}</span>
          <button type="button" className="modal-close" onClick={onClose} aria-label="Fechar">
            ✕
          </button>
        </header>
        {error && <p className="auth-error">{error}</p>}
        {t.game === "blackjack" && <BjTable {...props} />}
        {t.game === "roulette" && <RouletteTable {...props} />}
        {t.game === "chicken" && <ChickenTable {...props} />}
        {t.game === "coinflip" && <CoinTable {...props} />}
        {t.game === "mines" && <MinesTable {...props} />}
        {t.game === "tower" && <TowerTable {...props} />}
        {t.game === "hilo" && <HiloTable {...props} />}
        {t.game === "crash" && <CrashTable {...props} />}
        {t.game === "truco" && <TrucoTable {...props} />}
        {t.game === "uno" && <UnoTable {...props} />}
        {g.kind === "instant" && t.game !== "coinflip" && <InstantTable t={t} me={me} />}
        {t.result && (() => {
          const inside = t.players.some((p) => p.uid === me.uid);
          const got = t.result.payouts?.[me.uid];
          const net = inside ? (got || 0) - t.bet : null;
          return (
            <div className={"casino-result " + (net > 0 ? "win" : net < 0 ? "lose" : "push")}>
              <b>{t.result.text}</b>
              <span>{net == null ? "" : net > 0 ? `+${coins(net)}` : net < 0 ? `-${coins(-net)}` : "Aposta devolvida"}</span>
            </div>
          );
        })()}
      </div>
    </div>,
    document.body
  )
  );
}

const nameOf = (t, uid) => t.players.find((p) => p.uid === uid)?.name || "?";
const photoOf = (t, uid) => t.players.find((p) => p.uid === uid)?.photo || "";

function TurnInfo({ t, me, cur, turnAt, onSkip, busy }) {
  const now = useNow(t.status === "playing");
  if (t.status !== "playing" || !cur) return null;
  const left = Math.max(0, Math.ceil((turnAt + TURN_TIMEOUT - now) / 1000));
  return (
    <div className={"pvp-turn" + (cur === me.uid ? " mine" : "")}>
      {cur === me.uid ? <b>Sua vez!</b> : <span>Vez de <b>{nameOf(t, cur)}</b></span>}
      <span className="pvp-clock">{left > 0 ? `${left}s` : "tempo esgotado"}</span>
      {cur !== me.uid && left === 0 && t.players.some((p) => p.uid === me.uid) && (
        <button type="button" className="btn-link" disabled={busy} onClick={onSkip}>
          pular vez
        </button>
      )}
    </div>
  );
}

/* Blackjack: mão contra mão */
function BjTable({ t, me, busy, act }) {
  const s = t.state;
  if (!s) return null;
  const cur = s.turn >= 0 ? s.order[s.turn] : null;
  const mine = cur === me.uid && t.status === "playing";
  return (
    <div className="game">
      <TurnInfo t={t} me={me} cur={cur} turnAt={s.turnAt} busy={busy} onSkip={act(() => bjAction(t.id, me.uid, "skip"))} />
      <div className="pvp-hands">
        {s.order.map((uid) => {
          const v = handValue(s.hands[uid]).total;
          return (
            <div key={uid} className={"pvp-hand" + (uid === cur ? " cur" : "") + (t.result?.winners.includes(uid) ? " win" : "")}>
              <div className="bj-label">
                <Avatar src={photoOf(t, uid)} name={nameOf(t, uid)} size={20} />
                {nameOf(t, uid)} <b>{v}</b>
                {v > 21 ? <span className="bj-tag bust">estourou</span> : s.done[uid] && t.status === "playing" ? <span className="bj-tag">parou</span> : null}
              </div>
              <div className="bj-cards">
                {s.hands[uid].map((c, i) => (
                  <PlayingCard key={i} c={c} i={i} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {mine && (
        <div className="game-actions">
          <button type="button" className="btn btn-gradient" disabled={busy} onClick={act(() => bjAction(t.id, me.uid, "hit"))}>
            Pedir carta
          </button>
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={act(() => bjAction(t.id, me.uid, "stand"))}>
            Parar
          </button>
        </div>
      )}
    </div>
  );
}

/* Roleta russa: um revólver para todos */
function RouletteTable({ t, me, busy, act }) {
  const s = t.state;
  const [fx, setFx] = useState("");
  const pulls = s?.pulls?.length || 0;
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return undefined;
    }
    if (!pulls) return undefined;
    setFx(s.pulls[pulls - 1].bang ? "bang" : "click");
    const tm = setTimeout(() => setFx(""), 900);
    return () => clearTimeout(tm);
  }, [pulls]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!s) return null;
  const cur = t.status === "playing" ? s.order[s.turn] : null;
  return (
    <div className={"game roulette" + (fx === "bang" ? " bang" : "")}>
      <TurnInfo t={t} me={me} cur={cur} turnAt={s.turnAt} busy={busy} onSkip={act(() => rouletteAction(t.id, me.uid, "skip"))} />
      <div className="rr-stage">
        <div className="rr-cylinder" style={{ transform: `rotate(${s.chamber * 60}deg)` }}>
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className={"rr-chamber" + (i < s.chamber ? " empty" : "") + (s.dead && i === s.chamber ? " shot" : "")} style={{ "--a": `${-i * 60}deg` }} />
          ))}
          <span className="rr-pin" />
        </div>
        {fx === "click" && <span className="rr-fx click">*click*</span>}
        {fx === "bang" && <span className="rr-fx bang">BANG!</span>}
      </div>
      <div className="pvp-order">
        {s.order.map((uid, i) => (
          <span key={uid} className={"pvp-seat" + (uid === cur ? " cur" : "") + (s.dead === uid ? " dead" : "")}>
            <Avatar src={photoOf(t, uid)} name={nameOf(t, uid)} size={30} />
            <span>{nameOf(t, uid)}</span>
            <i>{s.dead === uid ? "💀" : `${i + 1}º`}</i>
          </span>
        ))}
      </div>
      {cur === me.uid && (
        <button type="button" className="btn btn-danger-solid game-go" disabled={busy} onClick={act(() => rouletteAction(t.id, me.uid, "pull"))}>
          Puxar o gatilho
        </button>
      )}
      <p className="game-hint">Puxadas: {pulls} de 6 · quem levar o tiro perde; os outros dividem o pote</p>
    </div>
  );
}

/* Corrida da galinha: cada um na sua estrada */
function ChickenTable({ t, me, busy, act }) {
  const s = t.state;
  const now = useNow(t.status === "playing");
  if (!s) return null;
  const lv = CHICKEN_LEVELS[s.level];
  const mine = s.runners[me.uid];
  return (
    <div className="game">
      <div className="race">
        {t.players.map((p) => {
          const r = s.runners[p.uid];
          const idle = t.status === "playing" && !r.done && now - r.at > TURN_TIMEOUT && p.uid !== me.uid;
          return (
            <div key={p.uid} className={"race-row" + (p.uid === me.uid ? " me" : "") + (t.result?.winners.includes(p.uid) ? " win" : "")}>
              <div className="race-name">
                <Avatar src={p.photo} name={p.name} size={22} />
                <span>{p.name}</span>
                <b>{r.dead ? "💥" : r.steps ? fmtX(chickenMultiplier(s.level, r.steps)) : "—"}</b>
              </div>
              <div className="race-road">
                {Array.from({ length: lv.lanes }, (_, i) => (
                  <span key={i} className={"race-lane" + (i < r.steps ? " ok" : "") + (r.dead === i + 1 ? " dead" : "")}>
                    {r.dead === i + 1 ? "🚗" : i + 1 === r.steps && !r.dead ? "🐔" : ""}
                  </span>
                ))}
              </div>
              <div className="race-state">
                {r.done ? (r.dead ? "atropelada" : `parou em ${r.steps}`) : "correndo…"}
                {idle && t.players.some((x) => x.uid === me.uid) && (
                  <button type="button" className="btn-link" disabled={busy} onClick={act(() => chickenAction(t.id, me.uid, "skip", p.uid))}>
                    forçar parada
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {mine && !mine.done && t.status === "playing" && (
        <div className="game-actions">
          <button type="button" className="btn btn-gradient" disabled={busy} onClick={act(() => chickenAction(t.id, me.uid, "go"))}>
            Atravessar ({fmtX(chickenMultiplier(s.level, mine.steps + 1))})
          </button>
          <button type="button" className="btn btn-cash" disabled={busy || mine.steps < 1} onClick={act(() => chickenAction(t.id, me.uid, "stop"))}>
            Parar aqui
          </button>
        </div>
      )}
      <p className="game-hint">{lv.label} · ganha quem parar mais longe sem ser atropelada</p>
    </div>
  );
}

/* Cara ou coroa entre 2 */
function CoinTable({ t }) {
  const s = t.state;
  if (!s) return null;
  return (
    <div className="game coinflip">
      <div className="coin-stage">
        <div className={"coin pvp-spin to-" + s.result}>
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
      <div className="pvp-order">
        {t.players.map((p) => (
          <span key={p.uid} className={"pvp-seat" + (t.result?.winners.includes(p.uid) ? " cur" : "")}>
            <Avatar src={p.photo} name={p.name} size={30} />
            <span>{p.name}</span>
            <i>{s.sides[p.uid]}</i>
          </span>
        ))}
      </div>
    </div>
  );
}
