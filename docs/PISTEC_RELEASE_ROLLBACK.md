# PISTEC — Rollback do release

Detalhes completos em `docs/PISTEC_NEXT_ROLLBACK.md`. Resumo:

| Camada | Como voltar | Tempo |
|---|---|---|
| Frontend | Vercel → Promote `dpl_7kAD7qYQ2kyv3jFMHhDCm6YFCAw1` (`b0293f1`) | segundos |
| Edge Functions | Republicar do commit `b0293f1` (worker com `--no-verify-jwt`) | minutos |
| Banco NEXT | `supabase/rollback/20261104000100_pistec_next.down.sql` (transação; testado). Apaga só dados das tabelas novas | minutos |
| Banco teste 1 mês | Sem rollback automático (regra comercial). Não altera vencimentos existentes | — |

Ordem: frontend primeiro (para de chamar RPCs novas), depois funções, por último banco.
