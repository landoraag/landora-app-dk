import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { addDoc, collection, doc, onSnapshot, serverTimestamp } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../context/AuthContext";
import { useCollection } from "../lib/useCollection";
import { notify } from "../lib/push";
import { DAILY_AMOUNT, ECONOMY_CHANNEL_ID, canClaimDaily, claimDaily, coins, isAdminEmail, postResult } from "../lib/casino";
import {
  LOAN_DAYS,
  LOAN_INTEREST,
  LOAN_MAX,
  ROB_CHANCE,
  ROB_COOLDOWN,
  adminAdjust,
  adminGiveAll,
  adminResetAll,
  adminSet,
  answerLoan,
  cancelLoan,
  collectLoan,
  cooldownLeft,
  deposit,
  fmtWait,
  pay,
  repayLoan,
  requestLoan,
  rob,
  withdraw,
  work,
} from "../lib/economy";
import { useWallet } from "./Casino";
import { Charity, EcoRanking, PersonaForm, PersonaSheet, PersonaStrip, Shops, announceLevelUp } from "./RPG";
import { hasPersona, liveStats, workCooldown } from "../lib/rpg";
import Avatar from "./Avatar";

const post = (user, profile, g) => postResult(user, profile, g, ECONOMY_CHANNEL_ID).catch(() => {});

function useTick() {
  const [n, setN] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setN(Date.now()), 15000);
    return () => clearInterval(t);
  }, []);
  return n;
}

function AmountInput({ value, onChange, max, label = "Valor" }) {
  return (
    <div className="bet-picker">
      <label className="bet-input">
        <span>{label}</span>
        <input type="number" inputMode="numeric" min={1} value={value} onChange={(e) => onChange(Math.max(0, Math.floor(Number(e.target.value) || 0)))} />
      </label>
      {max != null && (
        <div className="bet-chips">
          {[100, 500, 1000].map((v) => (
            <button type="button" key={v} onClick={() => onChange(Math.min(v, max))}>
              {v}
            </button>
          ))}
          <button type="button" onClick={() => onChange(Math.floor(max / 2))}>
            ½
          </button>
          <button type="button" className="allin" onClick={() => onChange(Math.floor(max))}>
            Tudo
          </button>
        </div>
      )}
    </div>
  );
}

function PersonPicker({ people, value, onChange, wallets }) {
  return (
    <div className="pvp-people">
      {people.map((p) => (
        <button type="button" key={p.id} className={"pvp-person" + (value === p.id ? " sel" : "")} onClick={() => onChange(p.id)}>
          <Avatar src={p.photoURL} name={p.nickname} size={26} />
          <span>{p.nickname}</span>
          {wallets && <em>{coins(wallets[p.id]?.balance)}</em>}
        </button>
      ))}
      {!people.length && <p className="muted">Ninguém mais tem carteira ainda.</p>}
    </div>
  );
}

/* ---------------- Banco ---------------- */
function Bank({ wallet, onMsg }) {
  const { user } = useAuth();
  const [v, setV] = useState(100);
  const [busy, setBusy] = useState(false);
  const run = (fn, ok) => async () => {
    setBusy(true);
    try {
      await fn(user.uid, v);
      onMsg(ok);
    } catch (e) {
      onMsg(e.message, true);
    }
    setBusy(false);
  };
  return (
    <div className="game">
      <div className="eco-split">
        <div>
          <span>Carteira</span>
          <b>{coins(wallet?.balance)}</b>
        </div>
        <div>
          <span>Banco 🔒</span>
          <b>{coins(wallet?.bank)}</b>
        </div>
      </div>
      <AmountInput value={v} onChange={setV} max={Math.max(wallet?.balance || 0, wallet?.bank || 0)} />
      <div className="game-actions">
        <button type="button" className="btn btn-gradient" disabled={busy} onClick={run(deposit, `Guardou ${coins(v)} no banco.`)}>
          Guardar no banco
        </button>
        <button type="button" className="btn btn-ghost" disabled={busy} onClick={run(withdraw, `Sacou ${coins(v)} do banco.`)}>
          Sacar para a carteira
        </button>
      </div>
      <p className="game-hint">O banco é à prova de roubo. Apostas e pagamentos usam só a carteira.</p>
    </div>
  );
}

