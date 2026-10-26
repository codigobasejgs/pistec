-- PISTEC 3.1 — entrega multicanal: Web Push, e-mail (Resend), WhatsApp (Evolution) e eventos de cobrança.
-- Fluxo: outbox_events → deliver_internal_event (notificação + e-mail na mesma transação)
--        → trigger em notifications cria notification_deliveries por dispositivo autorizado → worker envia.

-- ---------------------------------------------------------------- permissão por usuário (destinatários)
create or replace function app.member_can_read(p_user uuid, p_tenant uuid, p_module text, p_branch uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.memberships m join public.tenants t on t.id = m.tenant_id
    join public.plans p on p.id = t.plan_id
    where m.user_id = p_user and m.tenant_id = p_tenant and m.active
      and app.role_can(m.role, p_module, 'visualizar')
      and (p_branch is null or m.branch_ids is null or p_branch = any(m.branch_ids))
      and ('*' = any(p.modules) or p_module = any(p.modules)
        or p_module in ('configuracoes','minha-assinatura','funcionarios','filiais','categorias','aplicacoes','tarefas','notificacoes')))
$$;
create or replace function app.can_read(p_tenant uuid, p_module text, p_branch uuid default null) returns boolean
language sql stable security definer set search_path = '' as $$ select app.member_can_read(auth.uid(), p_tenant, p_module, p_branch) $$;
revoke all on function app.member_can_read(uuid,uuid,text,uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- Web Push
create table public.notification_deliveries (
  id bigint generated always as identity primary key,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','processing','sent','expired','dead','skipped')),
  attempts integer not null default 0,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (notification_id, subscription_id)
);
create index on public.notification_deliveries (available_at) where status = 'pending';
create index on public.notification_deliveries (user_id, created_at desc);
alter table public.notification_deliveries enable row level security;
alter table public.notification_deliveries force row level security;
grant select on public.notification_deliveries to authenticated;
grant select, insert, update, delete on public.notification_deliveries to service_role;
create policy deliveries_read on public.notification_deliveries for select to authenticated using (user_id = auth.uid());

-- Destinatários = quem pode ler a notificação agora (membership, papel, plano) e aceita push daquele tipo.
-- Limite de frequência: 30 pushes por usuário a cada 10 minutos.
create or replace function app.enqueue_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_deliveries (notification_id, subscription_id, user_id)
  select new.id, s.id, r.user_id
  from (
    select m.user_id from public.memberships m
    where new.tenant_id is not null and m.tenant_id = new.tenant_id and m.active
      and (new.user_id is null or m.user_id = new.user_id)
      and (new.module is null or app.member_can_read(m.user_id, new.tenant_id, new.module))
    union
    select a.user_id from public.platform_admins a
    where new.tenant_id is null and (new.user_id is null or a.user_id = new.user_id)
  ) r
  join public.push_subscriptions s on s.user_id = r.user_id and s.expired_at is null
  left join public.notification_preferences pref on pref.user_id = r.user_id and pref.tenant_id = new.tenant_id
  where coalesce(pref.push, true) and not (new.type = any (coalesce(pref.muted_types, '{}')))
    and (select count(*) from public.notification_deliveries d where d.user_id = r.user_id and d.created_at > now() - interval '10 minutes') < 30
  on conflict do nothing;
  return null;
end $$;
create trigger notifications_enqueue_push after insert on public.notifications for each row execute function app.enqueue_push();

-- Teste autorizado: só para o próprio usuário, na empresa da qual é membro. 5 por 10 minutos.
create or replace function public.send_test_push(p_tenant uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if auth.uid() is null then perform app.fail('Sessão expirada.', '28000'); end if;
  if not app.is_member(p_tenant) then perform app.fail('Acesso negado a esta empresa.', '42501'); end if;
  if (select count(*) from public.notifications where user_id = auth.uid() and type = 'push.test' and created_at > now() - interval '10 minutes') >= 5 then
    perform app.fail('Muitos testes seguidos. Aguarde alguns minutos.');
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid() and expired_at is null) then
    perform app.fail('Nenhum dispositivo ativo. Ative as notificações neste aparelho primeiro.');
  end if;
  insert into public.notifications (tenant_id, user_id, type, title, body) values (p_tenant, auth.uid(), 'push.test', 'Teste de notificação PISTEC', 'Notificações funcionando neste dispositivo.');
  select count(*) into n from public.notification_deliveries d join public.notifications x on x.id = d.notification_id
    where x.user_id = auth.uid() and x.type = 'push.test' and d.created_at > now() - interval '5 seconds';
  return n;
end $$;

-- Worker: reserva entregas (lease de 5 min) e devolve só o necessário para enviar. Corpo genérico: a tela bloqueada não mostra dados do registro.
create or replace function public.claim_push(p_limit integer default 50)
returns table (id bigint, endpoint text, p256dh text, auth text, title text, url text, tag text)
language plpgsql security definer set search_path = '' as $$
begin
  update public.notification_deliveries set status = case when attempts >= 5 then 'dead' else 'pending' end, locked_at = null, last_error = 'lease_expired'
    where status = 'processing' and locked_at < now() - interval '5 minutes';
  return query
  with c as (
    update public.notification_deliveries d set status = 'processing', attempts = d.attempts + 1, locked_at = now()
    where d.id in (select x.id from public.notification_deliveries x where x.status = 'pending' and x.available_at <= now()
                   order by x.id limit least(greatest(p_limit, 1), 200) for update skip locked)
    returning d.id, d.notification_id, d.subscription_id)
  select c.id, s.endpoint, s.p256dh, s.auth, n.title,
    case when n.tenant_id is null then '/app/admin' else '/app/loja/' || t.slug || '/notificacoes' end,
    n.type
  from c join public.push_subscriptions s on s.id = c.subscription_id
  join public.notifications n on n.id = c.notification_id
  left join public.tenants t on t.id = n.tenant_id;
end $$;

-- p_status: HTTP do push service (0 = falha de rede). 404/410 = inscrição expirada; 429/5xx/0 = retentativa com backoff.
create or replace function public.finish_push(p_id bigint, p_status integer, p_error text default null) returns text
language plpgsql security definer set search_path = '' as $$
declare d public.notification_deliveries; v text;
begin
  select * into d from public.notification_deliveries where id = p_id for update;
  if d.id is null or d.status <> 'processing' then return 'ignored'; end if;
  v := case when p_status between 200 and 299 then 'sent'
            when p_status in (404, 410) then 'expired'
            when p_status = 0 or p_status = 429 or p_status >= 500 then case when d.attempts >= 5 then 'dead' else 'pending' end
            else 'dead' end;
  update public.notification_deliveries set status = v, locked_at = null, last_status = p_status, last_error = left(p_error, 300),
    sent_at = case when v = 'sent' then now() end,
    available_at = case when v = 'pending' then now() + interval '1 minute' * power(2, d.attempts) else available_at end
  where id = p_id;
  if v = 'sent' then update public.push_subscriptions set last_success_at = now(), failures = 0 where id = d.subscription_id;
  elsif v = 'expired' then update public.push_subscriptions set expired_at = now() where id = d.subscription_id;
  else update public.push_subscriptions set failures = failures + 1 where id = d.subscription_id; end if;
  return v;
end $$;

-- ---------------------------------------------------------------- E-mail (fila; renderização e envio na Edge Function)
alter table public.email_messages alter column subject set default '', alter column html set default '';
alter table public.email_messages add column data jsonb not null default '{}', add column locked_at timestamptz;
create index on public.email_messages (next_attempt_at) where status = 'queued';

-- Supressão: endereço com bounce/complaint não recebe mais. Limite: 50 e-mails por empresa por hora.
create or replace function app.queue_email(p_tenant uuid, p_to text, p_template text, p_data jsonb, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_to text := lower(btrim(coalesce(p_to, ''))); v_status text := 'queued'; v_error text;
begin
  if v_to !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return; end if;
  if exists (select 1 from public.email_messages where to_email = v_to and status in ('bounced', 'complained')) then v_status := 'failed'; v_error := 'suppressed';
  elsif p_tenant is not null and (select count(*) from public.email_messages where tenant_id = p_tenant and created_at > now() - interval '1 hour') >= 50 then v_status := 'failed'; v_error := 'rate_limited';
  end if;
  insert into public.email_messages (tenant_id, to_email, template, data, idempotency_key, status, last_error)
  values (p_tenant, v_to, p_template, coalesce(p_data, '{}'), p_key, v_status, v_error)
  on conflict (idempotency_key) do nothing;
end $$;

create or replace function public.claim_emails(p_limit integer default 20) returns setof public.email_messages
language plpgsql security definer set search_path = '' as $$
begin
  update public.email_messages set status = case when attempts >= 5 then 'dead' else 'queued' end, locked_at = null, last_error = 'lease_expired'
    where status = 'sending' and locked_at < now() - interval '5 minutes';
  return query update public.email_messages e set status = 'sending', attempts = e.attempts + 1, locked_at = now()
    where e.id in (select x.id from public.email_messages x where x.status = 'queued' and x.next_attempt_at <= now()
                   order by x.created_at limit least(greatest(p_limit, 1), 100) for update skip locked)
    returning e.*;
end $$;

create or replace function public.finish_email(p_id uuid, p_provider_id text, p_error text default null, p_permanent boolean default false) returns text
language plpgsql security definer set search_path = '' as $$
declare e public.email_messages; v text;
begin
  select * into e from public.email_messages where id = p_id for update;
  if e.id is null or e.status <> 'sending' then return 'ignored'; end if;
  v := case when p_error is null then 'sent' when p_permanent or e.attempts >= 5 then case when p_permanent then 'failed' else 'dead' end else 'queued' end;
  update public.email_messages set status = v, locked_at = null, provider_id = coalesce(p_provider_id, provider_id), last_error = left(p_error, 300),
    sent_at = case when v = 'sent' then now() end,
    next_attempt_at = case when v = 'queued' then now() + interval '1 minute' * power(2, e.attempts) else next_attempt_at end
  where id = p_id;
  return v;
end $$;

-- Webhook Resend (assinatura Svix verificada na Edge Function).
create or replace function public.email_provider_event(p_provider_id text, p_type text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text := case p_type when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.complained' then 'complained' end;
begin
  if v is null then return 'ignored'; end if;
  update public.email_messages set status = v where provider_id = p_provider_id and status in ('sent', 'delivered');
  return case when found then v else 'unknown' end;
end $$;

-- ---------------------------------------------------------------- WhatsApp: contatos, atribuição, pausa do bot
alter table public.whatsapp_instances add column webhook_token_hash text;
create table public.whatsapp_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  remote_jid text not null,
  name text not null default '',
  assigned_to uuid references auth.users(id) on delete set null,
  bot_paused boolean not null default false,
  last_message_at timestamptz not null default now(),
  unique (instance_id, remote_jid)
);
create index on public.whatsapp_contacts (tenant_id, last_message_at desc);
alter table public.whatsapp_contacts enable row level security;
alter table public.whatsapp_contacts force row level security;
grant select on public.whatsapp_contacts to authenticated;
grant select, insert, update, delete on public.whatsapp_contacts to service_role;
create policy wa_contacts_read on public.whatsapp_contacts for select to authenticated using (app.can_read(tenant_id, 'whatsapp'));
drop policy wa_instances_read on public.whatsapp_instances;
create policy wa_instances_read on public.whatsapp_instances for select to authenticated using (app.can_read(tenant_id, 'whatsapp') or app.is_platform_admin());
drop policy wa_messages_read on public.whatsapp_messages;
create policy wa_messages_read on public.whatsapp_messages for select to authenticated using (app.can_read(tenant_id, 'whatsapp'));
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.whatsapp_contacts;
  end if;
end $$;

create or replace function app.svc_whatsapp_inbound(p_instance text, p_external_id text, p_remote text, p_body text, p_from_me boolean, p_status text default 'received')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inst public.whatsapp_instances; v_id uuid; c public.whatsapp_contacts;
begin
  select * into inst from public.whatsapp_instances where instance_name = p_instance and status <> 'archived';
  if inst.id is null then return jsonb_build_object('status', 'unknown_instance'); end if;
  insert into public.whatsapp_messages (tenant_id, instance_id, external_id, remote_jid, direction, body, status)
  values (inst.tenant_id, inst.id, p_external_id, p_remote, case when p_from_me then 'out' else 'in' end, left(coalesce(p_body, ''), 8000), p_status)
  on conflict (instance_id, external_id) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'duplicate'); end if;
  insert into public.whatsapp_contacts (tenant_id, instance_id, remote_jid) values (inst.tenant_id, inst.id, p_remote)
  on conflict (instance_id, remote_jid) do update set last_message_at = now() returning * into c;
  if not p_from_me then
    perform app.emit(inst.tenant_id, 'whatsapp.inbound', jsonb_build_object('messageId', v_id, 'instanceId', inst.id, 'contactId', c.id, 'remote', p_remote,
      'assignedTo', c.assigned_to, 'bot', inst.bot_enabled and not c.bot_paused));
  end if;
  return jsonb_build_object('status', 'stored', 'id', v_id, 'tenantId', inst.tenant_id, 'bot', inst.bot_enabled and not c.bot_paused and not p_from_me);
end $$;

create or replace function public.whatsapp_inbound(p_instance text, p_external_id text, p_remote text, p_body text, p_from_me boolean, p_status text default 'received') returns jsonb
language sql security definer set search_path = '' as $$ select app.svc_whatsapp_inbound(p_instance, p_external_id, p_remote, p_body, p_from_me, p_status) $$;

create or replace function public.whatsapp_connection(p_instance text, p_state text) returns void
language sql security definer set search_path = '' as $$
  update public.whatsapp_instances set status = case when p_state in ('open','close','connecting') then p_state else status end, updated_at = now()
  where instance_name = p_instance and status <> 'archived'
$$;

-- Usuário autorizado → nome da instância da empresa (Edge Function chama com o JWT do usuário).
create or replace function public.authorize_whatsapp(p_tenant uuid, p_action text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  if p_action not in ('connect', 'state', 'logout', 'send') then perform app.fail('Ação inválida.'); end if;
  perform app.require(p_tenant, 'whatsapp', case when p_action = 'send' then 'cadastrar' when p_action = 'state' then 'visualizar' else 'configurar' end);
  select instance_name into v from public.whatsapp_instances where tenant_id = p_tenant and status <> 'archived' order by created_at limit 1;
  if v is null and p_action <> 'connect' then perform app.fail('Nenhuma instância de WhatsApp conectada.'); end if;
  return v;
end $$;

-- Cria (uma vez) a instância da empresa respeitando o limite do plano. Token do webhook só em hash.
create or replace function public.register_whatsapp_instance(p_tenant uuid, p_name text, p_token_hash text) returns text
language plpgsql security definer set search_path = '' as $$
declare v text;
begin
  select instance_name into v from public.whatsapp_instances where tenant_id = p_tenant and status <> 'archived' order by created_at limit 1;
  if v is not null then return v; end if;
  if (app.plan_of(p_tenant)).whatsapp < 1 then perform app.fail('Plano atual não inclui WhatsApp.'); end if;
  insert into public.whatsapp_instances (tenant_id, instance_name, status, webhook_token_hash) values (p_tenant, p_name, 'connecting', p_token_hash);
  return p_name;
end $$;

create or replace function public.whatsapp_token_hash(p_instance text) returns text
language sql stable security definer set search_path = '' as $$ select webhook_token_hash from public.whatsapp_instances where instance_name = p_instance and status <> 'archived' $$;

create or replace function public.assign_whatsapp_contact(p_tenant uuid, p_contact uuid, p_user uuid, p_bot_paused boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'whatsapp', 'editar');
  if p_user is not null and not app.member_can_read(p_user, p_tenant, 'whatsapp') then perform app.fail('Atendente sem acesso ao WhatsApp.'); end if;
  update public.whatsapp_contacts set assigned_to = p_user, bot_paused = p_bot_paused where id = p_contact and tenant_id = p_tenant;
  if not found then perform app.fail('Conversa não encontrada.'); end if;
  if p_user is not null and p_user <> auth.uid() then
    insert into public.notifications (tenant_id, user_id, type, title, body, module) values (p_tenant, p_user, 'whatsapp.assigned', 'Atendimento atribuído a você', 'Nova conversa no WhatsApp.', 'whatsapp');
  end if;
  perform app.audit(p_tenant, 'Conversa WhatsApp atribuída', 'whatsapp_contact', p_contact::text);
end $$;

-- ---------------------------------------------------------------- cobrança: eventos de ciclo de vida
create or replace function app.svc_billing_cycle(p_grace_days int default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; i record; created int := 0; overdue int := 0; suspended int := 0;
begin
  for i in update public.billing_invoices set status = 'Vencida' where status = 'Pendente' and due_date < current_date returning id, tenant_id, amount, due_date loop
    perform app.emit(i.tenant_id, 'invoice.overdue', jsonb_build_object('invoiceId', i.id, 'amount', i.amount, 'dueDate', i.due_date));
    overdue := overdue + 1;
  end loop;
  for s in select * from public.subscriptions where status = 'trialing' and current_period_end between current_date and current_date + 3 and not cancel_at_period_end loop
    if not exists (select 1 from public.outbox_events where tenant_id = s.tenant_id and type = 'subscription.trial_ending' and payload ->> 'periodEnd' = s.current_period_end::text) then
      perform app.emit(s.tenant_id, 'subscription.trial_ending', jsonb_build_object('periodEnd', s.current_period_end));
    end if;
  end loop;
  for s in select * from public.subscriptions where status in ('active', 'trialing', 'past_due') and current_period_end <= current_date + 5 and not cancel_at_period_end loop
    if not exists (select 1 from public.billing_invoices where tenant_id = s.tenant_id and request_id = 'renewal:' || s.current_period_end) then
      perform app.create_invoice(s.tenant_id, s.plan_id, s.period, null, s.provider, 'renewal:' || s.current_period_end, s.current_period_end);
      created := created + 1;
    end if;
  end loop;
  update public.subscriptions set status = 'past_due', updated_at = now() where status in ('active', 'trialing') and current_period_end < current_date;
  update public.tenants t set status = 'Vencida' from public.subscriptions sub_due where sub_due.tenant_id = t.id and sub_due.status = 'past_due' and t.status in ('Ativa', 'Teste');
  for s in update public.subscriptions set status = 'suspended', updated_at = now() where status = 'past_due' and current_period_end < current_date - p_grace_days returning tenant_id loop
    update public.tenants set status = 'Suspensa' where id = s.tenant_id;
    perform app.emit(s.tenant_id, 'subscription.suspended', '{}');
    suspended := suspended + 1;
  end loop;
  with x as (update public.subscriptions set status = 'cancelled', updated_at = now() where cancel_at_period_end and current_period_end < current_date and status <> 'cancelled' returning tenant_id)
  update public.tenants t set status = 'Cancelada' from x where x.tenant_id = t.id;
  return jsonb_build_object('created', created, 'overdue', overdue, 'suspended', suspended);
end $$;

-- ---------------------------------------------------------------- outbox: notificação + e-mail + aviso à plataforma
-- Reprocessar um evento não duplica o aviso à plataforma (nem o push dele).
create unique index notifications_platform_event on public.notifications ((data->>'eventId')) where tenant_id is null and type like 'platform.%';
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
    when 'subscription.trial_ending' then perform app.queue_email(t.id, t.email, 'trial_ending', jsonb_build_object('tenant', t.name, 'periodEnd', e.payload->>'periodEnd'), 'trial:' || t.id || ':' || (e.payload->>'periodEnd'));
    when 'subscription.suspended' then perform app.queue_email(t.id, t.email, 'suspended', jsonb_build_object('tenant', t.name), 'suspended:' || e.id);
    else null;
  end case;
  update public.outbox_events set status = 'done', processed_at = now(), locked_at = null, last_error = null where id = e.id;
end $$;

-- ---------------------------------------------------------------- Super Admin: saúde das integrações (dados do banco)
create or replace function public.admin_integration_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'outbox', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.outbox_events group by 1) x),
    'outboxLastError', (select jsonb_build_object('type', type, 'error', last_error, 'at', coalesce(processed_at, created_at)) from public.outbox_events where last_error is not null and last_error <> 'tenant_removed' order by id desc limit 1),
    'push', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.notification_deliveries where created_at > now() - interval '7 days' group by 1) x),
    'pushDevices', (select count(*) from public.push_subscriptions where expired_at is null),
    'pushLastError', (select jsonb_build_object('status', last_status, 'error', last_error, 'at', created_at) from public.notification_deliveries where status in ('dead','expired') order by id desc limit 1),
    'email', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.email_messages where created_at > now() - interval '7 days' group by 1) x),
    'emailLastError', (select jsonb_build_object('template', template, 'error', last_error, 'at', created_at) from public.email_messages where last_error is not null order by created_at desc limit 1),
    'billing', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.webhook_events where provider = 'InfinitePay' group by 1) x),
    'billingLastError', (select jsonb_build_object('error', error, 'at', received_at) from public.webhook_events where provider = 'InfinitePay' and error is not null order by id desc limit 1),
    'whatsapp', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.whatsapp_instances group by 1) x),
    'ai', (select jsonb_build_object('requests', count(*), 'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0), 'blocked', count(*) filter (where blocked is not null))
           from public.ai_usage where created_at > now() - interval '30 days')
  );
