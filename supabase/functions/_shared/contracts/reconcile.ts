// Reconciliação com a Autentique (usada pelo webhook, pela ação manual e pelo worker).
import { env, HttpError, type service } from '../http.ts';
import * as aut from '../autentique.ts';
import { sha256Hex } from './pdf.ts';

/** Consulta o provedor e aplica somente o que a API confirma. Conclui guardando o PDF assinado e o hash. */
export async function reconcile(db: ReturnType<typeof service>, providerDoc: string | null, source: 'reconcile' | 'webhook', eventKey?: string) {
  if (!providerDoc) throw new HttpError(409, 'Contrato ainda não enviado ao provedor.');
  const doc = await aut.getDocument(providerDoc);
  const signers = aut.signersState(doc);
  const key = eventKey ?? `reconcile:${providerDoc}:${signers.map(s => `${s.signed ?? ''}${s.rejected ?? ''}${s.viewed ?? ''}`).join('|')}`;
  const { data: status, error } = await db.rpc('svc_contract_apply', { p_provider_doc: providerDoc, p_event_key: key, p_type: source, p_signers: signers, p_source: source });
  if (error) throw new HttpError(503, 'Não foi possível registrar o estado da assinatura.');
  const all = signers.length > 0 && signers.every(s => s.signed);
  if (all && doc.files.signed) {
    const { data: c } = await db.from('tenant_contracts').select('id,tenant_id,status').eq('provider_document_id', providerDoc).single();
    if (c && c.status !== 'signed') {
      const fetchPdf = async (url: string) => { const r = await fetch(url, { headers: { Authorization: `Bearer ${env('AUTENTIQUE_API_TOKEN')}` }, signal: AbortSignal.timeout(30000) });
        if (!r.ok) throw new HttpError(502, 'Documento assinado indisponível no provedor.'); return new Uint8Array(await r.arrayBuffer()); };
      const signed = await fetchPdf(doc.files.signed); const sha = await sha256Hex(signed);
      const base = `${c.tenant_id}/${c.id}`;
      await db.storage.from('contracts').upload(`${base}/assinado-${sha.slice(0, 16)}.pdf`, signed, { contentType: 'application/pdf', upsert: false });
      const done = await db.rpc('svc_contract_complete', { p_provider_doc: providerDoc, p_signed_sha256: sha, p_signed_path: `${base}/assinado-${sha.slice(0, 16)}.pdf`, p_certificate_path: `${base}/assinado-${sha.slice(0, 16)}.pdf` });
      if (done.error) throw new HttpError(503, 'Falha ao concluir o contrato.');
      return { status: done.data };
    }
  }
  return { status };
}
