// Print & Documents 6.0: emissão no servidor a partir dos dados reais, vias, links seguros, envio, isolamento.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, service, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
let product: string, sale: string, customer: string;
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Issued = { id: string; number: string; version: number; copies: number; snapshot: Record<string, any> };

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@docs.invalid', 'Moto Prime Docs');
  B = await tenantFor(db, 'b@docs.invalid', 'Oficina B Docs');
  await rpc(A.user, 'save_document_identity', [A.tenant, { address: 'Rua das Motos, 100 - Centro', phone: '1133334444', whatsapp: '11999990000', branches: [{ id: A.branch, address: 'Av. Filial, 50', phone: '1144445555' }] }]);
  product = await rpc<string>(A.user, 'save_product', [A.tenant, { name: 'Pastilha de freio dianteira', sku: 'PAS-01', cost: 1000, price: 2500 }]);
  await rpc(A.user, 'move_stock', [A.tenant, A.branch, product, 10, 'Entrada', 'NF-1']);
  customer = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'João Cliente', phone: '(11) 98888-7777', email: 'joao@cliente.invalid', consent: true }]);
  await rpc(A.user, 'open_cash', [A.tenant, A.branch, 10000]);
  const done = await rpc<{ id: string }>(A.user, 'complete_sale', [{ tenantId: A.tenant, branchId: A.branch, customerId: customer, items: [{ productId: product, quantity: 2 }], discount: 0, surcharge: 0, payments: [{ method: 'Dinheiro', amount: 6000 }], requestId: 'req-doc-1' }]);
  sale = done.id;
}, 180000);
afterAll(async () => { await db?.close(); });

test('venda concluída já tem comprovante emitido na mesma transação, com dados reais e filial correta', async () => {
  const [row] = (await db.query<{ n: number }>('select count(*)::int n from public.generated_documents where tenant_id = $1 and type = $2 and source_id = $3', [A.tenant, 'sale', sale])).rows;
  expect(row.n).toBe(1);
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  expect(d.version).toBe(1); expect(d.number).toMatch(/^VEN-\d{6}$/);
  expect(d.snapshot.sale).toMatchObject({ total: 5000, change: 1000, status: 'Concluída' });
  expect(d.snapshot.sale.items[0]).toMatchObject({ name: 'Pastilha de freio dianteira', quantity: 2, price: 2500, sku: 'PAS-01' });
  expect(d.snapshot.branch).toMatchObject({ address: 'Av. Filial, 50', phone: '1144445555' });
  expect(d.snapshot.company).toMatchObject({ name: 'Moto Prime Docs', address: 'Rua das Motos, 100 - Centro' });
  expect(d.snapshot.customer).toMatchObject({ name: 'João Cliente' });
});

test('mesmo conteúdo = mesma versão; trocar o endereço da empresa NÃO altera o comprovante histórico', async () => {
  await rpc(A.user, 'save_document_identity', [A.tenant, { address: 'Endereço novo, 999' }]);
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  expect(d.version).toBe(1); expect(d.snapshot.company.address).toBe('Rua das Motos, 100 - Centro');
});

test('impressão registra vias: 1ª, depois reimpressão (2ª via) auditada; mesma chave não conta duas vezes', async () => {
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  expect(await rpc(A.user, 'record_document_print', [A.tenant, d.id, 'print', 'browser', null, 'print-key-0001'])).toBe(1);
  expect(await rpc(A.user, 'record_document_print', [A.tenant, d.id, 'print', 'browser', null, 'print-key-0001'])).toBe(1);
  expect(await rpc(A.user, 'record_document_print', [A.tenant, d.id, 'print', 'browser', null, 'print-key-0002'])).toBe(2);
  expect((await db.query("select 1 from public.audit_logs where action like 'Reimpressão (2ª via)%'")).rows).toHaveLength(1);
  expect((await db.query<{ n: number }>('select count(*)::int n from public.sales where tenant_id = $1', [A.tenant])).rows[0].n).toBe(1);
});

test('isolamento: B não emite, não lê e não imprime documento de A; impressora de A não serve em B', async () => {
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  await expect(rpc(B.user, 'issue_document', [A.tenant, 'sale', sale])).rejects.toThrow(/Acesso negado/);
  await expect(rpc(B.user, 'issue_document', [B.tenant, 'sale', sale])).rejects.toThrow(/não encontrada/);
  expect(await as(db, B.user, 'select id from public.generated_documents')).toEqual([]);
  await expect(rpc(B.user, 'record_document_print', [A.tenant, d.id, 'print', 'browser', null, 'print-key-b001'])).rejects.toThrow(/Acesso negado/);
  const printer = await rpc<string>(A.user, 'save_printer_profile', [A.tenant, { name: 'Caixa 01', kind: 'thermal', paperId: 'thermal-80', branchId: A.branch, docTypes: ['sale'], isDefault: true }]);
  const bDoc = await rpc<Issued>(B.user, 'issue_document', [B.tenant, 'inventory', B.branch]);
  await expect(rpc(B.user, 'record_document_print', [B.tenant, bDoc.id, 'print', 'browser', printer, 'print-key-b002'])).rejects.toThrow(/não pertence/);
  expect(await as(db, B.user, 'select id from public.printer_profiles')).toEqual([]);
});

