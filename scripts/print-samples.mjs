// Gera PDFs, HTML e comandos de exemplo (dados de amostra marcados) + capturas da Central de Impressão (demo).
// Uso: npm run dev (5173) e node scripts/print-samples.mjs   → docs/print-samples/ e docs/screenshots/print/
import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173', OUT = 'docs/print-samples', SHOTS = 'docs/screenshots/print';
mkdirSync(OUT, { recursive: true }); mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
await page.goto(`${BASE}/loja/moto-prime/dashboard`); await page.locator('main h1').first().waitFor();

// Amostras geradas pelos mesmos módulos usados no app (carregados pelo Vite).
const samples = await page.evaluate(async () => {
  const m = await import('/supabase/functions/_shared/documents/model.ts');
  const h = await import('/supabase/functions/_shared/documents/html.ts');
  const pp = await import('/supabase/functions/_shared/documents/paper.ts');
  const lb = await import('/supabase/functions/_shared/documents/labels.ts');
  const ep = await import('/supabase/functions/_shared/documents/escpos.ts');
  const { renderPdf } = await import('/src/features/documents/pdf.ts');
  const { qrSvg } = await import('/src/features/documents/service.ts');
  const company = { name: 'Moto Prime Peças (AMOSTRA)', legalName: 'Moto Prime Comércio de Peças Ltda', document: '00.000.000/0001-00', address: 'Rua Exemplo, 100 - Centro - São Paulo/SP', phone: '(11) 0000-0000', whatsapp: '(11) 90000-0000', email: 'contato@exemplo.invalid', website: '', logo: '' };
  const branch = { name: 'Matriz • Centro', document: '', address: 'Rua Exemplo, 100', phone: '(11) 0000-0000' };
  const texts = { ...m.DEFAULT_TEXTS, footer: 'Amostra gerada para validação de layout.', warranty: 'Exemplo: garantia comercial de 90 dias para serviços executados.' };
  const base = (type, extra = {}) => ({ type, number: 'AMOSTRA-0001', issuedAt: new Date().toISOString(), copy: 1, version: 1, company, branch, texts, ...extra });
  const longName = 'Kit transmissão completo corrente coroa pinhão reforçado com retentor para 150/160 cc';
  const sale = { id: 'a6f1c2d3-0000-4000-8000-000000000001', date: new Date().toISOString(), seller: 'Operador', status: 'Concluída', discount: 500, surcharge: 0, total: 25390, change: 610,
    items: [{ name: 'Óleo 20W50 4T 1L', quantity: 2, price: 3290, sku: 'OL-20W50' }, { name: longName, quantity: 1, price: 19310, sku: 'KIT-TR-160' }], payments: [{ method: 'Pix', amount: 10000 }, { method: 'Dinheiro', amount: 15390, tendered: 16000 }] };
  const os = { id: 'x', kind: 'ordens-servico', title: 'OS 1042', status: 'Pronta', date: new Date().toISOString(), amount: 27310, fields: { technician: 'Técnico', complaint: 'Ruído na transmissão', diagnosis: 'Kit de transmissão gasto', labor: '80,00', checklist: 'Retrovisores; Capacete; Documento do veículo; Chave reserva', mileage: '15.200' }, items: sale.items, history: [] };
  const many = { ...sale, items: Array.from({ length: 90 }, (_, i) => ({ name: `Item ${i + 1} — ${longName}`, quantity: i % 5 + 1, price: 990 + i * 10 })) };
  const docs = [['venda-80mm', base('sale', { sale, customer: { name: 'Cliente Exemplo' } }), 'thermal-80'], ['venda-58mm', base('sale', { sale }), 'thermal-58'], ['venda-2via-a4', base('sale', { sale, copy: 2 }), 'a4'],
    ['orcamento-a4', base('quote', { record: { ...os, kind: 'orcamentos', status: 'Aberto', fields: { validUntil: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10), labor: '80,00' } }, customer: { name: 'Cliente Exemplo' }, vehicle: { title: 'Honda CG 160', plate: 'ABC1D23' }, link: 'https://pistec.vercel.app/d/exemplo' }), 'a4'],
    ['os-entrada-a4', base('os-entry', { record: os, customer: { name: 'Cliente Exemplo', phone: '(11) 90000-0000' }, vehicle: { title: 'Honda CG 160', plate: 'ABC1D23', mileage: '15.200' } }), 'a4'],
    ['os-conclusao-a5', base('os-done', { record: os, vehicle: { title: 'Honda CG 160', plate: 'ABC1D23' } }), 'a5'], ['termo-entrega-a4', base('os-delivery', { record: os, customer: { name: 'Cliente Exemplo' } }), 'a4'],
    ['garantia-a5', base('warranty', { record: os }), 'a5'], ['documento-extenso-a4', base('sale', { sale: many }), 'a4'], ['pagina-teste-a4', base('test'), 'a4']];
  const out = {};
  for (const [name, snap, paperId] of docs) { const doc = m.buildDoc(snap), paper = pp.paperOf(paperId);
    out[`${name}.pdf`] = Array.from(await renderPdf(doc, paper)); out[`${name}.html`] = h.renderHtml(doc, paper, { qr: qrSvg }); }
  const product = { name: 'Pastilha de freio dianteira', sku: 'PAS-01', barcode: '7891234567895', price: 4990, brand: 'Marca', category: 'Freios', location: 'A1' };
  const money = c => (c / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const labels = ['price', 'barcode', 'shelf'].map(k => lb.productLabel(k, product, { money }));
  for (const id of ['label-40x30', 'label-50x30', 'label-100x150']) { const p = pp.paperOf(id); out[`etiquetas-${id}.html`] = lb.labelsHtml(labels, p, { qr: qrSvg });
    out[`etiquetas-${id}.zpl`] = lb.toZpl(labels, p); out[`etiquetas-${id}.tspl`] = lb.toTspl(labels, p); }
  out['venda-80mm.escpos.bin'] = Array.from(ep.toEscPos(m.buildDoc(base('sale', { sale })), { columns: 48 }));
  return out;
});
for (const [name, data] of Object.entries(samples)) writeFileSync(`${OUT}/${name}`, Array.isArray(data) ? Buffer.from(data) : data);
console.log(Object.keys(samples).length, 'amostras');

