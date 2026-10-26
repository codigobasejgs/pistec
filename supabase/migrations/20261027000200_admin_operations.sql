-- Super Admin 4.0 — ciclo de vida da assinatura, métricas, visão 360°, administradores e reprocessamento.
-- Toda ação exige justificativa e grava audit_logs com estado anterior/posterior.

create or replace function app.reason(p text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if p is null or length(btrim(p)) < 5 then perform app.fail('Informe uma justificativa (mínimo 5 caracteres).'); end if;
  return left(btrim(p), 500);
end $$;

-- Prorrogação de teste: só assinatura em teste (nunca altera período pago).
create or replace function public.admin_extend_trial(p_tenant uuid, p_days int, p_reason text) returns date
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; v_reason text := app.reason(p_reason); v_end date;
begin
  perform app.require_admin('subscriptions.manage');
  if p_days is null or p_days < 1 or p_days > 90 then perform app.fail('Prorrogação entre 1 e 90 dias.'); end if;
  select * into s from public.subscriptions where tenant_id = p_tenant for update;
  if s.tenant_id is null then perform app.fail('Assinatura não encontrada.'); end if;
  if s.status <> 'trialing' then perform app.fail('Só é possível prorrogar empresas em teste. Para assinaturas pagas, use reativação ou fatura.'); end if;
  v_end := greatest(s.current_period_end, current_date) + p_days;
  update public.subscriptions set current_period_end = v_end, updated_at = now() where tenant_id = p_tenant;
  update public.tenants set due_date = v_end, status = 'Teste' where id = p_tenant;
  perform app.audit(p_tenant, format('Teste prorrogado em %s dias', p_days), 'subscription', p_tenant::text,
    jsonb_build_object('before', s.current_period_end, 'after', v_end, 'reason', v_reason));
  insert into public.notifications (tenant_id, type, title, body, module) values (p_tenant, 'subscription.trial_extended', 'Período de teste prorrogado', 'Novo término: ' || to_char(v_end, 'DD/MM/YYYY'), 'minha-assinatura');
  return v_end;
end $$;

-- Troca de plano: valida uso atual contra os limites do plano novo (não esconde dados).
create or replace function public.admin_change_plan(p_tenant uuid, p_plan text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tenants; v_next public.plans; v_usage record; v_reason text := app.reason(p_reason);
begin
  perform app.require_admin('subscriptions.manage');
  select * into t from public.tenants where id = p_tenant for update;
  if t.id is null then perform app.fail('Empresa não encontrada.'); end if;
  select * into v_next from public.plans where id = p_plan;
  if v_next.id is null then perform app.fail('Plano inválido.'); end if;
  select (select count(*) from public.memberships where tenant_id = p_tenant and active) users,
         (select count(*) from public.branches where tenant_id = p_tenant and active) branches,
         (select count(*) from public.products where tenant_id = p_tenant and active) products,
         (select count(*) from public.whatsapp_instances where tenant_id = p_tenant and status <> 'archived') whatsapp into v_usage;
  if v_usage.users > v_next.users or v_usage.branches > v_next.branches or v_usage.products > v_next.products or v_usage.whatsapp > v_next.whatsapp then
    perform app.fail(format('Uso atual excede o plano %s (usuários %s/%s, filiais %s/%s, produtos %s/%s, WhatsApp %s/%s).', v_next.name,
      v_usage.users, v_next.users, v_usage.branches, v_next.branches, v_usage.products, v_next.products, v_usage.whatsapp, v_next.whatsapp));
  end if;
  update public.tenants set plan_id = p_plan where id = p_tenant;
  update public.subscriptions set plan_id = p_plan, updated_at = now() where tenant_id = p_tenant;
  perform app.audit(p_tenant, format('Plano alterado: %s → %s', t.plan_id, p_plan), 'subscription', p_tenant::text,
    jsonb_build_object('before', t.plan_id, 'after', p_plan, 'reason', v_reason));
end $$;

-- Suspender / reativar / cancelar. Nenhuma ação apaga dados.
create or replace function public.admin_set_subscription(p_tenant uuid, p_action text, p_reason text, p_days int default 30) returns text
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; t public.tenants; v_reason text := app.reason(p_reason); v_status text; v_end date;
begin
  perform app.require_admin('subscriptions.manage');
  select * into t from public.tenants where id = p_tenant for update;
  select * into s from public.subscriptions where tenant_id = p_tenant for update;
  if t.id is null or s.tenant_id is null then perform app.fail('Empresa ou assinatura não encontrada.'); end if;
  case p_action
    when 'suspend' then
      if t.status = 'Suspensa' then perform app.fail('Empresa já está suspensa.'); end if;
      update public.subscriptions set status = 'suspended', updated_at = now() where tenant_id = p_tenant;
      update public.tenants set status = 'Suspensa' where id = p_tenant; v_status := 'Suspensa';
      perform app.emit(p_tenant, 'subscription.suspended', jsonb_build_object('reason', 'admin'));
    when 'reactivate' then
      if t.status not in ('Suspensa', 'Vencida', 'Cancelada') then perform app.fail('Somente empresas suspensas, vencidas ou canceladas podem ser reativadas.'); end if;
      if p_days is null or p_days < 1 or p_days > 365 then perform app.fail('Período de reativação entre 1 e 365 dias.'); end if;
      v_end := greatest(s.current_period_end, current_date) + p_days;
      update public.subscriptions set status = 'active', current_period_end = v_end, cancel_at_period_end = false, updated_at = now() where tenant_id = p_tenant;
      update public.tenants set status = 'Ativa', due_date = v_end where id = p_tenant; v_status := 'Ativa';
      insert into public.notifications (tenant_id, type, title, body, module) values (p_tenant, 'subscription.reactivated', 'Assinatura reativada', 'Acesso liberado até ' || to_char(v_end, 'DD/MM/YYYY'), 'minha-assinatura');
    when 'cancel' then
      -- Cancelamento ao fim do período: respeita o que já foi pago.
      update public.subscriptions set cancel_at_period_end = true, updated_at = now() where tenant_id = p_tenant; v_status := t.status;
    when 'end_trial' then
      if s.status <> 'trialing' then perform app.fail('A empresa não está em teste.'); end if;
      update public.subscriptions set current_period_end = current_date, updated_at = now() where tenant_id = p_tenant;
      update public.tenants set due_date = current_date where id = p_tenant; v_status := t.status;
    else perform app.fail('Ação inválida.');
  end case;
  perform app.audit(p_tenant, 'Assinatura: ' || p_action, 'subscription', p_tenant::text,
    jsonb_build_object('before', jsonb_build_object('status', t.status, 'periodEnd', s.current_period_end), 'after', jsonb_build_object('status', v_status, 'periodEnd', coalesce(v_end, s.current_period_end)), 'reason', v_reason));
  return v_status;
end $$;

-- Planos: auditoria com valores anteriores. Faturas existentes guardam o valor (snapshot) e não mudam.
create or replace function public.admin_save_plan(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := coalesce(nullif(p ->> 'id', ''), app.slugify(p ->> 'name')); before public.plans;
begin
  perform app.require_platform_admin();
  select * into before from public.plans where id = v_id;
  insert into public.plans (id, name, monthly, quarterly, annual, users, branches, products, whatsapp, ai_messages, trial_days, features, modules, active, sort)
  values (v_id, app.req_text(p ->> 'name', 'Nome do plano'), app.int_val(p -> 'monthly', 'Mensal'), app.int_val(p -> 'quarterly', 'Trimestral'), app.int_val(p -> 'annual', 'Anual'),
          app.int_val(p -> 'users', 'Usuários'), app.int_val(p -> 'branches', 'Filiais'), app.int_val(p -> 'products', 'Produtos'), app.int_val(p -> 'whatsapp', 'WhatsApp'),
          app.int_val(coalesce(p -> 'aiMessages', '0'), 'IA'), app.int_val(coalesce(p -> 'trialDays', '14'), 'Dias de teste'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'features') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'modules') x), '{*}'),
          coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, coalesce(before.sort, 99)))
  on conflict (id) do update set name = excluded.name, monthly = excluded.monthly, quarterly = excluded.quarterly, annual = excluded.annual, users = excluded.users,
    branches = excluded.branches, products = excluded.products, whatsapp = excluded.whatsapp, ai_messages = excluded.ai_messages, trial_days = excluded.trial_days,
    features = excluded.features, modules = case when p ? 'modules' then excluded.modules else public.plans.modules end, active = excluded.active, sort = excluded.sort;
  perform app.audit(null, 'Plano salvo: ' || v_id, 'plan', v_id, jsonb_build_object('before', to_jsonb(before), 'after', p));
  return v_id;
