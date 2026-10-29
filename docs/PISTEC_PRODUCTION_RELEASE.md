# PISTEC — Release de produção (preparado em 29/10/2026)

## Estado exato

| Item | Valor |
|---|---|
| Branch | `feat/pistec-3-backend` |
| Commit a publicar | o `HEAD` local desta branch (ver `git log -1`); base publicada `b0293f1` |
| Remoto (`main` e branch) | `b0293f1` |
| Vercel produção | `dpl_7kAD7qYQ2kyv3jFMHhDCm6YFCAw1` → `b0293f1` |
| Migrations | 22 aplicadas; pendentes `20261103000100_trial_one_month`, `20261104000100_pistec_next` |
| Ensaio no Postgres de produção | Ambas aplicadas numa transação com `ROLLBACK` no fim: sem erro, 6/6 funções e 6/6 tabelas criadas, dados existentes intactos; após o rollback nada ficou (22 aplicadas, `portal_view` inexistente) |
| Edge Functions alteradas | `worker` (bot), `whatsapp` (sync de eventos, `@lid`), `whatsapp-webhook` (status, QR), `email-webhook` (eventos + dedupe), `mechanic` (nova). Bundle verificado (esbuild) |
| Só local | `.env.local` (cópias dos segredos, ignorado pelo Git); minutas jurídicas e `documentação.txt` (não versionados, de propósito) |

## Matriz local × remoto × produção

| Componente | Local | Git remoto | Vercel | Supabase | Testado |
|---|---|---|---|---|---|
| Teste de 1 mês | sim | não | não | não (ensaio ok) | 15 unit + SQL + E2E |
| PISTEC NEXT (12) | sim | não | não | não (ensaio ok) | ver QA |
| Bot WhatsApp | sim | não | — | não | SQL + Gemini real |
| Status WhatsApp / `@lid` | sim | não | — | não | parsers (formatos do código 2.3.7) + SQL |
| Resend eventos | sim | não | — | não | SQL + Svix |
| Worker atual (sem bot) | — | sim | — | v13 publicado | cron 200 |

## Ordem de publicação (dependências reais)
1. Backup: `pg_dump` das tabelas `records`, `tenants`, `whatsapp_*`, `email_messages`, `ai_settings` (ou snapshot do painel).
2. Migrations (`scripts/migrate-backend.mjs --apply`, transação única). Antes do frontend: as telas novas chamam RPCs novas; as funções antigas continuam compatíveis com o schema novo.
3. Edge Functions: `email-webhook --no-verify-jwt`, `whatsapp-webhook --no-verify-jwt`, `whatsapp`, `mechanic`, `worker --no-verify-jwt` (por último: começa a usar o bot).
4. `RESEND_WEBHOOK_SECRET` (após criar o webhook no painel Resend).
5. Push `main` → deploy Vercel; conferir hash do deployment = commit publicado.
6. Smoke (abaixo).

## Smoke tests pós-publicação
- `https://pistec.com.br/` 200, `/planos` mostra "1 mês grátis"; `/c/<token inválido>` mostra "Link indisponível".
- `select version from supabase_migrations.schema_migrations` contém as duas versões.
- `net._http_response` do worker: 200 nos 5 minutos seguintes; resposta inclui `bot`.
- Super Admin → Central de integrações → Testar conexões.
- `src/real/real.e2e.ts` (conta temporária, removida ao final).

## Operações que exigem sua autorização
Aplicar migrations, publicar funções, push/deploy, rodar `real.e2e.ts` em produção, parear WhatsApp, pagamento real InfinitePay.
