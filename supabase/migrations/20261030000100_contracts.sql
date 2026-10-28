-- Contract & Digital Signature 7.0 — contratação digital com contrato versionado, condições congeladas e assinatura eletrônica por provedor.
-- Não destrutiva. Nenhuma versão jurídica nasce aprovada: publicar exige revisão e aprovação registradas por perfis distintos.
-- Assinatura só é "assinada por todos" com confirmação verificada do provedor (Edge Functions contract-sign / contract-webhook).

-- ---------------------------------------------------------------- permissões administrativas de contratos (papéis separados)
alter table public.platform_admins add column if not exists contract_roles text[] not null default '{}'
  check (contract_roles <@ array['editor', 'reviewer', 'approver', 'publisher']::text[]);

create or replace function app.contract_role(p_role text) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.is_platform_admin() and exists (select 1 from public.platform_admins where user_id = auth.uid() and p_role = any (contract_roles))
$$;

-- ---------------------------------------------------------------- identidade jurídica da contratada (histórico imutável)
create table public.legal_provider_profiles (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null, document text not null, legal_nature text not null, brand text not null,
  street text not null, number text not null, district text not null, city text not null, state text not null, zip text not null,
  registry_email text not null, registry_phone text not null,
  commercial_email text not null default '', billing_email text not null default '', support_email text not null default '',
  signer_name text not null default '', signer_email text not null default '', signer_cpf text not null default '',
  source text not null, active boolean not null default false,
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(), reason text not null default ''
);
create unique index legal_provider_one_active on public.legal_provider_profiles ((true)) where active;
insert into public.legal_provider_profiles (legal_name, document, legal_nature, brand, street, number, district, city, state, zip, registry_email, registry_phone, source, active, reason)
values ('59.760.458 MARCO ANTONIO BOGGIAN', '59.760.458/0001-91', 'Empresário Individual', 'PISTEC', 'Rua Jacques Pilon', '189', 'Vila Piauí', 'São Paulo', 'SP', '05109-160',
  'marco.boggian@gmail.com', '(11) 3621-8304', 'Comprovante de inscrição CNPJ fornecido pelo proprietário (2026-10-28)', true, 'Cadastro inicial');

-- ---------------------------------------------------------------- versões do contrato (fluxo editor → revisor → aprovador → publicador)
create table public.legal_contract_versions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[0-9]{4}\.[0-9]{1,3}$'),
  title text not null,
  body jsonb not null,
  source_file text not null default '', source_sha256 text not null default '',
  status text not null default 'draft' check (status in ('draft', 'in_review', 'approved', 'published', 'archived')),
  legal_review_note text not null default '',
  created_by uuid references auth.users(id) on delete set null, created_at timestamptz not null default now(),
  submitted_by uuid, submitted_at timestamptz, reviewed_by uuid, reviewed_at timestamptz,
  approved_by uuid, approved_at timestamptz, approval_evidence text not null default '',
  published_by uuid, published_at timestamptz, archived_at timestamptz
);
create unique index legal_contract_one_published on public.legal_contract_versions ((true)) where status = 'published';

-- ---------------------------------------------------------------- contratos das empresas
create table public.tenant_contracts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  kind text not null default 'contract' check (kind in ('contract', 'addendum')),
  parent_id uuid references public.tenant_contracts(id) on delete restrict,
  version_id uuid not null references public.legal_contract_versions(id),
  provider_profile_id uuid not null references public.legal_provider_profiles(id),
  status text not null default 'awaiting_data' check (status in ('draft', 'awaiting_data', 'prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed', 'signed', 'refused', 'expired', 'cancelled', 'error')),
  commercial jsonb not null,  -- condições congeladas (plano, preço, cupom, recursos, renovação, cancelamento)
  parties jsonb not null,     -- contratada + contratante + representante congelados
  document_sha256 text,       -- hash do PDF submetido ao provedor
  document_path text,         -- Storage privado
  signed_sha256 text, signed_path text, certificate_path text,
  signature_provider text check (signature_provider in ('autentique')),
  provider_document_id text unique,
  sandbox boolean not null default false,
  invoice_id uuid references public.billing_invoices(id),
  request_id text not null,
  sent_at timestamptz, signed_at timestamptz, cancelled_at timestamptz, expires_at timestamptz,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, request_id)
);
create index on public.tenant_contracts (tenant_id, created_at desc);
create index on public.tenant_contracts (status);

create table public.contract_signers (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.tenant_contracts(id) on delete restrict,
  role text not null check (role in ('customer', 'provider')),
  name text not null, email text not null, cpf text not null default '', phone text not null default '',
  auth_method text not null default 'email',
  provider_signer_id text, status text not null default 'pending' check (status in ('pending', 'viewed', 'signed', 'refused')),
  viewed_at timestamptz, signed_at timestamptz, refused_at timestamptz, refusal_reason text,
  unique (contract_id, role)
);

create table public.contract_signature_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid references public.tenant_contracts(id) on delete restrict,
  source text not null check (source in ('system', 'webhook', 'reconcile', 'admin')),
  event_key text not null unique,      -- id do evento do provedor ou chave interna (idempotência)
  type text not null,
  data jsonb not null default '{}',    -- sem IP/geolocalização (ver docs/CONTRACT_SECURITY.md)
  occurred_at timestamptz, created_at timestamptz not null default now()
);
create index on public.contract_signature_events (contract_id, created_at);

create table public.contract_counters (year integer primary key, next bigint not null default 1);

do $$ declare t text; begin
  foreach t in array array['legal_provider_profiles', 'legal_contract_versions', 'tenant_contracts', 'contract_signers', 'contract_signature_events', 'contract_counters'] loop
    execute format('alter table public.%I enable row level security', t); execute format('alter table public.%I force row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.legal_provider_profiles, public.legal_contract_versions, public.tenant_contracts, public.contract_signers, public.contract_signature_events to authenticated;

create or replace function app.contract_reader(p_tenant uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select app.admin_can('billing.read') or app.contract_role('editor') or app.contract_role('reviewer') or exists (
    select 1 from public.memberships m where m.tenant_id = p_tenant and m.user_id = auth.uid() and m.active and m.role in ('Proprietário', 'Administrador', 'Financeiro'))
$$;
create policy provider_read on public.legal_provider_profiles for select to authenticated using (active or app.is_platform_admin());
create policy versions_read on public.legal_contract_versions for select to authenticated using (status = 'published' or app.is_platform_admin());
create policy contracts_read on public.tenant_contracts for select to authenticated using (app.contract_reader(tenant_id));
create policy signers_read on public.contract_signers for select to authenticated using (exists (select 1 from public.tenant_contracts c where c.id = contract_id and app.contract_reader(c.tenant_id)));
create policy contract_events_read on public.contract_signature_events for select to authenticated using (exists (select 1 from public.tenant_contracts c where c.id = contract_id and app.contract_reader(c.tenant_id)));

-- Contrato assinado é imutável: só o service_role altera campos de evidência, e nunca depois de 'signed' (exceto vínculo de fatura).
create or replace function app.contract_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status in ('signed', 'cancelled', 'refused', 'expired') then
    if new.commercial is distinct from old.commercial or new.parties is distinct from old.parties or new.document_sha256 is distinct from old.document_sha256
       or new.document_path is distinct from old.document_path or new.signed_sha256 is distinct from old.signed_sha256 or new.signed_path is distinct from old.signed_path
       or new.version_id is distinct from old.version_id or new.number is distinct from old.number
       or (new.status is distinct from old.status) then
      raise exception 'Contrato finalizado não pode ser alterado. Use um aditivo.' using errcode = '42501';
    end if;
  end if;
  if old.document_sha256 is not null and new.document_sha256 is distinct from old.document_sha256 then raise exception 'Documento já submetido não pode ser trocado.' using errcode = '42501'; end if;
  if old.commercial is distinct from new.commercial or old.parties is distinct from new.parties then raise exception 'Condições congeladas não podem ser alteradas.' using errcode = '42501'; end if;
  new.updated_at := now(); return new;
end $$;
create trigger tenant_contracts_guard before update on public.tenant_contracts for each row execute function app.contract_guard();
create or replace function app.no_delete() returns trigger language plpgsql set search_path = '' as $$ begin raise exception 'Registros contratuais não podem ser apagados.' using errcode = '42501'; end $$;
create trigger tenant_contracts_no_delete before delete on public.tenant_contracts for each row execute function app.no_delete();
create trigger contract_events_no_delete before delete on public.contract_signature_events for each row execute function app.no_delete();
create trigger provider_profiles_no_delete before delete on public.legal_provider_profiles for each row execute function app.no_delete();

-- Versão jurídica: conteúdo só muda enquanto rascunho.
create or replace function app.version_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if old.status <> 'draft' and (new.body is distinct from old.body or new.code is distinct from old.code or new.title is distinct from old.title) then
    raise exception 'Versão contratual fora de rascunho não pode ser editada. Crie uma nova versão.' using errcode = '42501';
  end if; return new;
end $$;
create trigger legal_versions_guard before update on public.legal_contract_versions for each row execute function app.version_guard();

-- ---------------------------------------------------------------- validações brasileiras
create or replace function app.valid_cpf(p text) returns boolean language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); s int; r int; i int;
begin
  if length(d) <> 11 or d ~ '^(\d)\1{10}$' then return false; end if;
  s := 0; for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop; r := (s * 10) % 11; if r = 10 then r := 0; end if;
  if r <> substr(d, 10, 1)::int then return false; end if;
  s := 0; for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop; r := (s * 10) % 11; if r = 10 then r := 0; end if;
  return r = substr(d, 11, 1)::int;
end $$;
create or replace function app.valid_cnpj(p text) returns boolean language plpgsql immutable set search_path = '' as $$
declare d text := regexp_replace(coalesce(p, ''), '\D', '', 'g'); w1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2]; w2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2]; s int; r int; i int;
begin
  if length(d) <> 14 or d ~ '^(\d)\1{13}$' then return false; end if;
  s := 0; for i in 1..12 loop s := s + substr(d, i, 1)::int * w1[i]; end loop; r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  if r <> substr(d, 13, 1)::int then return false; end if;
  s := 0; for i in 1..13 loop s := s + substr(d, i, 1)::int * w2[i]; end loop; r := s % 11; r := case when r < 2 then 0 else 11 - r end;
  return r = substr(d, 14, 1)::int;
