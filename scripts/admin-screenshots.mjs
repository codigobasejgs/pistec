// Capturas reais do Super Admin contra o Supabase autorizado.
// Cria um administrador temporário (perfil owner) e uma empresa de homologação; remove tudo no fim.
// Uso: npm run build && node scripts/admin-screenshots.mjs   (exige .env.local; servidor local em 5173)
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn, execSync } from 'node:child_process';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const U = env.VITE_SUPABASE_URL, admin = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
const sql = async query => { const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const PORT = 5173 /* origem já autorizada em APP_ORIGINS */, BASE = `http://127.0.0.1:${PORT}`, OUT = 'docs/screenshots/admin';
mkdirSync(OUT, { recursive: true });
const email = `admin-shot-${Date.now()}@pistec-e2e.invalid`, password = randomBytes(18).toString('base64url');
const user = await (await fetch(`${U}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Homologação' } }) })).json();
const server = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
let tenant = null;
try {
  await sql(`insert into public.platform_admins(user_id, role, note) values ('${user.id}', 'owner', 'captura temporária')`);
  // Empresa de homologação criada pelo próprio usuário (onboarding real), para preencher listas e o perfil 360°.
  const s = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  const t = await (await fetch(`${U}/rest/v1/rpc/onboard_tenant`, { method: 'POST', headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p: { name: 'Oficina Homologação ' + Date.now().toString(36), legalName: 'Oficina Homologação Ltda', owner: 'Homologação', document: '11222333000181', planId: 'profissional' } }) })).json();
  tenant = t.tenantId;
  for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE)).ok) break; } catch { /* aguardando */ } await new Promise(r => setTimeout(r, 500)); }
  // Nesta rede o navegador só alcança o Supabase pelo túnel local (mesmo do real.e2e.ts). PROXY=off desativa.
  const browser = await chromium.launch({ channel: 'chrome', ...(process.env.PROXY === 'off' ? {} : { proxy: { server: 'socks5://127.0.0.1:1080', bypass: 'localhost,127.0.0.1' } }) });
  const shots = [['dashboard', '/app/admin'], ['empresas', '/app/admin/empresas'], ['empresa-360', `/app/admin/empresas/${tenant}`], ['planos', '/app/admin/planos'], ['assinaturas', '/app/admin/assinaturas'],
    ['financeiro', '/app/admin/financeiro'], ['cupons', '/app/admin/cupons'], ['suporte', '/app/admin/suporte'], ['integracoes', '/app/admin/integracoes'], ['notificacoes', '/app/admin/notificacoes'],
    ['administradores', '/app/admin/administradores'], ['ajuda', '/app/admin/ajuda'], ['automacoes', '/app/admin/automacoes']];
  for (const [vw, w, h, only] of [['desktop', 1440, 900, null], ['tablet', 820, 1180, ['dashboard', 'empresa-360', 'empresas']], ['mobile', 390, 844, ['dashboard', 'empresas', 'empresa-360', 'integracoes', 'ajuda']]]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.goto(`${BASE}/app/login`);
    await page.locator('input[name=email]').fill(email); await page.locator('input[name=password]').fill(password);
    await page.locator('form button.btn.primary').click();
    await page.waitForURL(u => !u.pathname.endsWith('/login'), { timeout: 30000 }).catch(async e => {
      await page.screenshot({ path: `${OUT}/_falha-login-${vw}.png` }); console.log('login falhou; alerta na tela:', await page.locator('[role=alert]').allInnerTexts()); throw e; });
    for (const [name, path] of shots) {
      if (only && !only.includes(name)) continue;
      await page.goto(BASE + path); await page.waitForLoadState('networkidle'); await page.waitForTimeout(600);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      await page.screenshot({ path: `${OUT}/${vw}-${name}.png`, fullPage: vw !== 'desktop' });
      console.log(`${vw}-${name}.png${overflow > 1 ? `  ⚠ rolagem horizontal ${overflow}px` : ''}`);
    }
    await ctx.close();
  }
  await browser.close();
} finally {
  if (tenant) await sql(`delete from public.records where fields->>'tenantId' = '${tenant}'; delete from public.audit_logs where tenant_id = '${tenant}'; delete from public.notifications where tenant_id = '${tenant}'; delete from public.outbox_events where tenant_id = '${tenant}'; delete from public.tenants where id = '${tenant}';`).catch(e => console.log('limpeza empresa:', e.message.slice(0, 200)));
  await fetch(`${U}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin });
  console.log('conta e empresa temporárias removidas');
  try { execSync(`taskkill /pid ${server.pid} /T /F`, { stdio: 'ignore' }); } catch { /* já encerrado */ }
}
