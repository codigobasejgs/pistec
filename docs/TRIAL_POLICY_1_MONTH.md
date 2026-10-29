# Teste gratuito: 1 mês calendário

**Vigência:** cadastros de empresas a partir da aplicação da migração `20261103000100_trial_one_month.sql`.

## Regra

- **Duração:** 1 mês calendário a partir do cadastro da empresa (`onboard_tenant`), no calendário de **São Paulo** (`America/Sao_Paulo`).
- **Cálculo:** mesmo dia do mês seguinte. Se o dia não existir (29, 30, 31), o teste termina no **último dia** desse mês.
  - 29/10/2026 → 29/11/2026 · 10/11/2026 → 10/12/2026 · 31/01/2027 → 28/02/2027 · 31/01/2028 → 29/02/2028 · 31/12/2026 → 31/01/2027.
- **Acesso:** até o **fim do dia** de término (`subscriptions.current_period_end`, data inclusiva). No dia seguinte a assinatura passa a `past_due`; após 5 dias de tolerância, somente leitura (`suspended`). Dados nunca são apagados.
- **Cartão:** não é pedido no cadastro nem no teste. Pagamento só ao contratar um plano (InfinitePay).
- **Por plano:** `plans.trial_months` (padrão 1; 0 = plano sem teste; máximo 3). Editável no Super Admin → Planos SaaS.

## Fonte de verdade

| Onde | O quê |
|---|---|
| Banco | `app.trial_end(início, meses)` — usado por `onboard_tenant`; `trial_policy()` expõe a regra para leitura pública |
| Frontend | `src/services/trial.ts` (`trialEndDay`, `trialDaysLeft`, `trialLabel`) — mesma regra, só para exibição e para a demonstração |
| Prova | `supabase/tests/trial.test.ts` compara banco × frontend em 13 datas (fim de mês, bissexto, virada de ano, fuso) |

O navegador não envia duração: o servidor calcula. Usuário da loja não pode alterar `due_date`, `current_period_end` nem situação (RLS sem permissão de escrita; testado).

## Empresas existentes

**Não alteradas.** Em produção, em 03/11/2026: 1 empresa, com assinatura **ativa** (paga), nenhuma em teste. Quem já estava em teste mantém o prazo concedido; para dar mais tempo, o Super Admin usa **Prorrogar teste** (por data, com justificativa e auditoria).

## Onde o texto mudou

Landing (hero "Experimente o PISTEC grátis por 1 mês" + CTA **Começar meu mês grátis**, FAQ com 4 perguntas novas), `/planos` (subtítulo, cartões "1 mês grátis para empresas novas", linha "Teste grátis" na comparação), contratação, Minha assinatura (cartão "Seu teste gratuito está ativo"), Super Admin (planos em meses, política em Segurança → Comercial, prorrogação por data, ciclo de vida com início/término), e-mails (boas-vindas "Seu mês grátis no PISTEC começou!" e lembretes 7/3/1/0), ajuda do lojista e do Super Admin, tour.

## Histórico preservado (não editado de propósito)

- Migrações antigas (`default 14`, `'trialDays', '14'`) — já aplicadas; a regra vigente vem da nova migração.
- `plans.trial_days` permanece no banco como histórico; não é mais usado para calcular.
- Contratos assinados e PDFs: inalterados. Fixture `src/__fixtures__/state-v1.json` (dados v1 de teste de migração da demonstração).
- `seed.ts` "14 dias" em fornecedor de exemplo: prazo de pagamento, não teste.
