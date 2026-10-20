// Vida na economia do Landora (RPG). Cada pessoa tem uma persona que vive na cidade:
//
// - Persona: nome, avatar, classe (dá um bônus) e uma bio. Fica na própria carteira
//   (wallets/{uid}.persona), junto com nível, energia, humor, pontos sociais e o inventário.
// - Energia: trabalhar cansa (−20). Volta sozinha (+10 por hora) ou comendo no Mercado.
// - Humor: cai devagar (−1 por hora) e sobe com lazer e caridade. Humor alto = salário maior.
// - XP e nível: trabalhar, estudar e ajudar os outros dá XP. Cada nível aumenta o salário e
//   libera cursos, casas e carros melhores. Subiu de nível: prêmio em moedas e energia cheia.
// - Pontos sociais (reputação): sobem com caridade e caem com roubo. Dão títulos e desconto
//   nas lojas; quem tem fama de ladrão paga mais caro.
// - Lojas: comida (energia), lazer (humor), escola (cursos = salário maior), casas (energia
//   máxima e humor mínimo), veículos (trabalha com menos espera), utilidades (alarme, pets).
//
// Tudo em transações do Firestore, como o resto da economia.

import { doc, increment, runTransaction, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";
import { rand, randInt, walletRef } from "./casino";

const HOUR = 3600000;
const num = (v) => Math.floor(Number(v) || 0);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* ---------------- classes ---------------- */
export const CLASSES = {
  empreendedor: { name: "Empreendedor", icon: "💼", desc: "+15% no salário do trabalho", pay: 0.15 },
  programador: { name: "Programador", icon: "💻", desc: "+25% de XP em tudo", xp: 0.25 },
  criativo: { name: "Criativo", icon: "🎨", desc: "Lazer rende 50% mais humor e o humor cai mais devagar", fun: 0.5 },
  comerciante: { name: "Comerciante", icon: "🛒", desc: "10% de desconto em todas as lojas", discount: 0.1 },
  filantropo: { name: "Filantropo", icon: "💝", desc: "Caridade rende 50% mais pontos sociais", charity: 0.5 },
  malandro: { name: "Malandro", icon: "🥷", desc: "+10% de chance no roubo, mas a fama cai o dobro", rob: 0.1, shame: 2 },
};
export const CLASS_CHANGE_COST = 1000;

export const AVATARS = ["😎", "🤠", "🧑‍💻", "👩‍🎨", "🧑‍🍳", "🦸", "🧙", "🥷", "🧑‍🚀", "👨‍🌾", "👩‍🔬", "🧛", "🐱", "🐶", "🦊", "🐼", "🐸", "🦁", "🐵", "🤖", "👽", "💀", "🎃", "👑"];

const JOBS = {
  empreendedor: [["fechou um contrato com uma padaria", "🥖"], ["vendeu um plano anual", "💼"], ["fez uma reunião de 3 horas que podia ser um e-mail", "📊"], ["abriu um quiosque de açaí", "🍧"]],
  programador: [["corrigiu um bug que ninguém entendia", "🐛"], ["fez uma landing page em uma tarde", "🧩"], ["arrumou o pixel de um cliente", "🎯"], ["subiu um deploy na sexta-feira (e deu certo)", "🚀"]],
  criativo: [["criou 12 artes para o feed", "🎨"], ["editou um vídeo para o Instagram", "🎬"], ["fotografou um casamento", "📸"], ["desenhou a logo de uma pizzaria", "🍕"]],
  comerciante: [["vendeu tudo na feira de domingo", "🧺"], ["revendeu tênis na internet", "👟"], ["negociou um lote de celulares", "📱"], ["abriu a loja mais cedo e lucrou", "🏪"]],
  filantropo: [["deu uma palestra numa escola", "🎤"], ["organizou um bazar beneficente", "🛍️"], ["ensinou informática para idosos", "👵"], ["coordenou um mutirão no bairro", "🧹"]],
  malandro: [["vendeu bala no semáforo", "🍬"], ["fez um bico de manobrista", "🚗"], ["achou uma nota no bolso da calça velha", "💵"], ["ganhou uma aposta com o vizinho", "🎲"]],
};
const ANY_JOBS = [["entregou panfletos no centro", "📄"], ["fez café para a equipe inteira", "☕"], ["passeou com o cachorro do vizinho", "🐕"], ["lavou o carro do chefe", "🧽"]];

/* ---------------- lojas ---------------- */
// type: food (energia/humor, vai para o inventário) · fun (humor) · course (uma vez, salário +10%)
//       house · vehicle (um de cada; trocar vende o antigo pela metade) · pet (uma vez) · item (inventário)
export const SHOPS = [
  {
    id: "mercado",
    name: "Mercado",
    icon: "🛒",
    desc: "Comida repõe energia para trabalhar.",
    items: [
      { id: "pao", name: "Pão na chapa e café", icon: "🥖", price: 25, type: "food", energy: 15 },
      { id: "marmita", name: "Marmita caseira", icon: "🍱", price: 60, type: "food", energy: 35 },
      { id: "energetico", name: "Energético", icon: "⚡", price: 90, type: "food", energy: 40, mood: -3 },
      { id: "pizza", name: "Pizza grande", icon: "🍕", price: 140, type: "food", energy: 60, mood: 5 },
      { id: "banquete", name: "Rodízio completo", icon: "🍽️", price: 320, type: "food", energy: 100, mood: 10 },
    ],
  },
  {
    id: "lazer",
    name: "Lazer",
    icon: "🎡",
    desc: "Humor alto faz você ganhar mais no trabalho.",
    items: [
      { id: "sorvete", name: "Sorvete na praça", icon: "🍦", price: 30, type: "fun", mood: 5 },
      { id: "cinema", name: "Sessão de cinema", icon: "🎬", price: 120, type: "fun", mood: 15 },
      { id: "videogame", name: "Noite de videogame", icon: "🎮", price: 200, type: "fun", mood: 20, energy: -5 },
      { id: "show", name: "Ingresso de show", icon: "🎸", price: 450, type: "fun", mood: 35 },
      { id: "spa", name: "Dia de spa", icon: "💆", price: 650, type: "fun", mood: 40, energy: 25 },
      { id: "viagem", name: "Viagem para a praia", icon: "🏖️", price: 1800, type: "fun", mood: 70, energy: 50, xp: 60, minLevel: 3 },
    ],
  },
  {
    id: "escola",
    name: "Escola",
    icon: "🎓",
    desc: "Cada curso aumenta seu salário em 10% para sempre.",
    items: [
      { id: "c-marketing", name: "Curso de marketing", icon: "📣", price: 800, type: "course", xp: 80 },
      { id: "c-design", name: "Curso de design", icon: "🖌️", price: 1500, type: "course", xp: 120, minLevel: 3 },
      { id: "c-programacao", name: "Curso de programação", icon: "⌨️", price: 2500, type: "course", xp: 180, minLevel: 5 },
      { id: "c-financas", name: "Curso de finanças", icon: "📈", price: 4000, type: "course", xp: 250, minLevel: 8 },
      { id: "c-lideranca", name: "MBA em liderança", icon: "🎖️", price: 7000, type: "course", xp: 400, minLevel: 12 },
    ],
  },
  {
    id: "imoveis",
    name: "Imóveis",
    icon: "🏠",
    desc: "Casa melhor = mais energia máxima e humor que nunca fica no chão.",
    items: [
      { id: "kitnet", name: "Kitnet", icon: "🛏️", price: 2000, type: "house", tier: 1, maxEnergy: 10, moodFloor: 10 },
      { id: "casa", name: "Casa com quintal", icon: "🏡", price: 8000, type: "house", tier: 2, maxEnergy: 30, moodFloor: 20, minLevel: 4 },
      { id: "apto", name: "Apartamento com vista", icon: "🏙️", price: 20000, type: "house", tier: 3, maxEnergy: 50, moodFloor: 30, minLevel: 8 },
      { id: "mansao", name: "Mansão", icon: "🏰", price: 60000, type: "house", tier: 4, maxEnergy: 100, moodFloor: 40, minLevel: 15, minSocial: 200 },
    ],
  },
  {
    id: "veiculos",
    name: "Veículos",
    icon: "🚗",
    desc: "Chega mais rápido no trabalho: menos espera entre um turno e outro.",
    items: [
      { id: "bike", name: "Bicicleta", icon: "🚲", price: 1200, type: "vehicle", tier: 1, cooldown: 10 },
      { id: "moto", name: "Moto", icon: "🛵", price: 6000, type: "vehicle", tier: 2, cooldown: 20, minLevel: 3 },
      { id: "carro", name: "Carro", icon: "🚙", price: 18000, type: "vehicle", tier: 3, cooldown: 30, pay: 0.05, minLevel: 6 },
      { id: "heli", name: "Helicóptero", icon: "🚁", price: 90000, type: "vehicle", tier: 4, cooldown: 40, pay: 0.1, minLevel: 15 },
    ],
  },
  {
    id: "utilidades",
    name: "Utilidades",
    icon: "🧰",
    desc: "Proteção e companhia.",
    items: [
      { id: "alarme", name: "Alarme anti-roubo", icon: "🚨", price: 500, type: "item", desc: "Bloqueia o próximo roubo contra você (gasta 1)." },
      { id: "gato", name: "Gato", icon: "🐈", price: 2500, type: "pet", desc: "Seu humor cai pela metade da velocidade." },
      { id: "cachorro", name: "Cachorro de guarda", icon: "🐕‍🦺", price: 3500, type: "pet", desc: "Ladrões têm 15% menos chance contra você." },
      { id: "papagaio", name: "Papagaio fofoqueiro", icon: "🦜", price: 1500, type: "pet", desc: "+10% de XP." },
    ],
  },
];
export const ITEMS = Object.fromEntries(SHOPS.flatMap((s) => s.items.map((i) => [i.id, { ...i, shop: s.id }])));

/* ---------------- caridade ---------------- */
export const CAUSES = [
  { id: "animais", name: "Abrigo de animais", icon: "🐾", desc: "Ração, vacina e castração para bichinhos abandonados." },
  { id: "alimentos", name: "Banco de alimentos", icon: "🍞", desc: "Cestas básicas para famílias do bairro." },
  { id: "escola", name: "Escola comunitária", icon: "📚", desc: "Material escolar e aulas de reforço." },
  { id: "hospital", name: "Hospital infantil", icon: "🏥", desc: "Brinquedoteca e equipamentos para as crianças internadas." },
  { id: "verde", name: "Reflorestamento", icon: "🌳", desc: "Mudas nativas plantadas na beira do rio." },
];
export const CHARITY_MIN = 10;

/* ---------------- títulos (pontos sociais) ---------------- */
// discount negativo = paga mais caro.
export const TITLES = [
  { min: 3000, name: "Lenda da cidade", icon: "👑", discount: 0.15 },
  { min: 1200, name: "Pilar da comunidade", icon: "🏛️", discount: 0.1 },
  { min: 500, name: "Benfeitor", icon: "🌟", discount: 0.06 },
  { min: 200, name: "Voluntário", icon: "🙌", discount: 0.03 },
  { min: 50, name: "Vizinho gente boa", icon: "🤝", discount: 0 },
  { min: 0, name: "Cidadão comum", icon: "🙂", discount: 0 },
  { min: -50, name: "Suspeito", icon: "🕶️", discount: -0.05 },
  { min: -Infinity, name: "Fora da lei", icon: "🚨", discount: -0.1 },
];
export const titleOf = (social) => TITLES.find((t) => num(social) >= t.min) || TITLES[TITLES.length - 1];
export const nextTitle = (social) => [...TITLES].reverse().find((t) => t.min > num(social)) || null;

/* ---------------- nível ---------------- */
export const xpToNext = (level) => 100 * level;
export function levelInfo(xp) {
  let level = 1;
  let rest = Math.max(0, num(xp));
  while (rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level += 1;
  }
  return { level, into: rest, need: xpToNext(level) };
}

/* ---------------- estado da persona ---------------- */
export const hasPersona = (w) => !!w?.persona?.name;
const owned = (w, type) => {
  const id = w?.assets?.[type];
  return id ? ITEMS[id] : null;
};
export const ownsPet = (w, id) => !!w?.pets?.[id];

export function maxEnergy(w) {
  return 100 + (owned(w, "house")?.maxEnergy || 0);
}
export function moodFloor(w) {
  return owned(w, "house")?.moodFloor || 0;
}

// Energia e humor "agora" (a passagem do tempo é calculada na hora, sem servidor).
export function liveStats(w, now = Date.now()) {
  const maxE = maxEnergy(w);
  const eAt = Number(w?.energyAt) || now;
  const energy = clamp(Math.floor((w?.energy ?? maxE) + ((now - eAt) / HOUR) * 10), 0, maxE);
  const floor = moodFloor(w);
  const mAt = Number(w?.moodAt) || now;
  let rate = 1;
  if (ownsPet(w, "gato")) rate *= 0.5;
  if (w?.persona?.cls === "criativo") rate *= 0.75;
  const mood = clamp(Math.floor((w?.mood ?? 60) - ((now - mAt) / HOUR) * rate), floor, 100);
  return { energy, maxEnergy: maxE, mood, moodFloor: floor, ...levelInfo(w?.xp), social: num(w?.social) };
}

const cls = (w) => CLASSES[w?.persona?.cls] || {};
export function xpMultiplier(w) {
  return 1 + (cls(w).xp || 0) + (ownsPet(w, "papagaio") ? 0.1 : 0);
}
export function payMultiplier(w, now = Date.now()) {
  const { level, mood } = liveStats(w, now);
  const courses = Object.keys(w?.courses || {}).length;
  return (
    (1 + 0.06 * (level - 1)) *
    (1 + (cls(w).pay || 0)) *
    (1 + 0.1 * courses) *
    (1 + (owned(w, "vehicle")?.pay || 0)) *
    (0.8 + mood / 250) // humor 0 → 80%, 50 → 100%, 100 → 120%
  );
}
export function workCooldown(w) {
  return (60 - (owned(w, "vehicle")?.cooldown || 0)) * 60000;
}
export function shopDiscount(w) {
  return (cls(w).discount || 0) + titleOf(w?.social).discount;
}
export const priceOf = (item, w) => Math.max(1, Math.ceil(item.price * (1 - shopDiscount(w))));

export function lockReason(item, w) {
  const { level } = liveStats(w);
  if (item.minLevel && level < item.minLevel) return `Nível ${item.minLevel}`;
  if (item.minSocial && num(w?.social) < item.minSocial) return `${item.minSocial} pontos sociais`;
  if (item.type === "course" && w?.courses?.[item.id]) return "Já fez";
  if (item.type === "pet" && ownsPet(w, item.id)) return "Já tem";
  if ((item.type === "house" || item.type === "vehicle") && w?.assets?.[item.type] === item.id) return "É o seu";
  return "";
}

/* ---------------- transações ---------------- */
async function readW(tx, uid) {
  const snap = await tx.get(walletRef(uid));
  if (!snap.exists()) throw new Error("Carteira não encontrada.");
  const w = snap.data();
  return { ...w, balance: num(w.balance), bank: num(w.bank) };
}

// Aplica ganho de XP e devolve os campos + se subiu de nível (com o prêmio).
function gainXp(w, base) {
  const add = Math.round(base * xpMultiplier(w));
  const before = levelInfo(w.xp).level;
  const xp = num(w.xp) + add;
  const after = levelInfo(xp).level;
  const up = after > before ? { from: before, to: after, bonus: Array.from({ length: after - before }, (_, i) => 150 * (before + i + 1)).reduce((a, b) => a + b, 0) } : null;
  return { xp, add, up };
}

function statsUpdate(w, now, { energy, mood }) {
  const s = liveStats(w, now);
  const out = {};
  out.energy = clamp(s.energy + (energy || 0), 0, s.maxEnergy);
  out.energyAt = now;
  out.mood = clamp(s.mood + (mood || 0), s.moodFloor, 100);
  out.moodAt = now;
  return out;
}

export async function createPersona(uid, { name, emoji, cls: c, bio }) {
  const n = String(name || "").trim().slice(0, 32);
  if (!n) throw new Error("Dê um nome para sua persona.");
  if (!CLASSES[c]) throw new Error("Escolha uma classe.");
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    if (hasPersona(w)) throw new Error("Você já tem uma persona.");
    const now = Date.now();
    tx.update(walletRef(uid), {
      persona: { name: n, emoji: emoji || "😎", cls: c, bio: String(bio || "").slice(0, 140), createdAt: now },
      xp: num(w.xp),
      social: num(w.social),
      energy: 100,
      energyAt: now,
      mood: 60,
      moodAt: now,
    });
  });
}

