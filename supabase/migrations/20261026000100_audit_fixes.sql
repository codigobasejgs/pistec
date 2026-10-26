-- Auditoria PISTEC 3.0 (2026-10-26).
-- 1. Notificações coletivas respeitam o papel: Mecânico não vê diferença de caixa nem faturas da assinatura.
-- 2. Pagamento em fatura cancelada ou segundo pagamento de fatura paga fica registrado e gera alerta de conciliação.

alter table public.notifications add column module text;

drop policy notifications_read on public.notifications;
create policy notifications_read on public.notifications for select to authenticated using (
  (user_id is null or user_id = auth.uid()) and
  ((tenant_id is not null and app.is_member(tenant_id) and (module is null or app.can_read(tenant_id, module)))
   or (tenant_id is null and app.is_platform_admin())));

create or replace function public.deliver_internal_event(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.outbox_events; title text; message text; v_module text;
begin
  select * into e from public.outbox_events where id=p_id for update;
  if e.id is null then perform app.fail('Evento não encontrado.'); end if;
  if e.status='done' then return; end if;
  if e.status<>'processing' then perform app.fail('Evento não reservado.'); end if;
  if e.depth>3 then perform app.fail('Limite de encadeamento atingido.'); end if;
  -- Empresa removida: nada a notificar; encerra sem retentativa.
  if e.tenant_id is not null and not exists(select 1 from public.tenants where id=e.tenant_id) then
    update public.outbox_events set status='done',processed_at=now(),locked_at=null,last_error='tenant_removed' where id=e.id;
    return;
  end if;
  -- Eventos de entrega externa permanecem na fila até o handler específico existir.
  if e.type in ('invite.created','whatsapp.inbound') then perform app.fail('Handler externo ainda não habilitado.'); end if;
  title := case e.type
    when 'stock.low' then 'Estoque baixo'
    when 'cash.difference' then 'Diferença no fechamento de caixa'
    when 'invoice.created' then 'Fatura de assinatura disponível'
    when 'invoice.paid' then 'Pagamento da assinatura confirmado'
    when 'tenant.created' then 'Empresa cadastrada'
    when 'sale.completed' then 'Venda concluída'
    when 'sale.cancelled' then 'Venda cancelada'
    when 'record.status' then 'Atendimento atualizado'
    when 'subscription.cancel_requested' then 'Cancelamento solicitado'
    when 'lead.created' then 'Novo contato comercial'
    when 'record.created' then 'Registro criado'
    when 'billing.review' then 'Pagamento exige conciliação manual'
    else null end;
  if title is null then perform app.fail('Tipo de evento sem handler.'); end if;
  -- null = todos os membros (ou Super Admin quando tenant_id é null).
  v_module := case
    when e.type = 'stock.low' then 'estoque'
    when e.type = 'cash.difference' then 'caixa'
    when e.type in ('invoice.created','invoice.paid','subscription.cancel_requested') then 'minha-assinatura'
    when e.type in ('sale.completed','sale.cancelled') then 'vendas'
    when e.type in ('record.status','record.created') then app.record_module(coalesce(e.payload->>'kind',''))
    else null end;
  message := case e.type when 'stock.low' then coalesce(e.payload->>'name','Produto')
    when 'record.status' then coalesce(e.payload->>'title','') || ': ' || coalesce(e.payload->>'to','')
    when 'billing.review' then 'Fatura ' || coalesce(e.payload->>'invoiceId','') || ': ' || coalesce(e.payload->>'reason','')
    else title end;
  insert into public.notifications(tenant_id,type,title,body,source_event_id,data,module)
    values(e.tenant_id,e.type,title,message,e.id,jsonb_build_object('eventId',e.id),v_module)
    on conflict (source_event_id) where source_event_id is not null do nothing;
  update public.outbox_events set status='done',processed_at=now(),locked_at=null,last_error=null where id=e.id;
end $$;

create or replace function app.svc_confirm_payment(p_invoice uuid, p_transaction_nsu text, p_paid_amount bigint, p_amount bigint, p_capture text, p_receipt text, p_slug text, p_raw jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare inv public.billing_invoices; v_end date; sub public.subscriptions; v_days int;
begin
  select * into inv from public.billing_invoices where id = p_invoice for update;
  if inv.id is null then return 'unknown_invoice'; end if;
  if exists (select 1 from public.billing_transactions where provider = inv.provider and transaction_nsu = p_transaction_nsu) then return 'duplicate'; end if;
  if p_transaction_nsu is null or btrim(p_transaction_nsu) = '' then perform app.fail('Transação obrigatória.'); end if;
  if inv.status = 'Cancelada' then
    -- Dinheiro recebido nunca é descartado: registra e alerta o Super Admin, sem reativar a assinatura.
    insert into public.billing_transactions (invoice_id, tenant_id, provider, transaction_nsu, amount, paid_amount, capture_method, raw)
    values (inv.id, inv.tenant_id, inv.provider, p_transaction_nsu, coalesce(p_amount, 0), coalesce(p_paid_amount, 0), p_capture, coalesce(p_raw, '{}'));
    perform app.audit(inv.tenant_id, format('Pagamento %s recebido em fatura cancelada %s: conciliação manual', p_transaction_nsu, inv.id), 'invoice', inv.id::text);
    perform app.emit(null, 'billing.review', jsonb_build_object('invoiceId', inv.id, 'tenantId', inv.tenant_id, 'reason', 'cancelled_invoice', 'paidAmount', p_paid_amount));
    return 'cancelled_invoice';
  end if;
  if p_amount is null or p_amount <> inv.amount or p_paid_amount is null or p_paid_amount < inv.amount then
    perform app.audit(inv.tenant_id, format('Pagamento com valor divergente na fatura %s: esperado %s, recebido %s', inv.id, inv.amount, p_amount), 'invoice', inv.id::text);
    return 'amount_mismatch';
  end if;
  insert into public.billing_transactions (invoice_id, tenant_id, provider, transaction_nsu, amount, paid_amount, capture_method, raw)
  values (inv.id, inv.tenant_id, inv.provider, p_transaction_nsu, p_amount, p_paid_amount, p_capture, coalesce(p_raw, '{}'));
  if inv.status = 'Paga' then
    perform app.audit(inv.tenant_id, format('Segundo pagamento %s na fatura já paga %s: avaliar estorno', p_transaction_nsu, inv.id), 'invoice', inv.id::text);
    perform app.emit(null, 'billing.review', jsonb_build_object('invoiceId', inv.id, 'tenantId', inv.tenant_id, 'reason', 'duplicate_payment', 'paidAmount', p_paid_amount));
    return 'already_paid';
  end if;
  update public.billing_invoices set status = 'Paga', paid_at = now(), paid_amount = p_paid_amount, capture_method = p_capture, receipt_url = p_receipt, provider_slug = coalesce(p_slug, provider_slug) where id = inv.id;
  v_days := case inv.period when 'monthly' then 30 when 'quarterly' then 90 else 365 end;
  select * into sub from public.subscriptions where tenant_id = inv.tenant_id for update;
  v_end := greatest(coalesce(sub.current_period_end, current_date), current_date) + v_days;
  insert into public.subscriptions (tenant_id, plan_id, period, status, current_period_end, provider) values (inv.tenant_id, inv.plan_id, inv.period, 'active', v_end, inv.provider)
  on conflict (tenant_id) do update set plan_id = excluded.plan_id, period = excluded.period, status = 'active', current_period_end = excluded.current_period_end, cancel_at_period_end = false, updated_at = now();
  update public.tenants set plan_id = inv.plan_id, status = 'Ativa', due_date = v_end where id = inv.tenant_id;
  perform app.audit(inv.tenant_id, format('Pagamento confirmado da fatura %s (%s)', inv.id, p_transaction_nsu), 'invoice', inv.id::text);
  perform app.emit(inv.tenant_id, 'invoice.paid', jsonb_build_object('invoiceId', inv.id, 'amount', inv.amount, 'paidUntil', v_end));
  return 'paid';
end $$;