/* ---------------- Pagar ---------------- */
function Pay({ wallet, people, onMsg }) {
  const { user, profile } = useAuth();
  const [to, setTo] = useState(null);
  const [v, setV] = useState(100);
  const [busy, setBusy] = useState(false);
  async function go() {
    if (!to) return onMsg("Escolha para quem pagar.", true);
    setBusy(true);
    try {
      await pay(user.uid, to, v);
      const name = people.find((p) => p.id === to)?.nickname;
      onMsg(`Você pagou ${coins(v)} para ${name}.`);
      post(user, profile, { type: "pay", bet: 0, payout: 0, text: `pagou ${coins(v)} para ${name}`, detail: `Transferência para ${name}` });
      notify({ kind: "mention", title: `💸 ${profile?.nickname} te pagou ${coins(v)}`, body: "Abra o #economia", url: `/chat?c=${ECONOMY_CHANNEL_ID}`, to: [to] });
    } catch (e) {
      onMsg(e.message, true);
    }
    setBusy(false);
  }
  return (
    <div className="game">
      <PersonPicker people={people} value={to} onChange={setTo} />
      <AmountInput value={v} onChange={setV} max={wallet?.balance || 0} />
      <button type="button" className="btn btn-gradient game-go" disabled={busy || !to} onClick={go}>
        Pagar {coins(v)}
      </button>
    </div>
  );
}

