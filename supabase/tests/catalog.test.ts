// Catálogo comercial: banco = frontend, disponibilidade por plano = regra de app.require, preços e módulos intactos.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, tenantFor, type Db } from './harness';
import { FEATURES, featureInPlan } from '../../src/services/catalog';
import { createSeed } from '../../src/seed';

let db: Db;
beforeAll(async () => { db = await createDb(); }, 180000);
afterAll(async () => { await db?.close(); });
type Catalog = { plans: { id: string; monthly: number; quarterly: number; annual: number; modules: string[]; features: string[]; trialMonths: number }[]; features: { key: string; name: string; modules: string[]; status: string; next: boolean }[] };

test('catálogo no banco é idêntico ao do frontend e ao seed da demonstração', async () => {
  const c = (await as<{ r: Catalog }>(db, null, 'select public.plan_catalog() r'))[0].r;
  expect(c.features.map(f => ({ key: f.key, name: f.name, modules: f.modules, status: f.status, next: f.next }))).toEqual(FEATURES.map(f => ({ key: f.key, name: f.name, modules: f.modules, status: f.status, next: !!f.next })));
  const seed = createSeed().plans;
  for (const p of c.plans) {
    const s = seed.find(x => x.id === p.id)!;
    expect({ monthly: p.monthly, quarterly: p.quarterly, annual: p.annual, trial: p.trialMonths }).toEqual({ monthly: s.monthly, quarterly: s.quarterly, annual: s.annual, trial: s.trialMonths });
    expect(p.modules).toEqual(s.modules);
    expect(p.features).toEqual(FEATURES.filter(f => featureInPlan(f, p.modules)).map(f => f.key));
  }
  expect(c.features.filter(f => f.next)).toHaveLength(13); // 12 diferenciais (Moto Express e Frotas separados)
});

test('recurso anunciado no plano passa no app.require do servidor; fora do plano é bloqueado', async () => {
  const c = (await as<{ r: Catalog }>(db, null, 'select public.plan_catalog() r'))[0].r;
  const ess = await tenantFor(db, 'ess@catalog.invalid', 'Loja Essencial', 'essencial');
  const prof = await tenantFor(db, 'prof@catalog.invalid', 'Oficina Profissional', 'profissional');
  // app.require é interno (sem grant ao authenticated): executa com as mesmas claims do usuário, como uma RPC SECURITY DEFINER faria.
  const check = (user: string, tenant: string, module: string) => db.transaction(async tx => { await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: user, role: 'authenticated' })]); await tx.query("select app.require($1, $2, 'visualizar')", [tenant, module]); }).then(() => true, () => false);
  for (const [t, planId] of [[ess, 'essencial'], [prof, 'profissional']] as const) {
    const plan = c.plans.find(p => p.id === planId)!;
    for (const f of c.features) {
      const allowed = (await Promise.all(f.modules.map(m => check(t.user, t.tenant, m)))).every(Boolean);
      expect({ plan: planId, feature: f.key, allowed }).toEqual({ plan: planId, feature: f.key, allowed: plan.features.includes(f.key) });
    }
  }
}, 120000);

test('Essencial não usa recurso de plano superior forjando o payload da RPC', async () => {
  const t = await tenantFor(db, 'ess-payload@catalog.invalid', 'Loja Payload', 'essencial');
  const save = (kind: string) => as(db, t.user, 'select public.save_record($1, $2) r', [t.tenant, { kind, title: `Teste ${kind}`, branchId: t.branch, fields: {} }]);
  for (const kind of ['ordens-servico', 'orcamentos', 'agenda', 'garantias', 'crm', 'automacoes', 'compras', 'fornecedores', 'veiculos'])
    await expect(save(kind), kind).rejects.toThrow(/não incluído no plano/);
  await expect(save('tarefas')).resolves.toBeTruthy(); // módulo liberado em todos os planos continua funcionando
  await expect(as(db, t.user, 'select public.authorize_ai_tool($1, $2, $3) r', [t.tenant, t.branch, 'assistente'])).rejects.toThrow(/não incluído no plano/);
});

test('estado do recurso só muda pelo Super Admin, com motivo e auditoria; anônimo não grava', async () => {
  const user = await createUser(db, 'x@catalog.invalid'); const owner = await createUser(db, 'owner@catalog.invalid');
  await db.query("insert into public.platform_admins(user_id, role) values ($1, 'owner')", [owner]);
  await expect(as(db, user, "select public.admin_set_feature_status('whatsapp_bot', 'disponivel', 'teste')")).rejects.toThrow();
  await expect(as(db, null, "update public.feature_catalog set status = 'disponivel'")).rejects.toThrow();
  await as(db, owner, "select public.admin_set_feature_status('whatsapp_bot', 'disponivel', 'Homologado com número de teste')", [], 'aal2');
  expect((await db.query<{ status: string }>("select status from public.feature_catalog where key = 'whatsapp_bot'")).rows[0].status).toBe('disponivel');
  expect((await db.query<{ n: number }>("select count(*)::int n from public.audit_logs where entity = 'feature' and entity_id = 'whatsapp_bot'")).rows[0].n).toBe(1);
});