end $$;

-- ---------------------------------------------------------------- catálogo público para contratação (preço sempre do servidor)
create or replace function public.contract_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'monthly', p.monthly, 'quarterly', p.quarterly, 'annual', p.annual, 'trialDays', p.trial_days,
      'users', p.users, 'branches', p.branches, 'products', p.products, 'whatsapp', p.whatsapp, 'aiMessages', p.ai_messages, 'features', p.features, 'modules', p.modules) order by p.sort), '[]')
      from public.plans p where p.active and p.monthly > 0),
    'provider', (select jsonb_build_object('legalName', legal_name, 'document', document, 'legalNature', legal_nature, 'brand', brand,
      'address', format('%s, %s, %s, %s/%s, CEP %s', street, number, district, city, state, zip), 'email', coalesce(nullif(commercial_email, ''), registry_email), 'phone', registry_phone)
      from public.legal_provider_profiles where active),
    'version', (select jsonb_build_object('code', code, 'title', title, 'status', status, 'publishedAt', published_at) from public.legal_contract_versions where status = 'published'),
    'draft', (select jsonb_build_object('code', code, 'title', title, 'status', status) from public.legal_contract_versions where status <> 'archived' order by created_at desc limit 1))
$$;
grant execute on function public.contract_catalog() to anon, authenticated;

-- Termos públicos: só o texto da versão (publicada; ou rascunho marcado como tal). Nunca dados de clientes.
create or replace function public.contract_public_terms() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('code', v.code, 'title', v.title, 'status', v.status, 'publishedAt', v.published_at, 'body', v.body,
    'provider', (select jsonb_build_object('legal_name', legal_name, 'document', document, 'legal_nature', legal_nature, 'brand', brand,
      'address', format('%s, %s, %s, %s/%s, CEP %s', street, number, district, city, state, zip), 'contact', format('%s | %s', registry_email, registry_phone)) from public.legal_provider_profiles where active))
  from public.legal_contract_versions v where v.status in ('published', 'draft', 'in_review', 'approved') order by (v.status = 'published') desc, v.created_at desc limit 1
$$;
grant execute on function public.contract_public_terms() to anon, authenticated;

-- ---------------------------------------------------------------- contratação: preparar contrato (dados do servidor; preço não vem do navegador)
create or replace function app.contract_number() returns text language plpgsql security definer set search_path = '' as $$
declare y int := extract(year from now())::int; n bigint;
begin
  insert into public.contract_counters as c (year) values (y) on conflict (year) do update set next = c.next + 1 returning c.next into n;
  return format('PST-%s-%s', y, lpad(n::text, 5, '0'));
end $$;