test('link seguro: token aleatório, só hash no banco, sem contato do cliente; revogado, expirado e forjado não abrem', async () => {
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  const link = await rpc<{ token: string }>(A.user, 'create_document_link', [A.tenant, d.id, 7]);
  expect(link.token).toMatch(/^[0-9a-f]{48}$/);
  expect((await db.query('select 1 from public.document_share_tokens where token_hash = $1', [link.token])).rows).toHaveLength(0);
  const pub = await rpc<{ snapshot: Issued['snapshot'] }>(null, 'document_public', [link.token]);
  expect(pub.snapshot.number).toBe(d.number); expect(pub.snapshot.customer).toEqual({ name: 'João Cliente' });
  expect(await rpc(null, 'document_public', ['0'.repeat(48)])).toBeNull();
  expect(await rpc(null, 'document_public', ["' or 1=1 --"])).toBeNull();
  await rpc(A.user, 'revoke_document_links', [A.tenant, d.id]);
  expect(await rpc(null, 'document_public', [link.token])).toBeNull();
  const l2 = await rpc<{ token: string }>(A.user, 'create_document_link', [A.tenant, d.id, 1]);
  await service(db, "update public.document_share_tokens set expires_at = now() - interval '1 minute' where revoked_at is null");
  expect(await rpc(null, 'document_public', [l2.token])).toBeNull();
  await expect(as(db, null, 'select 1 from public.generated_documents')).rejects.toThrow(/permission denied/);
});

test('e-mail: valida destinatário, enfileira com template de documento, idempotente; histórico mostra situação real', async () => {
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  await expect(rpc(A.user, 'send_document_email', [A.tenant, d.id, 'nao-e-email', '', 'mail-key-001'])).rejects.toThrow(/inválido/);
  const first = await rpc<{ duplicate: boolean }>(A.user, 'send_document_email', [A.tenant, d.id, 'joao@cliente.invalid', 'Segue seu comprovante.', 'mail-key-002']);
  const again = await rpc<{ duplicate: boolean }>(A.user, 'send_document_email', [A.tenant, d.id, 'joao@cliente.invalid', 'Segue seu comprovante.', 'mail-key-002']);
  expect(first.duplicate).toBe(false); expect(again.duplicate).toBe(true);
  const mails = (await db.query<{ data: Record<string, string> }>("select data from public.email_messages where template = 'document'")).rows;
  expect(mails).toHaveLength(1); expect(mails[0].data.token).toMatch(/^[0-9a-f]{48}$/); expect(mails[0].data.store).toBe('Moto Prime Docs');
  const hist = await rpc<{ kind: string; status: string; recipient: string }[]>(A.user, 'document_history', [A.tenant, d.id, 50]);
  expect(hist.find(h => h.kind === 'email')).toMatchObject({ status: 'pending', recipient: 'jo***@cliente.invalid' });
  await service(db, "update public.email_messages set status = 'sent' where template = 'document'");
  expect((await rpc<{ kind: string; status: string }[]>(A.user, 'document_history', [A.tenant, d.id, 50])).find(h => h.kind === 'email')!.status).toBe('accepted');
});

test('WhatsApp: exige consentimento, telefone válido e instância conectada; tudo validado antes de enviar', async () => {
  const d = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  await expect(rpc(A.user, 'prepare_document_whatsapp', [A.tenant, d.id, customer, 'Olá, segue o comprovante.', 'wa-key-0001'])).rejects.toThrow(/não está conectado/);
  const noConsent = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Sem Consentimento', phone: '11977776666', consent: false }]);
  await expect(rpc(A.user, 'prepare_document_whatsapp', [A.tenant, d.id, noConsent, 'Olá, segue o comprovante.', 'wa-key-0002'])).rejects.toThrow(/não autorizou/);
  await service(db, "insert into public.whatsapp_instances (tenant_id, instance_name, status) values ($1, 'pistec-docs-test-0001', 'open')", [A.tenant]);
  const p = await rpc<{ number: string; instance: string; duplicate: boolean }>(A.user, 'prepare_document_whatsapp', [A.tenant, d.id, customer, 'Olá, segue o comprovante.', 'wa-key-0003']);
  expect(p).toMatchObject({ number: '5511988887777', instance: 'pistec-docs-test-0001', duplicate: false });
  expect((await rpc<{ duplicate: boolean }>(A.user, 'prepare_document_whatsapp', [A.tenant, d.id, customer, 'Olá, segue o comprovante.', 'wa-key-0003'])).duplicate).toBe(true);
});

test('permissão e cancelamento: Mecânico não emite comprovante nem configura impressora; cancelamento só para venda cancelada', async () => {
  const mech = await createUser(db, 'mec@docs.invalid');
  await service(db, "insert into public.memberships (tenant_id, user_id, role) values ($1, $2, 'Mecânico')", [A.tenant, mech]);
  await expect(rpc(mech, 'issue_document', [A.tenant, 'sale', sale])).rejects.toThrow(/não permite/);
  await expect(rpc(mech, 'save_printer_profile', [A.tenant, { name: 'X', kind: 'common', paperId: 'a4' }])).rejects.toThrow(/proprietário, administrador ou gerente/);
  await expect(rpc(A.user, 'issue_document', [A.tenant, 'sale-cancel', sale])).rejects.toThrow(/não está cancelada/);
  await rpc(A.user, 'cancel_sale', [A.tenant, sale]);
  const c = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale-cancel', sale]);
  expect(c.number).toMatch(/^CAN-/); expect(c.snapshot.sale.status).toBe('Cancelada');
  const s2 = await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale]);
  expect(s2.version).toBe(2); expect(s2.number).toBe((await rpc<Issued>(A.user, 'issue_document', [A.tenant, 'sale', sale])).number);
  expect(s2.snapshot.company.address).toBe('Rua das Motos, 100 - Centro'); // identidade da 1ª emissão mantida
});
