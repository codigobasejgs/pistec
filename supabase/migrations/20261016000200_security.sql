-- PISTEC 3.0 — autorização no servidor: membership, papéis, plano, Super Admin com MFA, RLS.
-- Regra: o tenant_id vindo do cliente é só uma intenção; toda função confere membership via auth.uid().

-- ---------------------------------------------------------------- helpers
create or replace function app.uid() returns uuid
language sql stable set search_path = '' as $$ select auth.uid() $$;

create or replace function app.correlation_id() returns text
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('app.correlation_id', true), ''),
                  nullif(current_setting('request.headers', true), '')::json ->> 'x-correlation-id')
$$;

create or replace function app.fail(message text, code text default 'P0001') returns void
language plpgsql set search_path = '' as $$ begin raise exception using message = message, errcode = code; end $$;

-- Super Admin: linha em platform_admins concedida pelo servidor + sessão com MFA (aal2).
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
$$;

create or replace function app.membership(p_tenant uuid) returns public.memberships
language sql stable security definer set search_path = '' as $$
  select m.* from public.memberships m
  join public.tenants t on t.id = m.tenant_id
  where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.active
$$;

create or replace function app.is_member(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships where tenant_id = p_tenant and user_id = auth.uid() and active)
$$;

create or replace function app.can_branch(p_tenant uuid, p_branch uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships
                 where tenant_id = p_tenant and user_id = auth.uid() and active
                   and (branch_ids is null or p_branch = any (branch_ids)))
$$;

-- Espelho de can() em src/domain.ts (mantidos juntos; teste de paridade em supabase/tests).
create or replace function app.role_can(p_role text, p_module text, p_action text default 'visualizar') returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  allowed text[];
begin
  if p_action not in ('visualizar', 'cadastrar', 'editar', 'excluir', 'cancelar', 'exportar', 'configurar') then return false; end if;
  allowed := case p_role
    when 'Proprietário' then array['*'] when 'Administrador' then array['*']
    when 'Gerente' then array['dashboard','pdv','produtos','estoque','clientes','ordens-servico','orcamentos','compras','fornecedores','financeiro','caixa','relatorios','agenda','veiculos','whatsapp','crm','tarefas','garantias','vendas','funcionarios']
    when 'Vendedor' then array['dashboard','pdv','clientes','produtos:visualizar','estoque:visualizar','orcamentos','vendas:visualizar','crm','agenda']
    when 'Caixa' then array['dashboard','pdv','caixa','clientes:visualizar','produtos:visualizar','vendas:visualizar']
    when 'Estoquista' then array['dashboard','produtos','estoque','compras','fornecedores']
    when 'Mecânico' then array['dashboard','ordens-servico','veiculos','agenda','produtos:visualizar','estoque:visualizar','garantias']
    when 'Atendente' then array['dashboard','clientes','agenda','whatsapp','orcamentos','crm','ordens-servico:visualizar']
    when 'Financeiro' then array['dashboard','financeiro','caixa','relatorios','compras:visualizar','vendas:visualizar','clientes:visualizar']
  end;
  if allowed is null then return false; end if;
  if '*' = any (allowed) then return true; end if;
  if p_action = 'configurar' then return false; end if;
  if p_action in ('excluir', 'cancelar') and p_role not in ('Gerente', 'Financeiro') then return false; end if;
  return p_module = any (allowed) or (p_module || ':' || p_action) = any (allowed);
end $$;

-- Garante membership + papel + plano + status da assinatura. Retorna a membership.
create or replace function app.require(p_tenant uuid, p_module text, p_action text default 'visualizar', p_branch uuid default null)
returns public.memberships
language plpgsql stable security definer set search_path = '' as $$
declare
  m public.memberships;
  t public.tenants;
  modules text[];
