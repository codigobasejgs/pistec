-- PISTEC 3.0 — esquema base multi-tenant.
-- Dinheiro: bigint em centavos. Quantidades: integer. Datas: timestamptz do servidor.
-- Escrita nas tabelas de domínio acontece SOMENTE por RPCs security definer (ver 0300_rpcs.sql).

create schema if not exists app;

-- ---------------------------------------------------------------- catálogo SaaS
create table public.plans (
  id text primary key check (id ~ '^[a-z0-9-]{2,40}$'),
  name text not null,
  monthly bigint not null check (monthly >= 0),
  quarterly bigint not null check (quarterly >= 0),
  annual bigint not null check (annual >= 0),
  users integer not null check (users >= 0),
  branches integer not null check (branches >= 0),
  products integer not null check (products >= 0),
  whatsapp integer not null check (whatsapp >= 0),
  ai_messages integer not null default 0 check (ai_messages >= 0), -- por dia/empresa
  trial_days integer not null default 14 check (trial_days between 0 and 90),
  features text[] not null default '{}',
  modules text[] not null default '{}', -- módulos liberados (entitlements); '*' = todos
  active boolean not null default true,
  sort integer not null default 0
);

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and length(slug) <= 60),
  name text not null check (length(trim(name)) between 1 and 120),
  legal_name text not null default '',
  document text not null default '',
  owner_name text not null default '',
  email text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  profile text not null default 'Autopeças',
  plan_id text not null references public.plans(id),
  status text not null default 'Teste' check (status in ('Teste', 'Ativa', 'Pendente', 'Vencida', 'Suspensa', 'Cancelada')),
  due_date date not null,
  branding jsonb not null default '{}',
  notes text not null default '',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.branches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------- identidade
create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text not null default '',
  created_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro')),
  branch_ids uuid[], -- null = todas as filiais
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);
create index on public.memberships (user_id) where active;

-- Super Admin: só servidor concede (sem policy de escrita). Exige MFA (aal2) em app.is_platform_admin().
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table public.invites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null check (email = lower(email)),
  role text not null check (role in ('Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro')),
  branch_ids uuid[],
  token_hash text not null unique,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null,
  revoked_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- cadastros
create table public.products (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  sku text not null check (length(trim(sku)) between 1 and 80),
  barcode text not null default '',
  category text not null default 'Geral',
  brand text not null default '',
  cost bigint not null default 0 check (cost >= 0),
  price bigint not null default 0 check (price >= 0),
  min integer not null default 0 check (min >= 0),
  max integer not null default 0 check (max >= 0),
  location text not null default '',
  active boolean not null default true,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max = 0 or max >= min),
  unique (tenant_id, id)
);
create unique index products_sku_key on public.products (tenant_id, lower(sku));
create unique index products_barcode_key on public.products (tenant_id, barcode) where barcode <> '';

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 200),
  document text not null default '',
  email text not null default '',
  phone text not null default '',
  address text not null default '',
  consent boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  unique (tenant_id, id)
);

-- ---------------------------------------------------------------- estoque
create table public.stock_balances (
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  quantity integer not null default 0 check (quantity >= 0),
  reserved integer not null default 0 check (reserved >= 0),
  check (reserved <= quantity),
  primary key (tenant_id, branch_id, product_id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade
);

create table public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity >= 0),
  type text not null,
  reference text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  -- idempotência: a mesma referência nunca movimenta duas vezes
  unique (tenant_id, branch_id, product_id, type, reference),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete cascade,
  foreign key (tenant_id, product_id) references public.products(tenant_id, id) on delete cascade
);
create index on public.stock_movements (tenant_id, created_at desc);

-- ---------------------------------------------------------------- caixa e vendas
create table public.cash_registers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  opening bigint not null check (opening >= 0),
  opened_at timestamptz not null default now(),
  opened_by uuid,
  closed_at timestamptz,
  counted bigint check (counted >= 0),
  expected bigint,
  difference bigint,
  closing_reason text,
  closed_by text,
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id) on delete cascade,
  unique (tenant_id, id)
);
create unique index cash_one_open_per_branch on public.cash_registers (tenant_id, branch_id) where closed_at is null;

