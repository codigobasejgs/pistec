// PDF vetorial a partir do layout neutro (Doc). Fontes padrão (Helvetica/WinAnsi cobre acentos do português).
// Gerado no navegador a partir do SNAPSHOT persistido no servidor: o conteúdo é o mesmo do registro emitido.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import qrcode from 'qrcode-generator';
import type { Block, Doc } from '../../../supabase/functions/_shared/documents/model';
import { code128 } from '../../../supabase/functions/_shared/documents/barcode';
import type { Paper } from '../../../supabase/functions/_shared/documents/paper';

const MM = 72 / 25.4;
// Caracteres fora do WinAnsi (ex.: ✔, ≥) viram equivalentes seguros em vez de quebrar a geração.
const clean = (s: string) => s.replace(/[\u2714\u2713]/g, 'X').replace(/[\u2718\u2717]/g, '-').replace(/[\u2212\u2013\u2014]/g, '-').replace(/\u2265/g, '>=').replace(/[^\t\n\u0020-\u007e\u00a0-\u00ff\u20ac\u2022\u2026\u201c\u201d\u2018\u2019]/g, '?');

export async function renderPdf(doc: Doc, paper: Paper, accentHex = '#0b57d0'): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${doc.title} ${doc.number}`); pdf.setAuthor(doc.company.name); pdf.setCreator('PISTEC'); pdf.setProducer('PISTEC Documentos'); pdf.setCreationDate(new Date(doc.issuedAt));
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const thermal = paper.kind === 'thermal', W = paper.width * MM, margin = (thermal ? (paper.width - paper.printable) / 2 : paper.margin) * MM;
  const H = paper.height ? paper.height * MM : 2000; // bobina: página longa, recortada no fim
  const size = thermal ? (paper.width <= 58 ? 7 : 8.5) : 9.5, lineH = size * 1.32, inner = W - margin * 2;
  const hex = /^#([0-9a-f]{6})$/i.exec(accentHex)?.[1] ?? '0b57d0', accent = thermal ? rgb(0, 0, 0) : rgb(parseInt(hex.slice(0, 2), 16) / 255, parseInt(hex.slice(2, 4), 16) / 255, parseInt(hex.slice(4), 16) / 255);
  const pages: PDFPage[] = []; let page!: PDFPage, y = 0;
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - margin; };
  const need = (h: number) => { if (y - h < margin + 14) { if (thermal) throw new Error('Documento excede o comprimento máximo da bobina.'); newPage(); } };
  const width = (t: string, f: PDFFont, s: number) => f.widthOfTextAtSize(clean(t), s);
  const wrap = (t: string, f: PDFFont, s: number, max: number) => { const out: string[] = [];
    for (const para of clean(t).split('\n')) { let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${word}` : word;
        if (width(next, f, s) <= max) { line = next; continue; } if (line) out.push(line);
        line = word; while (width(line, f, s) > max && line.length > 1) { let k = line.length; while (k > 1 && width(line.slice(0, k), f, s) > max) k--; out.push(line.slice(0, k)); line = line.slice(k); } }
      out.push(line); }
    return out; };
  const text = (t: string, x: number, f = regular, s = size, color = rgb(0, 0, 0)) => page.drawText(clean(t), { x, y, size: s, font: f, color });
  const para = (t: string, f = regular, s = size, center = false) => { for (const l of wrap(t, f, s, inner)) { need(s * 1.32); y -= s * 1.32; text(l, center ? margin + (inner - width(l, f, s)) / 2 : margin, f, s); } };
  const rule = (thick = 0.6, color = rgb(0, 0, 0)) => { need(4); y -= 3; page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: thick, color }); y -= 2; };
  newPage();
  // Cabeçalho da empresa
  const logo = doc.company.logo.match(/^data:image\/(png|jpeg);base64,(.+)$/);
  if (logo) { try { const img = logo[1] === 'png' ? await pdf.embedPng(logo[2]) : await pdf.embedJpg(logo[2]); const h = Math.min(16 * MM, img.height), w = img.width * h / img.height, ww = Math.min(w, inner * 0.6), hh = h * ww / w;
    y -= hh; page.drawImage(img, { x: thermal ? margin + (inner - ww) / 2 : margin, y, width: ww, height: hh }); y -= 3; } catch { /* WebP ou imagem inválida: segue sem logo */ } }
  para(doc.company.name, bold, size * 1.35, thermal);
  [doc.company.legalName !== doc.company.name ? doc.company.legalName : '', doc.company.document && `CNPJ ${doc.company.document}`, doc.branch.address || doc.company.address,
    [doc.branch.phone || doc.company.phone, doc.company.whatsapp && `WhatsApp ${doc.company.whatsapp}`].filter(Boolean).join(' · '), [doc.company.email, doc.company.website].filter(Boolean).join(' · '),
    doc.branch.name && `Filial: ${doc.branch.name}`].filter(Boolean).forEach(l => para(String(l), regular, size * 0.85, thermal));
  rule(thermal ? 0.8 : 2, accent);
  if (doc.header) para(doc.header, regular, size * 0.9, true);
  para(doc.title.toUpperCase(), bold, size * 1.2, thermal);
  para(`Nº ${doc.number}${doc.version > 1 ? ` · versão ${doc.version}` : ''}`, regular, size * 0.9, thermal);
  if (doc.subtitle) para(doc.subtitle, regular, size * 0.9, thermal);
  const block = (b: Block) => {
    switch (b.t) {
      case 'title': y -= 3; para(b.text.toUpperCase(), bold, size); rule(0.4); break;
      case 'kv': for (const [k, v] of b.rows) { const label = `${k}: `, lw = width(label, bold, size); const ls = wrap(v, regular, size, inner - lw);
        ls.forEach((l, i) => { need(lineH); y -= lineH; if (!i) text(label, margin, bold); text(l, margin + lw); }); } break;
      case 'table': { const cols = b.widths.map(w => w * inner); const cell = (cells: string[], f: PDFFont) => { const wrapped = cells.map((c, i) => wrap(c, f, size, cols[i] - 3)); const rows = Math.max(...wrapped.map(w => w.length));
          need(rows * lineH + 2); for (let r = 0; r < rows; r++) { y -= lineH; let x = margin; wrapped.forEach((w, i) => { const t = w[r] ?? ''; const tw = width(t, f, size);
            text(t, b.align[i] === 'r' ? x + cols[i] - tw - 1.5 : b.align[i] === 'c' ? x + (cols[i] - tw) / 2 : x + 1.5, f); x += cols[i]; }); } y -= 1.5; };
        if (thermal && b.head[1] === 'Qtd.') { rule(0.4); for (const r of b.rows) { para(r[0]); need(lineH); y -= lineH; text(`  ${r[1]} x ${r[2]}`, margin); text(r[3], W - margin - width(r[3], regular, size)); } rule(0.4); break; }
        cell(b.head, bold); page.drawLine({ start: { x: margin, y: y + 1 }, end: { x: W - margin, y: y + 1 }, thickness: 0.6 });
        if (!b.rows.length) cell(['Nenhum item.', ...b.head.slice(1).map(() => '')], regular); b.rows.forEach(r => cell(r, regular)); break; }
      case 'totals': for (const [k, v, strong] of b.rows) { const f = strong ? bold : regular, s = strong ? size * 1.15 : size; need(s * 1.4); y -= s * 1.4; const x0 = thermal ? margin : margin + inner * 0.45;
        text(k, x0, f, s); text(v, W - margin - width(v, f, s), f, s); } break;
      case 'text': para(b.text, b.strong ? bold : regular, b.small ? size * 0.85 : size); break;
      case 'checklist': for (const i of b.items) { need(lineH); y -= lineH; page.drawRectangle({ x: margin, y: y - 1, width: size * 0.9, height: size * 0.9, borderWidth: 0.6, borderColor: rgb(0, 0, 0) });
        if (i.checked) text('X', margin + 1.5, bold); text(i.label, margin + size * 1.6); } break;
      case 'signature': for (const l of b.labels) { need(lineH * 4); y -= lineH * 3; page.drawLine({ start: { x: margin + inner * 0.1, y }, end: { x: W - margin - inner * 0.1, y }, thickness: 0.6 }); y -= lineH;
        text(l, margin + (inner - width(l, regular, size * 0.85)) / 2, regular, size * 0.85); } break;
      case 'qr': { const q = qrcode(0, 'M'); q.addData(b.value); q.make(); const n = q.getModuleCount(), side = Math.min(26 * MM, inner * 0.5), m = side / n; need(side + lineH * 2); y -= side;
        const x0 = margin + (inner - side) / 2; for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) page.drawRectangle({ x: x0 + c * m, y: y + (n - 1 - r) * m, width: m, height: m, color: rgb(0, 0, 0) });
        para(b.caption, regular, size * 0.8, true); break; }
      case 'barcode': { const bars = code128(b.value), total = bars.reduce((s, w) => s + w, 0), bw = Math.min(inner, 60 * MM), unit = bw / total, h = 11 * MM; need(h + lineH * 2); y -= h;
        let x = margin + (inner - bw) / 2; bars.forEach((w, i) => { if (i % 2 === 0) page.drawRectangle({ x, y, width: w * unit, height: h, color: rgb(0, 0, 0) }); x += w * unit; });
        para(b.caption ?? b.value, regular, size * 0.8, true); break; }
    }
  };
  doc.blocks.forEach(block);
  if (doc.notices.length) { y -= 4; const ls = doc.notices.flatMap(n => wrap(n, bold, size * 0.85, inner - 8)); const h = ls.length * size * 1.15 + 6; need(h);
    page.drawRectangle({ x: margin, y: y - h, width: inner, height: h, borderWidth: 0.8, borderColor: rgb(0, 0, 0) }); y -= 3;
    for (const l of ls) { y -= size * 1.15; text(l, margin + (inner - width(l, bold, size * 0.85)) / 2, bold, size * 0.85); } y -= 4; }
  if (doc.footer) para(doc.footer, regular, size * 0.8, true);
  para(`Emitido em ${new Date(doc.issuedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })} · Tecnologia PISTEC`, regular, size * 0.75, true);
  // Bobina: recorta a página no comprimento usado. Páginas: numeração "x de n".
  if (thermal) { const used = H - y + margin + 6; page.setSize(W, used); page.translateContent(0, -(H - used)); }
  else pages.forEach((p, i) => p.drawText(`Página ${i + 1} de ${pages.length}`, { x: W - margin - 60, y: margin / 2, size: 7, font: regular, color: rgb(0.3, 0.3, 0.3) }));
  return pdf.save();
}
