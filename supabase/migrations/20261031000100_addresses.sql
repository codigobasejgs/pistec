-- Endereço estruturado (CEP, logradouro, número, complemento, bairro, cidade, UF) para empresas, filiais e clientes.
-- A coluna texto `address` continua sendo a usada em documentos/contratos; `address_data` guarda os campos confirmados pela pessoa.
-- Aditivo: nenhuma coluna existente muda. Contratos assinados não são tocados (dados congelados em tenant_contracts.parties).

alter table public.tenants add column if not exists address_data jsonb not null default '{}';
alter table public.branches add column if not exists address_data jsonb not null default '{}';
alter table public.customers add column if not exists address_data jsonb not null default '{}';

-- Valida e normaliza. Vazio = '{}' quando permitido. Devolve null se p não for objeto.
create or replace function app.address_norm(p jsonb, p_required boolean default false) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare z text; a jsonb;
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    if p_required then perform app.fail('Endereço obrigatório.'); end if;
    return '{}';
  end if;
  z := regexp_replace(coalesce(p ->> 'zip', ''), '\D', '', 'g');
  a := jsonb_build_object('zip', z, 'street', left(btrim(coalesce(p ->> 'street', '')), 160), 'number', left(btrim(coalesce(p ->> 'number', '')), 20),
    'complement', left(btrim(coalesce(p ->> 'complement', '')), 80), 'district', left(btrim(coalesce(p ->> 'district', '')), 160),
    'city', left(btrim(coalesce(p ->> 'city', '')), 160), 'state', upper(btrim(coalesce(p ->> 'state', ''))));
  if not p_required and (select bool_and(value = '""') from jsonb_each(a)) then return '{}'; end if;
  if z !~ '^\d{8}$' then perform app.fail('CEP deve ter 8 números.'); end if;
  if a ->> 'state' not in ('AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO') then perform app.fail('UF inválida.'); end if;
  if a ->> 'street' = '' or a ->> 'number' = '' or a ->> 'district' = '' or a ->> 'city' = '' then perform app.fail('Preencha logradouro, número, bairro e cidade.'); end if;
  return a;
end $$;

create or replace function app.address_text(a jsonb) returns text
language sql immutable set search_path = '' as $$
  select case when coalesce(a ->> 'zip', '') = '' then '' else format('%s, %s%s, %s, %s/%s, CEP %s', a ->> 'street', a ->> 'number',
    coalesce(', ' || nullif(a ->> 'complement', ''), ''), a ->> 'district', a ->> 'city', a ->> 'state', regexp_replace(a ->> 'zip', '^(\d{5})(\d{3})$', '\1-\2')) end
$$;
revoke all on function app.address_norm(jsonb, boolean), app.address_text(jsonb) from public, anon, authenticated;

-- Endereço da empresa (lojista: proprietário/administrador via permissão de configurações).
create or replace function public.update_tenant_address(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare a jsonb := app.address_norm(p, true);
begin
  perform app.require(p_tenant, 'configuracoes', 'editar');
  update public.tenants set address_data = a, address = left(app.address_text(a), 300) where id = p_tenant;
  perform app.audit(p_tenant, 'Endereço da empresa atualizado', 'tenant', p_tenant::text);
end $$;
grant execute on function public.update_tenant_address(uuid, jsonb) to authenticated;

-- Onboarding real: endereço opcional na criação (mesma validação). Mantém o restante idêntico.
create or replace function public.onboard_tenant(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text; v_slug text; v_plan public.plans; v_tenant public.tenants; v_branch uuid; v_email text; v_addr jsonb;
begin
  if v_uid is null then perform app.fail('Entre na sua conta para criar a empresa.', '28000'); end if;
  if (select email_confirmed_at from auth.users where id = v_uid) is null then perform app.fail('Confirme seu e-mail antes de criar a empresa.', '42501'); end if;
  perform pg_advisory_xact_lock(hashtextextended('onboard:' || v_uid::text, 0));
  v_name := app.req_text(p ->> 'name', 'Empresa');
  v_slug := app.slugify(coalesce(nullif(p ->> 'slug', ''), v_name));
  select * into v_tenant from public.tenants where slug = v_slug and created_by = v_uid;
  if found then return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', (select id from public.branches where tenant_id = v_tenant.id order by created_at limit 1)); end if;
  if v_slug = '' or length(v_slug) > 60 or exists (select 1 from public.tenants where slug = v_slug) then perform app.fail('Identificador da empresa indisponível.'); end if;
  if (select count(*) from public.tenants where created_by = v_uid) >= 3 then perform app.fail('Limite de empresas por conta atingido. Fale com o suporte.'); end if;
  select * into v_plan from public.plans where id = coalesce(nullif(p ->> 'planId', ''), 'essencial') and active;
  if v_plan.id is null then perform app.fail('Plano inválido.'); end if;
  v_addr := app.address_norm(p -> 'address', false);
  v_email := coalesce(nullif(btrim(p ->> 'email'), ''), (select email from auth.users where id = v_uid));
  insert into public.tenants (slug, name, legal_name, document, owner_name, email, profile, plan_id, status, due_date, branding, notes, created_by, address, address_data)
  values (v_slug, v_name, coalesce(nullif(btrim(p ->> 'legalName'), ''), v_name), regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'),
          app.req_text(coalesce(p ->> 'owner', app.user_name()), 'Responsável'), lower(v_email), coalesce(nullif(p ->> 'profile', ''), 'Autopeças'),
          v_plan.id, 'Teste', current_date + v_plan.trial_days, coalesce(p -> 'branding', '{}'), '', v_uid, left(app.address_text(v_addr), 300), v_addr)
  returning * into v_tenant;
  insert into public.branches (tenant_id, name, address, address_data) values (v_tenant.id, 'Matriz', v_tenant.address, v_addr) returning id into v_branch;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'Proprietário');
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_end) values (v_tenant.id, v_plan.id, 'trialing', v_tenant.due_date);
  insert into public.ai_settings (tenant_id) values (v_tenant.id);
  perform app.audit(v_tenant.id, 'Empresa criada: ' || v_name, 'tenant', v_tenant.id::text);
  perform app.emit(v_tenant.id, 'tenant.created', jsonb_build_object('name', v_name, 'email', v_tenant.email, 'plan', v_plan.name));
  return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', v_branch);
