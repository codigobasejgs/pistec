// O rollback da migração NEXT restaura as RPCs originais e remove só as tabelas novas.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { as, createDb, tenantFor, type Db } from './harness';

let db: Db;
afterAll(async () => { await db?.close(); });

test('rollback 20261104000100 restaura save_record/transition_record e preserva dados existentes', async () => {
  db = await createDb();
  const A = await tenantFor(db, 'rb@next.invalid', 'Oficina Rollback');
  const rpc = (fn: string, args: unknown[]) => as<{ r: unknown }>(db, A.user, `select public.${fn}(${args.map((_, i) => `$${i + 1}`).join(', ')}) r`, args).then(r => r[0]?.r);
  const customer = await rpc('save_customer', [A.tenant, { name: 'Cliente RB', phone: '11999990000' }]);
  const sql = readFileSync(join(import.meta.dirname, '..', 'rollback', '20261104000100_pistec_next.down.sql'), 'utf8')
    .replace(/delete from supabase_migrations[^;]*;/, ''); // PGlite não tem o esquema de controle do Supabase
  await db.exec(sql);
  const tables = (await db.query<{ t: string }>("select table_name t from information_schema.tables where table_schema = 'public' and table_name in ('workshop_settings','record_attachments','customer_links','estimate_decisions')")).rows;
  expect(tables).toEqual([]);
  expect((await db.query("select 1 from public.customers where id = $1", [customer])).rows).toHaveLength(1);
  // OS sem itens e sem mão de obra volta a ser recusada (regra original), e o tipo cotacoes deixa de existir.
  await expect(rpc('save_record', [A.tenant, { branchId: A.branch, kind: 'ordens-servico', title: 'OS', customerId: customer, fields: { technician: 'x', dueDate: '2099-01-01', complaint: 'x', checkin: '{}' } }])).rejects.toThrow(/mão de obra/);
  await expect(rpc('save_record', [A.tenant, { branchId: A.branch, kind: 'cotacoes', title: 'Q', items: [] }])).rejects.toThrow(/Tipo de registro inválido|Módulo/);
  const id = await rpc('save_record', [A.tenant, { branchId: A.branch, kind: 'ordens-servico', title: 'OS ok', customerId: customer, fields: { technician: 'x', dueDate: '2099-01-01', complaint: 'x', labor: '10,00' } }]);
  expect(id).toBeTruthy();
}, 180000);

test('rollback: set_whatsapp_bot e resumo do Super Admin voltam à versão anterior', async () => {
  const src = (await db.query<{ s: string }>("select string_agg(prosrc, '|') s from pg_proc where proname in ('set_whatsapp_bot', 'admin_integration_summary')")).rows[0].s;
  expect(src).not.toMatch(/whatsapp_bot_replies|ai_settings/);
  expect((await db.query("select 1 from pg_proc where proname in ('svc_bot_claim','whatsapp_bot_status','portal_view')")).rows).toEqual([]);
});
