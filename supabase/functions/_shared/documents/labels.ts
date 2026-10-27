// Etiquetas: dados → HTML (navegador, folha A4 ou rolo) ou comandos ZPL / TSPL / EPL (via conector local).
// Etiquetas públicas não levam dados pessoais; QR interno aponta só para a rota autenticada do ERP.
import { esc } from './html.ts';
import { code128Svg, labelCode } from './barcode.ts';
import { dots, sheetSlots, type Calibration, type Paper, type Sheet } from './paper.ts';

export type LabelKind = 'price' | 'barcode' | 'shelf' | 'box' | 'internal' | 'promo' | 'inventory' | 'os-part' | 'os-key' | 'os-vehicle';
export interface Label { kind: LabelKind; title: string; lines: string[]; price?: string; promo?: string; code?: { value: string; kind: 'EAN-13' | 'Code 128' }; qr?: string }
export const LABEL_KINDS: Record<LabelKind, string> = {
  price: 'Preço', barcode: 'Código de barras', shelf: 'Prateleira', box: 'Caixa', internal: 'Identificação interna', promo: 'Promocional', inventory: 'Inventário',
  'os-part': 'Peça da OS', 'os-key': 'Chave do veículo', 'os-vehicle': 'Identificação do veículo',
};

export function productLabel(kind: LabelKind, p: { name: string; sku: string; barcode: string; price: number; brand: string; category: string; location: string }, extra: { promo?: string; money: (c: number) => string }): Label {
  const code = labelCode(p);
  const lines = kind === 'shelf' ? [p.brand, p.category, p.location && `Local: ${p.location}`] : kind === 'box' || kind === 'inventory' ? [`SKU ${p.sku}`, p.location && `Local: ${p.location}`] : [p.brand && `${p.brand} · ${p.sku}`, !p.brand ? p.sku : ''];
  return { kind, title: p.name, lines: lines.filter(Boolean) as string[], price: ['price', 'shelf', 'promo', 'barcode'].includes(kind) ? extra.money(p.price) : undefined, promo: kind === 'promo' ? extra.promo || 'OFERTA' : undefined, code };
}
/** Etiquetas de oficina: só número da OS, veículo/placa e peça. Nome do cliente fica de fora (etiqueta pode ficar visível). */
export function workshopLabel(kind: 'os-part' | 'os-key' | 'os-vehicle', os: { number: string; vehicle: string; plate?: string; technician?: string; part?: string; status?: string; date: string }, link: string): Label {
  return { kind, title: kind === 'os-key' ? `CHAVE · OS ${os.number}` : kind === 'os-vehicle' ? `OS ${os.number}` : os.part || `Peça · OS ${os.number}`,
    lines: [kind === 'os-part' ? `OS ${os.number}` : '', [os.vehicle, os.plate].filter(Boolean).join(' · '), os.technician && `Técnico: ${os.technician}`, os.status, os.date].filter(Boolean) as string[], qr: link };
}