end $$;

-- Cliente: address_data opcional; se vier, valida e gera o texto. Sem address_data mantém o texto livre de antes.
create or replace function public.save_customer(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); existing public.customers; v_doc text := regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g');
  v_addr jsonb := app.address_norm(p -> 'addressData', false); v_text text;
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-id:' || v_id::text, 0));
  select * into existing from public.customers where id = v_id for update;
  if existing.id is not null and existing.tenant_id <> p_tenant then perform app.fail('Cliente pertence a outra empresa.', '42501'); end if;
  perform app.require(p_tenant, 'clientes', case when existing.id is null then 'cadastrar' else 'editar' end);
  if v_doc <> '' and exists (select 1 from public.customers where tenant_id = p_tenant and id <> v_id and regexp_replace(document, '\D', '', 'g') = v_doc) then
    perform app.fail('Documento já cadastrado.');
  end if;
  v_text := case when v_addr = '{}' then left(coalesce(p ->> 'address', ''), 300) else left(app.address_text(v_addr), 300) end;
  insert into public.customers (id, tenant_id, name, document, email, phone, address, address_data, consent, notes)
  values (v_id, p_tenant, left(app.req_text(p ->> 'name', 'Nome'), 200), left(coalesce(p ->> 'document', ''), 30), left(btrim(coalesce(p ->> 'email', '')), 160),
          left(app.req_text(p ->> 'phone', 'Telefone'), 40), v_text, v_addr, coalesce((p ->> 'consent')::boolean, false), left(coalesce(p ->> 'notes', ''), 2000))
  on conflict (id) do update set name = excluded.name, document = excluded.document, email = excluded.email, phone = excluded.phone,
    address = excluded.address, address_data = excluded.address_data, consent = excluded.consent, notes = excluded.notes;
  perform app.audit(p_tenant, format('%s de cliente %s; consentimento WhatsApp: %s', case when existing.id is null then 'Cadastro' else 'Edição' end, p ->> 'name',
                    case when coalesce((p ->> 'consent')::boolean, false) then 'sim' else 'não' end), 'customer', v_id::text);
  return v_id;
end $$;

-- Super Admin: além dos dados cadastrais, aceita endereço estruturado (addressData) com a mesma validação.
create or replace function public.admin_save_tenant(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := app.uuid_or_null(p ->> 'id'); before public.tenants; v_addr jsonb := app.address_norm(p -> 'addressData', false);
begin
  perform app.require_admin('tenants.edit');
  select * into before from public.tenants where id = v_id for update;
  if before.id is null then perform app.fail('Empresa não encontrada.'); end if;
  update public.tenants set name = left(app.req_text(p ->> 'name', 'Nome'), 120), legal_name = left(coalesce(p ->> 'legalName', legal_name), 160),
    owner_name = left(coalesce(p ->> 'owner', owner_name), 120), email = lower(app.req_text(p ->> 'email', 'E-mail')),
    document = regexp_replace(coalesce(p ->> 'document', document), '\D', '', 'g'), profile = left(coalesce(p ->> 'profile', profile), 60),
    phone = left(coalesce(p ->> 'phone', phone), 30), whatsapp = left(coalesce(p ->> 'whatsapp', whatsapp), 30),
    address = case when v_addr <> '{}' then left(app.address_text(v_addr), 300) else left(coalesce(p ->> 'address', address), 300) end,
    address_data = case when v_addr <> '{}' then v_addr else address_data end,
    website = left(coalesce(p ->> 'website', website), 200)
  where id = v_id;
  perform app.audit(v_id, 'Super Admin alterou dados cadastrais', 'tenant', v_id::text,
    jsonb_build_object('before', jsonb_build_object('name', before.name, 'email', before.email, 'document', before.document), 'after', p - 'id'));
  return v_id;
end $$;
