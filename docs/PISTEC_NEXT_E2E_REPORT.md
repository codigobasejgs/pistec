# PISTEC — Relatório E2E (29/10/2026)

## Causa da interrupção anterior
Não era vazamento do PISTEC: a máquina tinha ~1,3 GB livres de 16 GB, com um emulador Android (`qemu`, ~4,6 GB) e outros projetos (Vite/Playwright de outros repositórios) abertos. A configuração já usa 1 worker. Solução: executar a suíte em 7 grupos sequenciais (mesmos testes, sem exclusões, sem aumento de timeout).

## Resultado

| Grupo | Arquivos | Resultado |
|---|---|---|
| 1 | `demo-isolation`, `saas` | 5/5 |
| 2 | `v2` (sessão, tour, sem rolagem lateral em 14 larguras × 16 rotas) | 16/16 |
| 3 | `pwa` | 4/4 |
| 4 | `flows` | 9/9 |
| 5 | `erp`, `documents` | 9/9 |
| 6 | `contracts`, `address` | 17/17 |
| 7 | `next` | 5/5 |
| Real | `address.real` (ViaCEP/BrasilAPI reais) | 2/2 |
| **Total** | | **67/67** |

Não executado: `src/real/real.e2e.ts` (cria conta temporária no Supabase de produção) — aguarda autorização e deve rodar após aplicar as migrations.

## Falhas encontradas e corrigidas
1. `saas.e2e.ts`: dois links "Começar meu mês grátis" na home (alteração do teste de 1 mês) — seletor ajustado para o primeiro.
2. `v2.e2e.ts` 600 px em `/whatsapp`: overflow de 101 px **intermitente** (1 em 3 execuções; 0 em 4 repetições seguintes e 0 em 4 diagnósticos isolados). Não reproduzido de forma determinística; tratado como instabilidade de medição durante carregamento. Registrado como pendência de observação.

## Testes adicionados
- Contato comercial envia ao servidor e mostra falha real (`saas.e2e.ts`).
- Páginas públicas sem "protótipo/roadmap/IndexedDB" (`saas.e2e.ts`).
