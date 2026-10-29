# PISTEC NEXT — Release e rollback

## Ponto de recuperação
- Produção atual: commit `b0293f1`, deploy Vercel `dpl_7kAD7qYQ2kyv3jFMHhDCm6YFCAw1`.
- Edge Functions atuais: `worker` v13, `whatsapp` v6, `whatsapp-webhook` v5 (as versões anteriores continuam no histórico do Supabase).

## Ordem de publicação (após autorização)
1. Backup lógico das tabelas afetadas (`records`, `whatsapp_*`, `ai_settings`) via `pg_dump` ou snapshot do painel.
2. `node --env-file=.env.local scripts/migrate-backend.mjs --project <ref> --apply` (aplica `20261103000100` e `20261104000100`, aditivas).
3. Edge Functions: `worker --no-verify-jwt`, `whatsapp-webhook --no-verify-jwt`, `whatsapp`, `mechanic`.
4. Commit + push em `main` → deploy Vercel automático.
5. Smoke: `/`, `/app/login`, `/c/<token inválido>` (mensagem de link indisponível), worker 200, `admin-health`.

## Rollback
| Camada | Ação |
|---|---|
| Frontend | Vercel → Promote do deploy `dpl_7kAD7qYQ2kyv3jFMHhDCm6YFCAw1` (instantâneo) |
| Edge Functions | Republicar a partir do commit `b0293f1` (`git stash`/`worktree` + `scripts/deploy-function.mjs`, `worker` com `--no-verify-jwt`) |
| Banco (NEXT) | `supabase/rollback/20261104000100_pistec_next.down.sql` — testado em `supabase/tests/rollback-next.test.ts`. **Apaga** fotos, links do portal, decisões, configurações da oficina e registros do bot; mantém registros do ERP |
| Banco (teste 1 mês) | Sem rollback automático: a migração altera regras de datas. Reverter só com decisão comercial; não muda vencimentos já existentes |
