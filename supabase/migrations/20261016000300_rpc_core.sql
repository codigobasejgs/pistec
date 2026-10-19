-- PISTEC 3.0 — RPCs de cadastro: onboarding, empresa, membros, produtos, clientes, estoque.
-- Todas: security definer + search_path vazio + app.require() (membership/papel/plano/assinatura do servidor).

-- ---------------------------------------------------------------- utilitários
create or replace function app.req_text(v text, label text) returns text
language plpgsql immutable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then perform app.fail(label || ' obrigatório.'); end if;
  return btrim(v);
end $$;

create or replace function app.int_val(v jsonb, label text, minimum bigint default 0) returns bigint
language plpgsql immutable set search_path = '' as $$
declare n numeric;
begin
  if v is null or jsonb_typeof(v) <> 'number' then perform app.fail(label || ': valor inteiro inválido.'); end if;
  n := v::text::numeric;
  if n <> trunc(n) or n < minimum or n > 9007199254740991 then perform app.fail(label || ': valor inteiro inválido.'); end if;
  return n::bigint;
end $$;

create or replace function app.norm(v text) returns text
language sql immutable set search_path = '' as $$
  select lower(btrim(translate(coalesce(v, ''), 'ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇç', 'AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCc')))
$$;

-- Espelho de cents() em src/features/erp/logic.ts.
create or replace function app.parse_cents(v text) returns bigint
language plpgsql immutable set search_path = '' as $$
declare clean text := regexp_replace(btrim(coalesce(v, '')), '^R\$\s*', '');
begin
  if clean = '' then return 0; end if;
  if clean ~ '^[1-9]\d{0,2}(\.\d{3})+(,\d{1,2})?$' then clean := replace(replace(clean, '.', ''), ',', '.');
  else clean := replace(clean, ',', '.'); end if;
  if clean !~ '^\d+(\.\d{1,2})?$' then perform app.fail('Informe um valor monetário positivo com até duas casas decimais.'); end if;
  return round(clean::numeric * 100)::bigint;
end $$;

create or replace function app.uuid_or_null(v text) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if v is null or btrim(v) = '' then return null; end if;
  return v::uuid;
exception when invalid_text_representation then
  perform app.fail('Identificador inválido.'); return null;
end $$;

create or replace function app.user_name() returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(nullif(p.name, ''), nullif(p.email, ''), 'Usuário') from public.profiles p where p.user_id = auth.uid()
$$;

create or replace function app.slugify(v text) returns text
language sql immutable set search_path = '' as $$
  select btrim(regexp_replace(app.norm(v), '[^a-z0-9]+', '-', 'g'), '-')
$$;

create or replace function app.branch_ok(p_tenant uuid, p_branch uuid) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.branches where tenant_id = p_tenant and id = p_branch and active) then
    perform app.fail('Filial inválida ou inativa.');
  end if;
end $$;

-- Saldo com lock de linha (cria se não existir). Ordem de lock por product_id evita deadlock.
create or replace function app.lock_balance(p_tenant uuid, p_branch uuid, p_product uuid) returns public.stock_balances
language plpgsql security definer set search_path = '' as $$
declare b public.stock_balances;
begin
  insert into public.stock_balances (tenant_id, branch_id, product_id) values (p_tenant, p_branch, p_product) on conflict do nothing;
  select * into b from public.stock_balances where tenant_id = p_tenant and branch_id = p_branch and product_id = p_product for update;
  return b;
end $$;

