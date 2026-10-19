// Verificação somente leitura dos provedores (nenhum envio, cobrança ou criação).
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/).filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
const show = async (name, p) => { try { const r = await p; const t = await r.text(); console.log(`${name}: HTTP ${r.status} ${t.slice(0, 400).replace(/\s+/g, ' ')}`); } catch (e) { console.log(`${name}: ERRO ${e.message}`); } };
await show('Evolution /', fetch(env.EVOLUTION_API_URL + '/', { headers: { apikey: env.EVOLUTION_API_KEY } }));
await show('Gemini models', fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=50&key=${env.GEMINI_API_KEY}`).then(async r => new Response(JSON.stringify({ status: r.status, models: (await r.json()).models?.map(m => m.name).filter(n => /gemini-(2|3)/.test(n)) }), { status: r.status })));
await show('Resend domains', fetch('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${env.RESEND_API_KEY}` } }));
