# Contrato → cobrança

1. `contract_invoice(p_contract)` só aceita contrato `signed`, não homologação, da empresa do usuário (proprietário/administrador).
2. Confere o preço do catálogo com o valor congelado; se o plano mudou de preço ou foi desativado, falha — é preciso novo contrato.
3. Cria a fatura via `app.create_invoice` com `request_id = 'contract:' || id` → idempotente (clicar duas vezes devolve a mesma fatura).
4. Vencimento: fim do teste, se houver; senão hoje + 3 dias.
5. Checkout pela função existente `billing-checkout` (InfinitePay). Voltar do checkout não confirma nada.
6. Confirmação só pelo webhook InfinitePay → `app.svc_confirm_payment` (valor e NSU conferidos, idempotente). A assinatura do plano é ativada ali, não no contrato.

Nenhuma cobrança real foi gerada nesta entrega. Testes: `supabase/tests/contracts.test.ts` ("fatura após assinatura…").
