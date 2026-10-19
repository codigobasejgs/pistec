-- PISTEC 3.0 — cobrança SaaS, Super Admin, notificações, push, WhatsApp e IA (camada SQL).
-- Funções "svc_*" são chamadas só por Edge Functions com service_role (sem grant para authenticated).

-- ---------------------------------------------------------------- cupons e faturas
create or replace function app.coupon_quote(p_tenant uuid, p_code text, p_plan text, p_period text)
returns table (coupon_id uuid, code text, original bigint, discount bigint, total bigint)
language plpgsql stable security definer set search_path = '' as $$
declare pl public.plans; c public.coupons; v_original bigint; v_discount bigint; v_code text := upper(regexp_replace(coalesce(p_code, ''), '\s+', '', 'g'));
begin
  select * into pl from public.plans where id = p_plan and active;
  if pl.id is null then perform app.fail('Plano inválido.'); end if;
  v_original := case p_period when 'monthly' then pl.monthly when 'quarterly' then pl.quarterly when 'annual' then pl.annual end;
  if v_original is null or v_original <= 0 then perform app.fail('Valor de plano/período inválido.'); end if;
  if v_code = '' then return query select null::uuid, null::text, v_original, 0::bigint, v_original; return; end if;
  select * into c from public.coupons where public.coupons.code = v_code;
  if c.id is null then perform app.fail('Cupom inexistente.'); end if;
  if not c.active then perform app.fail('Cupom inativo.'); end if;
  if current_date < c.starts_at or current_date > c.ends_at then perform app.fail('Cupom fora da vigência.'); end if;
  if cardinality(c.plan_ids) > 0 and not p_plan = any (c.plan_ids) then perform app.fail('Cupom não aplicável a este plano.'); end if;
  if cardinality(c.periods) > 0 and not p_period = any (c.periods) then perform app.fail('Cupom não aplicável a este período.'); end if;
  if c.max_uses > 0 and (select count(*) from public.coupon_redemptions cr where cr.coupon_id = c.id) >= c.max_uses then perform app.fail('Limite total de usos do cupom atingido.'); end if;
  if c.per_tenant > 0 and (select count(*) from public.coupon_redemptions cr where cr.coupon_id = c.id and tenant_id = p_tenant) >= c.per_tenant then perform app.fail('Limite de usos por empresa atingido.'); end if;
  v_discount := least(v_original, greatest(0, case when c.kind = 'percent' then round(v_original * c.value / 10000.0)::bigint else c.value end));
  return query select c.id, c.code, v_original, v_discount, v_original - v_discount;
end $$;