/* ---------------- Roubar ---------------- */
function Rob({ wallet, people, wallets, onMsg }) {
  const { user, profile } = useAuth();
  const [to, setTo] = useState(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const left = cooldownLeft(wallet?.lastRob, ROB_COOLDOWN);
  async function go() {
    if (!to) return onMsg("Escolha quem roubar.", true);
    setBusy(true);
    setRes(null);
    try {
      await new Promise((r) => setTimeout(r, 900)); // suspense 🥷
      const r = await rob(user.uid, to);
      setRes(r);
      post(user, profile, {
        type: "rob",
        bet: 0,
        payout: r.ok ? r.amount : -r.amount,
        text: r.ok ? `roubou ${coins(r.amount)} de ${r.victim}` : `foi pego tentando roubar ${r.victim} e pagou ${coins(r.amount)} de multa`,
        detail: `${r.ok ? `Assalto a ${r.victim} deu certo` : r.alarm ? `🚨 O alarme de ${r.victim} disparou` : `Tentativa contra ${r.victim} falhou`} · −${r.shame} pontos sociais`,
      });
      notify({
        kind: "mention",
        title: r.ok
          ? `🦹 ${profile?.nickname} te roubou ${coins(r.amount)}!`
          : r.alarm
            ? `🚨 Seu alarme pegou ${profile?.nickname}! Você recebeu ${coins(r.amount)} de multa`
            : `🚓 ${profile?.nickname} tentou te roubar e pagou ${coins(r.amount)} de multa para você`,
        body: "Guarde suas moedas no banco 🔒",
        url: `/chat?c=${ECONOMY_CHANNEL_ID}`,
        to: [to],
      });
    } catch (e) {
      onMsg(e.message, true);
    }
    setBusy(false);
  }
  return (
    <div className="game">
      {res ? (
        <div className={"casino-result " + (res.ok ? "win" : "lose")}>
          <b>{res.ok ? `Deu certo! Você levou de ${res.victim}` : res.alarm ? `🚨 O alarme disparou! Multa paga para ${res.victim}` : `A polícia te pegou! Multa paga para ${res.victim}`}</b>
          <small>−{res.shame} pontos sociais</small>
          <span>{res.ok ? `+${coins(res.amount)}` : `-${coins(res.amount)}`}</span>
        </div>
      ) : null}
      {left > 0 ? (
        <p className="eco-wait">🚓 A polícia está de olho. Próxima tentativa em {fmtWait(left)}.</p>
      ) : (
        <>
          <PersonPicker people={people} value={to} onChange={setTo} wallets={wallets} />
          <button type="button" className="btn btn-danger-solid game-go" disabled={busy || !to} onClick={go}>
            {busy ? "Tentando… 🥷" : "Tentar roubar"}
          </button>
        </>
      )}
      <p className="game-hint">
        {Math.round(ROB_CHANCE * 100)}% de chance (Malandro +10%, contra cachorro de guarda −15%, alarme bloqueia) · leva 10–25% da carteira (máx. 🪙 1.500) · falhou: multa de 20% da sua carteira para a vítima · a cada 2 h · suja sua fama
      </p>
    </div>
  );
}

/* ---------------- Empréstimos ---------------- */
function Loans({ people, onMsg }) {
  const { user, profile } = useAuth();
  const { data: loans } = useCollection("loans", "createdAt", "desc");
  const [to, setTo] = useState(null);
  const [v, setV] = useState(500);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const mine = loans.filter((l) => (l.borrowerId === user.uid || l.lenderId === user.uid) && ["pending", "active"].includes(l.status));
  async function ask() {
    if (!to) return onMsg("Escolha quem vai emprestar.", true);
    setBusy(true);
    try {
      const lender = people.find((p) => p.id === to);
      const id = await requestLoan({ uid: user.uid, name: profile?.nickname || "—" }, { uid: to, name: lender.nickname }, v, note);
      await postLoanMessage(user, profile, id, `pediu ${coins(v)} emprestado para ${lender.nickname}`, [to]);
      notify({ kind: "mention", title: `🤝 ${profile?.nickname} pediu ${coins(v)} emprestado`, body: "Abra o #economia para aceitar ou recusar", url: `/chat?c=${ECONOMY_CHANNEL_ID}`, to: [to] });
      onMsg("Pedido enviado! Ele aparece no canal para a pessoa responder.");
    } catch (e) {
      onMsg(e.message, true);
    }
    setBusy(false);
  }
  return (
    <div className="game">
      {mine.length > 0 && (
        <div className="loan-list">
          {mine.map((l) => (
            <LoanRow key={l.id} l={l} onMsg={onMsg} />
          ))}
        </div>
      )}
      <h4 className="eco-sub">Pedir emprestado</h4>
      <PersonPicker people={people} value={to} onChange={setTo} />
      <AmountInput value={v} onChange={setV} label="Quanto" />
      <input className="eco-note" placeholder="Motivo (opcional)" value={note} onChange={(e) => setNote(e.target.value)} maxLength={120} />
      <button type="button" className="btn btn-gradient game-go" disabled={busy || !to} onClick={ask}>
        Pedir {coins(v)} · devolve {coins(Math.ceil(v * (1 + LOAN_INTEREST)))}
      </button>
      <p className="game-hint">
        Até 🪙 {LOAN_MAX.toLocaleString("pt-BR")} · juros de {Math.round(LOAN_INTEREST * 100)}% · prazo de {LOAN_DAYS} dias · venceu, quem emprestou pode cobrar (sai até do banco)
      </p>
    </div>
  );
}

async function postLoanMessage(user, profile, loanId, text, mentions) {
  await addDoc(collection(db, "chatMessages"), {
    channelId: ECONOMY_CHANNEL_ID,
    text: `🤝 ${profile?.nickname || "Alguém"} ${text}`,
    loan: loanId,
    ...(mentions?.length ? { mentions } : {}),
    senderId: user.uid,
    senderNickname: profile?.nickname || "—",
    createdAt: serverTimestamp(),
  });
}

const LOAN_STATUS = { pending: "Aguardando resposta", active: "Em aberto", paid: "Quitado", declined: "Recusado", cancelled: "Cancelado", collected: "Cobrado" };

function LoanRow({ l, onMsg }) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  const [v, setV] = useState(0);
  const now = useTick();
  const iBorrow = l.borrowerId === user.uid;
  const iLend = l.lenderId === user.uid;
  const left = (l.owed || 0) - (l.paid || 0);
  const overdue = l.status === "active" && now > (l.dueAt || 0);
  const run = (fn) => async () => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      onMsg?.(e.message, true);
    }
    setBusy(false);
  };
  return (
    <div className={"loan-row s-" + l.status + (overdue ? " overdue" : "")}>
      <div className="loan-top">
        <b>
          {l.borrowerName} → pediu a {l.lenderName}
        </b>
        <span className="loan-status">{overdue ? "Vencido!" : LOAN_STATUS[l.status]}</span>
      </div>
      <div className="loan-info">
        Empréstimo {coins(l.amount)} · devolve {coins(l.owed)}
        {l.status === "active" && ` · falta ${coins(left)} · vence ${new Date(l.dueAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`}
        {l.note ? ` · “${l.note}”` : ""}
      </div>
      <div className="loan-actions">
        {l.status === "pending" && iLend && (
          <>
            <button
              type="button"
              className="btn btn-cash"
              disabled={busy}
              onClick={run(async () => {
                await answerLoan(l.id, user.uid, true);
                post(user, profile, { type: "loan", bet: 0, payout: 0, text: `emprestou ${coins(l.amount)} para ${l.borrowerName}`, detail: `Devolve ${coins(l.owed)} em ${LOAN_DAYS} dias` });
                notify({ kind: "mention", title: `🤝 ${profile?.nickname} aceitou seu empréstimo`, body: `${coins(l.amount)} caíram na sua carteira`, url: `/chat?c=${ECONOMY_CHANNEL_ID}`, to: [l.borrowerId] });
              })}
            >
              Emprestar {coins(l.amount)}
            </button>
            <button type="button" className="btn btn-ghost" disabled={busy} onClick={run(() => answerLoan(l.id, user.uid, false))}>
              Recusar
            </button>
          </>
        )}
        {l.status === "pending" && iBorrow && (
          <button type="button" className="btn btn-ghost" disabled={busy} onClick={run(() => cancelLoan(l.id, user.uid))}>
            Cancelar pedido
          </button>
        )}
        {l.status === "active" && iBorrow && (
          <>
            <input className="loan-pay-input" type="number" min={1} placeholder={String(left)} value={v || ""} onChange={(e) => setV(Math.floor(Number(e.target.value) || 0))} />
            <button
              type="button"
              className="btn btn-cash"
              disabled={busy}
              onClick={run(async () => {
                const r = await repayLoan(l.id, user.uid, v || left);
                post(user, profile, { type: "loan", bet: 0, payout: 0, text: r.done ? `quitou a dívida com ${r.lenderName} 🎉` : `pagou ${coins(r.value)} da dívida com ${r.lenderName}`, detail: r.done ? "Dívida quitada" : "Pagamento parcial" });
                setV(0);
              })}
            >
              Pagar {coins(v || left)}
            </button>
          </>
        )}
        {l.status === "active" && iLend && overdue && (
          <button
            type="button"
            className="btn btn-danger-solid"
            disabled={busy}
            onClick={run(async () => {
              const r = await collectLoan(l.id, user.uid);
              post(user, profile, { type: "loan", bet: 0, payout: 0, text: `cobrou ${coins(r.got)} de ${r.borrowerName}${r.done ? "" : " (ainda falta)"}`, detail: "Cobrança de dívida vencida" });
              notify({ kind: "mention", title: `💼 ${profile?.nickname} cobrou sua dívida`, body: `Foram ${coins(r.got)}`, url: `/chat?c=${ECONOMY_CHANNEL_ID}`, to: [l.borrowerId] });
            })}
          >
            Cobrar agora
          </button>
        )}
      </div>
    </div>
  );
}

