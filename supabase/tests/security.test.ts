import { beforeAll, afterAll, expect, test } from 'vitest';
import { as, createDb, createUser, tenantFor, service, type Db, uuid } from './harness';
let db: Db;
let owner: Awaited<ReturnType<typeof tenantFor>>;
let restricted: string;
beforeAll(async () => {
  db = await createDb();
  owner = await tenantFor(db, 'owner@security.invalid', 'Segurança');
  restricted = await createUser(db, 'restricted@security.invalid');
  await db.query(`insert into public.memberships (tenant_id,user_id,role,branch_ids) values ($1,$2,'Caixa','{}')`, [owner.tenant, restricted]);
}, 120000);
afterAll(async () => { await db?.close(); });

test('helpers internos não são executáveis por clientes, mesmo com membership', async () => {
  const functions = await db.query<{ name: string }>(`select p.proname name from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='app' and has_function_privilege('authenticated',p.oid,'EXECUTE') order by 1`);
  expect(functions.rows.map(r => r.name)).toEqual(['can_branch','can_read','is_member','is_platform_admin','membership','record_module','role_can']);
  await expect(as(db, restricted, `select app.add_finance($1,$2,'Receita','Teste','Teste',100,current_date,true,'forjado')`, [owner.tenant, owner.branch])).rejects.toThrow(/permission denied/);
});

test('RLS bloqueia estoque, caixa e registros de filial não autorizada', async () => {
  await as(db, owner.user, 'select public.open_cash($1,$2,100)', [owner.tenant, owner.branch]);
  await as(db, owner.user, `select public.save_record($1,$2)`, [owner.tenant, { kind: 'ordens-servico', title: 'OS', branchId: owner.branch, fields: { labor: '10,00' } }]);
  const id = uuid();
  await db.query(`insert into public.products(id,tenant_id,name,sku) values($1,$2,'Peça','PECA')`, [id, owner.tenant]);
  await db.query(`insert into public.stock_balances(tenant_id,branch_id,product_id,quantity) values($1,$2,$3,1)`, [owner.tenant, owner.branch, id]);
  for (const table of ['records','cash_registers','stock_balances']) expect(await as(db, restricted, `select 1 from public.${table}`)).toEqual([]);
});

test('estados finais não entram pela criação de registros', async () => {
  await expect(as(db, owner.user, 'select public.save_record($1,$2)', [owner.tenant, { kind: 'ordens-servico', title: 'OS adulterada', status: 'Entregue', branchId: owner.branch, fields: { labor: '10,00' } }])).rejects.toThrow(/Estado inicial inválido/);
});

test('gerente não amplia acesso por convite ou outro membro', async () => {
  await db.query(`update public.memberships set role='Gerente' where user_id=$1`, [restricted]);
  await expect(as(db, restricted, `select public.invite_member($1,'terceiro@security.invalid','Gerente',null)`, [owner.tenant])).rejects.toThrow(/Somente proprietário/);
  const third = await createUser(db, 'third@security.invalid');
  await db.query(`insert into public.memberships(tenant_id,user_id,role,branch_ids) values($1,$2,'Caixa','{}')`, [owner.tenant, third]);
  await expect(as(db, restricted, `select public.set_member($1,$2,'Gerente',true,null)`, [owner.tenant, third])).rejects.toThrow(/Somente proprietário/);
});

test('reserva de quota IA impede segunda chamada sem depender do provedor', async () => {
  await as(db, owner.user, 'select public.save_ai_settings($1,$2)', [owner.tenant, { enabled: true, dailyLimit: 1 }]);
  const take = () => service<{ id: number | null }>(db, `select app.svc_ai_take_quota($1,'app') id`, [owner.tenant]);
  expect(Number((await take())[0].id)).toBeGreaterThan(0);
  expect((await take())[0].id).toBeNull();
});

test('transferência repete sem duplicar e rejeita chave com outro conteúdo', async () => {
  const branch = uuid();
  await db.query(`insert into public.branches(id,tenant_id,name) values($1,$2,'Destino')`, [branch, owner.tenant]);
  const { rows: [product] } = await db.query<{ id: string }>('select id from public.products where tenant_id=$1', [owner.tenant]);
  const transfer = (quantity: number) => as(db, owner.user, 'select public.transfer_stock($1,$2,$3,$4,$5,$6)', [owner.tenant, owner.branch, branch, product.id, quantity, 'retry-transfer']);
  await transfer(1);
  await transfer(1);
  await expect(transfer(2)).rejects.toThrow(/outro conteúdo/);
  expect((await db.query<{ quantity: number }>('select quantity from public.stock_balances where branch_id=$1', [branch])).rows).toEqual([{ quantity: 1 }]);
});
