# PISTEC NEXT 10.0 — Baseline (29/10/2026)

Branch `feat/pistec-3-backend`, último commit `b0293f1` + alterações locais do teste de 1 mês (não aplicadas).

## Verificações antes da implementação

| Verificação | Resultado |
|---|---|
| TypeScript (`tsc -b`) | ok, 0 erros |
| ESLint | ok, 0 problemas |
| Vitest (unitários + SQL PGlite com RLS) | 304/304 (com `--maxWorkers=2`; execução padrão estourou memória do Node nesta máquina — ambiente, não código) |
| Build Vite | ok |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Playwright | 56/56 na última execução registrada (`docs/TRIAL_QA_REPORT.md`) |

## Inventário (código atual como fonte)

| Capacidade | Situação antes do NEXT |
|---|---|
| Produtos, estoque, reservas, transferências, inventário | REAL E VALIDADA (RPCs transacionais, `lock_balance`, testes SQL) |
| PDV, caixa, vendas, financeiro | REAL E VALIDADA |
| Clientes, veículos, orçamentos, OS (transições com reserva/baixa), compras/recebimento, fornecedores, agenda, garantias, CRM | REAL E VALIDADA via `public.records` + `save_record`/`transition_record` |
| Conflito de agenda | PARCIAL — só aviso visual no navegador, sem bloqueio no servidor |
| Automações | DEMONSTRAÇÃO ISOLADA — "Simular" cria notificação; sem agendador |
| Outbox + worker (cron 1 min), notificações, push, e-mail Resend | REAL E VALIDADA (worker corrigido em 29/10: `--no-verify-jwt`) |
| Assistente Gemini (somente leitura, ferramentas autorizadas, quota) | IMPLEMENTADA, NÃO VALIDADA em produção (`AI_ENABLED` controla) |
| WhatsApp Evolution | BLOQUEADA POR INTEGRAÇÃO — servidor ok, instância PISTEC desconectada (QR) |
| Documentos/impressão, links públicos `/d/<token>` | REAL E VALIDADA |
| Contratos/assinatura Autentique | IMPLEMENTADA; Autentique em sandbox |
| Rentabilidade, check-in, aprovação por item, portal do cliente, estoque inteligente, cotação, fideliza, moto express, frotas, AutoPilot | AUSENTE |
| Permissões | `app.role_can` (servidor) espelhado em `can()` (frontend); RLS por `app.can_read(tenant, módulo, filial)` |