create table public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  cash_id uuid not null,
  amount bigint not null,
  reason text not null,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, cash_id) references public.cash_registers(tenant_id, id) on delete cascade
);
create index on public.cash_movements (cash_id);

create table public.sales (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  customer_id uuid,
  seller text not null,
  seller_id uuid,
  discount bigint not null default 0 check (discount >= 0),
  surcharge bigint not null default 0 check (surcharge >= 0),
  total bigint not null check (total > 0),
  change bigint not null default 0 check (change >= 0),
  status text not null default 'Concluída' check (status in ('Concluída', 'Cancelada')),
  request_id text not null,
  request_hash text not null,
  cash_id uuid not null,
  created_at timestamptz not null default now(),
  cancelled_at timestamptz,
  unique (tenant_id, request_id),
  unique (tenant_id, id),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id),
  foreign key (tenant_id, cash_id) references public.cash_registers(tenant_id, id)
);
create index on public.sales (tenant_id, branch_id, created_at desc);

create table public.sale_items (
  sale_id uuid not null references public.sales(id) on delete cascade,
  tenant_id uuid not null,
  product_id uuid not null,
  name text not null,
  quantity integer not null check (quantity > 0),
  price bigint not null check (price >= 0),
  cost bigint not null check (cost >= 0),
  primary key (sale_id, product_id),
  foreign key (tenant_id, product_id) references public.products(tenant_id, id)
);

create table public.sale_payments (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  tenant_id uuid not null,
  position integer not null,
  method text not null,
  amount bigint not null check (amount >= 0), -- aplicado à venda
  tendered bigint check (tendered >= amount), -- entregue (só dinheiro)
  unique (sale_id, position)
);

-- ---------------------------------------------------------------- financeiro
create table public.financial_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  branch_id uuid not null,
  type text not null check (type in ('Receita', 'Despesa')),
  category text not null default 'Geral',
  description text not null default '',
  amount bigint not null check (amount >= 0),
  due_date date not null,
  paid boolean not null default false,
  cancelled boolean not null default false,
  reference text not null default '',
  created_at timestamptz not null default now(),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id)
);
create unique index financial_reference_key on public.financial_entries (tenant_id, type, reference) where reference <> '';
create index on public.financial_entries (tenant_id, due_date);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  entry_id uuid not null references public.financial_entries(id) on delete cascade,
  tenant_id uuid not null,
  request_id text not null,
  amount bigint not null check (amount > 0),
  date date not null,
  method text not null,
  user_name text not null default 'Sistema',
  note text not null default '',
  reversed_at timestamptz,
  reversed_by text,
  reversal_reason text,
  created_at timestamptz not null default now(),
  unique (entry_id, request_id)
);

-- ---------------------------------------------------------------- registros operacionais
-- ponytail: OS, orçamentos, compras, CRM, agenda etc. em tabela única com kind + jsonb (contrato do frontend).
-- Regras com efeito em estoque/financeiro ficam nas RPCs. Dividir por tabela quando relatórios exigirem colunas.
create table public.records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = registro da plataforma (admin-*)
  branch_id uuid,
  kind text not null check (kind ~ '^[a-z-]{2,40}$'),
  title text not null default '',
  status text not null default '',
  customer_id uuid,
  date timestamptz not null default now(),
  amount bigint not null default 0 check (amount >= 0),
  fields jsonb not null default '{}',
  items jsonb not null default '[]',
  history jsonb not null default '[]',
  converted_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((tenant_id is null) = (kind like 'admin-%')),
  foreign key (tenant_id, branch_id) references public.branches(tenant_id, id),
  foreign key (tenant_id, customer_id) references public.customers(tenant_id, id)
);
create index on public.records (tenant_id, kind);

-- ---------------------------------------------------------------- auditoria, eventos, notificações
create table public.audit_logs (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  user_id uuid,
  action text not null,
  entity text not null default '',
  entity_id text not null default '',
  data jsonb not null default '{}',
  correlation_id text,
  created_at timestamptz not null default now()
);
create index on public.audit_logs (tenant_id, created_at desc);