/** Cria (ou devolve, idempotente) o contrato com condições congeladas. Exige versão PUBLICADA, salvo p_preview (sandbox de homologação, só Super Admin). */
create or replace function public.prepare_contract(p_tenant uuid, p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.memberships; t public.tenants; pl public.plans; v public.legal_contract_versions; prov public.legal_provider_profiles; q record; c public.tenant_contracts;
  v_period text := p ->> 'period'; v_request text := app.req_text(p ->> 'requestId', 'Chave da contratação'); v_doc text; v_cpf text; v_email text; v_phone text; v_start date; v_trial int; v_sandbox boolean := coalesce((p ->> 'sandbox')::boolean, false);
  v_company jsonb := coalesce(p -> 'company', '{}'); v_rep jsonb := coalesce(p -> 'representative', '{}'); v_addr text; v_number text;
begin
  m := app.require(p_tenant, 'minha-assinatura', 'editar');
  if m.role not in ('Proprietário', 'Administrador') then perform app.fail('Somente proprietário ou administrador formaliza a contratação.', '42501'); end if;
  perform pg_advisory_xact_lock(hashtextextended('contract:' || p_tenant || ':' || v_request, 0));
  select * into c from public.tenant_contracts where tenant_id = p_tenant and request_id = v_request;
  if c.id is not null then return jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status, 'duplicate', true); end if;
  if exists (select 1 from public.tenant_contracts where tenant_id = p_tenant and status in ('prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed') and not sandbox) then
    perform app.fail('Já existe um contrato em assinatura para esta empresa. Conclua ou cancele o atual.');
  end if;
  -- versão: só publicada; homologação em sandbox aceita rascunho, sempre marcado e nunca vinculado a cobrança.
  select * into v from public.legal_contract_versions where status = 'published';
  if v.id is null then
    if not v_sandbox then perform app.fail('Contratação digital indisponível: a versão do contrato ainda não foi aprovada juridicamente e publicada.'); end if;
    select * into v from public.legal_contract_versions where status <> 'archived' order by created_at desc limit 1;
  end if;
  if v_sandbox and not app.is_platform_admin() then perform app.fail('Homologação (sandbox) restrita ao Super Admin.', '42501'); end if;
  select * into prov from public.legal_provider_profiles where active;
  -- Contrato real exige o signatário autorizado da contratada configurado (nunca assinatura automática da contratada).
  if not v_sandbox and (prov.signer_email = '' or prov.signer_name = '') then perform app.fail('Contratação indisponível: signatário da contratada não configurado no Super Admin.'); end if;
  select * into t from public.tenants where id = p_tenant;
  select * into pl from public.plans where id = p ->> 'planId' and active;
  if pl.id is null then perform app.fail('Plano indisponível para contratação.'); end if;
  if v_period not in ('monthly', 'quarterly', 'annual') then perform app.fail('Periodicidade inválida.'); end if;
  -- validações do contratante e do representante
  v_doc := regexp_replace(coalesce(v_company ->> 'document', ''), '\D', '', 'g');
  if not (app.valid_cnpj(v_doc) or app.valid_cpf(v_doc)) then perform app.fail('CPF/CNPJ do contratante inválido.'); end if;
  v_cpf := regexp_replace(coalesce(v_rep ->> 'cpf', ''), '\D', '', 'g');
  if not app.valid_cpf(v_cpf) then perform app.fail('CPF do representante inválido.'); end if;
  v_email := lower(btrim(coalesce(v_rep ->> 'email', '')));
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' then perform app.fail('E-mail do representante inválido.'); end if;
  v_phone := regexp_replace(coalesce(v_rep ->> 'phone', ''), '\D', '', 'g');
  if length(v_phone) not between 10 and 13 then perform app.fail('Telefone do representante inválido.'); end if;
  if coalesce((v_rep ->> 'hasPowers')::boolean, false) is not true then perform app.fail('Confirme que o representante tem poderes para contratar.'); end if;
  if regexp_replace(coalesce(v_company ->> 'zip', ''), '\D', '', 'g') !~ '^\d{8}$' or coalesce(v_company ->> 'state', '') !~ '^[A-Z]{2}$' then perform app.fail('CEP ou UF inválido.'); end if;
  v_addr := format('%s, %s%s, %s, %s/%s, CEP %s', app.req_text(v_company ->> 'street', 'Logradouro'), app.req_text(v_company ->> 'number', 'Número'),
    coalesce(', ' || nullif(btrim(v_company ->> 'complement'), ''), ''), app.req_text(v_company ->> 'district', 'Bairro'), app.req_text(v_company ->> 'city', 'Cidade'), v_company ->> 'state',
    regexp_replace(v_company ->> 'zip', '^(\d{5})(\d{3})$', '\1-\2'));
  select * into q from app.coupon_quote(p_tenant, p ->> 'coupon', pl.id, v_period);
  v_trial := case when t.status = 'Teste' and t.due_date >= current_date then (t.due_date - current_date) else 0 end;
  v_start := current_date;
  v_number := app.contract_number();
  insert into public.tenant_contracts (number, tenant_id, version_id, provider_profile_id, status, commercial, parties, sandbox, request_id, created_by, expires_at)
  values (v_number, p_tenant, v.id, prov.id, 'prepared',
    jsonb_build_object('planId', pl.id, 'planVersion', md5(row_to_json(pl)::text), 'planName', pl.name, 'period', v_period, 'price', q.original, 'discount', q.discount, 'total', q.total, 'coupon', q.code,
      'trialDays', v_trial, 'trialEnd', case when v_trial > 0 then t.due_date end, 'startDate', v_start,
      'nextDue', case when v_trial > 0 then t.due_date else v_start + case v_period when 'monthly' then 30 when 'quarterly' then 90 else 365 end end,
      'entitlements', jsonb_build_object('users', pl.users, 'branches', pl.branches, 'products', pl.products, 'whatsapp', pl.whatsapp, 'aiMessagesPerDay', pl.ai_messages, 'features', pl.features, 'modules', pl.modules),
      'renewal', 'Renovação automática ao fim de cada período pela mesma periodicidade; a fatura de renovação é gerada 5 dias antes do vencimento e só é cobrada mediante pagamento confirmado.',
      'cancellation', 'Cancelamento a qualquer momento em Minha assinatura, com efeito ao fim do período já pago, sem multa; dados preservados para exportação conforme Anexo I.',
      'readjustment', 'Reajuste de preço comunicado com antecedência mínima de 30 dias e aplicável apenas a períodos futuros.',
      'grace', '5 dias de tolerância após o vencimento; depois, acesso somente leitura até a regularização, sem exclusão de dados.',
      'notification', 'Avisos por e-mail cadastrado e notificação no painel antes do vencimento e da suspensão.',
      'support', 'Suporte pelos canais publicados no PISTEC, sem SLA contratual salvo proposta específica.',
      'exportDays', '30 dias após o encerramento', 'exportFormats', 'CSV e PDF disponíveis nas telas do sistema',
      'retention', 'Política de privacidade vigente na data da assinatura', 'integrations', 'Conforme recursos do plano (Anexo I) e configuração da empresa',
      'billingMethod', 'InfinitePay (Pix ou cartão)'),
    jsonb_build_object(
      'provider', jsonb_build_object('legalName', prov.legal_name, 'document', prov.document, 'legalNature', prov.legal_nature, 'brand', prov.brand,
        'address', format('%s, %s, %s, %s/%s, CEP %s', prov.street, prov.number, prov.district, prov.city, prov.state, prov.zip), 'contact', format('%s | %s', prov.registry_email, prov.registry_phone),
        'signerName', prov.signer_name, 'signerEmail', prov.signer_email),
      'company', jsonb_build_object('legalName', app.req_text(v_company ->> 'legalName', 'Razão social'), 'tradeName', coalesce(nullif(btrim(v_company ->> 'tradeName'), ''), t.name),
        'document', v_doc, 'address', v_addr, 'phone', regexp_replace(coalesce(v_company ->> 'phone', ''), '\D', '', 'g'), 'email', lower(btrim(coalesce(v_company ->> 'email', t.email)))),
      'representative', jsonb_build_object('name', app.req_text(v_rep ->> 'name', 'Nome do representante'), 'cpf', v_cpf, 'role', app.req_text(v_rep ->> 'role', 'Cargo'), 'email', v_email, 'phone', v_phone)),
    v_sandbox, v_request, auth.uid(), now() + interval '15 days')
  returning * into c;
  insert into public.contract_signers (contract_id, role, name, email, cpf, phone) values (c.id, 'customer', v_rep ->> 'name', v_email, v_cpf, v_phone);
  if prov.signer_email <> '' then insert into public.contract_signers (contract_id, role, name, email, cpf) values (c.id, 'provider', prov.signer_name, prov.signer_email, prov.signer_cpf); end if;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data) values (c.id, 'system', 'prepared:' || c.id, 'prepared', jsonb_build_object('version', v.code, 'versionStatus', v.status, 'sandbox', v_sandbox));
  perform app.audit(p_tenant, format('Contrato %s preparado (%s/%s, versão %s%s)', c.number, pl.id, v_period, v.code, case when v_sandbox then ', HOMOLOGAÇÃO' else '' end), 'contract', c.id::text);
  return jsonb_build_object('id', c.id, 'number', c.number, 'status', c.status, 'duplicate', false);
end $$;

/** Contrato completo para renderização (template da versão + partes + condições congeladas). */
create or replace function public.contract_detail(p_contract uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare c public.tenant_contracts; v public.legal_contract_versions;
begin
  select * into c from public.tenant_contracts where id = p_contract;
  if c.id is null or not app.contract_reader(c.tenant_id) then perform app.fail('Contrato não encontrado.', '42501'); end if;
  select * into v from public.legal_contract_versions where id = c.version_id;
  return jsonb_build_object('id', c.id, 'number', c.number, 'kind', c.kind, 'status', c.status, 'sandbox', c.sandbox, 'commercial', c.commercial, 'parties', c.parties,
    'version', jsonb_build_object('code', v.code, 'title', v.title, 'status', v.status, 'body', v.body), 'documentSha256', c.document_sha256, 'signedSha256', c.signed_sha256,
    'signedAt', c.signed_at, 'sentAt', c.sent_at, 'invoiceId', c.invoice_id, 'createdAt', c.created_at, 'expiresAt', c.expires_at, 'error', c.error, 'tenantId', c.tenant_id,
    'signers', (select coalesce(jsonb_agg(jsonb_build_object('role', s.role, 'name', s.name, 'email', app.mask(s.email), 'status', s.status, 'authMethod', s.auth_method, 'viewedAt', s.viewed_at, 'signedAt', s.signed_at, 'refusedAt', s.refused_at) order by s.role), '[]') from public.contract_signers s where s.contract_id = c.id),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('type', e.type, 'source', e.source, 'at', coalesce(e.occurred_at, e.created_at)) order by coalesce(e.occurred_at, e.created_at)), '[]') from public.contract_signature_events e where e.contract_id = c.id),
    'invoice', (select jsonb_build_object('status', i.status, 'amount', i.amount, 'paidAt', i.paid_at) from public.billing_invoices i where i.id = c.invoice_id));
