# Vercel — auditoria de ambiente (29/10/2026)

Projeto `pistec` (team `team_WTxgentVPUxn4FHeBEEj1TQP`), framework Vite, branch de produção `main`, domínios `pistec.com.br` (+ `www` → 308) e `pistec.vercel.app`.

| Variável | Tipo | Ambientes | Necessária | Observação |
|---|---|---|---|---|
| `VITE_SUPABASE_URL` | sensitive | Production | Sim | Pública por natureza (RLS protege) |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | sensitive | Production | Sim | `sb_publishable_…` |
| `VITE_VAPID_PUBLIC_KEY` | plain | Production, Preview, Development | Sim | Chave pública |

Nenhuma chave privada (Resend, Evolution, Gemini, InfinitePay, service role, VAPID privada, webhooks) é usada por código da Vercel — todas ficam no Supabase. **Não cadastrar** essas chaves na Vercel.

Observação: Preview não tem `VITE_SUPABASE_*`; deploys de pré-visualização abrem a demonstração mas não o `/app`. Se for preciso testar `/app` em Preview, usar um projeto Supabase de homologação, não o de produção.

Último deploy de produção: `b0293f1` (28/10 18:15). Alterações de 29/10 ainda não publicadas.