-- Outbox transacional: eventos gravados na mesma transação da operação.
create table public.outbox_events (
  id bigint generated always as identity primary key,
  tenant_id uuid,
  type text not null,
  payload jsonb not null default '{}',
  depth integer not null default 0 check (depth between 0 and 3), -- anti-loop de automações
  status text not null default 'pending' check (status in ('pending', 'processing', 'done', 'dead')),
  attempts integer not null default 0,
  last_error text,
  correlation_id text,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  processed_at timestamptz
);
create index on public.outbox_events (available_at) where status = 'pending';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade, -- null = plataforma (Super Admin)
  user_id uuid references auth.users(id) on delete cascade, -- null = todos os membros
  type text not null,
  title text not null,
  body text not null default '',
  link text not null default '',
  data jsonb not null default '{}',
  read_at timestamptz,
  push_status text not null default 'pending' check (push_status in ('pending', 'sent', 'skipped', 'failed')),
  created_at timestamptz not null default now()
);
create index on public.notifications (tenant_id, created_at desc);
create index on public.notifications (created_at) where push_status = 'pending';

-- Leitura por usuário de notificações coletivas (user_id null).
create table public.notification_reads (
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (notification_id, user_id)
);

create table public.notification_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  in_app boolean not null default true,
  push boolean not null default true,
  email boolean not null default true,
  muted_types text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, tenant_id)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  failures integer not null default 0,
  last_success_at timestamptz,
  expired_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.push_subscriptions (user_id) where expired_at is null;

create table public.email_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  to_email text not null check (to_email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  template text not null,
  subject text not null,
  html text not null,
  text_body text not null default '',
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'delivered', 'bounced', 'complained', 'failed', 'dead')),
  attempts integer not null default 0,
  provider_id text unique,
  last_error text,
  idempotency_key text not null unique,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index on public.email_messages (next_attempt_at) where status in ('queued', 'failed');

-- Deduplicação de webhooks de qualquer provedor.
create table public.webhook_events (
  id bigint generated always as identity primary key,
  provider text not null,
  event_key text not null,
  payload jsonb not null,
  status text not null default 'received' check (status in ('received', 'processed', 'ignored', 'failed')),
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  unique (provider, event_key)
);

-- ---------------------------------------------------------------- cobrança SaaS
create table public.subscriptions (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  plan_id text not null references public.plans(id),
  period text not null default 'monthly' check (period in ('monthly', 'quarterly', 'annual')),
  status text not null default 'trialing' check (status in ('trialing', 'active', 'past_due', 'suspended', 'cancelled')),
  current_period_end date not null,
  provider text not null default 'InfinitePay' check (provider in ('InfinitePay', 'Asaas')),
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);

create table public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,30}$'),
  description text not null,
  kind text not null check (kind in ('percent', 'fixed')),
  value integer not null check (value >= 1), -- percent em pontos-base; fixed em centavos
  starts_at date not null,
  ends_at date not null,
  max_uses integer not null default 0 check (max_uses >= 0),
  per_tenant integer not null default 0 check (per_tenant >= 0),
  plan_ids text[] not null default '{}',
  periods text[] not null default '{}',
  active boolean not null default true,
  scope text not null default 'first' check (scope = 'first'),
  check (kind <> 'percent' or value <= 10000),
  check (starts_at <= ends_at)
);

create table public.billing_invoices (
  id uuid primary key default gen_random_uuid(), -- também é o order_nsu na InfinitePay
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  plan_id text not null references public.plans(id),
  period text not null check (period in ('monthly', 'quarterly', 'annual')),
  original_amount bigint not null check (original_amount >= 0),
  discount bigint not null default 0 check (discount >= 0),
  amount bigint not null check (amount >= 0 and amount = original_amount - discount),
  coupon_code text,
  status text not null default 'Pendente' check (status in ('Pendente', 'Paga', 'Vencida', 'Cancelada', 'Falhou')),
  due_date date not null,
  provider text not null check (provider in ('InfinitePay', 'Asaas')),
  request_id text not null,
  checkout_url text,
  provider_slug text,
  paid_at timestamptz,
  paid_amount bigint,
  capture_method text,
  receipt_url text,
  last_checked_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, request_id)
);
create index on public.billing_invoices (status, created_at);

