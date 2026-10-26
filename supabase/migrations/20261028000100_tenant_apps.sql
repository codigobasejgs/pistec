-- White Label PWA 5.0 — aplicativo instalável com a marca de cada empresa (caminho /app/m/<slug>; sem domínio próprio ainda).
-- Ícones gerados no navegador a partir do logotipo e guardados como PNG base64 (Storage ainda não implementado).
-- ponytail: data URL no banco (limite ~1,5 MB por empresa); migrar para Storage/CDN quando houver muitas empresas com app.

create table public.tenant_apps (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 45),
  short_name text not null check (length(btrim(short_name)) between 1 and 12),
  theme_color text not null check (theme_color ~ '^#[0-9a-fA-F]{6}$'),
  background_color text not null check (background_color ~ '^#[0-9a-fA-F]{6}$'),
  icons jsonb not null default '{}',
  status text not null default 'active' check (status in ('active', 'suspended')),
  suspended_reason text,
  version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.tenant_apps enable row level security;
alter table public.tenant_apps force row level security;
grant select on public.tenant_apps to authenticated;
grant select, insert, update, delete on public.tenant_apps to service_role;
create policy tenant_apps_read on public.tenant_apps for select to authenticated using (app.is_member(tenant_id) or app.is_platform_admin());

-- Direito do plano: '*' (Premium/Enterprise) ou o módulo explícito no plano.
create or replace function app.plan_feature(p_tenant uuid, p_feature text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.tenants t join public.plans p on p.id = t.plan_id
                 where t.id = p_tenant and ('*' = any (p.modules) or p_feature = any (p.modules)))
$$;

create or replace function public.save_tenant_app(p_tenant uuid, p jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_icons jsonb := coalesce(p -> 'icons', '{}'); k text; existing public.tenant_apps; v_version integer;
begin
  perform app.require(p_tenant, 'personalizacao', 'editar');
  if not app.plan_feature(p_tenant, 'custom_branded_pwa') then perform app.fail('Seu plano não inclui o aplicativo personalizado (disponível no Premium e no Enterprise).', '42501'); end if;
  select * into existing from public.tenant_apps where tenant_id = p_tenant for update;
  if existing.status = 'suspended' then perform app.fail('Aplicativo suspenso pela administração da plataforma. Fale com o suporte.', '42501'); end if;
  if jsonb_typeof(v_icons) <> 'object' or length(v_icons::text) > 1500000 then perform app.fail('Ícones inválidos ou grandes demais.'); end if;
  foreach k in array array['192', '512', 'maskable', 'apple', 'favicon'] loop
    if jsonb_typeof(v_icons -> k) <> 'string' or left(v_icons ->> k, 22) <> 'data:image/png;base64,' then perform app.fail('Gere os ícones a partir do logotipo antes de publicar.'); end if;
  end loop;
  if exists (select 1 from jsonb_object_keys(v_icons) x where x not in ('192', '512', 'maskable', 'apple', 'favicon')) then perform app.fail('Ícones inválidos.'); end if;
  insert into public.tenant_apps as a (tenant_id, name, short_name, theme_color, background_color, icons, updated_by)
  values (p_tenant, btrim(app.req_text(p ->> 'name', 'Nome do aplicativo')), btrim(app.req_text(p ->> 'shortName', 'Nome curto')), lower(p ->> 'themeColor'), lower(p ->> 'backgroundColor'), v_icons, auth.uid())
  on conflict (tenant_id) do update set name = excluded.name, short_name = excluded.short_name, theme_color = excluded.theme_color,
    background_color = excluded.background_color, icons = excluded.icons, updated_by = excluded.updated_by, version = a.version + 1, updated_at = now()
  returning version into v_version;
  perform app.audit(p_tenant, case when existing.tenant_id is null then 'Aplicativo personalizado publicado' else 'Aplicativo personalizado atualizado' end, 'tenant_app', p_tenant::text,
    jsonb_build_object('version', v_version, 'name', p ->> 'name'));
  return v_version;
end $$;

-- Leitura pública (login de marca, manifest e ícones): só campos de identidade visual de apps ativos.
create or replace function public.tenant_app_public(p_slug text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('slug', t.slug, 'tenantName', t.name, 'name', a.name, 'shortName', a.short_name, 'themeColor', a.theme_color,
    'backgroundColor', a.background_color, 'icons', a.icons, 'version', a.version, 'primary', coalesce(t.branding ->> 'primary', a.theme_color))
  from public.tenants t join public.tenant_apps a on a.tenant_id = t.id
  where t.slug = p_slug and a.status = 'active' and t.status <> 'Cancelada' and app.plan_feature(t.id, 'custom_branded_pwa')
$$;

-- Super Admin: suspender/reativar o app de uma empresa (não apaga a configuração).
create or replace function public.admin_set_tenant_app(p_tenant uuid, p_active boolean, p_reason text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_reason text := app.reason(p_reason); before public.tenant_apps;
begin
  perform app.require_admin('tenants.edit');
  select * into before from public.tenant_apps where tenant_id = p_tenant for update;
  if before.tenant_id is null then perform app.fail('Esta empresa ainda não publicou aplicativo.'); end if;
  update public.tenant_apps set status = case when p_active then 'active' else 'suspended' end, suspended_reason = case when p_active then null else v_reason end, updated_at = now() where tenant_id = p_tenant;
  perform app.audit(p_tenant, case when p_active then 'Aplicativo personalizado reativado' else 'Aplicativo personalizado suspenso' end, 'tenant_app', p_tenant::text,
    jsonb_build_object('before', before.status, 'after', case when p_active then 'active' else 'suspended' end, 'reason', v_reason));
  insert into public.notifications (tenant_id, type, title, body, module) values (p_tenant, 'tenant_app.status',
    case when p_active then 'Aplicativo personalizado reativado' else 'Aplicativo personalizado suspenso' end, case when p_active then 'Seu aplicativo voltou a funcionar.' else 'Motivo: ' || v_reason end, 'personalizacao');
end $$;

revoke all on function public.save_tenant_app(uuid, jsonb), public.tenant_app_public(text), public.admin_set_tenant_app(uuid, boolean, text) from public, anon;
grant execute on function public.save_tenant_app(uuid, jsonb), public.admin_set_tenant_app(uuid, boolean, text) to authenticated;
grant execute on function public.tenant_app_public(text) to anon, authenticated;
revoke all on function app.plan_feature(uuid, text) from public, anon, authenticated;
