-- Super Admin 4.0 — perfis administrativos com permissão por ação, validada no servidor.
-- Leitura geral da plataforma: qualquer administrador. Dados financeiros: só perfis com billing.read.

alter table public.platform_admins add column role text not null default 'owner'
  check (role in ('owner', 'admin', 'finance', 'sales', 'support', 'ops', 'auditor'));
alter table public.tenants add column phone text not null default '', add column whatsapp text not null default '',
  add column address text not null default '', add column website text not null default '';

create or replace function app.admin_role() returns text
language sql stable security definer set search_path = '' as $$ select role from public.platform_admins where user_id = auth.uid() $$;

-- Matriz de permissões (documentada em docs/SUPER_ADMIN_PERMISSIONS.md).
create or replace function app.admin_perm(p_role text, p_perm text) returns boolean
language sql immutable set search_path = '' as $$
  select case p_role
    when 'owner' then true
    when 'admin' then p_perm <> 'admins.manage'
    when 'finance' then p_perm in ('billing.read', 'billing.manage', 'coupons.manage', 'subscriptions.manage', 'audit.read')
    when 'sales' then p_perm in ('leads.manage')
    when 'support' then p_perm in ('support.manage', 'tenants.edit')
    when 'ops' then p_perm in ('integrations.manage', 'jobs.retry', 'broadcast', 'audit.read')
    when 'auditor' then p_perm in ('audit.read', 'billing.read')
    else false end
$$;

create or replace function app.admin_can(p_perm text) returns boolean
language sql stable security definer set search_path = '' as $$ select app.is_platform_admin() and app.admin_perm(app.admin_role(), p_perm) $$;

create or replace function app.require_admin(p_perm text) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  if not app.admin_perm(app.admin_role(), p_perm) then perform app.fail('Seu perfil administrativo não permite esta ação.', '42501'); end if;
end $$;

-- Sem permissão específica: ações amplas (planos, empresas) ficam com proprietário e administrador.
create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  if app.admin_role() not in ('owner', 'admin') then perform app.fail('Seu perfil administrativo não permite esta ação.', '42501'); end if;
end $$;

grant execute on function app.admin_can(text) to authenticated;

-- Dados financeiros da plataforma: membros da empresa continuam lendo os próprios; administradores só com billing.read.
drop policy invoices_read on public.billing_invoices;
create policy invoices_read on public.billing_invoices for select to authenticated using (app.is_member(tenant_id) or app.admin_can('billing.read'));
drop policy billing_transactions_read on public.billing_transactions;
create policy billing_transactions_read on public.billing_transactions for select to authenticated using (app.is_member(tenant_id) or app.admin_can('billing.read'));
drop policy coupons_read on public.coupons;
create policy coupons_read on public.coupons for select to authenticated using (app.admin_can('billing.read') or app.admin_can('coupons.manage'));
drop policy redemptions_read on public.coupon_redemptions;
create policy redemptions_read on public.coupon_redemptions for select to authenticated using (app.is_member(tenant_id) or app.admin_can('billing.read'));
drop policy webhook_events_read on public.webhook_events;
create policy webhook_events_read on public.webhook_events for select to authenticated using (app.admin_can('billing.read') or app.admin_can('integrations.manage'));
drop policy audit_read on public.audit_logs;
create policy audit_read on public.audit_logs for select to authenticated using (
  app.admin_can('audit.read') or (tenant_id is not null and (app.membership(tenant_id)).role in ('Proprietário', 'Administrador')));
drop policy email_messages_read on public.email_messages;
create policy email_messages_read on public.email_messages for select to authenticated using (app.admin_can('integrations.manage'));
drop policy outbox_read on public.outbox_events;
create policy outbox_read on public.outbox_events for select to authenticated using (app.admin_can('integrations.manage') or app.admin_can('jobs.retry'));

