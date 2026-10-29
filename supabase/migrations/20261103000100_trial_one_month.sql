-- Teste gratuito de 1 MÊS CALENDÁRIO para novas empresas (vigência 03/11/2026).
-- Regra única no servidor: app.trial_end(início) = mesmo dia do mês seguinte no calendário de São Paulo;
-- se o mês seguinte não tiver o dia (29/30/31), usa o último dia desse mês. Acesso até o fim desse dia (due_date inclusivo).
-- Empresas e assinaturas existentes NÃO são alteradas. Contratos assinados não mudam.

-- Política: quantos meses (por plano). 0 = plano sem teste. trial_days fica só como histórico.
alter table public.plans add column if not exists trial_months integer not null default 1 check (trial_months between 0 and 3);
alter table public.tenants add column if not exists trial_started_at timestamptz;

create or replace function app.trial_end(p_start timestamptz, p_months int default 1) returns date
language sql immutable set search_path = '' as $$
  -- date + interval 'N month' já ajusta para o último dia do mês quando o dia não existe (31/01 → 28/02 ou 29/02).
  select ((p_start at time zone 'America/Sao_Paulo')::date + make_interval(months => greatest(p_months, 0)))::date
$$;
revoke all on function app.trial_end(timestamptz, int) from public, anon, authenticated;

-- Onboarding: igual ao anterior, mas o vencimento do teste vem de app.trial_end (mês calendário) e o início fica registrado.
-- Idempotente pelo slug: repetir a requisição devolve a mesma empresa e não reinicia o teste.
create or replace function public.onboard_tenant(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text; v_slug text; v_plan public.plans; v_tenant public.tenants; v_branch uuid; v_email text; v_addr jsonb; v_start timestamptz := now(); v_end date;
begin
  if v_uid is null then perform app.fail('Entre na sua conta para criar a empresa.', '28000'); end if;
  if (select email_confirmed_at from auth.users where id = v_uid) is null then perform app.fail('Confirme seu e-mail antes de criar a empresa.', '42501'); end if;
  perform pg_advisory_xact_lock(hashtextextended('onboard:' || v_uid::text, 0));
  v_name := app.req_text(p ->> 'name', 'Empresa');
  v_slug := app.slugify(coalesce(nullif(p ->> 'slug', ''), v_name));
  select * into v_tenant from public.tenants where slug = v_slug and created_by = v_uid;
  if found then return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', (select id from public.branches where tenant_id = v_tenant.id order by created_at limit 1), 'trialEndsAt', v_tenant.due_date); end if;
  if v_slug = '' or length(v_slug) > 60 or exists (select 1 from public.tenants where slug = v_slug) then perform app.fail('Identificador da empresa indisponível.'); end if;
  if (select count(*) from public.tenants where created_by = v_uid) >= 3 then perform app.fail('Limite de empresas por conta atingido. Fale com o suporte.'); end if;
  select * into v_plan from public.plans where id = coalesce(nullif(p ->> 'planId', ''), 'essencial') and active;
  if v_plan.id is null then perform app.fail('Plano inválido.'); end if;
  v_addr := app.address_norm(p -> 'address', false);
  v_email := coalesce(nullif(btrim(p ->> 'email'), ''), (select email from auth.users where id = v_uid));
  v_end := app.trial_end(v_start, v_plan.trial_months);
  insert into public.tenants (slug, name, legal_name, document, owner_name, email, profile, plan_id, status, due_date, trial_started_at, branding, notes, created_by, address, address_data)
  values (v_slug, v_name, coalesce(nullif(btrim(p ->> 'legalName'), ''), v_name), regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'),
          app.req_text(coalesce(p ->> 'owner', app.user_name()), 'Responsável'), lower(v_email), coalesce(nullif(p ->> 'profile', ''), 'Autopeças'),
          v_plan.id, 'Teste', v_end, v_start, coalesce(p -> 'branding', '{}'), '', v_uid, left(app.address_text(v_addr), 300), v_addr)
  returning * into v_tenant;
  insert into public.branches (tenant_id, name, address, address_data) values (v_tenant.id, 'Matriz', v_tenant.address, v_addr) returning id into v_branch;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'Proprietário');
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_end) values (v_tenant.id, v_plan.id, 'trialing', v_tenant.due_date);
  insert into public.ai_settings (tenant_id) values (v_tenant.id);
  perform app.audit(v_tenant.id, 'Empresa criada: ' || v_name, 'tenant', v_tenant.id::text, jsonb_build_object('trialStartedAt', v_start, 'trialEndsAt', v_end, 'trialMonths', v_plan.trial_months));
  perform app.emit(v_tenant.id, 'tenant.created', jsonb_build_object('name', v_name, 'email', v_tenant.email, 'plan', v_plan.name));
  return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', v_branch, 'trialEndsAt', v_end);
