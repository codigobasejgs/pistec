-- ROLLBACK de 20261105000100_feature_catalog.sql — executar só com autorização, dentro de transação.
-- Não toca em planos, preços, módulos, assinaturas nem contratos já gerados (o Anexo I congelado continua igual).
begin;
drop trigger if exists contract_features_snapshot on public.tenant_contracts;
drop function if exists app.contract_features_snapshot();
drop function if exists public.admin_set_feature_status(text, text, text), public.plan_catalog();
-- contract_catalog volta à definição de 20261101000100 (recursos = plans.features).
create or replace function public.contract_catalog() returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'plans', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'monthly', p.monthly, 'quarterly', p.quarterly, 'annual', p.annual, 'trialDays', p.trial_days,
      'users', p.users, 'branches', p.branches, 'products', p.products, 'whatsapp', p.whatsapp, 'aiMessages', p.ai_messages, 'features', p.features, 'modules', p.modules) order by p.sort), '[]')
      from public.plans p where p.active and p.self_service and p.monthly > 0),
    'provider', (select jsonb_build_object('legalName', legal_name, 'document', document, 'legalNature', legal_nature, 'brand', brand,
      'address', format('%s, %s, %s, %s/%s, CEP %s', street, number, district, city, state, zip), 'email', coalesce(nullif(commercial_email, ''), registry_email), 'phone', registry_phone)
      from public.legal_provider_profiles where active),
    'version', (select jsonb_build_object('code', code, 'title', title, 'status', status, 'publishedAt', published_at) from public.legal_contract_versions where status = 'published'),
    'draft', (select jsonb_build_object('code', code, 'title', title, 'status', status) from public.legal_contract_versions where status <> 'archived' order by created_at desc limit 1))
$$;
drop function if exists app.plan_feature_names(text[]), app.plan_allows(text[], text);
drop table if exists public.feature_catalog;
delete from supabase_migrations.schema_migrations where version = '20261105000100';
commit;
