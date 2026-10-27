-- Print & Documents 6.0 — documentos emitidos no SERVIDOR a partir dos registros reais (snapshot congelado),
-- versões, vias, impressoras/papéis por empresa/filial/estação, links seguros, envio por e-mail/WhatsApp e histórico.
-- Nada aqui é documento fiscal. Nenhuma tabela existente é alterada de forma destrutiva.

-- ---------------------------------------------------------------- identidade (contato) da filial
alter table public.branches add column if not exists document text not null default '', add column if not exists address text not null default '', add column if not exists phone text not null default '';

-- ---------------------------------------------------------------- preferências de documentos por empresa
create table public.document_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  texts jsonb not null default '{}',
  style text not null default 'elite' check (style in ('elite', 'minimal', 'commercial', 'workshop')),
  accent text not null default '' check (accent = '' or accent ~ '^#[0-9a-fA-F]{6}$'),
  logo_size integer not null default 18 check (logo_size between 8 and 40),
  align text not null default 'left' check (align in ('left', 'center')),
  papers jsonb not null default '{}',   -- tipo de documento → papel padrão
  messages jsonb not null default '{}', -- tipo de documento → texto da mensagem (WhatsApp/e-mail)
  updated_at timestamptz not null default now()
);

create table public.printer_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid,
  station text not null default '' check (length(station) <= 60), -- '' = qualquer estação desta filial
  name text not null check (length(btrim(name)) between 1 and 60),
  kind text not null check (kind in ('common', 'thermal', 'label', 'network')),
  method text not null default 'browser' check (method in ('browser', 'connector')),
  protocol text not null default 'none' check (protocol in ('none', 'escpos', 'zpl', 'tspl', 'epl')),
  device text not null default '' check (length(device) <= 120), -- nome no sistema/conector (informativo)
  model text not null default '' check (length(model) <= 80),
  paper_id text not null check (paper_id ~ '^[a-z0-9-]{2,40}$'),
  custom jsonb not null default '{}',
  calibration jsonb not null default '{}',
  doc_types text[] not null default '{}',
  copies integer not null default 1 check (copies between 1 and 10),
  is_default boolean not null default false,
  test_result text not null default '' check (length(test_result) <= 40),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete cascade
);
create index on public.printer_profiles (tenant_id, branch_id);

create table public.document_counters (tenant_id uuid primary key references public.tenants(id) on delete cascade, next bigint not null default 1);

create table public.generated_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  branch_id uuid,
  type text not null,
  source_id text not null, -- id do registro de origem ('' só para página de teste)
  number text not null,
  version integer not null,
  content_hash text not null,
  snapshot jsonb not null,
  copies integer not null default 0, -- impressões registradas (1ª via + reimpressões)
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (tenant_id, type, source_id, version)
);
create index on public.generated_documents (tenant_id, created_at desc);

create table public.document_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.generated_documents(id) on delete cascade,
  kind text not null check (kind in ('print', 'reprint', 'pdf', 'email', 'whatsapp', 'link', 'revoke')),
  status text not null check (status in ('prepared', 'sent_to_browser', 'sent_to_connector', 'error', 'cancelled', 'pending', 'processing', 'accepted', 'delivered', 'failed', 'expired', 'done')),
  method text not null default '',
  printer_id uuid references public.printer_profiles(id) on delete set null,
  recipient text not null default '', -- mascarado
  email_id uuid,
  provider_id text,
  error text,
  idempotency_key text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, idempotency_key)
);
create index on public.document_events (tenant_id, created_at desc);

