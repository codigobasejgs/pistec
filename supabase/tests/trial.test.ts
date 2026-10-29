// Teste gratuito de 1 mês calendário: cálculo no banco, onboarding, idempotência, prorrogação, avisos e segurança.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';
import { trialEndDay } from '../../src/services/trial';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let owner: string;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const spToday = async () => (await db.query<{ d: string }>("select to_char((now() at time zone 'America/Sao_Paulo')::date, 'YYYY-MM-DD') d")).rows[0].d;

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@trial.invalid', 'Oficina Trial A', 'profissional');
  B = await tenantFor(db, 'b@trial.invalid', 'Oficina Trial B', 'essencial');
  owner = await createUser(db, 'owner@trial.invalid');
  await db.query("insert into public.platform_admins(user_id, role) values ($1, 'owner')", [owner]);
}, 120000);
afterAll(async () => { await db?.close(); });

test('banco e frontend calculam o mesmo fim de teste (mês calendário, fuso de São Paulo, fim de mês, bissexto, virada de ano)', async () => {
  const starts = ['2026-10-29T17:00:00Z', '2026-11-10T13:00:00Z', '2026-11-01T12:00:00Z', '2026-11-15T12:00:00Z', '2027-01-28T12:00:00Z', '2027-01-29T12:00:00Z',
    '2027-01-30T12:00:00Z', '2027-01-31T12:00:00Z', '2028-01-31T12:00:00Z', '2027-03-31T12:00:00Z', '2026-12-15T12:00:00Z', '2026-12-31T12:00:00Z', '2026-11-01T02:30:00Z'];
  for (const s of starts) {
    const { rows } = await db.query<{ d: string }>("select to_char(app.trial_end($1::timestamptz, 1), 'YYYY-MM-DD') d", [s]);
    expect(rows[0].d, s).toBe(trialEndDay(new Date(s)));
  }
});

test('nova empresa: 1 mês a partir do cadastro, início registrado; repetir a requisição não reinicia o teste', async () => {
  const today = await spToday();
  const { rows: [t] } = await db.query<{ due: string; started: string | null; status: string }>("select to_char(due_date, 'YYYY-MM-DD') due, trial_started_at::text started, status from public.tenants where id = $1", [A.tenant]);
  expect(t.status).toBe('Teste'); expect(t.started).not.toBeNull();
  expect(t.due).toBe(trialEndDay(new Date(`${today}T15:00:00Z`)));
  const { rows: [s] } = await db.query<{ end: string; status: string }>("select to_char(current_period_end, 'YYYY-MM-DD') end, status from public.subscriptions where tenant_id = $1", [A.tenant]);
  expect(s).toEqual({ end: t.due, status: 'trialing' });
  // mesma empresa de novo (mesmo slug, mesmo dono) → mesma empresa, mesmo vencimento
  const again = await rpc<{ tenantId: string; trialEndsAt: string }>(A.user, 'onboard_tenant', [{ name: 'Oficina Trial A', planId: 'profissional', owner: 'A' }]);
  expect(again.tenantId).toBe(A.tenant);
  expect((await db.query<{ n: number }>('select count(*)::int n from public.tenants where created_by = $1', [A.user])).rows[0].n).toBe(1);
});

test('usuário da loja não altera prazo nem situação do teste; política pública é legível', async () => {
  await expect(as(db, A.user, "update public.tenants set due_date = current_date + 365 where id = $1", [A.tenant])).rejects.toThrow(/permission denied/);
  await expect(as(db, A.user, "update public.subscriptions set current_period_end = current_date + 365 where tenant_id = $1", [A.tenant])).rejects.toThrow(/permission denied/);
  await expect(rpc(A.user, 'admin_extend_trial_until', [A.tenant, '2027-12-31', 'quero mais tempo'])).rejects.toThrow();
  const policy = await rpc<{ rule: string; plans: Record<string, number> }>(null, 'trial_policy', []);
  expect(policy.rule).toBe('calendar_month'); expect(policy.plans.profissional).toBe(1);
});

