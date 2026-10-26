// Super Admin 4.0: perfis por ação, ciclo de assinatura, métricas, visão 360°, auditoria.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>;
let owner: string, finance: string, support: string, auditor: string;
const rpc = <T = unknown>(user: string, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const admin = async (email: string, role: string) => { const id = await createUser(db, email); await db.query('insert into public.platform_admins(user_id, role) values ($1, $2)', [id, role]); return id; };
const audits = (action: string) => db.query<{ data: { reason?: string } }>(`select data from public.audit_logs where action like $1 order by id desc`, [`${action}%`]).then(r => r.rows);

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'dono@admin.invalid', 'Loja Admin');
  owner = await admin('owner@pistec.invalid', 'owner');
  finance = await admin('fin@pistec.invalid', 'finance');
  support = await admin('sup@pistec.invalid', 'support');
  auditor = await admin('aud@pistec.invalid', 'auditor');
}, 120000);
afterAll(async () => { await db?.close(); });

test('perfis: financeiro não gerencia administradores; suporte não vê finanças; lojista não chega a nada global', async () => {
  await expect(rpc(finance, 'admin_set_admin', ['sup@pistec.invalid', 'owner', false])).rejects.toThrow(/não permite/);
  await expect(rpc(support, 'admin_create_invoice', [A.tenant, 'premium', 'monthly', '', 'x'])).rejects.toThrow(/não permite/);
  expect((await rpc<{ finance: unknown; canFinance: boolean }>(support, 'admin_metrics', [])).finance).toBeNull();
  expect((await rpc<{ canFinance: boolean }>(finance, 'admin_metrics', [])).canFinance).toBe(true);
  expect(await as(db, support, 'select 1 from public.coupons')).toEqual([]);
  for (const fn of ['admin_metrics', 'admin_list_admins']) await expect(rpc(A.user, fn, [])).rejects.toThrow(/Super Admin/);
  await expect(rpc(A.user, 'admin_tenant_detail', [A.tenant])).rejects.toThrow(/Super Admin/);
  await expect(rpc(auditor, 'admin_extend_trial', [A.tenant, 5, 'motivo válido'])).rejects.toThrow(/não permite/);
  expect((await as(db, auditor, 'select 1 from public.audit_logs')).length).toBeGreaterThan(0);
});

test('prorrogação de teste: soma dias, exige justificativa, audita antes/depois e só vale em teste', async () => {
  const [{ end }] = (await db.query<{ end: string }>('select current_period_end::text "end" from public.subscriptions where tenant_id = $1', [A.tenant])).rows;
  await expect(rpc(owner, 'admin_extend_trial', [A.tenant, 15, 'ok'])).rejects.toThrow(/justificativa/);
  const next = new Date(await rpc<string>(owner, 'admin_extend_trial', [A.tenant, 15, 'Cliente pediu mais prazo para importar estoque'])).toISOString().slice(0, 10);
  expect(new Date(next).getTime() - new Date(end).getTime()).toBe(15 * 86400000);
  const [log] = await audits('Teste prorrogado');
  expect(log.data).toMatchObject({ before: end, after: next, reason: 'Cliente pediu mais prazo para importar estoque' });
  await rpc(owner, 'admin_set_subscription', [A.tenant, 'suspend', 'Teste de suspensão']);
  await expect(rpc(owner, 'admin_extend_trial', [A.tenant, 5, 'motivo qualquer'])).rejects.toThrow(/em teste/);
});

test('suspender bloqueia escrita sem apagar dados; reativar libera e define período', async () => {
  const products = async () => (await db.query('select 1 from public.products where tenant_id = $1', [A.tenant])).rows.length;
  const before = await products();
  await expect(as(db, A.user, `select public.save_product($1, '{"name":"X","sku":"X1","cost":1,"price":2}')`, [A.tenant])).rejects.toThrow(/suspensa/);
  expect(await products()).toBe(before);
  expect(await rpc(owner, 'admin_set_subscription', [A.tenant, 'reactivate', 'Pagamento confirmado por transferência', 30])).toBe('Ativa');
  await as(db, A.user, `select public.save_product($1, '{"name":"Y","sku":"Y1","cost":1,"price":2}')`, [A.tenant]);
  await expect(rpc(owner, 'admin_set_subscription', [A.tenant, 'reactivate', 'de novo sem motivo', 30])).rejects.toThrow(/Somente/);
});

test('troca de plano respeita limites de uso; financeiro pode, suporte não', async () => {
  for (let i = 0; i < 2; i++) await db.query(`insert into public.branches(tenant_id, name) values ($1, $2)`, [A.tenant, `Filial ${i}`]);
  await expect(rpc(finance, 'admin_change_plan', [A.tenant, 'essencial', 'Cliente pediu downgrade'])).rejects.toThrow(/Uso atual excede/);
  await expect(rpc(support, 'admin_change_plan', [A.tenant, 'enterprise', 'Cliente pediu upgrade'])).rejects.toThrow(/não permite/);
  await rpc(finance, 'admin_change_plan', [A.tenant, 'enterprise', 'Cliente pediu upgrade']);
  expect((await db.query<{ plan_id: string }>('select plan_id from public.subscriptions where tenant_id = $1', [A.tenant])).rows[0].plan_id).toBe('enterprise');
});