create table public.document_share_tokens (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  document_id uuid not null references public.generated_documents(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  views integer not null default 0,
  last_view_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $$ declare t text; begin
  foreach t in array array['document_settings', 'printer_profiles', 'document_counters', 'generated_documents', 'document_events', 'document_share_tokens'] loop
    execute format('alter table public.%I enable row level security', t); execute format('alter table public.%I force row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
  end loop;
end $$;
grant select on public.document_settings, public.printer_profiles, public.generated_documents, public.document_events, public.document_share_tokens to authenticated;

-- ---------------------------------------------------------------- tipos → módulo (permissão) e prefixo do número
create or replace function app.doc_module(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_type in ('sale', 'payment', 'sale-cancel') then 'vendas' when p_type = 'cart' then 'pdv' when p_type = 'quote' then 'orcamentos'
    when p_type in ('os-entry', 'os-diagnosis', 'os-progress', 'os-done', 'os-delivery', 'warranty', 'checklist-in', 'checklist-out', 'pick-list') then 'ordens-servico'
    when p_type in ('purchase-order', 'purchase-receipt') then 'compras' when p_type = 'cash' then 'caixa' when p_type in ('settlement', 'statement') then 'financeiro'
    when p_type = 'inventory' then 'estoque' when p_type = 'test' then 'dashboard' end
$$;
create or replace function app.doc_prefix(p_type text) returns text
language sql immutable set search_path = '' as $$
  select case p_type when 'sale' then 'VEN' when 'payment' then 'PAG' when 'sale-cancel' then 'CAN' when 'cart' then 'CAR' when 'quote' then 'ORC'
    when 'warranty' then 'GAR' when 'checklist-in' then 'CHK' when 'checklist-out' then 'CHK' when 'pick-list' then 'REQ' when 'purchase-order' then 'PED'
    when 'purchase-receipt' then 'REC' when 'cash' then 'CX' when 'settlement' then 'RCB' when 'statement' then 'EXT' when 'inventory' then 'INV' when 'test' then 'TST'
    else 'OS' end
$$;

create policy document_settings_read on public.document_settings for select to authenticated using (app.is_member(tenant_id));
create policy printer_profiles_read on public.printer_profiles for select to authenticated using (app.is_member(tenant_id) and (branch_id is null or app.can_branch(tenant_id, branch_id)));
create policy generated_documents_read on public.generated_documents for select to authenticated using (app.can_read(tenant_id, app.doc_module(type), branch_id));
create policy document_events_read on public.document_events for select to authenticated using (exists (select 1 from public.generated_documents d where d.id = document_id and app.can_read(d.tenant_id, app.doc_module(d.type), d.branch_id)));
create policy document_share_tokens_read on public.document_share_tokens for select to authenticated using (exists (select 1 from public.generated_documents d where d.id = document_id and app.can_read(d.tenant_id, app.doc_module(d.type), d.branch_id)));

-- ---------------------------------------------------------------- snapshot a partir dos dados reais
create or replace function app.doc_lines(p_tenant uuid, p_items jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('name', x ->> 'name', 'quantity', (x ->> 'quantity')::int, 'price', coalesce((x ->> 'price')::bigint, 0),
    'sku', (select p.sku from public.products p where p.tenant_id = p_tenant and p.id::text = x ->> 'productId'))), '[]')
  from jsonb_array_elements(coalesce(p_items, '[]')) x
$$;
create or replace function app.doc_person(p_tenant uuid, p_customer uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('name', c.name, 'phone', c.phone, 'email', c.email, 'document', c.document) from public.customers c where c.tenant_id = p_tenant and c.id = p_customer
$$;

/** Retorna { branch, body } — body = dados do negócio (entram no hash); identidade é anexada à parte. */
create or replace function app.doc_body(p_tenant uuid, p_type text, p_source text) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.sales; r public.records; c public.cash_registers; e public.financial_entries; st public.settlements; v_branch uuid; body jsonb; v_kind text; veh public.records; sup public.records;
begin
  if p_type in ('sale', 'payment', 'sale-cancel') then
    select * into s from public.sales where tenant_id = p_tenant and id = app.uuid_or_null(p_source);
    if s.id is null then perform app.fail('Venda não encontrada.'); end if;
    if p_type = 'sale-cancel' and s.status <> 'Cancelada' then perform app.fail('Esta venda não está cancelada.'); end if;
    v_branch := s.branch_id;
    body := jsonb_build_object('customer', app.doc_person(p_tenant, s.customer_id), 'operator', s.seller, 'sale', jsonb_build_object('id', s.id, 'date', s.created_at, 'seller', s.seller, 'status', s.status,
      'discount', s.discount, 'surcharge', s.surcharge, 'total', s.total, 'change', s.change, 'cancelledAt', s.cancelled_at, 'cancelReason', null,
      'items', (select coalesce(jsonb_agg(jsonb_build_object('name', i.name, 'quantity', i.quantity, 'price', i.price, 'sku', p.sku) order by i.name), '[]') from public.sale_items i left join public.products p on p.tenant_id = i.tenant_id and p.id = i.product_id where i.sale_id = s.id),
      'payments', (select coalesce(jsonb_agg(jsonb_build_object('method', x.method, 'amount', x.amount, 'tendered', x.tendered) order by x.position), '[]') from public.sale_payments x where x.sale_id = s.id)));
  elsif p_type in ('cart', 'quote', 'os-entry', 'os-diagnosis', 'os-progress', 'os-done', 'os-delivery', 'warranty', 'checklist-in', 'checklist-out', 'pick-list', 'purchase-order', 'purchase-receipt') then
    v_kind := case when p_type = 'cart' then 'cart' when p_type = 'quote' then 'orcamentos' when p_type like 'purchase-%' then 'compras' else 'ordens-servico' end;
    select * into r from public.records where tenant_id = p_tenant and id = app.uuid_or_null(p_source) and kind = v_kind;
    if r.id is null then perform app.fail('Registro de origem não encontrado.'); end if;
    v_branch := r.branch_id;
    select * into veh from public.records where tenant_id = p_tenant and kind = 'veiculos' and id = app.uuid_or_null(r.fields ->> 'vehicleId');
    select * into sup from public.records where tenant_id = p_tenant and kind = 'fornecedores' and id = app.uuid_or_null(r.fields ->> 'supplierId');
    body := jsonb_build_object('customer', app.doc_person(p_tenant, r.customer_id),
      'vehicle', case when veh.id is null then null else jsonb_build_object('title', veh.title, 'plate', veh.fields ->> 'plate', 'brand', veh.fields ->> 'brand', 'model', veh.fields ->> 'model', 'year', veh.fields ->> 'year', 'color', veh.fields ->> 'color', 'mileage', coalesce(r.fields ->> 'mileage', veh.fields ->> 'mileage')) end,
      'supplier', case when sup.id is null then null else jsonb_build_object('name', sup.title, 'phone', sup.fields ->> 'phone', 'email', sup.fields ->> 'email', 'document', sup.fields ->> 'document') end,
      'operator', (select nullif(p.name, '') from public.profiles p where p.user_id = auth.uid()),
      'record', jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'status', r.status, 'date', r.date, 'amount', r.amount, 'fields', r.fields - 'stockState', 'items', app.doc_lines(p_tenant, r.items),
        'history', (select coalesce(jsonb_agg(h), '[]') from (select h from jsonb_array_elements(r.history) h offset greatest(jsonb_array_length(r.history) - 12, 0)) x)));
  elsif p_type = 'cash' then
    select * into c from public.cash_registers where tenant_id = p_tenant and id = app.uuid_or_null(p_source);
    if c.id is null then perform app.fail('Caixa não encontrado.'); end if;
    v_branch := c.branch_id;
    body := jsonb_build_object('cash', jsonb_build_object('id', c.id, 'openedAt', c.opened_at, 'closedAt', c.closed_at, 'opening', c.opening, 'expected', c.expected, 'counted', c.counted, 'difference', c.difference, 'reason', c.closing_reason, 'closedBy', c.closed_by,
      'movements', (select coalesce(jsonb_agg(jsonb_build_object('amount', m.amount, 'reason', m.reason, 'date', m.created_at) order by m.created_at), '[]') from public.cash_movements m where m.cash_id = c.id)));
  elsif p_type in ('settlement', 'statement') then
    if p_type = 'settlement' then
      select * into st from public.settlements where tenant_id = p_tenant and id = app.uuid_or_null(p_source);
      if st.id is null then perform app.fail('Baixa não encontrada.'); end if;
      select * into e from public.financial_entries where tenant_id = p_tenant and id = st.entry_id;
    else select * into e from public.financial_entries where tenant_id = p_tenant and id = app.uuid_or_null(p_source); end if;
    if e.id is null then perform app.fail('Lançamento não encontrado.'); end if;
    v_branch := e.branch_id;
    body := jsonb_build_object('entry', jsonb_build_object('id', e.id, 'type', e.type, 'category', e.category, 'description', e.description, 'amount', e.amount, 'dueDate', e.due_date, 'cancelled', e.cancelled, 'settlementId', st.id,
      'settlements', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'amount', x.amount, 'date', x.date, 'method', x.method, 'user', x.user_name, 'note', x.note, 'reversedAt', x.reversed_at, 'reversalReason', x.reversal_reason) order by x.created_at), '[]') from public.settlements x where x.entry_id = e.id)));
  elsif p_type = 'inventory' then
    v_branch := app.uuid_or_null(p_source);
    if not exists (select 1 from public.branches where tenant_id = p_tenant and id = v_branch) then perform app.fail('Filial inválida.'); end if;
    body := jsonb_build_object('stock', jsonb_build_object('rows', (select coalesce(jsonb_agg(jsonb_build_object('sku', p.sku, 'name', p.name, 'location', p.location, 'quantity', coalesce(b.quantity, 0), 'reserved', coalesce(b.reserved, 0)) order by p.location, p.name), '[]')
      from public.products p left join public.stock_balances b on b.tenant_id = p.tenant_id and b.product_id = p.id and b.branch_id = v_branch where p.tenant_id = p_tenant and p.active)));
  elsif p_type = 'test' then body := '{}';
  else perform app.fail('Tipo de documento inválido.'); end if;
  return jsonb_build_object('branch', v_branch, 'body', body);
