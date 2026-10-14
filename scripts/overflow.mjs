// Diagnóstico: lista elementos mais largos que a viewport em cada rota.
import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://127.0.0.1:5173';
const routes = process.argv.slice(2);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
for (const route of routes) {
  await page.goto(base + route); await page.waitForLoadState('networkidle');
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => { const r = e.getBoundingClientRect(); return r.right > innerWidth + 1 && !e.closest('.table-wrap, .sidebar'); }).slice(0, 6).map(e => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().right)}`));
  console.log(route, JSON.stringify(wide));
}
await browser.close();
