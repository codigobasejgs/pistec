// Postgres real em processo (PGlite) com o mínimo do Supabase: roles, auth.users, auth.uid()/jwt(), extensions.
// Aplica supabase/migrations/*.sql em ordem — os mesmos arquivos aplicados no projeto remoto.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const SUPABASE_STUB = `
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
create schema auth; create schema extensions;
create extension pgcrypto with schema extensions;
create table auth.users (id uuid primary key, email text, email_confirmed_at timestamptz, raw_user_meta_data jsonb default '{}');
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
grant usage on schema auth, extensions to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
grant execute on all functions in schema extensions to anon, authenticated, service_role;
`;

export const MIGRATIONS = join(import.meta.dirname, '..', 'migrations');

export async function createDb() {
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(SUPABASE_STUB);
  for (const file of readdirSync(MIGRATIONS).filter(name => name.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIGRATIONS, file), 'utf8');
    try { await db.exec(sql); }
    catch (error) {
      // Localiza o comando com erro: blocos que começam em "create"/"do"/... na coluna 0.
      const chunks = sql.split(/\n(?=(?:create|do|alter|grant|revoke|insert) )/);
      const probe = new PGlite({ extensions: { pgcrypto } });
      let failing = '';
      try { await probe.exec(SUPABASE_STUB); for (const prior of readdirSync(MIGRATIONS).filter(n => n.endsWith('.sql') && n < file).sort()) await probe.exec(readFileSync(join(MIGRATIONS, prior), 'utf8'));
        for (const chunk of chunks) { try { await probe.exec(chunk); } catch { failing = chunk.split('\n')[0]; break; } } } catch { /* diagnóstico opcional */ }
      throw new Error(`${file}: ${(error as Error).message}${failing ? ` — em: ${failing}` : ''}`);
    }
  }
  return db;
}

export type Db = Awaited<ReturnType<typeof createDb>>;
let seq = 0;
export const uuid = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;

export async function createUser(db: Db, email: string, name = email.split('@')[0]) {
  const id = uuid();
  await db.query('insert into auth.users (id, email, email_confirmed_at, raw_user_meta_data) values ($1, $2, now(), $3)', [id, email, { name }]);
  return id;
}

/** Executa como usuário autenticado (RLS ativa), igual ao PostgREST. aal2 = sessão com MFA. */
export async function as<T = Record<string, unknown>>(db: Db, user: string | null, sql: string, params: unknown[] = [], aal = 'aal1') {
  return db.transaction(async tx => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [user ? JSON.stringify({ sub: user, role: 'authenticated', aal }) : '{}']);
    await tx.exec(user ? 'set local role authenticated' : 'set local role anon');
    return (await tx.query<T>(sql, params)).rows;
  });
}

export async function service<T = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []) {
  return db.transaction(async tx => {
    await tx.exec('set local role service_role');
    return (await tx.query<T>(sql, params)).rows;
  });
}

/** Cria usuário + empresa via onboarding real. */
export async function tenantFor(db: Db, email: string, name: string, planId = 'premium') {
  const user = await createUser(db, email);
  const [row] = await as<{ r: { tenantId: string; branchId: string } }>(db, user, 'select public.onboard_tenant($1) r', [{ name, planId, owner: name }]);
  return { user, tenant: row.r.tenantId, branch: row.r.branchId };
}
