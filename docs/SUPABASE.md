# Migração para Supabase — checklist

O frontend acessa os dados por `useDemo().mutate` e pelas funções de `domain.ts`. Para migrar:

1. **Auth:** Supabase Auth com MFA. Trocar `setSession` por uma sessão vinda do JWT. Super Admin vira uma claim/tabela própria, nunca um booleano no cliente.
2. **Tabelas:** são as entidades do prompt: tenants, branches, profiles, memberships, roles, permissions, plans, entitlements, subscriptions, billing_invoices, billing_transactions, tenant_branding, products, product_categories, product_applications, customers, customer_vehicles, suppliers, stock_balances, stock_movements, sales, sale_items, cash_registers, purchases, purchase_items, quotations, service_orders, service_order_items, appointments, financial_entries, conversations, messages, notifications, integrations, audit_logs.
   - `OperationalRecord.kind` mapeia para as tabelas específicas (`ordens-servico` → service_orders etc.).
3. **RLS:** toda tabela privada recebe `tenant_id`.
   - Política: `tenant_id in (select tenant_id from memberships where user_id = auth.uid())`.
   - Filial: escopo adicional via `memberships.branch_ids`.
   - Hoje o frontend só **filtra**; isso não é segurança.
4. **Transações:** `completeSale`, `cancelSale`, `receivePurchase`, `transitionRecord` e `convertRecord` viram RPCs (`security definer`), cada uma numa única transação SQL.
   - Usar `request_id` único para idempotência.
   - Usar `check (quantity >= 0)` em `stock_balances`.
5. **Dinheiro:** `bigint` em centavos.
6. **Cobrança SaaS:** Edge Functions com segredos Asaas/InfinitePay. O status de pagamento muda **somente** por webhook autenticado, com conciliação. O retorno do checkout apenas exibe "aguardando confirmação".
7. **WhatsApp:** Edge Function chama a Evolution API com a instância vinculada ao tenant. O cliente nunca vê o token.
8. **Auditoria:** trigger que grava em `audit_logs` com usuário, tenant, ação e diff. Usar o relógio do servidor; o relógio do domínio no demo é local.
9. **Arquivos:** Supabase Storage com buckets por tenant, validação de MIME e tamanho, e URLs assinadas.
