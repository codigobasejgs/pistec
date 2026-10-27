// Adaptador ESC/POS (impressoras térmicas de cupom). Gera bytes para envio por conector local (QZ Tray) — nunca pelo servidor.
// Texto em CP860 (português) ou CP850; caracteres fora da tabela viram equivalentes sem acento. Logo: raster monocromático (GS v 0).
import type { Block, Doc } from './model.ts';

const ESC = 0x1b, GS = 0x1d;
export type CodePage = 'cp860' | 'cp850';
// Tabelas parciais (0x80–0xFF) para os caracteres usados em português.
const CP: Record<CodePage, { n: number; map: Record<string, number> }> = {
  cp860: { n: 3, map: { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'ã': 0x84, 'à': 0x85, 'Á': 0x86, 'ç': 0x87, 'ê': 0x88, 'Ê': 0x89, 'è': 0x8a, 'Í': 0x8b, 'Ô': 0x8c, 'ì': 0x8d, 'Ã': 0x8e, 'Â': 0x8f, 'É': 0x90, 'À': 0x91, 'È': 0x92, 'ô': 0x93, 'õ': 0x94, 'ò': 0x95, 'Ú': 0x96, 'ù': 0x97, 'Ì': 0x98, 'Õ': 0x99, 'Ü': 0x9a, 'Ù': 0x9d, 'Ó': 0x9f, 'á': 0xa0, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'ñ': 0xa4, 'Ñ': 0xa5, 'ª': 0xa6, 'º': 0xa7, '°': 0xf8 } },
  cp850: { n: 2, map: { 'Ç': 0x80, 'ü': 0x81, 'é': 0x82, 'â': 0x83, 'à': 0x85, 'ç': 0x87, 'ê': 0x88, 'í': 0xa1, 'ó': 0xa2, 'ú': 0xa3, 'á': 0xa0, 'ã': 0xc6, 'Ã': 0xc7, 'õ': 0xe4, 'Õ': 0xe5, 'ô': 0x93, 'Ô': 0xe2, 'Á': 0xb5, 'Â': 0xb6, 'À': 0xb7, 'É': 0x90, 'Ê': 0xd2, 'Í': 0xd6, 'Ó': 0xe0, 'Ú': 0xe9, 'ª': 0xa6, 'º': 0xa7, '°': 0xf8 } },
};
export function encode(text: string, page: CodePage = 'cp860'): number[] {
  const map = CP[page].map;
  return [...text].map(c => { const code = c.charCodeAt(0); if (code < 0x80) return code; if (map[c] != null) return map[c];
    const plain = c.normalize('NFD').replace(/[̀-ͯ]/g, ''); return plain.length === 1 && plain.charCodeAt(0) < 0x80 ? plain.charCodeAt(0) : 0x3f; });
}
/** Quebra em linhas de `cols` colunas sem cortar palavras quando possível. */
export function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) { let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (word.length > cols) { if (line) { out.push(line); line = ''; } for (let i = 0; i < word.length; i += cols) out.push(word.slice(i, i + cols)); continue; }
      if ((line ? line.length + 1 : 0) + word.length > cols) { out.push(line); line = word; } else line = line ? `${line} ${word}` : word;
    }
    out.push(line);
  }
  return out;
}
const pair = (left: string, right: string, cols: number) => { const room = cols - right.length - 1; const l = wrap(left, Math.max(8, room)); const last = l.pop() ?? '';
  return [...l, last.padEnd(cols - right.length, ' ') + right]; };

/** Raster GS v 0 a partir de pixels já monocromáticos (1 = preto), largura múltipla de 8 após padding. */
export function raster(bits: Uint8Array, width: number, height: number): number[] {
  const bytesPerRow = Math.ceil(width / 8), out = [GS, 0x76, 0x30, 0, bytesPerRow & 255, bytesPerRow >> 8, height & 255, height >> 8];
  for (let y = 0; y < height; y++) for (let bx = 0; bx < bytesPerRow; bx++) { let b = 0; for (let k = 0; k < 8; k++) { const x = bx * 8 + k; if (x < width && bits[y * width + x]) b |= 0x80 >> k; } out.push(b); }
  return out;
}

