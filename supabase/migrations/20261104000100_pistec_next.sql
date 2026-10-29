-- PISTEC NEXT 10.0 — extensões aditivas da oficina. Não altera migrations aplicadas, preços, teste gratuito nem apaga dados.
-- Novos tipos de registro reutilizam public.records e as permissões de módulos existentes:
--   cotacoes → compras · frotas → clientes. AutoPilot, Estoque Inteligente, Lucro por OS, Fideliza e Moto Express
--   leem dados existentes (records, products, stock_*) e gravam pelas RPCs existentes.

create or replace function app.record_module(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'cart' then 'pdv' when 'instancias' then 'whatsapp' when 'mensagens' then 'whatsapp'
    when 'cotacoes' then 'compras' when 'frotas' then 'clientes' else p_kind end
$$;

create or replace function app.agenda_min(t text) returns integer
language sql immutable set search_path = '' as $$ select split_part(t, ':', 1)::int * 60 + split_part(t, ':', 2)::int $$;

-- ---------------------------------------------------------------- configurações da oficina (regras do AutoPilot, custo/hora, pacotes)
create table public.workshop_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  settings jsonb not null default '{}' check (jsonb_typeof(settings) = 'object' and length(settings::text) <= 100000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.workshop_settings enable row level security;
alter table public.workshop_settings force row level security;
grant select, insert, update, delete on public.workshop_settings to service_role;
-- Sem select direto: leitura pela RPC, que oculta custo/hora de quem não vê relatórios.

-- ---------------------------------------------------------------- save_record / transition_record (versão de 20261016000400 + acréscimos NEXT)
create or replace function public.save_record(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid());
  v_kind text := app.req_text(p ->> 'kind', 'Tipo');
  existing public.records; v_branch uuid := app.uuid_or_null(p ->> 'branchId'); v_customer uuid := app.uuid_or_null(p ->> 'customerId');
  v_fields jsonb := coalesce(p -> 'fields', '{}'); v_items jsonb; v_amount bigint; v_status text; v_plan public.plans; v_plate text;
begin
  if v_kind like 'admin-%' then perform app.fail('Tipo de registro inválido.', '42501'); end if;
  if jsonb_typeof(v_fields) <> 'object' or length(v_fields::text) > 50000 then perform app.fail('Registro inválido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('record-id:' || v_id::text, 0));
  select * into existing from public.records where id = v_id for update;
  if existing.id is not null and (existing.tenant_id is distinct from p_tenant or existing.kind <> v_kind) then perform app.fail('Registro não encontrado.', '42501'); end if;
  perform app.require(p_tenant, app.record_module(v_kind), case when existing.id is null then 'cadastrar' else 'editar' end, coalesce(existing.branch_id, v_branch));
  v_branch := coalesce(existing.branch_id, v_branch);
  perform app.branch_ok(p_tenant, v_branch);
  if existing.id is not null and app.record_readonly(existing) then perform app.fail('Registro já movimentou estoque ou foi finalizado; edição bloqueada.'); end if;
  if v_kind = 'cart' and existing.fields ? 'saleId' then perform app.fail('Carrinho já convertido em venda.'); end if;
  if v_customer is not null and not exists (select 1 from public.customers where tenant_id = p_tenant and id = v_customer) then perform app.fail('Cliente inválido.'); end if;
  if coalesce(v_fields ->> 'vehicleId', '') <> '' and not exists (select 1 from public.records where tenant_id = p_tenant and kind = 'veiculos' and id = app.uuid_or_null(v_fields ->> 'vehicleId') and customer_id is not distinct from v_customer) then
    perform app.fail('O veículo não pertence ao cliente selecionado.');
  end if;
  v_items := app.clean_items(p_tenant, v_kind, p -> 'items');
  if v_kind in ('compras', 'orcamentos', 'ordens-servico') and jsonb_array_length(v_items) = 0 and app.parse_cents(v_fields ->> 'labor') = 0 and not (v_kind = 'ordens-servico' and coalesce(v_fields ->> 'checkin', '') <> '') then perform app.fail('Adicione produtos ou um valor de mão de obra.'); end if;
  if v_kind = 'compras' and jsonb_array_length(v_items) = 0 then perform app.fail('Adicione os produtos da compra.'); end if;
  if v_kind = 'compras' and not exists (select 1 from public.records where tenant_id = p_tenant and kind = 'fornecedores' and id = app.uuid_or_null(v_fields ->> 'supplierId') and status <> 'Inativo') then perform app.fail('Fornecedor inválido ou inativo.'); end if;
  if v_kind = 'veiculos' then
    v_plate := upper(regexp_replace(coalesce(v_fields ->> 'plate', ''), '[-\s]', '', 'g'));
    if v_plate !~ '^[A-Z]{3}[0-9][A-Z0-9][0-9]{2}$' then perform app.fail('Informe uma placa brasileira válida.'); end if;
    if exists (select 1 from public.records where tenant_id = p_tenant and kind = 'veiculos' and id <> v_id and upper(regexp_replace(coalesce(fields ->> 'plate', ''), '[-\s]', '', 'g')) = v_plate) then perform app.fail('Placa já cadastrada.'); end if;
  end if;
  if v_kind = 'garantias' and not exists (select 1 from public.sales where tenant_id = p_tenant and id = app.uuid_or_null(v_fields ->> 'saleId') and customer_id is not distinct from v_customer and status = 'Concluída')
     and not exists (select 1 from public.records where tenant_id = p_tenant and kind = 'ordens-servico' and id = app.uuid_or_null(v_fields ->> 'saleId') and customer_id is not distinct from v_customer) then
    perform app.fail('Selecione uma venda ou ordem de serviço do cliente.');
  end if;
  if v_kind = 'funcionarios' and coalesce(nullif(v_fields ->> 'commission', ''), '0')::numeric > 100 then perform app.fail('Comissão não pode ultrapassar 100%.'); end if;
  if v_kind = 'aplicacoes' and coalesce(nullif(v_fields ->> 'yearEnd', ''), '0')::int < coalesce(nullif(v_fields ->> 'yearStart', ''), '0')::int then perform app.fail('Ano final deve ser igual ou posterior ao inicial.'); end if;
  if v_kind = 'agenda' then
    if coalesce(v_fields ->> 'time', '') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then perform app.fail('Horário inválido.'); end if;
    if coalesce(v_fields ->> 'allowOverlap', '') not in ('true', 'Sim') and exists (select 1 from public.records o where o.tenant_id = p_tenant and o.kind = 'agenda' and o.id <> v_id
      and o.branch_id is not distinct from v_branch and o.status <> 'Cancelado' and o.fields ->> 'scheduledDate' = v_fields ->> 'scheduledDate'
      and ((coalesce(v_fields ->> 'responsible', '') <> '' and o.fields ->> 'responsible' = v_fields ->> 'responsible') or (coalesce(v_fields ->> 'box', '') <> '' and o.fields ->> 'box' = v_fields ->> 'box'))
      and coalesce(o.fields ->> 'time', '') ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      and greatest(app.agenda_min(o.fields ->> 'time'), app.agenda_min(v_fields ->> 'time')) < least(app.agenda_min(o.fields ->> 'time') + coalesce(nullif(o.fields ->> 'duration', '')::int, 60), app.agenda_min(v_fields ->> 'time') + coalesce(nullif(v_fields ->> 'duration', '')::int, 60))) then
      perform app.fail('Conflito de agenda: responsável ou box já ocupado neste horário. Marque "Permitir encaixe" para confirmar.');
    end if;
  end if;
  if v_kind = 'cotacoes' and jsonb_array_length(v_items) = 0 then perform app.fail('Adicione os produtos da cotação.'); end if;
  -- valor sempre calculado no servidor
  v_amount := case
    when v_kind = 'compras' then (select coalesce(sum((x ->> 'quantity')::bigint * (x ->> 'cost')::bigint), 0) from jsonb_array_elements(v_items) x)
    when v_kind in ('aplicacoes', 'orcamentos', 'ordens-servico', 'garantias') then (select coalesce(sum((x ->> 'quantity')::bigint * (x ->> 'price')::bigint), 0) from jsonb_array_elements(v_items) x) + app.parse_cents(v_fields ->> 'labor')
    else app.int_val(coalesce(p -> 'amount', '0'), 'Valor') end;
  v_status := case v_kind
    when 'ordens-servico' then 'Aberta' when 'compras' then 'Pendente'
    when 'orcamentos' then 'Aberto' when 'cart' then 'Suspenso'
    when 'crm' then 'Novo' when 'agenda' then 'Agendado'
    when 'garantias' then 'Aberta' when 'tarefas' then 'Pendente'
    when 'notificacoes' then 'Não lida' when 'automacoes' then 'Pausada'
    when 'filiais' then 'Ativa' when 'categorias' then 'Ativa' when 'aplicacoes' then 'Ativa'
    when 'veiculos' then 'Ativo' when 'fornecedores' then 'Ativo' when 'funcionarios' then 'Ativo'
    when 'cotacoes' then 'Aberta' when 'frotas' then 'Ativa'
    else null end;
  if v_status is null then perform app.fail('Tipo de registro inválido.'); end if;
  if existing.id is null and nullif(p ->> 'status', '') is not null and p ->> 'status' <> v_status then
    perform app.fail('Estado inicial inválido; utilize a operação de transição.');
  end if;
  if existing.id is not null then v_status := existing.status; end if; -- status muda só por transition_record
  if v_kind = 'funcionarios' and v_status = 'Ativo' and coalesce(existing.status, '') <> 'Ativo' then
    v_plan := app.plan_of(p_tenant);
    if (select count(*) from public.records where tenant_id = p_tenant and kind = 'funcionarios' and status = 'Ativo') >= v_plan.users then perform app.fail('Limite de usuários do plano atingido.'); end if;
  end if;
  if v_kind = 'filiais' then
    if exists (select 1 from public.branches where tenant_id = p_tenant and id = v_id) then
      update public.branches set name = left(app.req_text(p ->> 'title', 'Título'), 120) where id = v_id;
    else
      v_plan := app.plan_of(p_tenant);
      perform pg_advisory_xact_lock(hashtextextended('branches:' || p_tenant::text, 0));
      if (select count(*) from public.branches where tenant_id = p_tenant and active) >= v_plan.branches then perform app.fail('Limite de filiais do plano atingido.'); end if;
      insert into public.branches (id, tenant_id, name) values (v_id, p_tenant, left(app.req_text(p ->> 'title', 'Título'), 120));
      v_status := 'Ativa';
    end if;
  end if;
  insert into public.records (id, tenant_id, branch_id, kind, title, status, customer_id, amount, fields, items, history)
  values (v_id, p_tenant, v_branch, v_kind, left(app.req_text(p ->> 'title', 'Título'), 200), v_status, v_customer, v_amount, v_fields - 'stockState', v_items,
          app.history(case when v_kind = 'cart' then 'Carrinho suspenso por ' || app.user_name() || '; estoque não reservado.' else 'Criado por ' || app.user_name() end))
  on conflict (id) do update set title = excluded.title, customer_id = excluded.customer_id, amount = excluded.amount,
    fields = excluded.fields || jsonb_strip_nulls(jsonb_build_object('stockState', public.records.fields -> 'stockState')), items = excluded.items,
    status = case when public.records.kind = 'cart' then 'Suspenso' else public.records.status end,
    history = public.records.history || app.history(case when public.records.kind = 'cart' then 'Carrinho suspenso novamente por ' || app.user_name() else 'Atualizado por ' || app.user_name() end);
  perform app.audit(p_tenant, v_kind || ': salvo ' || (p ->> 'title'), 'record', v_id::text);
  if existing.id is null then perform app.emit(p_tenant, 'record.created', jsonb_build_object('kind', v_kind, 'recordId', v_id, 'title', p ->> 'title')); end if;
  return v_id;
end $$;

create or replace function public.transition_record(p_tenant uuid, p_id uuid, p_status text, p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records; v_status text := app.req_text(p_status, 'Status'); v_fields jsonb; v_action text;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_id for update;
  if r.id is null then perform app.fail('Registro não encontrado.'); end if;
  v_action := case when v_status like 'Cancel%' or v_status in ('Perdido', 'Descartado') then 'cancelar' else 'editar' end;
  if r.kind = 'cart' and v_status = 'Descartado' then v_action := 'excluir'; end if;
  perform app.require(p_tenant, app.record_module(r.kind), v_action, r.branch_id);
  perform app.branch_ok(p_tenant, r.branch_id);
  v_fields := r.fields;
  if r.kind <> 'ordens-servico' and not (v_status = any(case r.kind
    when 'compras' then array['Cancelada','Cancelado']
    when 'orcamentos' then array['Rascunho','Aberto','Enviado','Aprovado','Rejeitado','Recusado','Cancelado','Expirado']
    when 'filiais' then array['Ativa','Inativa']
    when 'categorias' then array['Ativa','Inativa'] when 'aplicacoes' then array['Ativa','Inativa']
    when 'funcionarios' then array['Ativo','Inativo'] when 'fornecedores' then array['Ativo','Inativo']
    when 'veiculos' then array['Ativo','Inativo'] when 'cart' then array['Descartado']
    when 'crm' then array['Novo','Em contato','Proposta','Ganho','Perdido']
    when 'agenda' then array['Agendado','Confirmado','Concluído','Cancelado']
    when 'tarefas' then array['Pendente','Em andamento','Concluída']
    when 'garantias' then array['Aberta','Em análise','Aprovada','Rejeitada','Concluída']
    when 'automacoes' then array['Ativa','Pausada','Inativa']
    when 'cotacoes' then array['Aberta','Enviada','Respondida','Aprovada','Cancelada']
    when 'frotas' then array['Ativa','Inativa']
    when 'notificacoes' then array['Não lida','Lida'] else array[]::text[] end)) then
    perform app.fail('Status inválido para este tipo de registro.');
  end if;
  if r.kind = 'ordens-servico' then
    v_status := coalesce(('{"Em andamento":"Em execução","Concluída":"Pronta"}'::jsonb) ->> v_status, v_status);
    if r.status = v_status then return; end if;
    if not (v_status = any (case r.status
      when 'Aberta' then array['Em diagnóstico', 'Aguardando aprovação', 'Em execução', 'Cancelada']
      when 'Em diagnóstico' then array['Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Cancelada']
      when 'Aguardando aprovação' then array['Aguardando peças', 'Em execução', 'Cancelada']
      when 'Aguardando peças' then array['Em execução', 'Cancelada']
      when 'Em execução' then array['Em testes', 'Pronta', 'Cancelada']
      when 'Em testes' then array['Em execução', 'Pronta', 'Cancelada']
      when 'Pronta' then array['Entregue', 'Cancelada'] else array[]::text[] end)) then
      perform app.fail('Transição de OS inválida.');
    end if;
    v_fields := app.os_stock(r, v_status);
  elsif r.kind = 'filiais' then
    if r.status = v_status then return; end if;
    if v_status = 'Inativa' then
      if exists (select 1 from public.cash_registers where tenant_id = p_tenant and branch_id = r.id and closed_at is null) then perform app.fail('Feche o caixa da filial antes de desativá-la.'); end if;
      if (select count(*) from public.branches where tenant_id = p_tenant and active and id <> r.id) = 0 then perform app.fail('A empresa precisa de ao menos uma filial ativa.'); end if;
    else
      if (select count(*) from public.branches where tenant_id = p_tenant and active) >= (app.plan_of(p_tenant)).branches then perform app.fail('Limite de filiais do plano atingido.'); end if;
    end if;
    update public.branches set active = (v_status = 'Ativa') where tenant_id = p_tenant and id = r.id;
  else
    if r.status = v_status then return; end if;
    if r.kind = 'compras' and (r.status not in ('Pendente', 'Aprovada', 'Pedido', 'Enviada') or v_status not in ('Cancelada', 'Cancelado')) then perform app.fail('Receba a compra pela operação de recebimento.'); end if;
    if r.converted_id is not null or r.status in ('Cancelado', 'Cancelada', 'Convertido', 'Convertida', 'Rejeitado', 'Recusado', 'Concluído', 'Descartado') then perform app.fail('Registro encerrado.'); end if;
    if r.kind = 'orcamentos' and v_status not in ('Rascunho', 'Aberto', 'Enviado', 'Aprovado', 'Rejeitado', 'Recusado', 'Cancelado', 'Expirado') then perform app.fail('Status de orçamento inválido.'); end if;
    if r.kind = 'funcionarios' and v_status = 'Ativo' and (select count(*) from public.records where tenant_id = p_tenant and kind = 'funcionarios' and status = 'Ativo') >= (app.plan_of(p_tenant)).users then
      perform app.fail('Limite de usuários do plano atingido.');
    end if;
  end if;
  if r.kind = 'garantias' and v_status = 'Rejeitada' then v_fields := v_fields || jsonb_build_object('rejectionReason', app.req_text(p_reason, 'Justificativa da recusa')); end if;
  if r.kind = 'crm' and v_status = 'Perdido' then v_fields := v_fields || jsonb_build_object('lossReason', app.req_text(p_reason, 'Motivo da perda')); end if;
  update public.records set status = v_status, fields = v_fields,
    history = history || app.history('Status: ' || v_status || ' por ' || app.user_name() || case when p_reason is not null then ' — ' || p_reason else '' end)
  where id = r.id;
  perform app.audit(p_tenant, r.id || ': ' || v_status, 'record', r.id::text);
  perform app.emit(p_tenant, 'record.status', jsonb_build_object('kind', r.kind, 'recordId', r.id, 'title', r.title, 'from', r.status, 'to', v_status, 'customerId', r.customer_id));
end $$;

-- ---------------------------------------------------------------- configurações: leitura/gravação controladas
create or replace function public.workshop_settings(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v jsonb;
begin
  perform app.require(p_tenant, 'dashboard', 'visualizar');
  v := coalesce((select settings from public.workshop_settings where tenant_id = p_tenant), '{}');
  if not app.member_can_read(auth.uid(), p_tenant, 'relatorios') then v := v - 'hourlyCost'; end if;
  return v;
end $$;

create or replace function public.save_workshop_settings(p_tenant uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare k text; n numeric;
begin
  perform app.require(p_tenant, 'configuracoes', 'configurar');
  if jsonb_typeof(p) <> 'object' or length(p::text) > 100000 then perform app.fail('Configuração inválida.'); end if;
  foreach k in array array['quoteFollowupDays','osStaleDays','lowMarginPct','warrantyWarnDays','maintenanceWarnDays','hourlyCost','defaultLeadDays','demandDays','openHour','closeHour','slotMinutes'] loop
    if p ? k then
      if jsonb_typeof(p -> k) <> 'number' then perform app.fail('Valor inválido: ' || k); end if;
      n := (p ->> k)::numeric;
      if n < 0 or n <> trunc(n) or (k in ('openHour','closeHour') and n > 24) or (k = 'lowMarginPct' and n > 100) or (k = 'slotMinutes' and n not between 5 and 240) or (k = 'demandDays' and n not between 7 and 730) then
        perform app.fail('Valor fora do limite: ' || k);
      end if;
    end if;
  end loop;
  if (p ? 'openHour') and (p ? 'closeHour') and (p ->> 'openHour')::int >= (p ->> 'closeHour')::int then perform app.fail('Horário de fechamento deve ser após a abertura.'); end if;
  if p ? 'mode' and p ->> 'mode' not in ('informativo', 'assistido') then perform app.fail('Modo do AutoPilot inválido.'); end if;
  if p ? 'packages' and jsonb_typeof(p -> 'packages') <> 'array' then perform app.fail('Pacotes inválidos.'); end if;
  insert into public.workshop_settings (tenant_id, settings, updated_by) values (p_tenant, p - 'dismissed', auth.uid())
  on conflict (tenant_id) do update set settings = (excluded.settings || jsonb_build_object('dismissed', coalesce(public.workshop_settings.settings -> 'dismissed', '{}'))), updated_by = auth.uid(), updated_at = now();
  perform app.audit(p_tenant, 'Configurações da oficina atualizadas', 'workshop', p_tenant::text, p - 'dismissed');
end $$;

-- Dispensa de alerta do AutoPilot até uma data (regra:registro), com auditoria. Nada é executado.
create or replace function public.dismiss_alert(p_tenant uuid, p_key text, p_until date) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'dashboard', 'editar');
  if p_key !~ '^[a-z-]{3,40}:[0-9a-f-]{1,40}$' then perform app.fail('Alerta inválido.'); end if;
  if p_until < current_date or p_until > current_date + 90 then perform app.fail('Dispensa entre hoje e 90 dias.'); end if;
  insert into public.workshop_settings (tenant_id, settings, updated_by) values (p_tenant, jsonb_build_object('dismissed', jsonb_build_object(p_key, p_until)), auth.uid())
  on conflict (tenant_id) do update set settings = jsonb_set(public.workshop_settings.settings, '{dismissed}',
    (select coalesce(jsonb_object_agg(d.key, d.value), '{}') from jsonb_each(coalesce(public.workshop_settings.settings -> 'dismissed', '{}')) d where d.value #>> '{}' >= current_date::text) || jsonb_build_object(p_key, p_until)),
    updated_at = now();
  perform app.audit(p_tenant, 'AutoPilot: alerta dispensado ' || p_key || ' até ' || p_until, 'autopilot', p_key);
end $$;

-- ---------------------------------------------------------------- execução da OS: horas, custos diretos e próxima revisão
-- Campos de trabalho (mecânico) e de custo (gestão) liberados mesmo com peças reservadas; nunca altera itens nem valor.
create or replace function public.update_os_work(p_tenant uuid, p_id uuid, p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records; k text; v text; v_set jsonb := '{}';
begin
  if jsonb_typeof(p) <> 'object' then perform app.fail('Dados inválidos.'); end if;
  select * into r from public.records where tenant_id = p_tenant and id = p_id and kind = 'ordens-servico' for update;
  if r.id is null then perform app.fail('Ordem de serviço não encontrada.'); end if;
  perform app.require(p_tenant, 'ordens-servico', 'editar', r.branch_id);
  if r.status = 'Cancelada' then perform app.fail('OS cancelada.'); end if;
  if p ?| array['thirdPartyCost', 'commissionPct'] then perform app.require(p_tenant, 'relatorios', 'editar', r.branch_id); end if;
  for k, v in select key, value #>> '{}' from jsonb_each(p) loop
    v := btrim(coalesce(v, ''));
    case k
      when 'hoursWorked', 'estimatedHours' then if v !~ '^\d{1,3}(\.\d{1,2})?$' then perform app.fail('Horas inválidas.'); end if;
      when 'thirdPartyCost' then perform app.parse_cents(v);
      when 'commissionPct' then if v !~ '^\d{1,3}(\.\d{1,2})?$' or v::numeric > 100 then perform app.fail('Comissão entre 0 e 100%.'); end if;
      when 'nextServiceDate' then if v <> '' and v !~ '^\d{4}-\d{2}-\d{2}$' then perform app.fail('Data da próxima revisão inválida.'); end if;
      when 'nextServiceKm' then if v <> '' and v !~ '^\d{1,7}$' then perform app.fail('Quilometragem inválida.'); end if;
      when 'nextServiceDone' then if v not in ('', 'true') then perform app.fail('Valor inválido.'); end if;
      when 'nextService', 'workLog' then if length(v) > 500 then perform app.fail('Texto muito longo.'); end if;
      else perform app.fail('Campo não permitido: ' || k);
    end case;
    v_set := v_set || jsonb_build_object(k, v);
  end loop;
  update public.records set fields = fields || v_set, history = history || app.history('Execução atualizada por ' || app.user_name() || ': ' || (select string_agg(key, ', ') from jsonb_object_keys(v_set) key)) where id = r.id;
  perform app.audit(p_tenant, 'OS execução atualizada', 'record', r.id::text, v_set);
end $$;

-- ---------------------------------------------------------------- fotos do check-in / execução (privadas; compartilháveis no portal)
-- ponytail: imagem comprimida no navegador (≤ ~500 KB) em data URL; migrar para Storage privado com URL assinada acima de ~5 GB por empresa.
create table public.record_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  label text not null check (length(label) between 1 and 80),
  data text not null check (data ~ '^data:image/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$' and length(data) <= 700000),
  shared boolean not null default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.record_attachments (tenant_id, record_id);
alter table public.record_attachments enable row level security;
alter table public.record_attachments force row level security;
grant select on public.record_attachments to authenticated;
grant select, insert, update, delete on public.record_attachments to service_role;
create policy attachments_read on public.record_attachments for select to authenticated using (
  exists (select 1 from public.records r where r.id = record_id and r.tenant_id = record_attachments.tenant_id and app.can_read(r.tenant_id, app.record_module(r.kind), r.branch_id)));

create or replace function public.add_record_attachment(p_tenant uuid, p_record uuid, p_label text, p_data text, p_shared boolean default false) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.records; v_id uuid;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_record for update;
  if r.id is null or r.kind not in ('ordens-servico', 'orcamentos', 'garantias', 'veiculos') then perform app.fail('Registro não encontrado.'); end if;
  perform app.require(p_tenant, app.record_module(r.kind), 'editar', r.branch_id);
  if (select count(*) from public.record_attachments where record_id = r.id) >= 24 then perform app.fail('Limite de 24 fotos por registro.'); end if;
  insert into public.record_attachments (tenant_id, record_id, label, data, shared, created_by) values (p_tenant, r.id, left(app.req_text(p_label, 'Descrição da foto'), 80), p_data, coalesce(p_shared, false), auth.uid()) returning id into v_id;
  update public.records set history = history || app.history('Foto anexada: ' || left(p_label, 80) || ' por ' || app.user_name()) where id = r.id;
  perform app.audit(p_tenant, 'Foto anexada', 'record', r.id::text);
  return v_id;
end $$;

create or replace function public.set_attachment(p_tenant uuid, p_id uuid, p_shared boolean, p_delete boolean default false) returns void
language plpgsql security definer set search_path = '' as $$
declare a public.record_attachments; r public.records;
begin
  select * into a from public.record_attachments where tenant_id = p_tenant and id = p_id;
  if a.id is null then perform app.fail('Foto não encontrada.'); end if;
  select * into r from public.records where id = a.record_id;
  perform app.require(p_tenant, app.record_module(r.kind), 'editar', r.branch_id);
  if p_delete then
    if r.status in ('Entregue', 'Concluída', 'Aprovado') then perform app.fail('Registro encerrado: a foto faz parte do histórico.'); end if;
    delete from public.record_attachments where id = a.id;
  else update public.record_attachments set shared = p_shared where id = a.id; end if;
  perform app.audit(p_tenant, case when p_delete then 'Foto removida' when p_shared then 'Foto compartilhada no portal' else 'Foto retirada do portal' end, 'record', r.id::text);
end $$;

-- ---------------------------------------------------------------- Portal do Cliente: links com token, escopo e validade
create table public.customer_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  scope text not null check (scope in ('record', 'customer', 'fleet')),
  target_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  views integer not null default 0,
  last_view_at timestamptz,
  actions integer not null default 0,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.customer_links (tenant_id, target_id);
create table public.estimate_decisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  record_id uuid not null references public.records(id) on delete cascade,
  link_id uuid references public.customer_links(id) on delete set null,
  kind text not null check (kind in ('decision', 'question')),
  decisions jsonb not null default '{}',
  snapshot jsonb not null,
  content_hash text not null,
  approved_total bigint not null default 0,
  signer_name text not null default '',
  note text not null default '',
  created_at timestamptz not null default now()
);
create index on public.estimate_decisions (tenant_id, record_id);
do $$ declare t text; begin
  foreach t in array array['customer_links', 'estimate_decisions'] loop
    execute format('alter table public.%I enable row level security', t); execute format('alter table public.%I force row level security', t);
    execute format('grant select, insert, update, delete on public.%I to service_role', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;
create policy links_read on public.customer_links for select to authenticated using (app.can_read(tenant_id, 'clientes') or app.can_read(tenant_id, 'orcamentos') or app.can_read(tenant_id, 'ordens-servico'));
create policy decisions_read on public.estimate_decisions for select to authenticated using (app.can_read(tenant_id, 'orcamentos') or app.can_read(tenant_id, 'ordens-servico'));

-- Hash do conteúdo visível ao cliente: itens com preço + mão de obra + validade. Mudou → nova aprovação.
create or replace function app.quote_hash(r public.records) returns text
language sql immutable set search_path = '' as $$
  select encode(extensions.digest(coalesce((select jsonb_agg(jsonb_build_object('p', x ->> 'productId', 'q', x -> 'quantity', 'v', x -> 'price') order by x ->> 'productId') from jsonb_array_elements(r.items) x), '[]')::text
    || '|' || coalesce(r.fields ->> 'labor', '') || '|' || coalesce(r.fields ->> 'validUntil', '') || '|' || r.amount, 'sha256'), 'hex')
$$;

create or replace function public.create_customer_link(p_tenant uuid, p_scope text, p_target uuid, p_days integer default 7) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.records; v_token text := encode(extensions.gen_random_bytes(24), 'hex'); v_branch uuid;
begin
  if p_days is null or p_days not between 1 and 30 then perform app.fail('Validade do link entre 1 e 30 dias.'); end if;
  if p_scope = 'record' then
    select * into r from public.records where tenant_id = p_tenant and id = p_target and kind in ('orcamentos', 'ordens-servico');
    if r.id is null then perform app.fail('Orçamento ou OS não encontrado.'); end if;
    if r.customer_id is null then perform app.fail('Associe um cliente antes de compartilhar.'); end if;
    perform app.require(p_tenant, r.kind, 'editar', r.branch_id);
  elsif p_scope = 'customer' then
    if not exists (select 1 from public.customers where tenant_id = p_tenant and id = p_target) then perform app.fail('Cliente não encontrado.'); end if;
    perform app.require(p_tenant, 'clientes', 'editar');
  elsif p_scope = 'fleet' then
    if not exists (select 1 from public.records where tenant_id = p_tenant and id = p_target and kind = 'frotas' and status = 'Ativa') then perform app.fail('Frota não encontrada ou inativa.'); end if;
    perform app.require(p_tenant, 'clientes', 'editar');
  else perform app.fail('Escopo inválido.'); end if;
  insert into public.customer_links (tenant_id, scope, target_id, token_hash, expires_at, created_by)
  values (p_tenant, p_scope, p_target, encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + make_interval(days => p_days), auth.uid());
  if r.kind = 'orcamentos' and r.status = 'Aberto' then
    update public.records set status = 'Enviado', history = history || app.history('Link de aprovação gerado por ' || app.user_name()) where id = r.id;
  end if;
  perform app.audit(p_tenant, format('Portal do cliente: link %s criado (%s dias)', p_scope, p_days), p_scope, p_target::text);
  return jsonb_build_object('token', v_token, 'expiresAt', now() + make_interval(days => p_days));
end $$;

create or replace function public.revoke_customer_links(p_tenant uuid, p_target uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare n integer;
begin
  if not (app.member_can_read(auth.uid(), p_tenant, 'clientes') or app.member_can_read(auth.uid(), p_tenant, 'orcamentos') or app.member_can_read(auth.uid(), p_tenant, 'ordens-servico')) then perform app.fail('Acesso negado.', '42501'); end if;
  perform app.require(p_tenant, 'dashboard', 'editar');
  update public.customer_links set revoked_at = now() where tenant_id = p_tenant and target_id = p_target and revoked_at is null and expires_at > now();
  get diagnostics n = row_count;
  perform app.audit(p_tenant, format('Portal do cliente: %s link(s) revogado(s)', n), 'link', p_target::text);
  return n;
end $$;

-- Visão pública do registro: sem custo, sem notas internas, só fotos marcadas como compartilhadas.
create or replace function app.portal_record(r public.records) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'kind', r.kind, 'title', r.title, 'status', r.status, 'date', r.date, 'amount', r.amount,
    'dueDate', r.fields ->> 'dueDate', 'validUntil', r.fields ->> 'validUntil', 'labor', app.parse_cents(r.fields ->> 'labor'),
    'complaint', case when r.kind = 'ordens-servico' then r.fields ->> 'complaint' end, 'terms', case when r.kind = 'orcamentos' then r.fields ->> 'notes' end,
    'groups', case when coalesce(r.fields ->> 'itemGroups', '') ~ '^\{' then (r.fields ->> 'itemGroups')::jsonb else '{}' end,
    'decision', case when coalesce(r.fields ->> 'decision', '') ~ '^\{' then (r.fields ->> 'decision')::jsonb end,
    'items', coalesce((select jsonb_agg(jsonb_build_object('productId', x ->> 'productId', 'name', x ->> 'name', 'quantity', x -> 'quantity', 'price', x -> 'price')) from jsonb_array_elements(r.items) x), '[]'),
    'vehicle', (select jsonb_build_object('title', v.title, 'plate', v.fields ->> 'plate') from public.records v where v.tenant_id = r.tenant_id and v.kind = 'veiculos' and v.id = app.uuid_or_null(r.fields ->> 'vehicleId')),
    'photos', coalesce((select jsonb_agg(jsonb_build_object('label', a.label, 'data', a.data) order by a.created_at) from public.record_attachments a where a.record_id = r.id and a.shared), '[]'),
    'hash', app.quote_hash(r))
$$;

create or replace function app.portal_link(p_token text, p_action boolean) returns public.customer_links
language plpgsql security definer set search_path = '' as $$
declare l public.customer_links;
begin
  if p_token is null or p_token !~ '^[0-9a-f]{48}$' then return null; end if;
  select * into l from public.customer_links where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if l.id is null or l.revoked_at is not null or l.expires_at < now() then return null; end if;
  if l.last_view_at > now() - interval '1 hour' and (l.views >= 120 or (p_action and l.actions >= 10)) then return null; end if;
  update public.customer_links set views = case when last_view_at < now() - interval '1 hour' then 1 else views + 1 end,
    actions = case when not p_action then actions when last_view_at < now() - interval '1 hour' then 1 else actions + 1 end, last_view_at = now() where id = l.id;
  return l;
end $$;

create or replace function app.portal_records(l public.customer_links) returns setof public.records
language sql stable security definer set search_path = '' as $$
  select r.* from public.records r where r.tenant_id = l.tenant_id and r.kind in ('orcamentos', 'ordens-servico', 'garantias') and r.status not in ('Rascunho') and (
    (l.scope = 'record' and r.id = l.target_id)
    or (l.scope = 'customer' and r.customer_id = l.target_id)
    or (l.scope = 'fleet' and exists (select 1 from public.records v where v.tenant_id = l.tenant_id and v.kind = 'veiculos' and v.fields ->> 'fleetId' = l.target_id::text and v.id = app.uuid_or_null(r.fields ->> 'vehicleId'))))
$$;

create or replace function public.portal_view(p_token text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.customer_links := app.portal_link(p_token, false); t public.tenants;
begin
  if l.id is null then return null; end if;
  select * into t from public.tenants where id = l.tenant_id;
  return jsonb_build_object('scope', l.scope, 'expiresAt', l.expires_at,
    'company', jsonb_build_object('name', t.name, 'phone', t.phone, 'whatsapp', t.whatsapp, 'email', t.email, 'address', t.address, 'logo', coalesce(t.branding ->> 'logo', ''), 'primary', coalesce(t.branding ->> 'primary', '#007BFF')),
    'customer', case when l.scope = 'record' then null else (select jsonb_build_object('name', coalesce((select c.name from public.customers c where c.tenant_id = l.tenant_id and c.id = l.target_id), (select f.title from public.records f where f.id = l.target_id)))) end,
    'vehicles', case when l.scope = 'record' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'title', v.title, 'plate', v.fields ->> 'plate', 'mileage', v.fields ->> 'mileage'))
      from public.records v where v.tenant_id = l.tenant_id and v.kind = 'veiculos' and v.status = 'Ativo' and ((l.scope = 'customer' and v.customer_id = l.target_id) or (l.scope = 'fleet' and v.fields ->> 'fleetId' = l.target_id::text))), '[]') end,
    'records', coalesce((select jsonb_agg(app.portal_record(r) order by r.date desc) from app.portal_records(l) r), '[]'),
    'reminders', case when l.scope = 'record' then '[]'::jsonb else coalesce((select jsonb_agg(jsonb_build_object('service', r.fields ->> 'nextService', 'date', r.fields ->> 'nextServiceDate', 'km', r.fields ->> 'nextServiceKm'))
      from app.portal_records(l) r where r.kind = 'ordens-servico' and coalesce(r.fields ->> 'nextServiceDate', '') <> '' and coalesce(r.fields ->> 'nextServiceDone', '') <> 'true'), '[]') end);
end $$;

-- Decisão por item (ou pedido de esclarecimento). O cliente envia o hash que viu; conteúdo alterado exige novo envio.
create or replace function public.portal_decide(p_token text, p_record uuid, p_hash text, p_action text, p_decisions jsonb, p_name text, p_note text default '') returns jsonb
language plpgsql security definer set search_path = '' as $$
declare l public.customer_links := app.portal_link(p_token, true); r public.records; v_items jsonb := '[]'; v_rejected jsonb := '[]'; x jsonb; d text;
  v_labor bigint; v_total bigint := 0; v_status text; v_name text := btrim(coalesce(p_name, '')); v_snapshot jsonb;
begin
  if l.id is null then perform app.fail('Link expirado, revogado ou inválido. Peça um novo link à oficina.'); end if;
  select * into r from public.records where id = p_record and id in (select id from app.portal_records(l)) for update;
  if r.id is null or r.kind <> 'orcamentos' then perform app.fail('Orçamento não encontrado neste link.'); end if;
  if length(v_name) not between 3 and 120 then perform app.fail('Informe seu nome completo.'); end if;
  v_snapshot := app.portal_record(r);
  if p_action = 'question' then
    if length(btrim(coalesce(p_note, ''))) not between 3 and 1000 then perform app.fail('Descreva sua dúvida.'); end if;
    insert into public.estimate_decisions (tenant_id, record_id, link_id, kind, snapshot, content_hash, signer_name, note) values (r.tenant_id, r.id, l.id, 'question', v_snapshot, app.quote_hash(r), v_name, btrim(p_note));
    update public.records set history = history || app.history('Dúvida do cliente (' || v_name || '): ' || left(btrim(p_note), 300)) where id = r.id;
    insert into public.notifications (tenant_id, type, title, body, module, data) values (r.tenant_id, 'estimate.question', 'Cliente pediu esclarecimento', r.title, 'orcamentos', jsonb_build_object('recordId', r.id));
    perform app.audit(r.tenant_id, 'Portal: esclarecimento solicitado', 'record', r.id::text);
    return jsonb_build_object('status', r.status);
  end if;
  if p_action <> 'decide' then perform app.fail('Ação inválida.'); end if;
  if r.status not in ('Aberto', 'Enviado') then perform app.fail('Este orçamento já foi respondido ou não aceita mais aprovação.'); end if;
  if coalesce(r.fields ->> 'validUntil', '') ~ '^\d{4}-\d{2}-\d{2}$' and (r.fields ->> 'validUntil')::date < (now() at time zone 'America/Sao_Paulo')::date then perform app.fail('Orçamento vencido. Peça uma nova proposta à oficina.'); end if;
  if p_hash is distinct from app.quote_hash(r) then perform app.fail('O orçamento foi alterado pela oficina. Recarregue a página para ver os valores atuais.'); end if;
  if jsonb_typeof(p_decisions) <> 'object' then perform app.fail('Decisões inválidas.'); end if;
  for x in select * from jsonb_array_elements(r.items) loop
    d := p_decisions ->> (x ->> 'productId');
    if d is null or d not in ('approve', 'reject') then perform app.fail('Aprove ou recuse cada item.'); end if;
    if d = 'approve' then v_items := v_items || x; v_total := v_total + (x ->> 'quantity')::bigint * (x ->> 'price')::bigint; else v_rejected := v_rejected || x; end if;
  end loop;
  v_labor := app.parse_cents(r.fields ->> 'labor');
  if v_labor > 0 then
    d := p_decisions ->> 'labor';
    if d is null or d not in ('approve', 'reject') then perform app.fail('Aprove ou recuse a mão de obra.'); end if;
    if d = 'reject' then v_labor := 0; end if;
  end if;
  v_total := v_total + v_labor;
  v_status := case when v_total > 0 then 'Aprovado' else 'Recusado' end;
  insert into public.estimate_decisions (tenant_id, record_id, link_id, kind, decisions, snapshot, content_hash, approved_total, signer_name, note)
  values (r.tenant_id, r.id, l.id, 'decision', p_decisions, v_snapshot, app.quote_hash(r), v_total, v_name, left(btrim(coalesce(p_note, '')), 1000));
  update public.records set status = v_status, items = v_items, amount = v_total,
    fields = fields || jsonb_build_object('labor', to_char(v_labor / 100.0, 'FM999999990.00'), 'decision', jsonb_build_object('at', now(), 'name', v_name, 'originalTotal', r.amount, 'approvedTotal', v_total, 'rejected', v_rejected, 'rejectedLabor', app.parse_cents(r.fields ->> 'labor') - v_labor)::text),
    history = history || app.history(format('Cliente %s pelo portal (%s): %s aprovados, %s recusados; total aprovado %s centavos.', lower(v_status), v_name, jsonb_array_length(v_items), jsonb_array_length(v_rejected), v_total))
  where id = r.id;
  perform app.audit(r.tenant_id, 'Portal: orçamento ' || lower(v_status), 'record', r.id::text, jsonb_build_object('approvedTotal', v_total, 'originalTotal', r.amount));
  perform app.emit(r.tenant_id, 'record.status', jsonb_build_object('kind', 'orcamentos', 'recordId', r.id, 'title', r.title, 'from', r.status, 'to', v_status, 'customerId', r.customer_id));
  return jsonb_build_object('status', v_status, 'approvedTotal', v_total);
end $$;

-- ---------------------------------------------------------------- cotação aprovada → compra pendente (pedido firme só por usuário com permissão)
create or replace function public.approve_supplier_quote(p_tenant uuid, p_id uuid, p_supplier uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare r public.records; q jsonb; x jsonb; v_items jsonb := '[]'; v_price bigint; v_total bigint := 0; v_id uuid; v_lead int;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_id and kind = 'cotacoes' for update;
  if r.id is null then perform app.fail('Cotação não encontrada.'); end if;
  perform app.require(p_tenant, 'compras', 'cadastrar', r.branch_id);
  if r.converted_id is not null then return r.converted_id; end if;
  if r.status not in ('Aberta', 'Enviada', 'Respondida') then perform app.fail('Cotação encerrada.'); end if;
  if not exists (select 1 from public.records where tenant_id = p_tenant and kind = 'fornecedores' and id = p_supplier and status <> 'Inativo') then perform app.fail('Fornecedor inválido ou inativo.'); end if;
  select e into q from jsonb_array_elements(case when coalesce(r.fields ->> 'responses', '') ~ '^\[' then (r.fields ->> 'responses')::jsonb else '[]' end) e where e ->> 'supplierId' = p_supplier::text limit 1;
  if q is null then perform app.fail('Registre a proposta do fornecedor antes de aprovar.'); end if;
  if coalesce(q ->> 'validUntil', '') ~ '^\d{4}-\d{2}-\d{2}$' and (q ->> 'validUntil')::date < current_date then perform app.fail('Proposta vencida.'); end if;
  for x in select * from jsonb_array_elements(r.items) loop
    v_price := app.int_val(q -> 'prices' -> (x ->> 'productId'), 'Preço de ' || (x ->> 'name'));
    v_items := v_items || jsonb_build_object('productId', x ->> 'productId', 'name', x ->> 'name', 'quantity', (x ->> 'quantity')::int, 'price', v_price, 'cost', v_price);
    v_total := v_total + (x ->> 'quantity')::bigint * v_price;
  end loop;
  v_lead := coalesce(nullif(q ->> 'leadDays', '')::int, 0);
  insert into public.records (tenant_id, branch_id, kind, title, status, amount, fields, items, history)
  values (p_tenant, r.branch_id, 'compras', r.title, 'Pendente', v_total,
    jsonb_build_object('supplierId', p_supplier::text, 'expectedDate', (current_date + v_lead)::text, 'dueDate', (current_date + greatest(v_lead, 1))::text, 'invoice', '', 'sourceId', r.id::text,
      'notes', 'Gerada da cotação ' || r.title || coalesce(' · frete informado: ' || nullif(q ->> 'freight', '0') || ' centavos (lançar à parte)', '')),
    v_items, app.history('Compra criada da cotação aprovada por ' || app.user_name())) returning id into v_id;
  update public.records set status = 'Aprovada', converted_id = v_id, fields = fields || jsonb_build_object('chosenSupplier', p_supplier::text),
    history = history || app.history('Proposta aprovada por ' || app.user_name() || '; compra pendente gerada.') where id = r.id;
  perform app.audit(p_tenant, 'Cotação aprovada; compra gerada', 'record', r.id::text, jsonb_build_object('purchaseId', v_id, 'supplierId', p_supplier, 'total', v_total));
  perform app.emit(p_tenant, 'record.created', jsonb_build_object('kind', 'compras', 'recordId', v_id, 'title', r.title));
  return v_id;
end $$;

-- ---------------------------------------------------------------- Mecânico IA: autorização própria (quem edita a OS), plano com IA e assinatura ativa
create or replace function public.authorize_mechanic_ai(p_tenant uuid, p_record uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare r public.records;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_record and kind = 'ordens-servico';
  if r.id is null then perform app.fail('Ordem de serviço não encontrada.'); end if;
  perform app.require(p_tenant, 'ordens-servico', 'editar', r.branch_id);
  if not app.plan_feature(p_tenant, 'assistente') then perform app.fail('IA não incluída no plano atual.', '42501'); end if;
  if not exists (select 1 from public.tenants where id = p_tenant and status in ('Teste', 'Ativa') and due_date >= current_date) then perform app.fail('Assinatura sem acesso à IA.', '42501'); end if;
  -- Contexto mínimo: OS e catálogo ativo (nome/SKU), sem custos nem dados pessoais do cliente.
  return jsonb_build_object('os', jsonb_build_object('title', r.title, 'status', r.status, 'complaint', r.fields ->> 'complaint', 'items', (select coalesce(jsonb_agg(x ->> 'name'), '[]') from jsonb_array_elements(r.items) x)),
    'products', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'sku', p.sku) order by p.name), '[]') from (select * from public.products where tenant_id = p_tenant and active order by name limit 300) p));
end $$;

-- ---------------------------------------------------------------- permissões de execução
revoke all on function public.workshop_settings(uuid), public.save_workshop_settings(uuid, jsonb), public.dismiss_alert(uuid, text, date), public.update_os_work(uuid, uuid, jsonb),
  public.add_record_attachment(uuid, uuid, text, text, boolean), public.set_attachment(uuid, uuid, boolean, boolean), public.create_customer_link(uuid, text, uuid, integer),
  public.revoke_customer_links(uuid, uuid), public.approve_supplier_quote(uuid, uuid, uuid), public.authorize_mechanic_ai(uuid, uuid) from public, anon;
grant execute on function public.authorize_mechanic_ai(uuid, uuid) to authenticated;
grant execute on function public.workshop_settings(uuid), public.save_workshop_settings(uuid, jsonb), public.dismiss_alert(uuid, text, date), public.update_os_work(uuid, uuid, jsonb),
  public.add_record_attachment(uuid, uuid, text, text, boolean), public.set_attachment(uuid, uuid, boolean, boolean), public.create_customer_link(uuid, text, uuid, integer),
  public.revoke_customer_links(uuid, uuid), public.approve_supplier_quote(uuid, uuid, uuid) to authenticated;
revoke all on function public.portal_view(text), public.portal_decide(text, uuid, text, text, jsonb, text, text) from public;
grant execute on function public.portal_view(text), public.portal_decide(text, uuid, text, text, jsonb, text, text) to anon, authenticated;
revoke all on function app.portal_link(text, boolean), app.portal_records(public.customer_links), app.portal_record(public.records), app.quote_hash(public.records) from public, anon, authenticated;

-- ---------------------------------------------------------------- Chatbot WhatsApp (Gemini): reserva idempotente por mensagem recebida
create table public.whatsapp_bot_replies (
  message_id uuid primary key references public.whatsapp_messages(id) on delete cascade,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  status text not null default 'claimed' check (status in ('claimed', 'sent', 'skipped', 'failed')),
  reason text,
  provider_id text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
alter table public.whatsapp_bot_replies enable row level security;
alter table public.whatsapp_bot_replies force row level security;
grant select, insert, update, delete on public.whatsapp_bot_replies to service_role;

create or replace function app.bot_skip(p_message uuid, p_reason text) returns jsonb
language sql security definer set search_path = '' as $$
  update public.whatsapp_bot_replies set status = 'skipped', reason = p_reason, finished_at = now() where message_id = p_message;
  select jsonb_build_object('skip', p_reason)
$$;

-- Reserva a resposta (uma por mensagem) e devolve contexto mínimo: últimas mensagens da conversa, persona e artigos públicos da loja.
-- Revalida no momento: instância aberta, bot ligado, conversa não assumida por humano, IA habilitada e quota disponível.
create or replace function public.svc_bot_claim(p_message uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare m public.whatsapp_messages; inst public.whatsapp_instances; c public.whatsapp_contacts; s public.ai_settings; v_quota bigint; t public.tenants;
begin
  select * into m from public.whatsapp_messages where id = p_message and direction = 'in';
  if m.id is null then return jsonb_build_object('skip', 'message_not_found'); end if;
  insert into public.whatsapp_bot_replies (message_id, tenant_id) values (m.id, m.tenant_id) on conflict do nothing;
  if not found then return jsonb_build_object('skip', 'duplicate'); end if;
  select * into inst from public.whatsapp_instances where id = m.instance_id;
  select * into c from public.whatsapp_contacts where instance_id = m.instance_id and remote_jid = m.remote_jid;
  select * into s from public.ai_settings where tenant_id = m.tenant_id;
  select * into t from public.tenants where id = m.tenant_id;
  if inst.status <> 'open' or not inst.bot_enabled then return app.bot_skip(m.id, 'bot_off_or_disconnected'); end if;
  if c.bot_paused or c.assigned_to is not null then return app.bot_skip(m.id, 'human_handling'); end if;
  if m.created_at < now() - interval '15 minutes' then return app.bot_skip(m.id, 'stale'); end if;
  if length(btrim(m.body)) = 0 then return app.bot_skip(m.id, 'empty'); end if;
  if not app.plan_feature(m.tenant_id, 'assistente') then return app.bot_skip(m.id, 'plan'); end if;
  v_quota := app.svc_ai_take_quota(m.tenant_id, 'whatsapp');
  if v_quota is null then return app.bot_skip(m.id, 'quota_or_disabled'); end if;
  return jsonb_build_object('tenantId', m.tenant_id, 'quota', v_quota, 'instance', inst.instance_name, 'remote', m.remote_jid, 'store', t.name, 'persona', coalesce(s.persona, ''),
    'history', (select coalesce(jsonb_agg(jsonb_build_object('role', case when x.direction = 'in' then 'user' else 'model' end, 'text', left(x.body, 1500)) order by x.created_at), '[]')
      from (select * from public.whatsapp_messages where instance_id = m.instance_id and remote_jid = m.remote_jid and created_at <= m.created_at and body <> '' order by created_at desc limit 8) x),
    'knowledge', (select coalesce(jsonb_agg(jsonb_build_object('title', k.title, 'body', left(k.body, 1500))), '[]') from (select * from public.knowledge_articles where tenant_id = m.tenant_id and public order by created_at desc limit 12) k));
end $$;



create or replace function public.svc_bot_finish(p_message uuid, p_provider_id text, p_error text) returns void
language sql security definer set search_path = '' as $$
  update public.whatsapp_bot_replies set status = case when p_error is null then 'sent' else 'failed' end, provider_id = p_provider_id, reason = left(p_error, 200), finished_at = now()
  where message_id = p_message and status = 'claimed'
$$;
revoke all on function public.svc_bot_claim(uuid), public.svc_bot_finish(uuid, text, text), app.bot_skip(uuid, text) from public, anon, authenticated;
grant execute on function public.svc_bot_claim(uuid), public.svc_bot_finish(uuid, text, text) to service_role;

-- Mensagens recebidas nos últimos 15 min ainda sem decisão do bot (o worker reserva cada uma com svc_bot_claim).
create or replace function public.svc_bot_pending(p_limit integer default 10) returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.id from public.whatsapp_messages m join public.whatsapp_instances i on i.id = m.instance_id
  where m.direction = 'in' and m.created_at > now() - interval '15 minutes' and i.bot_enabled and i.status = 'open'
    and not exists (select 1 from public.whatsapp_bot_replies r where r.message_id = m.id)
  order by m.created_at limit least(greatest(p_limit, 1), 25)
$$;
revoke all on function public.svc_bot_pending(integer) from public, anon, authenticated;
grant execute on function public.svc_bot_pending(integer) to service_role;

-- ---------------------------------------------------------------- Status de entrega (MESSAGES_UPDATE): só avança (sent → delivered → read); falha só antes de entregue.
create or replace function public.whatsapp_message_status(p_instance text, p_external_id text, p_status text) returns text
language plpgsql security definer set search_path = '' as $$
declare v_rank int := case p_status when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 1 end; m public.whatsapp_messages;
begin
  if v_rank is null then return 'ignored'; end if;
  select w.* into m from public.whatsapp_messages w join public.whatsapp_instances i on i.id = w.instance_id where i.instance_name = p_instance and w.external_id = p_external_id for update of w;
  if m.id is null then return 'unknown'; end if;
  if (case m.status when 'pending' then 0 when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end) >= v_rank and not (p_status = 'failed' and m.status in ('pending', 'sent')) then return 'kept'; end if;
  update public.whatsapp_messages set status = p_status where id = m.id;
  return p_status;
end $$;
revoke all on function public.whatsapp_message_status(text, text, text) from public, anon, authenticated;
grant execute on function public.whatsapp_message_status(text, text, text) to service_role;

-- ---------------------------------------------------------------- Super Admin: última operação real por serviço e respostas do bot
create or replace function public.admin_integration_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_platform_admin();
  return jsonb_build_object(
    'outbox', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.outbox_events group by 1) x),
    'outboxLastError', (select jsonb_build_object('type', type, 'error', last_error, 'at', coalesce(processed_at, created_at)) from public.outbox_events where last_error is not null and last_error <> 'tenant_removed' order by id desc limit 1),
    'push', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.notification_deliveries where created_at > now() - interval '7 days' group by 1) x),
    'pushDevices', (select count(*) from public.push_subscriptions where expired_at is null),
    'pushLastError', (select jsonb_build_object('status', last_status, 'error', last_error, 'at', created_at) from public.notification_deliveries where status in ('dead','expired') order by id desc limit 1),
    'email', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.email_messages where created_at > now() - interval '7 days' group by 1) x),
    'emailLastError', (select jsonb_build_object('template', template, 'error', last_error, 'at', created_at) from public.email_messages where last_error is not null order by created_at desc limit 1),
    'billing', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.webhook_events where provider = 'InfinitePay' group by 1) x),
    'billingLastError', (select jsonb_build_object('error', error, 'at', received_at) from public.webhook_events where provider = 'InfinitePay' and error is not null order by id desc limit 1),
    'whatsapp', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.whatsapp_instances group by 1) x),
    'ai', (select jsonb_build_object('requests', count(*), 'inputTokens', coalesce(sum(input_tokens), 0), 'outputTokens', coalesce(sum(output_tokens), 0), 'blocked', count(*) filter (where blocked is not null))
           from public.ai_usage where created_at > now() - interval '30 days'),
    -- Última operação real confirmada pelo provedor (não apenas configuração).
    'lastReal', jsonb_build_object(
      'email', (select max(sent_at) from public.email_messages where provider_id is not null),
      'push', (select max(sent_at) from public.notification_deliveries where status = 'sent'),
      'whatsappOut', (select max(created_at) from public.whatsapp_messages where direction = 'out' and status in ('sent','delivered','read')),
      'whatsappIn', (select max(created_at) from public.whatsapp_messages where direction = 'in'),
      'ai', (select max(created_at) from public.ai_usage where blocked is null and output_tokens > 0),
      'billing', (select max(received_at) from public.webhook_events where provider = 'InfinitePay' and error is null)),
    'bot', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.whatsapp_bot_replies where created_at > now() - interval '7 days' group by 1) x)
  );