end $$;

-- Super Admin: salvar plano passa a usar meses de teste (trialMonths). trialDays é ignorado.
create or replace function public.admin_save_plan(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := coalesce(nullif(p ->> 'id', ''), app.slugify(p ->> 'name')); before public.plans; v_months int;
begin
  perform app.require_platform_admin();
  select * into before from public.plans where id = v_id;
  v_months := coalesce((p ->> 'trialMonths')::int, before.trial_months, 1);
  if v_months not between 0 and 3 then perform app.fail('Teste grátis entre 0 e 3 meses.'); end if;
  insert into public.plans (id, name, monthly, quarterly, annual, users, branches, products, whatsapp, ai_messages, trial_months, features, modules, active, sort)
  values (v_id, app.req_text(p ->> 'name', 'Nome do plano'), app.int_val(p -> 'monthly', 'Mensal'), app.int_val(p -> 'quarterly', 'Trimestral'), app.int_val(p -> 'annual', 'Anual'),
          app.int_val(p -> 'users', 'Usuários'), app.int_val(p -> 'branches', 'Filiais'), app.int_val(p -> 'products', 'Produtos'), app.int_val(p -> 'whatsapp', 'WhatsApp'),
          app.int_val(coalesce(p -> 'aiMessages', '0'), 'IA'), v_months,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'features') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'modules') x), '{*}'),
          coalesce((p ->> 'active')::boolean, true), coalesce((p ->> 'sort')::int, coalesce(before.sort, 99)))
  on conflict (id) do update set name = excluded.name, monthly = excluded.monthly, quarterly = excluded.quarterly, annual = excluded.annual, users = excluded.users,
    branches = excluded.branches, products = excluded.products, whatsapp = excluded.whatsapp, ai_messages = excluded.ai_messages, trial_months = excluded.trial_months,
    features = excluded.features, modules = case when p ? 'modules' then excluded.modules else public.plans.modules end, active = excluded.active, sort = excluded.sort;
  perform app.audit(null, 'Plano salvo: ' || v_id, 'plan', v_id, jsonb_build_object('before', to_jsonb(before), 'after', p));
  return v_id;
end $$;

-- Prorrogação pelo Super Admin: aceita nova data explícita OU dias; registra prazo anterior e justificativa.
create or replace function public.admin_extend_trial_until(p_tenant uuid, p_until date, p_reason text) returns date
language plpgsql security definer set search_path = '' as $$
declare s public.subscriptions; v_reason text := app.reason(p_reason);
begin
  perform app.require_admin('subscriptions.manage');
  select * into s from public.subscriptions where tenant_id = p_tenant for update;
  if s.tenant_id is null then perform app.fail('Assinatura não encontrada.'); end if;
  if s.status <> 'trialing' then perform app.fail('Só é possível prorrogar empresas em teste. Para assinaturas pagas, use reativação ou fatura.'); end if;
  if p_until is null or p_until <= greatest(s.current_period_end, (now() at time zone 'America/Sao_Paulo')::date) then perform app.fail('A nova data precisa ser posterior ao término atual.'); end if;
  if p_until > (now() at time zone 'America/Sao_Paulo')::date + 120 then perform app.fail('Prorrogação limitada a 120 dias a partir de hoje.'); end if;
  update public.subscriptions set current_period_end = p_until, updated_at = now() where tenant_id = p_tenant;
  update public.tenants set due_date = p_until, status = 'Teste' where id = p_tenant;
  perform app.audit(p_tenant, format('Teste prorrogado até %s', to_char(p_until, 'DD/MM/YYYY')), 'subscription', p_tenant::text,
    jsonb_build_object('before', s.current_period_end, 'after', p_until, 'reason', v_reason));
  insert into public.notifications (tenant_id, type, title, body, module) values (p_tenant, 'subscription.trial_extended', 'Período de teste prorrogado', 'Novo término: ' || to_char(p_until, 'DD/MM/YYYY'), 'minha-assinatura');
  return p_until;
