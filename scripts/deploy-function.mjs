// Publica uma Edge Function pela API de gerenciamento (alternativa ao CLI quando ele falha na rede).
// Uso: node scripts/deploy-function.mjs <nome> [--no-verify-jwt]   (lê SUPABASE_ACCESS_TOKEN e SUPABASE_PROJECT_REF de .env.local)
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const [name, flag] = process.argv.slice(2);
if (!name || !/^[a-z0-9-]+$/.test(name)) { console.error('Informe o nome da função.'); process.exit(2); }
const root = 'supabase/functions';
const walk = dir => readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : /\.(ts|js|json)$/.test(f) && !/\.test\.ts$/.test(f) ? [p] : []; });
const files = [...walk(join(root, name)), ...walk(join(root, '_shared'))];
const form = new FormData();
form.append('metadata', JSON.stringify({ name, entrypoint_path: `${name}/index.ts`, verify_jwt: flag !== '--no-verify-jwt' }));
for (const f of files) form.append('file', new Blob([readFileSync(f)], { type: 'application/typescript' }), relative(root, f).replace(/\\/g, '/'));
const res = await fetch(`https://api.supabase.com/v1/projects/${env.SUPABASE_PROJECT_REF}/functions/deploy?slug=${name}`, { method: 'POST', headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` }, body: form });
const body = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`HTTP ${res.status}`, JSON.stringify(body).slice(0, 400)); process.exit(1); }
console.log(`${name}: versão ${body.version} (${body.status}), ${files.length} arquivos`);
