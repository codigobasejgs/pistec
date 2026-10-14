// Confere se todas as capturas da landing carregam após rolagem (lazy-load).
import { chromium } from '@playwright/test';
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://127.0.0.1:5173/');
for (let y = 0; y < 9000; y += 600) { await page.mouse.wheel(0, 600); await page.waitForTimeout(120); }
await page.waitForLoadState('networkidle');
const images = await page.$$eval('img[src^="/screenshots/"]', list => list.map(i => `${i.getAttribute('src')} ${i.naturalWidth}`));
console.log(images.join('\n'), '\nfallbacks:', await page.locator('.pub-shot-fallback').count());
await page.screenshot({ path: 'test-results/review-gallery.png' });
await browser.close();