end $$;

-- ---------------------------------------------------------------- métricas (definições em docs/SUPER_ADMIN_FEATURES.md)
-- MRR: soma do valor mensal equivalente do plano das assinaturas 'active' (trimestral/3, anual/12). Não é dinheiro recebido.
create or replace function public.admin_metrics(p_from date default current_date - 30, p_to date default current_date) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare fin boolean;
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  fin := app.admin_can('billing.read');
  return jsonb_build_object(
    'tenants', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where status = 'Ativa'), 'trial', count(*) filter (where status = 'Teste'),
       'overdue', count(*) filter (where status = 'Vencida'), 'suspended', count(*) filter (where status = 'Suspensa'), 'cancelled', count(*) filter (where status = 'Cancelada'),
       'newInPeriod', count(*) filter (where created_at::date between p_from and p_to),
       'trialEnding', count(*) filter (where status = 'Teste' and due_date between current_date and current_date + 7),
       'onboardingIncomplete', count(*) filter (where not exists (select 1 from public.products p where p.tenant_id = tenants.id))) from public.tenants),
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'tenants', (select count(*) from public.tenants t where t.plan_id = p.id and t.status <> 'Cancelada'))
       order by p.sort), '[]') from public.plans p),
    'subscriptions', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.subscriptions group by 1) x),
    'growth', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'created', (select count(*) from public.tenants where created_at::date = d::date)) order by d), '[]')
       from generate_series(p_from, p_to, interval '1 day') d),
    'tickets', (select count(*) from public.records where kind = 'admin-ticket' and status not in ('Resolvido', 'Encerrado')),
    'leads', (select count(*) from public.records where kind = 'admin-lead' and status not in ('Convertido', 'Perdido')),
    'finance', case when not fin then null else jsonb_build_object(
       'mrr', (select coalesce(sum(case s.period when 'monthly' then p.monthly when 'quarterly' then p.quarterly / 3 else p.annual / 12 end), 0)
               from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status = 'active'),
       'mrrByPlan', (select coalesce(jsonb_agg(jsonb_build_object('plan', name, 'mrr', mrr) order by mrr desc), '[]') from (
               select p.name, sum(case s.period when 'monthly' then p.monthly when 'quarterly' then p.quarterly / 3 else p.annual / 12 end) mrr
               from public.subscriptions s join public.plans p on p.id = s.plan_id where s.status = 'active' group by p.name) x),
       'received', (select coalesce(sum(paid_amount), 0) from public.billing_transactions where created_at::date between p_from and p_to and capture_method is distinct from 'manual'),
       'receivedManual', (select coalesce(sum(paid_amount), 0) from public.billing_transactions where created_at::date between p_from and p_to and capture_method = 'manual'),
       'pending', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from public.billing_invoices where status = 'Pendente'),
       'overdue', (select jsonb_build_object('count', count(*), 'amount', coalesce(sum(amount), 0)) from public.billing_invoices where status = 'Vencida'),
       'revenueDaily', (select coalesce(jsonb_agg(jsonb_build_object('day', d::date, 'amount', (select coalesce(sum(paid_amount), 0) from public.billing_transactions where created_at::date = d::date)) order by d), '[]')
               from generate_series(p_from, p_to, interval '1 day') d),
       'churnPeriod', (select count(*) from public.audit_logs where action like 'Assinatura: cancel%' and created_at::date between p_from and p_to)) end,
    'canFinance', fin
  );
