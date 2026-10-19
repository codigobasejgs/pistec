-- Wrappers públicos apenas para service_role: app não faz parte dos schemas expostos.
create or replace function public.confirm_provider_payment(p_invoice uuid,p_transaction text,p_amount bigint,p_paid_amount bigint,p_capture text,p_slug text) returns text
language sql security definer set search_path = '' as $$
  select app.svc_confirm_payment(p_invoice,p_transaction,p_paid_amount,p_amount,p_capture,null,p_slug,
    jsonb_build_object('verified',true,'amount',p_amount,'paid_amount',p_paid_amount,'capture_method',p_capture))
$$;
create or replace function public.reserve_ai_quota(p_tenant uuid,p_channel text) returns bigint
language sql security definer set search_path = '' as $$ select app.svc_ai_take_quota(p_tenant,p_channel) $$;
create or replace function public.claim_outbox(p_limit integer default 25) returns setof public.outbox_events
language sql security definer set search_path = '' as $$ select * from app.svc_claim_events(least(greatest(p_limit,1),100)) $$;
create or replace function public.finish_outbox(p_id bigint,p_error text default null) returns void
language sql security definer set search_path = '' as $$ select app.svc_finish_event(p_id,p_error) $$;
create or replace function public.run_billing_cycle() returns jsonb
language sql security definer set search_path = '' as $$ select app.svc_billing_cycle(5) $$;
revoke all on function public.confirm_provider_payment(uuid,text,bigint,bigint,text,text), public.reserve_ai_quota(uuid,text),
  public.claim_outbox(integer),public.finish_outbox(bigint,text),public.run_billing_cycle() from public,anon,authenticated;
grant execute on function public.confirm_provider_payment(uuid,text,bigint,bigint,text,text), public.reserve_ai_quota(uuid,text),
  public.claim_outbox(integer),public.finish_outbox(bigint,text),public.run_billing_cycle() to service_role;
