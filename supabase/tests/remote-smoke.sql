-- Smoke real autorizado. Tudo revertido; não envia e-mail, não chama provedores.
begin;
set local statement_timeout = '30s';
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); ta jsonb; tb jsonb; prod uuid;
begin
  insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data)
  values (a, a || '@smoke.invalid', now(), '{"name":"Teste temporário A"}'),
         (b, b || '@smoke.invalid', now(), '{"name":"Teste temporário B"}');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',a,'role','authenticated','aal','aal1')::text, true);
  ta := public.onboard_tenant(jsonb_build_object('name','Smoke ' || a, 'planId','premium'));
  perform set_config('request.jwt.claims', jsonb_build_object('sub',b,'role','authenticated','aal','aal1')::text, true);
  tb := public.onboard_tenant(jsonb_build_object('name','Smoke ' || b, 'planId','premium'));
  prod := public.save_product((tb->>'tenantId')::uuid, '{"name":"Produto B","sku":"SMOKE","cost":100,"price":200}');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',a,'role','authenticated','aal','aal1')::text, true);
  perform set_config('smoke.tenant_a',ta->>'tenantId',true);
  perform set_config('smoke.tenant_b',tb->>'tenantId',true);
end $$;
set local role authenticated;
do $$
declare tenant_a uuid := current_setting('smoke.tenant_a')::uuid; tenant_b uuid := current_setting('smoke.tenant_b')::uuid;
begin
  if not exists(select 1 from public.tenants where id=tenant_a) then raise exception 'RLS negou o próprio tenant'; end if;
  if exists(select 1 from public.tenants where id=tenant_b) then raise exception 'RLS vazou tenant B'; end if;
  if exists(select 1 from public.products where tenant_id=tenant_b) then raise exception 'RLS vazou produtos B'; end if;
  if has_function_privilege(current_user,'app.add_finance(uuid,uuid,text,text,text,bigint,date,boolean,text)','execute') then raise exception 'Helper interno exposto'; end if;
  begin
    perform public.save_product(tenant_b,'{"name":"Tentativa","sku":"NEGADO","cost":0,"price":0}');
    raise exception 'RPC permitiu gravação cruzada';
  exception when insufficient_privilege then null; end;
  begin
    perform public.admin_save_coupon('{"code":"FORJADO"}');
    raise exception 'RPC permitiu admin sem MFA';
  exception when insufficient_privilege then null; end;
end $$;
reset role;
select 'PASS: onboarding, isolamento RLS, RPC cruzada negada, helper privado, admin negado; rollback a seguir' as resultado;
rollback;