-- ---------------------------------------------------------------- RPCs existentes com permissão por ação
create or replace function public.admin_save_tenant(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := app.uuid_or_null(p ->> 'id'); before public.tenants;
begin
  perform app.require_admin('tenants.edit');
  select * into before from public.tenants where id = v_id for update;
  if before.id is null then perform app.fail('Empresa não encontrada.'); end if;
  -- Só dados cadastrais. Plano, situação e vencimento mudam por ações próprias e auditadas.
  update public.tenants set name = left(app.req_text(p ->> 'name', 'Nome'), 120), legal_name = left(coalesce(p ->> 'legalName', legal_name), 160),
    owner_name = left(coalesce(p ->> 'owner', owner_name), 120), email = lower(app.req_text(p ->> 'email', 'E-mail')),
    document = regexp_replace(coalesce(p ->> 'document', document), '\D', '', 'g'), profile = left(coalesce(p ->> 'profile', profile), 60),
    phone = left(coalesce(p ->> 'phone', phone), 30), whatsapp = left(coalesce(p ->> 'whatsapp', whatsapp), 30),
    address = left(coalesce(p ->> 'address', address), 300), website = left(coalesce(p ->> 'website', website), 200)
  where id = v_id;
  perform app.audit(v_id, 'Super Admin alterou dados cadastrais', 'tenant', v_id::text,
    jsonb_build_object('before', jsonb_build_object('name', before.name, 'email', before.email, 'document', before.document), 'after', p - 'id'));
  return v_id;
end $$;

create or replace function public.admin_save_coupon(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); v_code text := upper(regexp_replace(app.req_text(p ->> 'code', 'Código do cupom'), '\s+', '', 'g'));
begin
  perform app.require_admin('coupons.manage');
  if exists (select 1 from public.coupons where code = v_code and id <> v_id) then perform app.fail('Código de cupom já cadastrado.'); end if;
  if (p ->> 'endsAt')::date < (p ->> 'startsAt')::date then perform app.fail('A data final deve ser posterior à inicial.'); end if;
  if p ->> 'kind' = 'percent' and app.int_val(p -> 'value', 'Valor do cupom', 1) > 10000 then perform app.fail('Percentual máximo é 100%.'); end if;
  insert into public.coupons (id, code, description, kind, value, starts_at, ends_at, max_uses, per_tenant, plan_ids, periods, active)
  values (v_id, v_code, app.req_text(p ->> 'description', 'Descrição do cupom'), p ->> 'kind', app.int_val(p -> 'value', 'Valor do cupom', 1)::int,
          (p ->> 'startsAt')::date, (p ->> 'endsAt')::date, app.int_val(coalesce(p -> 'maxUses', '0'), 'Limite de usos')::int, app.int_val(coalesce(p -> 'perTenant', '0'), 'Limite por empresa')::int,
          coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'planIds') x), '{}'), coalesce((select array_agg(x) from jsonb_array_elements_text(p -> 'periods') x), '{}'), coalesce((p ->> 'active')::boolean, true))
  on conflict (id) do update set code = excluded.code, description = excluded.description, kind = excluded.kind, value = excluded.value, starts_at = excluded.starts_at,
    ends_at = excluded.ends_at, max_uses = excluded.max_uses, per_tenant = excluded.per_tenant, plan_ids = excluded.plan_ids, periods = excluded.periods, active = excluded.active;
  perform app.audit(null, 'Cupom salvo: ' || v_code, 'coupon', v_id::text, p);
  return v_id;
end $$;

