-- Smoke real de documentos. Tudo revertido (rollback): não envia e-mail, não chama Evolution, não deixa dados.
begin;
set local statement_timeout = '30s';
do $$
declare a uuid := gen_random_uuid(); b uuid := gen_random_uuid(); ta jsonb; tb jsonb; prod uuid; cust uuid; sale jsonb; d jsonb; link jsonb; pub jsonb; mail jsonb; n int;
begin
  insert into auth.users (id,email,email_confirmed_at,raw_user_meta_data) values (a, a || '@smoke.invalid', now(), '{"name":"Teste A"}'), (b, b || '@smoke.invalid', now(), '{"name":"Teste B"}');
  perform set_config('request.jwt.claims', jsonb_build_object('sub',b,'role','authenticated')::text, true);
  tb := public.onboard_tenant(jsonb_build_object('name','Smoke Doc B ' || b, 'planId','premium'));
  perform set_config('request.jwt.claims', jsonb_build_object('sub',a,'role','authenticated')::text, true);
  ta := public.onboard_tenant(jsonb_build_object('name','Smoke Doc A ' || a, 'planId','premium'));
  prod := public.save_product((ta->>'tenantId')::uuid, '{"name":"Produto Doc","sku":"SMOKE-DOC","cost":100,"price":2500}');
  perform public.move_stock((ta->>'tenantId')::uuid, (ta->>'branchId')::uuid, prod, 5, 'Entrada', 'smoke');
  cust := public.save_customer((ta->>'tenantId')::uuid, '{"name":"Cliente Smoke","phone":"11999990000","email":"cliente@smoke.invalid","consent":true}');
  perform public.open_cash((ta->>'tenantId')::uuid, (ta->>'branchId')::uuid, 1000);
  sale := public.complete_sale(jsonb_build_object('tenantId', ta->>'tenantId', 'branchId', ta->>'branchId', 'customerId', cust, 'items', jsonb_build_array(jsonb_build_object('productId', prod, 'quantity', 1)),
    'discount', 0, 'surcharge', 0, 'payments', jsonb_build_array(jsonb_build_object('method','Dinheiro','amount',3000)), 'requestId', 'smoke-doc-' || a));
  -- trigger diferido roda no fim da transação; aqui emitimos explicitamente (idempotente).
  d := public.issue_document((ta->>'tenantId')::uuid, 'sale', sale->>'id');
  if d->'snapshot'->'sale'->>'total' <> '2500' or d->>'number' !~ '^VEN-' then raise exception 'Snapshot incorreto: %', d->>'number'; end if;
  if public.record_document_print((ta->>'tenantId')::uuid, (d->>'id')::uuid, 'print', 'browser', null, 'smoke-print-1') <> 1 then raise exception 'Via 1'; end if;
  if public.record_document_print((ta->>'tenantId')::uuid, (d->>'id')::uuid, 'print', 'browser', null, 'smoke-print-2') <> 2 then raise exception 'Via 2'; end if;
  link := public.create_document_link((ta->>'tenantId')::uuid, (d->>'id')::uuid, 1);
  pub := public.document_public(link->>'token');
  if pub is null or pub->'snapshot'->'customer'->>'phone' is not null then raise exception 'Link público incorreto'; end if;
  perform public.revoke_document_links((ta->>'tenantId')::uuid, (d->>'id')::uuid);
  if public.document_public(link->>'token') is not null then raise exception 'Link revogado abriu'; end if;
  mail := public.send_document_email((ta->>'tenantId')::uuid, (d->>'id')::uuid, 'cliente@smoke.invalid', 'teste', 'smoke-mail-' || a);
  if mail->>'status' <> 'pending' then raise exception 'E-mail não enfileirado'; end if;
  begin perform public.prepare_document_whatsapp((ta->>'tenantId')::uuid, (d->>'id')::uuid, cust, 'Olá, teste', 'smoke-wa-' || a); raise exception 'WhatsApp sem instância passou';
  exception when others then if sqlerrm not like '%não está conectado%' then raise; end if; end;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',b,'role','authenticated')::text, true);
  begin perform public.issue_document((ta->>'tenantId')::uuid, 'sale', sale->>'id'); raise exception 'Empresa B emitiu documento de A';
  exception when insufficient_privilege then null; end;
  select count(*) into n from public.generated_documents where tenant_id = (ta->>'tenantId')::uuid;
  if n < 1 then raise exception 'Documento não gravado'; end if;
end $$;
select 'PASS: documento emitido com dados reais, vias, link (público sem contato, revogado), e-mail na fila, WhatsApp validado, isolamento B; rollback a seguir' as resultado;
rollback;
