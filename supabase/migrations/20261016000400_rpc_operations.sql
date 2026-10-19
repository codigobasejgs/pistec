-- PISTEC 3.0 — RPCs transacionais: venda, cancelamento, caixa, financeiro, registros, OS, compras, conversões.
-- Espelham src/domain.ts. Concorrência: locks de linha (for update) em ordem estável + advisory lock por request_id.

create or replace function app.is_cash(m text) returns boolean
language sql immutable set search_path = '' as $$ select app.norm(m) in ('dinheiro', 'cash') $$;

create or replace function app.valid_method(m text) returns boolean
language sql immutable set search_path = '' as $$
  select app.norm(m) in ('dinheiro', 'cash', 'pix', 'cartao', 'credito', 'debito', 'cartao de credito', 'cartao de debito', 'transferencia', 'boleto')
$$;

create or replace function app.add_finance(p_tenant uuid, p_branch uuid, p_type text, p_category text, p_description text, p_amount bigint, p_due date, p_paid boolean, p_reference text)
returns uuid language sql security definer set search_path = '' as $$
  insert into public.financial_entries (tenant_id, branch_id, type, category, description, amount, due_date, paid, reference)
  values (p_tenant, p_branch, p_type, p_category, p_description, p_amount, p_due, p_paid, p_reference) returning id
$$;