end $$;

/** Cancelar pedido de assinatura ainda pendente (cliente: proprietário; Super Admin: subscriptions.manage). A Edge Function bloqueia no provedor. */
create or replace function public.cancel_contract(p_contract uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts; v_reason text := app.reason(p_reason);
begin
  select * into c from public.tenant_contracts where id = p_contract for update;
  if c.id is null then perform app.fail('Contrato não encontrado.'); end if;
  if not (coalesce(app.admin_can('subscriptions.manage'), false) or coalesce((app.membership(c.tenant_id)).role = 'Proprietário', false)) then perform app.fail('Seu perfil não permite cancelar este contrato.', '42501'); end if;
  if c.status not in ('draft', 'awaiting_data', 'prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed', 'error') then perform app.fail('Somente contratos ainda não concluídos podem ser cancelados.'); end if;
  update public.tenant_contracts set status = 'cancelled', cancelled_at = now() where id = c.id;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data) values (c.id, case when app.is_platform_admin() then 'admin' else 'system' end, 'cancel:' || c.id, 'cancelled', jsonb_build_object('reason', v_reason));
  perform app.audit(c.tenant_id, format('Contrato %s cancelado antes da conclusão', c.number), 'contract', c.id::text, jsonb_build_object('reason', v_reason, 'before', c.status));
end $$;

/** Após contrato assinado: cria a fatura do contrato (idempotente) com as condições CONGELADAS. Só para contrato real (não sandbox). */
create or replace function public.contract_invoice(p_contract uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts; inv public.billing_invoices; cur record;
begin
  select * into c from public.tenant_contracts where id = p_contract for update;
  if c.id is null then perform app.fail('Contrato não encontrado.'); end if;
  perform app.require(c.tenant_id, 'minha-assinatura', 'editar');
  if c.sandbox then perform app.fail('Contrato de homologação não gera cobrança.'); end if;
  if c.status <> 'signed' then perform app.fail('A cobrança só é gerada depois do contrato assinado por todos.'); end if;
  if c.invoice_id is not null then return c.invoice_id; end if;
  -- o preço congelado precisa continuar válido no catálogo; se mudou, exige novo contrato (nunca cobra valor diferente do assinado).
  select * into cur from app.coupon_quote(c.tenant_id, c.commercial ->> 'coupon', c.commercial ->> 'planId', c.commercial ->> 'period');
  if cur.total <> (c.commercial ->> 'total')::bigint then perform app.fail('O preço do plano mudou desde a assinatura. Será necessário um novo contrato ou aditivo.'); end if;
  inv := app.create_invoice(c.tenant_id, c.commercial ->> 'planId', c.commercial ->> 'period', c.commercial ->> 'coupon', 'InfinitePay', 'contract:' || c.id,
    coalesce((c.commercial ->> 'trialEnd')::date, current_date + 3));
  update public.tenant_contracts set invoice_id = inv.id where id = c.id;
  perform app.audit(c.tenant_id, format('Fatura %s gerada a partir do contrato %s', inv.id, c.number), 'contract', c.id::text);
  return inv.id;
end $$;

-- ---------------------------------------------------------------- serviço (Edge Functions com service_role): envio, eventos, conclusão
create or replace function public.svc_contract_sent(p_contract uuid, p_provider_doc text, p_sha256 text, p_path text, p_signers jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts; s jsonb;
begin
  select * into c from public.tenant_contracts where id = p_contract for update;
  if c.status <> 'prepared' then perform app.fail('Contrato não está pronto para envio.'); end if;
  if p_sha256 !~ '^[0-9a-f]{64}$' then perform app.fail('Hash inválido.'); end if;
  update public.tenant_contracts set status = 'awaiting_customer', signature_provider = 'autentique', provider_document_id = p_provider_doc, document_sha256 = p_sha256, document_path = p_path, sent_at = now() where id = c.id;
  for s in select * from jsonb_array_elements(coalesce(p_signers, '[]')) loop
    update public.contract_signers set provider_signer_id = s ->> 'id', auth_method = coalesce(s ->> 'method', 'email') where contract_id = c.id and role = s ->> 'role';
  end loop;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data) values (c.id, 'system', 'sent:' || c.id, 'sent', jsonb_build_object('providerDocument', p_provider_doc, 'sha256', p_sha256));
  perform app.audit(c.tenant_id, format('Contrato %s enviado para assinatura (Autentique)', c.number), 'contract', c.id::text);
end $$;

create or replace function public.svc_contract_failed(p_contract uuid, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.tenant_contracts set status = 'error', error = left(p_error, 300) where id = p_contract and status = 'prepared'
$$;

/** Aplica o estado CONFIRMADO pela API do provedor (após webhook verificado ou reconciliação). Idempotente por event_key; ordem irrelevante. */
create or replace function public.svc_contract_apply(p_provider_doc text, p_event_key text, p_type text, p_signers jsonb, p_source text) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts; s jsonb; v_status text; n_total int; n_signed int; n_refused int; n_customer_signed int;
begin
  select * into c from public.tenant_contracts where provider_document_id = p_provider_doc for update;
  if c.id is null then return 'unknown'; end if;
  if exists (select 1 from public.contract_signature_events where event_key = p_event_key) then return 'duplicate'; end if;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data, occurred_at) values (c.id, p_source, p_event_key, p_type, jsonb_build_object('signers', jsonb_array_length(coalesce(p_signers, '[]'))), now());
  if c.status in ('signed', 'cancelled', 'refused', 'expired') then return 'final'; end if;
  for s in select * from jsonb_array_elements(coalesce(p_signers, '[]')) loop
    update public.contract_signers set
      viewed_at = coalesce(viewed_at, (s ->> 'viewed')::timestamptz), signed_at = coalesce(signed_at, (s ->> 'signed')::timestamptz), refused_at = coalesce(refused_at, (s ->> 'rejected')::timestamptz),
      status = case when coalesce(signed_at, (s ->> 'signed')::timestamptz) is not null then 'signed' when coalesce(refused_at, (s ->> 'rejected')::timestamptz) is not null then 'refused'
        when coalesce(viewed_at, (s ->> 'viewed')::timestamptz) is not null then 'viewed' else 'pending' end
    where contract_id = c.id and provider_signer_id = s ->> 'id';
  end loop;
  select count(*), count(*) filter (where status = 'signed'), count(*) filter (where status = 'refused'), count(*) filter (where status = 'signed' and role = 'customer')
    into n_total, n_signed, n_refused, n_customer_signed from public.contract_signers where contract_id = c.id;
  v_status := case when n_refused > 0 then 'refused' when n_signed = n_total and n_total > 0 then 'partially_signed' /* 'signed' só por svc_contract_complete, com o PDF final guardado */
    when n_signed > 0 then case when n_customer_signed > 0 then 'awaiting_provider' else 'partially_signed' end else 'awaiting_customer' end;
  if v_status <> c.status then update public.tenant_contracts set status = v_status where id = c.id; end if;
  return v_status;
end $$;

/** Conclusão: só com todos os signatários assinados (confirmado na API) e o PDF assinado guardado com hash. */
create or replace function public.svc_contract_complete(p_provider_doc text, p_signed_sha256 text, p_signed_path text, p_certificate_path text) returns text
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts;
begin
  select * into c from public.tenant_contracts where provider_document_id = p_provider_doc for update;
  if c.id is null then return 'unknown'; end if;
  if c.status = 'signed' then return 'already'; end if;
  if c.status in ('cancelled', 'refused', 'expired') then return 'final'; end if;
  if exists (select 1 from public.contract_signers where contract_id = c.id and status <> 'signed') then return 'incomplete'; end if;
  if p_signed_sha256 !~ '^[0-9a-f]{64}$' then perform app.fail('Hash inválido.'); end if;
  update public.tenant_contracts set status = 'signed', signed_at = now(), signed_sha256 = p_signed_sha256, signed_path = p_signed_path, certificate_path = p_certificate_path where id = c.id;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data) values (c.id, 'system', 'completed:' || c.id, 'completed', jsonb_build_object('signedSha256', p_signed_sha256));
  perform app.audit(c.tenant_id, format('Contrato %s assinado por todos', c.number), 'contract', c.id::text);
  if not c.sandbox then
    perform app.queue_email(c.tenant_id, c.parties -> 'representative' ->> 'email', 'contract_signed',
      jsonb_build_object('company', c.parties -> 'company' ->> 'legalName', 'plan', c.commercial ->> 'planName', 'number', c.number, 'name', c.parties -> 'representative' ->> 'name', 'signedAt', now(), 'slug', (select slug from public.tenants where id = c.tenant_id)),
      'contract-signed:' || c.id);
    insert into public.notifications (tenant_id, type, title, body, module) values (c.tenant_id, 'contract.signed', 'Contrato assinado', format('Contrato %s assinado por todas as partes.', c.number), 'minha-assinatura');
  end if;
  return 'signed';
