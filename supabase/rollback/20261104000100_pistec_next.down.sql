-- ROLLBACK de 20261104000100_pistec_next.sql — executar só com autorização, dentro de transação.
-- ATENÇÃO: apaga dados das tabelas novas (fotos, links do portal, decisões de orçamento, configurações da oficina).
-- Registros 'cotacoes' e 'frotas' em public.records ficam preservados, mas sem RPC de transição própria.
begin;
drop function if exists public.workshop_settings(uuid), public.save_workshop_settings(uuid, jsonb), public.dismiss_alert(uuid, text, date), public.update_os_work(uuid, uuid, jsonb),
  public.add_record_attachment(uuid, uuid, text, text, boolean), public.set_attachment(uuid, uuid, boolean, boolean), public.create_customer_link(uuid, text, uuid, integer),
  public.revoke_customer_links(uuid, uuid), public.portal_view(text), public.portal_decide(text, uuid, text, text, jsonb, text, text), public.approve_supplier_quote(uuid, uuid, uuid),
  public.authorize_mechanic_ai(uuid, uuid), app.portal_link(text, boolean), app.portal_records(public.customer_links), app.portal_record(public.records), app.quote_hash(public.records), app.agenda_min(text);
drop function if exists public.whatsapp_message_status(text, text, text), public.svc_bot_pending(integer), public.svc_bot_claim(uuid), public.svc_bot_finish(uuid, text, text), app.bot_skip(uuid, text);
drop table if exists public.whatsapp_bot_replies, public.estimate_decisions, public.customer_links, public.record_attachments, public.workshop_settings;

create or replace function app.record_module(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'cart' then 'pdv' when 'instancias' then 'whatsapp' when 'mensagens' then 'whatsapp' else p_kind end
$$;

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
  if v_kind in ('compras', 'orcamentos', 'ordens-servico') and jsonb_array_length(v_items) = 0 and app.parse_cents(v_fields ->> 'labor') = 0 then perform app.fail('Adicione produtos ou um valor de mão de obra.'); end if;
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
  if r.kind = 'crm' and v_status = 'Perdido' then v_fields := v_fields || jsonb_build_object('lossReason', app.req_text(p_reason, 'Motivo da perda')); end if;
  update public.records set status = v_status, fields = v_fields,
    history = history || app.history('Status: ' || v_status || ' por ' || app.user_name() || case when p_reason is not null then ' — ' || p_reason else '' end)
  where id = r.id;
  perform app.audit(p_tenant, r.id || ': ' || v_status, 'record', r.id::text);
  perform app.emit(p_tenant, 'record.status', jsonb_build_object('kind', r.kind, 'recordId', r.id, 'title', r.title, 'from', r.status, 'to', v_status, 'customerId', r.customer_id));
end $$;

delete from supabase_migrations.schema_migrations where version = '20261104000100';
commit;
