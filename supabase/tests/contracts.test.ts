// Contract 7.0: versão jurídica controlada, condições congeladas, assinatura só por confirmação do provedor, cobrança após assinatura.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let owner: string, editor: string, reviewer: string, approver: string;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const svc = <T = unknown>(fn: string, args: unknown[]) => service<{ r: T }>(db, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const admin = async (email: string, role: string, roles: string[] = []) => { const id = await createUser(db, email); await db.query('insert into public.platform_admins(user_id, role, contract_roles) values ($1, $2, $3)', [id, role, roles]); return id; };
const form = (extra: Record<string, unknown> = {}) => ({ planId: 'profissional', period: 'monthly', requestId: `req-${Math.random()}`,
  company: { legalName: 'Moto Prime Comércio Ltda', tradeName: 'Moto Prime', document: '11.222.333/0001-81', street: 'Rua A', number: '10', district: 'Centro', city: 'São Paulo', state: 'SP', zip: '01001-000', phone: '11999990000', email: 'loja@x.invalid' },
  representative: { name: 'João Representante', cpf: '529.982.247-25', role: 'Sócio', email: 'joao@x.invalid', phone: '11988887777', hasPowers: true }, ...extra });
const versionId = async () => (await db.query<{ id: string }>("select id from public.legal_contract_versions where code = '2026.1'")).rows[0].id;

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@contract.invalid', 'Loja Contrato A');
  B = await tenantFor(db, 'b@contract.invalid', 'Loja Contrato B');
  owner = await admin('owner@contract.invalid', 'owner');
  editor = await admin('editor@contract.invalid', 'admin', ['editor', 'publisher']);
  reviewer = await admin('revisor@contract.invalid', 'admin', ['reviewer']);
  approver = await admin('aprovador@contract.invalid', 'admin', ['approver']);
}, 120000);
afterAll(async () => { await db?.close(); });

test('contratada vem do cadastro oficial; minuta 2026.1 entra como RASCUNHO e o catálogo mostra preço do servidor', async () => {
  const cat = await rpc<{ provider: Record<string, string>; version: unknown; draft: { status: string }; plans: { id: string; monthly: number }[] }>(null, 'contract_catalog', []);
  expect(cat.provider).toMatchObject({ legalName: '59.760.458 MARCO ANTONIO BOGGIAN', document: '59.760.458/0001-91', legalNature: 'Empresário Individual', brand: 'PISTEC' });
  expect(cat.provider.address).toBe('Rua Jacques Pilon, 189, Vila Piauí, São Paulo/SP, CEP 05109-160');
  expect(cat.version).toBeNull(); expect(cat.draft.status).toBe('draft');
  expect(cat.plans.find(p => p.id === 'profissional')!.monthly).toBe(24900);
  const terms = await rpc<{ status: string; body: { sections: unknown[] } }>(null, 'contract_public_terms', []);
  expect(terms.status).toBe('draft'); expect(terms.body.sections).toHaveLength(16);
});

test('sem versão publicada não há contratação real; homologação (sandbox) só para Super Admin', async () => {
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form()])).rejects.toThrow(/não foi aprovada juridicamente/);
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form({ sandbox: true })])).rejects.toThrow(/restrita ao Super Admin/);
});

test('aprovação exige papéis distintos: editor envia, revisor registra parecer, aprovador (outra pessoa) aprova, publicador publica', async () => {
  const id = await versionId();
  await expect(rpc(owner, 'admin_contract_version', ['submit', id, {}, null])).rejects.toThrow(/editor/);
  await rpc(editor, 'admin_contract_version', ['submit', id, {}, null]);
  await expect(rpc(editor, 'admin_contract_version', ['edit', id, { body: {} }, null])).rejects.toThrow(/fora de rascunho/);
  await expect(rpc(approver, 'admin_contract_version', ['approve', id, {}, 'ok'])).rejects.toThrow(/revisão jurídica registrada/);
  await expect(rpc(editor, 'admin_contract_version', ['publish', id, {}, null])).rejects.toThrow(/aprovada/);
  await rpc(reviewer, 'admin_contract_version', ['review', id, {}, 'Parecer jurídico de teste nº 1']);
  await rpc(approver, 'admin_contract_version', ['approve', id, {}, 'Aprovado por advogado de teste (OAB fictícia)']);
  await rpc(editor, 'admin_contract_version', ['publish', id, {}, null]);
  expect((await rpc<{ version: { status: string } }>(null, 'contract_catalog', [])).version.status).toBe('published');
});