create table public.billing_transactions (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.billing_invoices(id),
  tenant_id uuid not null,
  provider text not null,
  transaction_nsu text not null,
  amount bigint not null,
  paid_amount bigint not null,
  capture_method text,
  raw jsonb not null default '{}',
  created_at timestamptz not null default now(),
  unique (provider, transaction_nsu)
);

create table public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons(id),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_id uuid not null unique references public.billing_invoices(id) on delete cascade,
  discount bigint not null check (discount >= 0),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- integrações
create table public.whatsapp_instances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  instance_name text not null unique check (instance_name ~ '^pistec-[a-z0-9-]{4,60}$'),
  display_name text not null default 'WhatsApp',
  status text not null default 'created' check (status in ('created', 'connecting', 'open', 'close', 'archived')),
  phone text not null default '',
  bot_enabled boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.whatsapp_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  instance_id uuid not null references public.whatsapp_instances(id) on delete cascade,
  external_id text not null,
  remote_jid text not null,
  direction text not null check (direction in ('in', 'out')),
  body text not null default '',
  status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (instance_id, external_id)
);
create index on public.whatsapp_messages (tenant_id, remote_jid, created_at desc);

-- Segredos por tenant/integração. RLS sem policies: só service_role lê.
create table public.integration_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  provider text not null,
  name text not null,
  value text not null,
  created_at timestamptz not null default now(),
  unique nulls not distinct (tenant_id, provider, name)
);

create table public.ai_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  enabled boolean not null default false,
  whatsapp_bot boolean not null default false,
  persona text not null default '' check (length(persona) <= 2000),
  daily_limit integer not null default 50 check (daily_limit between 0 and 5000),
  updated_at timestamptz not null default now()
);

create table public.ai_usage (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid,
  channel text not null check (channel in ('app', 'whatsapp')),
  model text not null default '',
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  tools text[] not null default '{}',
  blocked text,
  created_at timestamptz not null default now()
);
create index on public.ai_usage (tenant_id, created_at desc);

-- Base de conhecimento (RAG por busca textual). tenant_id null = artigo global de ajuda.
create table public.knowledge_articles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  title text not null,
  body text not null,
  keywords text[] not null default '{}',
  public boolean not null default false, -- pode ser usado pelo bot de WhatsApp
  created_at timestamptz not null default now(),
  search tsvector
);
create index on public.knowledge_articles using gin (search);
create function app.knowledge_search_update() returns trigger language plpgsql set search_path = '' as $$
begin new.search := to_tsvector('portuguese', new.title || ' ' || new.body || ' ' || array_to_string(new.keywords, ' ')); return new; end $$;
create trigger knowledge_search before insert or update on public.knowledge_articles for each row execute function app.knowledge_search_update();

-- ---------------------------------------------------------------- dados de catálogo (não são dados demo)
insert into public.plans (id, name, monthly, quarterly, annual, users, branches, products, whatsapp, ai_messages, trial_days, features, modules, sort) values
  ('essencial', 'Essencial', 12900, 34900, 123900, 2, 1, 500, 1, 0, 14, '{"PDV e caixa","Produtos e estoque","Clientes","Financeiro básico"}', '{dashboard,pdv,caixa,produtos,estoque,clientes,financeiro,vendas,configuracoes}', 1),
  ('profissional', 'Profissional', 24900, 66900, 238900, 5, 1, 5000, 2, 30, 14, '{"Tudo do Essencial","Ordens de serviço","Compras","Relatórios","WhatsApp"}', '{dashboard,pdv,caixa,produtos,estoque,clientes,financeiro,vendas,configuracoes,ordens-servico,orcamentos,compras,fornecedores,relatorios,whatsapp,veiculos,agenda,garantias,assistente}', 2),
  ('premium', 'Premium', 44900, 120900, 430900, 15, 3, 20000, 5, 200, 14, '{"Tudo do Profissional","Múltiplas filiais","CRM","Automações","Personalização"}', '{*}', 3),
  ('enterprise', 'Enterprise', 79900, 239700, 958800, 100, 20, 100000, 20, 1000, 14, '{"Tudo do Premium","Implantação assistida","Limites ampliados","Suporte prioritário"}', '{*}', 4)
on conflict (id) do nothing;
