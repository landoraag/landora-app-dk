// Economia do Landora (moedas de mentira): trabalhar, banco, pagar, roubar, empréstimos e
// administração. Tudo em transações do Firestore, para dois movimentos ao mesmo tempo não
// bagunçarem o saldo de ninguém.
//
// Regras (pensadas para ser justas):
// - Trabalhar: é um minigame (lib/rpg.js + components/WorkGame.jsx). Sem espera: dá para trabalhar
//   o quanto quiser. Quem faz as tarefas certas ganha mais, quem erra ganha menos. O salário também
//   depende do nível, da classe, dos cursos, do veículo, do humor e da energia.
// - Bônus diário: 💰 500 por dia (no cassino ou aqui).
// - Banco: guardar e sacar é grátis. O que está no banco NÃO pode ser roubado, mas as apostas
//   e pagamentos usam só a carteira.
// - Roubar: a cada 2 h (contando tentativa que deu errado). Precisa ter 💰 100 na carteira, e a
//   vítima também. 45% de chance de dar certo: leva de 10% a 25% da carteira da vítima (máx.
//   💰 1.500). Deu errado: paga multa de 20% da própria carteira (mín. 💰 50, máx. 💰 1.000) para
//   a vítima. Quem foi roubado fica protegido por 1 h.
// - Empréstimo: pede para alguém (até 💰 3.000). Se a pessoa aceitar, o dinheiro cai na hora; a
//   dívida é o valor + 10% de juros, com prazo de 3 dias. Passou do prazo, quem emprestou pode
//   cobrar: sai da carteira e, se faltar, do banco. Uma dívida ativa por vez.

