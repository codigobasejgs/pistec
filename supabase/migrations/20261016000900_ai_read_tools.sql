create or replace function public.authorize_ai_tool(p_tenant uuid,p_branch uuid,p_module text) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if p_module not in ('assistente','produtos','estoque','ordens-servico','orcamentos','vendas','ajuda') then
    perform app.fail('Ferramenta não autorizada.','42501');
  end if;
  perform app.require(p_tenant,'assistente','visualizar',p_branch);
  perform app.branch_ok(p_tenant,p_branch);
  if not exists(select 1 from public.tenants where id=p_tenant and status in ('Teste','Ativa') and due_date>=current_date) then
    perform app.fail('Assinatura sem acesso ao assistente.','42501');
  end if;
  if p_module not in ('assistente','ajuda') then perform app.require(p_tenant,p_module,'visualizar',p_branch); end if;
  return true;
end $$;
create or replace function public.stock_alerts(p_tenant uuid,p_branch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.authorize_ai_tool(p_tenant,p_branch,'estoque');
  return coalesce((select jsonb_agg(row_to_json(x)) from (
    select p.name,p.sku,b.quantity-b.reserved available,p.min from public.products p
    join public.stock_balances b on b.product_id=p.id and b.tenant_id=p.tenant_id
    where p.tenant_id=p_tenant and b.branch_id=p_branch and p.active and b.quantity-b.reserved<=p.min
    order by b.quantity-b.reserved,p.id limit 30) x),'[]');
end $$;
create or replace function public.sales_summary(p_tenant uuid,p_branch uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  perform public.authorize_ai_tool(p_tenant,p_branch,'vendas');
  return (select jsonb_build_object('periodStart',current_date-30,'count',count(*),'totalCents',coalesce(sum(total),0))
    from public.sales where tenant_id=p_tenant and branch_id=p_branch and status='Concluída' and created_at>=current_date-30);
end $$;
revoke all on function public.authorize_ai_tool(uuid,uuid,text),public.stock_alerts(uuid,uuid),public.sales_summary(uuid,uuid) from public,anon;
grant execute on function public.authorize_ai_tool(uuid,uuid,text),public.stock_alerts(uuid,uuid),public.sales_summary(uuid,uuid) to authenticated;