test('contrato real exige signatário da contratada; dados validados (CNPJ, CPF, poderes) e preço congelado do servidor', async () => {
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form()])).rejects.toThrow(/signatário da contratada/);
  await expect(rpc(A.user, 'admin_save_provider_profile', [{ signer_name: 'X' }, 'motivo ok'])).rejects.toThrow(/proprietário da plataforma/);
  await rpc(owner, 'admin_save_provider_profile', [{ signer_name: 'Marco Antonio Boggian', signer_email: 'marco.boggian@gmail.com' }, 'Signatário autorizado definido']);
  expect((await db.query("select count(*)::int n from public.legal_provider_profiles")).rows[0]).toEqual({ n: 2 });
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form({ company: { ...form().company, document: '11.222.333/0001-80' } })])).rejects.toThrow(/CPF\/CNPJ do contratante inválido/);
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form({ representative: { ...form().representative, cpf: '111.111.111-11' } })])).rejects.toThrow(/CPF do representante/);
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form({ representative: { ...form().representative, hasPowers: false } })])).rejects.toThrow(/poderes/);
  const f = form({ price: 1, total: 1 });
  const c = await rpc<{ id: string; number: string }>(A.user, 'prepare_contract', [A.tenant, f]);
  expect(c.number).toMatch(/^PST-\d{4}-\d{5}$/);
  expect((await rpc<{ duplicate: boolean }>(A.user, 'prepare_contract', [A.tenant, f])).duplicate).toBe(true);
  const d = await rpc<{ commercial: { total: number; price: number; planName: string }; parties: { provider: { legalName: string }; representative: { cpf: string } }; signers: unknown[] }>(A.user, 'contract_detail', [c.id]);
  expect(d.commercial).toMatchObject({ price: 24900, total: 24900, planName: 'Profissional' });
  expect(d.parties.provider.legalName).toBe('59.760.458 MARCO ANTONIO BOGGIAN'); expect(d.parties.representative.cpf).toBe('52998224725');
  expect(d.signers).toHaveLength(2);
  await expect(rpc(A.user, 'prepare_contract', [A.tenant, form()])).rejects.toThrow(/Já existe um contrato em assinatura/);
  // alterar o plano depois NÃO muda o contrato congelado
  await db.query("update public.plans set monthly = 29900 where id = 'profissional'");
  expect((await rpc<{ commercial: { total: number } }>(A.user, 'contract_detail', [c.id])).commercial.total).toBe(24900);
  await db.query("update public.plans set monthly = 24900 where id = 'profissional'");
});

test('isolamento: empresa B não lê nem manipula contrato de A; usuário comum não chama funções de serviço', async () => {
  const id = (await db.query<{ id: string }>('select id from public.tenant_contracts where tenant_id = $1', [A.tenant])).rows[0].id;
  await expect(rpc(B.user, 'contract_detail', [id])).rejects.toThrow(/não encontrado/);
  expect(await as(db, B.user, 'select id from public.tenant_contracts')).toEqual([]);
  await expect(rpc(B.user, 'cancel_contract', [id, 'tentativa indevida'])).rejects.toThrow(/não permite/);
  await expect(rpc(A.user, 'svc_contract_complete', ['doc', 'a'.repeat(64), 'p', 'c'])).rejects.toThrow(/permission denied/);
  await expect(rpc(A.user, 'contract_invoice', [id])).rejects.toThrow(/depois do contrato assinado/);
});

test('assinatura: só conclui com todos assinados + PDF final; eventos duplicados/fora de ordem; contrato assinado é imutável', async () => {
  const id = (await db.query<{ id: string }>('select id from public.tenant_contracts where tenant_id = $1', [A.tenant])).rows[0].id;
  await svc('svc_contract_sent', [id, 'AUT-DOC-1', 'b'.repeat(64), `${A.tenant}/${id}/original.pdf`, [{ role: 'customer', id: 'SIG-C' }, { role: 'provider', id: 'SIG-P' }]]);
  expect(await svc('svc_contract_complete', ['AUT-DOC-1', 'c'.repeat(64), 'x', 'y'])).toBe('incomplete');
  // evento "assinado pelo contratante" chega antes do "visualizado"
  expect(await svc('svc_contract_apply', ['AUT-DOC-1', 'evt-2', 'signature.accepted', [{ id: 'SIG-C', viewed: '2026-10-28T10:00:00Z', signed: '2026-10-28T10:05:00Z' }], 'webhook'])).toBe('awaiting_provider');
  expect(await svc('svc_contract_apply', ['AUT-DOC-1', 'evt-2', 'signature.accepted', [], 'webhook'])).toBe('duplicate');
  expect(await svc('svc_contract_apply', ['AUT-DOC-1', 'evt-1', 'signature.viewed', [{ id: 'SIG-C', viewed: '2026-10-28T10:00:00Z' }], 'webhook'])).toBe('awaiting_provider');
  expect(await svc('svc_contract_apply', ['AUT-DOC-1', 'evt-3', 'signature.accepted', [{ id: 'SIG-P', signed: '2026-10-28T11:00:00Z' }], 'reconcile'])).toBe('partially_signed');
  expect(await svc('svc_contract_complete', ['AUT-DOC-1', 'd'.repeat(64), `${A.tenant}/${id}/assinado.pdf`, `${A.tenant}/${id}/certificado.pdf`])).toBe('signed');
  expect(await svc('svc_contract_complete', ['AUT-DOC-1', 'e'.repeat(64), 'z', 'z'])).toBe('already');
  await expect(service(db, "update public.tenant_contracts set signed_sha256 = $1 where id = $2", ['f'.repeat(64), id])).rejects.toThrow(/não pode ser alterado/);
  await expect(service(db, "update public.tenant_contracts set commercial = commercial || '{\"total\":1}' where id = $1", [id])).rejects.toThrow();
  await expect(service(db, 'delete from public.tenant_contracts where id = $1', [id])).rejects.toThrow(/não podem ser apagados/);
  await expect(rpc(owner, 'cancel_contract', [id, 'tentar cancelar'])).rejects.toThrow(/não concluídos/);
  const mails = (await db.query<{ template: string }>("select template from public.email_messages where template = 'contract_signed'")).rows;
  expect(mails).toHaveLength(1);
});

