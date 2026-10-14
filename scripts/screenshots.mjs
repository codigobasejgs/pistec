// Captura telas reais do app (dados demo) para a landing. Requer `npm run dev` ativo.
import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const base = process.env.BASE ?? 'http://127.0.0.1:5173';
const out = new URL('../public/screenshots/', import.meta.url);
await mkdir(out, { recursive: true });
const shots = [
  ['dashboard', 'dashboard'], ['pdv', 'pdv'], ['produtos', 'produtos'], ['estoque', 'estoque'], ['ordens-servico', 'ordens-servico'],
  ['financeiro', 'financeiro'], ['whatsapp', 'whatsapp'], ['relatorios', 'relatorios'], ['personalizacao', 'personalizacao'],
  ['crm', 'crm'], ['agenda', 'agenda'], ['minha-assinatura', 'assinatura'],
];
const browser = await chromium.launch({ channel: 'chrome' });
async function capture(viewport, suffix, list, prefix = '/loja/moto-prime/') {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2, locale: 'pt-BR', colorScheme: 'dark' });
  const page = await context.newPage();
  for (const [route, name] of list) {
    await page.goto(base + prefix + route); await page.locator('main h1').first().waitFor();
    await page.locator('.skeleton-page').waitFor({ state: 'detached' }); await page.waitForTimeout(700);
    await page.screenshot({ path: decodeURIComponent(new URL(`${name}${suffix}.png`, out).pathname.slice(1)) });
  }
  await context.close();
}
await capture({ width: 1600, height: 1000 }, '', shots);
await capture({ width: 390, height: 844 }, '-mobile', [['dashboard', 'dashboard'], ['pdv', 'pdv']]);
{ // Admin exige sessão demo: entra pelo seletor, como um usuário faria. SPA mantém sessão em memória.
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, locale: 'pt-BR' });
  const page = await context.newPage();
  await page.goto(`${base}/demonstracao`); await page.getByRole('button', { name: 'Entrar como Super Admin' }).click();
  await page.waitForURL('**/admin'); await page.waitForLoadState('networkidle'); await page.waitForTimeout(500);
  await page.screenshot({ path: decodeURIComponent(new URL('admin.png', out).pathname.slice(1)) });
  await context.close();
}
{ // Revisão visual (não vai para a landing): landing e tema claro.
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'pt-BR' });
  const page = await context.newPage();
  await page.goto(base + '/'); await page.waitForLoadState('networkidle');
  await page.screenshot({ path: decodeURIComponent(new URL('../../test-results/review-landing.png', out).pathname.slice(1)), fullPage: true });
  await page.goto(base + '/loja/moto-prime/dashboard'); await page.locator('main h1').waitFor();
  await page.getByRole('button', { name: 'Ativar tema claro' }).click(); await page.waitForTimeout(600);
  await page.screenshot({ path: decodeURIComponent(new URL('../../test-results/review-light.png', out).pathname.slice(1)) });
  await page.getByRole('button', { name: 'Ativar tema escuro' }).click(); await page.waitForTimeout(400);
  await context.close();
}
await browser.close();
console.log('Capturas PNG salvas; converta com scripts/assets.py --screenshots.');
