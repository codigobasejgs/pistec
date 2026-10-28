// PDF do contrato (renderizado no SERVIDOR pela Edge Function contract-sign; o mesmo código gera a prévia no navegador).
// pdf-lib é injetado (Deno usa npm:pdf-lib, o navegador usa o pacote do Vite). Texto puro, sem HTML: nada do navegador vira cláusula.
import type { Filled } from './template.ts';
import { LOGO_PNG_BASE64, LOGO_SIZE } from './logo.ts';

// pdf-lib injetado: tipos frouxos de propósito (o mesmo arquivo compila no Deno com npm:pdf-lib e no Vite com pdf-lib).
// deno-lint-ignore no-explicit-any
type Lib = { PDFDocument: any; StandardFonts: any; rgb: (r: number, g: number, b: number) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
type Font = { widthOfTextAtSize(t: string, s: number): number };
// deno-lint-ignore no-explicit-any
type Page = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const MM = 72 / 25.4;
const clean = (s: string) => s.replace(/[−–—]/g, '-').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/•/g, '-').replace(/[^\t\n\x20-\x7e\xa0-\xff]/g, '?');
const b64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));

/** Gera o PDF com data de criação fixa (createdAt) para que o mesmo contrato gere sempre os mesmos bytes (hash reproduzível). */
export async function renderContractPdf(lib: Lib, f: Filled, meta: { number: string; createdAt: string }): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = lib;
  const pdf = await PDFDocument.create();
  const when = new Date(meta.createdAt);
  pdf.setTitle(`${f.title} — ${meta.number}`); pdf.setAuthor('PISTEC'); pdf.setCreator('PISTEC Contratos'); pdf.setProducer('PISTEC'); pdf.setCreationDate(when); pdf.setModificationDate(when);
  pdf.setSubject(f.footer); pdf.setKeywords([meta.number, 'contrato', 'PISTEC']);
  const reg = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const logo = await pdf.embedPng(b64(LOGO_PNG_BASE64));
  const W = 210 * MM, H = 297 * MM, M = 18 * MM, inner = W - 2 * M, navy = rgb(0.024, 0.106, 0.239), blue = rgb(0, 0.42, 0.85), grey = rgb(0.35, 0.38, 0.45);
  const pages: Page[] = []; let page!: Page, y = 0;
  const width = (t: string, font: Font, s: number) => font.widthOfTextAtSize(clean(t), s);
  const wrap = (t: string, font: Font, s: number, max: number) => { const out: string[] = [];
    for (const para of clean(t).split('\n')) { let line = '';
      for (const w of para.split(/\s+/).filter(Boolean)) { const next = line ? `${line} ${w}` : w; if (width(next, font, s) <= max) { line = next; continue; } if (line) out.push(line); line = w;
        while (width(line, font, s) > max && line.length > 1) { let k = line.length; while (k > 1 && width(line.slice(0, k), font, s) > max) k--; out.push(line.slice(0, k)); line = line.slice(k); } }
      out.push(line); }
    return out; };
  const newPage = () => { page = pdf.addPage([W, H]); pages.push(page); y = H - M;
    page.drawImage(logo, { x: M, y: H - M + 2, width: 30 * MM, height: 30 * MM * LOGO_SIZE.height / LOGO_SIZE.width });
    page.drawText(clean(meta.number), { x: W - M - width(meta.number, reg, 8), y: H - M + 8, size: 8, font: reg, color: grey });
    page.drawLine({ start: { x: M, y: H - M }, end: { x: W - M, y: H - M }, thickness: 1.2, color: blue }); y -= 6; };
  const need = (h: number) => { if (y - h < M + 14) newPage(); };
  const para = (t: string, font = reg, s = 9.5, color = rgb(0, 0, 0), indent = 0, center = false) => { for (const l of wrap(t, font, s, inner - indent)) { need(s * 1.4); y -= s * 1.4;
    page.drawText(l, { x: center ? M + (inner - width(l, font, s)) / 2 : M + indent, y, size: s, font, color }); } };
  newPage();
  y -= 4; para(f.title, bold, 13, navy, 0, true); para(f.subtitle, reg, 10, grey, 0, true); y -= 4;
  if (f.draftNotice) { const ls = wrap(f.draftNotice, bold, 9, inner - 10); const h = ls.length * 12 + 8; need(h); page.drawRectangle({ x: M, y: y - h, width: inner, height: h, color: rgb(1, 0.95, 0.85), borderColor: rgb(0.85, 0.45, 0), borderWidth: 1 });
    y -= 4; for (const l of ls) { y -= 12; page.drawText(l, { x: M + 5, y, size: 9, font: bold, color: rgb(0.6, 0.25, 0) }); } y -= 8; }
  y -= 4; para(f.summaryTitle, bold, 11, blue); y -= 2;
  for (const [k, v] of f.summary) { const kw = 50 * MM; const lines = wrap(v, reg, 9, inner - kw - 4); const h = Math.max(lines.length, wrap(k, bold, 8.5, kw - 6).length) * 12 + 6; need(h);
    page.drawRectangle({ x: M, y: y - h, width: inner, height: h, borderColor: rgb(0.8, 0.84, 0.9), borderWidth: 0.5 });
    page.drawRectangle({ x: M, y: y - h, width: kw, height: h, color: rgb(0.94, 0.96, 0.99) });
    let yy = y - 3; for (const l of wrap(k, bold, 8.5, kw - 6)) { yy -= 12; page.drawText(l, { x: M + 3, y: yy, size: 8.5, font: bold, color: navy }); }
    yy = y - 3; for (const l of lines) { yy -= 12; page.drawText(l, { x: M + kw + 4, y: yy, size: 9, font: reg }); } y -= h; }
  y -= 4; para(f.summaryNote, reg, 8.5, grey);
  for (const s of f.sections) { y -= 8; need(40); para(s.title, bold, 10.5, navy); y -= 2; for (const p of s.paragraphs) { para(p, reg, 9.5); y -= 3; } }
  y -= 10; need(120); para(f.signatureTitle, bold, 11, blue); y -= 2;
  for (const l of f.signatureBlock) { para(l, reg, 9); y -= 2; }
  y -= 4; para('As assinaturas eletrônicas, o certificado e a trilha de auditoria são aplicados pelo provedor de assinatura sobre este documento, sem alteração do seu conteúdo.', reg, 8, grey);
  pages.forEach((p, i) => p.drawText(clean(`${f.footer} · página ${i + 1} de ${pages.length}`), { x: M, y: M / 2, size: 7, font: reg, color: grey }));
  return pdf.save({ useObjectStreams: false });
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource)), b => b.toString(16).padStart(2, '0')).join('');
}
