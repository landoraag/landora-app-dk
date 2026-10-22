import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../../lib/firebase";
import { useCollection } from "../../lib/useCollection";
import { useAuth } from "../../context/AuthContext";
import { addDays, formatBRL, formatDate, todayISO } from "../../lib/format";
import { cycleTotals, getCyclesRange } from "../../lib/finance";
import { isOverdue, sortTasks } from "../../lib/tasks";
import { useVoiceMembers } from "../../lib/useVoiceMembers";
import { C, RingGauge, StatCard } from "../charts/ChartKit";
import { TaskItem } from "../TaskParts";
import Avatar from "../Avatar";
import Icon from "../Icons";

const msOf = (m) => m.createdAt?.toMillis?.() ?? (m.createdAt?.seconds ? m.createdAt.seconds * 1000 : 0);

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "Boa noite" : h < 12 ? "Bom dia" : h < 18 ? "Boa tarde" : "Boa noite";
}

// Cabeçalho de um cartão com link "ver tudo".
function CardHead({ icon, title, to, linkText = "ver tudo", count }) {
  return (
    <header className="home-card-head">
      <span className="home-card-icon">
        <Icon name={icon} size={17} />
      </span>
      <h3>{title}</h3>
      {count > 0 && <span className="home-count">{count}</span>}
      {to && (
        <Link to={to} className="home-more">
          {linkText} ›
        </Link>
      )}
    </header>
  );
}

// Um canal de voz com gente dentro (só aparece se tiver alguém).
function LiveCall({ c, onOpen }) {
  const members = useVoiceMembers(c.id);
  if (!members.length) return null;
  return (
    <button type="button" className="home-call" onClick={() => onOpen(c)}>
      <span className="home-call-dot" />
      <span className="home-call-name">🔊 {c.name}</span>
      <span className="home-call-avatars">
        {members.slice(0, 4).map((m) => (
          <Avatar key={m.id} src={m.photoURL} name={m.nickname} size={24} />
        ))}
      </span>
      <span className="home-call-n">{members.length}</span>
    </button>
  );
}