create or replace function public.quote_coupon(p_tenant uuid, p_code text, p_plan text, p_period text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare q record;
begin
  perform app.require(p_tenant, 'minha-assinatura', 'visualizar');
  select * into q from app.coupon_quote(p_tenant, p_code, p_plan, p_period);
  return jsonb_build_object('code', q.code, 'original', q.original, 'discount', q.discount, 'total', q.total);
end $$;

-- Cria fatura (sem cobrar). O checkout real é gerado pela Edge Function billing-checkout.
-- Pagamento só é confirmado por app.svc_confirm_payment (webhook/conciliação), nunca pelo retorno do navegador.
create or replace function app.create_invoice(p_tenant uuid, p_plan text, p_period text, p_coupon text, p_provider text, p_request text, p_due date)
returns public.billing_invoices language plpgsql security definer set search_path = '' as $$
declare q record; inv public.billing_invoices; v_code text := nullif(upper(regexp_replace(coalesce(p_coupon, ''), '\s+', '', 'g')), '');
begin
  if p_period not in ('monthly', 'quarterly', 'annual') then perform app.fail('Período de faturamento inválido.'); end if;
  if p_provider not in ('InfinitePay', 'Asaas') then perform app.fail('Provedor de pagamento inválido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('invoice:' || p_tenant::text || ':' || p_request, 0));
  select * into inv from public.billing_invoices where tenant_id = p_tenant and request_id = p_request;
  if inv.id is not null then
    if inv.plan_id <> p_plan or inv.period <> p_period or inv.provider <> p_provider or inv.coupon_code is distinct from v_code then perform app.fail('Chave de fatura já utilizada com outro conteúdo.'); end if;
    return inv;
  end if;
  -- cupom: lock no cupom serializa limites de uso
  if v_code is not null then perform 1 from public.coupons where code = v_code for update; end if;
  select * into q from app.coupon_quote(p_tenant, v_code, p_plan, p_period);
  insert into public.billing_invoices (tenant_id, plan_id, period, original_amount, discount, amount, coupon_code, due_date, provider, request_id)
  values (p_tenant, p_plan, p_period, q.original, q.discount, q.total, case when q.discount > 0 then q.code end, p_due, p_provider, p_request) returning * into inv;
  if q.coupon_id is not null and q.discount > 0 then
    insert into public.coupon_redemptions (coupon_id, tenant_id, invoice_id, discount) values (q.coupon_id, p_tenant, inv.id, q.discount);
  end if;
  perform app.audit(p_tenant, format('Fatura de assinatura criada: %s (%s/%s)%s', inv.id, p_plan, p_period, coalesce(' cupom ' || inv.coupon_code, '')), 'invoice', inv.id::text);
  perform app.emit(p_tenant, 'invoice.created', jsonb_build_object('invoiceId', inv.id, 'amount', inv.amount, 'dueDate', inv.due_date));
  return inv;
end $$;

create or replace function public.request_subscription_invoice(p_tenant uuid, p_plan text, p_period text, p_coupon text, p_request_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare inv public.billing_invoices; v_next public.plans; v_usage record;
begin
  perform app.require(p_tenant, 'minha-assinatura', 'editar');
  select * into v_next from public.plans where id = p_plan and active;
  if v_next.id is null then perform app.fail('Plano inválido.'); end if;
  select (select count(*) from public.memberships where tenant_id = p_tenant and active) users,
         (select count(*) from public.branches where tenant_id = p_tenant and active) branches,
         (select count(*) from public.products where tenant_id = p_tenant and active) products,
         (select count(*) from public.whatsapp_instances where tenant_id = p_tenant and status <> 'archived') whatsapp into v_usage;
  if v_usage.users > v_next.users or v_usage.branches > v_next.branches or v_usage.products > v_next.products or v_usage.whatsapp > v_next.whatsapp then
    perform app.fail('O uso atual excede os limites deste plano. Revise os cadastros primeiro.');
  end if;
  inv := app.create_invoice(p_tenant, p_plan, p_period, p_coupon, 'InfinitePay', app.req_text(p_request_id, 'Chave da fatura'), current_date + 3);
  return inv.id;
end $$;

create or replace function public.cancel_subscription(p_tenant uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'minha-assinatura', 'editar');
  if (app.membership(p_tenant)).role <> 'Proprietário' then perform app.fail('Somente o proprietário cancela a assinatura.', '42501'); end if;
  update public.subscriptions set cancel_at_period_end = true, updated_at = now() where tenant_id = p_tenant;
  perform app.audit(p_tenant, 'Cancelamento ao fim do período solicitado', 'subscription', p_tenant::text);
  perform app.emit(p_tenant, 'subscription.cancel_requested', '{}');
end $$;

-- Confirmação de pagamento (service_role). Valor e invoice conferidos; idempotente por transaction_nsu.
create or replace function app.svc_confirm_payment(p_invoice uuid, p_transaction_nsu text, p_paid_amount bigint, p_amount bigint, p_capture text, p_receipt text, p_slug text, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare inv public.billing_invoices; v_end date; sub public.subscriptions; v_days int;
begin
  select * into inv from public.billing_invoices where id = p_invoice for update;
  if inv.id is null then return 'unknown_invoice'; end if;
  if exists (select 1 from public.billing_transactions where provider = inv.provider and transaction_nsu = p_transaction_nsu) then return 'duplicate'; end if;
  if p_transaction_nsu is null or btrim(p_transaction_nsu) = '' then perform app.fail('Transação obrigatória.'); end if;
  if inv.status = 'Cancelada' then return 'cancelled_invoice'; end if;
  if p_amount is null or p_amount <> inv.amount or p_paid_amount is null or p_paid_amount < inv.amount then
    perform app.audit(inv.tenant_id, format('Pagamento com valor divergente na fatura %s: esperado %s, recebido %s', inv.id, inv.amount, p_amount), 'invoice', inv.id::text);
    return 'amount_mismatch';
  end if;
  insert into public.billing_transactions (invoice_id, tenant_id, provider, transaction_nsu, amount, paid_amount, capture_method, raw)
  values (inv.id, inv.tenant_id, inv.provider, p_transaction_nsu, p_amount, p_paid_amount, p_capture, coalesce(p_raw, '{}'));
  if inv.status = 'Paga' then return 'already_paid'; end if;
  update public.billing_invoices set status = 'Paga', paid_at = now(), paid_amount = p_paid_amount, capture_method = p_capture, receipt_url = p_receipt, provider_slug = coalesce(p_slug, provider_slug) where id = inv.id;
  v_days := case inv.period when 'monthly' then 30 when 'quarterly' then 90 else 365 end;
  select * into sub from public.subscriptions where tenant_id = inv.tenant_id for update;
  v_end := greatest(coalesce(sub.current_period_end, current_date), current_date) + v_days;
  insert into public.subscriptions (tenant_id, plan_id, period, status, current_period_end, provider) values (inv.tenant_id, inv.plan_id, inv.period, 'active', v_end, inv.provider)
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, period = excluded.period, status = 'active', current_period_end = excluded.current_period_end, cancel_at_period_end = false, updated_at = now();
  update public.tenants set plan_id = inv.plan_id, status = 'Ativa', due_date = v_end where id = inv.tenant_id;
  perform app.audit(inv.tenant_id, format('Pagamento confirmado da fatura %s (%s)', inv.id, p_transaction_nsu), 'invoice', inv.id::text);
  perform app.emit(inv.tenant_id, 'invoice.paid', jsonb_build_object('invoiceId', inv.id, 'amount', inv.amount, 'paidUntil', v_end));
  return 'paid';
end $$;

-- Rotina diária (pg_cron ou Edge Function billing-cron): vencimento, suspensão após carência, faturas de renovação.
create or replace function app.svc_billing_cycle(p_grace_days int default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare s record; inv public.billing_invoices; created int := 0; overdue int := 0; suspended int := 0;
begin
  update public.billing_invoices set status = 'Vencida' where status = 'Pendente' and due_date < current_date;
  get diagnostics overdue = row_count;
  for s in select * from public.subscriptions where status in ('active', 'trialing', 'past_due') and current_period_end <= current_date + 5 and not cancel_at_period_end loop
    if not exists (select 1 from public.billing_invoices where tenant_id = s.tenant_id and request_id = 'renewal:' || s.current_period_end) then
      inv := app.create_invoice(s.tenant_id, s.plan_id, s.period, null, s.provider, 'renewal:' || s.current_period_end, s.current_period_end);
      created := created + 1;
    end if;
  end loop;
  update public.subscriptions set status = 'past_due', updated_at = now() where status in ('active', 'trialing') and current_period_end < current_date;
  update public.tenants t set status = 'Vencida' from public.subscriptions sub_due where sub_due.tenant_id = t.id and sub_due.status = 'past_due' and t.status in ('Ativa', 'Teste');
  with x as (update public.subscriptions set status = 'suspended', updated_at = now() where status = 'past_due' and current_period_end < current_date - p_grace_days returning tenant_id)
  update public.tenants t set status = 'Suspensa' from x where x.tenant_id = t.id;
  get diagnostics suspended = row_count;
  with x as (update public.subscriptions set status = 'cancelled', updated_at = now() where cancel_at_period_end and current_period_end < current_date and status <> 'cancelled' returning tenant_id)
  update public.tenants t set status = 'Cancelada' from x where x.tenant_id = t.id;
  return jsonb_build_object('created', created, 'overdue', overdue, 'suspended', suspended);
end $$;

-- ---------------------------------------------------------------- Super Admin
create or replace function public.admin_save_tenant(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := app.uuid_or_null(p ->> 'id');
begin
  perform app.require_platform_admin();
  if v_id is null then perform app.fail('Empresas são criadas pelo onboarding do cliente ou por convite.'); end if;
  if not exists (select 1 from public.plans where id = p ->> 'planId') then perform app.fail('Plano inválido.'); end if;
  update public.tenants set name = left(app.req_text(p ->> 'name', 'Nome'), 120), legal_name = coalesce(p ->> 'legalName', legal_name), owner_name = coalesce(p ->> 'owner', owner_name),
    email = lower(app.req_text(p ->> 'email', 'Email')), profile = coalesce(p ->> 'profile', profile), plan_id = p ->> 'planId', status = coalesce(p ->> 'status', status),
    due_date = coalesce(nullif(p ->> 'dueDate', '')::date, due_date), document = regexp_replace(coalesce(p ->> 'document', document), '\D', '', 'g'), notes = coalesce(p ->> 'notes', notes)
  where id = v_id;
  if not found then perform app.fail('Empresa não encontrada.'); end if;
  perform app.audit(null, 'Super Admin alterou empresa ' || v_id, 'tenant', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_save_plan(p jsonb) returns text
language plpgsql security definer set search_path = '' as $$
declare v_id text := coalesce(nullif(p ->> 'id', ''), app.slugify(p ->> 'name'));
begin
  perform app.require_platform_admin();
  insert into public.plans (id, name, monthly, quarterly, annual, users, branches, products, whatsapp, ai_messages, trial_days, features, modules, active)
  values (v_id, app.req_text(p ->> 'name', 'Nome do plano'), app.int_val(p -> 'monthly', 'Mensal'), app.int_val(p -> 'quarterly', 'Trimestral'), app.int_val(p -> 'annual', 'Anual'),
          app.int_val(p -> 'users', 'Usuários'), app.int_val(p -> 'branches', 'Filiais'), app.int_val(p -> 'products', 'Produtos'), app.int_val(p -> 'whatsapp', 'WhatsApp'),
          app.int_val(coalesce(p -> 'aiMessages', '0'), 'IA'), app.int_val(coalesce(p -> 'trialDays', '14'), 'Dias de teste'),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'features') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'modules') x), '{*}'), coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set name = excluded.name, monthly = excluded.monthly, quarterly = excluded.quarterly, annual = excluded.annual, users = excluded.users,
    branches = excluded.branches, products = excluded.products, whatsapp = excluded.whatsapp, ai_messages = excluded.ai_messages, trial_days = excluded.trial_days,
    features = excluded.features, modules = case when p ? 'modules' then excluded.modules else public.plans.modules end, active = excluded.active;
  perform app.audit(null, 'Plano salvo: ' || v_id, 'plan', v_id, p);
  return v_id;
end $$;

create or replace function public.admin_delete_plan(p_id text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if exists (select 1 from public.tenants where plan_id = p_id) or exists (select 1 from public.billing_invoices where plan_id = p_id) then
    update public.plans set active = false where id = p_id; -- preserva histórico
  else
    delete from public.plans where id = p_id;
  end if;
  perform app.audit(null, 'Plano excluído/desativado: ' || p_id, 'plan', p_id);
end $$;

create or replace function public.admin_save_coupon(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); v_code text := upper(regexp_replace(app.req_text(p ->> 'code', 'Código do cupom'), '\s+', '', 'g'));
begin
  perform app.require_platform_admin();
  if exists (select 1 from public.coupons where code = v_code and id <> v_id) then perform app.fail('Código de cupom já cadastrado.'); end if;
  insert into public.coupons (id, code, description, kind, value, starts_at, ends_at, max_uses, per_tenant, plan_ids, periods, active)
  values (v_id, v_code, app.req_text(p ->> 'description', 'Descrição do cupom'), p ->> 'kind', app.int_val(p -> 'value', 'Valor do cupom', 1)::int,
          (p ->> 'startsAt')::date, (p ->> 'endsAt')::date, app.int_val(coalesce(p -> 'maxUses', '0'), 'Limite de usos')::int, app.int_val(coalesce(p -> 'perTenant', '0'), 'Limite por empresa')::int,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'planIds') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'periods') x), '{}'), coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set code = excluded.code, description = excluded.description, kind = excluded.kind, value = excluded.value, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, max_uses = excluded.max_uses, per_tenant = excluded.per_tenant, plan_ids = excluded.plan_ids, periods = excluded.periods, active = excluded.active;
  perform app.audit(null, 'Cupom salvo: ' || v_code, 'coupon', v_id::text);
  return v_id;
end $$;

create or replace function public.admin_delete_coupon(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  if exists (select 1 from public.coupon_redemptions where coupon_id = p_id) then perform app.fail('Cupom possui resgates. Desative-o.'); end if;
  delete from public.coupons where id = p_id;
end $$;

create or replace function public.admin_create_invoice(p_tenant uuid, p_plan text, p_period text, p_coupon text, p_request_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return (app.create_invoice(p_tenant, p_plan, p_period, p_coupon, 'InfinitePay', app.req_text(p_request_id, 'Chave da fatura'), current_date + 7)).id;
end $$;

-- Super Admin só cancela fatura. Marcar como paga manualmente exige comprovante e fica auditado.
create or replace function public.admin_set_invoice_status(p_invoice uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.billing_invoices;
begin
  perform app.require_platform_admin();
  select * into inv from public.billing_invoices where id = p_invoice for update;
  if inv.id is null then perform app.fail('Fatura não encontrada.'); end if;
  if p_status = 'Cancelada' then
    if inv.status = 'Paga' then perform app.fail('Fatura paga não pode ser cancelada; registre estorno no provedor.'); end if;
    update public.billing_invoices set status = 'Cancelada' where id = inv.id;
    delete from public.coupon_redemptions where invoice_id = inv.id;
  elsif p_status = 'Paga' then
    perform app.svc_confirm_payment(inv.id, 'manual:' || inv.id, inv.amount, inv.amount, 'manual', null, null, jsonb_build_object('note', app.req_text(p_note, 'Comprovante / justificativa'), 'by', auth.uid()));
  else perform app.fail('Status inválido.'); end if;
  perform app.audit(inv.tenant_id, format('Super Admin: fatura %s → %s (%s)', inv.id, p_status, coalesce(p_note, '')), 'invoice', inv.id::text);
end $$;

create or replace function public.admin_save_record(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); v_kind text := app.req_text(p ->> 'kind', 'Tipo');
begin
  perform app.require_platform_admin();
  if v_kind not like 'admin-%' then perform app.fail('Tipo inválido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('record-id:' || v_id::text, 0));
  if exists(select 1 from public.records where id = v_id and (tenant_id is not null or kind <> v_kind)) then
    perform app.fail('Registro fora do escopo administrativo.', '42501');
  end if;
  insert into public.records (id, tenant_id, kind, title, status, amount, fields, history)
  values (v_id, null, v_kind, left(app.req_text(p ->> 'title', 'Título'), 200), coalesce(p ->> 'status', ''), app.int_val(coalesce(p -> 'amount', '0'), 'Valor'), coalesce(p -> 'fields', '{}'), app.history('Criado por ' || app.user_name()))
  on conflict (id) do update set title = excluded.title, status = excluded.status, amount = excluded.amount, fields = excluded.fields,
    history = public.records.history || app.history('Atualizado por ' || app.user_name());
  perform app.audit(null, v_kind || ': salvo ' || (p ->> 'title'), 'record', v_id::text);
  return v_id;
end $$;

create or replace function public.admin_delete_record(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  delete from public.records where id = p_id and tenant_id is null;
end $$;

-- Comunicado para empresas → notificações + push.
create or replace function public.admin_broadcast(p_title text, p_body text, p_audience text default 'all') returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  perform app.require_platform_admin();
  insert into public.notifications (tenant_id, type, title, body)
  select id, 'platform.announcement', left(app.req_text(p_title, 'Título'), 160), left(coalesce(p_body, ''), 2000) from public.tenants
  where p_audience = 'all' or (p_audience = 'trial' and status = 'Teste') or (p_audience = 'overdue' and status in ('Vencida', 'Suspensa')) or (p_audience = 'active' and status = 'Ativa');
  get diagnostics n = row_count;
  perform app.audit(null, format('Comunicado "%s" para %s empresas', p_title, n), 'notification', '');
  return n;
end $$;

-- ---------------------------------------------------------------- notificações
create or replace function public.mark_notifications_read(p_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.notifications set read_at = now() where id = any (p_ids) and user_id = auth.uid() and read_at is null;
  insert into public.notification_reads (notification_id, user_id)
  select n.id, auth.uid() from public.notifications n where n.id = any (p_ids) and n.user_id is null
    and ((n.tenant_id is not null and app.is_member(n.tenant_id)) or (n.tenant_id is null and app.is_platform_admin()))
  on conflict do nothing;
end $$;

create or replace function public.save_notification_preferences(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not app.is_member(p_tenant) then perform app.fail('Acesso negado a esta empresa.', '42501'); end if;
  insert into public.notification_preferences (user_id, tenant_id, in_app, push, email, muted_types)
  values (auth.uid(), p_tenant, coalesce((p ->> 'inApp')::boolean, true), coalesce((p ->> 'push')::boolean, true), coalesce((p ->> 'email')::boolean, true),
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'mutedTypes') x), '{}'))
  on conflict (user_id, tenant_id) do update set in_app = excluded.in_app, push = excluded.push, email = excluded.email, muted_types = excluded.muted_types, updated_at = now();
end $$;

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text default '') returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then perform app.fail('Sessão expirada.', '28000'); end if;
  if p_endpoint !~ '^https://' or length(p_endpoint) > 2000 or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then perform app.fail('Assinatura push inválida.'); end if;
  if (select count(*) from public.push_subscriptions where user_id = auth.uid() and expired_at is null) >= 10 then
    delete from public.push_subscriptions where id = (select id from public.push_subscriptions where user_id = auth.uid() order by coalesce(last_success_at, created_at) limit 1);
  end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent) values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(coalesce(p_user_agent, ''), 300))
  on conflict (endpoint) do update set user_id = auth.uid(), p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, expired_at = null, failures = 0;
end $$;

create or replace function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$ delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid() $$;

-- ---------------------------------------------------------------- outbox → notificações (worker; service_role)
-- Converte eventos em notificações internas. Automações de WhatsApp/e-mail são despachadas pela Edge Function worker.
create or replace function app.svc_claim_events(p_limit int default 50) returns setof public.outbox_events
language sql security definer set search_path = '' as $$
  update public.outbox_events set status = 'processing', attempts = attempts + 1
  where id in (select id from public.outbox_events where status = 'pending' and available_at <= now() order by id limit p_limit for update skip locked)
  returning *
$$;

create or replace function app.svc_finish_event(p_id bigint, p_error text default null) returns void
language sql security definer set search_path = '' as $$
  update public.outbox_events set
    status = case when p_error is null then 'done' when attempts >= 5 then 'dead' else 'pending' end,
    last_error = p_error, processed_at = case when p_error is null then now() end,
    available_at = case when p_error is null then available_at else now() + (interval '1 minute' * power(2, attempts)) end
  where id = p_id
$$;

create or replace function app.svc_notify(p_tenant uuid, p_type text, p_title text, p_body text, p_link text default '', p_data jsonb default '{}', p_user uuid default null)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.notifications (tenant_id, user_id, type, title, body, link, data) values (p_tenant, p_user, p_type, p_title, p_body, p_link, p_data) returning id
$$;

-- ---------------------------------------------------------------- WhatsApp (estado; chamadas à Evolution só na Edge Function)
create or replace function app.svc_whatsapp_inbound(p_instance text, p_external_id text, p_remote text, p_body text, p_from_me boolean, p_status text default 'received')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare inst public.whatsapp_instances; v_id uuid;
begin
  select * into inst from public.whatsapp_instances where instance_name = p_instance;
  if inst.id is null then return jsonb_build_object('status', 'unknown_instance'); end if;
  insert into public.whatsapp_messages (tenant_id, instance_id, external_id, remote_jid, direction, body, status)
  values (inst.tenant_id, inst.id, p_external_id, p_remote, case when p_from_me then 'out' else 'in' end, left(coalesce(p_body, ''), 8000), p_status)
  on conflict (instance_id, external_id) do nothing returning id into v_id;
  if v_id is null then return jsonb_build_object('status', 'duplicate'); end if;
  if not p_from_me then
    perform app.emit(inst.tenant_id, 'whatsapp.inbound', jsonb_build_object('messageId', v_id, 'instanceId', inst.id, 'remote', p_remote, 'bot', inst.bot_enabled));
  end if;
  return jsonb_build_object('status', 'stored', 'id', v_id, 'tenantId', inst.tenant_id, 'bot', inst.bot_enabled and not p_from_me);
end $$;

create or replace function public.set_whatsapp_bot(p_tenant uuid, p_instance uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'whatsapp', 'configurar');
  update public.whatsapp_instances set bot_enabled = p_enabled, updated_at = now() where tenant_id = p_tenant and id = p_instance;
end $$;

-- ---------------------------------------------------------------- IA (configuração e limites)
create or replace function public.save_ai_settings(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_plan public.plans := app.plan_of(p_tenant); v_limit int := app.int_val(coalesce(p -> 'dailyLimit', '50'), 'Limite diário')::int;
begin
  perform app.require(p_tenant, 'assistente', 'configurar');
  insert into public.ai_settings (tenant_id, enabled, whatsapp_bot, persona, daily_limit)
  values (p_tenant, coalesce((p ->> 'enabled')::boolean, false), coalesce((p ->> 'whatsappBot')::boolean, false), left(coalesce(p ->> 'persona', ''), 2000), least(v_limit, v_plan.ai_messages))
  on conflict (tenant_id) do update set enabled = excluded.enabled, whatsapp_bot = excluded.whatsapp_bot, persona = excluded.persona, daily_limit = excluded.daily_limit, updated_at = now();
end $$;

-- Reserva atomicamente uma mensagem. Retorna ID para atualizar tokens; null quando acabou.
create or replace function app.svc_ai_take_quota(p_tenant uuid, p_channel text) returns bigint
language plpgsql security definer set search_path = '' as $$
declare s public.ai_settings; v_plan public.plans := app.plan_of(p_tenant); used int; reservation bigint;
begin
  select * into s from public.ai_settings where tenant_id = p_tenant for update;
  if s.tenant_id is null or not s.enabled or (p_channel = 'whatsapp' and not s.whatsapp_bot) then return null; end if;
  if p_channel not in ('app', 'whatsapp') then perform app.fail('Canal inválido.'); end if;
  if not exists (select 1 from public.tenants where id = p_tenant and status in ('Teste', 'Ativa') and due_date >= current_date) then return null; end if;
  select count(*) into used from public.ai_usage where tenant_id = p_tenant and created_at >= date_trunc('day', now());
  if used >= least(s.daily_limit, v_plan.ai_messages) then return null; end if;
  insert into public.ai_usage (tenant_id, channel) values (p_tenant, p_channel) returning id into reservation;
  return reservation;
end $$;

create or replace function public.ai_usage_summary(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return coalesce((select jsonb_agg(row_to_json(x)) from (
    select t.name tenant, u.channel, count(*) messages, sum(u.input_tokens) input_tokens, sum(u.output_tokens) output_tokens, count(*) filter (where u.blocked is not null) blocked
    from public.ai_usage u join public.tenants t on t.id = u.tenant_id where u.created_at > now() - make_interval(days => p_days) group by 1, 2 order by 3 desc) x), '[]');
end $$;

-- ---------------------------------------------------------------- grants das RPCs
do $$
declare f record;
begin
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' loop
    execute format('revoke all on function %s from public, anon', f.sig);
    execute format('grant execute on function %s to authenticated, service_role', f.sig);
  end loop;
  for f in select p.oid::regprocedure sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'app' and p.proname like 'svc\_%' loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);
    execute format('grant execute on function %s to service_role', f.sig);
  end loop;
end $$;
grant execute on function public.submit_lead(jsonb) to anon;
grant usage on schema app to service_role;
grant select on all tables in schema public to service_role;
grant insert, update, delete on all tables in schema public to service_role;