end $$;

create or replace function app.doc_identity(p_tenant uuid, p_branch uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'company', jsonb_build_object('name', t.name, 'legalName', t.legal_name, 'document', t.document, 'address', t.address, 'phone', t.phone, 'whatsapp', t.whatsapp, 'email', t.email, 'website', t.website, 'logo', coalesce(t.branding ->> 'logo', '')),
    'branch', coalesce((select jsonb_build_object('name', b.name, 'document', b.document, 'address', b.address, 'phone', b.phone) from public.branches b where b.tenant_id = p_tenant and b.id = p_branch), jsonb_build_object('name', '', 'document', '', 'address', '', 'phone', '')),
    'texts', jsonb_build_object('header', '', 'footer', coalesce(t.branding ->> 'footer', ''), 'thanks', 'Obrigado pela preferência!', 'warranty', '', 'quoteTerms', 'Valores sujeitos à disponibilidade de estoque na aprovação.',
      'osTerms', 'Autorizo a avaliação do veículo. Serviços só serão executados após aprovação do orçamento.', 'deliveryTerms', '') || coalesce((select s.texts from public.document_settings s where s.tenant_id = p_tenant), '{}'),
    'style', coalesce((select jsonb_build_object('style', s.style, 'accent', s.accent, 'logoSize', s.logo_size, 'align', s.align) from public.document_settings s where s.tenant_id = p_tenant), '{}'))
  from public.tenants t where t.id = p_tenant