// Cartão do pedido de empréstimo no chat (atualiza ao vivo).
export function LoanCard({ id }) {
  const [l, setL] = useState(undefined);
  useEffect(() => onSnapshot(doc(db, "loans", id), (s) => setL(s.exists() ? { id: s.id, ...s.data() } : null), () => setL(null)), [id]);
  const [err, setErr] = useState("");
  if (l === undefined) return <div className="table-card loading">Carregando…</div>;
  if (l === null) return <div className="table-card">Pedido não encontrado.</div>;
  return (
    <div className="table-card loan-card">
      <LoanRow l={l} onMsg={(m, bad) => bad && setErr(m)} />
      {err && <p className="auth-error">{err}</p>}
    </div>
  );
}

/* ---------------- Regras ---------------- */
function Rules() {
  return (
    <div className="eco-rules">
      <p>Moedas de mentira, só para diversão. Todo mundo começa com 🪙 1.000 e cria uma persona que vive na cidade.</p>
      <ul>
        <li><b>🧑 Persona</b> — nome, avatar e classe. Cada classe tem um bônus (salário, XP, desconto, caridade, roubo…). Trocar de classe custa 🪙 1.000.</li>
        <li><b>⭐ Nível</b> — trabalhar, estudar, viajar e doar dá XP. Cada nível aumenta o salário em 6% e libera itens melhores. Subiu: prêmio em moedas e energia cheia.</li>
        <li><b>⚡ Energia</b> — cada turno de trabalho gasta 20. Volta sozinha (+10 por hora) ou comendo no Mercado. Abaixo de 15 não dá para trabalhar.</li>
        <li><b>😊 Humor</b> — cai 1 por hora e sobe com lazer, caridade e compras grandes. Humor 0 paga 80% do salário; humor 100 paga 120%.</li>
        <li><b>💼 Trabalhar</b> — ganha de 🪙 100 a 🪙 250 vezes o seu bônus (nível, classe, cursos, veículo e humor). 5% de chance de gorjeta (o triplo). Espera de 1 h, menos com veículo.</li>
        <li><b>🛍️ Lojas</b> — Mercado (energia), Lazer (humor), Escola (+10% de salário por curso), Imóveis (energia máxima e humor mínimo), Veículos (menos espera e mais salário) e Utilidades (alarme e pets). Trocar de casa ou carro vende o antigo pela metade.</li>
        <li><b>💝 Caridade</b> — doe para as causas da cidade: 1 ponto social a cada 🪙 10, mais XP e humor. Pontos sociais dão títulos e descontos de até 15% nas lojas.</li>
        <li><b>🎁 Bônus diário</b> — 🪙 {DAILY_AMOUNT} uma vez por dia.</li>
        <li><b>🏦 Banco</b> — guardar e sacar é grátis. O banco não pode ser roubado; apostas, compras e pagamentos usam só a carteira.</li>
        <li><b>💸 Pagar</b> — manda moedas da sua carteira para alguém.</li>
        <li><b>🦹 Roubar</b> — a cada 2 h. 45% de chance: leva de 10% a 25% da carteira da vítima (máx. 🪙 1.500). Se falhar, paga multa para a vítima. Roubar tira pontos sociais (−15 se der certo, −5 se falhar; Malandro perde o dobro). Fama baixa deixa tudo mais caro.</li>
        <li><b>🤝 Empréstimo</b> — peça até 🪙 {LOAN_MAX.toLocaleString("pt-BR")} para alguém. Se aceitar, devolve com 10% de juros em até {LOAN_DAYS} dias. Venceu: quem emprestou pode cobrar, tirando da carteira e do banco.</li>
        <li><b>🎰 Cassino</b> — no #cassino: jogos contra a casa e desafios entre vocês.</li>
      </ul>
    </div>
  );
}