end $$;

-- Visão 360° de uma empresa. Lista membros sem dados privados além de e-mail e papel.
create or replace function public.admin_tenant_detail(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  return (select jsonb_build_object(
    'tenant', to_jsonb(t) - 'branding' || jsonb_build_object('logo', t.branding ->> 'logo'),
    'subscription', (select to_jsonb(s) from public.subscriptions s where s.tenant_id = t.id),
    'plan', (select to_jsonb(p) from public.plans p where p.id = t.plan_id),
    'usage', jsonb_build_object('users', (select count(*) from public.memberships where tenant_id = t.id and active),
      'branches', (select count(*) from public.branches where tenant_id = t.id and active), 'products', (select count(*) from public.products where tenant_id = t.id and active),
      'customers', (select count(*) from public.customers where tenant_id = t.id), 'sales30', (select count(*) from public.sales where tenant_id = t.id and created_at > now() - interval '30 days'),
      'whatsapp', (select count(*) from public.whatsapp_instances where tenant_id = t.id and status <> 'archived'),
      'ai30', (select count(*) from public.ai_usage where tenant_id = t.id and created_at > now() - interval '30 days'),
      'emails30', (select count(*) from public.email_messages where tenant_id = t.id and created_at > now() - interval '30 days'),
      'pushDevices', (select count(*) from public.push_subscriptions ps join public.memberships m on m.user_id = ps.user_id and m.tenant_id = t.id where ps.expired_at is null)),
    'members', (select coalesce(jsonb_agg(jsonb_build_object('role', m.role, 'active', m.active, 'email', u.email, 'since', m.created_at, 'allBranches', m.branch_ids is null) order by m.created_at), '[]')
      from public.memberships m join auth.users u on u.id = m.user_id where m.tenant_id = t.id),
    'invites', (select coalesce(jsonb_agg(jsonb_build_object('email', email, 'role', role, 'expires', expires_at, 'accepted', accepted_at is not null, 'revoked', revoked_at is not null)), '[]') from public.invites where tenant_id = t.id),
    'branches', (select coalesce(jsonb_agg(jsonb_build_object('name', b.name, 'active', b.active, 'created', b.created_at)), '[]') from public.branches b where b.tenant_id = t.id),
    'whatsappInstances', (select coalesce(jsonb_agg(jsonb_build_object('status', status, 'bot', bot_enabled, 'updated', updated_at)), '[]') from public.whatsapp_instances where tenant_id = t.id),
    'invoices', case when app.admin_can('billing.read') then (select coalesce(jsonb_agg(to_jsonb(i) - 'checkout_url' order by i.created_at desc), '[]') from public.billing_invoices i where i.tenant_id = t.id) end,
    'audit', case when app.admin_can('audit.read') then (select coalesce(jsonb_agg(jsonb_build_object('at', a.created_at, 'action', a.action, 'data', a.data, 'by', (select email from auth.users where id = a.user_id)) order by a.id desc), '[]')
      from (select * from public.audit_logs where tenant_id = t.id order by id desc limit 100) a) end,
    'tickets', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'status', status, 'date', date) order by date desc), '[]') from public.records where kind = 'admin-ticket' and fields ->> 'tenantId' = t.id::text),
    'notes', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'title', title, 'date', date, 'history', history) order by date desc), '[]') from public.records where kind = 'admin-note' and fields ->> 'tenantId' = t.id::text)
  ) from public.tenants t where t.id = p_tenant);
