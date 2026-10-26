-- Super Admin sem autenticador (decisão do dono do sistema em 2026-10-26).
-- Continua exigindo: sessão autenticada + linha em platform_admins (só o servidor concede).
create or replace function app.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins where user_id = auth.uid())
$$;

create or replace function app.require_platform_admin() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if not app.is_platform_admin() then perform app.fail('Acesso restrito ao Super Admin.', '42501'); end if;
end $$;
