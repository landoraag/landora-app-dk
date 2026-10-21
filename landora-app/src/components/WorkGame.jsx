import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../context/AuthContext";
import { coins, randInt } from "../lib/casino";
import { work } from "../lib/economy";
import { WORK_PAY_MAX, WORK_PAY_MIN, hasPersona, payMultiplier, workQuality } from "../lib/rpg";

// Trabalhar é um minigame: cada turno tem 5 tarefas. Cada uma vale
//   1 = certo · 0.5 = meio errado · 0 = errado
// e a média das notas muda o pagamento (de 30% a 150% do salário). Não tem espera entre um turno
// e outro: dá para trabalhar o quanto quiser. O pagamento é calculado em lib/rpg.js (workShift).

const SHIFT_TASKS = 5;
const TYPES = ["troco", "digitar", "memoria", "ordem"];

const shuffled = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};
// Todos os tipos aparecem e o quinto é sorteado.
const pickTypes = () => shuffled([...TYPES, TYPES[randInt(TYPES.length)]]).slice(0, SHIFT_TASKS);

function lev(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

// Contagem regressiva da tarefa. `onEnd` é sempre a versão mais recente (vê o que já foi digitado).
function useCountdown(seconds, onEnd, paused = false) {
  const [left, setLeft] = useState(seconds);
  const endRef = useRef(onEnd);
  endRef.current = onEnd;
  useEffect(() => {
    if (paused) return undefined;
    const t0 = Date.now();
    const id = setInterval(() => {
      const l = Math.max(0, seconds - (Date.now() - t0) / 1000);
      setLeft(l);
      if (l <= 0) {
        clearInterval(id);
        endRef.current();
      }
    }, 200);
    return () => clearInterval(id);
  }, [seconds, paused]);
  return left;
}

// Garante que a tarefa entrega a nota uma vez só (clique + tempo acabando ao mesmo tempo).
function useOnce(fn) {
  const done = useRef(false);
  return (v) => {
    if (done.current) return;
    done.current = true;
    fn(v);
  };
}

function TaskShell({ n, title, hint, seconds, paused, onTimeout, children }) {
  const left = useCountdown(seconds, onTimeout, paused);
  return (
    <div className="work-task">
      <div className="work-task-top">
        <span>
          Tarefa {n}/{SHIFT_TASKS}
        </span>
        <b>{title}</b>
        <em>{paused ? "…" : `${Math.ceil(left)}s`}</em>
      </div>
      <div className="work-timer">
        <i style={{ width: `${(left / seconds) * 100}%` }} />
      </div>
      {hint && <p className="game-hint">{hint}</p>}
      {children}
    </div>
  );
}

/* ---------- 1. Caixa: dar o troco ---------- */
function TrocoTask({ n, onDone }) {
  const t = useMemo(() => {
    const items = Array.from({ length: 3 }, () => 3 + randInt(28));
    const total = items.reduce((a, b) => a + b, 0);
    const paid = [50, 100, 200].find((p) => p > total) || 200;
    return { items, total, paid, change: paid - total };
  }, []);
  const [v, setV] = useState("");
  const vRef = useRef("");
  vRef.current = v;
  const finish = useOnce(onDone);
  const grade = () => {
    if (vRef.current === "") return 0;
    const diff = Math.abs(Number(vRef.current) - t.change);
    return diff === 0 ? 1 : diff <= 2 ? 0.5 : 0;
  };
  return (
    <TaskShell n={n} title="💵 Caixa" seconds={25} hint="Calcule o troco do cliente." onTimeout={() => finish(grade())}>
      <div className="work-card">
        <p>
          O cliente levou 3 itens: <b>R$ {t.items[0]}</b>, <b>R$ {t.items[1]}</b> e <b>R$ {t.items[2]}</b>.
        </p>
        <p>
          Ele pagou com <b>R$ {t.paid}</b>. Qual é o troco?
        </p>
        <div className="work-row">
          <input
            className="eco-note"
            type="number"
            inputMode="numeric"
            autoFocus
            value={v}
            onChange={(e) => setV(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && finish(grade())}
            placeholder="R$"
          />
          <button type="button" className="btn btn-gradient" onClick={() => finish(grade())}>
            Entregar
          </button>
        </div>
      </div>
    </TaskShell>
  );
}

/* ---------- 2. Atendimento: digitar a mensagem ---------- */
const PHRASES = [
  "pedido confirmado e saindo para entrega",
  "obrigado pela preferencia volte sempre",
  "sua landing page esta no ar e funcionando",
  "o orcamento foi enviado para o seu email",
  "atendimento rapido e cliente satisfeito",
  "reuniao marcada para amanha as dez horas",
];
function DigitarTask({ n, onDone }) {
  const phrase = useMemo(() => PHRASES[randInt(PHRASES.length)], []);
  const [v, setV] = useState("");
  const vRef = useRef("");
  vRef.current = v;
  const finish = useOnce(onDone);
  const grade = () => {
    const typed = vRef.current.trim().toLowerCase();
    if (!typed) return 0;
    const sim = 1 - lev(typed, phrase) / Math.max(phrase.length, typed.length);
    return sim >= 0.95 ? 1 : sim >= 0.75 ? 0.5 : 0;
  };
  return (
    <TaskShell n={n} title="💬 Atendimento" seconds={30} hint="Digite a mensagem exatamente como está (sem colar)." onTimeout={() => finish(grade())}>
      <div className="work-card">
        <p className="work-phrase">{phrase}</p>
        <div className="work-row">
          <input
            className="eco-note"
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={v}
            onChange={(e) => setV(e.target.value)}
            onPaste={(e) => e.preventDefault()}
            onKeyDown={(e) => e.key === "Enter" && finish(grade())}
            placeholder="Digite aqui"
          />
          <button type="button" className="btn btn-gradient" onClick={() => finish(grade())}>
            Enviar
          </button>
        </div>
      </div>
    </TaskShell>
  );
}

/* ---------- 3. Estoque: lembrar a ordem ---------- */
const STOCK = ["🍎", "🍌", "🍇", "🍒", "🥕", "🍋", "🍉", "🥑"];
const SEQ_LEN = 4;
function MemoriaTask({ n, onDone }) {
  const { seq, grid } = useMemo(() => {
    const s = shuffled(STOCK).slice(0, SEQ_LEN);
    return { seq: s, grid: shuffled(STOCK) };
  }, []);
  const [phase, setPhase] = useState("show");
  const [picks, setPicks] = useState([]);
  const picksRef = useRef([]);
  picksRef.current = picks;
  const finish = useOnce(onDone);
  useEffect(() => {
    const t = setTimeout(() => setPhase("pick"), 3200);
    return () => clearTimeout(t);
  }, []);
  const grade = (list) => {
    const right = list.filter((e, i) => e === seq[i]).length;
    return right === SEQ_LEN ? 1 : right >= 2 ? 0.5 : 0;
  };
  function pick(e) {
    if (phase !== "pick" || picks.includes(e)) return;
    const next = [...picks, e];
    setPicks(next);
    if (next.length === SEQ_LEN) finish(grade(next));
  }
  return (
    <TaskShell
      n={n}
      title="📦 Estoque"
      seconds={20}
      paused={phase === "show"}
      hint={phase === "show" ? "Memorize a ordem dos produtos que o fornecedor entregou…" : "Agora toque nos produtos na mesma ordem."}
      onTimeout={() => finish(grade(picksRef.current))}
    >
      <div className="work-card">
        {phase === "show" ? (
          <div className="work-seq">
            {seq.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </div>
        ) : (
          <>
            <div className="work-seq picked">
              {Array.from({ length: SEQ_LEN }, (_, i) => (
                <span key={i}>{picks[i] || "❔"}</span>
              ))}
            </div>
            <div className="work-grid">
              {grid.map((e) => (
                <button type="button" key={e} disabled={picks.includes(e)} onClick={() => pick(e)}>
                  {e}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </TaskShell>
  );
}

/* ---------- 4. Prateleira: ordenar os preços ---------- */
function OrdemTask({ n, onDone }) {
  const nums = useMemo(() => {
    const s = new Set();
    while (s.size < 5) s.add(5 + randInt(95));
    return shuffled([...s]);
  }, []);
  const sorted = useMemo(() => [...nums].sort((a, b) => a - b), [nums]);
  const [picked, setPicked] = useState([]);
  const [mistakes, setMistakes] = useState(0);
  const [flash, setFlash] = useState(null);
  const stateRef = useRef({ picked: [], mistakes: 0 });
  stateRef.current = { picked, mistakes };
  const finish = useOnce(onDone);
  const grade = ({ picked: p, mistakes: m }) => {
    if (p.length === sorted.length) return m === 0 ? 1 : m <= 2 ? 0.5 : 0;
    return p.length >= 3 && m <= 2 ? 0.5 : 0;
  };
  function tap(v) {
    if (picked.includes(v)) return;
    if (v === sorted[picked.length]) {
      const next = [...picked, v];
      setPicked(next);
      if (next.length === sorted.length) finish(grade({ picked: next, mistakes }));
    } else {
      setMistakes((m) => m + 1);
      setFlash(v);
      setTimeout(() => setFlash(null), 350);
    }
  }
  return (
    <TaskShell n={n} title="🏷️ Prateleira" seconds={20} hint="Toque nos preços do MENOR para o MAIOR." onTimeout={() => finish(grade(stateRef.current))}>
      <div className="work-card">
        <div className="work-grid prices">
          {nums.map((v) => (
            <button type="button" key={v} className={picked.includes(v) ? "ok" : flash === v ? "bad" : ""} disabled={picked.includes(v)} onClick={() => tap(v)}>
              R$ {v}
            </button>
          ))}
        </div>
        <small className="muted">Erros: {mistakes}</small>
      </div>
    </TaskShell>
  );
}
const TASK_VIEW = { troco: TrocoTask, digitar: DigitarTask, memoria: MemoriaTask, ordem: OrdemTask };
const MARK = { 1: "✅", 0.5: "🟡", 0: "❌" };

function verdict(ratio) {
  if (ratio >= 1) return ["🌟", "Turno perfeito!"];
  if (ratio >= 0.7) return ["👏", "Bom trabalho!"];
  if (ratio >= 0.4) return ["😐", "Meio errado…"];
  return ["😬", "Turno ruim"];
}

/* ---------- o turno ---------- */
export default function WorkGame({ wallet, onFinished, onClose, onNeedPersona }) {
  const { user } = useAuth();
  const [types, setTypes] = useState(pickTypes);
  const [phase, setPhase] = useState("intro"); // intro | play | saving | done
  const [idx, setIdx] = useState(0);
  const [scores, setScores] = useState([]);
  const [feedback, setFeedback] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);

  if (!hasPersona(wallet)) {
    return (
      <div className="game">
        <p className="muted">Crie sua persona antes de trabalhar.</p>
        <button type="button" className="btn btn-gradient game-go" onClick={onNeedPersona}>
          Criar persona
        </button>
      </div>
    );
  }

  async function save(all) {
    setPhase("saving");
    setError("");
    try {
      const r = await work(user.uid, all);
      setResult(r);
      setPhase("done");
      onFinished?.(r);
    } catch (e) {
      setError(e.message);
      setPhase("retry");
    }
  }

  function taskDone(score) {
    const all = [...scores, score];
    setScores(all);
    setFeedback(score);
    timer.current = setTimeout(() => {
      setFeedback(null);
      if (all.length >= SHIFT_TASKS) save(all);
      else setIdx(all.length);
    }, 750);
  }

  function start() {
    setTypes(pickTypes());
    setScores([]);
    setIdx(0);
    setFeedback(null);
    setResult(null);
    setError("");
    setPhase("play");
  }

  if (phase === "intro") {
    const base = Math.round(payMultiplier(wallet) * 100);
    return (
      <div className="game work-intro">
        <p>
          Cada turno tem <b>{SHIFT_TASKS} tarefas rápidas</b>. Fez certo, ganha mais; fez meio errado, ganha menos. Não tem espera: trabalhe o quanto quiser.
        </p>
        <div className="rpg-facts">
          <div>
            <span>Seu bônus de salário</span>
            <b>{base}%</b>
          </div>
          <div>
            <span>Tudo certo paga</span>
            <b>{Math.round(WORK_PAY_MAX * 100)}%</b>
          </div>
          <div>
            <span>Tudo errado paga</span>
            <b>{Math.round(WORK_PAY_MIN * 100)}%</b>
          </div>
        </div>
        <button type="button" className="btn btn-gradient game-go" onClick={start}>
          Começar turno 💼
        </button>
      </div>
    );
  }

  if (phase === "saving") return <div className="game work-intro"><p className="muted">Recebendo o pagamento…</p></div>;

  if (phase === "retry")
    return (
      <div className="game work-intro">
        <p className="auth-error">{error}</p>
        <button type="button" className="btn btn-gradient game-go" onClick={() => save(scores)}>
          Tentar receber de novo
        </button>
      </div>
    );

  if (phase === "done" && result) {
    const [icon, text] = verdict(result.ratio);
    return (
      <div className="game work-result">
        <div className={"casino-result " + (result.ratio >= 0.4 ? "win" : "lose")}>
          <b>
            {icon} {text}
          </b>
          <small>
            {result.emoji} {wallet.persona.name} {result.job}
            {result.tip ? " · gorjeta dobrada! 🤑" : ""}
          </small>
          <span>+{coins(result.amount + (result.levelUp?.bonus || 0))}</span>
        </div>
        <div className="work-marks">
          {result.scores.map((s, i) => (
            <span key={i}>{MARK[s]}</span>
          ))}
        </div>
        <p className="game-hint">
          +{result.xp} XP · pagou {Math.round(workQuality(result.ratio) * 100)}% do salário
          {result.levelUp ? ` · ⭐ Nível ${result.levelUp.to}! +${coins(result.levelUp.bonus)}` : ""}
        </p>
        <div className="game-actions">
          <button type="button" className="btn btn-gradient" onClick={start}>
            Trabalhar de novo
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Fechar
          </button>
        </div>
      </div>
    );
  }

  const View = TASK_VIEW[types[idx]];
  return (
    <div className="game work-play">
      <div className="work-marks">
        {Array.from({ length: SHIFT_TASKS }, (_, i) => (
          <span key={i} className={i === idx ? "now" : ""}>
            {scores[i] !== undefined ? MARK[scores[i]] : "⚪"}
          </span>
        ))}
      </div>
      {feedback !== null ? (
        <div className="work-feedback">
          {feedback === 1 ? "✅ Certo!" : feedback === 0.5 ? "🟡 Quase… meio errado" : "❌ Errou"}
        </div>
      ) : (
        <View key={idx} n={idx + 1} onDone={taskDone} />
      )}
    </div>
  );
}
