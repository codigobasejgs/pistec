// O rollback do catálogo remove só objetos novos; planos, preços e contratação continuam funcionando.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { as, createDb, type Db } from './harness';

let db: Db;
afterAll(async () => { await db?.close(); });

test('rollback 20261105000100 remove catálogo e restaura contract_catalog com plans.features', async () => {
  db = await createDb();
  const before = (await db.query('select id, monthly, quarterly, annual, modules from public.plans order by sort')).rows;
  const sql = readFileSync(join(import.meta.dirname, '..', 'rollback', '20261105000100_feature_catalog.down.sql'), 'utf8')
    .replace(/delete from supabase_migrations[^;]*;/, ''); // PGlite não tem o esquema de controle do Supabase
  await db.exec(sql);
  expect((await db.query("select 1 from information_schema.tables where table_name = 'feature_catalog'")).rows).toEqual([]);
  expect((await db.query("select 1 from pg_proc where proname in ('plan_catalog','admin_set_feature_status','plan_feature_names')")).rows).toEqual([]);
  expect((await db.query('select id, monthly, quarterly, annual, modules from public.plans order by sort')).rows).toEqual(before);
  const cat = (await as<{ r: { plans: { id: string; features: string[] }[] } }>(db, null, 'select public.contract_catalog() r'))[0].r;
  const legacy = (await db.query<{ features: string[] }>("select features from public.plans where id = 'essencial'")).rows[0].features;
  expect(cat.plans.find(p => p.id === 'essencial')!.features).toEqual(legacy);
}, 180000);
