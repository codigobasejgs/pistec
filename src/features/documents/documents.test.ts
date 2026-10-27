import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { buildDoc, DEFAULT_TEXTS, NON_FISCAL, TITLES, type DocType, type Snapshot } from '../../../supabase/functions/_shared/documents/model';
import { renderHtml } from '../../../supabase/functions/_shared/documents/html';
import { code128, isEan13, labelCode } from '../../../supabase/functions/_shared/documents/barcode';
import { encode, toEscPos, wrap } from '../../../supabase/functions/_shared/documents/escpos';
import { labelsHtml, productLabel, toEpl, toTspl, toZpl, workshopLabel } from '../../../supabase/functions/_shared/documents/labels';
import { PAPERS, paperOf, sheetSlots } from '../../../supabase/functions/_shared/documents/paper';
import { renderPdf } from './pdf';
import { pickPrinter, type PrinterProfile } from './service';

const company = { name: 'Moto Prime Peças', legalName: 'Moto Prime Comércio Ltda', document: '11222333000181', address: 'Rua A, 1', phone: '1133334444', whatsapp: '11999990000', email: 'loja@x.invalid', website: '', logo: '' };
const branch = { name: 'Filial Centro', document: '', address: 'Av. Filial, 50', phone: '1144445555' };
const longName = 'Kit transmissão completo corrente coroa pinhão reforçado com retentor original de fábrica para motocicletas de 150 a 160 cilindradas';
const base = (type: DocType, extra: Partial<Snapshot> = {}): Snapshot => ({ type, number: 'VEN-000001', issuedAt: '2026-10-28T13:00:00Z', copy: 1, version: 1, company, branch, texts: { ...DEFAULT_TEXTS, warranty: 'Garantia de 90 dias para os serviços.' }, ...extra });
const sale = { id: '0f8fad5b-d9cb-469f-a165-70867728950e', date: '2026-10-28T13:00:00Z', seller: 'Carlos', status: 'Concluída', discount: 500, surcharge: 0, total: 5490, change: 510,
  items: [{ name: 'Óleo 20W50 ação', quantity: 2, price: 2995, sku: 'OL-1' }], payments: [{ method: 'Pix', amount: 2000 }, { method: 'Dinheiro', amount: 3490, tendered: 4000 }] };
const os = { id: 'a1', kind: 'ordens-servico', title: 'OS 1042', status: 'Pronta', date: '2026-10-20T10:00:00Z', amount: 25000, fields: { technician: 'Paulo', complaint: 'Barulho na corrente', diagnosis: 'Kit gasto', labor: '80,00', checklist: 'Retrovisores; Capacete; Documento', mileage: '15200' },
  items: [{ name: longName, quantity: 1, price: 17000 }], history: [{ date: '2026-10-20T10:00:00Z', text: 'Aberta' }] };
const qr = (v: string) => `<svg data-qr="${v.length}"></svg>`;

describe('documentos: conteúdo vem do registro e nunca vira fiscal', () => {
  it('comprovante de venda: itens, desconto, pagamentos, troco, filial e aviso não fiscal', () => {
    const doc = buildDoc(base('sale', { sale, customer: { name: 'João' } }));
    const text = JSON.stringify(doc);
    for (const s of ['Óleo 20W50 ação', 'R$ 59,90', 'R$ 54,90', 'Troco', 'R$ 5,10', 'entregue R$ 40,00', 'Desconto']) expect(text).toContain(s);
    expect(doc.notices).toContain(NON_FISCAL);
    expect(text).not.toMatch(/NFC-e autorizada|DANFE|SEFAZ/);
  });
  it('2ª via e cancelamento são identificados; cancelamento exige venda cancelada', () => {
    expect(buildDoc(base('sale', { sale, copy: 2 })).notices[0]).toMatch(/2ª VIA/);
    expect(() => buildDoc(base('sale-cancel', { sale }))).toThrow(/não está cancelada/);
    expect(buildDoc(base('sale', { sale: { ...sale, status: 'Cancelada', cancelledAt: '2026-10-29T10:00:00Z' } })).notices.join()).toMatch(/CANCELADA/);
  });
  it('comprovante de pagamento não afirma confirmação bancária; prévia de carrinho diz que não foi concluída', () => {
    expect(buildDoc(base('payment', { sale })).notices.join()).toMatch(/Não substitui comprovante bancário/);
    expect(buildDoc(base('cart', { record: { ...os, kind: 'cart', title: 'Carrinho' } })).notices.join()).toMatch(/NÃO foi concluída/);
  });
  it('orçamento: aprovação não é presumida; OS concluída cita garantia legal; nenhum campo é inventado', () => {
    const quote = buildDoc(base('quote', { record: { ...os, kind: 'orcamentos', fields: { validUntil: '2026-11-05' } } }));
    expect(quote.notices.join()).toMatch(/não representa aceite/);
    expect(JSON.stringify(quote)).not.toContain('Técnico');
    const done = JSON.stringify(buildDoc(base('os-done', { record: os, vehicle: { title: 'CG 160', plate: 'ABC1D23' } })));
    expect(done).toContain('Código de Defesa do Consumidor'); expect(done).toContain('ABC1D23'); expect(done).toContain('R$ 250,00');
    const entry = buildDoc(base('os-entry', { record: os }));
    expect(entry.blocks.find(b => b.t === 'checklist')).toMatchObject({ items: [{ label: 'Retrovisores' }, { label: 'Capacete' }, { label: 'Documento' }] });
  });
  it('todos os tipos de documento têm título e montam sem erro com dados mínimos', () => {
    const snap = { sale, record: os, cash: { id: 'c', openedAt: '2026-10-28T08:00:00Z', opening: 10000, movements: [{ amount: -2000, reason: 'Sangria', date: '2026-10-28T12:00:00Z' }] },
      entry: { id: 'e', type: 'Receita', category: 'Vendas', description: 'Parcela', amount: 10000, dueDate: '2026-10-30', cancelled: false, settlementId: 's1', settlements: [{ id: 's1', amount: 4000, date: '2026-10-28', method: 'Pix', user: 'Ana', note: '' }] },
      stock: { rows: [{ sku: 'A', name: 'Filtro', location: 'P1', quantity: 3, reserved: 0 }] } };
    for (const t of Object.keys(TITLES) as DocType[]) { if (t === 'sale-cancel') continue; expect(() => buildDoc(base(t, snap)), t).not.toThrow(); }
    expect(JSON.stringify(buildDoc(base('settlement', snap)))).toContain('Saldo pendente');
  });
});