test('Super Admin prorroga até uma data, com justificativa e auditoria; não aceita data anterior', async () => {
  const { rows: [{ due }] } = await db.query<{ due: string }>("select to_char(due_date, 'YYYY-MM-DD') due from public.tenants where id = $1", [B.tenant]);
  await expect(rpc(owner, 'admin_extend_trial_until', [B.tenant, due, 'mesma data'])).rejects.toThrow(/posterior/);
  const until = new Date(Date.parse(`${due}T12:00:00Z`) + 10 * 864e5).toISOString().slice(0, 10);
  await rpc(owner, 'admin_extend_trial_until', [B.tenant, until, 'Cliente pediu mais tempo para importar o estoque']);
  const { rows: [t] } = await db.query<{ due: string }>("select to_char(due_date, 'YYYY-MM-DD') due from public.tenants where id = $1", [B.tenant]);
  expect(t.due).toBe(until);
  const { rows: [a] } = await db.query<{ data: { before: string; after: string; reason: string } }>("select data from public.audit_logs where tenant_id = $1 and entity = 'subscription' order by id desc limit 1", [B.tenant]);
  expect(a.data.after).toBe(until); expect(a.data.reason).toMatch(/importar/);
});

test('avisos em 7, 3, 1 e 0 dias da data real, sem duplicar; teste nunca vira cobrança antes do fim', async () => {
  const days = async () => (await db.query<{ d: string }>("select payload->>'daysLeft' d from public.outbox_events where tenant_id = $1 and type = 'subscription.trial_ending' order by id", [A.tenant])).rows.map(r => r.d);
  for (const left of [10, 7, 7, 3, 1, 0]) {
    await db.query("update public.subscriptions set current_period_end = (now() at time zone 'America/Sao_Paulo')::date + $2::int where tenant_id = $1", [A.tenant, left]);
    await service(db, 'select public.run_billing_cycle()');
  }
  expect(await days()).toEqual(['7', '3', '1', '0']);
  // no último dia ainda está em teste (não venceu)
  expect((await db.query<{ status: string }>('select status from public.subscriptions where tenant_id = $1', [A.tenant])).rows[0].status).toBe('trialing');
  // dia seguinte: vencida (sem cobrança automática; fatura só é paga pelo checkout)
  await db.query("update public.subscriptions set current_period_end = (now() at time zone 'America/Sao_Paulo')::date - 1 where tenant_id = $1", [A.tenant]);
  await service(db, 'select public.run_billing_cycle()');
  expect((await db.query<{ status: string }>('select status from public.subscriptions where tenant_id = $1', [A.tenant])).rows[0].status).toBe('past_due');
  const invoices = (await db.query<{ n: number }>("select count(*)::int n from public.billing_invoices where tenant_id = $1 and status = 'Paga'", [A.tenant])).rows[0].n;
  expect(invoices).toBe(0);
});

test('plano sem teste (0 meses) não concede período gratuito', async () => {
  await rpc(owner, 'admin_save_plan', [{ id: 'sem-teste', name: 'Sem teste', monthly: 1000, quarterly: 3000, annual: 12000, users: 1, branches: 1, products: 10, whatsapp: 0, trialMonths: 0 }]);
  await expect(rpc(owner, 'admin_save_plan', [{ id: 'sem-teste', name: 'Sem teste', monthly: 1000, quarterly: 3000, annual: 12000, users: 1, branches: 1, products: 10, whatsapp: 0, trialMonths: 9 }])).rejects.toThrow(/0 e 3 meses/);
  const u = await createUser(db, 'c@trial.invalid');
  const r = await rpc<{ tenantId: string }>(u, 'onboard_tenant', [{ name: 'Sem Teste Ltda', planId: 'sem-teste', owner: 'C' }]);
  const today = await spToday();
  expect((await db.query<{ due: string }>("select to_char(due_date, 'YYYY-MM-DD') due from public.tenants where id = $1", [r.tenantId])).rows[0].due).toBe(today);
});
