// Renderização HTML de documentos: a mesma saída serve para prévia (iframe), impressão do navegador e página pública.
// Tudo que vem de dados passa por esc(). Sem scripts no HTML gerado.
import type { Block, Doc } from './model.ts';
import type { Calibration, Paper } from './paper.ts';
import { code128Svg } from './barcode.ts';

export const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const safeImg = (src: string) => /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(src) || /^\/(brand|icons)\/[\w./-]+$/.test(src) ? src : '';
export type TemplateStyle = 'elite' | 'minimal' | 'commercial' | 'workshop';
export interface HtmlOptions { qr: (value: string) => string; calibration?: Calibration; accent?: string; style?: TemplateStyle; logoSize?: number; align?: 'left' | 'center' }

function block(b: Block, o: HtmlOptions, thermal = false): string {
  // Bobina: item numa linha, "qtd x unitário ... total" na seguinte (colunas estreitas quebrariam valores).
  if (thermal && b.t === 'table' && b.head[1] === 'Qtd.') return `<div class="items">${b.rows.map(r => `<div class="it"><span>${esc(r[0])}</span><div><span>${esc(r[1])} x ${esc(r[2])}</span><strong>${esc(r[3])}</strong></div></div>`).join('') || '<p>Nenhum item.</p>'}</div>`;
  switch (b.t) {
    case 'title': return `<h3>${esc(b.text)}</h3>`;
    case 'kv': return b.rows.length ? `<dl class="kv">${b.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v).replace(/\n/g, '<br>')}</dd></div>`).join('')}</dl>` : '';
    case 'table': return `<table><colgroup>${b.widths.map(w => `<col style="width:${(w * 100).toFixed(1)}%">`).join('')}</colgroup><thead><tr>${b.head.map((h, i) => `<th class="${b.align[i]}">${esc(h)}</th>`).join('')}</tr></thead><tbody>${b.rows.map(r => `<tr>${r.map((c, i) => `<td class="${b.align[i]}">${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${b.head.length}" class="c">Nenhum item.</td></tr>`}</tbody></table>`;
    case 'totals': return `<dl class="totals">${b.rows.map(([k, v, strong]) => `<div class="${strong ? 'strong' : ''}"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`;
    case 'text': return `<p class="${b.small ? 'small' : ''}${b.strong ? ' strong' : ''}">${esc(b.text).replace(/\n/g, '<br>')}</p>`;
    case 'checklist': return `<ul class="check">${b.items.map(i => `<li><span class="box">${i.checked === true ? '✔' : i.checked === false ? '✘' : ''}</span>${esc(i.label)}</li>`).join('')}</ul>`;
    case 'signature': return `<div class="sign">${b.labels.map(l => `<div><span></span>${esc(l)}</div>`).join('')}</div>`;
    case 'qr': return `<figure class="qr">${o.qr(b.value)}<figcaption>${esc(b.caption)}</figcaption></figure>`;
    case 'barcode': return `<figure class="barcode">${code128Svg(b.value)}<figcaption>${esc(b.caption ?? b.value)}</figcaption></figure>`;
  }
}

/** Documento completo (HTML autocontido). Bobina: largura fixa, altura livre. Página: @page com margens. */
export function renderHtml(doc: Doc, paper: Paper, o: HtmlOptions): string {
  const cal = o.calibration ?? { offsetX: 0, offsetY: 0, scale: 100, gap: 2 };
  const thermal = paper.kind === 'thermal', accent = /^#[0-9a-f]{6}$/i.test(o.accent ?? '') ? o.accent! : '#0b57d0';
  const logo = safeImg(doc.company.logo), style = thermal ? 'thermal' : o.style ?? 'elite';
  const size = thermal ? `${paper.width}mm auto` : `${paper.width}mm ${paper.height}mm`;
  const base = thermal ? (paper.width <= 58 ? 8.5 : 10) : 10;
  const company = [doc.company.legalName && doc.company.legalName !== doc.company.name ? doc.company.legalName : '', doc.company.document && `CNPJ ${doc.company.document}`,
    doc.branch.address || doc.company.address, [doc.branch.phone || doc.company.phone, doc.company.whatsapp && `WhatsApp ${doc.company.whatsapp}`].filter(Boolean).join(' · '),
    [doc.company.email, doc.company.website].filter(Boolean).join(' · ')].filter(Boolean);
  const css = `@page{size:${size};margin:${thermal ? '0' : `${paper.margin}mm`}}
*{box-sizing:border-box}html,body{margin:0;background:#fff;color:#000;font-family:${thermal ? '"Courier New",monospace' : 'Inter,"Segoe UI",Arial,sans-serif'};font-size:${base}pt;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.doc{width:${thermal ? `${paper.printable}mm` : '100%'};margin:${thermal ? `0 ${(paper.width - paper.printable) / 2}mm` : '0'};padding:${thermal ? '2mm 0 6mm' : '0'};transform:translate(${cal.offsetX}mm,${cal.offsetY}mm) scale(${cal.scale / 100});transform-origin:top left}
header{display:flex;gap:10px;align-items:center;${thermal || o.align === 'center' ? 'flex-direction:column;text-align:center;' : ''}border-bottom:${style === 'minimal' ? '1px solid #999' : `3px solid ${thermal ? '#000' : accent}`};padding-bottom:6px;margin-bottom:8px}
header img{max-height:${thermal ? 18 : o.logoSize ?? 18}mm;max-width:${thermal ? paper.printable * 0.7 : 60}mm;object-fit:contain;${thermal ? 'filter:grayscale(1) contrast(1.6)' : ''}}
header h1{font-size:1.35em;margin:0}header p{margin:1px 0;font-size:.82em;color:#333}
.head-note{font-size:.85em;margin:4px 0;text-align:center}
.doc-title{display:flex;justify-content:space-between;align-items:baseline;gap:8px;flex-wrap:wrap;margin:6px 0}${thermal ? '.doc-title{flex-direction:column;align-items:center;text-align:center}' : ''}
.doc-title h2{font-size:1.15em;margin:0;text-transform:uppercase;letter-spacing:.03em;color:${thermal || style === 'minimal' ? '#000' : accent}}.doc-title span{font-size:.85em}
.sub{font-size:.85em;margin:0 0 6px;${thermal ? 'text-align:center' : ''}}
h3{font-size:.95em;margin:10px 0 4px;text-transform:uppercase;border-bottom:1px solid #ccc;padding-bottom:2px}
.kv{display:grid;grid-template-columns:${thermal ? '1fr' : 'repeat(2,minmax(0,1fr))'};gap:2px 14px;margin:4px 0}.kv div{display:flex;gap:6px;min-width:0}.kv dt{font-weight:700;white-space:nowrap}.kv dd{margin:0;overflow-wrap:anywhere}
table{width:100%;border-collapse:collapse;table-layout:fixed;margin:6px 0}th,td{padding:${thermal ? '1px 0' : '3px 4px'};vertical-align:top;overflow-wrap:anywhere}th{border-bottom:1px solid #000;font-size:.85em;text-align:left}
${thermal ? '' : `tbody tr:nth-child(even){background:${style === 'minimal' ? '#fff' : '#f3f6fb'}}`}td{border-bottom:1px dotted #bbb}.r{text-align:right}.c{text-align:center}
.totals{margin:6px 0 6px auto;width:${thermal ? '100%' : '55%'}}.totals div{display:flex;justify-content:space-between;padding:1px 0}.totals .strong{font-weight:800;font-size:1.15em;border-top:1px solid #000}
.totals dd,.totals dt{margin:0}p{margin:4px 0;line-height:1.35}.small{font-size:.8em;color:#333}.strong{font-weight:700}
.check{list-style:none;padding:0;columns:${thermal ? 1 : 2};margin:4px 0}.check li{margin:2px 0;break-inside:avoid}.box{display:inline-block;width:3.2mm;height:3.2mm;border:1px solid #000;margin-right:5px;vertical-align:-2px;font-size:8pt;line-height:3mm;text-align:center}
.sign{display:flex;gap:16px;flex-wrap:wrap;margin:${thermal ? 10 : 18}mm 0 4mm}.sign div{flex:1;min-width:${thermal ? '100%' : '40%'};text-align:center;font-size:.85em}.sign span{display:block;border-top:1px solid #000;margin-bottom:2px}
figure{margin:6px auto;text-align:center;break-inside:avoid}figure svg{width:${thermal ? '30mm' : '28mm'};height:auto}figure.barcode svg{width:${thermal ? '90%' : '60mm'};height:12mm}figcaption{font-size:.75em}
.notices{margin-top:8px;border:1px solid #000;padding:4px 6px;font-size:.8em;font-weight:700;text-align:center}.notices p{margin:2px 0}
.items{border-top:1px solid #000;border-bottom:1px solid #000;margin:6px 0;padding:2px 0}.it{padding:2px 0;border-bottom:1px dotted #999}.it:last-child{border:0}.it>div{display:flex;justify-content:space-between;gap:8px;white-space:nowrap}
footer{margin-top:6px;font-size:.75em;text-align:center;color:#333}tr,.kv div,.totals{break-inside:avoid}
@media screen{body{background:#e9edf3;padding:12px}.doc{background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.15);padding:${thermal ? '3mm' : `${paper.margin}mm`};${thermal ? `width:${paper.width}mm;margin:0 auto` : `max-width:${paper.width}mm;margin:0 auto;min-height:${paper.height ?? 0}mm`}}}`;
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(doc.title)} ${esc(doc.number)}</title><style>${css}</style></head><body><main class="doc">
<header>${logo ? `<img src="${esc(logo)}" alt="">` : ''}<div><h1>${esc(doc.company.name)}</h1>${company.map(c => `<p>${esc(c)}</p>`).join('')}${doc.branch.name ? `<p>Filial: ${esc(doc.branch.name)}${doc.branch.document ? ` · CNPJ ${esc(doc.branch.document)}` : ''}</p>` : ''}</div></header>
${doc.header ? `<p class="head-note">${esc(doc.header)}</p>` : ''}<div class="doc-title"><h2>${esc(doc.title)}</h2><span>Nº ${esc(doc.number)}${doc.version > 1 ? ` · versão ${doc.version}` : ''}</span></div><p class="sub">${esc(doc.subtitle)}</p>
${doc.blocks.map(b => block(b, o, thermal)).join('\n')}
${doc.notices.length ? `<section class="notices">${doc.notices.map(n => `<p>${esc(n)}</p>`).join('')}</section>` : ''}
<footer>${doc.footer ? `${esc(doc.footer)}<br>` : ''}Emitido em ${esc(new Date(doc.issuedAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }))} · Tecnologia PISTEC</footer></main></body></html>`;
}
