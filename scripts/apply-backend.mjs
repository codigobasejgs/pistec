// Alternativa à CLI quando a conexão PostgreSQL falha; API oficial, transação única.
// Uso autorizado: node --env-file=.env.local scripts/apply-backend.mjs --apply --project <ref>
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const ref = process.env.SUPABASE_PROJECT_REF;
const token = process.env.SUPABASE_ACCESS_TOKEN;
const args = process.argv.slice(2);
if (!ref || !token || args[0] !== '--apply' || args[1] !== '--project' || args[2] !== ref) {
  throw new Error('Informe --apply --project com o projeto explicitamente autorizado e carregue o ambiente local.');
}
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`API Supabase HTTP ${response.status}: ${(await response.text()).slice(0,1500)}`);
  return response.json();
}
const existing = await query("select tablename from pg_tables where schemaname in ('public','supabase_migrations')");
if (existing.length) throw new Error('Banco não está vazio. Use migrations incrementais via CLI; nenhuma alteração executada.');
const files = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort();
if (!files.length) throw new Error('Nenhuma migration encontrada.');
const quote = text => "'" + text.replaceAll("'", "''") + "'";
let sql = `begin;
set local lock_timeout = '10s';
set local statement_timeout = '90s';
create schema if not exists supabase_migrations;
create table supabase_migrations.schema_migrations (version text not null primary key, statements text[], name text);
`;
for (const file of files) {
  const content = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/);
  console.log(`${file} sha256:${createHash('sha256').update(content).digest('hex')}`);
  sql += `${content}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values (${quote(version)},${quote(name)},array[${quote(content)}]);\n`;
}
sql += "notify pgrst, 'reload schema';\ncommit;";
await query(sql);
console.log(`Aplicadas ${files.length} migrations em transação única; histórico registrado.`);