export default function Inicio() {
  const navigate = useNavigate();
  const { user, profile } = useAuth();

  const { data: entries } = useCollection("financeEntries", "date", "desc");
  const { data: subscriptions } = useCollection("subscriptions", "createdAt", "desc");
  const { data: settingsDocs } = useCollection("settings");
  const { data: tasks } = useCollection("tasks", "createdAt", "desc");
  const { data: leads } = useCollection("leads", "createdAt", "desc");
  const { data: sales } = useCollection("sales", "date", "desc");
  const { data: clients } = useCollection("clients", "createdAt", "desc");
  const { data: pages } = useCollection("landingPages", "createdAt", "desc");
  const { data: channels } = useCollection("channels", "createdAt", "asc");
  const { data: messages } = useCollection("chatMessages", "createdAt", "asc", 20);
  const { data: calls } = useCollection("calls", "createdAt", "asc");

  // Até onde eu já li em cada canal (o mesmo que o Chat usa).
  const [reads, setReads] = useState(null);
  useEffect(() => {
    if (!user) return undefined;
    return onSnapshot(
      doc(db, "chatReads", user.uid),
      (snap) => setReads(snap.exists() ? snap.data() : { __since: Date.now() }),
      () => setReads({ __since: Date.now() })
    );
  }, [user]);

  /* ----- financeiro do ciclo atual ----- */
  const resetDay = settingsDocs.find((s) => s.id === "finance")?.resetDay || 1;
  const cycle = useMemo(() => getCyclesRange(resetDay, 1)[0], [resetDay]);
  const fin = useMemo(() => cycleTotals(cycle, entries, subscriptions), [cycle, entries, subscriptions]);
  const spentPct = fin.entradasTotal > 0 ? (fin.saidas / fin.entradasTotal) * 100 : 0;

  /* ----- tarefas ----- */
  const today = todayISO();
  const urgentTasks = useMemo(
    () => sortTasks(tasks.filter((t) => t.status !== "done" && (isOverdue(t) || t.dueDate === today || t.priority === "urgente"))),
    [tasks, today]
  );
  const openTasks = tasks.filter((t) => t.status !== "done");
  const lateCount = tasks.filter(isOverdue).length;

  /* ----- vendas (últimos 30 dias) ----- */
  const since30 = addDays(today, -30);
  const sales30 = sales.filter((s) => s.date >= since30 && s.date <= today);
  const sales30Total = sales30.reduce((s, v) => s + (v.implantationValue || 0) + (v.subscriptionValue || 0), 0);
  const clientName = (id) => clients.find((c) => c.id === id)?.name || "—";
  const pageTitle = (id) => pages.find((p) => p.id === id)?.title || "—";

  /* ----- leads da última semana ----- */
  const weekAgo = Date.now() - 7 * 86400000;
  const newLeads = leads.filter((l) => msOf(l) >= weekAgo).length;

  /* ----- chat: não lidas por canal ----- */
  const unread = useMemo(() => {
    if (!reads) return [];
    const by = {};
    for (const m of messages) {
      if (m.senderId === user.uid) continue;
      const seen = Math.max(reads[m.channelId] || 0, reads.__since || 0);
      if (msOf(m) <= seen) continue;
      const o = (by[m.channelId] ||= { count: 0, mention: false, last: m });
      o.count += 1;
      o.last = m;
      if (m.mentions?.includes(user.uid)) o.mention = true;
    }
    return channels.filter((c) => by[c.id]).map((c) => ({ channel: c, ...by[c.id] }));
  }, [messages, reads, channels, user.uid]);
  const unreadTotal = unread.reduce((s, u) => s + u.count, 0);

  const firstName = (profile?.nickname || "").split(" ")[0];
  const rawDate = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" });
  const dateLabel = rawDate.charAt(0).toUpperCase() + rawDate.slice(1); // "Domingo, 18 de outubro"

  return (
    <div className="home">
      <header className="home-hero">
        <div>
          <p className="home-date">{dateLabel}</p>
          <h2>
            {greeting()}
            {firstName ? `, ${firstName}` : ""} 👋
          </h2>
          <p className="muted">
            {lateCount > 0
              ? `Você tem ${lateCount} ${lateCount === 1 ? "tarefa atrasada" : "tarefas atrasadas"}.`
              : unreadTotal > 0
                ? `${unreadTotal} ${unreadTotal === 1 ? "mensagem nova" : "mensagens novas"} no chat.`
                : "Tudo em dia por aqui."}
          </p>
        </div>
      </header>

      <div className="kpi-row">
        <StatCard
          label={`Saldo do ciclo ${cycle.label}`}
          value={formatBRL(fin.saldo)}
          tone={fin.saldo >= 0 ? "" : "negative"}
          sub={`Entrou ${formatBRL(fin.entradasTotal)}`}
        />
        <StatCard label="Vendas (30 dias)" value={formatBRL(sales30Total)} accent={C.b} tone="tone-b" sub={`${sales30.length} ${sales30.length === 1 ? "venda" : "vendas"}`} />
        <StatCard
          label="Tarefas abertas"
          value={String(openTasks.length)}
          accent={lateCount ? "#ef4444" : C.a}
          sub={lateCount ? `${lateCount} atrasada${lateCount > 1 ? "s" : ""}` : "nenhuma atrasada"}
        />
        <StatCard label="Leads novos (7 dias)" value={String(newLeads)} accent={C.brand} sub={`${leads.length} no total`} />
      </div>

      <div className="home-grid">
        <div className="home-col">
          <section className="glass-card home-card">
            <CardHead icon="tarefas" title="Para hoje" to="/tarefas" count={urgentTasks.length} />
            <div className="task-list compact">
              {urgentTasks.slice(0, 6).map((t) => (
                <TaskItem key={t.id} task={t} onOpen={() => navigate("/tarefas")} onGoPage={(id) => navigate("/landing-pages", { state: { openPageId: id } })} />
              ))}
              {urgentTasks.length === 0 && <p className="home-empty">Nada urgente, atrasado ou vencendo hoje. ✨</p>}
            </div>
          </section>

          <section className="glass-card home-card">
            <CardHead icon="vendas" title="Últimas vendas" to="/vendas" />
            <div className="home-list">
              {sales.slice(0, 5).map((s) => (
                <div key={s.id} className="home-row">
                  <div className="home-row-main">
                    <b>{clientName(s.clientId)}</b>
                    <span>
                      {pageTitle(s.landingPageId)} · {formatDate(s.date)}
                    </span>
                  </div>
                  <b className="home-money">{formatBRL((s.implantationValue || 0) + (s.subscriptionValue || 0))}</b>
                </div>
              ))}
              {sales.length === 0 && <p className="home-empty">Nenhuma venda registrada ainda.</p>}
            </div>
          </section>
        </div>

        <div className="home-col">
          <section className="glass-card home-card home-ring">
            <CardHead icon="financeiro" title="Ciclo atual" to="/financeiro" linkText="financeiro" />
            <RingGauge pct={spentPct} label={"da entrada\njá saiu"} size={170} />
            <p className="ring-note">
              {fin.entradasTotal > 0 ? `${formatBRL(fin.saidas)} de ${formatBRL(fin.entradasTotal)}` : "Sem entradas neste ciclo ainda."}
            </p>
          </section>

          <section className="glass-card home-card">
            <CardHead icon="chat" title="Chat" to="/chat" linkText="abrir" count={unreadTotal} />
            <div className="home-list">
              {calls.map((c) => (
                <LiveCall key={c.id} c={c} onOpen={(call) => navigate(`/chat?v=${call.id}`)} />
              ))}
              {unread.map((u) => (
                <button type="button" key={u.channel.id} className="home-row home-row-btn" onClick={() => navigate(`/chat?c=${u.channel.id}`)}>
                  <div className="home-row-main">
                    <b># {u.channel.name}</b>
                    <span>
                      {u.last.senderNickname}: {u.last.text || (u.last.images?.length || u.last.imageUrl ? "📷 Imagem" : u.last.files?.length ? "📎 Arquivo" : u.last.audio ? "🎤 Áudio" : "")}
                    </span>
                  </div>
                  <span className={"chat-unread" + (u.mention ? " mention" : "")}>
                    {u.mention ? "@" : ""}
                    {u.count > 99 ? "99+" : u.count}
                  </span>
                </button>
              ))}
              {unread.length === 0 && <p className="home-empty">Nenhuma mensagem nova.</p>}
            </div>
          </section>

          <section className="glass-card home-card">
            <CardHead icon="leads" title="Leads recentes" to="/leads" />
            <div className="home-list">
              {leads.slice(0, 4).map((l) => (
                <div key={l.id} className="home-row">
                  {l.logoUrl ? <img className="home-lead-logo" src={l.logoUrl} alt="" /> : <Avatar name={l.company || l.name} size={32} />}
                  <div className="home-row-main">
                    <b>{l.company || l.name}</b>
                    <span>{[l.industry, l.status].filter(Boolean).join(" · ") || "—"}</span>
                  </div>
                </div>
              ))}
              {leads.length === 0 && <p className="home-empty">Nenhum lead cadastrado ainda.</p>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
