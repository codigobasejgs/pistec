# QA — teste gratuito de 1 mês

| Verificação | Resultado |
|---|---|
| TypeScript, ESLint, build | ok |
| Vitest (inclui SQL) | 304 testes: 303 na execução completa + 1 que excedeu 5 s por carga e passou isolado (`domain.test.ts`, 89/89) |
| Playwright (sem os testes contra produção) | 56/56 |

## Cobertura

| Cenário | Teste |
|---|---|
| Datas: dia 1, 15, 28, 29, 30, 31, fevereiro, bissexto, virada de ano, fuso SP × UTC, último dia ainda válido, dia seguinte encerrado | `src/services/trial.test.ts` (15) |
| Banco = frontend nas mesmas 13 datas | `supabase/tests/trial.test.ts` |
| Nova empresa: 1 mês, início registrado; repetir requisição não reinicia | idem |
| Usuário não altera prazo/situação; não usa prorrogação | idem |
| Prorrogação por data, justificativa e auditoria; recusa data anterior | idem |
| Avisos 7/3/1/0 dias da data real, sem duplicar | idem + `delivery.test.ts` |
| Último dia ainda em teste; dia seguinte `past_due`; nenhuma cobrança paga automática | idem |
| Plano com 0 meses não concede teste; limite 0–3 meses | idem |
| Landing anuncia "Começar meu mês grátis" | `saas.e2e.ts` |

## Não executado

- E-mails reais de boas-vindas e lembrete do teste: Resend já verificado e entregando (boas-vindas de teste enviado em 29/10); os textos novos do mês grátis entram em produção quando worker/whatsapp forem republicados após a migração.
- Push real e WhatsApp: não há automação de WhatsApp para teste gratuito (nenhuma mensagem é enviada por WhatsApp sobre o teste); push usa o mesmo evento das notificações internas.