end $$;

-- Administradores (só proprietário gerencia). O próprio papel de proprietário não pode ser removido por engano.
create or replace function public.admin_list_admins() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('userId', a.user_id, 'email', u.email, 'role', a.role, 'note', a.note, 'since', a.created_at, 'me', a.user_id = auth.uid()) order by a.created_at), '[]')
    from public.platform_admins a join auth.users u on u.id = a.user_id);
end $$;

create or replace function public.admin_set_admin(p_email text, p_role text, p_remove boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid; before text;
begin
  perform app.require_admin('admins.manage');
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null then perform app.fail('Usuário não encontrado. A pessoa precisa criar a conta em /app/cadastro antes.'); end if;
  if v_user = auth.uid() then perform app.fail('Não altere o próprio acesso administrativo.'); end if;
  select role into before from public.platform_admins where user_id = v_user;
  if p_remove then
    delete from public.platform_admins where user_id = v_user;
  else
    if p_role not in ('owner', 'admin', 'finance', 'sales', 'support', 'ops', 'auditor') then perform app.fail('Perfil inválido.'); end if;
    insert into public.platform_admins (user_id, role, note) values (v_user, p_role, 'Concedido por ' || app.user_name())
    on conflict (user_id) do update set role = excluded.role;
  end if;
  perform app.audit(null, case when p_remove then 'Administrador removido' else 'Perfil administrativo definido' end, 'platform_admin', v_user::text,
    jsonb_build_object('email', lower(p_email), 'before', before, 'after', case when p_remove then null else p_role end));
end $$;

-- Reprocessar evento do outbox em dead-letter. Handlers são idempotentes (dedup por source_event_id / idempotency_key).
create or replace function public.admin_retry_event(p_id bigint, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reason text := app.reason(p_reason);
begin
  perform app.require_admin('jobs.retry');
  update public.outbox_events set status = 'pending', attempts = 0, available_at = now(), last_error = null, locked_at = null where id = p_id and status = 'dead';
  if not found then perform app.fail('Somente eventos com falha definitiva podem ser reprocessados.'); end if;
  perform app.audit(null, 'Evento reprocessado', 'outbox_event', p_id::text, jsonb_build_object('reason', v_reason));
end $$;

-- Comunicado com público por plano/situação/seleção; push só se o canal for marcado (notificação já gera push conforme preferências).
create or replace function public.admin_broadcast(p_title text, p_body text, p_audience text default 'all') returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform app.require_admin('broadcast');
  insert into public.notifications (tenant_id, type, title, body)
  select id, 'platform.announcement', left(app.req_text(p_title, 'Título'), 160), left(coalesce(p_body, ''), 2000) from public.tenants
  where p_audience = 'all' or (p_audience = 'trial' and status = 'Teste') or (p_audience = 'overdue' and status in ('Vencida', 'Suspensa')) or (p_audience = 'active' and status = 'Ativa')
     or (p_audience like 'plan:%' and plan_id = substr(p_audience, 6))
     or (p_audience like 'ids:%' and id::text = any (string_to_array(substr(p_audience, 5), ',')));
  get diagnostics n = row_count;
  perform app.audit(null, format('Comunicado "%s" para %s empresas', p_title, n), 'notification', '', jsonb_build_object('audience', p_audience));
  return n;
end $$;

-- Pergunta de permissão para Edge Functions (com JWT do usuário). Responde só sobre o próprio usuário.
create or replace function public.admin_can_check(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$ select app.admin_can(p_perm) $$;
grant execute on function public.admin_can_check(text) to authenticated;

-- Dados agregados de uso por empresa (IA e WhatsApp), sem conteúdo de conversas.
create or replace function public.admin_usage(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  return jsonb_build_object(
    'ai', (select coalesce(jsonb_agg(x order by x.requests desc), '[]') from (
      select t.id, t.name, s.enabled, s.whatsapp_bot, s.daily_limit, p.ai_messages plan_limit,
        count(u.id) requests, coalesce(sum(u.input_tokens), 0) input_tokens, coalesce(sum(u.output_tokens), 0) output_tokens, count(u.id) filter (where u.blocked is not null) blocked
      from public.tenants t join public.plans p on p.id = t.plan_id left join public.ai_settings s on s.tenant_id = t.id
      left join public.ai_usage u on u.tenant_id = t.id and u.created_at > now() - make_interval(days => p_days)
      group by t.id, t.name, s.enabled, s.whatsapp_bot, s.daily_limit, p.ai_messages having bool_or(s.enabled) or count(u.id) > 0) x),
    'whatsapp', (select coalesce(jsonb_agg(x order by x.received desc), '[]') from (
      select t.id, t.name, i.status, i.bot_enabled, i.updated_at,
        (select count(*) from public.whatsapp_messages m where m.instance_id = i.id and m.direction = 'in' and m.created_at > now() - make_interval(days => p_days)) received,
        (select count(*) from public.whatsapp_messages m where m.instance_id = i.id and m.direction = 'out' and m.created_at > now() - make_interval(days => p_days)) sent,
        (select count(*) from public.whatsapp_messages m where m.instance_id = i.id and m.status ilike '%fail%') failed
      from public.whatsapp_instances i join public.tenants t on t.id = i.tenant_id where i.status <> 'archived') x)
  );
end $$;

-- Admin pode desligar a IA de uma empresa por motivo administrativo (auditado).
create or replace function public.admin_set_ai(p_tenant uuid, p_enabled boolean, p_limit int, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reason text := app.reason(p_reason); before public.ai_settings;
begin
  perform app.require_admin('integrations.manage');
  select * into before from public.ai_settings where tenant_id = p_tenant;
  insert into public.ai_settings (tenant_id, enabled, daily_limit) values (p_tenant, p_enabled, least(greatest(coalesce(p_limit, before.daily_limit, 50), 0), 5000))
  on conflict (tenant_id) do update set enabled = excluded.enabled, daily_limit = excluded.daily_limit, updated_at = now();
  perform app.audit(p_tenant, case when p_enabled then 'IA liberada pelo Super Admin' else 'IA suspensa pelo Super Admin' end, 'ai_settings', p_tenant::text,
    jsonb_build_object('before', jsonb_build_object('enabled', before.enabled, 'limit', before.daily_limit), 'after', jsonb_build_object('enabled', p_enabled, 'limit', p_limit), 'reason', v_reason));
end $$;
revoke all on function public.admin_usage(int), public.admin_set_ai(uuid,boolean,int,text) from public, anon;
grant execute on function public.admin_usage(int), public.admin_set_ai(uuid,boolean,int,text) to authenticated;

revoke all on function public.admin_extend_trial(uuid,int,text), public.admin_change_plan(uuid,text,text), public.admin_set_subscription(uuid,text,text,int),
  public.admin_metrics(date,date), public.admin_tenant_detail(uuid), public.admin_list_admins(), public.admin_set_admin(text,text,boolean),
  public.admin_retry_event(bigint,text) from public, anon;
grant execute on function public.admin_extend_trial(uuid,int,text), public.admin_change_plan(uuid,text,text), public.admin_set_subscription(uuid,text,text,int),
  public.admin_metrics(date,date), public.admin_tenant_detail(uuid), public.admin_list_admins(), public.admin_set_admin(text,text,boolean),
  public.admin_retry_event(bigint,text) to authenticated;

-- Teste de push do próprio administrador (notificação de plataforma pessoal). 5 por 10 minutos.
create or replace function public.send_test_push_platform() returns integer
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  if (select count(*) from public.notifications where user_id = auth.uid() and type = 'push.test' and created_at > now() - interval '10 minutes') >= 5 then
    perform app.fail('Muitos testes seguidos. Aguarde alguns minutos.');
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid() and expired_at is null) then
    perform app.fail('Nenhum dispositivo ativo. Ative as notificações neste aparelho primeiro.');
  end if;
  insert into public.notifications (tenant_id, user_id, type, title, body) values (null, auth.uid(), 'push.test', 'Teste de notificação PISTEC', 'Notificações da plataforma funcionando.');
  return (select count(*) from public.push_subscriptions where user_id = auth.uid() and expired_at is null);
end $$;
revoke all on function public.send_test_push_platform() from public, anon;
grant execute on function public.send_test_push_platform() to authenticated;
