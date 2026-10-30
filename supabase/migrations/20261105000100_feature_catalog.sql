-- Catálogo comercial de recursos (fonte única para landing, planos, contratação e Super Admin).
-- Aditiva: NÃO altera preços, limites, módulos dos planos nem contratos. A disponibilidade por plano é calculada
-- a partir de plans.modules com a mesma regra de app.require (o servidor continua aplicando a autorização).

create table public.feature_catalog (
  key text primary key check (key ~ '^[a-z0-9_]{2,40}$'),
  name text not null,
  category text not null check (category in ('Gestão comercial', 'Oficina', 'Inteligência', 'Relacionamento', 'Administração')),
  modules text[] not null check (cardinality(modules) > 0),
  status text not null check (status in ('disponivel', 'requer_configuracao', 'em_homologacao')),
  summary text not null,
  next boolean not null default false,
  sort integer not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.feature_catalog enable row level security;
alter table public.feature_catalog force row level security;
grant select on public.feature_catalog to anon, authenticated;
grant select, insert, update, delete on public.feature_catalog to service_role;
create policy feature_catalog_read on public.feature_catalog for select to anon, authenticated using (true);

insert into public.feature_catalog (key, name, category, modules, status, summary, next, sort) values
  ('pdv', 'PDV e caixa', 'Gestão comercial', '{pdv,caixa}', 'disponivel', 'Venda no balcão com pagamentos mistos, troco e leitor de código de barras.', false, 1),
  ('produtos_estoque', 'Produtos e estoque por filial', 'Gestão comercial', '{produtos,estoque}', 'disponivel', 'Catálogo, saldos, reservas, transferências e inventário.', false, 2),
  ('vendas', 'Vendas', 'Gestão comercial', '{vendas}', 'disponivel', 'Histórico, cancelamento com estorno de estoque e financeiro.', false, 3),
  ('clientes', 'Clientes', 'Gestão comercial', '{clientes}', 'disponivel', 'Cadastro com endereço por CEP e consentimento de contato.', false, 4),
  ('crm', 'CRM', 'Gestão comercial', '{crm}', 'disponivel', 'Funil de oportunidades com motivo de perda.', false, 5),
  ('financeiro', 'Financeiro', 'Gestão comercial', '{financeiro}', 'disponivel', 'Contas a pagar e receber, baixas parciais e estornos.', false, 6),
  ('ordens_servico', 'Ordens de serviço', 'Oficina', '{ordens-servico,veiculos}', 'disponivel', 'Do diagnóstico à entrega, com reserva e baixa de peças.', false, 10),
  ('orcamentos', 'Orçamentos', 'Oficina', '{orcamentos}', 'disponivel', 'Orçamento convertido em OS sem redigitar.', false, 11),
  ('checkin_360', 'Check-in 360°', 'Oficina', '{ordens-servico,veiculos}', 'disponivel', 'Entrada do veículo com fotos, checklist, quilometragem e avarias.', true, 12),
  ('interactive_estimates', 'Orçamento interativo', 'Oficina', '{orcamentos}', 'disponivel', 'Cliente aprova ou recusa cada item pelo celular, com registro da decisão.', true, 13),
  ('smart_scheduling', 'Agenda inteligente', 'Oficina', '{agenda}', 'disponivel', 'Mecânicos e boxes sem conflito de horário.', true, 14),
  ('warranty_management', 'Garantias e retrabalho', 'Oficina', '{garantias}', 'disponivel', 'Garantia ligada à venda ou OS, causa, custo e justificativa.', true, 15),
  ('moto_express', 'Moto Express', 'Oficina', '{ordens-servico,veiculos}', 'disponivel', 'Atendimento rápido com pacotes de serviço cadastrados pela loja.', true, 16),
  ('autopilot', 'AutoPilot', 'Inteligência', '{dashboard}', 'disponivel', 'Pendências da operação por regras configuráveis; você decide cada ação.', true, 20),
  ('smart_inventory', 'Estoque inteligente', 'Inteligência', '{estoque}', 'disponivel', 'Ponto de reposição pela demanda real e sugestão de compra.', true, 21),
  ('supplier_quotes', 'Cotação com fornecedores', 'Inteligência', '{compras,fornecedores}', 'disponivel', 'Compare preço, frete e prazo; a compra só nasce da sua aprovação.', true, 22),
  ('os_profitability', 'Lucro por OS', 'Inteligência', '{relatorios,ordens-servico}', 'disponivel', 'Margem de contribuição por OS (antes de despesas indiretas).', true, 23),
  ('assistant_ai', 'Assistente com IA', 'Inteligência', '{assistente}', 'requer_configuracao', 'Consultas em linguagem natural, só leitura, com limite diário.', false, 24),
  ('mechanic_ai', 'Mecânico IA por voz', 'Inteligência', '{ordens-servico,assistente}', 'requer_configuracao', 'Fale o que foi feito; a IA transcreve e organiza para você revisar.', true, 25),
  ('customer_portal', 'Portal do Cliente', 'Relacionamento', '{orcamentos}', 'disponivel', 'Link seguro com a marca da oficina para acompanhar e aprovar.', true, 30),
  ('customer_loyalty', 'Fideliza (revisões)', 'Relacionamento', '{clientes,ordens-servico}', 'disponivel', 'Revisões previstas pela recomendação registrada na OS.', true, 31),
  ('whatsapp', 'WhatsApp da loja', 'Relacionamento', '{whatsapp}', 'requer_configuracao', 'Conecte o número da loja por QR Code e atenda pelo PISTEC.', false, 32),
  ('whatsapp_bot', 'Atendente automático no WhatsApp', 'Relacionamento', '{whatsapp,assistente}', 'em_homologacao', 'Responde dúvidas simples até um atendente assumir.', false, 33),
  ('automacoes', 'Automações', 'Relacionamento', '{automacoes}', 'disponivel', 'Regras de lembrete com execução manual registrada.', false, 34),
  ('relatorios', 'Relatórios', 'Administração', '{relatorios}', 'disponivel', 'Vendas, margem e estoque por período e filial.', false, 40),
  ('compras', 'Compras e fornecedores', 'Administração', '{compras,fornecedores}', 'disponivel', 'Pedido, recebimento e conta a pagar automática.', false, 41),
  ('personalizacao', 'Marca própria (white label)', 'Administração', '{personalizacao}', 'disponivel', 'Logo, cores e tema da empresa no sistema e no app instalável.', false, 42),
  ('fleet_management', 'Frotas', 'Administração', '{clientes,veiculos}', 'disponivel', 'Clientes empresariais com veículos vinculados e portal da frota.', true, 43);

-- Mesma lista fixa de app.require (módulos sempre liberados).
create or replace function app.plan_allows(p_modules text[], p_module text) returns boolean
language sql immutable set search_path = '' as $$
  select '*' = any (p_modules) or p_module = any (p_modules)
    or p_module in ('dashboard', 'configuracoes', 'personalizacao', 'minha-assinatura', 'notificacoes', 'filiais', 'funcionarios', 'categorias', 'aplicacoes', 'tarefas', 'instancias')
$$;

-- Catálogo público: planos ativos (preços e limites do banco) + recursos com disponibilidade calculada por plano.
create or replace function public.plan_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'monthly', p.monthly, 'quarterly', p.quarterly, 'annual', p.annual,
        'users', p.users, 'branches', p.branches, 'products', p.products, 'whatsapp', p.whatsapp, 'aiMessages', p.ai_messages, 'trialMonths', p.trial_months,
        'selfService', p.self_service, 'modules', to_jsonb(p.modules),
        'features', (select coalesce(jsonb_agg(f.key order by f.sort), '[]') from public.feature_catalog f where (select bool_and(app.plan_allows(p.modules, m)) from unnest(f.modules) m))) order by p.sort), '[]')
      from public.plans p where p.active),
    'features', (select coalesce(jsonb_agg(jsonb_build_object('key', key, 'name', name, 'category', category, 'modules', to_jsonb(modules), 'status', status, 'summary', summary, 'next', next) order by sort), '[]') from public.feature_catalog))