export function labelsHtml(labels: Label[], paper: Paper, o: { qr: (v: string) => string; sheet?: Sheet | null; calibration?: Calibration }): string {
  const cal = o.calibration ?? { offsetX: 0, offsetY: 0, scale: 100, gap: 2 };
  const w = o.sheet ? o.sheet.labelWidth : paper.width, h = o.sheet ? o.sheet.labelHeight : paper.height ?? 30;
  const small = h < 25 || w < 35;
  const one = (l: Label) => `<div class="lb"><strong class="t">${esc(l.title)}</strong>${l.promo ? `<span class="promo">${esc(l.promo)}</span>` : ''}${l.lines.map(x => `<span class="l">${esc(x)}</span>`).join('')}
${l.price ? `<span class="p">${esc(l.price)}</span>` : ''}${l.code ? `<span class="bc">${code128Svg(l.code.value, 30, 1)}</span><span class="cv">${esc(l.code.value)}</span>` : ''}${l.qr ? `<span class="qr">${o.qr(l.qr)}</span>` : ''}</div>`;
  const base = `*{box-sizing:border-box}html,body{margin:0;font-family:Arial,sans-serif;color:#000;background:#fff}
.lb{width:${w}mm;height:${h}mm;padding:1mm;overflow:hidden;display:flex;flex-direction:column;justify-content:space-between;align-items:center;text-align:center;line-height:1.1;transform:translate(${cal.offsetX}mm,${cal.offsetY}mm) scale(${cal.scale / 100});transform-origin:top left}
.t{font-size:${small ? 6 : 8}pt;max-height:2.3em;overflow:hidden}.l{font-size:${small ? 5 : 6.5}pt}.p{font-size:${small ? 9 : 13}pt;font-weight:800}.promo{font-size:7pt;font-weight:800;border:1px solid #000;padding:0 3px}
.bc svg{width:${Math.min(w - 4, 50)}mm;height:${small ? 5 : 8}mm;display:block}.cv{font-size:5.5pt;letter-spacing:.5px}.qr svg{width:${Math.min(h - 10, 18)}mm;height:auto}`;
  if (o.sheet) {
    const s = o.sheet, slots = sheetSlots(s, labels.length), pages = Math.max(1, ...slots.map(x => x.page + 1));
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:${paper.width}mm ${paper.height}mm;margin:0}${base}
.sheet{position:relative;width:${paper.width}mm;height:${paper.height}mm;page-break-after:always;overflow:hidden}.sheet>div{position:absolute}@media screen{body{background:#e9edf3}.sheet{background:#fff;margin:8px auto;box-shadow:0 2px 8px rgba(0,0,0,.2)}.lb{outline:1px dashed #bbb}}</style></head><body>
${Array.from({ length: pages }, (_, pg) => `<section class="sheet">${labels.map((l, i) => slots[i].page === pg ? `<div style="left:${slots[i].x}mm;top:${slots[i].y}mm">${one(l)}</div>` : '').join('')}</section>`).join('')}</body></html>`;
  }
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Etiquetas</title><style>@page{size:${w}mm ${h}mm;margin:0}${base}
.lb{page-break-after:always}@media screen{body{background:#e9edf3;display:flex;flex-wrap:wrap;gap:${cal.gap}mm;padding:8px}.lb{background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.25)}}</style></head><body>${labels.map(one).join('')}</body></html>`;
}

/** ZPL (Zebra e compatíveis). ^CI28 = UTF-8; ^BC = Code 128; ^BE = EAN-13; ^BQ = QR. */
export function toZpl(labels: Label[], paper: Paper, o: { dpi?: number; calibration?: Calibration } = {}): string {
  const dpi = o.dpi ?? 203, w = dots(paper.width, dpi), h = dots(paper.height ?? 30, dpi), cal = o.calibration;
  const clean = (s: string) => s.replace(/[\^~]/g, ' ');
  return labels.map(l => { const lines: string[] = ['^XA', '^CI28', `^PW${w}`, `^LL${h}`, `^LH${dots(cal?.offsetX ?? 0, dpi)},${dots(cal?.offsetY ?? 0, dpi)}`, ...(cal?.density != null ? [`~SD${Math.max(0, Math.min(30, cal.density))}`] : []), ...(cal?.speed ? [`^PR${cal.speed}`] : [])];
    let y = dots(1.5, dpi); const fs = Math.max(18, Math.round(h / 9));
    lines.push(`^FO${dots(1, dpi)},${y}^A0N,${fs},${fs}^FB${w - dots(2, dpi)},2,0,C^FD${clean(l.title)}^FS`); y += fs * 2 + 4;
    for (const t of l.lines.slice(0, 2)) { lines.push(`^FO${dots(1, dpi)},${y}^A0N,${Math.round(fs * .75)},${Math.round(fs * .75)}^FB${w - dots(2, dpi)},1,0,C^FD${clean(t)}^FS`); y += Math.round(fs * .8); }
    if (l.price) { lines.push(`^FO${dots(1, dpi)},${y}^A0N,${fs * 1.6 | 0},${fs * 1.6 | 0}^FB${w - dots(2, dpi)},1,0,C^FD${clean(l.price)}^FS`); y += fs * 1.7 | 0; }
    const bh = Math.max(dots(5, dpi), h - y - fs - 6);
    if (l.code) lines.push(`^BY2,3,${bh}`, `^FO${dots(3, dpi)},${y}${l.code.kind === 'EAN-13' ? `^BEN,${bh},Y,N^FD${l.code.value.slice(0, 12)}^FS` : `^BCN,${bh},Y,N,N^FD${clean(l.code.value)}^FS`}`);
    else if (l.qr) lines.push(`^FO${(w - dots(16, dpi)) >> 1},${y}^BQN,2,${dpi >= 300 ? 4 : 3}^FDMA,${clean(l.qr)}^FS`);
    lines.push('^PQ1', '^XZ'); return lines.join('\n'); }).join('\n');
}

/** TSPL/TSPL2 (TSC, Argox em modo TSPL, Elgin L42 e outras). Texto ASCII (fonte interna); acentos removidos. */
export function toTspl(labels: Label[], paper: Paper, o: { calibration?: Calibration } = {}): string {
  const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/"/g, "'").replace(/[^\x20-\x7e]/g, '?');
  const w = dots(paper.width), cal = o.calibration;
  const head = [`SIZE ${paper.width} mm, ${paper.height ?? 30} mm`, `GAP ${cal?.gap ?? 2} mm, 0 mm`, 'DIRECTION 1', `REFERENCE ${dots(cal?.offsetX ?? 0)},${dots(cal?.offsetY ?? 0)}`, ...(cal?.density != null ? [`DENSITY ${Math.max(0, Math.min(15, cal.density))}`] : []), ...(cal?.speed ? [`SPEED ${cal.speed}`] : [])];
  return [...head, ...labels.flatMap(l => { const out = ['CLS']; let y = 8;
    out.push(`TEXT 8,${y},"2",0,1,1,"${ascii(l.title).slice(0, 40)}"`); y += 26;
    for (const t of l.lines.slice(0, 2)) { out.push(`TEXT 8,${y},"1",0,1,1,"${ascii(t).slice(0, 48)}"`); y += 18; }
    if (l.price) { out.push(`TEXT 8,${y},"3",0,1,1,"${ascii(l.price)}"`); y += 30; }
    if (l.code) out.push(`BARCODE 8,${y},"${l.code.kind === 'EAN-13' ? 'EAN13' : '128'}",${Math.max(32, dots(paper.height ?? 30) - y - 30)},1,0,2,2,"${ascii(l.code.value)}"`);
    else if (l.qr) out.push(`QRCODE ${(w >> 1) - 60},${y},M,3,A,0,"${ascii(l.qr)}"`);
    out.push('PRINT 1,1'); return out; })].join('\r\n') + '\r\n';
}

/** EPL2 (Zebra antigas LP/TLP, Argox em modo EPL). */
export function toEpl(labels: Label[], paper: Paper): string {
  const ascii = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/"/g, "'").replace(/[^\x20-\x7e]/g, '?');
  return labels.map(l => { const out = ['N', `q${dots(paper.width)}`, `Q${dots(paper.height ?? 30)},24`]; let y = 8;
    out.push(`A8,${y},0,3,1,1,N,"${ascii(l.title).slice(0, 36)}"`); y += 30;
    for (const t of l.lines.slice(0, 2)) { out.push(`A8,${y},0,2,1,1,N,"${ascii(t).slice(0, 44)}"`); y += 22; }
    if (l.price) { out.push(`A8,${y},0,4,1,1,N,"${ascii(l.price)}"`); y += 34; }
    if (l.code) out.push(`B8,${y},0,${l.code.kind === 'EAN-13' ? 'E30' : '1'},2,4,${Math.max(30, dots(paper.height ?? 30) - y - 26)},B,"${ascii(l.code.kind === 'EAN-13' ? l.code.value.slice(0, 12) : l.code.value)}"`);
    out.push('P1'); return out.join('\n'); }).join('\n') + '\n';
}
