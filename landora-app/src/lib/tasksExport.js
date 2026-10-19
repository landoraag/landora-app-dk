// Exporta a lista "Alterações a serem feitas" em PDF ou PNG.
import jsPDF from "jspdf";
import { EXPORT_TITLE, exportNumber, groupTasksForExport } from "./tasks";

// Padrão visual da Landora: fundo preto, detalhes em azul, texto em cinza.
const THEME = {
  bg: "#0A0A0A",
  card: "#111827",
  border: "#232b3a",
  blue: "#0057FF",
  blueDark: "#1E3A8A",
  title: "#f4f6fb",
  text: "#d1d5db",
  muted: "#8b93a3",
};
const fileDate = () => new Date().toLocaleDateString("pt-BR").replace(/\//g, "-");
const today = () => new Date().toLocaleDateString("pt-BR");

function download(href, name) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  a.click();
}

// ---------- PDF (texto real, selecionável) ----------
export function exportTasksPDF(list) {
  const pdf = new jsPDF({ unit: "mm", format: "a4" });
  const W = pdf.internal.pageSize.getWidth();
  const H = pdf.internal.pageSize.getHeight();
  const M = 18;
  const paintPage = () => {
    pdf.setFillColor(THEME.bg).rect(0, 0, W, H, "F");
    pdf.setFillColor(THEME.blue).rect(0, 0, W, 1.6, "F");
  };
  paintPage();
  let y = M;
  const need = (h) => {
    if (y + h > H - M) {
      pdf.addPage();
      paintPage();
      y = M;
    }
  };

  pdf.setFont("helvetica", "bold").setFontSize(18).setTextColor(THEME.title);
  pdf.text(EXPORT_TITLE, M, y + 4);
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(THEME.muted);
  pdf.text(`Gerado em ${today()}`, W - M, y + 4, { align: "right" });
  y += 8;
  pdf.setDrawColor(THEME.border).setLineWidth(0.3).line(M, y, W - M, y);
  y += 10;

  const pages = groupTasksForExport(list);
  if (!pages.length) {
    pdf.setFontSize(12).setTextColor(THEME.muted).text("Nenhuma alteração pendente.", M, y);
  }
  pages.forEach((pg, pi) => {
    need(30);
    if (pi > 0) y += 4;
    // Cabeçalho da page: faixa escura com borda azul à esquerda.
    pdf.setFillColor(THEME.card).roundedRect(M, y - 6.5, W - 2 * M, 11, 1.5, 1.5, "F");
    pdf.setFillColor(THEME.blue).rect(M, y - 6.5, 1.6, 11, "F");
    pdf.setFont("helvetica", "bold").setFontSize(15).setTextColor(THEME.title);
    pdf.text(pg.page, M + 6, y + 1);
    pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(THEME.muted);
    pdf.text(`${pg.count} ${pg.count === 1 ? "alteração" : "alterações"}`, W - M - 4, y + 1, { align: "right" });
    y += 14;
    pg.groups.forEach((g) => {
      need(14);
      pdf.setFillColor(THEME.blue).rect(M + 4, y - 4, 2.2, 5, "F");
      pdf.setFont("helvetica", "bold").setFontSize(12).setTextColor(THEME.blue);
      pdf.text(`${g.label} (${g.items.length})`, M + 9, y);
      y += 7;
      g.items.forEach((t, i) => {
        pdf.setFont("helvetica", "bold").setFontSize(11);
        const titleLines = pdf.splitTextToSize(`${exportNumber(i)} - ${t.title}`, W - 2 * M - 10);
        const sub = [t.extra, t.description].filter(Boolean).join(" — ");
        pdf.setFont("helvetica", "normal").setFontSize(9.5);
        const subLines = sub ? pdf.splitTextToSize(sub, W - 2 * M - 20) : [];
        need(titleLines.length * 5 + subLines.length * 4.3 + 3);
        pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(THEME.text);
        pdf.text(titleLines, M + 9, y);
        y += titleLines.length * 5;
        if (subLines.length) {
          pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(THEME.muted);
          pdf.text(subLines, M + 19, y - 0.5);
          y += subLines.length * 4.3;
        }
        y += 2.5;
      });
      y += 4;
    });
    y += 4;
  });

  pdf.save(`alteracoes-${fileDate()}.pdf`);
}