describe('HTML de impressão', () => {
  it('bobina 58/80 usa largura útil e @page sem altura; A4/A5 usam @page com margem; dados são escapados', () => {
    const doc = buildDoc(base('sale', { sale, customer: { name: '<script>alert(1)</script>' } }));
    const h58 = renderHtml(doc, paperOf('thermal-58'), { qr }), a5 = renderHtml(doc, paperOf('a5'), { qr });
    expect(h58).toContain('@page{size:58mm auto'); expect(h58).toContain('width:48mm');
    expect(a5).toContain('@page{size:148mm 210mm;margin:8mm}');
    expect(h58).not.toContain('<script>alert'); expect(h58).toContain('&lt;script&gt;');
    expect(renderHtml({ ...doc, company: { ...company, logo: 'javascript:alert(1)' } }, PAPERS[2], { qr })).not.toContain('javascript:');
  });
  it('documento extenso (200 itens, nome longo) não quebra e usa table-layout fixo', () => {
    const many = { ...sale, items: Array.from({ length: 200 }, (_, i) => ({ name: `${longName} ${i}`, quantity: 1, price: 100 })) };
    const html = renderHtml(buildDoc(base('sale', { sale: many })), paperOf('a4'), { qr });
    expect(html.match(/<tr>/g)!.length).toBeGreaterThan(200); expect(html).toContain('table-layout:fixed');
  });
});

describe('PDF', () => {
  it('A4 com várias páginas numeradas, acentos e metadados; bobina 80 mm recortada no conteúdo', async () => {
    const many = { ...sale, items: Array.from({ length: 120 }, (_, i) => ({ name: `Peça ção ${i} ${longName}`, quantity: i + 1, price: 990 })) };
    const a4 = await PDFDocument.load(await renderPdf(buildDoc(base('sale', { sale: many })), paperOf('a4')));
    expect(a4.getPageCount()).toBeGreaterThan(2); expect(a4.getTitle()).toBe('Comprovante de venda VEN-000001'); expect(a4.getAuthor()).toBe('Moto Prime Peças');
    const roll = await PDFDocument.load(await renderPdf(buildDoc(base('sale', { sale })), paperOf('thermal-80')));
    const { width, height } = roll.getPage(0).getSize();
    expect(Math.round(width / (72 / 25.4))).toBe(80); expect(height).toBeLessThan(2000); expect(height).toBeGreaterThan(150);
    const test = await PDFDocument.load(await renderPdf(buildDoc(base('test')), paperOf('a5')));
    expect(test.getPage(0).getSize().width).toBeCloseTo(148 * 72 / 25.4, 0);
  });
});

