// Capturas do PDV Elite e do Meu Aplicativo (dados demo). Requer `npm run dev` em 5173.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173', OUT = 'docs/screenshots/pdv'; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const [vw, width, height] of [['desktop', 1440, 900], ['tablet', 820, 1180], ['mobile', 390, 844]]) {
  const page = await browser.newPage({ viewport: { width, height }, locale: 'pt-BR' });
  await page.goto(`${BASE}/loja/moto-prime/pdv`); await page.getByRole('heading', { name: 'Frente de caixa' }).waitFor();
  for (const b of await page.getByRole('button', { name: 'Adicionar', exact: true }).all().then(l => l.slice(0, 2))) await b.click();
  await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/${vw}-pdv.png` });
  if (vw === 'mobile') { await page.getByRole('button', { name: /^2\. Carrinho/ }).click(); await page.screenshot({ path: `${OUT}/mobile-carrinho.png`, fullPage: true }); }
  await page.getByRole('button', { name: /^Cobrar/ }).click(); await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill('500,00');
  await page.waitForTimeout(300); await page.screenshot({ path: `${OUT}/${vw}-pagamento.png` });
  if (vw === 'desktop') {
    await page.getByRole('button', { name: 'Finalizar venda' }).click(); await page.getByRole('dialog', { name: 'Venda concluída' }).waitFor(); await page.screenshot({ path: `${OUT}/desktop-recibo.png` });
    await page.goto(`${BASE}/loja/moto-prime/personalizacao`); await page.getByRole('heading', { name: 'Meu Aplicativo' }).scrollIntoViewIfNeeded();
    await page.getByLabel('Logotipo').setInputFiles('public/icons/icon-512x512.png'); await page.getByRole('button', { name: 'Gerar ícones do logotipo' }).click();
    await page.getByRole('heading', { name: 'Meu Aplicativo' }).scrollIntoViewIfNeeded(); await page.waitForTimeout(400); await page.screenshot({ path: `${OUT}/desktop-meu-aplicativo.png` });
  }
  console.log(vw, 'ok, rolagem horizontal:', await page.evaluate(() => document.documentElement.scrollWidth - innerWidth));
  await page.close();
}
await browser.close();