end $$;

-- ---------------------------------------------------------------- Bot: o interruptor da loja liga instância e canal WhatsApp da IA juntos.
-- A IA em si (ai_settings.enabled) continua liberada pelo Super Admin/plano; sem ela o bot fica registrado como "quota_or_disabled".
create or replace function public.set_whatsapp_bot(p_tenant uuid, p_instance uuid, p_enabled boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform app.require(p_tenant, 'whatsapp', 'configurar');
  if p_enabled and not app.plan_feature(p_tenant, 'assistente') then perform app.fail('IA não incluída no plano atual.', '42501'); end if;
  update public.whatsapp_instances set bot_enabled = p_enabled, updated_at = now() where tenant_id = p_tenant and id = p_instance;
  if not found then perform app.fail('Instância não encontrada.'); end if;
  insert into public.ai_settings (tenant_id, whatsapp_bot) values (p_tenant, p_enabled)
  on conflict (tenant_id) do update set whatsapp_bot = excluded.whatsapp_bot, updated_at = now();
  perform app.audit(p_tenant, case when p_enabled then 'Assistente automático do WhatsApp ativado' else 'Assistente automático do WhatsApp desativado' end, 'whatsapp', p_instance::text);
end $$;

-- Situação da IA para a tela do WhatsApp (sem custos, sem chaves).
create or replace function public.whatsapp_bot_status(p_tenant uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare s public.ai_settings; v_plan public.plans := app.plan_of(p_tenant);
begin
  perform app.require(p_tenant, 'whatsapp', 'visualizar');
  select * into s from public.ai_settings where tenant_id = p_tenant;
  return jsonb_build_object('planIncludes', app.plan_feature(p_tenant, 'assistente'), 'aiEnabled', coalesce(s.enabled, false), 'channel', coalesce(s.whatsapp_bot, false),
    'dailyLimit', least(coalesce(s.daily_limit, 50), v_plan.ai_messages), 'usedToday', (select count(*) from public.ai_usage where tenant_id = p_tenant and created_at >= date_trunc('day', now())),
    'last7', (select coalesce(jsonb_object_agg(status, n), '{}') from (select status, count(*) n from public.whatsapp_bot_replies where tenant_id = p_tenant and created_at > now() - interval '7 days' group by 1) x));
end $$;
revoke all on function public.whatsapp_bot_status(uuid) from public, anon;
grant execute on function public.whatsapp_bot_status(uuid) to authenticated;

-- ---------------------------------------------------------------- Resend: histórico de eventos (dedupe por svix-id) e estados completos
create table public.email_events (
  event_id text primary key,                -- svix-id (único por entrega do webhook; reenvio do mesmo evento não duplica)
  provider_id text not null,
  type text not null,
  email_message_id uuid references public.email_messages(id) on delete cascade,
  tenant_id uuid,
  result text not null,
  received_at timestamptz not null default now()
);
create index on public.email_events (provider_id);
alter table public.email_events enable row level security;
alter table public.email_events force row level security;
grant select, insert, update, delete on public.email_events to service_role;

-- Estado só avança (sent → delivered); bounce/complaint são finais; failed só antes de entregue; delayed não muda estado.
create or replace function public.email_webhook_event(p_event_id text, p_provider_id text, p_type text) returns text
language plpgsql security definer set search_path = '' as $$
declare m public.email_messages; v text := case p_type when 'email.delivered' then 'delivered' when 'email.bounced' then 'bounced' when 'email.complained' then 'complained' when 'email.failed' then 'failed' end; r text;
begin
  if p_event_id is null or length(p_event_id) not between 4 and 120 or p_provider_id is null or length(p_provider_id) > 120 then return 'invalid'; end if;
  select * into m from public.email_messages where provider_id = p_provider_id for update;
  r := case when m.id is null then 'unknown' when v is null then 'recorded'
    when v = 'delivered' and m.status = 'sent' then 'delivered'
    when v in ('bounced', 'complained') and m.status in ('sent', 'delivered') then v
    when v = 'failed' and m.status = 'sent' then 'failed' else 'kept' end;
  insert into public.email_events (event_id, provider_id, type, email_message_id, tenant_id, result) values (p_event_id, p_provider_id, left(p_type, 60), m.id, m.tenant_id, r) on conflict (event_id) do nothing;
  if not found then return 'duplicate'; end if;
  if r in ('delivered', 'bounced', 'complained', 'failed') then
    update public.email_messages set status = r, last_error = case when r in ('bounced', 'complained', 'failed') then 'provider:' || p_type else last_error end where id = m.id;
  end if;
  return r;
end $$;
revoke all on function public.email_webhook_event(text, text, text) from public, anon, authenticated;
grant execute on function public.email_webhook_event(text, text, text) to service_role;