begin
  if auth.uid() is null then perform app.fail('Sessão expirada. Entre novamente.', '28000'); end if;
  select * into m from public.memberships where tenant_id = p_tenant and user_id = auth.uid() and active;
  if m.id is null then perform app.fail('Acesso negado a esta empresa.', '42501'); end if;
  if not app.role_can(m.role, p_module, p_action) then perform app.fail('Seu perfil não permite esta ação.', '42501'); end if;
  if p_branch is not null and m.branch_ids is not null and not (p_branch = any (m.branch_ids)) then
    perform app.fail('Acesso negado a esta filial.', '42501');
  end if;
  select * into t from public.tenants where id = p_tenant;
  select p.modules into modules from public.plans p where p.id = t.plan_id;
  if not ('*' = any (modules) or p_module = any (modules) or p_module in ('dashboard', 'configuracoes', 'personalizacao', 'minha-assinatura', 'notificacoes', 'filiais', 'funcionarios', 'categorias', 'aplicacoes', 'tarefas', 'instancias')) then
    perform app.fail('Módulo não incluído no plano atual.', '42501');
  end if;
  if p_action <> 'visualizar' and p_module <> 'minha-assinatura' and t.status in ('Suspensa', 'Cancelada') then
    perform app.fail('Assinatura ' || lower(t.status) || ': operação bloqueada. Regularize em Minha assinatura.', '42501');
  end if;
  return m;
end $$;

create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin com MFA.', '42501'); end if;
end $$;

create or replace function app.audit(p_tenant uuid, p_action text, p_entity text default '', p_entity_id text default '', p_data jsonb default '{}')
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (tenant_id, user_id, action, entity, entity_id, data, correlation_id)
  values (p_tenant, auth.uid(), p_action, p_entity, p_entity_id, p_data, app.correlation_id())
$$;

-- Evento no outbox na mesma transação. depth evita automações em laço.
create or replace function app.emit(p_tenant uuid, p_type text, p_payload jsonb default '{}', p_depth integer default 0)
returns void language sql security definer set search_path = '' as $$
  insert into public.outbox_events (tenant_id, type, payload, depth, correlation_id)
  select p_tenant, p_type, p_payload, p_depth, app.correlation_id() where p_depth <= 3
$$;

create or replace function app.touch() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger tenants_touch before update on public.tenants for each row execute function app.touch();
create trigger products_touch before update on public.products for each row execute function app.touch();
create trigger records_touch before update on public.records for each row execute function app.touch();

-- Perfil criado no cadastro do Auth.
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (user_id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', ''), coalesce(new.email, ''))
  on conflict (user_id) do nothing;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- ---------------------------------------------------------------- grants
-- Cliente lê via RLS; escreve SOMENTE por RPC. anon não vê nada além do catálogo de planos.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema app from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
alter default privileges in schema app revoke execute on functions from public, anon, authenticated;
grant usage on schema app to authenticated;
grant execute on function app.is_platform_admin(), app.is_member(uuid), app.can_branch(uuid, uuid), app.role_can(text, text, text) to authenticated;

grant select on public.plans to anon, authenticated;
grant select on
  public.tenants, public.branches, public.profiles, public.memberships, public.invites, public.platform_admins,
  public.products, public.customers, public.stock_balances, public.stock_movements,
  public.cash_registers, public.cash_movements, public.sales, public.sale_items, public.sale_payments,
  public.financial_entries, public.settlements, public.records, public.audit_logs, public.notifications,
  public.notification_reads, public.notification_preferences, public.push_subscriptions,
  public.subscriptions, public.coupons, public.billing_invoices, public.coupon_redemptions,
  public.whatsapp_instances, public.whatsapp_messages, public.ai_settings, public.ai_usage, public.knowledge_articles,
  public.email_messages, public.outbox_events, public.webhook_events, public.billing_transactions
to authenticated;
-- integration_secrets: nenhum grant. Só service_role (Edge Functions).

-- ---------------------------------------------------------------- RLS
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

create policy plans_read on public.plans for select to anon, authenticated using (active);
create policy plans_admin_read on public.plans for select to authenticated using (app.is_platform_admin());

create policy tenants_read on public.tenants for select to authenticated using (app.is_member(id) or app.is_platform_admin());
create policy branches_read on public.branches for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());
create policy profiles_read on public.profiles for select to authenticated using (
  user_id = auth.uid() or app.is_platform_admin()
  or exists (select 1 from public.memberships m where m.user_id = profiles.user_id and app.is_member(m.tenant_id)));