$$;

/** Emite (ou reaproveita) o documento. Mesmo conteúdo de negócio = mesma versão (idempotente).
    Identidade (logo, endereço, textos) fica congelada na versão emitida; uma versão nova só nasce se os DADOS mudarem
    — e documentos de venda mantêm sempre a identidade da 1ª emissão. */
create or replace function app.issue_document(p_tenant uuid, p_type text, p_source text) returns public.generated_documents
language plpgsql security definer set search_path = '' as $$
declare b jsonb := app.doc_body(p_tenant, p_type, coalesce(p_source, '')); v_hash text := md5((b -> 'body')::text); last public.generated_documents; first public.generated_documents;
  ident jsonb; v_number text; v_seq bigint; out public.generated_documents;
begin
  perform pg_advisory_xact_lock(hashtextextended('doc:' || p_tenant || ':' || p_type || ':' || coalesce(p_source, ''), 0));
  select * into last from public.generated_documents where tenant_id = p_tenant and type = p_type and source_id = coalesce(p_source, '') order by version desc limit 1;
  if last.id is not null and last.content_hash = v_hash then return last; end if;
  select * into first from public.generated_documents where tenant_id = p_tenant and type = p_type and source_id = coalesce(p_source, '') and version = 1;
  ident := case when first.id is not null and p_type in ('sale', 'payment', 'sale-cancel') then jsonb_build_object('company', first.snapshot -> 'company', 'branch', first.snapshot -> 'branch', 'texts', first.snapshot -> 'texts', 'style', first.snapshot -> 'style')
    else app.doc_identity(p_tenant, (b ->> 'branch')::uuid) end;
  if last.id is null then
    insert into public.document_counters as c (tenant_id) values (p_tenant) on conflict (tenant_id) do update set next = c.next + 1 returning c.next into v_seq;
    v_number := app.doc_prefix(p_type) || '-' || lpad(v_seq::text, 6, '0');
  else v_number := last.number; end if;
  insert into public.generated_documents (tenant_id, branch_id, type, source_id, number, version, content_hash, snapshot, created_by)
  values (p_tenant, (b ->> 'branch')::uuid, p_type, coalesce(p_source, ''), v_number, coalesce(last.version, 0) + 1, v_hash,
    (b -> 'body') || ident || jsonb_build_object('type', p_type, 'number', v_number, 'issuedAt', now(), 'version', coalesce(last.version, 0) + 1, 'copy', 1), auth.uid())
  returning * into out;
  return out;
end $$;

