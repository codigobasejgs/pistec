-- Notas e filiais sem aceitar históricos ou estados derivados enviados pelo navegador.
create or replace function public.add_record_note(p_tenant uuid, p_id uuid, p_note text) returns void
language plpgsql security definer set search_path = '' as $$
declare r public.records; b public.branches; note text := app.req_text(p_note, 'Nota');
begin
  if length(note) > 2000 then perform app.fail('Nota deve ter até 2.000 caracteres.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('record-id:' || p_id::text, 0));
  select * into r from public.records where id=p_id and tenant_id=p_tenant for update;
  if r.id is null then
    select * into b from public.branches where id=p_id and tenant_id=p_tenant;
    if b.id is null then perform app.fail('Registro não encontrado.'); end if;
    perform app.require(p_tenant,'filiais','editar',b.id);
    insert into public.records(id,tenant_id,branch_id,kind,title,status)
      values(b.id,p_tenant,b.id,'filiais',b.name,case when b.active then 'Ativa' else 'Inativa' end)
      returning * into r;
  end if;
  perform app.require(p_tenant,app.record_module(r.kind),'editar',r.branch_id);
  update public.records set history=history || app.history(app.user_name() || ': ' || note) where id=r.id;
  perform app.audit(p_tenant,'Nota adicionada','record',p_id::text);
end $$;

create or replace function public.transition_branch(p_tenant uuid, p_id uuid, p_active boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare b public.branches;
begin
  perform app.require(p_tenant,'filiais','editar',p_id);
  if p_active is null then perform app.fail('Status obrigatório.'); end if;
  perform pg_advisory_xact_lock(hashtextextended('branches:' || p_tenant::text,0));
  select * into b from public.branches where id=p_id and tenant_id=p_tenant for update;
  if b.id is null then perform app.fail('Filial não encontrada.'); end if;
  if b.active=p_active then return; end if;
  if p_active then
    if (select count(*) from public.branches where tenant_id=p_tenant and active) >= (app.plan_of(p_tenant)).branches then
      perform app.fail('Limite de filiais do plano atingido.');
    end if;
  else
    if exists(select 1 from public.cash_registers where tenant_id=p_tenant and branch_id=p_id and closed_at is null) then
      perform app.fail('Feche o caixa da filial antes de desativá-la.');
    end if;
    if not exists(select 1 from public.branches where tenant_id=p_tenant and id<>p_id and active) then
      perform app.fail('A empresa precisa de ao menos uma filial ativa.');
    end if;
  end if;
  update public.branches set active=p_active where id=p_id;
  update public.records set status=case when p_active then 'Ativa' else 'Inativa' end,
    history=history || app.history('Filial ' || case when p_active then 'ativada' else 'desativada' end)
    where id=p_id and tenant_id=p_tenant and kind='filiais';
  perform app.audit(p_tenant,'Estado da filial alterado','branch',p_id::text,jsonb_build_object('active',p_active));
end $$;
revoke all on function public.add_record_note(uuid,uuid,text), public.transition_branch(uuid,uuid,boolean) from public,anon;
grant execute on function public.add_record_note(uuid,uuid,text), public.transition_branch(uuid,uuid,boolean) to authenticated,service_role;