test('cobrança só depois da assinatura, com as condições congeladas; idempotente; preço alterado bloqueia', async () => {
  const id = (await db.query<{ id: string }>('select id from public.tenant_contracts where tenant_id = $1', [A.tenant])).rows[0].id;
  const inv = await rpc<string>(A.user, 'contract_invoice', [id]);
  expect(await rpc<string>(A.user, 'contract_invoice', [id])).toBe(inv);
  expect((await db.query('select amount::int, plan_id, period from public.billing_invoices where id = $1', [inv])).rows[0]).toEqual({ amount: 24900, plan_id: 'profissional', period: 'monthly' });
  // pagamento só via confirmação do provedor (função de serviço existente); valor divergente recusado
  expect((await service<{ r: string }>(db, "select app.svc_confirm_payment($1, 'NSU-1', 100, 100, 'pix', null, null, '{}') r", [inv]))[0].r).toBe('amount_mismatch');
  expect((await service<{ r: string }>(db, "select app.svc_confirm_payment($1, 'NSU-2', 24900, 24900, 'pix', null, null, '{}') r", [inv]))[0].r).toBe('paid');
  expect((await db.query("select status from public.subscriptions where tenant_id = $1", [A.tenant])).rows[0]).toEqual({ status: 'active' });
  // contrato de B com preço que muda após a assinatura não gera cobrança diferente
  await rpc(owner, 'admin_save_provider_profile', [{}, 'manter signatário']);
  const cb = await rpc<{ id: string }>(B.user, 'prepare_contract', [B.tenant, form({ requestId: 'b-1' })]);
  await svc('svc_contract_sent', [cb.id, 'AUT-DOC-B', '1'.repeat(64), 'p', [{ role: 'customer', id: 'B-C' }, { role: 'provider', id: 'B-P' }]]);
  await svc('svc_contract_apply', ['AUT-DOC-B', 'b-evt', 'document.finished', [{ id: 'B-C', signed: '2026-10-28T12:00:00Z' }, { id: 'B-P', signed: '2026-10-28T12:01:00Z' }], 'reconcile']);
  await svc('svc_contract_complete', ['AUT-DOC-B', '2'.repeat(64), 'p', 'c']);
  await db.query("update public.plans set monthly = 29900 where id = 'profissional'");
  await expect(rpc(B.user, 'contract_invoice', [cb.id])).rejects.toThrow(/preço do plano mudou/);
  await db.query("update public.plans set monthly = 24900 where id = 'profissional'");
});

test('recusa e expiração finalizam; Super Admin vê métricas; lojista não', async () => {
  const c = await rpc<{ id: string }>(A.user, 'prepare_contract', [A.tenant, form({ requestId: 'refuse-1' })]);
  await svc('svc_contract_sent', [c.id, 'AUT-DOC-R', '3'.repeat(64), 'p', [{ role: 'customer', id: 'R-C' }, { role: 'provider', id: 'R-P' }]]);
  expect(await svc('svc_contract_apply', ['AUT-DOC-R', 'r-1', 'signature.rejected', [{ id: 'R-C', rejected: '2026-10-28T13:00:00Z' }], 'webhook'])).toBe('refused');
  const c2 = await rpc<{ id: string }>(A.user, 'prepare_contract', [A.tenant, form({ requestId: 'expire-1' })]);
  await service(db, "update public.tenant_contracts set expires_at = now() - interval '1 minute' where id = $1", [c2.id]);
  expect(await svc('svc_contract_expire', [])).toBe(1);
  const m = await rpc<{ signed: number; refused: number; expired: number }>(owner, 'admin_contract_metrics', []);
  expect(m).toMatchObject({ signed: 2, refused: 1, expired: 1 });
  await expect(rpc(A.user, 'admin_contract_metrics', [])).rejects.toThrow(/não permite/);
});
