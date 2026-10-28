// Autentique API v2 (GraphQL, multipart para upload). Documentação verificada em 2026-10-28: https://docs.autentique.com.br/api
// Chave só no servidor (AUTENTIQUE_API_TOKEN). Sandbox (AUTENTIQUE_SANDBOX=true) não consome créditos e expira em poucos dias.
import { env, HttpError } from './http.ts';

const URL_API = 'https://api.autentique.com.br/v2/graphql';
const gql = async <T>(query: string, variables: Record<string, unknown> = {}) => {
  const r = await fetch(URL_API, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000), headers: { Authorization: `Bearer ${env('AUTENTIQUE_API_TOKEN')}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors) throw new HttpError(502, `Provedor de assinatura indisponível (${r.status}${j.errors ? `: ${String(j.errors[0]?.message ?? '').slice(0, 80)}` : ''}).`);
  return j.data as T;
};

export type Signer = { role: 'customer' | 'provider'; name: string; email: string };
export type ProviderSignature = { public_id: string; name: string; email: string; viewed: { created_at: string } | null; signed: { created_at: string } | null; rejected: { created_at: string; reason?: string } | null };
export type ProviderDocument = { id: string; name: string; files: { original: string; signed: string | null }; signatures: ProviderSignature[] };

/** Envia o PDF e convida os signatários por e-mail (autenticação por e-mail do provedor; CPF exigido na assinatura). */
export async function createDocument(name: string, pdf: Uint8Array, signers: Signer[], opts: { sandbox: boolean; deadline: string; message: string }) {
  const query = `mutation($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) { createDocument(sandbox: ${opts.sandbox}, document: $document, signers: $signers, file: $file) { id signatures { public_id email } } }`;
  const operations = { query, variables: { document: { name, message: opts.message, refusable: true, stop_on_rejected: true, scrolling_required: true, deadline_at: opts.deadline, footer: 'BOTTOM' },
    signers: signers.map(s => ({ email: s.email, action: 'SIGN' })), file: null } };
  const form = new FormData();
  form.append('operations', JSON.stringify(operations)); form.append('map', JSON.stringify({ 0: ['variables.file'] }));
  form.append('0', new Blob([pdf as BlobPart], { type: 'application/pdf' }), `${name}.pdf`);
  const r = await fetch(URL_API, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000), headers: { Authorization: `Bearer ${env('AUTENTIQUE_API_TOKEN')}` }, body: form });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.errors || !j.data?.createDocument?.id) throw new HttpError(502, `Não foi possível enviar ao provedor de assinatura (${r.status}${j.errors ? `: ${String(j.errors[0]?.message ?? '').slice(0, 80)}` : ''}).`);
  const doc = j.data.createDocument as { id: string; signatures: { public_id: string; email: string }[] };
  // casa signatário pelo e-mail (a Autentique devolve também o autor da conta; ele é ignorado)
  return { id: doc.id, signers: signers.map(s => ({ role: s.role, id: doc.signatures.find(x => x.email?.toLowerCase() === s.email.toLowerCase())?.public_id ?? null })) };
}

export const getDocument = (id: string) => gql<{ document: ProviderDocument }>(
  `query($id: UUID!) { document(id: $id) { id name files { original signed } signatures { public_id name email viewed { created_at } signed { created_at } rejected { created_at reason } } } }`, { id }).then(d => d.document);
export const resend = (ids: string[]) => gql<{ resendSignatures: boolean }>(`mutation($ids: [UUID!]!) { resendSignatures(public_ids: $ids) }`, { ids });
/** Bloqueia novas assinaturas (a doc. recomenda prazo no passado em vez de excluir documento já assinado por alguém). */
export const block = (id: string) => gql(`mutation($id: UUID!, $doc: UpdateDocumentInput!) { updateDocument(id: $id, document: $doc) { id } }`, { id, doc: { deadline_at: new Date().toISOString() } });

export { verifyWebhook } from './autentique.verify.ts';

/** Normaliza para svc_contract_apply: só datas confirmadas pela API. */
export const signersState = (doc: ProviderDocument) => doc.signatures.map(s => ({ id: s.public_id, viewed: s.viewed?.created_at ?? null, signed: s.signed?.created_at ?? null, rejected: s.rejected?.created_at ?? null }));