test('métricas derivadas do banco; MRR conta só assinaturas ativas pelo valor mensal equivalente', async () => {
  const m = await rpc<{ tenants: { total: number; active: number }; finance: { mrr: number } }>(owner, 'admin_metrics', []);
  const expected = (await db.query<{ v: string }>(`select coalesce(sum(case s.period when 'monthly' then p.monthly when 'quarterly' then p.quarterly/3 else p.annual/12 end),0)::text v
    from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status = 'active'`)).rows[0].v;
  expect(String(m.finance.mrr)).toBe(expected);
  expect(m.tenants.active).toBe(1);
});

test('visão 360°: membros só com e-mail e papel; faturas e auditoria conforme perfil', async () => {
  const full = await rpc<{ members: Record<string, unknown>[]; invoices: unknown; audit: unknown }>(owner, 'admin_tenant_detail', [A.tenant]);
  expect(Object.keys(full.members[0]).sort()).toEqual(['active', 'allBranches', 'email', 'role', 'since']);
  expect(Array.isArray(full.invoices) && Array.isArray(full.audit)).toBe(true);
  const sup = await rpc<{ invoices: unknown; audit: unknown }>(support, 'admin_tenant_detail', [A.tenant]);
  expect(sup.invoices).toBeNull(); expect(sup.audit).toBeNull();
});

test('administradores: só o proprietário gerencia; ninguém altera o próprio acesso; tudo auditado', async () => {
  await rpc(owner, 'admin_set_admin', ['dono@admin.invalid', 'support', false]);
  expect((await rpc<{ email: string; role: string }[]>(owner, 'admin_list_admins', [])).find(a => a.email === 'dono@admin.invalid')?.role).toBe('support');
  await expect(rpc(owner, 'admin_set_admin', ['owner@pistec.invalid', 'auditor', false])).rejects.toThrow(/próprio/);
  await rpc(owner, 'admin_set_admin', ['dono@admin.invalid', '', true]);
  expect((await audits('Administrador removido')).length).toBe(1);
  await expect(rpc(owner, 'admin_set_admin', ['naoexiste@x.invalid', 'admin', false])).rejects.toThrow(/não encontrado/);
});

test('chamado: suporte cria, comenta internamente e responde; resposta notifica a loja; lead fora do perfil do suporte', async () => {
  const id = await rpc<string>(support, 'admin_save_record', [{ kind: 'admin-ticket', title: 'PDV não abre', status: 'Aberto', fields: { tenantId: A.tenant, priority: 'Alta', category: 'PDV' } }]);
  await rpc(support, 'admin_record_comment', [id, 'Verificar logs do caixa', true]);
  expect(await as(db, A.user, `select 1 from public.notifications where type = 'support.reply'`)).toEqual([]);
  await rpc(support, 'admin_record_comment', [id, 'Corrigimos, tente novamente', false]);
  expect(await as(db, A.user, `select 1 from public.notifications where type = 'support.reply'`)).toHaveLength(1);
  await rpc(support, 'admin_save_record', [{ id, kind: 'admin-ticket', title: 'PDV não abre', status: 'Resolvido', fields: { tenantId: A.tenant } }]);
  const [{ history }] = (await db.query<{ history: { text: string }[] }>('select history from public.records where id = $1', [id])).rows;
  expect(history.some(h => h.text.includes('Aberto → Resolvido'))).toBe(true);
  await expect(rpc(support, 'admin_save_record', [{ kind: 'admin-lead', title: 'Lead', status: 'Novo' }])).rejects.toThrow(/não permite/);
});

test('reprocessamento só de evento em falha definitiva, com justificativa e auditoria', async () => {
  const { rows: [e] } = await db.query<{ id: number }>(`insert into public.outbox_events(tenant_id,type,status,attempts) values ($1,'stock.low','dead',5) returning id`, [A.tenant]);
  await expect(rpc(support, 'admin_retry_event', [e.id, 'tentar de novo'])).rejects.toThrow(/não permite/);
  await rpc(owner, 'admin_retry_event', [e.id, 'Falha corrigida no handler']);
  expect((await db.query<{ status: string }>('select status from public.outbox_events where id = $1', [e.id])).rows[0].status).toBe('pending');
  await expect(rpc(owner, 'admin_retry_event', [e.id, 'Falha corrigida no handler'])).rejects.toThrow(/falha definitiva/);
  await service(db, 'select 1');
});
