// Endereço estruturado: validação no servidor, onboarding, empresa, cliente, Super Admin e isolamento.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>;
const addr = { zip: '01001-000', street: 'Praça da Sé', number: '100', complement: 'Sala 2', district: 'Sé', city: 'São Paulo', state: 'SP' };
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const tenant = async (id: string) => (await db.query<{ address: string; address_data: Record<string, string> }>('select address, address_data from public.tenants where id = $1', [id])).rows[0];

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@addr.invalid', 'Oficina Endereço A');
  B = await tenantFor(db, 'b@addr.invalid', 'Oficina Endereço B');
}, 120000);
afterAll(async () => { await db?.close(); });

test('onboarding real grava endereço confirmado na empresa e na matriz', async () => {
  const user = await createUser(db, 'c@addr.invalid');
  const r = await rpc<{ tenantId: string; branchId: string }>(user, 'onboard_tenant', [{ name: 'Oficina Com Endereço', planId: 'essencial', owner: 'C', address: addr }]);
  const t = await tenant(r.tenantId);
  expect(t.address_data).toEqual({ ...addr, zip: '01001000' });
  expect(t.address).toBe('Praça da Sé, 100, Sala 2, Sé, São Paulo/SP, CEP 01001-000');
  const [b] = (await db.query<{ address: string }>('select address from public.branches where id = $1', [r.branchId])).rows;
  expect(b.address).toBe(t.address);
  // sem endereço continua funcionando (texto vazio)
  const r2 = await rpc<{ tenantId: string }>(await createUser(db, 'd@addr.invalid'), 'onboard_tenant', [{ name: 'Sem Endereço', planId: 'essencial', owner: 'D' }]);
  expect((await tenant(r2.tenantId)).address).toBe('');
});

test('servidor rejeita CEP, UF e campos obrigatórios inválidos', async () => {
  await expect(rpc(A.user, 'update_tenant_address', [A.tenant, { ...addr, zip: '0100' }])).rejects.toThrow(/CEP/);
  await expect(rpc(A.user, 'update_tenant_address', [A.tenant, { ...addr, state: 'XX' }])).rejects.toThrow(/UF/);
  await expect(rpc(A.user, 'update_tenant_address', [A.tenant, { ...addr, number: '' }])).rejects.toThrow(/número/);
  await expect(rpc(A.user, 'update_tenant_address', [A.tenant, {}])).rejects.toThrow();
});

test('empresa atualiza o próprio endereço; outra empresa e anônimo não', async () => {
  await rpc(A.user, 'update_tenant_address', [A.tenant, { ...addr, complement: '' }]);
  expect((await tenant(A.tenant)).address).toBe('Praça da Sé, 100, Sé, São Paulo/SP, CEP 01001-000');
  await expect(rpc(B.user, 'update_tenant_address', [A.tenant, addr])).rejects.toThrow();
  await expect(rpc(null, 'update_tenant_address', [A.tenant, addr])).rejects.toThrow(/permission denied/);
});

test('cliente: endereço estruturado opcional; texto livre antigo continua aceito', async () => {
  const id = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Cliente CEP', phone: '11999990000', addressData: addr }]);
  const [c] = (await db.query<{ address: string; address_data: Record<string, string> }>('select address, address_data from public.customers where id = $1', [id])).rows;
  expect(c.address_data.zip).toBe('01001000');
  expect(c.address).toContain('CEP 01001-000');
  const id2 = await rpc<string>(A.user, 'save_customer', [A.tenant, { name: 'Cliente Livre', phone: '11999990001', address: 'Rua antiga, 1' }]);
  const [c2] = (await db.query<{ address: string; address_data: unknown }>('select address, address_data from public.customers where id = $1', [id2])).rows;
  expect(c2).toEqual({ address: 'Rua antiga, 1', address_data: {} });
  await expect(rpc(A.user, 'save_customer', [A.tenant, { name: 'Cliente Ruim', phone: '1199', addressData: { ...addr, zip: '1' } }])).rejects.toThrow(/CEP/);
});

test('Super Admin salva endereço estruturado da empresa', async () => {
  const owner = await createUser(db, 'owner@addr.invalid');
  await db.query("insert into public.platform_admins(user_id, role) values ($1, 'owner')", [owner]);
  const t = await tenant(B.tenant);
  await rpc(owner, 'admin_save_tenant', [{ id: B.tenant, name: 'Oficina Endereço B', email: 'b@addr.invalid', addressData: { ...addr, number: '200' } }]);
  const after = await tenant(B.tenant);
  expect(after.address_data.number).toBe('200');
  expect(after.address).not.toBe(t.address);
});