end $$;

create or replace function public.svc_contract_expire() returns integer
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  with x as (update public.tenant_contracts set status = 'expired' where status in ('prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed') and expires_at < now() returning id)
  select count(*) into n from x;
  return n;
end $$;

/** Dados para envio (Edge Function): exige quem pediu ser proprietário/administrador da empresa. */
create or replace function public.contract_for_signing(p_contract uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts;
begin
  select * into c from public.tenant_contracts where id = p_contract;
  if c.id is null then perform app.fail('Contrato não encontrado.'); end if;
  if not coalesce((app.membership(c.tenant_id)).role in ('Proprietário', 'Administrador'), false) and not (c.sandbox and app.is_platform_admin()) then perform app.fail('Seu perfil não permite enviar este contrato.', '42501'); end if;
  if c.status <> 'prepared' then perform app.fail('Contrato já enviado ou finalizado.'); end if;
  return public.contract_detail(p_contract) || jsonb_build_object('signersRaw', (select jsonb_agg(jsonb_build_object('role', role, 'name', name, 'email', email, 'cpf', cpf, 'phone', phone)) from public.contract_signers where contract_id = c.id));
end $$;

-- ---------------------------------------------------------------- Super Admin: identidade jurídica e versões
create or replace function public.admin_save_provider_profile(p jsonb, p_reason text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare cur public.legal_provider_profiles; v_reason text := app.reason(p_reason); v_id uuid;
begin
  if coalesce(app.admin_role(), '') <> 'owner' then perform app.fail('Somente o proprietário da plataforma altera a identidade jurídica.', '42501'); end if;
  select * into cur from public.legal_provider_profiles where active;
  -- campos oficiais (CNPJ, nome empresarial) só mudam com nova fonte documental; contratos antigos mantêm o congelado em parties.
  update public.legal_provider_profiles set active = false where active;
  insert into public.legal_provider_profiles (legal_name, document, legal_nature, brand, street, number, district, city, state, zip, registry_email, registry_phone,
    commercial_email, billing_email, support_email, signer_name, signer_email, signer_cpf, source, active, created_by, reason)
  values (coalesce(p ->> 'legal_name', cur.legal_name), coalesce(p ->> 'document', cur.document), coalesce(p ->> 'legal_nature', cur.legal_nature), coalesce(p ->> 'brand', cur.brand),
    coalesce(p ->> 'street', cur.street), coalesce(p ->> 'number', cur.number), coalesce(p ->> 'district', cur.district), coalesce(p ->> 'city', cur.city), coalesce(p ->> 'state', cur.state), coalesce(p ->> 'zip', cur.zip),
    coalesce(p ->> 'registry_email', cur.registry_email), coalesce(p ->> 'registry_phone', cur.registry_phone),
    lower(coalesce(p ->> 'commercial_email', cur.commercial_email)), lower(coalesce(p ->> 'billing_email', cur.billing_email)), lower(coalesce(p ->> 'support_email', cur.support_email)),
    coalesce(p ->> 'signer_name', cur.signer_name), lower(coalesce(p ->> 'signer_email', cur.signer_email)), regexp_replace(coalesce(p ->> 'signer_cpf', cur.signer_cpf), '\D', '', 'g'),
    case when coalesce(p ->> 'legal_name', cur.legal_name) is distinct from cur.legal_name or coalesce(p ->> 'document', cur.document) is distinct from cur.document then app.req_text(p ->> 'source', 'Fonte documental da alteração') else cur.source end,
    true, auth.uid(), v_reason) returning id into v_id;
  if (select signer_cpf from public.legal_provider_profiles where id = v_id) <> '' and not app.valid_cpf((select signer_cpf from public.legal_provider_profiles where id = v_id)) then perform app.fail('CPF do signatário da contratada inválido.'); end if;
  perform app.audit(null, 'Identidade jurídica da contratada atualizada', 'legal_provider', v_id::text, jsonb_build_object('before', cur.id, 'after', v_id, 'reason', v_reason));
  return v_id;
end $$;

create or replace function public.admin_contract_version(p_action text, p_id uuid, p jsonb, p_note text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.legal_contract_versions; v_id uuid := p_id;
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
  if p_id is not null then select * into v from public.legal_contract_versions where id = p_id for update; if v.id is null then perform app.fail('Versão não encontrada.'); end if; end if;
  case p_action
    when 'create' then
      if not app.contract_role('editor') then perform app.fail('Perfil de editor contratual necessário.', '42501'); end if;
      insert into public.legal_contract_versions (code, title, body, source_file, source_sha256, created_by)
      values (app.req_text(p ->> 'code', 'Código da versão'), app.req_text(p ->> 'title', 'Título'), p -> 'body', coalesce(p ->> 'sourceFile', ''), coalesce(p ->> 'sourceSha256', ''), auth.uid()) returning id into v_id;
    when 'edit' then
      if not app.contract_role('editor') then perform app.fail('Perfil de editor contratual necessário.', '42501'); end if;
      update public.legal_contract_versions set body = p -> 'body', title = coalesce(p ->> 'title', title) where id = p_id;
    when 'submit' then
      if not app.contract_role('editor') or v.status <> 'draft' then perform app.fail('Somente editor envia rascunho para revisão.', '42501'); end if;
      update public.legal_contract_versions set status = 'in_review', submitted_by = auth.uid(), submitted_at = now() where id = p_id;
    when 'review' then
      if not app.contract_role('reviewer') or v.status <> 'in_review' then perform app.fail('Somente revisor jurídico registra revisão de versão em revisão.', '42501'); end if;
      if v.submitted_by = auth.uid() then perform app.fail('Quem enviou a versão não pode revisá-la.', '42501'); end if;
      update public.legal_contract_versions set reviewed_by = auth.uid(), reviewed_at = now(), legal_review_note = app.req_text(p_note, 'Parecer da revisão') where id = p_id;
    when 'return' then
      if not (app.contract_role('reviewer') or app.contract_role('approver')) or v.status not in ('in_review', 'approved') then perform app.fail('Ação não permitida.', '42501'); end if;
      update public.legal_contract_versions set status = 'draft', reviewed_by = null, reviewed_at = null, approved_by = null, approved_at = null, legal_review_note = app.req_text(p_note, 'Motivo da devolução') where id = p_id;
    when 'approve' then
      if not app.contract_role('approver') or v.status <> 'in_review' or v.reviewed_at is null then perform app.fail('Aprovação exige revisão jurídica registrada e perfil de aprovador.', '42501'); end if;
      if v.reviewed_by = auth.uid() or v.submitted_by = auth.uid() then perform app.fail('Aprovador deve ser diferente de quem enviou e de quem revisou.', '42501'); end if;
      update public.legal_contract_versions set status = 'approved', approved_by = auth.uid(), approved_at = now(), approval_evidence = app.req_text(p_note, 'Evidência da aprovação jurídica (ex.: parecer nº, advogado OAB)') where id = p_id;
    when 'publish' then
      if not app.contract_role('publisher') or v.status <> 'approved' then perform app.fail('Somente versão aprovada pode ser publicada, por perfil publicador.', '42501'); end if;
      update public.legal_contract_versions set status = 'archived', archived_at = now() where status = 'published';
      update public.legal_contract_versions set status = 'published', published_by = auth.uid(), published_at = now() where id = p_id;
    when 'archive' then
      if not app.contract_role('publisher') then perform app.fail('Perfil publicador necessário.', '42501'); end if;
      update public.legal_contract_versions set status = 'archived', archived_at = now() where id = p_id;
    else perform app.fail('Ação inválida.');
  end case;
  perform app.audit(null, format('Versão contratual %s: %s', coalesce(v.code, p ->> 'code'), p_action), 'contract_version', v_id::text, jsonb_build_object('note', p_note));
  return v_id;
end $$;

create or replace function public.admin_set_contract_roles(p_email text, p_roles text[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if coalesce(app.admin_role(), '') <> 'owner' then perform app.fail('Somente o proprietário da plataforma atribui papéis contratuais.', '42501'); end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email));
  if v_user is null or not exists (select 1 from public.platform_admins where user_id = v_user) then perform app.fail('Administrador não encontrado.'); end if;
  update public.platform_admins set contract_roles = coalesce(p_roles, '{}') where user_id = v_user;
  perform app.audit(null, format('Papéis contratuais de %s: %s', app.mask(p_email), array_to_string(p_roles, ', ')), 'platform_admin', v_user::text);
end $$;

create or replace function public.admin_contract_metrics() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.admin_can('billing.read') or app.contract_role('editor') or app.contract_role('reviewer')) then perform app.fail('Seu perfil administrativo não permite esta consulta.', '42501'); end if;
  return (select jsonb_build_object('total', count(*), 'pending', count(*) filter (where status in ('prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed')),
    'signed', count(*) filter (where status = 'signed'), 'refused', count(*) filter (where status = 'refused'), 'expired', count(*) filter (where status = 'expired'),
    'cancelled', count(*) filter (where status = 'cancelled'), 'error', count(*) filter (where status = 'error'), 'sandbox', count(*) filter (where sandbox),
    'awaitingPayment', count(*) filter (where status = 'signed' and (invoice_id is null or exists (select 1 from public.billing_invoices i where i.id = invoice_id and i.status <> 'Paga'))),
    'activeLinked', count(*) filter (where status = 'signed' and exists (select 1 from public.subscriptions s where s.tenant_id = tenant_contracts.tenant_id and s.status = 'active')),
    'avgHoursToSign', round(extract(epoch from avg(signed_at - sent_at) filter (where signed_at is not null)) / 3600, 1))
    from public.tenant_contracts);
end $$;

-- ---------------------------------------------------------------- versão inicial: minuta 2026.1 como RASCUNHO (nunca aprovada automaticamente)
-- Mesmo conteúdo de supabase/functions/_shared/contracts/minuta-2026-1.json (extraído de docs/contracts/PISTEC_Minuta_Contrato_SaaS_2026.docx).
insert into public.legal_contract_versions (code, title, body, source_file, source_sha256, status, legal_review_note)
values ('2026.1', 'Contrato de Licença de Uso e Prestação de Serviços de Software (SaaS) — PISTEC', $minuta${"title":"CONTRATO DE LICENÇA DE USO E PRESTAÇÃO DE SERVIÇOS DE SOFTWARE (SaaS)","subtitle":"PISTEC — Plataforma de Gestão para Oficinas, Motopeças e Autopeças","summaryTitle":"QUADRO-RESUMO DA CONTRATAÇÃO","summary":[["CONTRATADA — nome empresarial","{{contratada_nome}}"],["CNPJ da contratada","{{contratada_cnpj}}"],["Marca da solução","{{contratada_marca}}"],["Natureza jurídica","{{contratada_natureza}}"],["Endereço da contratada","{{contratada_endereco}}"],["Contato cadastral","{{contratada_contato}}"],["CONTRATANTE","{{empresa_razao_social}} | Nome fantasia: {{empresa_nome_fantasia}}"],["CPF/CNPJ e endereço","{{empresa_documento}} | {{empresa_endereco_completo}}"],["Representante e documento","{{representante_nome}} | CPF: {{representante_cpf}} | Cargo: {{representante_cargo}}"],["Contato contratual","{{representante_email}} | {{representante_telefone}}"],["Plano e periodicidade","{{plano_nome}} | {{periodicidade}}"],["Valor e condições","{{valor_plano}} | {{desconto_cupom_se_houver}} | {{valor_total_contratado}}"],["Limites e recursos incluídos","Conforme ANEXO I gerado automaticamente a partir dos entitlements vigentes"],["Teste gratuito, se elegível","{{dias_teste}} | {{data_inicio_teste}} a {{data_fim_teste}}"],["Cobrança e vencimento","{{meio_cobranca}} | {{data_proximo_vencimento}} | {{regra_renovacao}}"],["Contratação/assinatura","{{data_hora_assinatura}} | Identificador: {{contract_id}}"]],"summaryNote":"As condições efetivamente contratadas são as exibidas ao CONTRATANTE imediatamente antes da assinatura e consolidadas neste instrumento e em seus anexos. Campos {{...}} serão preenchidos automaticamente pelo PISTEC e não podem permanecer vazios em contrato final.","sections":[{"title":"CLÁUSULA 1 — PARTES E DEFINIÇÕES","paragraphs":["1.1. CONTRATADA: {{contratada_nome}}, empresário individual inscrito no CNPJ {{contratada_cnpj}}, com endereço e contatos identificados no quadro-resumo, responsável comercial pela solução identificada como PISTEC.","1.2. CONTRATANTE: pessoa física ou jurídica identificada no quadro-resumo, representada por pessoa com poderes para formalizar a contratação, que declara a correção das informações fornecidas.","1.3. Plataforma: aplicação PISTEC, disponibilizada na modalidade Software as a Service (SaaS), incluindo os módulos e limites expressamente contratados. Usuários: pessoas autorizadas pelo CONTRATANTE. Dados do Cliente: informações operacionais inseridas na Plataforma sob responsabilidade do CONTRATANTE."]},{"title":"CLÁUSULA 2 — OBJETO E ESCOPO","paragraphs":["2.1. O presente contrato tem por objeto a licença de acesso e uso, não exclusiva, não transferível e limitada ao prazo contratual, da Plataforma PISTEC, destinada à gestão de oficinas mecânicas, motopeças, autopeças e atividades correlatas, conforme o plano e as funcionalidades habilitadas no ANEXO I.","2.2. Os módulos poderão compreender, conforme plano e disponibilidade efetiva: dashboard, cadastro de produtos e serviços, estoque, PDV e caixa, vendas, clientes, veículos, orçamentos, ordens de serviço, agenda, compras, fornecedores, financeiro, relatórios, equipes, filiais, personalização visual, PWA, notificações e integrações contratadas.","2.3. Funcionalidades de terceiros, como meios de pagamento, WhatsApp, envio de e-mail, assinatura eletrônica, serviços de IA, emissão fiscal e impressão por equipamentos, somente integram o objeto se previstas no plano e tecnicamente habilitadas. A emissão de documento comercial não fiscal não substitui documento fiscal legalmente exigível.","2.4. Licenças perpétuas, instalação própria, projetos sob medida e serviços extraordinários exigem instrumento específico e não se presumem incluídos nesta assinatura SaaS."]},{"title":"CLÁUSULA 3 — PLANO, PREÇO E CONDIÇÕES COMERCIAIS","paragraphs":["3.1. O plano, periodicidade, preço, eventual desconto, data de vencimento, limites e recursos vinculantes são os registrados no quadro-resumo e no ANEXO I. A contratação não depende de preços genéricos da landing page quando houver proposta individual aceita.","3.2. O início de teste gratuito, quando oferecido, terá período, regras e eventual conversão claramente informados antes do aceite. Nenhuma cobrança de assinatura será efetuada fora das condições previamente apresentadas e autorizadas.","3.3. A cobrança poderá ocorrer por provedor externo habilitado, inclusive InfinitePay, conforme meio efetivamente selecionado. A disponibilização de link de checkout ou retorno ao site não comprova, por si só, a quitação; prevalece a confirmação confiável e conciliada do pagamento.","3.4. Renovação, periodicidade, reajuste e alterações de preço observarão as condições destacadas no momento da contratação, comunicação prévia adequada e a legislação aplicável. Cobranças já concluídas não serão modificadas retroativamente por mudança posterior de tabela."]},{"title":"CLÁUSULA 4 — VIGÊNCIA, RENOVAÇÃO, CANCELAMENTO E INADIMPLÊNCIA","paragraphs":["4.1. A vigência inicia-se na data definida no quadro-resumo, condicionada às etapas de assinatura, verificação cadastral e pagamento quando exigidas. A periodicidade é a expressamente contratada.","4.2. O CONTRATANTE poderá solicitar cancelamento pelos canais e pela área de assinatura disponibilizados no PISTEC. A data de encerramento e eventual cobrança remanescente deverão seguir as condições claramente informadas no ANEXO I e as normas aplicáveis, vedadas penalidades ou restrições incompatíveis com a lei.","4.3. Em caso de inadimplência, a CONTRATADA poderá emitir avisos e aplicar medidas de restrição ou suspensão proporcional, após as notificações e prazos previstos no ANEXO I e na legislação aplicável. A suspensão não autoriza eliminação automática de dados.","4.4. Direitos legais de desistência, arrependimento, cancelamento e restituição, quando incidentes na relação concreta, prevalecem sobre cláusulas incompatíveis deste instrumento."]},{"title":"CLÁUSULA 5 — CONTA, USUÁRIOS E RESPONSABILIDADES OPERACIONAIS","paragraphs":["5.1. O CONTRATANTE responderá pelo cadastro correto da empresa, pelas permissões atribuídas aos seus usuários, pela guarda de credenciais, pelos dados e documentos inseridos e pela licitude das suas operações comerciais e comunicações.","5.2. O CONTRATANTE compromete-se a não compartilhar credenciais indevidamente, não tentar acessar dados de outras empresas e não utilizar a Plataforma para finalidades ilícitas, abusivas ou incompatíveis com seus termos.","5.3. A CONTRATADA deverá fornecer funcionalidades e mecanismos de segurança compatíveis com a prestação contratada, incluindo controles de autenticação, autorização e segregação de empresas, observados os limites técnicos e obrigações legais."]},{"title":"CLÁUSULA 6 — DISPONIBILIDADE, SUPORTE E ATUALIZAÇÕES","paragraphs":["6.1. O serviço será disponibilizado por acesso à internet, sujeito a manutenção, falhas de conexão, indisponibilidades de infraestrutura e serviços de terceiros. Níveis de serviço, horários de atendimento e canais de suporte somente serão vinculantes quando publicados e expressamente incorporados ao ANEXO I.","6.2. Atualizações, correções de segurança e evoluções de interface poderão ser implementadas para continuidade e proteção do serviço, respeitando a finalidade contratada e comunicação razoável de mudanças substanciais.","6.3. O uso de PWA depende de recursos do dispositivo e navegador. A instalação ou recebimento de notificações push não é garantido em toda plataforma, versão ou condição de rede."]},{"title":"CLÁUSULA 7 — DADOS, LGPD E CONFIDENCIALIDADE","paragraphs":["7.1. Em regra, o CONTRATANTE determina as finalidades do tratamento dos dados de seus clientes, empregados e operações inseridos no ERP, cabendo à CONTRATADA tratar tais informações para prestação do serviço, segundo instruções documentadas e obrigações legais. Os papéis efetivos de controlador e operador dependem das atividades concretas, conforme ANEXO II.","7.2. Para dados cadastrais da própria contratação, faturamento, segurança e gestão da plataforma, a CONTRATADA poderá atuar como controladora, conforme política de privacidade e bases legais aplicáveis.","7.3. As partes deverão adotar medidas técnicas e administrativas proporcionais de segurança, confidencialidade, controle de acesso, registro de incidentes, gestão de prestadores e cooperação no atendimento de direitos dos titulares, conforme LGPD.","7.4. Serviços terceirizados e eventuais transferências internacionais relevantes serão informados conforme obrigações legais, políticas aplicáveis e instrumentos pertinentes."]},{"title":"CLÁUSULA 8 — TITULARIDADE, ACESSO E DESTINAÇÃO DOS DADOS","paragraphs":["8.1. Os dados operacionais inseridos pelo CONTRATANTE permanecem sob sua esfera de controle, sem que a assinatura atribua à CONTRATADA propriedade comercial sobre os respectivos cadastros, documentos e registros empresariais.","8.2. Durante a vigência e pelo prazo de exportação definido no ANEXO I, o CONTRATANTE poderá utilizar os mecanismos disponíveis para obter seus dados em formatos documentados, observados requisitos de segurança, integridade e responsabilidades legais.","8.3. Depois do término, a retenção, exclusão, anonimização e conservação de cópias ocorrerão conforme o ANEXO II, a política de privacidade, obrigações legais e prazos expressamente informados. Não haverá promessa genérica de retenção ilimitada nem exclusão imediata incompatível com dever legal."]},{"title":"CLÁUSULA 9 — INTEGRAÇÕES, WHATSAPP, E-MAIL E INTELIGÊNCIA ARTIFICIAL","paragraphs":["9.1. As integrações com InfinitePay, Resend, Evolution API, Gemini e outros provedores estão sujeitas a disponibilidade, credenciamento, configuração, políticas técnicas, custos e limites específicos de cada serviço, quando expressamente contratadas.","9.2. O CONTRATANTE é responsável pela base legal para comunicações com seus clientes e pela conformidade do conteúdo enviado por e-mail, WhatsApp ou notificações. A CONTRATADA poderá adotar limites e medidas para prevenir abuso, spam e incidentes.","9.3. Recursos de IA poderão produzir respostas inexatas; devem ser supervisionados por pessoas autorizadas, especialmente em decisões comerciais, técnicas, financeiras, jurídicas, tributárias ou de segurança. A IA não substitui julgamento profissional nem garante exatidão de respostas."]},{"title":"CLÁUSULA 10 — PROPRIEDADE INTELECTUAL","paragraphs":["10.1. O software, código, interface, marcas, materiais e documentação próprios da CONTRATADA ou de seus licenciadores permanecem protegidos pela legislação aplicável. A contratação não transfere titularidade sobre o PISTEC.","10.2. Logotipos, marcas e conteúdos enviados pelo CONTRATANTE continuam sob sua responsabilidade e titularidade, autorizando-se seu tratamento e exibição somente na medida necessária para personalização e execução do serviço."]},{"title":"CLÁUSULA 11 — RESPONSABILIDADES E LIMITAÇÕES","paragraphs":["11.1. Cada parte responde por suas condutas, obrigações e danos nos termos da legislação aplicável. A CONTRATADA não garante resultados comerciais específicos, crescimento de receita, ausência absoluta de falhas nem funcionamento universal de equipamentos e integrações externas.","11.2. Nenhuma previsão deste instrumento afasta responsabilidade legal por dolo, culpa nas hipóteses legalmente aplicáveis, violação de direitos de titulares, obrigações inderrogáveis ou outros direitos que não possam ser excluídos contratualmente."]},{"title":"CLÁUSULA 12 — ALTERAÇÕES CONTRATUAIS E COMUNICAÇÕES","paragraphs":["12.1. Alterações substanciais das condições contratadas serão comunicadas pelos canais informados no cadastro, observado prazo adequado, registro da versão e, quando juridicamente necessário, novo aceite expresso.","12.2. E-mails e notificações no painel poderão ser usados para avisos contratuais conforme regras informadas e comprováveis. O CONTRATANTE manterá seus dados de contato atualizados."]},{"title":"CLÁUSULA 13 — ASSINATURA ELETRÔNICA E PROVA","paragraphs":["13.1. As partes concordam com a celebração eletrônica deste instrumento por mecanismo que permita identificar signatários, registrar manifestação de vontade, preservar a integridade documental e disponibilizar evidências verificáveis, observada a legislação brasileira pertinente.","13.2. O documento final deverá conter ou vincular seu identificador único, versão, hash de integridade, identificação dos signatários, datas e horários, meio de autenticação, trilha de auditoria e certificado de conclusão emitido pelo provedor, quando utilizado.","13.3. O simples preenchimento do formulário, seleção do plano, geração de PDF ou marcação de caixa de ciência não deverá ser apresentado como assinatura completa antes da confirmação do método de assinatura adotado."]},{"title":"CLÁUSULA 14 — DISPOSIÇÕES GERAIS E FORO","paragraphs":["14.1. Este contrato, o quadro-resumo e os Anexos I e II formam um conjunto integrado; em divergência sobre condições individuais de preço, prazo ou limites, prevalecem as condições específicas aceitas e registradas, salvo norma legal cogente.","14.2. Para relações empresariais em que a eleição de foro seja válida, as partes elegem o foro da Comarca de São Paulo/SP, vinculado ao domicílio da CONTRATADA e à presente contratação, ressalvadas regras legais de competência e de proteção do consumidor que sejam aplicáveis."]},{"title":"ANEXO I — CONDIÇÕES COMERCIAIS E RECURSOS CONTRATADOS","paragraphs":["Plano: {{plano_nome}} — ID/versionamento: {{plano_id}} / {{plano_versao}}.","Periodicidade: {{periodicidade}}; início: {{data_inicio}}; vencimento: {{data_proximo_vencimento}}.","Preço base: {{preco_base}}; desconto válido: {{cupom_aplicado}}; total contratado: {{valor_total_contratado}}.","Renovação: {{regra_renovacao}}; cancelamento: {{regra_cancelamento}}; aviso de reajuste: {{regra_reajuste}}.","Teste gratuito: {{dias_teste}} e condições {{condicoes_teste}}.","Tolerância e suspensão por inadimplência: {{prazo_tolerancia}} e {{procedimento_notificacao}}.","Disponibilidade/SLA e suporte, se contratados: {{condicoes_suporte_sla}}.","Prazo e formato para exportação após encerramento: {{prazo_exportacao}} / {{formatos_exportacao}}.","Funcionalidades/limites habilitados: {{snapshot_recursos_entitlements}}.","Integrações opcionais, seus custos e condições: {{integracoes_contratadas}}."]},{"title":"ANEXO II — TRATAMENTO DE DADOS E SEGURANÇA (RESUMO OPERACIONAL)","paragraphs":["Finalidades e categorias de dados: cadastros empresariais, usuários, produtos, vendas, serviços, clientes, veículos e comunicações operacionais efetivamente utilizadas.","Papéis das partes: definidos por atividade. O CONTRATANTE normalmente controla dados operacionais de seus clientes; a CONTRATADA presta tratamento técnico necessário e controla dados da própria relação contratual.","Prestadores/suboperadores: categorias de hospedagem, comunicação, pagamentos, IA e suporte, apenas quando efetivamente ativadas e com instrumentos adequados.","Medidas: autenticação, autorização por empresa, segregação de dados, registros de auditoria, backup, gestão de acessos e incidentes, conforme implementação contratada e documentação aplicável.","Cooperação: tratamento de solicitações de titulares, incidentes, exportação e exclusão conforme legislação, contrato e processo documentado.","Prazos de retenção: {{politica_retencao_versao}} / {{prazo_exportacao}}, sujeitos a obrigações legais de guarda."]}],"signatureTitle":"ASSINATURAS ELETRÔNICAS","signatureBlock":["CONTRATADA: {{contratada_nome}}  |  CNPJ {{contratada_cnpj}}","Signatário autorizado: {{signatario_contratada_nome}}  |  Meio/registro: {{assinatura_contratada_referencia}}","CONTRATANTE: {{empresa_razao_social}}  |  {{empresa_documento}}","Representante: {{representante_nome}}  |  CPF: {{representante_cpf}}  |  Meio/registro: {{assinatura_cliente_referencia}}","Data e hora da conclusão: {{data_hora_conclusao}}  |  Hash do PDF: {{sha256_documento}}","Identificador de verificação e certificado de assinatura: {{url_verificacao_documento}}"]}$minuta$::jsonb, 'docs/contracts/PISTEC_Minuta_Contrato_SaaS_2026.docx', '5932323f5f535594fefdffe1dc5194cbb51ba4a05f72f44a3ceac740bad479d0', 'draft',
  'MINUTA • sujeita à revisão jurídica e validação das condições comerciais antes da publicação')
on conflict (code) do nothing;

-- ---------------------------------------------------------------- Storage privado
do $$ begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values ('contracts', 'contracts', false, 20971520, array['application/pdf'])
    on conflict (id) do update set public = false;
  end if;
end $$;

revoke all on function public.prepare_contract(uuid, jsonb), public.contract_detail(uuid), public.cancel_contract(uuid, text), public.contract_invoice(uuid), public.contract_for_signing(uuid),
  public.admin_save_provider_profile(jsonb, text), public.admin_contract_version(text, uuid, jsonb, text), public.admin_set_contract_roles(text, text[]), public.admin_contract_metrics(),
  public.svc_contract_sent(uuid, text, text, text, jsonb), public.svc_contract_failed(uuid, text), public.svc_contract_apply(text, text, text, jsonb, text), public.svc_contract_complete(text, text, text, text), public.svc_contract_expire() from public, anon;
grant execute on function public.prepare_contract(uuid, jsonb), public.contract_detail(uuid), public.cancel_contract(uuid, text), public.contract_invoice(uuid), public.contract_for_signing(uuid),
  public.admin_save_provider_profile(jsonb, text), public.admin_contract_version(text, uuid, jsonb, text), public.admin_set_contract_roles(text, text[]), public.admin_contract_metrics() to authenticated;
revoke all on function public.svc_contract_sent(uuid, text, text, text, jsonb), public.svc_contract_failed(uuid, text), public.svc_contract_apply(text, text, text, jsonb, text), public.svc_contract_complete(text, text, text, text), public.svc_contract_expire() from authenticated;
grant execute on function public.svc_contract_sent(uuid, text, text, text, jsonb), public.svc_contract_failed(uuid, text), public.svc_contract_apply(text, text, text, jsonb, text), public.svc_contract_complete(text, text, text, text), public.svc_contract_expire() to service_role;
revoke all on function app.contract_reader(uuid), app.contract_role(text), app.contract_number(), app.valid_cpf(text), app.valid_cnpj(text) from public, anon, authenticated;
grant execute on function app.contract_reader(uuid), app.contract_role(text) to authenticated; -- usadas nas políticas RLS; respondem só sobre o próprio usuário

-- ---------------------------------------------------------------- correção de segurança (Print & Documents 6.0)
-- Antes: "(membership).role not in (...)" vira NULL para quem não é membro e a checagem passava,
-- permitindo apagar perfil de impressora de outra empresa conhecendo os identificadores. Agora exige membership.
create or replace function public.delete_printer_profile(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not coalesce((app.membership(p_tenant)).role in ('Proprietário', 'Administrador', 'Gerente'), false) then perform app.fail('Somente proprietário, administrador ou gerente configura impressoras.', '42501'); end if;
  delete from public.printer_profiles where tenant_id = p_tenant and id = p_id;
  perform app.audit(p_tenant, 'Impressora removida', 'printer', p_id::text);
end $$;
