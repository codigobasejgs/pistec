// Capturas reais das telas PISTEC NEXT na demonstração (dados fictícios, IndexedDB). Requer `npm run dev`.
// Prepara dados pela própria UI (veículo, check-in, pacote Moto Express, cotação) antes de capturar.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.BASE ?? 'http://127.0.0.1:5173', slug = 'moto-prime';
const out = new URL('../public/screenshots/', import.meta.url); await mkdir(out, { recursive: true });
const file = name => decodeURIComponent(new URL(`${name}.png`, out).pathname.slice(1));
const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: 'pt-BR', colorScheme: 'dark' });
const page = await context.newPage(); page.on('dialog', d => void d.accept());
const go = async route => { await page.goto(`${base}/loja/${slug}/${route}`); await page.locator('main h1').first().waitFor(); await page.locator('.skeleton-page').waitFor({ state: 'detached' }).catch(() => {}); await page.waitForTimeout(600); };
const shot = async name => { await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove())); await page.waitForTimeout(400); await page.screenshot({ path: file(name) }); console.log('ok', name); };

// Dados demonstrativos criados pela interface (nada sai do navegador).
await go('veiculos'); await page.getByRole('button', { name: 'Novo registro' }).click();
let d = page.getByRole('dialog'); await d.getByLabel('Título / nome').fill('Honda CG 160 Titan');
const customer = d.getByLabel('Cliente', { exact: true }); await customer.selectOption({ index: 1 }); const customerName = (await customer.locator('option:checked').textContent()).trim();
await d.getByLabel('Tipo', { exact: true }).selectOption('Moto'); await d.getByLabel('Placa').fill('PST1D23'); await d.getByLabel('Marca').fill('Honda'); await d.getByLabel('Modelo').fill('CG 160'); await d.getByLabel('Ano').fill('2022'); await d.getByLabel('Quilometragem').fill('18400');
await d.getByRole('button', { name: 'Salvar' }).click(); await d.waitFor({ state: 'hidden' });

await go('autopilot'); await shot('autopilot');
await go('checkin');
await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: customerName });
await page.getByRole('combobox', { name: 'Veículo', exact: true }).selectOption({ label: 'Honda CG 160 Titan · PST1D23' });
await page.getByLabel('Confirme a placa').fill('PST1D23'); await page.getByRole('spinbutton', { name: 'Quilometragem', exact: true }).fill('18520');
await page.getByLabel('Técnico responsável').fill('Rui (demonstração)'); await page.getByLabel('Previsão de entrega').fill('2099-01-10');
await page.getByLabel('Relato do cliente').fill('Barulho ao frear e revisão dos 18 mil km');
await page.getByLabel('Pneu dianteiro: estado').selectOption('Atenção'); await page.getByLabel('Pneu dianteiro: observação').fill('Desgaste irregular');
await page.getByLabel('Freio dianteiro: estado').selectOption('Não conforme');
await shot('checkin');
await page.getByLabel(/Atendimento rápido/).check(); await page.getByRole('button', { name: 'Registrar entrada' }).click(); await page.waitForURL(/ordens-servico/);

await go('moto-express'); await page.getByRole('button', { name: 'Gerenciar pacotes' }).click();
for (const name of ['Troca de óleo', 'Kit transmissão', 'Revisão básica']) {
  await page.getByRole('button', { name: 'Novo pacote' }).click(); const fs = page.locator('fieldset').last();
  await fs.getByLabel('Nome', { exact: true }).fill(name); await fs.getByLabel('Peça do pacote').selectOption({ index: 1 }); await fs.getByRole('button', { name: 'Adicionar', exact: true }).click();
}
await page.getByRole('button', { name: 'Salvar pacotes' }).click(); await page.getByRole('button', { name: 'Fechar pacotes' }).click();
await page.getByRole('combobox', { name: 'Cliente', exact: true }).selectOption({ label: customerName });
await page.getByRole('combobox', { name: 'Moto', exact: true }).selectOption({ label: 'Honda CG 160 Titan · PST1D23' });
await page.getByLabel('Quilometragem').fill('18520'); await page.getByLabel('Técnico').fill('Rui (demonstração)');
await page.getByRole('radio', { name: 'Troca de óleo' }).click(); await shot('moto-express');

await go('mecanico'); await shot('mecanico');
await go('estoque-inteligente'); await page.getByRole('button', { name: 'Todos' }).click(); await shot('estoque-inteligente');
await page.getByRole('button', { name: 'Sugestões de reposição' }).click();
if (await page.getByRole('button', { name: /Gerar cotação \([1-9]/ }).isEnabled().catch(() => false)) { await page.getByRole('button', { name: /Gerar cotação/ }).click(); await page.waitForURL(/cotacoes/); }
await go('cotacoes'); await shot('cotacoes');
await go('lucro-os'); await shot('lucro-os');
await go('fideliza'); await shot('fideliza');
await go('agenda'); await shot('agenda');
await go('garantias'); await shot('garantias');
await go('frotas'); await page.getByRole('button', { name: 'Novo registro' }).click();
d = page.getByRole('dialog'); await d.getByLabel('Título / nome').fill('Entregas Rápidas Ltda (demonstração)'); await d.getByLabel('CNPJ').fill('11.222.333/0001-81'); await d.getByLabel('Responsável pela frota').fill('Gestor de frota'); await d.getByLabel('Centro de custo').fill('Logística');
await d.getByRole('button', { name: 'Salvar' }).click(); await d.waitFor({ state: 'hidden' }); await shot('frotas');
await context.close();

// Portal do Cliente: renderizado com resposta fixa marcada como demonstração (o portal real exige token do servidor).
const portal = await browser.newContext({ viewport: { width: 430, height: 932 }, deviceScaleFactor: 2, locale: 'pt-BR' });
const p = await portal.newPage();
await p.route('**/rest/v1/rpc/portal_view', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ scope: 'record', expiresAt: '2099-01-10T00:00:00Z',
  company: { name: 'Moto Prime Peças (demonstração)', phone: '(11) 0000-0000', whatsapp: '', email: '', address: 'Endereço demonstrativo', logo: '', primary: '#007BFF' }, customer: null, vehicles: [], reminders: [],
  records: [{ id: 'r1', kind: 'orcamentos', title: 'Freios e revisão', status: 'Enviado', date: '2026-10-30', amount: 61000, validUntil: '2099-01-10', labor: 18000, terms: 'Valores válidos até a data indicada.', hash: 'x', photos: [], vehicle: { title: 'Honda CG 160', plate: 'PST1D23' },
    items: [{ productId: 'a', name: 'Pastilha de freio dianteira', quantity: 1, price: 9000 }, { productId: 'b', name: 'Óleo 10W30 1L', quantity: 1, price: 4000 }, { productId: 'c', name: 'Kit relação', quantity: 1, price: 30000 }] }] }) }));
await p.goto(`${base}/c/${'a'.repeat(48)}`); await p.getByRole('heading', { name: /Orçamento/ }).waitFor();
await p.getByRole('button', { name: 'Aprovar tudo' }).click(); await p.getByRole('group', { name: 'Decisão: 1× Kit relação' }).getByRole('button', { name: 'Recusar' }).click();
await p.waitForTimeout(300); await p.screenshot({ path: file('portal-orcamento'), fullPage: true }); console.log('ok portal-orcamento');
await portal.close();
await browser.close();
console.log('Converta com: python scripts/assets.py --screenshots');
