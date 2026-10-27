// Verificação real (produção) do fluxo de documentos com conta e empresa TEMPORÁRIAS; remove tudo no fim.
// Não envia e-mail nem WhatsApp. Uso: node scripts/documents-prod-check.mjs   (exige .env.local)
import { chromium } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const U = env.VITE_SUPABASE_URL, K = env.VITE_SUPABASE_PUBLISHABLE_KEY, admin = { apikey: env.SUPABASE_SECRET_KEY, Authorization: `Bearer ${env.SUPABASE_SECRET_KEY}`, 'Content-Type': 'application/json' };
const sql = async query => { const r = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/database/query`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) }); if (!r.ok) throw new Error(await r.text()); return r.json(); };
const BASE = process.env.BASE ?? 'https://pistec.vercel.app', OUT = 'docs/screenshots/print'; mkdirSync(OUT, { recursive: true });
const email = `doc-check-${Date.now()}@pistec-e2e.invalid`, password = randomBytes(18).toString('base64url');
const user = await (await fetch(`${U}/auth/v1/admin/users`, { method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { name: 'Verificação' } }) })).json();
let tenant = null; const log = (...a) => console.log('•', ...a);
try {
  const s = await (await fetch(`${U}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: K, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })).json();
  const rpc = async (fn, body) => { const r = await fetch(`${U}/rest/v1/rpc/${fn}`, { method: 'POST', headers: { apikey: K, Authorization: `Bearer ${s.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const t = await r.text(); if (!r.ok) throw new Error(`${fn}: ${t}`); return t ? JSON.parse(t) : null; };
  const t = await rpc('onboard_tenant', { p: { name: 'Oficina Verificação ' + Date.now().toString(36), legalName: 'Verificação Ltda', owner: 'Verificação', document: '11222333000181', planId: 'premium' } });
  tenant = t.tenantId;
  const slug = (await sql(`select slug from public.tenants where id = '${tenant}'`))[0].slug;
  await rpc('save_document_identity', { p_tenant: tenant, p: { address: 'Rua de Verificação, 1', phone: '1100000000' } });
  const prod = await rpc('save_product', { p_tenant: tenant, p: { name: 'Produto verificação', sku: 'VER-1', cost: 100, price: 2500 } });
  await rpc('move_stock', { p_tenant: tenant, p_branch: t.branchId, p_product: prod, p_quantity: 3, p_type: 'Entrada', p_reference: 'verificacao' });
  log('empresa temporária criada:', slug);

  const browser = await chromium.launch({ channel: 'chrome', ...(process.env.PROXY === 'off' ? {} : { proxy: { server: 'socks5://127.0.0.1:1080' } }) });
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, acceptDownloads: true }); const page = await ctx.newPage();
  await page.goto(`${BASE}/app/login`); await page.locator('input[name=email]').fill(email); await page.locator('input[name=password]').fill(password); await page.locator('form button.btn.primary').click();
  await page.waitForURL(u => !u.pathname.endsWith('/login'), { timeout: 30000 });
  await page.goto(`${BASE}/app/loja/${slug}/pdv`); await page.getByRole('heading', { name: 'Frente de caixa' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Abrir caixa' }).first().click(); await page.getByRole('dialog', { name: 'Abrir caixa' }).getByRole('button', { name: 'Abrir caixa' }).click();
  await page.getByText('Caixa aberto', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Adicionar', exact: true }).first().click(); await page.getByRole('button', { name: /^Cobrar/ }).click();
  await page.getByRole('textbox', { name: 'Valor do pagamento 1 (R$)', exact: true }).fill('30,00'); await page.getByRole('button', { name: 'Finalizar venda' }).click();
  await page.getByRole('dialog', { name: 'Venda concluída' }).waitFor({ timeout: 30000 }); log('venda concluída no servidor');
  await page.getByRole('button', { name: /Imprimir · WhatsApp/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Documento' });
  const preview = dialog.frameLocator('iframe.doc-preview'); await preview.getByText('Comprovante de venda').waitFor({ timeout: 30000 });
  const number = (await dialog.locator('.doc-meta .badge').first().innerText()).trim(); log('comprovante emitido pelo servidor:', number);
  if (!/^VEN-\d{6}$/.test(number)) throw new Error('Número inesperado: ' + number);
  if (!(await preview.getByText('Rua de Verificação, 1').count())) throw new Error('Endereço da filial/empresa ausente');
  await page.screenshot({ path: `${OUT}/producao-documento-venda.png` });
  const [pdf] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: 'PDF', exact: true }).click()]); log('PDF baixado:', pdf.suggestedFilename());
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  await page.evaluate(() => { Object.defineProperty(navigator, 'share', { value: undefined }); });
  await dialog.getByRole('button', { name: 'Link', exact: true }).click(); await page.waitForTimeout(1500);
  const link = await page.evaluate(() => navigator.clipboard.readText()); if (!/\/d\/[0-9a-f]{48}$/.test(link)) throw new Error('Link inválido: ' + link); log('link seguro criado');
  await dialog.getByRole('button', { name: 'Histórico' }).click(); await dialog.getByText('Link criado').waitFor(); log('histórico registrado (PDF + link)');
  const pub = await ctx.newPage(); await pub.goto(link); await pub.frameLocator('iframe').getByText('Comprovante de venda').waitFor({ timeout: 30000 });
  await pub.screenshot({ path: `${OUT}/producao-pagina-publica.png` }); log('página pública abriu o documento');
  const revoked = await rpc('revoke_document_links', { p_tenant: tenant, p_document: (await sql(`select id from public.generated_documents where tenant_id='${tenant}' limit 1`))[0].id });
  await pub.reload(); await pub.getByText('Link indisponível').waitFor(); log('link revogado (', revoked, ') → indisponível');
  await browser.close();
  console.log('RESULTADO: OK');
} finally {
  // Ordem respeita as FKs sem cascade (vendas → filial, caixa, produtos).
  const T = tenant, tables = ['document_share_tokens', 'document_events', 'generated_documents', 'sale_payments', 'sale_items', 'settlements', 'financial_entries', 'sales', 'cash_movements', 'cash_registers',
    'stock_movements', 'stock_balances', 'records', 'audit_logs', 'notifications', 'outbox_events', 'email_messages'];
  if (T) await sql(`begin; ${tables.map(t => `delete from public.${t} where tenant_id = '${T}';`).join(' ')} delete from public.tenants where id = '${T}'; commit;`).catch(e => console.log('limpeza empresa:', e.message.slice(0, 300)));
  await fetch(`${U}/auth/v1/admin/users/${user.id}`, { method: 'DELETE', headers: admin });
  console.log('conta e empresa temporárias removidas');
}