export async function editPersona(uid, { name, emoji, cls: c, bio }) {
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    if (!hasPersona(w)) throw new Error("Crie sua persona primeiro.");
    const n = String(name || "").trim().slice(0, 32) || w.persona.name;
    const upd = { persona: { ...w.persona, name: n, emoji: emoji || w.persona.emoji, bio: String(bio ?? w.persona.bio ?? "").slice(0, 140) } };
    if (c && c !== w.persona.cls) {
      if (!CLASSES[c]) throw new Error("Classe inválida.");
      if (w.balance < CLASS_CHANGE_COST) throw new Error(`Trocar de classe custa 🪙 ${CLASS_CHANGE_COST.toLocaleString("pt-BR")} (na carteira).`);
      upd.persona.cls = c;
      upd.balance = w.balance - CLASS_CHANGE_COST;
    }
    tx.update(walletRef(uid), upd);
    return { changedClass: "balance" in upd };
  });
}

/* trabalhar (substitui o trabalho antigo) */
export async function workShift(uid) {
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    if (!hasPersona(w)) throw new Error("Crie sua persona antes de trabalhar.");
    const now = Date.now();
    const left = Math.max(0, (w.lastWork || 0) + workCooldown(w) - now);
    if (left > 0) throw new Error(`Você está cansado do último turno. Volte em ${Math.ceil(left / 60000)} min.`);
    const s = liveStats(w, now);
    if (s.energy < 15) throw new Error(`Sem energia (⚡ ${s.energy}). Coma alguma coisa no Mercado ou espere ela voltar.`);
    const list = [...(JOBS[w.persona.cls] || []), ...ANY_JOBS];
    const [job, emoji] = list[randInt(list.length)];
    let amount = Math.round((100 + randInt(151)) * payMultiplier(w, now));
    const tip = rand() < 0.05;
    if (tip) amount *= 3;
    const g = gainXp(w, 15 + randInt(11));
    const bonus = g.up?.bonus || 0;
    const st = statsUpdate(w, now, { energy: -20 });
    if (g.up) st.energy = maxEnergy(w); // subiu de nível: energia cheia
    tx.update(walletRef(uid), { balance: w.balance + amount + bonus, lastWork: now, xp: g.xp, ...st });
    return { amount, job, emoji, tip, xp: g.add, levelUp: g.up, energy: st.energy };
  });
}

