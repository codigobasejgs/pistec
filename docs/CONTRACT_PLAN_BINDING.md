# Vínculo contrato ↔ plano

## Origem dos dados

| Dado no contrato | Fonte | Momento |
|---|---|---|
| Plano, nome, versão (`md5` da linha do plano) | `public.plans` | `prepare_contract` (servidor) |
| Periodicidade, preço base | `plans.monthly / quarterly / annual` | idem |
| Desconto, cupom, total | `app.coupon_quote` | idem |
| Limites e recursos (`entitlements`) | `plans.users, branches, products, whatsapp, ai_messages, features, modules` | idem |
| Teste gratuito | situação da empresa (`tenants.status = 'Teste'`, `due_date`) | idem |
| Renovação, cancelamento, reajuste, tolerância | textos fixos do servidor (iguais às condições mostradas na etapa 1) | idem |
| Contratada | `legal_provider_profiles` ativo | idem |

O navegador envia **apenas** `planId`, `period`, `coupon` e os dados cadastrais. Preço nunca vem do navegador. Tudo fica congelado em `tenant_contracts.commercial` / `parties` (gatilho `app.contract_guard` impede alteração).

## Prova automatizada

`supabase/tests/contract-checkout.test.ts` gera um contrato para **cada** plano de autoatendimento × **cada** periodicidade (9 combinações) e confere que `planId`, `planName`, `period`, `price`, `total` e os limites são exatamente os do plano escolhido. Também: Enterprise recusado, troca de plano antes do envio (descarta e regera), descarte só pelo dono e só antes do envio.

E2E (`src/features/contracts/contracts.e2e.ts`): a URL de cada card de `/planos` carrega plano + periodicidade; a etapa 1 mostra o plano e o valor corretos para Essencial/Mensal, Profissional/Trimestral e Premium/Anual; trocar a periodicidade atualiza valor e URL.

## Mudança de preço

Antes da assinatura: o contrato preparado mantém o preço congelado; para trocar, é preciso gerar outro (descarte). Depois da assinatura: `contract_invoice` recusa cobrar se o preço do catálogo mudou (exige aditivo ou novo contrato). Contrato assinado nunca muda.

## Enterprise e licença perpétua

- Enterprise: `self_service = false` → sem contratação online e sem checkout; "Falar com consultor".
- Licença perpétua: **sem contrato próprio**. A minuta 2026.1 é de assinatura SaaS (renovação mensal/periódica) e não serve para licença perpétua. Pendência jurídica registrada em `CONTRACT_KNOWN_ISSUES.md`.
