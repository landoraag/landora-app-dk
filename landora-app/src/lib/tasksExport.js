// Exporta a lista "Alterações a serem feitas" em PDF ou PNG.
import jsPDF from "jspdf";
import { EXPORT_TITLE, exportNumber, groupTasksForExport } from "./tasks";

const COLORS = { urgente: "#dc2626", alta: "#ea580c", media: "#ca8a04", baixa: "#16a34a" };
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
  let y = M;
  const need = (h) => {
    if (y + h > H - M) {
      pdf.addPage();
      y = M;
    }
  };

  pdf.setFont("helvetica", "bold").setFontSize(18).setTextColor(20);
  pdf.text(EXPORT_TITLE, M, y + 4);
  pdf.setFont("helvetica", "normal").setFontSize(10).setTextColor(120);
  pdf.text(`Gerado em ${today()}`, W - M, y + 4, { align: "right" });
  y += 14;

  const groups = groupTasksForExport(list);
  if (!groups.length) {
    pdf.setFontSize(12).setTextColor(80).text("Nenhuma alteração pendente.", M, y);
  }
  groups.forEach((g) => {
    need(16);
    pdf.setFillColor(COLORS[g.key]).rect(M, y - 4.5, 3, 6, "F");
    pdf.setFont("helvetica", "bold").setFontSize(14).setTextColor(COLORS[g.key]);
    pdf.text(`${g.label} (${g.items.length})`, M + 6, y);
    y += 8;
    g.items.forEach((t, i) => {
      pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(30);
      const titleLines = pdf.splitTextToSize(`${exportNumber(i)} - ${t.title}`, W - 2 * M - 4);
      const sub = [t.extra, t.description].filter(Boolean).join(" — ");
      pdf.setFont("helvetica", "normal").setFontSize(9.5);
      const subLines = sub ? pdf.splitTextToSize(sub, W - 2 * M - 14) : [];
      need(titleLines.length * 5 + subLines.length * 4.3 + 3);
      pdf.setFont("helvetica", "bold").setFontSize(11).setTextColor(30);
      pdf.text(titleLines, M + 4, y);
      y += titleLines.length * 5;
      if (subLines.length) {
        pdf.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(110);
        pdf.text(subLines, M + 14, y - 0.5);
        y += subLines.length * 4.3;
      }
      y += 2.5;
    });
    y += 5;
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
  const groups = groupTasksForExport(list);
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
  if (!groups.length) {
    ops.push({ t: "text", y, text: "Nenhuma alteração pendente.", f: font(400, 18), c: "#555", x: P });
    y += 30;
  }
  groups.forEach((g) => {
    y += 10;
    ops.push({ t: "group", y, g });
    y += 34;
    g.items.forEach((it, i) => {
      measure.font = font(600, 18);
      wrap(measure, `${exportNumber(i)} - ${it.title}`, W - 2 * P - 20).forEach((l) => {
        ops.push({ t: "text", y, text: l, f: font(600, 18), c: "#1f2937", x: P + 20 });
        y += 26;
      });
      const sub = [it.extra, it.description].filter(Boolean).join(" — ");
      if (sub) {
        measure.font = font(400, 14);
        wrap(measure, sub, W - 2 * P - 64).forEach((l) => {
          ops.push({ t: "text", y: y - 2, text: l, f: font(400, 14), c: "#6b7280", x: P + 64 });
          y += 20;
        });
      }
      y += 8;
    });
  });
  const H = y + P - 10;

  // 2ª passada: desenha.
  const canvas = document.createElement("canvas");
  canvas.width = W * S;
  canvas.height = H * S;
  const ctx = canvas.getContext("2d");
  ctx.scale(S, S);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";
  ops.forEach((o) => {
    if (o.t === "title") {
      ctx.font = font(700, 28);
      ctx.fillStyle = "#111827";
      ctx.fillText(EXPORT_TITLE, P, o.y);
      ctx.font = font(400, 14);
      ctx.fillStyle = "#9ca3af";
      ctx.textAlign = "right";
      ctx.fillText(today(), W - P, o.y);
      ctx.textAlign = "left";
    } else if (o.t === "group") {
      ctx.fillStyle = COLORS[o.g.key];
      ctx.fillRect(P, o.y - 20, 6, 26);
      ctx.font = font(700, 22);
      ctx.fillText(`${o.g.label} (${o.g.items.length})`, P + 18, o.y);
    } else {
      ctx.font = o.f;
      ctx.fillStyle = o.c;
      ctx.fillText(o.text, o.x, o.y);
    }
  });

  download(canvas.toDataURL("image/png"), `alteracoes-${fileDate()}.png`);
}