create or replace function public.admin_delete_coupon(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin('coupons.manage');
  if exists (select 1 from public.coupon_redemptions where coupon_id = p_id) then perform app.fail('Cupom possui resgates. Desative-o.'); end if;
  delete from public.coupons where id = p_id;
  perform app.audit(null, 'Cupom excluído', 'coupon', p_id::text);
end $$;

create or replace function public.admin_create_invoice(p_tenant uuid, p_plan text, p_period text, p_coupon text, p_request_id text) returns uuid
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_admin('billing.manage');
  return (app.create_invoice(p_tenant, p_plan, p_period, p_coupon, 'InfinitePay', app.req_text(p_request_id, 'Chave da fatura'), current_date + 7)).id;
end $$;

-- Baixa manual: transação marcada como 'manual:<fatura>' e capture 'manual' (nunca se passa por InfinitePay); exige justificativa.
create or replace function public.admin_set_invoice_status(p_invoice uuid, p_status text, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare inv public.billing_invoices;
begin
  perform app.require_admin('billing.manage');
  select * into inv from public.billing_invoices where id = p_invoice for update;
  if inv.id is null then perform app.fail('Fatura não encontrada.'); end if;
  if p_status = 'Cancelada' then
    if inv.status = 'Paga' then perform app.fail('Fatura paga não pode ser cancelada; registre estorno no provedor.'); end if;
    update public.billing_invoices set status = 'Cancelada' where id = inv.id;
    delete from public.coupon_redemptions where invoice_id = inv.id;
  elsif p_status = 'Paga' then
    perform app.svc_confirm_payment(inv.id, 'manual:' || inv.id, inv.amount, inv.amount, 'manual', null, null, jsonb_build_object('note', app.req_text(p_note, 'Comprovante / justificativa'), 'by', auth.uid()));
  else perform app.fail('Status inválido.'); end if;
  perform app.audit(inv.tenant_id, format('Super Admin: fatura %s → %s', inv.id, p_status), 'invoice', inv.id::text, jsonb_build_object('before', inv.status, 'after', p_status, 'reason', p_note));
end $$;

-- Registros da plataforma: permissão conforme o tipo.
create or replace function app.admin_kind_perm(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'admin-lead' then 'leads.manage' when 'admin-ticket' then 'support.manage' when 'admin-note' then 'tenants.edit'
    when 'admin-broadcast' then 'broadcast' else 'platform' end
$$;

create or replace function public.admin_save_record(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); v_kind text := app.req_text(p ->> 'kind', 'Tipo'); v_perm text;
begin
  if v_kind not like 'admin-%' then perform app.fail('Tipo inválido.'); end if;
  v_perm := app.admin_kind_perm(v_kind);
  if v_perm = 'platform' then perform app.require_platform_admin(); else perform app.require_admin(v_perm); end if;
  perform pg_advisory_xact_lock(hashtextextended('record-id:' || v_id::text, 0));
  if exists(select 1 from public.records where id = v_id and (tenant_id is not null or kind <> v_kind)) then
    perform app.fail('Registro fora do escopo administrativo.', '42501');
  end if;
  insert into public.records (id, tenant_id, kind, title, status, amount, fields, history)
  values (v_id, null, v_kind, left(app.req_text(p ->> 'title', 'Título'), 200), coalesce(p ->> 'status', ''), app.int_val(coalesce(p -> 'amount', '0'), 'Valor'), coalesce(p -> 'fields', '{}'), app.history('Criado por ' || app.user_name()))
  on conflict (id) do update set title = excluded.title, status = excluded.status, amount = excluded.amount, fields = excluded.fields,
    history = public.records.history || app.history(case when public.records.status is distinct from excluded.status
      then 'Situação: ' || coalesce(public.records.status, '') || ' → ' || excluded.status || ' (' || app.user_name() || ')' else 'Atualizado por ' || app.user_name() end);
  perform app.audit(nullif(p -> 'fields' ->> 'tenantId', '')::uuid, v_kind || ': salvo ' || (p ->> 'title'), 'record', v_id::text);
  return v_id;
end $$;

create or replace function public.admin_delete_record(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records;
begin
  select * into r from public.records where id = p_id and tenant_id is null;
  if r.id is null then return; end if;
  if app.admin_kind_perm(r.kind) = 'platform' then perform app.require_platform_admin(); else perform app.require_admin(app.admin_kind_perm(r.kind)); end if;
  delete from public.records where id = p_id;
  perform app.audit(null, r.kind || ': excluído ' || r.title, 'record', p_id::text);
end $$;

-- Comentário em chamado/lead. Resposta não interna em chamado vira notificação para proprietário/administrador da empresa.
create or replace function public.admin_record_comment(p_id uuid, p_text text, p_internal boolean default true) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records; v_tenant uuid;
begin
  select * into r from public.records where id = p_id and tenant_id is null for update;
  if r.id is null then perform app.fail('Registro não encontrado.'); end if;
  perform app.require_admin(app.admin_kind_perm(r.kind));
  update public.records set history = history || jsonb_build_array(jsonb_build_object('date', now(), 'text', left(app.req_text(p_text, 'Comentário'), 4000),
    'author', app.user_name(), 'internal', p_internal)) where id = p_id;
  v_tenant := nullif(r.fields ->> 'tenantId', '')::uuid;
  if not p_internal and r.kind = 'admin-ticket' and v_tenant is not null then
    insert into public.notifications (tenant_id, type, title, body, module)
    values (v_tenant, 'support.reply', 'Resposta do suporte PISTEC', left('Chamado: ' || r.title, 200), 'configuracoes');
  end if;
end $$;

create or replace function public.ai_usage_summary(p_days int default 30) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  return coalesce((select jsonb_agg(row_to_json(x)) from (
    select t.name tenant, u.channel, count(*) messages, sum(u.input_tokens) input_tokens, sum(u.output_tokens) output_tokens, count(*) filter (where u.blocked is not null) blocked
    from public.ai_usage u join public.tenants t on t.id = u.tenant_id where u.created_at > now() - make_interval(days => p_days) group by 1, 2 order by 3 desc) x), '[]');
end $$;

revoke all on function public.admin_record_comment(uuid,text,boolean) from public, anon;
grant execute on function public.admin_record_comment(uuid,text,boolean) to authenticated;