create or replace function public.issue_document(p_tenant uuid, p_type text, p_source text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_mod text := app.doc_module(p_type); b jsonb; d public.generated_documents;
begin
  if v_mod is null then perform app.fail('Tipo de documento inválido.'); end if;
  b := app.doc_body(p_tenant, p_type, coalesce(p_source, ''));
  perform app.require(p_tenant, v_mod, 'visualizar', (b ->> 'branch')::uuid);
  d := app.issue_document(p_tenant, p_type, p_source);
  return jsonb_build_object('id', d.id, 'number', d.number, 'version', d.version, 'copies', d.copies, 'snapshot', d.snapshot);
end $$;

-- Venda concluída → comprovante emitido na mesma transação (trigger diferido: itens e pagamentos já gravados).
create or replace function app.sale_document_trigger() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  -- Falha ao emitir o comprovante nunca desfaz a venda: o documento é emitido depois, ao abrir/imprimir.
  begin perform app.issue_document(new.tenant_id, 'sale', new.id::text); exception when others then null; end;
  return null;
end $$;
create constraint trigger sales_issue_document after insert on public.sales deferrable initially deferred for each row execute function app.sale_document_trigger();

-- ---------------------------------------------------------------- impressão (vias) e eventos
create or replace function app.doc_for(p_tenant uuid, p_document uuid, p_action text) returns public.generated_documents
language plpgsql stable security definer set search_path = '' as $$
declare d public.generated_documents;
begin
  select * into d from public.generated_documents where tenant_id = p_tenant and id = p_document;
  if d.id is null then perform app.fail('Documento não encontrado.'); end if;
  perform app.require(p_tenant, app.doc_module(d.type), 'visualizar', d.branch_id);
  if p_action = 'send' and not (app.role_can((app.membership(p_tenant)).role, app.doc_module(d.type), 'cadastrar') or app.role_can((app.membership(p_tenant)).role, 'pdv', 'cadastrar') and d.type in ('sale', 'payment')) then
    perform app.fail('Seu perfil não permite enviar este documento.', '42501');
  end if;
  return d;
end $$;

/** Registra impressão/PDF. Retorna o número da via: 1 na primeira impressão; ≥2 = reimpressão (marcada no documento). */
create or replace function public.record_document_print(p_tenant uuid, p_document uuid, p_kind text, p_method text, p_printer uuid, p_key text) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.generated_documents := app.doc_for(p_tenant, p_document, 'view'); ev public.document_events; v_copy integer;
begin
  if p_kind not in ('print', 'pdf') or p_method not in ('browser', 'connector') then perform app.fail('Operação de impressão inválida.'); end if;
  if p_key is null or length(p_key) not between 8 and 100 then perform app.fail('Chave da operação inválida.'); end if;
  if p_printer is not null and not exists (select 1 from public.printer_profiles where tenant_id = p_tenant and id = p_printer) then perform app.fail('Impressora não pertence a esta empresa.'); end if;
  select * into ev from public.document_events where tenant_id = p_tenant and idempotency_key = p_key;
  if ev.id is not null then return (select copies from public.generated_documents where id = d.id); end if;
  if p_kind = 'print' then update public.generated_documents set copies = copies + 1 where id = d.id returning copies into v_copy; else v_copy := greatest(d.copies, 1); end if;
  insert into public.document_events (tenant_id, document_id, kind, status, method, printer_id, idempotency_key, created_by)
  values (p_tenant, d.id, case when p_kind = 'print' and v_copy > 1 then 'reprint' else p_kind end, case when p_kind = 'pdf' then 'done' when p_method = 'connector' then 'sent_to_connector' else 'sent_to_browser' end, p_method, p_printer, p_key, auth.uid());
  if v_copy > 1 and p_kind = 'print' then perform app.audit(p_tenant, format('Reimpressão (%sª via) de %s', v_copy, d.number), 'document', d.id::text); end if;
  return v_copy;
end $$;

create or replace function public.update_print_status(p_tenant uuid, p_key text, p_status text, p_error text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('error', 'cancelled', 'sent_to_connector') then perform app.fail('Situação inválida.'); end if;
  update public.document_events e set status = p_status, error = left(p_error, 200), updated_at = now()
  where e.tenant_id = p_tenant and e.idempotency_key = p_key and e.kind in ('print', 'reprint') and e.created_by = auth.uid();
end $$;

-- ---------------------------------------------------------------- links seguros (token aleatório; só o hash fica no banco)
create or replace function app.new_doc_link(p_tenant uuid, p_document uuid, p_days integer) returns text
language plpgsql security definer set search_path = '' as $$
declare v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if p_days is null or p_days not between 1 and 30 then perform app.fail('Validade do link entre 1 e 30 dias.'); end if;
  insert into public.document_share_tokens (tenant_id, document_id, token_hash, expires_at, created_by) values (p_tenant, p_document, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => p_days), auth.uid());
  return v_token;
end $$;

create or replace function public.create_document_link(p_tenant uuid, p_document uuid, p_days integer default 7) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.generated_documents := app.doc_for(p_tenant, p_document, 'send'); v_token text := app.new_doc_link(p_tenant, d.id, p_days);
begin
  insert into public.document_events (tenant_id, document_id, kind, status, idempotency_key, created_by) values (p_tenant, d.id, 'link', 'done', 'link:' || gen_random_uuid(), auth.uid());
  perform app.audit(p_tenant, format('Link de consulta criado para %s (%s dias)', d.number, p_days), 'document', d.id::text);
  return jsonb_build_object('token', v_token, 'expiresAt', now() + make_interval(days => p_days));
end $$;

create or replace function public.revoke_document_links(p_tenant uuid, p_document uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare d public.generated_documents := app.doc_for(p_tenant, p_document, 'send'); n integer;
begin
  update public.document_share_tokens set revoked_at = now() where tenant_id = p_tenant and document_id = d.id and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  insert into public.document_events (tenant_id, document_id, kind, status, idempotency_key, created_by) values (p_tenant, d.id, 'revoke', 'done', 'revoke:' || gen_random_uuid(), auth.uid());
  perform app.audit(p_tenant, format('Links de %s revogados (%s)', d.number, n), 'document', d.id::text);
  return n;
end $$;

/** Consulta pública pelo token: só o snapshot daquele documento, se válido. 60 aberturas/hora por token. */
create or replace function public.document_public(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.document_share_tokens; d public.generated_documents;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into t from public.document_share_tokens where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if t.id is null or t.revoked_at is not null or t.expires_at < now() then return null; end if;
  if t.last_view_at > now() - interval '1 hour' and t.views >= 60 then return null; end if;
  update public.document_share_tokens set views = case when last_view_at < now() - interval '1 hour' then 1 else views + 1 end, last_view_at = now() where id = t.id;
  select * into d from public.generated_documents where id = t.document_id;
  return jsonb_build_object('snapshot', d.snapshot - 'customer' || jsonb_build_object('customer', case when d.snapshot -> 'customer' is null or d.snapshot -> 'customer' = 'null' then null else jsonb_build_object('name', d.snapshot -> 'customer' ->> 'name') end),
    'expiresAt', t.expires_at, 'slug', (select slug from public.tenants where id = d.tenant_id));
end $$;

-- ---------------------------------------------------------------- envio por e-mail (fila existente + Resend no worker)
create or replace function app.mask(p text) returns text
language sql immutable set search_path = '' as $$
  select case when p like '%@%' then left(split_part(p, '@', 1), 2) || '***@' || split_part(p, '@', 2) when length(p) > 4 then repeat('*', length(p) - 4) || right(p, 4) else '***' end
$$;

create or replace function public.send_document_email(p_tenant uuid, p_document uuid, p_to text, p_message text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.generated_documents := app.doc_for(p_tenant, p_document, 'send'); v_to text := lower(btrim(coalesce(p_to, ''))); ev public.document_events; v_token text; t public.tenants; v_email uuid;
begin
  if v_to !~ '^[^\s@]+@[^\s@]+\.[^\s@]{2,}$' or length(v_to) > 254 then perform app.fail('E-mail do destinatário inválido.'); end if;
  if p_key is null or length(p_key) not between 8 and 100 then perform app.fail('Chave da operação inválida.'); end if;
  select * into ev from public.document_events where tenant_id = p_tenant and idempotency_key = 'email:' || p_key;
  if ev.id is not null then return jsonb_build_object('eventId', ev.id, 'status', ev.status, 'duplicate', true); end if;
  if (select count(*) from public.document_events where tenant_id = p_tenant and kind = 'email' and created_at > now() - interval '1 hour') >= 30 then perform app.fail('Limite de 30 e-mails de documentos por hora atingido. Tente mais tarde.'); end if;
  select * into t from public.tenants where id = p_tenant;
  v_token := app.new_doc_link(p_tenant, d.id, 7);
  perform app.queue_email(p_tenant, v_to, 'document', jsonb_build_object('store', t.name, 'title', d.snapshot ->> 'type', 'number', d.number, 'token', v_token, 'message', left(coalesce(p_message, ''), 600),
    'replyTo', case when t.email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then t.email end, 'customer', d.snapshot -> 'customer' ->> 'name'), 'doc:' || p_tenant || ':' || p_key);
  select id into v_email from public.email_messages where idempotency_key = 'doc:' || p_tenant || ':' || p_key;
  insert into public.document_events (tenant_id, document_id, kind, status, recipient, email_id, idempotency_key, created_by)
  values (p_tenant, d.id, 'email', 'pending', app.mask(v_to), v_email, 'email:' || p_key, auth.uid()) returning * into ev;
  perform app.audit(p_tenant, format('E-mail de %s para %s enfileirado', d.number, app.mask(v_to)), 'document', d.id::text);
  return jsonb_build_object('eventId', ev.id, 'status', 'pending', 'duplicate', false);
end $$;

-- ---------------------------------------------------------------- WhatsApp: preparação no banco, envio pela Edge Function (Evolution)
/** Valida tudo e reserva o envio (idempotente). Exige consentimento de WhatsApp no cadastro do cliente. */
create or replace function public.prepare_document_whatsapp(p_tenant uuid, p_document uuid, p_customer uuid, p_text text, p_key text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare d public.generated_documents := app.doc_for(p_tenant, p_document, 'send'); c public.customers; v_phone text; v_instance text; ev public.document_events; v_token text;
begin
  if p_key is null or length(p_key) not between 8 and 100 then perform app.fail('Chave da operação inválida.'); end if;
  select * into ev from public.document_events where tenant_id = p_tenant and idempotency_key = 'wa:' || p_key;
  if ev.id is not null then return jsonb_build_object('eventId', ev.id, 'status', ev.status, 'duplicate', true); end if;
  select * into c from public.customers where tenant_id = p_tenant and id = p_customer;
  if c.id is null then perform app.fail('Cliente não encontrado.'); end if;
  if not c.consent then perform app.fail('O cliente não autorizou contato por WhatsApp. Registre o consentimento no cadastro antes de enviar.'); end if;
  v_phone := regexp_replace(c.phone, '\D', '', 'g');
  if length(v_phone) in (10, 11) then v_phone := '55' || v_phone; end if;
  if v_phone !~ '^55\d{10,11}$' then perform app.fail('Telefone do cliente inválido para WhatsApp (use DDD + número).'); end if;
  select instance_name into v_instance from public.whatsapp_instances where tenant_id = p_tenant and status = 'open' order by created_at limit 1;
  if v_instance is null then perform app.fail('WhatsApp da empresa não está conectado. Conecte em WhatsApp → Conectar.'); end if;
  if (select count(*) from public.document_events where tenant_id = p_tenant and kind = 'whatsapp' and created_at > now() - interval '1 hour') >= 30 then perform app.fail('Limite de 30 envios de documentos por hora atingido.'); end if;
  if length(btrim(coalesce(p_text, ''))) not between 5 and 1000 then perform app.fail('Mensagem entre 5 e 1000 caracteres.'); end if;
  v_token := app.new_doc_link(p_tenant, d.id, 7);
  insert into public.document_events (tenant_id, document_id, kind, status, recipient, idempotency_key, created_by)
  values (p_tenant, d.id, 'whatsapp', 'processing', app.mask(v_phone), 'wa:' || p_key, auth.uid()) returning * into ev;
  return jsonb_build_object('eventId', ev.id, 'duplicate', false, 'instance', v_instance, 'number', v_phone, 'token', v_token, 'text', btrim(p_text));
end $$;

create or replace function public.finish_document_event(p_event uuid, p_provider_id text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.document_events set status = case when p_error is null then 'accepted' else 'failed' end, provider_id = left(p_provider_id, 120), error = left(p_error, 200), updated_at = now()
  where id = p_event and status = 'processing'
$$;

/** Histórico com a situação real do e-mail (fila → aceito → entregue/bounce). */
create or replace function public.document_history(p_tenant uuid, p_document uuid default null, p_limit integer default 100) returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]') from (
    select e.id, e.kind, e.method, e.recipient, e.error, e.created_at, d.number, d.type, d.id document_id,
      case when e.kind = 'email' then case m.status when 'queued' then 'pending' when 'sending' then 'processing' when 'sent' then 'accepted' when 'delivered' then 'delivered' when 'bounced' then 'failed' when 'complained' then 'failed' when 'failed' then 'failed' when 'dead' then 'failed' else e.status end else e.status end status,
      case when e.kind = 'email' and m.status = 'failed' then coalesce(m.last_error, e.error) else e.error end detail, (select name from public.printer_profiles p where p.id = e.printer_id) printer,
      (select pr.name from public.profiles pr where pr.user_id = e.created_by) operator
    from public.document_events e join public.generated_documents d on d.id = e.document_id left join public.email_messages m on m.id = e.email_id
    where e.tenant_id = p_tenant and (p_document is null or e.document_id = p_document) and app.can_read(d.tenant_id, app.doc_module(d.type), d.branch_id)
    order by e.created_at desc limit least(greatest(p_limit, 1), 300)) x
$$;

-- ---------------------------------------------------------------- configurações
create or replace function public.save_document_settings(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare v_texts jsonb := coalesce(p -> 'texts', '{}'); k text;
begin
  perform app.require(p_tenant, 'personalizacao', 'editar');
  if jsonb_typeof(v_texts) <> 'object' then perform app.fail('Textos inválidos.'); end if;
  for k in select jsonb_object_keys(v_texts) loop
    if k not in ('header', 'footer', 'thanks', 'warranty', 'quoteTerms', 'osTerms', 'deliveryTerms') or jsonb_typeof(v_texts -> k) <> 'string' or length(v_texts ->> k) > 1500 then perform app.fail('Texto inválido: ' || k); end if;
  end loop;
  if length(coalesce(p -> 'papers', '{}')::text) > 4000 or length(coalesce(p -> 'messages', '{}')::text) > 8000 then perform app.fail('Preferências grandes demais.'); end if;
  insert into public.document_settings as s (tenant_id, texts, style, accent, logo_size, align, papers, messages)
  values (p_tenant, v_texts, coalesce(p ->> 'style', 'elite'), coalesce(p ->> 'accent', ''), coalesce((p ->> 'logoSize')::int, 18), coalesce(p ->> 'align', 'left'), coalesce(p -> 'papers', '{}'), coalesce(p -> 'messages', '{}'))
  on conflict (tenant_id) do update set texts = excluded.texts, style = excluded.style, accent = excluded.accent, logo_size = excluded.logo_size, align = excluded.align, papers = excluded.papers, messages = excluded.messages, updated_at = now();
  perform app.audit(p_tenant, 'Modelos de documentos atualizados', 'document_settings', p_tenant::text);
end $$;

create or replace function public.save_document_identity(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare b jsonb;
begin
  perform app.require(p_tenant, 'configuracoes', 'editar');
  update public.tenants set address = left(coalesce(p ->> 'address', address), 300), phone = left(coalesce(p ->> 'phone', phone), 40), whatsapp = left(coalesce(p ->> 'whatsapp', whatsapp), 40), website = left(coalesce(p ->> 'website', website), 160) where id = p_tenant;
  for b in select * from jsonb_array_elements(coalesce(p -> 'branches', '[]')) loop
    update public.branches set document = left(coalesce(b ->> 'document', ''), 30), address = left(coalesce(b ->> 'address', ''), 300), phone = left(coalesce(b ->> 'phone', ''), 40)
    where tenant_id = p_tenant and id = app.uuid_or_null(b ->> 'id');
  end loop;
  perform app.audit(p_tenant, 'Dados de contato para documentos atualizados', 'tenant', p_tenant::text);
end $$;

create or replace function public.save_printer_profile(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare m public.memberships := app.membership(p_tenant); v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); v_branch uuid := app.uuid_or_null(p ->> 'branchId'); old public.printer_profiles;
begin
  perform app.require(p_tenant, 'dashboard', 'visualizar', v_branch);
  if m.role not in ('Proprietário', 'Administrador', 'Gerente') then perform app.fail('Somente proprietário, administrador ou gerente configura impressoras.', '42501'); end if;
  select * into old from public.printer_profiles where id = v_id;
  if old.id is not null and old.tenant_id <> p_tenant then perform app.fail('Impressora pertence a outra empresa.', '42501'); end if;
  if (select count(*) from public.printer_profiles where tenant_id = p_tenant) >= 50 and old.id is null then perform app.fail('Limite de 50 impressoras por empresa.'); end if;
  if jsonb_typeof(coalesce(p -> 'calibration', '{}')) <> 'object' or length(coalesce(p -> 'calibration', '{}')::text) > 1000 or length(coalesce(p -> 'custom', '{}')::text) > 1000 then perform app.fail('Calibração inválida.'); end if;
  insert into public.printer_profiles as x (id, tenant_id, branch_id, station, name, kind, method, protocol, device, model, paper_id, custom, calibration, doc_types, copies, is_default, test_result, created_by)
  values (v_id, p_tenant, v_branch, left(coalesce(p ->> 'station', ''), 60), btrim(app.req_text(p ->> 'name', 'Nome da impressora')), p ->> 'kind', coalesce(p ->> 'method', 'browser'), coalesce(p ->> 'protocol', 'none'),
    left(coalesce(p ->> 'device', ''), 120), left(coalesce(p ->> 'model', ''), 80), p ->> 'paperId', coalesce(p -> 'custom', '{}'), coalesce(p -> 'calibration', '{}'),
    coalesce((select array_agg(value) from jsonb_array_elements_text(coalesce(p -> 'docTypes', '[]')) where app.doc_module(value) is not null or value like 'label-%'), '{}'),
    coalesce((p ->> 'copies')::int, 1), coalesce((p ->> 'isDefault')::boolean, false), left(coalesce(p ->> 'testResult', ''), 40), auth.uid())
  on conflict (id) do update set branch_id = excluded.branch_id, station = excluded.station, name = excluded.name, kind = excluded.kind, method = excluded.method, protocol = excluded.protocol, device = excluded.device,
    model = excluded.model, paper_id = excluded.paper_id, custom = excluded.custom, calibration = excluded.calibration, doc_types = excluded.doc_types, copies = excluded.copies, is_default = excluded.is_default,
    test_result = excluded.test_result, updated_at = now();
  if coalesce((p ->> 'isDefault')::boolean, false) then
    update public.printer_profiles set is_default = false where tenant_id = p_tenant and id <> v_id and branch_id is not distinct from v_branch and station = left(coalesce(p ->> 'station', ''), 60) and kind = p ->> 'kind';
  end if;
  perform app.audit(p_tenant, format('Impressora "%s" %s', p ->> 'name', case when old.id is null then 'cadastrada' else 'atualizada' end), 'printer', v_id::text);
  return v_id;
end $$;

create or replace function public.delete_printer_profile(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (app.membership(p_tenant)).role not in ('Proprietário', 'Administrador', 'Gerente') then perform app.fail('Somente proprietário, administrador ou gerente configura impressoras.', '42501'); end if;
  delete from public.printer_profiles where tenant_id = p_tenant and id = p_id;
  perform app.audit(p_tenant, 'Impressora removida', 'printer', p_id::text);
end $$;

revoke all on function public.issue_document(uuid, text, text), public.record_document_print(uuid, uuid, text, text, uuid, text), public.update_print_status(uuid, text, text, text),
  public.create_document_link(uuid, uuid, integer), public.revoke_document_links(uuid, uuid), public.document_public(text), public.send_document_email(uuid, uuid, text, text, text),
  public.prepare_document_whatsapp(uuid, uuid, uuid, text, text), public.finish_document_event(uuid, text, text), public.document_history(uuid, uuid, integer),
  public.save_document_settings(uuid, jsonb), public.save_document_identity(uuid, jsonb), public.save_printer_profile(uuid, jsonb), public.delete_printer_profile(uuid, uuid) from public, anon;
grant execute on function public.issue_document(uuid, text, text), public.record_document_print(uuid, uuid, text, text, uuid, text), public.update_print_status(uuid, text, text, text),
  public.create_document_link(uuid, uuid, integer), public.revoke_document_links(uuid, uuid), public.send_document_email(uuid, uuid, text, text, text),
  public.prepare_document_whatsapp(uuid, uuid, uuid, text, text), public.document_history(uuid, uuid, integer),
  public.save_document_settings(uuid, jsonb), public.save_document_identity(uuid, jsonb), public.save_printer_profile(uuid, jsonb), public.delete_printer_profile(uuid, uuid) to authenticated;
grant execute on function public.document_public(text) to anon, authenticated;
grant execute on function public.finish_document_event(uuid, text, text) to service_role;
revoke all on function app.doc_body(uuid, text, text), app.doc_identity(uuid, uuid), app.issue_document(uuid, text, text), app.doc_for(uuid, uuid, text), app.new_doc_link(uuid, uuid, integer),
  app.doc_lines(uuid, jsonb), app.doc_person(uuid, uuid), app.sale_document_trigger() from public, anon, authenticated;
grant execute on function app.doc_module(text) to authenticated;