$$;
revoke all on function public.plan_catalog() from public;
grant execute on function public.plan_catalog() to anon, authenticated;
revoke all on function app.plan_allows(text[], text) from public, anon, authenticated;

-- Nomes dos recursos do catálogo liberados pelos módulos de um plano (mesma regra do plan_catalog).
create or replace function app.plan_feature_names(p_modules text[]) returns text[]
language sql stable set search_path = '' as $$
  select coalesce(array_agg(f.name order by f.sort), '{}') from public.feature_catalog f
  where (select bool_and(app.plan_allows(p_modules, m)) from unnest(f.modules) m)
$$;
revoke all on function app.plan_feature_names(text[]) from public, anon, authenticated;

-- Contratação: mesmos recursos da landing (catálogo), em vez do texto livre plans.features. Demais campos inalterados.
create or replace function public.contract_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'monthly', p.monthly, 'quarterly', p.quarterly, 'annual', p.annual, 'trialDays', p.trial_days,
      'users', p.users, 'branches', p.branches, 'products', p.products, 'whatsapp', p.whatsapp, 'aiMessages', p.ai_messages, 'features', to_jsonb(app.plan_feature_names(p.modules)), 'modules', p.modules) order by p.sort), '[]')
      from public.plans p where p.active and p.self_service and p.monthly > 0),
    'provider', (select jsonb_build_object('legalName', legal_name, 'document', document, 'legalNature', legal_nature, 'brand', brand,
      'address', format('%s, %s, %s, %s/%s, CEP %s', street, number, district, city, state, zip), 'email', coalesce(nullif(commercial_email, ''), registry_email), 'phone', registry_phone)
      from public.legal_provider_profiles where active),
    'version', (select jsonb_build_object('code', code, 'title', title, 'status', status, 'publishedAt', published_at) from public.legal_contract_versions where status = 'published'),
    'draft', (select jsonb_build_object('code', code, 'title', title, 'status', status) from public.legal_contract_versions where status <> 'archived' order by created_at desc limit 1))