/* lojas */
export async function buyItem(uid, itemId, { qty = 1, use = false } = {}) {
  const item = ITEMS[itemId];
  if (!item) throw new Error("Item não existe.");
  qty = clamp(num(qty) || 1, 1, 20);
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    if (!hasPersona(w)) throw new Error("Crie sua persona antes de fazer compras.");
    const lock = lockReason(item, w);
    if (lock) throw new Error(lock.startsWith("Nível") || lock.includes("pontos") ? `Precisa de ${lock}.` : lock + ".");
    const now = Date.now();
    const single = ["course", "house", "vehicle", "pet"].includes(item.type);
    if (single) qty = 1;
    const price = priceOf(item, w) * qty;
    let refund = 0;
    let old = null;
    if (item.type === "house" || item.type === "vehicle") {
      old = owned(w, item.type);
      if (old) refund = Math.floor(old.price * 0.5);
    }
    if (w.balance + refund < price) throw new Error(`Faltam ${(price - w.balance - refund).toLocaleString("pt-BR")} moedas na carteira.`);
    const upd = { balance: w.balance + refund - price, spent: num(w.spent) + price };
    let effect = null;
    let xpBase = 0;
    if (item.type === "course") {
      upd[`courses.${item.id}`] = now;
      xpBase = item.xp || 0;
    } else if (item.type === "house" || item.type === "vehicle") {
      upd[`assets.${item.type}`] = item.id;
      if (item.type === "house") Object.assign(upd, statsUpdate({ ...w, assets: { ...(w.assets || {}), house: item.id } }, now, { mood: 10 }));
    } else if (item.type === "pet") {
      upd[`pets.${item.id}`] = now;
      Object.assign(upd, statsUpdate(w, now, { mood: 10 }));
    } else if (use && (item.type === "food" || item.type === "fun")) {
      effect = applyEffect(w, item, now, qty);
      Object.assign(upd, effect.fields);
      xpBase = (item.xp || 0) * qty;
    } else {
      upd[`inv.${item.id}`] = num(w.inv?.[item.id]) + qty;
    }
    let up = null;
    if (xpBase) {
      const g = gainXp(w, xpBase);
      upd.xp = g.xp;
      up = g.up;
      if (up) upd.balance += up.bonus;
    }
    tx.update(walletRef(uid), upd);
    return { item, qty, price, refund, old, used: !!effect, effect: effect?.info, levelUp: up };
  });
}

