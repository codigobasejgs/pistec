// Executa SQL no projeto Supabase via API de gerenciamento (sem Docker/psql).
// Uso: node scripts/sb.mjs "select 1"   |   node scripts/sb.mjs --file supabase/migrations/x.sql
// Lê SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF de .env.local (nunca versionado).
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_REF: ref } = env;
if (!token || !ref) { console.error('Defina SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF em .env.local'); process.exit(2); }

const args = process.argv.slice(2);
const query = args[0] === '--file' ? readFileSync(args[1], 'utf8') : args.join(' ');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }),
});
const text = await res.text();
if (!res.ok) { console.error(`HTTP ${res.status}: ${text}`); process.exit(1); }
console.log(text);