end $$;
grant execute on function public.admin_extend_trial_until(uuid, date, text) to authenticated;

-- Política vigente (leitura pública: a landing e a contratação mostram a mesma regra do servidor).
create or replace function public.trial_policy() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('rule', 'calendar_month', 'timezone', 'America/Sao_Paulo', 'effectiveFrom', '2026-11-03',
    'plans', (select coalesce(jsonb_object_agg(id, trial_months), '{}') from public.plans where active),
    'example', jsonb_build_object('start', (now() at time zone 'America/Sao_Paulo')::date, 'end', app.trial_end(now(), 1)))
$$;
grant execute on function public.trial_policy() to anon, authenticated;

-- Avisos de término: 7, 3 e 1 dia antes e no dia, a partir da data REAL (current_period_end), sem duplicar.
create or replace function app.svc_trial_reminders() returns int
language plpgsql security definer set search_path = '' as $$
declare s record; v_today date := (now() at time zone 'America/Sao_Paulo')::date; v_left int; n int := 0;
begin
  for s in select * from public.subscriptions where status = 'trialing' and not cancel_at_period_end and current_period_end between v_today and v_today + 7 loop
    v_left := s.current_period_end - v_today;
    if v_left in (7, 3, 1, 0) and not exists (select 1 from public.outbox_events where tenant_id = s.tenant_id and type = 'subscription.trial_ending'
        and payload ->> 'periodEnd' = s.current_period_end::text and payload ->> 'daysLeft' = v_left::text) then
      perform app.emit(s.tenant_id, 'subscription.trial_ending', jsonb_build_object('periodEnd', s.current_period_end, 'daysLeft', v_left));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke all on function app.svc_trial_reminders() from public, anon, authenticated;