create or replace function app.cash_total(p_cash uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select c.opening + coalesce((select sum(amount) from public.cash_movements where cash_id = c.id), 0) from public.cash_registers c where c.id = p_cash
$$;

-- Venda no formato do frontend (types.ts Sale).
create or replace function app.sale_json(p_sale uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('id', s.id, 'tenantId', s.tenant_id, 'branchId', s.branch_id, 'customerId', coalesce(s.customer_id::text, ''), 'seller', s.seller,
    'items', coalesce((select jsonb_agg(jsonb_build_object('productId', i.product_id, 'name', i.name, 'quantity', i.quantity, 'price', i.price, 'cost', i.cost) order by i.product_id) from public.sale_items i where i.sale_id = s.id), '[]'),
    'discount', s.discount, 'surcharge', s.surcharge, 'total', s.total,
    'payments', coalesce((select jsonb_agg(jsonb_strip_nulls(jsonb_build_object('method', p.method, 'amount', p.amount, 'tendered', p.tendered)) order by p.position) from public.sale_payments p where p.sale_id = s.id), '[]'),
    'change', s.change, 'status', s.status, 'date', s.created_at, 'requestId', s.request_id, 'cashId', s.cash_id)
  from public.sales s where s.id = p_sale
$$;

-- ---------------------------------------------------------------- venda
create or replace function public.complete_sale(p jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := app.uuid_or_null(p ->> 'tenantId');
  v_branch uuid := app.uuid_or_null(p ->> 'branchId');
  v_customer uuid := app.uuid_or_null(p ->> 'customerId');
  v_request text := app.req_text(p ->> 'requestId', 'Chave da venda');
  v_cart uuid := app.uuid_or_null(p ->> 'cartId');
  v_discount bigint := app.int_val(coalesce(p -> 'discount', '0'), 'Desconto');
  v_surcharge bigint := app.int_val(coalesce(p -> 'surcharge', '0'), 'Acréscimo');
  v_hash text; prev public.sales; cash public.cash_registers; v_sale uuid := gen_random_uuid(); v_seller text;
  it record; pay record; b public.stock_balances; pr public.products;
  v_subtotal bigint := 0; v_total bigint; v_noncash bigint := 0; v_cash_tendered bigint := 0; v_cash_needed bigint; v_remaining bigint; v_applied bigint; v_pos int := 0;
  v_fin uuid; v_first_method text; cart public.records;
begin
  perform app.require(v_tenant, 'pdv', 'cadastrar', v_branch);
  perform app.branch_ok(v_tenant, v_branch);
  if jsonb_typeof(p -> 'items') <> 'array' or jsonb_typeof(p -> 'payments') <> 'array' then perform app.fail('Venda inválida.'); end if;
  -- Conteúdo canônico para idempotência: itens agregados e ordenados, pagamentos em ordem.
  v_hash := md5(jsonb_build_array(v_branch, v_customer, v_discount, v_surcharge,
    (select coalesce(jsonb_agg(jsonb_build_array(k, q) order by k), '[]') from (select x ->> 'productId' k, sum((x ->> 'quantity')::numeric) q from jsonb_array_elements(p -> 'items') x group by 1) t),
    (select coalesce(jsonb_agg(jsonb_build_array(x ->> 'method', x -> 'amount') order by o), '[]') from jsonb_array_elements(p -> 'payments') with ordinality y(x, o)))::text);
  perform pg_advisory_xact_lock(hashtextextended('sale:' || v_tenant::text || ':' || v_request, 0));
  select * into prev from public.sales where tenant_id = v_tenant and request_id = v_request;
  if prev.id is not null then
    if prev.request_hash <> v_hash then perform app.fail('Chave da venda já utilizada com outro conteúdo.'); end if;
    return app.sale_json(prev.id);
  end if;
  if v_customer is not null and not exists (select 1 from public.customers where tenant_id = v_tenant and id = v_customer) then perform app.fail('Cliente inválido.'); end if;
  if jsonb_array_length(p -> 'items') = 0 then perform app.fail('Adicione produtos à venda.'); end if;
  select * into cash from public.cash_registers where tenant_id = v_tenant and branch_id = v_branch and closed_at is null for update;
  if cash.id is null then perform app.fail('Abra o caixa antes de vender.'); end if;
  v_seller := app.user_name();

  insert into public.sales (id, tenant_id, branch_id, customer_id, seller, seller_id, discount, surcharge, total, request_id, request_hash, cash_id)
  values (v_sale, v_tenant, v_branch, v_customer, v_seller, auth.uid(), v_discount, v_surcharge, 1, v_request, v_hash, cash.id);

  for it in
    select app.uuid_or_null(x ->> 'productId') product_id, sum(app.int_val(x -> 'quantity', 'Quantidade', 1)) quantity
    from jsonb_array_elements(p -> 'items') x group by 1 order by 1
  loop
    select * into pr from public.products where tenant_id = v_tenant and id = it.product_id and active;
    if pr.id is null then perform app.fail('Produto inválido ou inativo.'); end if;
    b := app.lock_balance(v_tenant, v_branch, it.product_id);
    if b.quantity - b.reserved < it.quantity then perform app.fail('Estoque disponível insuficiente: ' || pr.name || '.'); end if;
    update public.stock_balances set quantity = quantity - it.quantity where tenant_id = v_tenant and branch_id = v_branch and product_id = it.product_id;
    insert into public.sale_items (sale_id, tenant_id, product_id, name, quantity, price, cost) values (v_sale, v_tenant, it.product_id, pr.name, it.quantity, pr.price, pr.cost);
    insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (v_tenant, v_branch, it.product_id, it.quantity, 'Saída', v_sale::text, auth.uid());
    v_subtotal := v_subtotal + pr.price * it.quantity;
  end loop;
  if v_discount > v_subtotal then perform app.fail('Desconto superior ao subtotal.'); end if;
  v_total := v_subtotal - v_discount + v_surcharge;
  if v_total < 1 then perform app.fail('Total: valor inteiro inválido.'); end if;

  if jsonb_array_length(p -> 'payments') = 0 then perform app.fail('Pagamento obrigatório.'); end if;
  for pay in select x ->> 'method' method, app.int_val(x -> 'amount', 'Pagamento', 1) amount from jsonb_array_elements(p -> 'payments') x loop
    if not app.valid_method(pay.method) then perform app.fail('Forma de pagamento inválida.'); end if;
    if app.is_cash(pay.method) then v_cash_tendered := v_cash_tendered + pay.amount; else v_noncash := v_noncash + pay.amount; end if;
  end loop;
  if v_noncash > v_total then perform app.fail('Valor de formas não-dinheiro excede o total da venda.'); end if;
  v_cash_needed := v_total - v_noncash;
  if v_cash_tendered < v_cash_needed then perform app.fail('Pagamento insuficiente.'); end if;
  v_remaining := v_cash_needed;
  for pay in select x ->> 'method' method, (x ->> 'amount')::bigint amount, o from jsonb_array_elements(p -> 'payments') with ordinality y(x, o) order by o loop
    v_pos := v_pos + 1;
    v_first_method := coalesce(v_first_method, btrim(pay.method));
    if app.is_cash(pay.method) then
      v_applied := least(pay.amount, v_remaining); v_remaining := v_remaining - v_applied;
      insert into public.sale_payments (sale_id, tenant_id, position, method, amount, tendered) values (v_sale, v_tenant, v_pos, btrim(pay.method), v_applied, pay.amount);
    else
      insert into public.sale_payments (sale_id, tenant_id, position, method, amount) values (v_sale, v_tenant, v_pos, btrim(pay.method), pay.amount);
    end if;
  end loop;
  update public.sales set total = v_total, change = v_cash_tendered - v_cash_needed where id = v_sale;
  if v_cash_needed > 0 then insert into public.cash_movements (tenant_id, cash_id, amount, reason) values (v_tenant, cash.id, v_cash_needed, 'Venda ' || v_sale); end if;
  v_fin := app.add_finance(v_tenant, v_branch, 'Receita', 'Vendas', 'Venda ' || v_sale, v_total, current_date, true, v_sale::text);
  insert into public.settlements (entry_id, tenant_id, request_id, amount, date, method, user_name, note)
  values (v_fin, v_tenant, 'sale:' || v_sale, v_total, current_date, coalesce(v_first_method, 'Dinheiro'), v_seller, 'Quitação automática da venda ' || v_sale);
  if v_cart is not null then
    select * into cart from public.records where tenant_id = v_tenant and id = v_cart and kind = 'cart' for update;
    if cart.id is null or cart.status not in ('Suspenso', 'Retomado') then perform app.fail('Carrinho suspenso já utilizado ou removido.'); end if;
    update public.records set status = 'Concluído', fields = fields || jsonb_build_object('saleId', v_sale),
      history = history || jsonb_build_array(jsonb_build_object('date', now(), 'text', 'Venda concluída: ' || v_sale)) where id = v_cart;
  end if;
  for it in select product_id from public.sale_items where sale_id = v_sale loop perform app.check_low_stock(v_tenant, v_branch, it.product_id); end loop;
  perform app.audit(v_tenant, 'Venda concluída ' || v_sale, 'sale', v_sale::text, jsonb_build_object('total', v_total));
  perform app.emit(v_tenant, 'sale.completed', jsonb_build_object('saleId', v_sale, 'total', v_total, 'branchId', v_branch));
  return app.sale_json(v_sale);
end $$;

create or replace function public.cancel_sale(p_tenant uuid, p_sale uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare s public.sales; cash public.cash_registers; v_net bigint; it record; v_fin uuid;
begin
  select * into s from public.sales where tenant_id = p_tenant and id = p_sale for update;
  if s.id is null then perform app.fail('Venda não encontrada.'); end if;
  perform app.require(p_tenant, 'vendas', 'cancelar', s.branch_id);
  if s.status = 'Cancelada' then return; end if;
  select coalesce(sum(amount), 0) into v_net from public.sale_payments where sale_id = s.id and app.is_cash(method);
  select * into cash from public.cash_registers where id = s.cash_id for update;
  if v_net > 0 and cash.closed_at is not null then perform app.fail('Não é possível estornar dinheiro em caixa fechado.'); end if;
  if app.cash_total(cash.id) < v_net then perform app.fail('Saldo insuficiente para estorno.'); end if;
  for it in select product_id, quantity from public.sale_items where sale_id = s.id order by product_id loop
    perform app.lock_balance(p_tenant, s.branch_id, it.product_id);
    update public.stock_balances set quantity = quantity + it.quantity where tenant_id = p_tenant and branch_id = s.branch_id and product_id = it.product_id;
    insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (p_tenant, s.branch_id, it.product_id, it.quantity, 'Estorno', s.id::text, auth.uid());
  end loop;
  if v_net > 0 then insert into public.cash_movements (tenant_id, cash_id, amount, reason) values (p_tenant, cash.id, -v_net, 'Estorno ' || s.id); end if;
  v_fin := app.add_finance(p_tenant, s.branch_id, 'Despesa', 'Estornos', 'Estorno da venda ' || s.id, s.total, current_date, true, 'cancel:' || s.id);
  insert into public.settlements (entry_id, tenant_id, request_id, amount, date, method, user_name, note)
  values (v_fin, p_tenant, 'cancel:' || s.id, s.total, current_date, 'Estorno', app.user_name(), 'Estorno automático da venda ' || s.id);
  update public.sales set status = 'Cancelada', cancelled_at = now() where id = s.id;
  perform app.audit(p_tenant, 'Venda cancelada ' || s.id, 'sale', s.id::text);
  perform app.emit(p_tenant, 'sale.cancelled', jsonb_build_object('saleId', s.id, 'total', s.total));
end $$;

-- ---------------------------------------------------------------- caixa
create or replace function public.open_cash(p_tenant uuid, p_branch uuid, p_opening bigint) returns uuid
language plpgsql security definer set search_path = '' as $$
declare existing public.cash_registers; v_id uuid;
begin
  perform app.require(p_tenant, 'caixa', 'editar', p_branch);
  perform app.branch_ok(p_tenant, p_branch);
  if p_opening is null or p_opening < 0 then perform app.fail('Fundo de caixa: valor inteiro inválido.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('cash:' || p_branch::text, 0));
  select * into existing from public.cash_registers where tenant_id = p_tenant and branch_id = p_branch and closed_at is null;
  if existing.id is not null then
    if existing.opening <> p_opening then perform app.fail('Já existe caixa aberto nesta filial.'); end if;
    return existing.id;
  end if;
  insert into public.cash_registers (tenant_id, branch_id, opening, opened_by) values (p_tenant, p_branch, p_opening, auth.uid()) returning id into v_id;
  perform app.audit(p_tenant, 'Caixa aberto: ' || p_branch, 'cash', v_id::text);
  return v_id;
end $$;

create or replace function public.cash_movement(p_tenant uuid, p_cash uuid, p_amount bigint, p_reason text, p_request_id text) returns void
language plpgsql security definer set search_path = '' as $$
declare c public.cash_registers; v_reason text := app.req_text(p_reason, 'Motivo');
begin
  select * into c from public.cash_registers where tenant_id = p_tenant and id = p_cash for update;
  if c.id is null or c.closed_at is not null then perform app.fail('O caixa não está mais aberto.'); end if;
  perform app.require(p_tenant, 'caixa', 'editar', c.branch_id);
  if p_amount = 0 then perform app.fail('Informe motivo e valor maior que zero.'); end if;
  if exists (select 1 from public.cash_movements where cash_id = p_cash and reason = v_reason || ' #' || p_request_id) then return; end if;
  if app.cash_total(p_cash) + p_amount < 0 then perform app.fail('Saldo insuficiente para sangria.'); end if;
  insert into public.cash_movements (tenant_id, cash_id, amount, reason) values (p_tenant, p_cash, p_amount, v_reason || ' #' || app.req_text(p_request_id, 'Chave'));
  perform app.audit(p_tenant, v_reason || ' ' || p_amount, 'cash', p_cash::text);
end $$;

create or replace function public.close_cash(p_tenant uuid, p_cash uuid, p_counted bigint, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare c public.cash_registers; v_expected bigint; v_diff bigint;
begin
  select * into c from public.cash_registers where tenant_id = p_tenant and id = p_cash for update;
  if c.id is null then perform app.fail('Caixa não encontrado.'); end if;
  perform app.require(p_tenant, 'caixa', 'editar', c.branch_id);
  if p_counted is null or p_counted < 0 then perform app.fail('Valor contado: valor inteiro inválido.'); end if;
  if c.closed_at is not null then
    if c.counted <> p_counted then perform app.fail('Caixa já encerrado com outro valor.'); end if;
    return jsonb_build_object('expected', c.expected, 'difference', c.difference);
  end if;
  v_expected := app.cash_total(p_cash); v_diff := p_counted - v_expected;
  if v_diff <> 0 and coalesce(btrim(p_reason), '') = '' then perform app.fail('Diferença de caixa exige motivo.'); end if;
  update public.cash_registers set counted = p_counted, expected = v_expected, difference = v_diff, closing_reason = nullif(btrim(p_reason), ''),
    closed_by = app.user_name(), closed_at = now() where id = p_cash;
  perform app.audit(p_tenant, format('Caixa %s fechado; esperado %s; contado %s; diferença %s', p_cash, v_expected, p_counted, v_diff), 'cash', p_cash::text);
  if v_diff <> 0 then perform app.emit(p_tenant, 'cash.difference', jsonb_build_object('cashId', p_cash, 'difference', v_diff, 'reason', p_reason)); end if;
  return jsonb_build_object('expected', v_expected, 'difference', v_diff);
end $$;

-- ---------------------------------------------------------------- financeiro
create or replace function public.save_entry(p_tenant uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v_id uuid := coalesce(app.uuid_or_null(p ->> 'id'), gen_random_uuid()); e public.financial_entries; v_branch uuid := app.uuid_or_null(p ->> 'branchId');
  v_amount bigint := app.int_val(p -> 'amount', 'Valor', 1);
begin
  perform pg_advisory_xact_lock(hashtextextended('entry-id:' || v_id::text, 0));
  select * into e from public.financial_entries where id = v_id for update;
  if e.id is not null and e.tenant_id <> p_tenant then perform app.fail('Lançamento não encontrado.', '42501'); end if;
  perform app.require(p_tenant, 'financeiro', case when e.id is null then 'cadastrar' else 'editar' end, coalesce(e.branch_id, v_branch));
  if e.id is not null and (e.cancelled or e.reference <> '' or exists (select 1 from public.settlements where entry_id = e.id and reversed_at is null)) then
    perform app.fail('Lançamento com baixas, cancelado ou vinculado não pode ser editado.');
  end if;
  if (p ->> 'type') not in ('Receita', 'Despesa') then perform app.fail('Tipo financeiro inválido.'); end if;
  perform app.branch_ok(p_tenant, coalesce(e.branch_id, v_branch));
  insert into public.financial_entries (id, tenant_id, branch_id, type, category, description, amount, due_date)
  values (v_id, p_tenant, coalesce(e.branch_id, v_branch), p ->> 'type', left(app.req_text(p ->> 'category', 'Categoria'), 80), left(app.req_text(p ->> 'description', 'Descrição'), 300), v_amount, (p ->> 'dueDate')::date)
  on conflict (id) do update set type = excluded.type, category = excluded.category, description = excluded.description, amount = excluded.amount, due_date = excluded.due_date;
  perform app.audit(p_tenant, 'Lançamento salvo: ' || (p ->> 'description'), 'finance', v_id::text);
  return v_id;
end $$;

create or replace function public.settle_entry(p_tenant uuid, p_entry uuid, p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries; prev public.settlements; v_amount bigint := app.int_val(p -> 'amount', 'Valor da baixa', 1);
  v_method text := app.req_text(p ->> 'method', 'Forma de pagamento'); v_request text := app.req_text(p ->> 'requestId', 'Chave da baixa'); v_paid bigint; v_id uuid;
begin
  select * into e from public.financial_entries where tenant_id = p_tenant and id = p_entry for update;
  if e.id is null then perform app.fail('Lançamento não encontrado.'); end if;
  perform app.require(p_tenant, 'financeiro', 'editar', e.branch_id);
  if e.cancelled then perform app.fail('Lançamento cancelado.'); end if;
  select * into prev from public.settlements where entry_id = e.id and request_id = v_request;
  if prev.id is not null then
    if prev.amount <> v_amount or prev.method <> v_method then perform app.fail('Chave da baixa já utilizada com outro conteúdo.'); end if;
    return prev.id;
  end if;
  select coalesce(sum(amount), 0) into v_paid from public.settlements where entry_id = e.id and reversed_at is null;
  if v_amount > e.amount - v_paid then perform app.fail('Valor da baixa superior ao saldo em aberto.'); end if;
  if not app.valid_method(v_method) then perform app.fail('Forma de pagamento inválida.'); end if;
  insert into public.settlements (entry_id, tenant_id, request_id, amount, date, method, user_name, note)
  values (e.id, p_tenant, v_request, v_amount, coalesce(nullif(p ->> 'date', '')::date, current_date), v_method, app.user_name(), left(coalesce(p ->> 'note', ''), 500)) returning id into v_id;
  update public.financial_entries set paid = (v_paid + v_amount >= amount) where id = e.id;
  perform app.audit(p_tenant, format('Baixa %s no valor de %s em %s', v_id, v_amount, e.id), 'finance', e.id::text);
  return v_id;
end $$;

create or replace function public.reverse_settlement(p_tenant uuid, p_entry uuid, p_settlement uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries; s public.settlements;
begin
  select * into e from public.financial_entries where tenant_id = p_tenant and id = p_entry for update;
  if e.id is null then perform app.fail('Lançamento não encontrado.'); end if;
  perform app.require(p_tenant, 'financeiro', 'editar', e.branch_id);
  select * into s from public.settlements where id = p_settlement and entry_id = e.id;
  if s.id is null then perform app.fail('Baixa não encontrada.'); end if;
  if s.reversed_at is not null then return; end if;
  update public.settlements set reversed_at = now(), reversed_by = app.user_name(), reversal_reason = app.req_text(p_reason, 'Motivo do estorno') where id = s.id;
  update public.financial_entries set paid = (select coalesce(sum(amount), 0) from public.settlements where entry_id = e.id and reversed_at is null) >= amount where id = e.id;
  perform app.audit(p_tenant, format('Estorno da baixa %s em %s', s.id, e.id), 'finance', e.id::text);
end $$;

create or replace function public.cancel_entry(p_tenant uuid, p_entry uuid, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.financial_entries;
begin
  select * into e from public.financial_entries where tenant_id = p_tenant and id = p_entry for update;
  if e.id is null then perform app.fail('Lançamento não encontrado.'); end if;
  perform app.require(p_tenant, 'financeiro', 'cancelar', e.branch_id);
  if e.cancelled then return; end if;
  if exists (select 1 from public.settlements where entry_id = e.id and reversed_at is null) then perform app.fail('Não é possível cancelar lançamento com baixas ativas. Estorne as baixas primeiro.'); end if;
  update public.financial_entries set cancelled = true, paid = false where id = e.id;
  perform app.audit(p_tenant, format('Cancelamento do lançamento %s por %s: %s', e.id, app.user_name(), app.req_text(p_reason, 'Motivo do cancelamento')), 'finance', e.id::text);
end $$;

-- ---------------------------------------------------------------- registros operacionais
create or replace function app.record_module(p_kind text) returns text
language sql immutable set search_path = '' as $$
  select case p_kind when 'cart' then 'pdv' when 'instancias' then 'whatsapp' when 'mensagens' then 'whatsapp' else p_kind end
$$;

create or replace function app.record_readonly(r public.records) returns boolean
language sql immutable set search_path = '' as $$
  select r.converted_id is not null or r.status in ('Entregue', 'Recebida', 'Cancelada', 'Convertido') or coalesce(r.fields ->> 'stockState', '') in ('reserved', 'consumed')
$$;

create or replace function app.record_json(r public.records) returns jsonb
language sql stable set search_path = '' as $$
  select jsonb_build_object('id', r.id, 'tenantId', coalesce(r.tenant_id::text, 'platform'), 'branchId', coalesce(r.branch_id::text, ''), 'kind', r.kind, 'title', r.title,
    'status', r.status, 'customerId', coalesce(r.customer_id::text, ''), 'date', r.date, 'amount', r.amount, 'fields', r.fields, 'items', r.items, 'history', r.history)
    || case when r.converted_id is null then '{}'::jsonb else jsonb_build_object('convertedId', r.converted_id) end
$$;

create or replace function app.history(p_text text) returns jsonb
language sql stable set search_path = '' as $$ select jsonb_build_array(jsonb_build_object('date', now(), 'text', p_text)) $$;

-- Itens normalizados: produto do tenant, nome do servidor, custo do servidor (exceto compras, onde preço = custo informado).
create or replace function app.clean_items(p_tenant uuid, p_kind text, p_items jsonb) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare x jsonb; pr public.products; v_out jsonb := '[]'; v_seen uuid[] := '{}'; v_pid uuid; v_price bigint;
begin
  if p_items is null then return '[]'; end if;
  if jsonb_typeof(p_items) <> 'array' then perform app.fail('Revise quantidades e preços dos itens.'); end if;
  for x in select * from jsonb_array_elements(p_items) loop
    v_pid := app.uuid_or_null(x ->> 'productId');
    select * into pr from public.products where tenant_id = p_tenant and id = v_pid;
    if pr.id is null then perform app.fail('Produto inválido ou inativo.'); end if;
    if v_pid = any (v_seen) then perform app.fail('Produto já incluído; altere a quantidade.'); end if;
    v_seen := v_seen || v_pid;
    v_price := app.int_val(x -> 'price', 'Preço');
    v_out := v_out || jsonb_build_object('productId', v_pid, 'name', pr.name, 'quantity', app.int_val(x -> 'quantity', 'Quantidade', 1), 'price', v_price,
                                         'cost', case when p_kind = 'compras' then v_price else pr.cost end);
  end loop;
  return v_out;
end $$;

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

create or replace function public.delete_record(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_id for update;
  if r.id is null then perform app.fail('Registro não encontrado.'); end if;
  perform app.require(p_tenant, app.record_module(r.kind), 'excluir', r.branch_id);
  if app.record_readonly(r) or r.kind in ('ordens-servico', 'compras', 'filiais') then perform app.fail('Registro protegido; utilize a transição de status.'); end if;
  if exists (select 1 from public.records x where x.tenant_id = p_tenant and x.id <> p_id and (x.converted_id = p_id or exists (select 1 from jsonb_each_text(x.fields) f where f.value = p_id::text))) then
    perform app.fail('Registro vinculado a outro atendimento.');
  end if;
  delete from public.records where id = p_id;
  perform app.audit(p_tenant, r.kind || ': excluído ' || r.title, 'record', p_id::text);
end $$;

-- Efeitos de estoque/financeiro da OS (espelho de osStock em domain.ts).
create or replace function app.os_stock(r public.records, p_status text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare st text := coalesce(r.fields ->> 'stockState', ''); it record; b public.stock_balances; v_fields jsonb := r.fields;
begin
  if p_status = 'Em execução' and st <> 'reserved' then
    for it in select (x ->> 'productId')::uuid pid, sum((x ->> 'quantity')::int) q from jsonb_array_elements(r.items) x group by 1 order by 1 loop
      if not exists (select 1 from public.products where tenant_id = r.tenant_id and id = it.pid and active) then perform app.fail('Produto inválido ou inativo.'); end if;
      b := app.lock_balance(r.tenant_id, r.branch_id, it.pid);
      if b.quantity - b.reserved < it.q then perform app.fail('Estoque insuficiente para reservar OS.'); end if;
      update public.stock_balances set reserved = reserved + it.q where tenant_id = r.tenant_id and branch_id = r.branch_id and product_id = it.pid;
      insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (r.tenant_id, r.branch_id, it.pid, it.q, 'Reserva OS', r.id::text, auth.uid());
    end loop;
    v_fields := v_fields || '{"stockState":"reserved"}';
  end if;
  if p_status = 'Pronta' and st <> 'consumed' then
    if st <> 'reserved' and jsonb_array_length(r.items) > 0 then perform app.fail('Reserve os itens antes de concluir.'); end if;
    for it in select (x ->> 'productId')::uuid pid, sum((x ->> 'quantity')::int) q from jsonb_array_elements(r.items) x group by 1 order by 1 loop
      b := app.lock_balance(r.tenant_id, r.branch_id, it.pid);
      if b.reserved < it.q or b.quantity < it.q then perform app.fail('Reserva inconsistente.'); end if;
      update public.stock_balances set reserved = reserved - it.q, quantity = quantity - it.q where tenant_id = r.tenant_id and branch_id = r.branch_id and product_id = it.pid;
      insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (r.tenant_id, r.branch_id, it.pid, it.q, 'Consumo OS', r.id::text, auth.uid());
    end loop;
    v_fields := v_fields || '{"stockState":"consumed"}';
    if r.amount > 0 then perform app.add_finance(r.tenant_id, r.branch_id, 'Receita', 'Serviços', r.title, r.amount, current_date, false, r.id::text); end if;
  end if;
  if p_status = 'Cancelada' and st in ('reserved', 'consumed') then
    if exists (select 1 from public.financial_entries e where e.tenant_id = r.tenant_id and e.reference = r.id::text and exists (select 1 from public.settlements s where s.entry_id = e.id and s.reversed_at is null)) then
      perform app.fail('Estorne o recebimento da OS antes de cancelar.');
    end if;
    for it in select (x ->> 'productId')::uuid pid, sum((x ->> 'quantity')::int) q from jsonb_array_elements(r.items) x group by 1 order by 1 loop
      b := app.lock_balance(r.tenant_id, r.branch_id, it.pid);
      if st = 'reserved' then
        if b.reserved < it.q then perform app.fail('Reserva inconsistente.'); end if;
        update public.stock_balances set reserved = reserved - it.q where tenant_id = r.tenant_id and branch_id = r.branch_id and product_id = it.pid;
      else
        update public.stock_balances set quantity = quantity + it.q where tenant_id = r.tenant_id and branch_id = r.branch_id and product_id = it.pid;
      end if;
      insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (r.tenant_id, r.branch_id, it.pid, it.q, 'Reversão OS', r.id::text, auth.uid());
    end loop;
    update public.financial_entries set cancelled = true where tenant_id = r.tenant_id and reference = r.id::text and not cancelled;
    v_fields := v_fields || '{"stockState":"released"}';
  end if;
  return v_fields;
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

create or replace function public.receive_purchase(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records; v_total bigint; it record;
begin
  select * into r from public.records where tenant_id = p_tenant and id = p_id for update;
  if r.id is null then perform app.fail('Registro não encontrado.'); end if;
  if r.kind <> 'compras' then perform app.fail('Registro não é uma compra.'); end if;
  perform app.require(p_tenant, 'compras', 'editar', r.branch_id);
  if r.status = 'Recebida' then return; end if;
  if r.status not in ('Pendente', 'Aprovada', 'Pedido', 'Enviada') then perform app.fail('Compra não pode ser recebida.'); end if;
  perform app.branch_ok(p_tenant, r.branch_id);
  if jsonb_array_length(r.items) = 0 then perform app.fail('Compra sem itens.'); end if;
  select sum((x ->> 'quantity')::bigint * (x ->> 'cost')::bigint) into v_total from jsonb_array_elements(r.items) x;
  if r.amount <> v_total then perform app.fail('Total da compra difere do custo dos itens.'); end if;
  for it in select (x ->> 'productId')::uuid pid, sum((x ->> 'quantity')::int) q from jsonb_array_elements(r.items) x group by 1 order by 1 loop
    if not exists (select 1 from public.products where tenant_id = p_tenant and id = it.pid and active) then perform app.fail('Produto inválido ou inativo.'); end if;
    perform app.lock_balance(p_tenant, r.branch_id, it.pid);
    update public.stock_balances set quantity = quantity + it.q where tenant_id = p_tenant and branch_id = r.branch_id and product_id = it.pid;
    insert into public.stock_movements (tenant_id, branch_id, product_id, quantity, type, reference, created_by) values (p_tenant, r.branch_id, it.pid, it.q, 'Recebimento', r.id::text, auth.uid());
  end loop;
  perform app.add_finance(p_tenant, r.branch_id, 'Despesa', 'Compras', r.title, v_total, coalesce(nullif(r.fields ->> 'dueDate', '')::date, current_date), false, r.id::text);
  update public.records set status = 'Recebida', history = history || app.history('Mercadoria recebida; conta a pagar gerada.') where id = r.id;
  perform app.audit(p_tenant, 'Compra recebida ' || r.id, 'record', r.id::text);
end $$;

create or replace function public.convert_record(p_tenant uuid, p_id uuid, p_target text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare s public.records; v_target uuid; v_quote boolean; v_lead boolean;
begin
  select * into s from public.records where tenant_id = p_tenant and id = p_id for update;
  if s.id is null then perform app.fail('Registro não encontrado.'); end if;
  perform app.require(p_tenant, p_target, 'cadastrar', s.branch_id);
  if s.converted_id is not null then
    if (select kind from public.records where id = s.converted_id) <> p_target then perform app.fail('Registro já convertido para outro tipo.'); end if;
    return s.converted_id;
  end if;
  v_quote := s.kind = 'orcamentos' and p_target in ('ordens-servico', 'pedidos');
  v_lead := s.kind in ('crm', 'agenda') and p_target = 'orcamentos';
  if not v_quote and not v_lead then perform app.fail('Conversão não permitida.'); end if;
  if v_quote and s.status <> 'Aprovado' then perform app.fail('Aprove o orçamento antes de converter.'); end if;
  if v_lead and s.status in ('Cancelado', 'Cancelada', 'Perdido') then perform app.fail('Registro encerrado não pode ser convertido.'); end if;
  perform app.branch_ok(p_tenant, s.branch_id);
  perform app.clean_items(p_tenant, s.kind, s.items);
  insert into public.records (tenant_id, branch_id, kind, title, status, customer_id, amount, fields, items, history)
  values (p_tenant, s.branch_id, p_target, s.title, case p_target when 'ordens-servico' then 'Aberta' when 'orcamentos' then 'Aberto' else 'Pendente' end,
          s.customer_id, s.amount, (s.fields - 'stockState') || jsonb_build_object('sourceId', s.id), s.items, app.history('Convertido de ' || s.id))
  returning id into v_target;
  update public.records set converted_id = v_target, status = 'Convertido', history = history || app.history('Convertido para ' || v_target) where id = s.id;
  perform app.audit(p_tenant, format('Conversão %s em %s', s.id, v_target), 'record', s.id::text);
  return v_target;
end $$;

create or replace function public.simulate_automation(p_tenant uuid, p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records;
begin
  perform app.require(p_tenant, 'automacoes', 'editar');
  select * into r from public.records where tenant_id = p_tenant and id = p_id and kind = 'automacoes';
  if r.id is null or r.status <> 'Ativa' then perform app.fail('Ative a automação antes de simular.'); end if;
  insert into public.notifications (tenant_id, type, title, body, data, push_status)
  values (p_tenant, 'automation.simulation', 'Simulação: ' || r.title, coalesce(r.fields ->> 'message', ''), jsonb_build_object('sourceId', r.id, 'simulation', true), 'skipped');
end $$;
