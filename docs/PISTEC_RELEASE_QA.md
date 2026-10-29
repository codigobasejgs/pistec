# PISTEC — QA do release (29/10/2026)

| Verificação | Resultado |
|---|---|
| TypeScript | 0 erros |
| ESLint | 0 problemas |
| Build Vite | ok |
| Vitest (unitários + SQL/RLS em Postgres PGlite) | **334/334** (32 arquivos) |
| Playwright em 7 grupos + CEP real | **67/67** (execução de 29/10; grupos e motivo em `PISTEC_NEXT_E2E_REPORT.md`) |
| Ensaio das migrations no Postgres de produção (transação revertida) | ok |
| Bundle das Edge Functions alteradas | ok (5/5) |
| Scan de segredos (543 arquivos do Git + `dist`) | 0 ocorrências |
| `npm audit --omit=dev` | 0 vulnerabilidades |
| Gemini real | áudio (Mecânico) + 5 casos de chatbot |

## Testes novos nesta etapa
- `next.test.ts`: bot (dedupe, humano, quota, isolamento, status só avança), Resend (dedupe svix-id, transições).
- `rollback-next.test.ts`: rollback restaura `save_record`, `transition_record`, `set_whatsapp_bot`, `admin_integration_summary`.
- `svix.test.ts`: assinatura do webhook Resend (válida, corpo alterado, segredo errado, carimbo antigo).
- `evolution-parse.test.ts`: formatos 2.3.7 (`@lid`, status, conexão, destinatário).

## Bloqueados / não executados
- `real.e2e.ts` em produção (autorização).
- WhatsApp bidirecional (pareamento).
- Entrega confirmada de e-mail (webhook).
- Push em Android/iOS/desktop físicos (só 1 dispositivo já registrado; nenhum teste físico nesta etapa).
- Pagamento InfinitePay.
- Regressão E2E após as mudanças desta etapa: as telas alteradas foram `real/WhatsApp.tsx` e `real/admin/Tech.tsx` (só ambiente real, sem E2E de demo); a suíte de 67 cobre o restante e foi executada antes delas.