/* ---------------- Administração ---------------- */
function Admin({ wallets, onMsg }) {
  const list = useMemo(() => [...wallets].sort((a, b) => (a.nickname || "").localeCompare(b.nickname || "")), [wallets]);
  const [amt, setAmt] = useState({});
  const [all, setAll] = useState(500);
  const [busy, setBusy] = useState(false);
  const run = (fn, ok) => async () => {
    setBusy(true);
    try {
      await fn();
      onMsg(ok);
    } catch (e) {
      onMsg(e.message, true);
    }
    setBusy(false);
  };
  return (
    <div className="game admin">
      <div className="admin-all">
        <AmountInput value={all} onChange={setAll} label="Para todos" />
        <button type="button" className="btn btn-gradient" disabled={busy} onClick={run(() => adminGiveAll(list.map((w) => w.id), all), `Deu ${coins(all)} para todo mundo.`)}>
          Dar a todos
        </button>
      </div>
      <div className="admin-list">
        {list.map((w) => (
          <div key={w.id} className="admin-row">
            <Avatar src={w.photoURL} name={w.nickname} size={28} />
            <div className="admin-name">
              <b>{w.nickname}</b>
              <span>
                carteira {coins(w.balance)} · banco {coins(w.bank || 0)}
              </span>
            </div>
            <input type="number" placeholder="valor" value={amt[w.id] ?? ""} onChange={(e) => setAmt({ ...amt, [w.id]: e.target.value })} />
            <button type="button" title="Dar" disabled={busy} onClick={run(() => adminAdjust(w.id, Math.abs(Number(amt[w.id]) || 0)), `Deu ${coins(amt[w.id])} para ${w.nickname}.`)}>
              +
            </button>
            <button type="button" title="Tirar" disabled={busy} onClick={run(() => adminAdjust(w.id, -Math.abs(Number(amt[w.id]) || 0)), `Tirou ${coins(amt[w.id])} de ${w.nickname}.`)}>
              −
            </button>
            <button type="button" title="Definir saldo da carteira" disabled={busy} onClick={run(() => adminSet(w.id, amt[w.id]), `Carteira de ${w.nickname} agora é ${coins(amt[w.id])}.`)}>
              =
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-danger-solid"
        disabled={busy}
        onClick={() => {
          if (confirm("Zerar a economia? Todo mundo volta para 🪙 1.000, banco zerado e estatísticas apagadas.")) run(() => adminResetAll(list.map((w) => w.id)), "Economia zerada.")();
        }}
      >
        Zerar economia
      </button>
      <p className="game-hint">+ dá, − tira, = define o valor da carteira.</p>
    </div>
  );
}

/* ---------------- barra do canal #economia ---------------- */
export function EconomyBar() {
  const { user, profile } = useAuth();
  const wallet = useWallet();
  const { data: walletsList } = useCollection("wallets");
  const { data: loans } = useCollection("loans", "createdAt", "desc");
  const now = useTick();
  const [open, setOpen] = useState(null);
  const [msg, setMsg] = useState(null);
  const admin = isAdminEmail(user?.email);
  const wallets = useMemo(() => Object.fromEntries(walletsList.map((w) => [w.id, w])), [walletsList]);
  const people = walletsList.filter((w) => w.id !== user.uid).map((w) => ({ id: w.id, nickname: w.nickname, photoURL: w.photoURL }));
  const pendingForMe = loans.filter((l) => l.status === "pending" && l.lenderId === user.uid).length;
  const myDebt = loans.find((l) => l.status === "active" && l.borrowerId === user.uid);

  const say = (text, bad) => {
    setMsg({ text, bad });
    setTimeout(() => setMsg(null), 3500);
  };

  async function doWork() {
    try {
      if (!hasPersona(wallet)) return setOpen("create");
      const r = await work(user.uid);
      say(`${r.emoji} Você ${r.job} e ganhou ${coins(r.amount)}${r.tip ? " (com gorjeta! 🤑)" : ""} · +${r.xp} XP${r.levelUp ? ` · ⭐ Nível ${r.levelUp.to}! +${coins(r.levelUp.bonus)}` : ""}`);
      post(user, profile, { type: "work", bet: 0, payout: r.amount, text: `${r.job} e ganhou ${coins(r.amount)}${r.tip ? " 🤑" : ""}`, detail: `${r.emoji} ${wallet.persona.name} ${r.job}` });
      announceLevelUp(user, profile, r.levelUp);
    } catch (e) {
      say(e.message, true);
    }
  }
  async function doDaily() {
    try {
      await claimDaily(user.uid);
      say(`🎁 +${coins(DAILY_AMOUNT)}`);
      post(user, profile, { type: "daily", bet: 0, payout: DAILY_AMOUNT, detail: "Pegou o bônus do dia" });
    } catch (e) {
      say(e.message, true);
    }
  }

  const workLeft = cooldownLeft(wallet?.lastWork, workCooldown(wallet));
  const stats = hasPersona(wallet) ? liveStats(wallet, now) : null;
  const robLeft = cooldownLeft(wallet?.lastRob, ROB_COOLDOWN);
  void now;

  const MODALS = {
    bank: ["🏦 Banco", <Bank key="b" wallet={wallet} onMsg={say} />],
    pay: ["💸 Pagar alguém", <Pay key="p" wallet={wallet} people={people} onMsg={say} />],
    rob: ["🦹 Roubar", <Rob key="r" wallet={wallet} people={people} wallets={wallets} onMsg={say} />],
    loans: ["🤝 Empréstimos", <Loans key="l" people={people} onMsg={say} />],
    rules: ["📜 Regras da economia", <Rules key="u" />],
    ranking: ["🏆 Ranking", <EcoRanking key="k" />],
    create: ["🧑 Criar persona", <PersonaForm key="c" wallet={wallet} onMsg={say} onDone={() => setOpen("persona")} />],
    edit: ["✏️ Editar persona", <PersonaForm key="e" wallet={wallet} onMsg={say} onDone={() => setOpen("persona")} />],
    persona: ["🧑 Ficha da persona", <PersonaSheet key="s" wallet={wallet} onMsg={say} onEdit={() => setOpen("edit")} onShop={() => setOpen("shops")} />],
    shops: ["🛍️ Lojas", <Shops key="h" wallet={wallet} onMsg={say} />],
    charity: ["💝 Caridade", <Charity key="y" wallet={wallet} onMsg={say} />],
    admin: ["⚙️ Administração", <Admin key="a" wallets={walletsList} onMsg={say} />],
  };

  return (
    <div className="casino-bar eco-bar">
      <div className="casino-top">
        <div className="casino-wallet">
          <span>Carteira</span>
          <b>{wallet ? coins(wallet.balance) : "…"}</b>
        </div>
        <div className="casino-wallet bank">
          <span>Banco 🔒</span>
          <b>{wallet ? coins(wallet.bank || 0) : "…"}</b>
        </div>
        <div className="eco-top-actions">
          <button type="button" className="casino-rank-btn" onClick={() => setOpen("rules")}>
            📜 Regras
          </button>
          <button type="button" className="casino-rank-btn" onClick={() => setOpen("ranking")}>
            🏆 Ranking
          </button>
          {admin && (
            <button type="button" className="casino-rank-btn admin" onClick={() => setOpen("admin")}>
              ⚙️ Admin
            </button>
          )}
        </div>
        {msg && <span className={"casino-toast" + (msg.bad ? " bad" : "")}>{msg.text}</span>}
      </div>
      <PersonaStrip wallet={wallet} onOpen={() => setOpen("persona")} onCreate={() => setOpen("create")} />
      <div className="casino-games eco-actions">
        <button type="button" className="casino-game g-work" onClick={doWork} disabled={!wallet}>
          <span className="cg-icon">💼</span>
          <span className="cg-text">
            <b>Trabalhar</b>
            <span>{!stats ? "crie a persona" : workLeft ? `em ${fmtWait(workLeft)}` : stats.energy < 15 ? "sem energia ⚡" : "−20 ⚡ · +XP"}</span>
          </span>
        </button>
        <button type="button" className="casino-game g-shop" onClick={() => setOpen(hasPersona(wallet) ? "shops" : "create")} disabled={!wallet}>
          <span className="cg-icon">🛍️</span>
          <span className="cg-text">
            <b>Lojas</b>
            <span>comida, casa, carro…</span>
          </span>
        </button>
        <button type="button" className="casino-game g-charity" onClick={() => setOpen(hasPersona(wallet) ? "charity" : "create")} disabled={!wallet}>
          <span className="cg-icon">💝</span>
          <span className="cg-text">
            <b>Caridade</b>
            <span>pontos sociais</span>
          </span>
        </button>
        <button type="button" className={"casino-game g-daily" + (canClaimDaily(wallet) ? " ready" : "")} onClick={doDaily} disabled={!wallet}>
          <span className="cg-icon">🎁</span>
          <span className="cg-text">
            <b>Diário</b>
            <span>{canClaimDaily(wallet) ? `+${DAILY_AMOUNT} disponível` : "volte amanhã"}</span>
          </span>
        </button>
        <button type="button" className="casino-game g-bank" onClick={() => setOpen("bank")}>
          <span className="cg-icon">🏦</span>
          <span className="cg-text">
            <b>Banco</b>
            <span>guardar / sacar</span>
          </span>
        </button>
        <button type="button" className="casino-game g-pay" onClick={() => setOpen("pay")}>
          <span className="cg-icon">💸</span>
          <span className="cg-text">
            <b>Pagar</b>
            <span>transferir</span>
          </span>
        </button>
        <button type="button" className="casino-game g-rob" onClick={() => setOpen("rob")}>
          <span className="cg-icon">🦹</span>
          <span className="cg-text">
            <b>Roubar</b>
            <span>{robLeft ? `em ${fmtWait(robLeft)}` : "45% de chance"}</span>
          </span>
        </button>
        <button type="button" className="casino-game g-loan" onClick={() => setOpen("loans")}>
          <span className="cg-icon">🤝</span>
          <span className="cg-text">
            <b>Empréstimo{pendingForMe ? ` (${pendingForMe})` : ""}</b>
            <span>{myDebt ? `deve ${coins(myDebt.owed - (myDebt.paid || 0))}` : "pedir / pagar"}</span>
          </span>
        </button>
      </div>

      {open && (
        createPortal(
        <div className="modal-backdrop casino-backdrop" onClick={() => setOpen(null)}>
          <div className="casino-modal eco-modal" onClick={(e) => e.stopPropagation()}>
            <header className="casino-modal-head">
              <h3>{MODALS[open][0]}</h3>
              <span className="casino-modal-bal">{wallet ? coins(wallet.balance) : ""}</span>
              <button type="button" className="modal-close" onClick={() => setOpen(null)} aria-label="Fechar">
                ✕
              </button>
            </header>
            {msg && open !== "rules" && <div className={"eco-msg" + (msg.bad ? " bad" : "")}>{msg.text}</div>}
            {MODALS[open][1]}
          </div>
        </div>,
        document.body
        )
      )}
    </div>
  );
}
