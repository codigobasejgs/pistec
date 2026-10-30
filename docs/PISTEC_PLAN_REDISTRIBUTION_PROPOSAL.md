# Proposta de redistribuição de recursos por plano (NÃO aplicada)

Status: **proposta para aprovação do proprietário**. Nada nesta página foi alterado no banco: preços, limites e `plans.modules` estão idênticos à produção (verificado em `supabase/tests/catalog.test.ts` e no ensaio com rollback em 30/10).

## Situação atual (calculada pelos módulos de cada plano)

| Plano | Mensal | Recursos do catálogo | Observação |
|---|---|---|---|
| Essencial | R$ 129,00 | 8 de 28 | PDV, estoque, vendas, clientes, financeiro, AutoPilot, estoque inteligente, marca própria |
| Profissional | R$ 249,00 | 26 de 28 | Tudo, exceto CRM e Automações |
| Premium | R$ 449,00 | 28 de 28 | Tudo; diferença para o Profissional é CRM, Automações e limites |
| Enterprise | sob proposta | 28 de 28 | Mesmos recursos do Premium com limites maiores |

Ponto de atenção: o Premium acrescenta só 2 recursos ao Profissional. A diferença de preço hoje é sustentada pelos limites (15 usuários, 3 filiais, 200 respostas de IA/dia).

## Opções (todas preservam direitos de quem já assina)

1. **Manter como está** (recomendado até haver base de clientes). Comunicação já explica que a diferença está em limites, filiais e IA.
2. **Premium como "operação completa"**: em contratações *novas*, mover Lucro por OS e Frotas para o Premium. Exige versão nova do plano (o Anexo I congela os recursos de contratos antigos) e regra de *grandfathering* para empresas já no Profissional.
3. **Essencial para motopeças/autopeças**: incluir Cotação com fornecedores (`compras`, `fornecedores`) no Essencial. Aumenta o valor de entrada sem reduzir nada de ninguém.

## Como aplicar, se aprovado

- Alterar `plans.modules` pelo Super Admin (`admin_save_plan`, auditado). A landing, /planos, a contratação e o Anexo I passam a refletir a mudança automaticamente (catálogo único).
- Reduções (opção 2) só para contratações novas: criar plano novo (ex.: `profissional_2027`) e desativar o antigo para novas vendas, mantendo as empresas atuais no plano vigente.
- Nenhuma mudança de preço está proposta.
