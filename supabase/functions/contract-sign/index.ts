// Ações de contrato do usuário autenticado: enviar para assinatura, reconciliar, reenviar convite, cancelar, baixar (URL temporária).
// Autorização no banco com o JWT do usuário (contract_for_signing / contract_detail); service_role só grava evidências.
import { PDFDocument, StandardFonts, rgb } from 'npm:pdf-lib@1.17.1';
import { authenticated, body, HttpError, serve, service, text, uuid } from '../_shared/http.ts';
import * as aut from '../_shared/autentique.ts';
import { fillContract, type ContractData } from '../_shared/contracts/template.ts';
import { renderContractPdf, sha256Hex } from '../_shared/contracts/pdf.ts';
import { reconcile } from '../_shared/contracts/reconcile.ts';

serve(async request => {
  const { client } = await authenticated(request);
  const input = await body(request, 8000);
  const action = text(input.action, 'Ação', 20), id = uuid(input.contractId, 'Contrato');
  const db = service();

  if (action === 'send') {
    const { data, error } = await client.rpc('contract_for_signing', { p_contract: id });
    if (error) throw new HttpError(403, error.message);
    const c = data as ContractData & { createdAt: string; expiresAt: string; tenantId: string; signersRaw: { role: 'customer' | 'provider'; name: string; email: string }[] };
    if (!c.sandbox && Deno.env.get('AUTENTIQUE_SANDBOX') === 'true') throw new HttpError(409, 'Provedor em modo de teste: contrato real não pode ser enviado.');
    let pdf: Uint8Array;
    try { pdf = await renderContractPdf({ PDFDocument, StandardFonts, rgb }, fillContract(c), { number: c.number, createdAt: c.createdAt }); }
    catch (e) { await db.rpc('svc_contract_failed', { p_contract: id, p_error: e instanceof Error ? e.message : 'render' }); throw new HttpError(422, e instanceof Error ? e.message : 'Falha ao gerar o contrato.'); }
    const sha = await sha256Hex(pdf), path = `${c.tenantId}/${c.id}/original-${sha.slice(0, 16)}.pdf`;
    // guarda o original ANTES de enviar: o PDF submetido fica preservado mesmo se o envio falhar
    const up = await db.storage.from('contracts').upload(path, pdf, { contentType: 'application/pdf', upsert: false });
    if (up.error && !/exists/i.test(up.error.message)) throw new HttpError(503, 'Armazenamento indisponível.');
    let sent;
    try { sent = await aut.createDocument(`Contrato PISTEC ${c.number}`, pdf, c.signersRaw, { sandbox: c.sandbox || Deno.env.get('AUTENTIQUE_SANDBOX') === 'true', deadline: c.expiresAt,
      message: `Contrato ${c.number} — ${c.parties.company.legalName}. Leia todo o documento antes de assinar.` }); }
    catch (e) { await db.rpc('svc_contract_failed', { p_contract: id, p_error: e instanceof Error ? e.message : 'provider' }); throw e; }
    const { error: saveError } = await db.rpc('svc_contract_sent', { p_contract: id, p_provider_doc: sent.id, p_sha256: sha, p_path: path, p_signers: sent.signers.map(s => ({ ...s, method: 'email' })) });
    if (saveError) throw new HttpError(503, 'Enviado ao provedor, mas o registro falhou. Contate o suporte com o número do contrato.');
    return { status: 'awaiting_customer', sha256: sha };
  }

  // Demais ações exigem leitura autorizada do contrato.
  const { data: detail, error } = await client.rpc('contract_detail', { p_contract: id });
  if (error) throw new HttpError(403, error.message);
  const { data: row } = await db.from('tenant_contracts').select('provider_document_id,document_path,signed_path,certificate_path,tenant_id,status').eq('id', id).single();
  if (!row) throw new HttpError(404, 'Contrato não encontrado.');

  if (action === 'reconcile') return await reconcile(db, row.provider_document_id, 'reconcile');
  if (action === 'download') {
    const which = text(input.file ?? 'original', 'Arquivo', 20);
    const path = which === 'signed' ? row.signed_path : which === 'certificate' ? row.certificate_path : row.document_path;
    if (!path) throw new HttpError(404, which === 'signed' ? 'O documento assinado só existe depois da conclusão de todas as assinaturas.' : 'Arquivo indisponível.');
    const { data: link, error: e } = await db.storage.from('contracts').createSignedUrl(path, 120, { download: `${(detail as { number: string }).number}-${which}.pdf` });
    if (e || !link) throw new HttpError(503, 'Não foi possível gerar o link de download.');
    return { url: link.signedUrl, expiresIn: 120 };
  }
  if (action === 'resend') {
    if (!['awaiting_customer', 'awaiting_provider', 'partially_signed'].includes(row.status)) throw new HttpError(409, 'Não há assinatura pendente para reenviar.');
    const { data: pending } = await db.from('contract_signers').select('provider_signer_id').eq('contract_id', id).neq('status', 'signed');
    await aut.resend((pending ?? []).map(p => p.provider_signer_id).filter(Boolean));
    await db.from('contract_signature_events').insert({ contract_id: id, source: 'system', event_key: `resend:${id}:${Date.now()}`, type: 'resend', data: {} });
    return { resent: true };
  }
  if (action === 'cancel') {
    const { error: e } = await client.rpc('cancel_contract', { p_contract: id, p_reason: text(input.reason, 'Motivo', 500) });
    if (e) throw new HttpError(403, e.message);
    if (row.provider_document_id) await aut.block(row.provider_document_id).catch(() => null); // bloqueio no provedor é melhor esforço; o contrato já está cancelado no PISTEC
    return { status: 'cancelled' };
  }
  throw new HttpError(400, 'Ação inválida.');
});
