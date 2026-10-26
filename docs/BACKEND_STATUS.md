# PISTEC 3.0 — Estado de Implementação e Homologação

Atualizado em: 2026-10-16

## URLs publicadas

- **Produção (Vercel):** `https://pistec.vercel.app`
- **Demonstração pública 100% local (sem banco remoto):** `https://pistec.vercel.app/demonstracao` e `https://pistec.vercel.app/loja/moto-prime/dashboard`
- **Ambiente real (Supabase Auth + Postgres + RLS + RPCs):** `https://pistec.vercel.app/app/login`
- **Projeto Supabase:** `xbnnbwsfdkjsbohomezx` (10 migrations aplicadas, 38 tabelas públicas com `ENABLE` + `FORCE ROW LEVEL SECURITY`)

## Matriz honesta de status

| Item | Status | Evidência verificada |
|---|---|---|
| Demonstração isolada (`IndexedDB`) | **Testado em produção e E2E** | `src/demo-isolation.e2e.ts` + verificação em `https://pistec.vercel.app/demonstracao` com **0 requisições** para Supabase/provedores e chunk `/src/real/*` não carregado |
| Schema multi-tenant + RLS por empresa/filial/papel | **Testado com serviço real + PGlite** | 10 migrations em `supabase/migrations/`, smoke remoto (`supabase/tests/remote-smoke.sql`) e 33 testes SQL em `supabase/tests/` |
| RPCs transacionais e idempotentes (PDV, estoque, caixa, financeiro, OS, compras, orçamentos, registros) | **Testado com serviço real + E2E navegador** | `src/real/real.e2e.ts` executou login → onboarding → produto → entrada de estoque → abertura de caixa → venda → quitação financeira → reload contra o Supabase real |
| Supabase Auth (login, cadastro, recuperação, convite, MFA TOTP `aal2`, Super Admin no servidor) | **Testado com serviço real** | Redirects configurados para `https://pistec.vercel.app/app/*`; convite real enviado para `pistec.gestao@gmail.com` e `user_id` registrado em `platform_admins` |
| InfinitePay Checkout SaaS (`billing-checkout` + `billing-webhook` + `payment_check`) | **Testado com serviço real (geração de link R$ 1,00) + testes Deno** | Edge Function publicada gerou link real `https://checkout.infinitepay.io/marco-boggian?...`; confirmação de pagamento exige `payment_check` no servidor, nunca retorno do navegador |
| Assistente Gemini (`assistant` + tools somente leitura com RLS e quota atômica) | **Testado com serviço real + testes Deno** | Edge Function publicada consultou `stock_alerts` com JWT do usuário e respondeu via `gemini-2.5-flash` |
| Worker de outbox → notificações + Realtime (`worker` + `Notifications.tsx`) | **Publicado, sem agendamento** (auditoria 2026-10-26) | `deliver_internal_event` deduplicado por `source_event_id`; nada invoca o `worker` (sem `pg_cron`), eventos ficam `pending` |
| E-mail transacional Resend | **Pendente de domínio verificado** | Chave atual é restrita a envio e não há domínio verificado; Auth usa o envio padrão do Supabase |
| Disparo real de WhatsApp (Evolution API 2.3.7) | **Pendente de instância conectada/QR e número de destino** | Persistência, deduplicação (`svc_whatsapp_inbound`) e RLS testadas; nenhum disparo externo foi feito sem instância/número |
| Web Push VAPID ponta a ponta | **Parcial (persistência e RPCs prontas)** | Tabela `push_subscriptions` e RPCs `save_push_subscription`/`delete_push_subscription` testadas; envio VAPID externo ainda não ativado |

## Segurança e rotação obrigatória

1. **Rotacionar imediatamente** as chaves que foram coladas no histórico do chat (Supabase secret key / access token, Gemini, Resend, Evolution e o PAT do GitHub informado anteriormente).
2. **Super Admin (`pistec.gestao@gmail.com`):** abra o e-mail de convite enviado pelo Supabase, defina uma **senha nova e exclusiva** (não reutilize a senha escrita no chat) e conclua o cadastro do **MFA TOTP** em `/app/mfa` para liberar `/app/admin`.
3. Nenhum segredo foi incluído no bundle (`dist/assets` verificado) nem versionado no Git (`.env.local` e `.vercel` estão no `.gitignore`).