describe('códigos de barras', () => {
  it('EAN-13 só é usado quando o dígito verificador confere; senão Code 128 com o código interno', () => {
    expect(isEan13('7891234567895')).toBe(true); expect(isEan13('7891234567890')).toBe(false);
    expect(labelCode({ barcode: '7891234567895', sku: 'A' })).toEqual({ value: '7891234567895', kind: 'EAN-13' });
    expect(labelCode({ barcode: '7891234567890', sku: 'SKU-1' }).kind).toBe('Code 128');
    expect(labelCode({ barcode: '', sku: 'SKU-1' })).toEqual({ value: 'SKU-1', kind: 'Code 128' });
  });
  it('Code 128: estrutura válida (início, verificador, parada) e conjunto C para dígitos', () => {
    const bars = code128('PISTEC-123');
    expect(bars.slice(0, 6).join('')).toBe('211214'); // Start B
    expect(bars.slice(-7).join('')).toBe('2331112'); // Stop
    expect(code128('12345678').length).toBeLessThan(code128('ABCDEFGH').length);
    expect(() => code128('ção')).toThrow();
  });
});

describe('ESC/POS e etiquetas', () => {
  it('ESC/POS: inicializa, seleciona CP860, acentos convertidos, quebra em 32/48 colunas e corta', () => {
    const bytes = toEscPos(buildDoc(base('sale', { sale })), { columns: 32 });
    expect([...bytes.slice(0, 5)]).toEqual([0x1b, 0x40, 0x1b, 0x74, 3]);
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0]);
    expect(encode('ção', 'cp860')).toEqual([0x87, 0x84, 0x6f]);
    for (const line of wrap(longName, 32)) expect(line.length).toBeLessThanOrEqual(32);
    const drawer = toEscPos(buildDoc(base('sale', { sale })), { columns: 48, drawer: true, cut: false });
    expect([...drawer.slice(-5)]).toEqual([0x1b, 0x70, 0, 25, 250]);
  });
  const product = { name: 'Pastilha de freio dianteira', sku: 'PAS-01', barcode: '7891234567895', price: 4990, brand: 'Cobreq', category: 'Freios', location: 'A1' };
  const money = (c: number) => `R$ ${(c / 100).toFixed(2).replace('.', ',')}`;
  it('ZPL/TSPL/EPL usam o tamanho físico do papel e o código certo', () => {
    const l = [productLabel('price', product, { money })], paper = paperOf('label-40x30');
    const zpl = toZpl(l, paper); expect(zpl).toContain('^PW320'); expect(zpl).toContain('^LL240'); expect(zpl).toContain('^BEN'); expect(zpl).toContain('^CI28');
    expect(toZpl(l, paper, { dpi: 300 })).toContain('^PW472');
    const tspl = toTspl(l, paper, { calibration: { offsetX: 1, offsetY: 0, scale: 100, gap: 3, density: 8 } });
    expect(tspl).toContain('SIZE 40 mm, 30 mm'); expect(tspl).toContain('GAP 3 mm'); expect(tspl).toContain('DENSITY 8'); expect(tspl).toContain('EAN13');
    expect(toEpl(l, paper)).toContain('q320');
  });
  it('etiqueta de oficina não leva nome do cliente; folha A4 posiciona a partir da posição inicial', () => {
    const w = workshopLabel('os-key', { number: '1042', vehicle: 'CG 160', plate: 'ABC1D23', date: '28/10/2026' }, 'https://x/app/loja/a/ordens-servico?id=1');
    expect(JSON.stringify(w)).not.toMatch(/João/);
    const slots = sheetSlots({ columns: 3, rows: 10, top: 10, left: 5, labelWidth: 66, labelHeight: 25, gapX: 2, gapY: 0, start: 4 }, 2);
    expect(slots[0]).toEqual({ page: 0, x: 5, y: 35 }); expect(slots[1]).toEqual({ page: 0, x: 73, y: 35 });
    const html = labelsHtml([productLabel('barcode', product, { money })], paperOf('label-50x30'), { qr });
    expect(html).toContain('@page{size:50mm 30mm;margin:0}');
  });
});

describe('escolha de impressora', () => {
  const p = (x: Partial<PrinterProfile>): PrinterProfile => ({ id: x.id!, tenant_id: 't', branch_id: null, station: '', name: x.id!, kind: 'common', method: 'browser', protocol: 'none', device: '', model: '', paper_id: 'a4', custom: {}, calibration: {}, doc_types: [], copies: 1, is_default: false, test_result: '', ...x });
  it('prefere a impressora do tipo de documento nesta estação; ignora a de outra estação e de outra filial', () => {
    const list = [p({ id: 'escritorio' }), p({ id: 'caixa-1', station: 'Caixa 01', doc_types: ['sale'], kind: 'thermal' }), p({ id: 'outra-estacao', station: 'Caixa 02', doc_types: ['sale'] }), p({ id: 'outra-filial', branch_id: 'b2', doc_types: ['sale'] })];
    expect(pickPrinter(list, 'sale', 'b1', 'Caixa 01')!.id).toBe('caixa-1');
    expect(pickPrinter(list, 'sale', 'b1', 'Notebook')!.id).toBe('escritorio');
    expect(pickPrinter(list, 'quote', 'b1', 'Caixa 01')!.id).toBe('escritorio');
    expect(pickPrinter([], 'sale', 'b1')).toBeNull();
  });
});