$$;

-- Anexo I de contratos NOVOS: recursos = catálogo vigente do plano (contratos já gerados não são alterados).
create or replace function app.contract_features_snapshot() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.commercial ? 'entitlements' then
    new.commercial := jsonb_set(new.commercial, '{entitlements,features}',
      to_jsonb(app.plan_feature_names(coalesce((select array_agg(x) from jsonb_array_elements_text(new.commercial -> 'entitlements' -> 'modules') x), '{}'))));
  end if;
  return new;
end $$;
create trigger contract_features_snapshot before insert on public.tenant_contracts for each row execute function app.contract_features_snapshot();
revoke all on function app.contract_features_snapshot() from public, anon, authenticated;

-- Super Admin: altera só o estado comercial de um recurso (não mexe em planos/preços), com motivo e auditoria.
create or replace function public.admin_set_feature_status(p_key text, p_status text, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reason text := app.reason(p_reason); before text;
begin
  perform app.require_platform_admin();
  if p_status not in ('disponivel', 'requer_configuracao', 'em_homologacao') then perform app.fail('Estado inválido.'); end if;
  select status into before from public.feature_catalog where key = p_key for update;
  if before is null then perform app.fail('Recurso não encontrado.'); end if;
  update public.feature_catalog set status = p_status, updated_at = now() where key = p_key;
  perform app.audit(null, format('Recurso %s: %s → %s', p_key, before, p_status), 'feature', p_key, jsonb_build_object('before', before, 'after', p_status, 'reason', v_reason));
end $$;
revoke all on function public.admin_set_feature_status(text, text, text) from public, anon;
grant execute on function public.admin_set_feature_status(text, text, text) to authenticated;
