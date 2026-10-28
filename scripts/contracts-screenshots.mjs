// Capturas da página pública /contrato (desktop, tablet, 320px). Uso: node scripts/contracts-screenshots.mjs (com `npm run dev` ativo na 5173).
import { mkdirSync, readFileSync } from 'node:fs';
import { chromium } from '@playwright/test';

const minuta = JSON.parse(readFileSync('supabase/functions/_shared/contracts/minuta-2026-1.json', 'utf8'));
const terms = { code: minuta.code, title: minuta.body.title, status: 'draft', publishedAt: null, body: minuta.body,
  provider: { legal_name: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legal_nature: 'Empresário Individual', brand: 'PISTEC', address: 'Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160' } };
const out = 'docs/screenshots/contracts'; mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
for (const [name, width, height] of [['contrato-desktop', 1440, 900], ['contrato-tablet', 820, 1100], ['contrato-320', 320, 720], ['contrato-2560', 2560, 1300]]) {
  const page = await browser.newPage({ viewport: { width, height } });
  await page.route(/\/rest\/v1\/rpc\/contract_public_terms/, r => r.fulfill({ json: terms }));
  await page.goto('http://127.0.0.1:5173/contrato');
  await page.getByText('Minuta em revisão jurídica.').waitFor();
  await page.screenshot({ path: `${out}/${name}.png`, fullPage: name === 'contrato-desktop' || name === 'contrato-320' });
  await page.close();
}
await browser.close();
console.log('ok');