-- Ciclo de cobrança: idêntico ao anterior, com dois ajustes de teste gratuito:
--  1) avisos de término por app.svc_trial_reminders (7, 3, 1 e 0 dias da data REAL), no lugar da janela fixa de 3 dias;
--  2) o teste só vira "vencido" no dia seguinte ao término (calendário de São Paulo): o acesso vale até o fim de current_period_end.
--  3) a fatura de continuidade (5 dias antes do fim do teste) não é duplicada quando a empresa já tem fatura aberta com o mesmo
--     vencimento (ex.: fatura gerada pelo contrato assinado durante o teste). Fatura não é cobrança: só é paga pelo checkout.
create or replace function app.svc_billing_cycle(p_grace_days int default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; i record; created int := 0; overdue int := 0; suspended int := 0; reminders int; v_today date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  for i in update public.billing_invoices set status = 'Vencida' where status = 'Pendente' and due_date < v_today returning id, tenant_id, amount, due_date loop
    perform app.emit(i.tenant_id, 'invoice.overdue', jsonb_build_object('invoiceId', i.id, 'amount', i.amount, 'dueDate', i.due_date));
    overdue := overdue + 1;
  end loop;
  reminders := app.svc_trial_reminders();
  for s in select * from public.subscriptions where status in ('active', 'trialing', 'past_due') and current_period_end <= v_today + 5 and not cancel_at_period_end loop
    if not exists (select 1 from public.billing_invoices where tenant_id = s.tenant_id and (request_id = 'renewal:' || s.current_period_end
        or (due_date = s.current_period_end and status in ('Pendente', 'Paga')))) then
      perform app.create_invoice(s.tenant_id, s.plan_id, s.period, null, s.provider, 'renewal:' || s.current_period_end, s.current_period_end);
      created := created + 1;
    end if;
  end loop;
  update public.subscriptions set status = 'past_due', updated_at = now() where status in ('active', 'trialing') and current_period_end < v_today;
  update public.tenants t set status = 'Vencida' from public.subscriptions sub_due where sub_due.tenant_id = t.id and sub_due.status = 'past_due' and t.status in ('Ativa', 'Teste');
  for s in update public.subscriptions set status = 'suspended', updated_at = now() where status = 'past_due' and current_period_end < v_today - p_grace_days returning tenant_id loop
    update public.tenants set status = 'Suspensa' where id = s.tenant_id;
    perform app.emit(s.tenant_id, 'subscription.suspended', '{}');
    suspended := suspended + 1;
  end loop;
  with x as (update public.subscriptions set status = 'cancelled', updated_at = now() where cancel_at_period_end and current_period_end < v_today and status <> 'cancelled' returning tenant_id)
  update public.tenants t set status = 'Cancelada' from x where x.tenant_id = t.id;
  return jsonb_build_object('created', created, 'overdue', overdue, 'suspended', suspended, 'trialReminders', reminders);
end $$;

-- Entrega de eventos: idêntica à anterior; o aviso de fim de teste passa a informar os dias restantes reais (7/3/1/0)
-- e cada aviso é um e-mail distinto (chave de idempotência inclui daysLeft).
create or replace function public.deliver_internal_event(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.outbox_events; t public.tenants; title text; message text; v_module text; v_user uuid; platform_title text;
begin
  select * into e from public.outbox_events where id = p_id for update;
  if e.id is null then perform app.fail('Evento não encontrado.'); end if;
  if e.status = 'done' then return; end if;
  if e.status <> 'processing' then perform app.fail('Evento não reservado.'); end if;
  if e.depth > 3 then perform app.fail('Limite de encadeamento atingido.'); end if;
  if e.tenant_id is not null then
    select * into t from public.tenants where id = e.tenant_id;
    if t.id is null then
      update public.outbox_events set status = 'done', processed_at = now(), locked_at = null, last_error = 'tenant_removed' where id = e.id;
      return;
    end if;
  end if;
  title := case e.type
    when 'stock.low' then 'Estoque baixo'
    when 'cash.difference' then 'Diferença no fechamento de caixa'
    when 'invoice.created' then 'Fatura de assinatura disponível'
    when 'invoice.paid' then 'Pagamento da assinatura confirmado'
    when 'invoice.overdue' then 'Fatura da assinatura vencida'
    when 'subscription.trial_ending' then 'Período de teste terminando'
    when 'subscription.suspended' then 'Assinatura suspensa'
    when 'tenant.created' then 'Empresa cadastrada'
    when 'sale.completed' then 'Venda concluída'
    when 'sale.cancelled' then 'Venda cancelada'
    when 'record.status' then 'Atendimento atualizado'
    when 'subscription.cancel_requested' then 'Cancelamento solicitado'
    when 'lead.created' then 'Novo contato comercial'
    when 'record.created' then 'Registro criado'
    when 'billing.review' then 'Pagamento exige conciliação manual'
    when 'whatsapp.inbound' then 'Nova mensagem no WhatsApp'
    when 'invite.created' then null
    else 'unknown' end;
  if title = 'unknown' then perform app.fail('Tipo de evento sem handler.'); end if;
  v_module := case
    when e.type = 'stock.low' then 'estoque'
    when e.type = 'cash.difference' then 'caixa'
    when e.type in ('invoice.created','invoice.paid','invoice.overdue','subscription.cancel_requested','subscription.trial_ending','subscription.suspended') then 'minha-assinatura'
    when e.type in ('sale.completed','sale.cancelled') then 'vendas'
    when e.type in ('record.status','record.created') then app.record_module(coalesce(e.payload->>'kind',''))
    when e.type = 'whatsapp.inbound' then 'whatsapp'
    else null end;
  -- Conversa atribuída: só o atendente responsável é avisado.
  v_user := case when e.type = 'whatsapp.inbound' then (e.payload->>'assignedTo')::uuid end;
  message := case e.type when 'stock.low' then coalesce(e.payload->>'name','Produto')
    when 'record.status' then coalesce(e.payload->>'title','') || ': ' || coalesce(e.payload->>'to','')
    when 'billing.review' then 'Fatura ' || coalesce(e.payload->>'invoiceId','') || ': ' || coalesce(e.payload->>'reason','')
    when 'subscription.trial_ending' then case coalesce(e.payload->>'daysLeft','') when '0' then 'Seu teste gratuito termina hoje.' when '1' then 'Seu teste gratuito termina amanhã.' when '' then 'Seu teste gratuito está terminando.' else 'Seu teste gratuito termina em ' || (e.payload->>'daysLeft') || ' dias.' end
    else title end;
  if title is not null then
    insert into public.notifications(tenant_id, user_id, type, title, body, source_event_id, data, module)
      values(e.tenant_id, v_user, e.type, title, message, e.id, jsonb_build_object('eventId', e.id), v_module)
      on conflict (source_event_id) where source_event_id is not null do nothing;
  end if;
  -- Avisos à plataforma (Super Admin) para eventos de empresas.
  platform_title := case e.type when 'tenant.created' then 'Nova empresa cadastrada' when 'invoice.paid' then 'Pagamento de assinatura confirmado'
    when 'subscription.suspended' then 'Assinatura suspensa' when 'subscription.trial_ending' then 'Teste perto do vencimento' when 'invoice.overdue' then 'Cobrança vencida' end;
  if platform_title is not null then
    insert into public.notifications(tenant_id, type, title, body, data) values (null, 'platform.' || e.type, platform_title, coalesce(t.name, ''), jsonb_build_object('eventId', e.id, 'tenantId', e.tenant_id))
    on conflict ((data->>'eventId')) where tenant_id is null and type like 'platform.%' do nothing;
  end if;
  -- E-mails transacionais da plataforma (destinatário: e-mail da empresa ou do convidado).
  case e.type
    when 'tenant.created' then perform app.queue_email(t.id, t.email, 'welcome', jsonb_build_object('tenant', t.name, 'trialEnds', t.due_date), 'welcome:' || t.id);
    when 'invite.created' then
      perform app.queue_email(t.id, e.payload->>'email', 'invite', jsonb_build_object('tenant', t.name, 'role', e.payload->>'role', 'token', e.payload->>'token'), 'invite:' || (e.payload->>'inviteId'));
      update public.outbox_events set payload = payload - 'token' where id = e.id; -- token só no e-mail
    when 'invoice.created' then perform app.queue_email(t.id, t.email, 'invoice_created', jsonb_build_object('tenant', t.name, 'amount', e.payload->'amount', 'dueDate', e.payload->>'dueDate'), 'invoice:' || (e.payload->>'invoiceId'));
    when 'invoice.paid' then perform app.queue_email(t.id, t.email, 'payment_confirmed', jsonb_build_object('tenant', t.name, 'amount', e.payload->'amount', 'paidUntil', e.payload->>'paidUntil'), 'paid:' || (e.payload->>'invoiceId'));
    when 'invoice.overdue' then perform app.queue_email(t.id, t.email, 'invoice_overdue', jsonb_build_object('tenant', t.name, 'amount', e.payload->'amount', 'dueDate', e.payload->>'dueDate'), 'overdue:' || (e.payload->>'invoiceId'));
    when 'subscription.trial_ending' then perform app.queue_email(t.id, t.email, 'trial_ending', jsonb_build_object('tenant', t.name, 'periodEnd', e.payload->>'periodEnd', 'daysLeft', e.payload->>'daysLeft'), 'trial:' || t.id || ':' || (e.payload->>'periodEnd') || ':' || coalesce(e.payload->>'daysLeft', 'x'));
    when 'subscription.suspended' then perform app.queue_email(t.id, t.email, 'suspended', jsonb_build_object('tenant', t.name), 'suspended:' || e.id);
    else null;
  end case;
  update public.outbox_events set status = 'done', processed_at = now(), locked_at = null, last_error = null where id = e.id;
end $$;
