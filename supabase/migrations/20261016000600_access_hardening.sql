-- Privilégio mínimo: default global e ACL efetiva, não apenas defaults por schema.
alter default privileges revoke execute on functions from public;
revoke all on all functions in schema app from public, anon, authenticated;
grant execute on function app.is_platform_admin(), app.is_member(uuid), app.can_branch(uuid, uuid),
  app.role_can(text,text,text), app.membership(uuid) to authenticated;

create or replace function app.can_read(p_tenant uuid, p_module text, p_branch uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id
    join public.plans p on p.id = t.plan_id
    where m.user_id = auth.uid() and m.tenant_id = p_tenant and m.active
      and app.role_can(m.role, p_module, 'visualizar')
      and (p_branch is null or m.branch_ids is null or p_branch = any(m.branch_ids))
      and ('*' = any(p.modules) or p_module = any(p.modules)
        or p_module in ('configuracoes','minha-assinatura','funcionarios','filiais','categorias','aplicacoes','tarefas','notificacoes')))
$$;
grant execute on function app.can_read(uuid,text,uuid), app.record_module(text) to authenticated;

drop policy branches_read on public.branches;
create policy branches_read on public.branches for select to authenticated using (app.can_branch(tenant_id,id) or app.is_platform_admin());
drop policy products_read on public.products;
create policy products_read on public.products for select to authenticated using (app.can_read(tenant_id,'produtos'));
drop policy customers_read on public.customers;
create policy customers_read on public.customers for select to authenticated using (app.can_read(tenant_id,'clientes'));
drop policy stock_balances_read on public.stock_balances;
create policy stock_balances_read on public.stock_balances for select to authenticated using (app.can_read(tenant_id,'estoque',branch_id));
drop policy stock_movements_read on public.stock_movements;
create policy stock_movements_read on public.stock_movements for select to authenticated using (app.can_read(tenant_id,'estoque',branch_id));
drop policy cash_registers_read on public.cash_registers;
create policy cash_registers_read on public.cash_registers for select to authenticated using (app.can_read(tenant_id,'caixa',branch_id));
drop policy cash_movements_read on public.cash_movements;
create policy cash_movements_read on public.cash_movements for select to authenticated using (
  exists(select 1 from public.cash_registers c where c.id = cash_id and c.tenant_id = cash_movements.tenant_id));
drop policy sales_read on public.sales;
create policy sales_read on public.sales for select to authenticated using (app.can_read(tenant_id,'vendas',branch_id));
drop policy sale_items_read on public.sale_items;
create policy sale_items_read on public.sale_items for select to authenticated using (
  exists(select 1 from public.sales s where s.id = sale_id and s.tenant_id = sale_items.tenant_id));
drop policy sale_payments_read on public.sale_payments;
create policy sale_payments_read on public.sale_payments for select to authenticated using (
  exists(select 1 from public.sales s where s.id = sale_id and s.tenant_id = sale_payments.tenant_id));
drop policy financial_entries_read on public.financial_entries;
create policy financial_entries_read on public.financial_entries for select to authenticated using (app.can_read(tenant_id,'financeiro',branch_id));
drop policy settlements_read on public.settlements;
create policy settlements_read on public.settlements for select to authenticated using (
  exists(select 1 from public.financial_entries e where e.id = entry_id and e.tenant_id = settlements.tenant_id));
drop policy records_read on public.records;
create policy records_read on public.records for select to authenticated using (
  (tenant_id is not null and app.can_read(tenant_id,app.record_module(kind),branch_id))
  or (tenant_id is null and app.is_platform_admin()));

-- Notificação direcionada também exige membership vigente.
drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  (user_id is null or user_id = auth.uid()) and
  ((tenant_id is not null and app.is_member(tenant_id)) or (tenant_id is null and app.is_platform_admin())));

-- Expor somente RPCs nominadas, nunca todas as funções do schema (extensões podem existir).
revoke all on all functions in schema public from public, anon, authenticated;
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(array[
      'onboard_tenant','submit_lead','update_tenant_profile','update_branding',
      'invite_member','accept_invite','set_member','revoke_invite',
      'save_product','delete_product','import_products','save_customer','delete_customer',
      'move_stock','apply_inventory','transfer_stock','complete_sale','cancel_sale',
      'open_cash','cash_movement','close_cash','save_entry','settle_entry','reverse_settlement','cancel_entry',
      'save_record','delete_record','transition_record','receive_purchase','convert_record','simulate_automation',
      'quote_coupon','request_subscription_invoice','cancel_subscription',
      'admin_save_tenant','admin_save_plan','admin_delete_plan','admin_save_coupon','admin_delete_coupon',
      'admin_create_invoice','admin_set_invoice_status','admin_save_record','admin_delete_record','admin_broadcast',
      'mark_notifications_read','save_notification_preferences','save_push_subscription','delete_push_subscription',
      'set_whatsapp_bot','save_ai_settings','ai_usage_summary'])
  loop execute format('grant execute on function %s to authenticated, service_role', f.sig); end loop;
end $$;
grant execute on function public.submit_lead(jsonb) to anon;
grant usage, select on all sequences in schema public to service_role;