create policy memberships_read on public.memberships for select to authenticated using (user_id = auth.uid() or app.is_member(tenant_id) or app.is_platform_admin());
create policy invites_read on public.invites for select to authenticated using (
  app.is_platform_admin() or exists (select 1 from public.memberships m where m.tenant_id = invites.tenant_id and m.user_id = auth.uid() and m.active and m.role in ('Proprietário', 'Administrador')));
create policy platform_admins_read on public.platform_admins for select to authenticated using (user_id = auth.uid());

-- Dados por tenant (todos os membros leem o tenant; filiais restritas onde houver branch_id).
create policy products_read on public.products for select to authenticated using (app.is_member(tenant_id));
create policy customers_read on public.customers for select to authenticated using (app.is_member(tenant_id));
create policy stock_balances_read on public.stock_balances for select to authenticated using (app.is_member(tenant_id));
create policy stock_movements_read on public.stock_movements for select to authenticated using (app.can_branch(tenant_id, branch_id));
create policy cash_registers_read on public.cash_registers for select to authenticated using (app.can_branch(tenant_id, branch_id));
create policy cash_movements_read on public.cash_movements for select to authenticated using (app.is_member(tenant_id));
create policy sales_read on public.sales for select to authenticated using (app.can_branch(tenant_id, branch_id));
create policy sale_items_read on public.sale_items for select to authenticated using (app.is_member(tenant_id));
create policy sale_payments_read on public.sale_payments for select to authenticated using (app.is_member(tenant_id));
create policy financial_entries_read on public.financial_entries for select to authenticated using (
  app.can_branch(tenant_id, branch_id) and app.role_can((app.membership(tenant_id)).role, 'financeiro'));
create policy settlements_read on public.settlements for select to authenticated using (
  app.is_member(tenant_id) and app.role_can((app.membership(tenant_id)).role, 'financeiro'));
create policy records_read on public.records for select to authenticated using (
  (tenant_id is not null and app.is_member(tenant_id)) or (tenant_id is null and app.is_platform_admin()));
create policy audit_read on public.audit_logs for select to authenticated using (
  app.is_platform_admin() or (tenant_id is not null and (app.membership(tenant_id)).role in ('Proprietário', 'Administrador')));
create policy outbox_read on public.outbox_events for select to authenticated using (app.is_platform_admin());
create policy webhook_events_read on public.webhook_events for select to authenticated using (app.is_platform_admin());
create policy billing_transactions_read on public.billing_transactions for select to authenticated using (app.is_platform_admin() or app.is_member(tenant_id));

create policy notifications_read on public.notifications for select to authenticated using (
  user_id = auth.uid()
  or (user_id is null and tenant_id is not null and app.is_member(tenant_id))
  or (tenant_id is null and user_id is null and app.is_platform_admin()));
create policy notification_reads_read on public.notification_reads for select to authenticated using (user_id = auth.uid());
create policy notification_preferences_read on public.notification_preferences for select to authenticated using (user_id = auth.uid());
create policy push_subscriptions_read on public.push_subscriptions for select to authenticated using (user_id = auth.uid());

create policy subscriptions_read on public.subscriptions for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());
create policy coupons_read on public.coupons for select to authenticated using (app.is_platform_admin());
create policy invoices_read on public.billing_invoices for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());
create policy redemptions_read on public.coupon_redemptions for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());

create policy wa_instances_read on public.whatsapp_instances for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());
create policy wa_messages_read on public.whatsapp_messages for select to authenticated using (
  app.is_member(tenant_id) and app.role_can((app.membership(tenant_id)).role, 'whatsapp'));
create policy ai_settings_read on public.ai_settings for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());
create policy ai_usage_read on public.ai_usage for select to authenticated using (app.is_platform_admin() or (app.membership(tenant_id)).role in ('Proprietário', 'Administrador'));
create policy knowledge_read on public.knowledge_articles for select to authenticated using (tenant_id is null or app.is_member(tenant_id) or app.is_platform_admin());
create policy email_messages_read on public.email_messages for select to authenticated using (app.is_platform_admin());

-- Realtime: só tabelas de notificação/mensagens, sempre filtradas pela RLS acima.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.notifications, public.whatsapp_messages;
  end if;
end $$;