create or replace function app.check_low_stock(p_tenant uuid, p_branch uuid, p_product uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.stock_balances; pr public.products;
begin
  select * into b from public.stock_balances where tenant_id = p_tenant and branch_id = p_branch and product_id = p_product;
  select * into pr from public.products where id = p_product;
  if pr.min > 0 and b.quantity - b.reserved <= pr.min then
    perform app.emit(p_tenant, 'stock.low', jsonb_build_object('productId', p_product, 'branchId', p_branch, 'name', pr.name, 'available', b.quantity - b.reserved, 'min', pr.min));
  end if;
end $$;

create or replace function app.plan_of(p_tenant uuid) returns public.plans
language sql stable security definer set search_path = '' as $$
  select p.* from public.plans p join public.tenants t on t.plan_id = p.id where t.id = p_tenant
$$;

-- ---------------------------------------------------------------- onboarding (servidor)
create or replace function public.onboard_tenant(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid();
  v_name text; v_slug text; v_plan public.plans; v_tenant public.tenants; v_branch uuid; v_email text;
begin
  if v_uid is null then perform app.fail('Entre na sua conta para criar a empresa.', '28000'); end if;
  if (select email_confirmed_at from auth.users where id = v_uid) is null then perform app.fail('Confirme seu e-mail antes de criar a empresa.', '42501'); end if;
  perform pg_advisory_xact_lock(hashtextextended('onboard:' || v_uid::text, 0));
  -- idempotência: mesma conta + mesmo slug devolve a empresa já criada
  v_name := app.req_text(p ->> 'name', 'Empresa');
  v_slug := app.slugify(coalesce(nullif(p ->> 'slug', ''), v_name));
  select * into v_tenant from public.tenants where slug = v_slug and created_by = v_uid;
  if found then return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', (select id from public.branches where tenant_id = v_tenant.id order by created_at limit 1)); end if;
  if v_slug = '' or length(v_slug) > 60 or exists (select 1 from public.tenants where slug = v_slug) then perform app.fail('Identificador da empresa indisponível.'); end if;
  if (select count(*) from public.tenants where created_by = v_uid) >= 3 then perform app.fail('Limite de empresas por conta atingido. Fale com o suporte.'); end if;
  select * into v_plan from public.plans where id = coalesce(nullif(p ->> 'planId', ''), 'essencial') and active;
  if v_plan.id is null then perform app.fail('Plano inválido.'); end if;
  v_email := coalesce(nullif(btrim(p ->> 'email'), ''), (select email from auth.users where id = v_uid));
  insert into public.tenants (slug, name, legal_name, document, owner_name, email, profile, plan_id, status, due_date, branding, notes, created_by)
  values (v_slug, v_name, coalesce(nullif(btrim(p ->> 'legalName'), ''), v_name), regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'),
          app.req_text(coalesce(p ->> 'owner', app.user_name()), 'Responsável'), lower(v_email), coalesce(nullif(p ->> 'profile', ''), 'Autopeças'),
          v_plan.id, 'Teste', current_date + v_plan.trial_days, coalesce(p -> 'branding', '{}'), '', v_uid)
  returning * into v_tenant;
  insert into public.branches (tenant_id, name) values (v_tenant.id, 'Matriz') returning id into v_branch;
  insert into public.memberships (tenant_id, user_id, role) values (v_tenant.id, v_uid, 'Proprietário');
  insert into public.subscriptions (tenant_id, plan_id, status, current_period_end) values (v_tenant.id, v_plan.id, 'trialing', v_tenant.due_date);
  insert into public.ai_settings (tenant_id) values (v_tenant.id);
  perform app.audit(v_tenant.id, 'Empresa criada: ' || v_name, 'tenant', v_tenant.id::text);
  perform app.emit(v_tenant.id, 'tenant.created', jsonb_build_object('name', v_name, 'email', v_tenant.email, 'plan', v_plan.name));
  return jsonb_build_object('tenantId', v_tenant.id, 'slug', v_tenant.slug, 'branchId', v_branch);
end $$;

-- Lead da landing (anônimo). Limite por e-mail/hora contra spam.
create or replace function public.submit_lead(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(app.req_text(p ->> 'email', 'E-mail'));
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then perform app.fail('Email inválido.'); end if;
  if (select count(*) from public.records where kind = 'admin-lead' and fields ->> 'email' = v_email and created_at > now() - interval '1 hour') >= 3 then
    perform app.fail('Muitas solicitações. Tente mais tarde.');
  end if;
  insert into public.records (tenant_id, kind, title, status, fields, history)
  values (null, 'admin-lead', left(app.req_text(p ->> 'name', 'Nome'), 160), 'Novo',
          jsonb_build_object('email', v_email, 'phone', left(coalesce(p ->> 'phone', ''), 40), 'company', left(coalesce(p ->> 'company', ''), 160), 'message', left(coalesce(p ->> 'message', ''), 2000)),
          jsonb_build_array(jsonb_build_object('date', now(), 'text', 'Lead recebido pelo site')));
  perform app.emit(null, 'lead.created', jsonb_build_object('email', v_email));
end $$;

-- ---------------------------------------------------------------- empresa
create or replace function public.update_tenant_profile(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_email text := lower(app.req_text(p ->> 'email', 'Email'));
begin
  perform app.require(p_tenant, 'configuracoes', 'editar');
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then perform app.fail('Email inválido.'); end if;
  update public.tenants set name = left(app.req_text(p ->> 'name', 'Nome'), 120), legal_name = left(coalesce(p ->> 'legalName', ''), 160),
    email = v_email, document = regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g'), notes = left(coalesce(p ->> 'notes', ''), 2000)
  where id = p_tenant;
  perform app.audit(p_tenant, 'Dados da empresa atualizados', 'tenant', p_tenant::text);
end $$;

-- p_scope 'branding' (personalização completa) ou 'prefs' (tema/widgets do dashboard).
create or replace function public.update_branding(p_tenant uuid, p_branding jsonb, p_name text default null, p_scope text default 'branding') returns void
language plpgsql security definer set search_path = '' as $$
declare current jsonb;
begin
  if jsonb_typeof(p_branding) <> 'object' or length(p_branding::text) > 200000 then perform app.fail('Personalização inválida.'); end if;
  select branding into current from public.tenants where id = p_tenant;
  if p_scope = 'prefs' then
    perform app.require(p_tenant, 'dashboard', 'editar');
    update public.tenants set branding = current || jsonb_strip_nulls(jsonb_build_object('theme', p_branding -> 'theme', 'widgets', p_branding -> 'widgets')) where id = p_tenant;
  else
    perform app.require(p_tenant, 'personalizacao', 'editar');
    update public.tenants set branding = p_branding, name = coalesce(left(nullif(btrim(p_name), ''), 120), name) where id = p_tenant;
    perform app.audit(p_tenant, 'Personalização atualizada', 'tenant', p_tenant::text);
  end if;
end $$;

-- ---------------------------------------------------------------- membros e convites
create or replace function app.require_member_management(p_tenant uuid, p_branches uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships := app.membership(p_tenant);
begin
  if m.id is null or m.role not in ('Proprietário', 'Administrador') then
    perform app.fail('Somente proprietário ou administrador gerencia acessos.', '42501');
  end if;
  if m.branch_ids is not null and (p_branches is null or not p_branches <@ m.branch_ids) then
    perform app.fail('Não é permitido ampliar o escopo de filiais.', '42501');
  end if;
  if exists (select 1 from unnest(p_branches) b where not exists (
    select 1 from public.branches where tenant_id = p_tenant and id = b and active)) then
    perform app.fail('Filial inválida ou inativa.', '42501');
  end if;
end $$;
create or replace function public.invite_member(p_tenant uuid, p_email text, p_role text, p_branch_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  m public.memberships := app.require(p_tenant, 'funcionarios', 'cadastrar');
  v_email text := lower(app.req_text(p_email, 'E-mail'));
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
  v_plan public.plans := app.plan_of(p_tenant);
  v_id uuid;
begin
  perform app.require_member_management(p_tenant, p_branch_ids);
  perform pg_advisory_xact_lock(hashtextextended('members:' || p_tenant::text, 0));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then perform app.fail('Email inválido.'); end if;
  if (select count(*) from public.memberships where tenant_id = p_tenant and active)
     + (select count(*) from public.invites where tenant_id = p_tenant and accepted_at is null and revoked_at is null and expires_at > now()) >= v_plan.users then
    perform app.fail('Limite de usuários do plano atingido.');
  end if;
  if exists (select 1 from public.memberships ms join auth.users u on u.id = ms.user_id where ms.tenant_id = p_tenant and lower(u.email) = v_email and ms.active) then
    perform app.fail('Este e-mail já faz parte da equipe.');
  end if;
  update public.invites set revoked_at = now() where tenant_id = p_tenant and email = v_email and accepted_at is null and revoked_at is null;
  insert into public.invites (tenant_id, email, role, branch_ids, token_hash, expires_at, created_by)
  values (p_tenant, v_email, p_role, p_branch_ids, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '7 days', auth.uid())
  returning id into v_id;
  perform app.audit(p_tenant, 'Convite enviado para ' || v_email || ' (' || p_role || ')', 'invite', v_id::text);
  perform app.emit(p_tenant, 'invite.created', jsonb_build_object('inviteId', v_id, 'email', v_email, 'role', p_role, 'token', v_token));
  return jsonb_build_object('inviteId', v_id, 'token', v_token);
end $$;

create or replace function public.accept_invite(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare inv public.invites; v_email text;
begin
  if auth.uid() is null then perform app.fail('Entre na sua conta para aceitar o convite.', '28000'); end if;
  select * into inv from public.invites where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') for update;
  if inv.id is null or inv.revoked_at is not null or inv.expires_at < now() then perform app.fail('Convite inválido ou expirado.'); end if;
  if inv.accepted_at is not null then
    if inv.accepted_by = auth.uid() then return jsonb_build_object('tenantId', inv.tenant_id); end if;
    perform app.fail('Convite já utilizado.');
  end if;
  select lower(email) into v_email from auth.users where id = auth.uid() and email_confirmed_at is not null;
  if v_email is distinct from inv.email then perform app.fail('Este convite foi enviado para outro e-mail.', '42501'); end if;
  insert into public.memberships (tenant_id, user_id, role, branch_ids) values (inv.tenant_id, auth.uid(), inv.role, inv.branch_ids)
  on conflict (tenant_id, user_id) do update set role = excluded.role, branch_ids = excluded.branch_ids, active = true;
  update public.invites set accepted_at = now(), accepted_by = auth.uid() where id = inv.id;
  perform app.audit(inv.tenant_id, 'Convite aceito por ' || v_email, 'invite', inv.id::text);
  return jsonb_build_object('tenantId', inv.tenant_id);
end $$;

create or replace function public.set_member(p_tenant uuid, p_user uuid, p_role text, p_active boolean, p_branch_ids uuid[] default null) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.memberships := app.require(p_tenant, 'funcionarios', 'editar'); target public.memberships;
begin
  perform app.require_member_management(p_tenant, p_branch_ids);
  perform pg_advisory_xact_lock(hashtextextended('members:' || p_tenant::text, 0));
  select * into target from public.memberships where tenant_id = p_tenant and user_id = p_user for update;
  if target.id is null then perform app.fail('Membro não encontrado.'); end if;
  if target.role = 'Proprietário' or p_role = 'Proprietário' then perform app.fail('O proprietário não pode ser alterado por aqui.', '42501'); end if;
  if m.role not in ('Proprietário', 'Administrador') and (target.role = 'Administrador' or p_role = 'Administrador') then perform app.fail('Seu perfil não pode alterar administradores.', '42501'); end if;
  if p_user = auth.uid() then perform app.fail('Não altere o próprio acesso.'); end if;
  update public.memberships set role = p_role, active = p_active, branch_ids = p_branch_ids where id = target.id;
  perform app.audit(p_tenant, 'Acesso alterado: ' || p_role || case when p_active then '' else ' (desativado)' end, 'membership', target.id::text);
end $$;

create or replace function public.revoke_invite(p_tenant uuid, p_invite uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'funcionarios', 'editar');
  update public.invites set revoked_at = now() where id = p_invite and tenant_id = p_tenant and accepted_at is null;
end $$;

-- ---------------------------------------------------------------- produtos
create or replace function public.save_product(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid());
  existing public.products; v_plan public.plans;
  v_active boolean := coalesce((p ->> 'active')::boolean, true);
  v_min bigint := app.int_val(coalesce(p -> 'min', '0'), 'Mínimo'); v_max bigint := app.int_val(coalesce(p -> 'max', '0'), 'Máximo');
begin
  perform pg_advisory_xact_lock(hashtextextended('product-id:' || v_id::text, 0));
  select * into existing from public.products where id = v_id for update;
  if existing.id is not null and existing.tenant_id <> p_tenant then perform app.fail('Produto pertence a outra empresa.', '42501'); end if;
  perform app.require(p_tenant, 'produtos', case when existing.id is null then 'cadastrar' else 'editar' end);
  if v_max > 0 and v_max < v_min then perform app.fail('Máximo inferior ao mínimo.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('products:' || p_tenant::text, 0));
  v_plan := app.plan_of(p_tenant);
  if v_active and not coalesce(existing.active, false) and (select count(*) from public.products where tenant_id = p_tenant and active) >= v_plan.products then
    perform app.fail('Limite de produtos do plano atingido.');
  end if;
  if not v_active and exists (select 1 from public.stock_balances where tenant_id = p_tenant and product_id = v_id and reserved > 0) then
    perform app.fail('Produto com reserva não pode ser desativado.');
  end if;
  if exists (select 1 from public.products where tenant_id = p_tenant and id <> v_id and (lower(sku) = lower(btrim(p ->> 'sku')) or (btrim(coalesce(p ->> 'barcode', '')) <> '' and barcode = btrim(p ->> 'barcode')))) then
    perform app.fail('SKU ou código de barras duplicado.');
  end if;
  insert into public.products as t (id, tenant_id, name, sku, barcode, category, brand, cost, price, min, max, location, active, details)
  values (v_id, p_tenant, left(app.req_text(p ->> 'name', 'Nome'), 200), left(app.req_text(p ->> 'sku', 'SKU'), 80), btrim(coalesce(p ->> 'barcode', '')),
          coalesce(nullif(btrim(p ->> 'category'), ''), 'Geral'), btrim(coalesce(p ->> 'brand', '')), app.int_val(p -> 'cost', 'Custo'), app.int_val(p -> 'price', 'Preço'),
          v_min, v_max, btrim(coalesce(p ->> 'location', '')), v_active, coalesce(p -> 'details', '{}'))
  on conflict (id) do update set name = excluded.name, sku = excluded.sku, barcode = excluded.barcode, category = excluded.category, brand = excluded.brand,
    cost = excluded.cost, price = excluded.price, min = excluded.min, max = excluded.max, location = excluded.location, active = excluded.active, details = excluded.details;
  perform app.audit(p_tenant, 'Produto salvo: ' || (p ->> 'name'), 'product', v_id::text);
  return v_id;
end $$;

create or replace function public.delete_product(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'produtos', 'excluir');
  if exists (select 1 from public.stock_balances where tenant_id = p_tenant and product_id = p_id and (quantity > 0 or reserved > 0))
     or exists (select 1 from public.stock_movements where tenant_id = p_tenant and product_id = p_id)
     or exists (select 1 from public.sale_items where tenant_id = p_tenant and product_id = p_id)
     or exists (select 1 from public.records where tenant_id = p_tenant and items @> jsonb_build_array(jsonb_build_object('productId', p_id::text))) then
    perform app.fail('Produto possui saldo ou histórico. Utilize Arquivar.');
  end if;
  delete from public.stock_balances where tenant_id = p_tenant and product_id = p_id;
  delete from public.products where tenant_id = p_tenant and id = p_id;
  if not found then perform app.fail('Produto não encontrado.'); end if;
  perform app.audit(p_tenant, 'Produto excluído', 'product', p_id::text);
end $$;

create or replace function public.import_products(p_tenant uuid, p_rows jsonb, p_strategy text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  r jsonb; v_line int; v_sku text; v_barcode text; v_name text; existing public.products; v_plan public.plans;
  created int := 0; updated int := 0; skipped int := 0; errors jsonb := '[]';
  seen_sku text[] := '{}'; seen_bar text[] := '{}';
  v_cost bigint; v_price bigint; v_min bigint; v_max bigint;
begin
  perform app.require(p_tenant, 'produtos', 'cadastrar');
  if p_strategy not in ('create', 'update', 'upsert') then perform app.fail('Estratégia de importação inválida.'); end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 5000 then perform app.fail('Planilha inválida (máximo 5.000 linhas).'); end if;
  perform pg_advisory_xact_lock(hashtextextended('products:' || p_tenant::text, 0));
  v_plan := app.plan_of(p_tenant);
  for r in select * from jsonb_array_elements(p_rows) loop
    v_line := coalesce((r ->> 'line')::int, 0);
    v_name := btrim(coalesce(r ->> 'name', '')); v_sku := btrim(coalesce(r ->> 'sku', '')); v_barcode := btrim(coalesce(r ->> 'barcode', ''));
    if v_name = '' then errors := errors || jsonb_build_object('line', v_line, 'message', 'Nome do produto é obrigatório.'); continue; end if;
    if v_sku = '' then errors := errors || jsonb_build_object('line', v_line, 'message', 'SKU é obrigatório.'); continue; end if;
    if lower(v_sku) = any (seen_sku) then errors := errors || jsonb_build_object('line', v_line, 'message', 'SKU duplicado na planilha: ' || v_sku || '.'); continue; end if;
    seen_sku := seen_sku || lower(v_sku);
    if v_barcode <> '' then
      if v_barcode = any (seen_bar) then errors := errors || jsonb_build_object('line', v_line, 'message', 'Código de barras duplicado na planilha: ' || v_barcode || '.'); continue; end if;
      seen_bar := seen_bar || v_barcode;
    end if;
    begin
      v_cost := app.int_val(r -> 'cost', 'Custo'); v_price := app.int_val(r -> 'price', 'Preço');
      v_min := app.int_val(coalesce(r -> 'min', '0'), 'Mínimo'); v_max := app.int_val(coalesce(r -> 'max', '0'), 'Máximo');
    exception when others then
      errors := errors || jsonb_build_object('line', v_line, 'message', 'Valores de custo, preço e limites devem ser inteiros em centavos/unidades.'); continue;
    end;
    if v_max > 0 and v_max < v_min then errors := errors || jsonb_build_object('line', v_line, 'message', 'Estoque máximo não pode ser inferior ao mínimo.'); continue; end if;
    select * into existing from public.products where tenant_id = p_tenant and lower(sku) = lower(v_sku);
    if v_barcode <> '' and exists (select 1 from public.products where tenant_id = p_tenant and barcode = v_barcode and id is distinct from existing.id) then
      errors := errors || jsonb_build_object('line', v_line, 'message', 'Código de barras já utilizado por outro produto: ' || v_barcode || '.'); continue;
    end if;
    if (p_strategy = 'create' and existing.id is not null) or (p_strategy = 'update' and existing.id is null) then skipped := skipped + 1; continue; end if;
    if existing.id is not null then
      update public.products set name = v_name, barcode = v_barcode, category = coalesce(nullif(btrim(r ->> 'category'), ''), category, 'Geral'),
        brand = coalesce(nullif(btrim(r ->> 'brand'), ''), brand), cost = v_cost, price = v_price, min = v_min, max = v_max,
        location = coalesce(nullif(btrim(r ->> 'location'), ''), location),
        details = case when coalesce(r ->> 'unit', '') <> '' then details || jsonb_build_object('unit', r ->> 'unit') else details end
      where id = existing.id;
      updated := updated + 1;
    else
      if (select count(*) from public.products where tenant_id = p_tenant and active) >= v_plan.products then
        errors := errors || jsonb_build_object('line', v_line, 'message', 'Limite de produtos do plano atingido.'); continue;
      end if;
      insert into public.products (tenant_id, name, sku, barcode, category, brand, cost, price, min, max, location, details)
      values (p_tenant, left(v_name, 200), left(v_sku, 80), v_barcode, coalesce(nullif(btrim(r ->> 'category'), ''), 'Geral'), btrim(coalesce(r ->> 'brand', '')),
              v_cost, v_price, v_min, v_max, btrim(coalesce(r ->> 'location', '')), case when coalesce(r ->> 'unit', '') <> '' then jsonb_build_object('unit', r ->> 'unit') else '{}' end);
      created := created + 1;
    end if;
  end loop;
  perform app.audit(p_tenant, format('Importação de produtos (%s): %s criados, %s atualizados, %s ignorados, %s erros', p_strategy, created, updated, skipped, jsonb_array_length(errors)), 'product', '');
  return jsonb_build_object('created', created, 'updated', updated, 'skipped', skipped, 'errors', errors);
end $$;

-- ---------------------------------------------------------------- clientes
create or replace function public.save_customer(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); existing public.customers; v_doc text := regexp_replace(coalesce(p ->> 'document', ''), '\D', '', 'g');
begin
  perform pg_advisory_xact_lock(hashtextextended('customer-id:' || v_id::text, 0));
  select * into existing from public.customers where id = v_id for update;
  if existing.id is not null and existing.tenant_id <> p_tenant then perform app.fail('Cliente pertence a outra empresa.', '42501'); end if;
  perform app.require(p_tenant, 'clientes', case when existing.id is null then 'cadastrar' else 'editar' end);
  if v_doc <> '' and exists (select 1 from public.customers where tenant_id = p_tenant and id <> v_id and regexp_replace(document, '\D', '', 'g') = v_doc) then
    perform app.fail('Documento já cadastrado.');
  end if;
  insert into public.customers (id, tenant_id, name, document, email, phone, address, consent, notes)
  values (v_id, p_tenant, left(app.req_text(p ->> 'name', 'Nome'), 200), left(coalesce(p ->> 'document', ''), 30), left(btrim(coalesce(p ->> 'email', '')), 160),
          left(app.req_text(p ->> 'phone', 'Telefone'), 40), left(coalesce(p ->> 'address', ''), 300), coalesce((p ->> 'consent')::boolean, false), left(coalesce(p ->> 'notes', ''), 2000))
  on conflict (id) do update set name = excluded.name, document = excluded.document, email = excluded.email, phone = excluded.phone,
    address = excluded.address, consent = excluded.consent, notes = excluded.notes;
  perform app.audit(p_tenant, format('%s de cliente %s; consentimento WhatsApp: %s', case when existing.id is null then 'Cadastro' else 'Edição' end, p ->> 'name',
                    case when coalesce((p ->> 'consent')::boolean, false) then 'sim' else 'não' end), 'customer', v_id::text);
  return v_id;
end $$;

create or replace function public.delete_customer(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'clientes', 'excluir');
  if exists (select 1 from public.sales where tenant_id = p_tenant and customer_id = p_id) or exists (select 1 from public.records where tenant_id = p_tenant and customer_id = p_id) then
    perform app.fail('Cliente possui histórico. Preserve o cadastro e registre a restrição nas notas.');
  end if;
  delete from public.customers where tenant_id = p_tenant and id = p_id;
  perform app.audit(p_tenant, 'Cliente excluído', 'customer', p_id::text);
end $$;

-- ---------------------------------------------------------------- estoque
create or replace function public.move_stock(p_tenant uuid, p_branch uuid, p_product uuid, p_quantity integer, p_type text, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.stock_balances; v_next bigint; prev public.stock_movements; v_ref text := app.req_text(p_reference, 'Referência');
begin
  perform app.require(p_tenant, 'estoque', 'editar', p_branch);
  perform app.branch_ok(p_tenant, p_branch);
  if not exists (select 1 from public.products where tenant_id = p_tenant and id = p_product and active) then perform app.fail('Produto inválido ou inativo.'); end if;
  if p_type not in ('Entrada', 'Saída', 'Ajuste') then perform app.fail('Tipo de movimentação inválido.'); end if;
  if p_quantity is null or p_quantity < (case when p_type = 'Ajuste' then 0 else 1 end) then perform app.fail('Quantidade: valor inteiro inválido.'); end if;
  b := app.lock_balance(p_tenant, p_branch, p_product);
  select * into prev from public.stock_movements where tenant_id = p_tenant and branch_id = p_branch and product_id = p_product and type = p_type and reference = v_ref;
  if prev.id is not null then
    if prev.quantity <> p_quantity then perform app.fail('Referência já utilizada com outra quantidade.'); end if;
    return;
  end if;
  v_next := case p_type when 'Ajuste' then p_quantity when 'Entrada' then b.quantity + p_quantity else b.quantity - p_quantity end;
  if v_next < 0 then perform app.fail('Estoque: valor inteiro inválido.'); end if;
  if v_next < b.reserved then perform app.fail('Movimento compromete estoque reservado.'); end if;
  update public.stock_balances set quantity = v_next where tenant_id = p_tenant and branch_id = p_branch and product_id = p_product;
  insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (p_tenant, p_branch, p_product, p_quantity, p_type, v_ref, auth.uid());
  perform app.audit(p_tenant, p_type || ' de estoque: ' || v_ref, 'stock', p_product::text);
  perform app.check_low_stock(p_tenant, p_branch, p_product);
end $$;

-- Inventário: vários ajustes numa transação.
create or replace function public.apply_inventory(p_tenant uuid, p_branch uuid, p_counts jsonb, p_reference text) returns void
language plpgsql security definer set search_path = '' as $$
declare r record;
begin
  for r in select key::uuid as product_id, value from jsonb_each(p_counts) order by key loop
    perform public.move_stock(p_tenant, p_branch, r.product_id, app.int_val(r.value, 'Contagem')::integer, 'Ajuste', p_reference);
  end loop;
end $$;

create or replace function public.transfer_stock(p_tenant uuid, p_from uuid, p_to uuid, p_product uuid, p_quantity integer, p_request_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.stock_balances; v_ref text := 'transfer:' || app.req_text(p_request_id, 'Chave da transferência');
begin
  perform app.require(p_tenant, 'estoque', 'editar', p_from);
  perform app.require(p_tenant, 'estoque', 'editar', p_to);
  perform app.branch_ok(p_tenant, p_from); perform app.branch_ok(p_tenant, p_to);
  if p_from = p_to then perform app.fail('Selecione filiais diferentes.'); end if;
  if not exists (select 1 from public.products where tenant_id = p_tenant and id = p_product and active) then perform app.fail('Produto inválido ou inativo.'); end if;
  if p_quantity is null or p_quantity < 1 then perform app.fail('Quantidade: valor inteiro inválido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended(p_tenant::text || ':' || v_ref, 0));
  if exists (select 1 from public.stock_movements where tenant_id = p_tenant and reference = v_ref) then
    if not exists (select 1 from public.stock_movements where tenant_id = p_tenant and reference = v_ref
      and type = 'Transferência saída' and branch_id = p_from and product_id = p_product and quantity = p_quantity)
      or not exists (select 1 from public.stock_movements where tenant_id = p_tenant and reference = v_ref
      and type = 'Transferência entrada' and branch_id = p_to and product_id = p_product and quantity = p_quantity) then
      perform app.fail('Chave da transferência já utilizada com outro conteúdo.');
    end if;
    return;
  end if;
  -- lock em ordem estável
  perform app.lock_balance(p_tenant, least(p_from, p_to), p_product);
  perform app.lock_balance(p_tenant, greatest(p_from, p_to), p_product);
  select * into a from public.stock_balances where tenant_id = p_tenant and branch_id = p_from and product_id = p_product;
  if a.quantity - a.reserved < p_quantity then perform app.fail('Estoque disponível insuficiente.'); end if;
  update public.stock_balances set quantity = quantity - p_quantity where tenant_id = p_tenant and branch_id = p_from and product_id = p_product;
  update public.stock_balances set quantity = quantity + p_quantity where tenant_id = p_tenant and branch_id = p_to and product_id = p_product;
  insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values
    (p_tenant, p_from, p_product, p_quantity, 'Transferência saída', v_ref, auth.uid()),
    (p_tenant, p_to, p_product, p_quantity, 'Transferência entrada', v_ref, auth.uid());
  perform app.audit(p_tenant, v_ref, 'stock', p_product::text);
  perform app.check_low_stock(p_tenant, p_from, p_product);
end $$;
