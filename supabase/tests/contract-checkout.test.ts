// Contratação a partir de /planos: plano do contrato = plano escolhido, Enterprise sob proposta, descarte antes do envio.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let owner: string;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const form = (planId: string, period: string) => ({ planId, period, requestId: `req-${planId}-${period}-${Math.random()}`, sandbox: true,
  company: { legalName: 'Oficina Plano Ltda', tradeName: 'Oficina Plano', document: '11.222.333/0001-81', street: 'Praça da Sé', number: '100', district: 'Sé', city: 'São Paulo', state: 'SP', zip: '01001-000', phone: '11999990000', email: 'loja@x.invalid' },
  representative: { name: 'Ana Representante', cpf: '529.982.247-25', role: 'Sócia', email: 'ana@x.invalid', phone: '11988887777', hasPowers: true } });
type Detail = { id: string; status: string; commercial: { planId: string; planName: string; period: string; price: number; total: number; entitlements: { users: number; branches: number; products: number; whatsapp: number } } };

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@checkout.invalid', 'Oficina Checkout A');
  B = await tenantFor(db, 'b@checkout.invalid', 'Oficina Checkout B');
  owner = await createUser(db, 'owner@checkout.invalid');
  await db.query("insert into public.platform_admins(user_id, role) values ($1, 'owner')", [owner]);
  // Homologação: o Super Admin é membro da empresa A para gerar contratos sandbox (rascunho jurídico, sem cobrança).
  await db.query("insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'Administrador')", [A.tenant, owner]);
}, 120000);
afterAll(async () => { await db?.close(); });

test('catálogo de autoatendimento exclui Enterprise (sob proposta)', async () => {
  const cat = await rpc<{ plans: { id: string }[] }>(null, 'contract_catalog', []);
  expect(cat.plans.map(p => p.id)).toEqual(['essencial', 'profissional', 'premium']);
});

test('o contrato congela exatamente o plano, a periodicidade, o preço e os limites escolhidos', async () => {
  const plans = (await db.query<{ id: string; name: string; monthly: number; quarterly: number; annual: number; users: number; branches: number; products: number; whatsapp: number }>(
    "select id, name, monthly, quarterly, annual, users, branches, products, whatsapp from public.plans where id in ('essencial','profissional','premium')")).rows;
  for (const p of plans) for (const period of ['monthly', 'quarterly', 'annual'] as const) {
    const r = await rpc<{ id: string }>(owner, 'prepare_contract', [A.tenant, form(p.id, period)]);
    const d = await rpc<Detail>(owner, 'contract_detail', [r.id]);
    expect(d.commercial).toMatchObject({ planId: p.id, planName: p.name, period, price: p[period], total: p[period] });
    expect(d.commercial.entitlements).toMatchObject({ users: p.users, branches: p.branches, products: p.products, whatsapp: p.whatsapp });
  }
});

test('Enterprise não gera contrato de autoatendimento (nem em homologação o banco aceita plano sob proposta como real)', async () => {
  const r = await rpc<{ id: string }>(owner, 'prepare_contract', [A.tenant, form('enterprise', 'monthly')]);
  expect(r.id).toBeTruthy(); // sandbox é permitido para homologar o texto
  // contrato real: o gatilho do banco recusa
  await db.query("update public.legal_contract_versions set status = 'published'");
  await db.query("update public.legal_provider_profiles set signer_name = 'Signatário', signer_email = 'sig@x.invalid' where active");
  await expect(rpc(B.user, 'prepare_contract', [B.tenant, { ...form('enterprise', 'monthly'), sandbox: false }])).rejects.toThrow(/proposta comercial/);
  const ok = await rpc<{ id: string }>(B.user, 'prepare_contract', [B.tenant, { ...form('premium', 'annual'), sandbox: false }]);
  expect(ok.id).toBeTruthy();
  // trocar o plano antes de enviar: descarta o preparado e gera outro
  await expect(rpc(B.user, 'prepare_contract', [B.tenant, { ...form('profissional', 'annual'), sandbox: false }])).rejects.toThrow(/Já existe um contrato em assinatura/);
  await rpc(B.user, 'discard_prepared_contract', [ok.id]);
  const again = await rpc<{ id: string }>(B.user, 'prepare_contract', [B.tenant, { ...form('profissional', 'annual'), sandbox: false }]);
  expect((await rpc<Detail>(B.user, 'contract_detail', [again.id])).commercial.planId).toBe('profissional');
  expect((await rpc<Detail>(B.user, 'contract_detail', [ok.id])).status).toBe('cancelled');
});

test('descarte: só membro autorizado da própria empresa e só antes do envio', async () => {
  const [c] = (await db.query<{ id: string }>("select id from public.tenant_contracts where tenant_id = $1 and status = 'prepared' and not sandbox", [B.tenant])).rows;
  await expect(rpc(A.user, 'discard_prepared_contract', [c.id])).rejects.toThrow(/não permite/);
  await expect(rpc(null, 'discard_prepared_contract', [c.id])).rejects.toThrow(/permission denied/);
  await db.query("update public.tenant_contracts set provider_document_id = 'doc-x', status = 'awaiting_customer' where id = $1", [c.id]);
  await expect(rpc(B.user, 'discard_prepared_contract', [c.id])).rejects.toThrow(/já enviado/);
});
