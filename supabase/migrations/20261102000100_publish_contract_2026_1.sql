-- Publicação da versão contratual 2026.1 por decisão do proprietário da plataforma (02/11/2026).
-- O proprietário declarou que a minuta PISTEC_Minuta_Contrato_SaaS_2026.docx (SHA-256 5932323f5f53…) já foi aprovada e é o contrato vigente.
-- O texto NÃO muda (mesmo corpo importado em 20261030000100). Fica registrado quem declarou a aprovação; nenhum parecer foi inventado.
do $$
declare v public.legal_contract_versions; owner_id uuid;
begin
  select * into v from public.legal_contract_versions where code = '2026.1';
  if v.id is null or v.status = 'published' then return; end if;   -- idempotente
  select a.user_id into owner_id from public.platform_admins a where a.role = 'owner' order by a.created_at limit 1;
  update public.legal_contract_versions set
    status = 'published',
    submitted_by = coalesce(submitted_by, owner_id), submitted_at = coalesce(submitted_at, now()),
    reviewed_by = coalesce(reviewed_by, owner_id), reviewed_at = coalesce(reviewed_at, now()),
    approved_by = owner_id, approved_at = now(), published_by = owner_id, published_at = now(),
    legal_review_note = 'Aprovação declarada pelo proprietário da plataforma em 02/11/2026: minuta original aprovada e definida como contrato vigente.',
    approval_evidence = 'Declaração do proprietário (conversa de implantação, 02/11/2026). Documento-fonte: ' || source_file || ' · SHA-256 ' || source_sha256
  where id = v.id;
  insert into public.audit_logs (tenant_id, user_id, action, entity, entity_id, data)
  values (null, owner_id, 'Versão contratual 2026.1 publicada por decisão do proprietário', 'contract_version', v.id::text,
          jsonb_build_object('source', v.source_file, 'sha256', v.source_sha256, 'basis', 'owner_declaration'));
end $$;