// ---------- PNG (imagem para mandar no WhatsApp etc.) ----------
function wrap(ctx, text, maxW) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  words.forEach((w) => {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = test;
  });
  if (line) lines.push(line);
  return lines;
}

export function exportTasksPNG(list) {
  const pages = groupTasksForExport(list);
  const W = 900;
  const P = 48;
  const S = 2; // nitidez (retina)
  const font = (w, px) => `${w} ${px}px system-ui, -apple-system, Segoe UI, Roboto, sans-serif`;
  const measure = document.createElement("canvas").getContext("2d");

  // 1ª passada: monta as linhas e calcula a altura.
  const ops = [];
  let y = P + 30;
  ops.push({ t: "title", y });
  y += 44;
  if (!pages.length) {
    ops.push({ t: "text", y, text: "Nenhuma alteração pendente.", f: font(400, 18), c: THEME.muted, x: P });
    y += 30;
  }
  pages.forEach((pg, pi) => {
    y += pi > 0 ? 22 : 8;
    ops.push({ t: "page", y, pg });
    y += 48;
    pg.groups.forEach((g) => {
      ops.push({ t: "group", y, g });
      y += 30;
      g.items.forEach((it, i) => {
        measure.font = font(600, 18);
        wrap(measure, `${exportNumber(i)} - ${it.title}`, W - 2 * P - 40).forEach((l) => {
          ops.push({ t: "text", y, text: l, f: font(600, 18), c: THEME.text, x: P + 32 });
          y += 26;
        });
        const sub = [it.extra, it.description].filter(Boolean).join(" — ");
        if (sub) {
          measure.font = font(400, 14);
          wrap(measure, sub, W - 2 * P - 80).forEach((l) => {
            ops.push({ t: "text", y: y - 2, text: l, f: font(400, 14), c: THEME.muted, x: P + 76 });
            y += 20;
          });
        }
        y += 8;
      });
      y += 10;
    });
  });
  const H = y + P - 10;

  // 2ª passada: desenha.
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  ctx.fillStyle = THEME.bg;
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, THEME.blueDark);
  grad.addColorStop(1, THEME.blue);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, 5);
  ctx.textBaseline = "alphabetic";
  ops.forEach((o) => {
    if (o.t === "title") {
      ctx.font = font(700, 28);
      ctx.fillStyle = THEME.title;
      ctx.fillText(EXPORT_TITLE, P, o.y);
      ctx.font = font(400, 14);
      ctx.fillStyle = THEME.muted;
      ctx.textAlign = "right";
      ctx.fillText(today(), W - P, o.y);
      ctx.textAlign = "left";
      ctx.fillStyle = THEME.border;
      ctx.fillRect(P, o.y + 18, W - 2 * P, 1);
    } else if (o.t === "page") {
      ctx.fillStyle = THEME.card;
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(P, o.y - 28, W - 2 * P, 42, 8) : ctx.rect(P, o.y - 28, W - 2 * P, 42);
      ctx.fill();
      ctx.fillStyle = THEME.blue;
      ctx.fillRect(P, o.y - 28, 4, 42);
      ctx.font = font(700, 22);
      ctx.fillStyle = THEME.title;
      ctx.fillText(o.pg.page, P + 18, o.y);
      ctx.font = font(400, 14);
      ctx.fillStyle = THEME.muted;
      ctx.textAlign = "right";
      ctx.fillText(`${o.pg.count} ${o.pg.count === 1 ? "alteração" : "alterações"}`, W - P - 16, o.y);
      ctx.textAlign = "left";
    } else if (o.t === "group") {
      ctx.fillStyle = THEME.blue;
      ctx.fillRect(P + 12, o.y - 16, 4, 20);
      ctx.font = font(700, 18);
      ctx.fillText(`${o.g.label} (${o.g.items.length})`, P + 26, o.y);
    } else {
      ctx.font = o.f;
      ctx.fillStyle = o.c;
      ctx.fillText(o.text, o.x, o.y);
    }
  });

  download(canvas.toDataURL("image/png"), `alteracoes-${fileDate()}.png`);
}
