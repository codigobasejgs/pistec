# PISTEC 2.0 — Relatório de QA

**Data:** 15/10/2026 · **Ambiente:** Windows 10, Node 22, Google Chrome (headless, emulação de viewport) · **Commit base:** `aae0072`

**Estado:** APROVADO COM RESSALVAS para demonstração comercial. Não homologado para produção (não há backend).

Estados usados: APROVADO · APROVADO COM RESSALVAS · REPROVADO · NÃO TESTADO · NÃO APLICÁVEL.

---

## 1. O que foi medido

| Verificação | Resultado | Como reproduzir |
|---|---|---|
| Vitest | 156/156 | `npm test` |
| Playwright (Chrome) | 36 cenários + 14 larguras de layout, todos passando | `npm run test:e2e` |
| TypeScript estrito | 0 erros | `npm run typecheck` |
| ESLint | 0 erros, 0 avisos | `npm run lint` |
| Build | OK | `npm run build` |
| axe-core (WCAG 2.0/2.1/2.2 A e AA) | 16 cenários, 0 violações | `node scripts/a11y-audit.mjs` (servidor dev ativo) |

Tudo acima roda **somente no Chrome em desktop**, com emulação de largura. Nenhum teste em Firefox, Safari ou dispositivo físico.

---

## 2. Funcionalidades declaradas na v2.0

| Funcionalidade | Estado | Evidência |
|---|---|---|
| Troco no PDV, pagamento misto | APROVADO | `flows.e2e.ts` fluxos 1–2: troco exibido, caixa recebe só o líquido, cartão acima do total e pagamento insuficiente bloqueados |
| Baixas financeiras parciais | APROVADO | `flows.e2e.ts` fluxo 6: 300 → parcial, 700 → quitado, estorno volta a parcial, baixa acima do saldo bloqueada |
| Cupons SaaS | APROVADO | `admin.e2e.ts`: 15% em Profissional = R$ 211,65, fatura Pendente; inexistente, expirado e reuso recusados |
| Importação CSV/XLSX | APROVADO COM RESSALVAS | CSV testado pela interface (`erp.e2e.ts`). XLSX testado só na lógica (`erp-features.test.ts`), não pela interface com arquivo real |
| Sessão demo persistida | APROVADO | `v2.e2e.ts`: empresa, papel e filial sobrevivem ao reload; sair limpa |
| Migração IndexedDB v1→v2 | APROVADO | `domain.test.ts` com snapshot v1 real (`src/__fixtures__/state-v1.json`) e falha transacional |
| PWA instalável | APROVADO COM RESSALVAS | Ver §4. Critérios técnicos validados; instalação real não executada |
| Tour com spotlight | APROVADO COM RESSALVAS | Ver §5 |

---

## 3. Fluxos de negócio (pela interface, Chrome)

| Fluxo | Estado |
|---|---|
| Venda: produto → entrada → caixa → PDV com troco → estoque, vendas, caixa → reload | APROVADO |
| Cancelamento devolve estoque e caixa uma única vez | APROVADO |
| Compra: pedido → recebimento → estoque e conta a pagar | APROVADO |
| Oficina: orçamento → aprovar → OS (sem duplicar) → reserva → Pronta consome | APROVADO |
| Financeiro: parcial, quitação, estorno | APROVADO |
| Fechamento de caixa com diferença exige motivo | APROVADO |
| Multi-tenant: produto e tema isolados entre empresas | APROVADO |
| Permissões: Mecânico sem Financeiro e sem excluir produto | APROVADO |
| SaaS: onboarding → empresa em teste → Super Admin; suspensão bloqueia ERP sem perder dados | APROVADO |
| Agenda → conversão direta em OS | NÃO APLICÁVEL: o domínio converte agenda em orçamento; OS sai do orçamento aprovado |
| Isolamento entre filiais da mesma empresa | NÃO TESTADO pela interface (coberto só em testes de domínio) |
| Duas abas abertas ao mesmo tempo | NÃO TESTADO |

---

## 4. PWA

| Item | Estado | Observação |
|---|---|---|
| Manifest (nome, id, start_url, scope, standalone, cores, ícones 192/512 e maskable) | APROVADO | `pwa.e2e.ts` |
| Service worker controla a página em produção | APROVADO | `pwa.e2e.ts` |
| Offline: rotas nunca visitadas abrem do precache, dados locais disponíveis, aviso de sem conexão | APROVADO | `pwa.e2e.ts` |
| Atualização A→B: aviso discreto, sem reload automático, dados preservados, cache antigo removido | APROVADO | `pwa.e2e.ts` |
| Atualização bloqueada com modal aberto ou carrinho com itens | APROVADO COM RESSALVAS | Implementado (`useBusyGuard`); o pedido de confirmação não tem teste automatizado |
| Instalação real (Chrome/Edge Windows, Android, iOS, macOS) | NÃO TESTADO | Exige navegador com interface e dispositivos; o headless não instala apps |
| Instruções de instalação no iPhone/iPad | APROVADO COM RESSALVAS | Modal implementado; não visto em Safari real |

---

## 5. Tour guiado

| Item | Estado |
|---|---|
| Todo passo aponta para um `data-tour` que existe no código | APROVADO (`tours.test.ts`; antes 21 passos estavam quebrados) |
| Spotlight, avançar e Esc no dashboard | APROVADO (`v2.e2e.ts`) |
| Módulos fora do perfil não aparecem no seletor | APROVADO COM RESSALVAS (implementado, sem teste dedicado) |
| Cada passo de cada módulo destaca o elemento certo na tela | NÃO TESTADO (só o tour do dashboard foi percorrido no navegador) |
| Tour em celular, tema claro e sidebar recolhida | NÃO TESTADO |

---

## 6. Defeitos encontrados nesta auditoria

| ID | Sev. | Defeito | Estado |
|---|---|---|---|
| D1 | P2 | 21 passos de tour apontavam para elementos inexistentes | Corrigido + teste |
| D2 | P1 | Ajuda: 9 de 12 termos do dia a dia sem resultado (busca por texto exato) | Corrigido + 15 testes |
| D3 | P2 | Histórico de baixas: uma linha cobria o botão Estornar da outra | Corrigido + fluxo 6 |
| D4 | P3 | Botão Excluir aparecia desabilitado para Mecânico | Corrigido + fluxo 9 |
| D5 | P1 | Offline: arquivos no cache não eram servidos (`Vary: Origin`) | Corrigido + `pwa.e2e.ts` |
| D6 | P2 | Aviso "sem conexão" dependia de `navigator.onLine` | Corrigido + `pwa.e2e.ts` |
| D7 | P2 | Ao entrar em outra empresa pela URL, nome do usuário ficava o anterior | Corrigido + `admin.e2e.ts` |
| D8 | P3 | Fatura recém-gerada ia para a página 2 | Corrigido (mais recentes primeiro) |
| D9 | P2 | axe: contraste em tema claro, gráficos sem nome acessível, `/planos` sem h1 | Corrigido, revalidado com 0 violações |

Abertos: ver `docs/KNOWN_ISSUES.md`.

---

## 7. Fora do escopo desta execução

- Firefox, Safari e Edge: não executados.
- Dispositivos físicos, teclado virtual, toque real, zoom 200/400%: não executados.
- Leitores de tela (NVDA, VoiceOver, TalkBack): não executados.
- Usuários iniciantes reais: não houve participantes. Roteiro em `docs/UX_AUDIT.md`.
- Lighthouse: não executado.
