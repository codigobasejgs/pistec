import { execSync, spawn, type ChildProcess } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// Roda contra o build de produção (o SW só registra em PROD). Porta própria para não colidir com o dev server.
const PORT = 4174; const BASE = `http://127.0.0.1:${PORT}`;
let server: ChildProcess;
const startPreview = async () => {
  server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) return; } catch { /* aguardando */ } await new Promise(r => setTimeout(r, 500)); }
  throw new Error('preview não subiu');
};
const stopPreview = () => { if (server?.pid) { try { execSync(process.platform === 'win32' ? `taskkill /pid ${server.pid} /T /F` : `kill ${server.pid}`, { stdio: 'ignore' }); } catch { /* já encerrado */ } } };

test.describe.configure({ mode: 'serial' });
test.beforeAll(async () => { execSync('npx vite build', { stdio: 'ignore' }); await startPreview(); });
test.afterAll(() => stopPreview());

test('manifest válido, ícones acessíveis e service worker controlando a página', async ({ page }) => {
  const manifest = await (await fetch(`${BASE}/manifest.webmanifest`)).json();
  expect(manifest).toMatchObject({ name: expect.stringContaining('PISTEC'), short_name: 'PISTEC', display: 'standalone', start_url: '/demonstracao', scope: '/' });
  const sizes = manifest.icons.map((i: { sizes: string; purpose?: string }) => `${i.sizes}${i.purpose === 'maskable' ? 'm' : ''}`);
  expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512', '192x192m', '512x512m']));
  for (const icon of manifest.icons) expect((await fetch(BASE + icon.src)).headers.get('content-type')).toContain('image/png');
  await page.goto(`${BASE}/demonstracao`);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null || navigator.serviceWorker.ready.then(() => true), null, { timeout: 15000 });
  await page.reload(); // primeira visita instala; a partir da segunda o SW controla
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => document.querySelector('link[rel=manifest]')?.getAttribute('href'))).toBe('/manifest.webmanifest');
});

test('offline: telas já instaladas abrem e dados locais persistem', async ({ page, context }) => {
  await page.goto(`${BASE}/loja/moto-prime/dashboard`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  await expect(page.locator('main h1')).toContainText('Olá');
  await context.setOffline(true);
  await page.goto(`${BASE}/loja/moto-prime/produtos`); // rota nunca visitada nesta sessão: chunk vem do precache
  await expect(page.locator('main h1')).toHaveText('Produtos');
  await expect(page.getByRole('status').filter({ hasText: 'Sem conexão com o servidor' })).toBeVisible();
  await page.goto(`${BASE}/loja/moto-prime/financeiro`);
  await expect(page.locator('main h1')).toBeVisible();
  const pill = page.getByRole('status').filter({ hasText: 'Sem conexão com o servidor' });
  // Verificação manual ainda offline mantém o aviso. Clicar depois de reconectar disputa com o evento `online`.
  await page.getByRole('button', { name: 'Verificar conexão' }).click();
  await expect(pill).toBeVisible();
  await context.setOffline(false); // evento `online` reverifica sozinho
  await expect(pill).toHaveCount(0);
});

test('push: o service worker do PWA exibe a notificação recebida e só abre rotas internas', async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin: BASE });
  await page.goto(`${BASE}/demonstracao`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // Dispara um PushEvent real dentro do service worker (o mesmo handler que o push service aciona).
  // Chrome headless aceita showNotification mas não lista em getNotifications(): a chamada é registrada no próprio SW.
  const sw = context.serviceWorkers().find(w => w.url().endsWith('/sw.js')) ?? await context.waitForEvent('serviceworker');
  await sw.evaluate(() => {
    const g = self as unknown as { registration: ServiceWorkerRegistration; __shown: unknown[] };
    g.__shown = [];
    const original = g.registration.showNotification.bind(g.registration);
    g.registration.showNotification = (title: string, options?: NotificationOptions) => { g.__shown.push({ title, body: options?.body, url: (options?.data as { url: string }).url }); return original(title, options); };
  });
  const deliver = (data: object) => sw.evaluate(async payload => {
    const PushEvent = (globalThis as unknown as { PushEvent: new (t: string, i: { data: string }) => Event }).PushEvent;
    self.dispatchEvent(new PushEvent('push', { data: payload }));
    await new Promise(r => setTimeout(r, 100));
  }, JSON.stringify(data));
  const shown = () => sw.evaluate(() => (self as unknown as { __shown: { title: string; body: string; url: string }[] }).__shown);
  await deliver({ title: 'Estoque baixo', body: 'Abra o PISTEC para ver os detalhes.', url: '/app/loja/x/notificacoes', tag: 'stock.low' });
  await expect.poll(shown).toEqual([{ title: 'Estoque baixo', body: 'Abra o PISTEC para ver os detalhes.', url: '/app/loja/x/notificacoes' }]);
  await deliver({ title: 'Phishing', url: 'https://evil.example/login', tag: 'x' });
  await expect.poll(async () => (await shown()).find(n => n.title === 'Phishing')?.url).toBe('/app'); // URL externa vira /app
});

test('atualização A→B: aviso discreto, nada recarrega sozinho, dados preservados', async ({ page }) => {
  await page.goto(`${BASE}/loja/moto-prime/configuracoes`);
  await page.waitForFunction(() => !!navigator.serviceWorker.controller);
  // Dado local da versão A.
  await page.getByLabel('CNPJ demonstrativo').fill('12345678000199');
  await page.getByLabel('Observações operacionais').fill('Nota gravada na versão A');
  await page.getByRole('button', { name: 'Salvar configurações' }).click();
  await expect(page.getByText('Dados da empresa atualizados.')).toBeVisible();
  // Publica a versão B: muda um byte servido -> nova versão do SW.
  const originalHtml = readFileSync('dist/index.html', 'utf8');
  const originalSw = readFileSync('dist/sw.js', 'utf8');
  stopPreview();
  writeFileSync('dist/index.html', originalHtml.replace('</body>', '<!-- versao B --></body>'));
  writeFileSync('dist/sw.js', originalSw.replace(/const VERSION = "[^"]+"/, 'const VERSION = "versao-b"'));
  await startPreview();
  try {
    let reloaded = false; page.on('load', () => { reloaded = true; });
    await page.evaluate(() => navigator.serviceWorker.getRegistration().then(r => r?.update()));
    await expect(page.getByRole('status', { name: 'Nova versão disponível' })).toBeVisible({ timeout: 15000 });
    expect(reloaded).toBe(false); // não interrompe quem está trabalhando
    await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Atualizar agora' }).click()]);
    await expect(page.getByLabel('Observações operacionais')).toHaveValue('Nota gravada na versão A');
    expect(await page.evaluate(() => caches.keys())).toEqual(['pistec-versao-b']); // caches antigos removidos
  } finally {
    writeFileSync('dist/index.html', originalHtml);
    writeFileSync('dist/sw.js', originalSw);
  }
});