import { addDoc, collection, doc, getDocs, increment, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "./firebase";
import { START_BALANCE, rand, walletRef } from "./casino";
import { ITEMS, hasPersona, robChanceFor, robSocialPenalty, workShift } from "./rpg";

export const ROB_COOLDOWN = 2 * 60 * 60 * 1000;
export const ROB_SHIELD = 60 * 60 * 1000;
export const ROB_CHANCE = 0.45;
export const ROB_MIN = 100;
export const LOAN_MAX = 3000;
export const LOAN_INTEREST = 0.1;
export const LOAN_DAYS = 3;



const num = (v) => Math.floor(Number(v) || 0);
const whenText = (ms) => {
  const m = Math.ceil(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${m} min`;
};
export const cooldownLeft = (last, cd) => Math.max(0, (last || 0) + cd - Date.now());
export const fmtWait = whenText;

async function readWallet(tx, uid) {
  const snap = await tx.get(walletRef(uid));
  if (!snap.exists()) throw new Error("Essa pessoa ainda não tem carteira (precisa abrir o cassino ou a economia uma vez).");
  const w = snap.data();
  return { ...w, balance: num(w.balance), bank: num(w.bank) };
}

/* ---------------- trabalhar ---------------- */
// Minigame: o turno tem várias tarefas (components/WorkGame.jsx) e o pagamento depende de quão bem
// você foi (results: nota de cada tarefa, 1 = certo, 0.5 = meio errado, 0 = errado). Sem espera
// entre um turno e outro. Veja lib/rpg.js.
export const work = (uid, results) => workShift(uid, results);

/* ---------------- banco ---------------- */
export async function deposit(uid, amount) {
  amount = num(amount);
  if (amount < 1) throw new Error("Digite um valor.");
  return runTransaction(db, async (tx) => {
    const w = await readWallet(tx, uid);
    if (w.balance < amount) throw new Error("Você não tem isso na carteira.");
    tx.update(walletRef(uid), { balance: w.balance - amount, bank: w.bank + amount });
  });
}
export async function withdraw(uid, amount) {
  amount = num(amount);
  if (amount < 1) throw new Error("Digite um valor.");
  return runTransaction(db, async (tx) => {
    const w = await readWallet(tx, uid);
    if (w.bank < amount) throw new Error("Você não tem isso no banco.");
    tx.update(walletRef(uid), { balance: w.balance + amount, bank: w.bank - amount });
  });
}

/* ---------------- pagar ---------------- */
export async function pay(fromUid, toUid, amount) {
  amount = num(amount);
  if (fromUid === toUid) throw new Error("Não dá para pagar a si mesmo.");
  if (amount < 1) throw new Error("Digite um valor.");
  return runTransaction(db, async (tx) => {
    const a = await readWallet(tx, fromUid);
    await readWallet(tx, toUid);
    if (a.balance < amount) throw new Error("Saldo insuficiente na carteira.");
    tx.update(walletRef(fromUid), { balance: a.balance - amount });
    tx.update(walletRef(toUid), { balance: increment(amount) });
  });
}

/* ---------------- roubar ---------------- */
export async function rob(thiefUid, victimUid) {
  if (thiefUid === victimUid) throw new Error("Roubar a si mesmo? 🤔");
  return runTransaction(db, async (tx) => {
    const t = await readWallet(tx, thiefUid);
    const v = await readWallet(tx, victimUid);
    const left = cooldownLeft(t.lastRob, ROB_COOLDOWN);
    if (left > 0) throw new Error(`A polícia está de olho em você. Tente de novo em ${whenText(left)}.`);
    if (t.balance < ROB_MIN) throw new Error(`Você precisa de pelo menos 💰 ${ROB_MIN} na carteira para tentar (caso precise pagar a multa).`);
    if ((v.robShieldUntil || 0) > Date.now()) throw new Error(`${v.nickname} foi roubado há pouco e está protegido por mais ${whenText(v.robShieldUntil - Date.now())}.`);
    if (v.balance < ROB_MIN) throw new Error(`${v.nickname} está com quase nada na carteira. Não vale o risco.`);
    if (!hasPersona(t)) throw new Error("Crie sua persona antes (no botão da persona, aqui em cima).");
    const vName = v.persona?.name ? `${v.persona.name} (${v.nickname})` : v.nickname;
    // Alarme da vítima: dispara, gasta 1 e o ladrão é pego.
    const alarms = Math.floor(Number(v.inv?.alarme) || 0);
    const alarm = alarms > 0;
    const ok = !alarm && rand() < robChanceFor(t, v, ROB_CHANCE);
    const shame = robSocialPenalty(t, ok);
    const social = Math.floor(Number(t.social) || 0) - shame;
    if (ok) {
      const pct = 0.1 + rand() * 0.15;
      const amount = Math.max(1, Math.min(1500, Math.floor(v.balance * pct)));
      tx.update(walletRef(thiefUid), { balance: t.balance + amount, lastRob: Date.now(), social });
      tx.update(walletRef(victimUid), { balance: v.balance - amount, robShieldUntil: Date.now() + ROB_SHIELD });
      return { ok, amount, victim: vName, shame };
    }
    const fine = Math.min(1000, Math.max(50, Math.floor(t.balance * 0.2)), t.balance);
    tx.update(walletRef(thiefUid), { balance: t.balance - fine, lastRob: Date.now(), social });
    tx.update(walletRef(victimUid), { balance: v.balance + fine, ...(alarm ? { "inv.alarme": alarms - 1 } : {}) });
    return { ok, amount: fine, victim: vName, shame, alarm, alarmName: ITEMS.alarme.name };
  });
}

/* ---------------- empréstimos (loans/{id}) ---------------- */
// status: "pending" (pedido) → "active" (aceito) → "paid" (quitado) | "declined" | "cancelled" | "collected"
export async function requestLoan(borrower, lender, amount, note) {
  amount = num(amount);
  if (borrower.uid === lender.uid) throw new Error("Escolha outra pessoa.");
  if (amount < 1 || amount > LOAN_MAX) throw new Error(`Peça entre 💰 1 e 💰 ${LOAN_MAX.toLocaleString("pt-BR")}.`);
  const mine = await getDocs(collection(db, "loans"));
  if (mine.docs.some((d) => d.data().borrowerId === borrower.uid && ["active", "pending"].includes(d.data().status)))
    throw new Error("Você já tem um pedido ou uma dívida em aberto. Quite antes de pedir outro.");
  const ref = await addDoc(collection(db, "loans"), {
    borrowerId: borrower.uid,
    borrowerName: borrower.name,
    lenderId: lender.uid,
    lenderName: lender.name,
    amount,
    owed: Math.ceil(amount * (1 + LOAN_INTEREST)),
    note: String(note || "").slice(0, 120),
    status: "pending",
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function answerLoan(loanId, uid, accept) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "loans", loanId);
    const snap = await tx.get(ref);
    const l = snap.data();
    if (!l || l.status !== "pending") throw new Error("Esse pedido não está mais aberto.");
    if (l.lenderId !== uid) throw new Error("Só quem recebeu o pedido pode responder.");
    if (!accept) {
      tx.update(ref, { status: "declined", answeredAt: Date.now() });
      return l;
    }
    const lender = await readWallet(tx, l.lenderId);
    await readWallet(tx, l.borrowerId);
    if (lender.balance < l.amount) throw new Error("Você não tem esse valor na carteira (saque do banco antes).");
    tx.update(walletRef(l.lenderId), { balance: lender.balance - l.amount });
    tx.update(walletRef(l.borrowerId), { balance: increment(l.amount) });
    tx.update(ref, { status: "active", answeredAt: Date.now(), dueAt: Date.now() + LOAN_DAYS * 86400000, paid: 0 });
    return l;
  });
}

export async function cancelLoan(loanId, uid) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "loans", loanId);
    const l = (await tx.get(ref)).data();
    if (!l || l.status !== "pending" || l.borrowerId !== uid) throw new Error("Não dá para cancelar.");
    tx.update(ref, { status: "cancelled" });
  });
}

// Pagar a dívida (tudo ou parte), da carteira.
export async function repayLoan(loanId, uid, amount) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "loans", loanId);
    const l = (await tx.get(ref)).data();
    if (!l || l.status !== "active" || l.borrowerId !== uid) throw new Error("Não há dívida para pagar.");
    const left = l.owed - num(l.paid);
    const value = Math.min(num(amount) || left, left);
    const w = await readWallet(tx, uid);
    await readWallet(tx, l.lenderId);
    if (value < 1) throw new Error("Digite um valor.");
    if (w.balance < value) throw new Error("Saldo insuficiente na carteira.");
    tx.update(walletRef(uid), { balance: w.balance - value });
    tx.update(walletRef(l.lenderId), { balance: increment(value) });
    const done = num(l.paid) + value >= l.owed;
    tx.update(ref, { paid: num(l.paid) + value, ...(done ? { status: "paid", paidAt: Date.now() } : {}) });
    return { value, done, lenderName: l.lenderName };
  });
}

// Prazo vencido: quem emprestou cobra (carteira primeiro, depois banco).
export async function collectLoan(loanId, uid) {
  return runTransaction(db, async (tx) => {
    const ref = doc(db, "loans", loanId);
    const l = (await tx.get(ref)).data();
    if (!l || l.status !== "active" || l.lenderId !== uid) throw new Error("Não dá para cobrar.");
    if (Date.now() < (l.dueAt || 0)) throw new Error("O prazo ainda não venceu.");
    const b = await readWallet(tx, l.borrowerId);
    await readWallet(tx, uid);
    const left = l.owed - num(l.paid);
    const fromWallet = Math.min(b.balance, left);
    const fromBank = Math.min(b.bank, left - fromWallet);
    const got = fromWallet + fromBank;
    tx.update(walletRef(l.borrowerId), { balance: b.balance - fromWallet, bank: b.bank - fromBank });
    if (got > 0) tx.update(walletRef(uid), { balance: increment(got) });
    const done = num(l.paid) + got >= l.owed;
    tx.update(ref, { paid: num(l.paid) + got, ...(done ? { status: "collected", paidAt: Date.now() } : {}) });
    return { got, done, borrowerName: l.borrowerName };
  });
}

/* ---------------- administração ---------------- */
export async function adminAdjust(uid, delta) {
  delta = Math.trunc(Number(delta) || 0);
  if (!delta) throw new Error("Digite um valor.");
  return runTransaction(db, async (tx) => {
    const w = await readWallet(tx, uid);
    tx.update(walletRef(uid), { balance: Math.max(0, w.balance + delta) });
  });
}
export async function adminSet(uid, value) {
  await updateDoc(walletRef(uid), { balance: Math.max(0, num(value)) });
}
export async function adminGiveAll(uids, amount) {
  amount = num(amount);
  if (amount < 1) throw new Error("Digite um valor.");
  await Promise.all(uids.map((u) => updateDoc(walletRef(u), { balance: increment(amount) })));
}
export async function adminResetAll(uids) {
  await Promise.all(
    uids.map((u) =>
      updateDoc(walletRef(u), {
        balance: START_BALANCE, bank: 0, wins: 0, losses: 0, biggestWin: 0, lastDaily: "", lastWork: 0, lastRob: 0, robShieldUntil: 0,
        // A persona continua (nome, avatar, classe), mas recomeça a vida do zero.
        xp: 0, social: 0, donated: 0, spent: 0, energy: 100, energyAt: Date.now(), mood: 60, moodAt: Date.now(),
        inv: {}, courses: {}, assets: {}, pets: {}, cosmetics: {}, equipped: {},
      })
    )
  );
}
