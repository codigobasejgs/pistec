// White Label PWA 5.0: cada empresa publica o próprio app; isolamento, plano, Super Admin e leitura pública mínima.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { as, createDb, createUser, tenantFor, type Db } from './harness';

let db: Db;
let A: Awaited<ReturnType<typeof tenantFor>>, B: Awaited<ReturnType<typeof tenantFor>>, E: Awaited<ReturnType<typeof tenantFor>>;
let owner: string;
const png = 'data:image/png;base64,iVBORw0KGgo=';
const icons = { 192: png, 512: png, maskable: png, apple: png, favicon: png };
const app = (name: string) => ({ name, shortName: name.slice(0, 12), themeColor: '#0a3d91', backgroundColor: '#ffffff', icons });
const rpc = <T = unknown>(user: string | null, fn: string, args: unknown[]) =>
  as<{ r: T }>(db, user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(rows => rows[0]?.r as T);
const slug = async (tenant: string) => (await db.query<{ slug: string }>('select slug from public.tenants where id = $1', [tenant])).rows[0].slug;

beforeAll(async () => {
  db = await createDb();
  A = await tenantFor(db, 'a@apps.invalid', 'Loja Apps A', 'premium');
  B = await tenantFor(db, 'b@apps.invalid', 'Oficina Apps B', 'enterprise');
  E = await tenantFor(db, 'e@apps.invalid', 'Loja Essencial', 'essencial');
  owner = await createUser(db, 'owner@apps.invalid');
  await db.query("insert into public.platform_admins(user_id, role) values ($1, 'owner')", [owner]);
}, 120000);
afterAll(async () => { await db?.close(); });

test('A e B publicam apps próprios; versão incrementa; leitura pública devolve só identidade visual', async () => {
  expect(await rpc(A.user, 'save_tenant_app', [A.tenant, app('Loja A Peças')])).toBe(1);
  expect(await rpc(A.user, 'save_tenant_app', [A.tenant, app('Loja A Peças 2')])).toBe(2);
  await rpc(B.user, 'save_tenant_app', [B.tenant, app('Oficina B')]);
  const pubA = await rpc<Record<string, unknown>>(null, 'tenant_app_public', [await slug(A.tenant)]);
  const pubB = await rpc<Record<string, unknown>>(null, 'tenant_app_public', [await slug(B.tenant)]);
  expect(pubA).toMatchObject({ name: 'Loja A Peças 2', version: 2, tenantName: 'Loja Apps A' });
  expect(pubB).toMatchObject({ name: 'Oficina B', version: 1 });
  expect(Object.keys(pubA).sort()).toEqual(['backgroundColor', 'icons', 'name', 'primary', 'shortName', 'slug', 'tenantName', 'themeColor', 'version']);
  expect(await rpc(null, 'tenant_app_public', ['inexistente'])).toBeNull();
});

test('isolamento: A não grava nem lê o app de B; anônimo não lê a tabela', async () => {
  await expect(rpc(A.user, 'save_tenant_app', [B.tenant, app('Invasor')])).rejects.toThrow(/Acesso negado/);
  expect(await as(db, A.user, 'select tenant_id from public.tenant_apps')).toEqual([{ tenant_id: A.tenant }]);
  await expect(as(db, null, 'select 1 from public.tenant_apps')).rejects.toThrow(/permission denied/);
});

test('plano sem custom_branded_pwa e ícones inválidos são recusados', async () => {
  await expect(rpc(E.user, 'save_tenant_app', [E.tenant, app('Essencial')])).rejects.toThrow(/plano não inclui/);
  await expect(rpc(A.user, 'save_tenant_app', [A.tenant, { ...app('X'), icons: { ...icons, 192: 'data:image/svg+xml;base64,PHN2Zz4=' } }])).rejects.toThrow(/Gere os ícones/);
  await expect(rpc(A.user, 'save_tenant_app', [A.tenant, { ...app('X'), themeColor: 'red' }])).rejects.toThrow();
});

test('Super Admin suspende com justificativa: some da leitura pública, loja não republica; reativar devolve', async () => {
  await expect(rpc(A.user, 'admin_set_tenant_app', [A.tenant, false, 'motivo qualquer'])).rejects.toThrow(/Super Admin/);
  await expect(rpc(owner, 'admin_set_tenant_app', [A.tenant, false, 'ok'])).rejects.toThrow(/justificativa/);
  await rpc(owner, 'admin_set_tenant_app', [A.tenant, false, 'Logotipo de terceiros']);
  expect(await rpc(null, 'tenant_app_public', [await slug(A.tenant)])).toBeNull();
  await expect(rpc(A.user, 'save_tenant_app', [A.tenant, app('Volta')])).rejects.toThrow(/suspenso/);
  expect((await db.query("select 1 from public.audit_logs where action = 'Aplicativo personalizado suspenso'")).rows).toHaveLength(1);
  await rpc(owner, 'admin_set_tenant_app', [A.tenant, true, 'Logotipo regularizado']);
  expect(await rpc(null, 'tenant_app_public', [await slug(A.tenant)])).toMatchObject({ name: 'Loja A Peças 2' });
});