end $$;

-- ---------------------------------------------------------------- privilégios
revoke all on function public.send_test_push(uuid), public.claim_push(integer), public.finish_push(bigint,integer,text),
  public.claim_emails(integer), public.finish_email(uuid,text,text,boolean), public.email_provider_event(text,text),
  public.whatsapp_inbound(text,text,text,text,boolean,text), public.whatsapp_connection(text,text), public.authorize_whatsapp(uuid,text),
  public.register_whatsapp_instance(uuid,text,text), public.whatsapp_token_hash(text), public.assign_whatsapp_contact(uuid,uuid,uuid,boolean),
  public.admin_integration_summary(), app.enqueue_push(), app.queue_email(uuid,text,text,jsonb,text) from public, anon, authenticated;
grant execute on function public.send_test_push(uuid), public.authorize_whatsapp(uuid,text), public.assign_whatsapp_contact(uuid,uuid,uuid,boolean),
  public.admin_integration_summary() to authenticated;
grant execute on function public.claim_push(integer), public.finish_push(bigint,integer,text), public.claim_emails(integer), public.finish_email(uuid,text,text,boolean),
  public.email_provider_event(text,text), public.whatsapp_inbound(text,text,text,text,boolean,text), public.whatsapp_connection(text,text),
  public.register_whatsapp_instance(uuid,text,text), public.whatsapp_token_hash(text) to service_role;
