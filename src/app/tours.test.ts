import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { tours } from './tours';

// Coleta todos os data-tour declarados no código (estáticos e os gerados por prefixo de módulo).
function sources(dir: string): string[] { return readdirSync(dir).flatMap(f => { const p = join(dir, f); return statSync(p).isDirectory() ? sources(p) : p.endsWith('.tsx') ? [p] : []; }); }
const code = sources('src').map(f => readFileSync(f, 'utf8')).join('\n');
const declared = new Set<string>();
for (const m of code.matchAll(/(?:data-tour|tour)=(?:"|\{'|\{`)([a-z0-9-]+)(?:"|'|`)/g)) declared.add(m[1]);
for (const m of code.matchAll(/'([a-z0-9-]+)' : (?:'([a-z0-9-]+)'|undefined)/g)) { declared.add(m[1]); if (m[2]) declared.add(m[2]); }
const kinds = ['crm', 'ordens-servico', 'agenda', 'tarefas', 'orcamentos', 'compras', 'veiculos', 'fornecedores', 'garantias', 'clientes'];
for (const k of kinds) for (const s of ['-table', '-new', '-kanban']) declared.add(k + s);
for (const p of ['dashboard', 'produtos', 'estoque', 'pdv', 'financeiro', 'caixa', 'whatsapp', 'relatorios', 'ordens-servico', 'crm', 'agenda', 'personalizacao', 'minha-assinatura']) declared.add(`nav-${p}`);

it('todo passo de tour aponta para um data-tour existente no código', () => {
  const missing = Object.entries(tours).flatMap(([mod, steps]) => steps.flatMap(s => [s.target, s.before].filter(Boolean).filter(t => !declared.has(t!)).map(t => `${mod}: ${t}`)));
  expect(missing).toEqual([]);
});
