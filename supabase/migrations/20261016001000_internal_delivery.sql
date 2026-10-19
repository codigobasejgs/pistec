alter table public.outbox_events add column locked_at timestamptz;
alter table public.notifications add column source_event_id bigint references public.outbox_events(id);
create unique index notifications_source_event on public.notifications(source_event_id) where source_event_id is not null;

create or replace function app.svc_claim_events(p_limit int default 50) returns setof public.outbox_events
language plpgsql security definer set search_path = '' as $$
begin
  update public.outbox_events set status=case when attempts>=5 then 'dead' else 'pending' end,
    locked_at=null,last_error='processing_lease_expired'
    where status='processing' and locked_at<now()-interval '5 minutes';
  return query update public.outbox_events set status='processing',attempts=attempts+1,locked_at=now()
    where id in(select id from public.outbox_events where status='pending' and available_at<=now()
      order by id limit least(greatest(p_limit,1),100) for update skip locked) returning *;
end $$;

create or replace function public.deliver_internal_event(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.outbox_events; title text; message text;
begin
  select * into e from public.outbox_events where id=p_id for update;
  if e.id is null then perform app.fail('Evento não encontrado.'); end if;
  if e.status='done' then return; end if;
  if e.status<>'processing' then perform app.fail('Evento não reservado.'); end if;
  if e.depth>3 then perform app.fail('Limite de encadeamento atingido.'); end if;
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
    else null end;
  if title is null then perform app.fail('Tipo de evento sem handler.'); end if;
  message := case e.type when 'stock.low' then coalesce(e.payload->>'name','Produto')
    when 'record.status' then coalesce(e.payload->>'title','') || ': ' || coalesce(e.payload->>'to','')
    else title end;
  insert into public.notifications(tenant_id,type,title,body,source_event_id,data)
    values(e.tenant_id,e.type,title,message,e.id,jsonb_build_object('eventId',e.id))
    on conflict (source_event_id) where source_event_id is not null do nothing;
  update public.outbox_events set status='done',processed_at=now(),locked_at=null,last_error=null where id=e.id;
end $$;
revoke all on function public.deliver_internal_event(bigint) from public,anon,authenticated;
grant execute on function public.deliver_internal_event(bigint) to service_role;
