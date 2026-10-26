// Uso: npm run build && npx esbuild supabase/functions/_shared/webpush.ts --format=esm --outfile=dist-tools/webpush.mjs && node scripts/push-check.mjs
// Inscreve um Chrome real (perfil temporÃ¡rio) no FCM com a VAPID pÃºblica e envia via sendPush (mesmo cÃ³digo da Edge Function).
// DestinatÃ¡rio = o prÃ³prio navegador de teste. Nenhum usuÃ¡rio real envolvido.
import { chromium } from '@playwright/test';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, execSync } from 'node:child_process';
const env = Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.slice(0,l.indexOf('=')),l.slice(l.indexOf('=')+1).trim()]));
const { sendPush } = await import(process.argv[2] ?? "../dist-tools/webpush.mjs");
const PORT = 4175, BASE = `http://127.0.0.1:${PORT}`;
const server = spawn('npx', ['vite','preview','--host','127.0.0.1','--port',String(PORT),'--strictPort'], { shell: true, stdio: 'ignore' });
try {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* aguardando */ } await new Promise(r => setTimeout(r, 500)); }
  const ctx = await chromium.launchPersistentContext(mkdtempSync(join(tmpdir(), 'pistec-push-')), { channel: 'chrome', headless: false, args: ['--window-position=-2400,-2400'] });
  await ctx.grantPermissions(['notifications'], { origin: BASE });
  const page = await ctx.newPage();
  console.log('navegador aberto'); await page.goto(`${BASE}/demonstracao`); console.log('pÃ¡gina carregada');
  await page.waitForFunction(() => navigator.serviceWorker.ready.then(() => true), null, { timeout: 30000 });
  console.log('SW pronto');
  const sw = ctx.serviceWorkers().find(w => w.url().endsWith('/sw.js')) ?? await ctx.waitForEvent('serviceworker');
  await sw.evaluate(() => { self.__got = []; self.addEventListener('push', e => self.__got.push(e.data ? e.data.text() : null)); });
  const sub = await page.evaluate(async key => {
    const reg = await navigator.serviceWorker.ready;
    const k = Uint8Array.from(atob(key.replace(/-/g,'+').replace(/_/g,'/') + '==='.slice((key.length + 3) % 4)), c => c.charCodeAt(0));
    return (await Promise.race([new Promise((_, x) => setTimeout(() => x(new Error('subscribe sem resposta em 30s (push service inacessÃ­vel?)')), 30000)), reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: k })])).toJSON();
  }, env.VAPID_PUBLIC_KEY);
  console.log('push service:', new URL(sub.endpoint).host);
  const message = { title: 'Teste PISTEC', body: 'Abra o PISTEC para ver os detalhes.', url: '/app', tag: 'push.test', nonce: Date.now() };
  const r = await sendPush({ endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth }, message, { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT }, 60);
  console.log('envio:', JSON.stringify(r));
  let got = [];
  for (let i = 0; i < 30 && !got.length; i++) { await new Promise(r => setTimeout(r, 1000)); got = await sw.evaluate(() => self.__got); }
  console.log('recebido e decifrado pelo navegador:', got.length ? (JSON.parse(got[0]).nonce === message.nonce ? 'SIM (payload Ã­ntegro)' : 'payload diferente') : 'NÃƒO em 30s');
  await ctx.close(); process.exit(process.exitCode ?? 0);
} catch (e) { console.log('ERRO:', e.message); process.exitCode = 1; } finally { try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* já encerrado */ } }
