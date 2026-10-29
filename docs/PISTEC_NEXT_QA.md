# PISTEC NEXT — QA (29/10/2026)

| Verificação | Resultado |
|---|---|
| TypeScript, ESLint, build | ok |
| Vitest completo (`--maxWorkers=2`) | 325/325 (baseline 304 + 21 novos) |
| `src/services/workshop.test.ts` | 9/9 — margem R$ 800 − R$ 520 = R$ 280, reposição, cotação, escopo aprovado, agenda, revisões, AutoPilot |
| `supabase/tests/next.test.ts` (Postgres real em PGlite, RLS, 2 empresas) | 9/9 — portal, aprovação parcial, revogação, fotos, conflito de agenda, cotação → compra → estoque, execução da OS, configurações, garantia/frota, Mecânico IA |
| `supabase/tests/mechanic-note.test.ts` | 1/1 — validação da saída da IA |
| `src/features/next/next.e2e.ts` (Playwright, demo) | 5/5 — AutoPilot e regras, check-in → OS, Moto Express → OS, telas em 360 px sem rolagem lateral, perfil Mecânico sem Lucro por OS |
| Regressão Playwright completa | **Não concluída**: interrompida pelo sistema por falta de memória na máquina; repetir antes de publicar |
| Migrations remotas (somente leitura) | 22 aplicadas; pendentes `20261103000100` (teste 1 mês) e `20261104000100` (NEXT) |

## Não executado

- Chamada real ao Gemini com áudio (Edge Function `mechanic` não publicada).
- Envio real por Evolution/Resend dos novos módulos (não há envio automático novo).
- Responsividade nas 10 larguras pedidas: verificado só 360 px nas 7 telas novas.
- Testes com usuários reais: não realizados.
