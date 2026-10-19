// Migrations incrementais pela API oficial; nunca reescreve migrations aplicadas.
// node --env-file=.env.local scripts/migrate-backend.mjs --project <ref> [--apply]
import { readdirSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2), ref = process.env.SUPABASE_PROJECT_REF;
if (!ref || args[0] !== '--project' || args[1] !== ref || !process.env.SUPABASE_ACCESS_TOKEN) throw new Error('Informe o projeto autorizado e carregue o ambiente local.');
async function query(sql) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST', headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }), signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`Supabase HTTP ${response.status}: ${(await response.text()).slice(0,1000)}`);
  return response.json();
}
const applied = await query('select version, statements from supabase_migrations.schema_migrations order by version');
const files = readdirSync('supabase/migrations').filter(f => /^\d+_.+\.sql$/.test(f)).sort();
const pending = [];
for (const file of files) {
  const [, version, name] = file.match(/^(\d+)_(.+)\.sql$/), sql = readFileSync(`supabase/migrations/${file}`, 'utf8');
  const prior = applied.find(m => m.version === version);
  if (prior) {
    if (prior.statements?.join('\n').replaceAll('\r\n','\n') !== sql.replaceAll('\r\n','\n')) throw new Error(`Migration aplicada mudou: ${file}. Crie nova migration.`);
  } else pending.push({ version, name, sql });
}
console.log(`${applied.length} aplicadas; ${pending.length} pendentes: ${pending.map(m => m.version).join(', ')}`);
if (!args.includes('--apply') || !pending.length) process.exit(0);
const quote = value => "'" + value.replaceAll("'", "''") + "'";
let sql = "begin; set local lock_timeout='10s'; set local statement_timeout='90s'; select pg_advisory_xact_lock(hashtextextended('pistec-migrations',0));\n";
for (const migration of pending) sql += `${migration.sql}\ninsert into supabase_migrations.schema_migrations(version,name,statements) values(${quote(migration.version)},${quote(migration.name)},array[${quote(migration.sql)}]);\n`;
sql += "notify pgrst, 'reload schema'; commit;";
await query(sql);
console.log('Migrations aplicadas em transação única.');
