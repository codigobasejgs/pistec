import { chromium } from '@playwright/test';
const base = process.env.BASE ?? 'http://127.0.0.1:5173';
const width = Number(process.argv[2] || 390);
const routes = process.argv.slice(3);
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width, height: 900 } });
for (const route of routes) {
  await page.goto(base + route); await page.waitForLoadState('networkidle');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  const wide = await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => {
    const r = e.getBoundingClientRect();
    return (r.right > innerWidth + 1.5 || r.width > innerWidth + 1.5) && !e.closest('.sidebar');
  }).slice(0, 5).map(e => `${e.tagName}.${(e.className || '').toString().slice(0, 30)} right=${Math.round(e.getBoundingClientRect().right)} w=${Math.round(e.getBoundingClientRect().width)}`));
  console.log(`@${width}px ${route}: scrollDelta=${overflow}px |`, JSON.stringify(wide));
}
await browser.close();
