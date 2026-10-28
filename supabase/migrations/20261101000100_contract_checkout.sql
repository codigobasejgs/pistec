-- Contratação a partir de /planos: plano sob proposta fora do autoatendimento e descarte de contrato preparado (não enviado).
-- Aditivo: nenhuma tabela é recriada; contratos existentes não mudam.

-- Plano sob proposta (Enterprise): sem preço padrão no contrato, sem checkout automático.
alter table public.plans add column if not exists self_service boolean not null default true;
update public.plans set self_service = false where id = 'enterprise';

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

-- Defesa no banco: contrato real só para plano de autoatendimento ativo (prepare_contract não precisa ser reescrita).
create or replace function app.contract_plan_guard() returns trigger language plpgsql set search_path = '' as $$
begin
  if not new.sandbox and not exists (select 1 from public.plans where id = new.commercial ->> 'planId' and active and self_service) then
    raise exception 'Plano sob proposta comercial: fale com o consultor para receber uma proposta.' using errcode = 'P0001';
  end if;
  return new;
end $$;
drop trigger if exists contract_plan_guard on public.tenant_contracts;
create trigger contract_plan_guard before insert on public.tenant_contracts for each row execute function app.contract_plan_guard();
revoke all on function app.contract_plan_guard() from public, anon, authenticated;

-- Corrigir dados ou trocar o plano antes de enviar: o contrato preparado (nunca enviado ao provedor) é descartado e fica no histórico.
create or replace function public.discard_prepared_contract(p_contract uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.tenant_contracts;
begin
  select * into c from public.tenant_contracts where id = p_contract for update;
  if c.id is null then perform app.fail('Contrato não encontrado.'); end if;
  if not coalesce((app.membership(c.tenant_id)).role in ('Proprietário', 'Administrador'), false) and not (c.sandbox and app.is_platform_admin()) then
    perform app.fail('Seu perfil não permite alterar esta contratação.', '42501');
  end if;
  if c.status <> 'prepared' or c.provider_document_id is not null then perform app.fail('Contrato já enviado para assinatura: cancele a solicitação em vez de descartar.'); end if;
  update public.tenant_contracts set status = 'cancelled', cancelled_at = now() where id = c.id;
  insert into public.contract_signature_events (contract_id, source, event_key, type, data) values (c.id, 'system', 'discard:' || c.id, 'discarded', jsonb_build_object('reason', 'dados corrigidos antes do envio'));
  perform app.audit(c.tenant_id, format('Contrato %s descartado antes do envio (dados corrigidos)', c.number), 'contract', c.id::text);
end $$;
grant execute on function public.discard_prepared_contract(uuid) to authenticated;