export interface EscPosOptions { columns: number; codePage?: CodePage; cut?: boolean; logo?: { bits: Uint8Array; width: number; height: number } | null; qr?: boolean; drawer?: boolean }
/** Documento → comandos ESC/POS. QR via GS ( k (modelo 2), suportado pela maioria das térmicas recentes; desligável. */
export function toEscPos(doc: Doc, o: EscPosOptions): Uint8Array {
  const cols = o.columns, page = o.codePage ?? 'cp860', out: number[] = [ESC, 0x40, ESC, 0x74, CP[page].n];
  const text = (s: string) => out.push(...encode(s, page), 0x0a);
  const align = (n: 0 | 1 | 2) => out.push(ESC, 0x61, n), bold = (on: boolean) => out.push(ESC, 0x45, on ? 1 : 0), big = (on: boolean) => out.push(GS, 0x21, on ? 0x11 : 0);
  const rule = (c = '-') => text(c.repeat(cols));
  align(1);
  if (o.logo) { out.push(...raster(o.logo.bits, o.logo.width, o.logo.height)); out.push(0x0a); }
  bold(true); wrap(doc.company.name, cols).forEach(text); bold(false);
  [doc.company.document && `CNPJ ${doc.company.document}`, doc.branch.address || doc.company.address, doc.branch.phone || doc.company.phone, doc.branch.name && `Filial: ${doc.branch.name}`]
    .filter(Boolean).forEach(l => wrap(String(l), cols).forEach(text));
  if (doc.header) wrap(doc.header, cols).forEach(text);
  rule('='); bold(true); wrap(doc.title.toUpperCase(), cols).forEach(text); bold(false); text(`No ${doc.number}`); wrap(doc.subtitle, cols).forEach(text); rule('='); align(0);
  const block = (b: Block) => {
    switch (b.t) {
      case 'title': bold(true); wrap(b.text.toUpperCase(), cols).forEach(text); bold(false); break;
      case 'kv': b.rows.forEach(([k, v]) => wrap(`${k}: ${v}`, cols).forEach(text)); break;
      case 'table': b.rows.forEach(r => { if (r.length === 4 && b.head[1] === 'Qtd.') { wrap(r[0], cols).forEach(text); pair(`  ${r[1]} x ${r[2]}`, r[3], cols).forEach(text); }
        else wrap(r.filter(Boolean).join(' | '), cols).forEach(text); }); rule(); break;
      case 'totals': b.rows.forEach(([k, v, strong]) => { if (strong) { bold(true); } pair(k, v, cols).forEach(text); if (strong) bold(false); }); break;
      case 'text': if (b.strong) bold(true); wrap(b.text, cols).forEach(text); if (b.strong) bold(false); break;
      case 'checklist': b.items.forEach(i => wrap(`[ ] ${i.label}`, cols).forEach(text)); break;
      case 'signature': b.labels.forEach(l => { text(''); text(''); text('_'.repeat(cols)); align(1); wrap(l, cols).forEach(text); align(0); }); break;
      case 'qr': if (o.qr === false) { wrap(b.value, cols).forEach(text); break; } {
        const data = encode(b.value, page), len = data.length + 3; align(1);
        out.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0, GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 5, GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31,
          GS, 0x28, 0x6b, len & 255, len >> 8, 0x31, 0x50, 0x30, ...data, GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30, 0x0a);
        wrap(b.caption, cols).forEach(text); align(0); } break;
      case 'barcode': { const data = encode(b.value, page).slice(0, 60); align(1); out.push(GS, 0x68, 60, GS, 0x77, 2, GS, 0x48, 2, GS, 0x6b, 73, data.length + 2, 0x7b, 0x42, ...data, 0x0a); align(0); } break;
    }
  };
  doc.blocks.forEach(block);
  if (doc.notices.length) { rule(); align(1); bold(true); doc.notices.forEach(n => wrap(n, cols).forEach(text)); bold(false); align(0); }
  align(1); if (doc.footer) wrap(doc.footer, cols).forEach(text); text('Tecnologia PISTEC'); align(0); big(false);
  out.push(0x0a, 0x0a, 0x0a);
  if (o.drawer) out.push(ESC, 0x70, 0, 25, 250);
  if (o.cut !== false) out.push(GS, 0x56, 0x42, 0);
  return Uint8Array.from(out);
}