// Capturas das telas (demo).
const shot = async (name, fn, vp) => { if (vp) await page.setViewportSize(vp); await fn(); await page.waitForTimeout(700); await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
await shot('desktop-central-impressoras', async () => { await page.goto(`${BASE}/loja/moto-prime/impressao`); await page.getByRole('button', { name: 'Configurar impressora' }).click(); await page.getByRole('button', { name: /Térmica de cupom/ }).click(); });
await shot('desktop-etiquetas', async () => { await page.getByRole('button', { name: 'Etiquetas', exact: true }).click(); for (const s of (await page.getByRole('spinbutton', { name: /Quantidade de etiquetas/ }).all()).slice(0, 3)) await s.fill('2'); });
await shot('desktop-modelos', async () => { await page.getByRole('button', { name: 'Modelos e identidade' }).click(); });
await shot('desktop-documento-venda', async () => {
  await page.goto(`${BASE}/loja/moto-prime/pdv`); await page.getByRole('button', { name: 'Adicionar', exact: true }).first().click(); await page.getByRole('button', { name: /^Cobrar/ }).click();
  await page.getByRole('button', { name: 'Completar', exact: true }).click(); await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await page.getByRole('button', { name: /Imprimir · WhatsApp/ }).click(); await page.getByRole('dialog', { name: 'Documento' }).waitFor(); });
await shot('desktop-documento-a4', async () => { await page.getByRole('dialog', { name: 'Documento' }).getByLabel('Papel').selectOption('a4'); });
await shot('desktop-os-garantia', async () => { await page.goto(`${BASE}/loja/moto-prime/ordens-servico`); await page.getByRole('button', { name: 'Tabela', exact: true }).click(); await page.getByRole('button', { name: /^Detalhes de / }).first().click();
  await page.getByRole('button', { name: 'Documentos e impressão' }).click(); await page.getByRole('dialog', { name: 'Documento' }).getByLabel('Documento').selectOption('os-entry'); });
await shot('mobile-central', async () => { await page.goto(`${BASE}/loja/moto-prime/impressao`); }, { width: 390, height: 844 });
await shot('mobile-documento', async () => { await page.goto(`${BASE}/loja/moto-prime/vendas`); await page.getByRole('button', { name: /^Detalhes da venda/ }).first().click(); await page.getByRole('button', { name: /^Documentos:/ }).click(); await page.getByRole('dialog', { name: 'Documento' }).waitFor(); });
await shot('tablet-etiquetas', async () => { await page.goto(`${BASE}/loja/moto-prime/impressao`); await page.getByRole('button', { name: 'Etiquetas', exact: true }).click(); }, { width: 820, height: 1180 });
console.log('rolagem horizontal (tablet):', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
await browser.close();