function applyEffect(w, item, now, qty = 1) {
  const funMul = item.type === "fun" ? 1 + (cls(w).fun || 0) : 1;
  const dE = (item.energy || 0) * qty;
  const dM = Math.round((item.mood || 0) * qty * funMul);
  const fields = statsUpdate(w, now, { energy: dE, mood: dM });
  return { fields, info: { energy: dE, mood: dM } };
}

export async function useItem(uid, itemId) {
  const item = ITEMS[itemId];
  if (!item || !["food", "fun"].includes(item.type)) throw new Error("Esse item não se usa assim.");
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    const have = num(w.inv?.[itemId]);
    if (have < 1) throw new Error("Você não tem esse item.");
    const now = Date.now();
    const e = applyEffect(w, item, now);
    const upd = { ...e.fields, [`inv.${itemId}`]: have - 1 };
    let up = null;
    if (item.xp) {
      const g = gainXp(w, item.xp);
      upd.xp = g.xp;
      up = g.up;
      if (up) upd.balance = w.balance + up.bonus;
    }
    tx.update(walletRef(uid), upd);
    return { item, effect: e.info, levelUp: up };
  });
}

/* caridade */
export function charityPoints(w, amount) {
  return Math.floor((num(amount) / 10) * (1 + (cls(w).charity || 0)));
}
export async function donate(uid, causeId, amount) {
  const cause = CAUSES.find((c) => c.id === causeId);
  amount = num(amount);
  if (!cause) throw new Error("Escolha uma causa.");
  if (amount < CHARITY_MIN) throw new Error(`Doe pelo menos 🪙 ${CHARITY_MIN}.`);
  return runTransaction(db, async (tx) => {
    const w = await readW(tx, uid);
    if (!hasPersona(w)) throw new Error("Crie sua persona antes de doar.");
    if (w.balance < amount) throw new Error("Você não tem isso na carteira.");
    const now = Date.now();
    const pts = charityPoints(w, amount);
    const g = gainXp(w, Math.floor(amount / 20));
    const st = statsUpdate(w, now, { mood: Math.min(30, Math.ceil(amount / 50)) });
    const before = titleOf(w.social);
    const social = num(w.social) + pts;
    tx.update(walletRef(uid), {
      balance: w.balance - amount + (g.up?.bonus || 0),
      social,
      donated: num(w.donated) + amount,
      xp: g.xp,
      ...st,
    });
    tx.set(doc(db, "charity", causeId), { total: increment(amount), donations: increment(1), updatedAt: serverTimestamp() }, { merge: true });
    const after = titleOf(social);
    return { cause, amount, points: pts, xp: g.add, levelUp: g.up, newTitle: after.name !== before.name ? after : null };
  });
}

// Fama depois de um roubo (chamado de dentro da transação do roubo).
export function robSocialPenalty(w, ok) {
  return (ok ? 15 : 5) * (cls(w).shame || 1);
}
export function robChanceFor(thief, victim, base) {
  return clamp(base + (cls(thief).rob || 0) - (ownsPet(victim, "cachorro") ? 0.15 : 0), 0.05, 0.9);
}

export const statBar = (v, max) => `${clamp(Math.round((v / max) * 100), 0, 100)}%`;
