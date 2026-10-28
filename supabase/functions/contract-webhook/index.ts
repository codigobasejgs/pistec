// Webhook da Autentique: valida HMAC (x-autentique-signature) e NÃO confia no conteúdo — consulta a API e aplica só o confirmado.
// Responde rápido (2xx) mesmo para eventos irrelevantes; falha temporária vira 5xx para reenvio.
import { HttpError, service } from '../_shared/http.ts';
import { verifyWebhook } from '../_shared/autentique.ts';
import { reconcile } from '../_shared/contracts/reconcile.ts';

Deno.serve(async request => {
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  if (request.method !== 'POST') return json(405, { error: 'Método não permitido.' });
  const raw = await request.text();
  if (raw.length > 512_000) return json(413, { error: 'Payload grande demais.' });
  const secret = Deno.env.get('AUTENTIQUE_WEBHOOK_SECRET') ?? '';
  if (!secret) return json(503, { error: 'Webhook não configurado.' });
  if (!(await verifyWebhook(raw, request.headers.get('x-autentique-signature'), secret))) return json(401, { error: 'Assinatura do webhook inválida.' });
  let event: { event?: { id?: string; type?: string; data?: { object?: { id?: string; document?: string | { id?: string }; object?: string } } } };
  try { event = JSON.parse(raw); } catch { return json(400, { error: 'JSON inválido.' }); }
  const type = String(event.event?.type ?? ''), obj = event.event?.data?.object ?? {};
  if (!/^(document|signature)\./.test(type)) return json(200, { ignored: true });
  const providerDoc = obj.object === 'document' ? obj.id : typeof obj.document === 'object' ? obj.document?.id : obj.document;
  if (!providerDoc || !/^[\w-]{10,100}$/.test(providerDoc)) return json(200, { ignored: true });
  const db = service();
  const { data: c } = await db.from('tenant_contracts').select('id').eq('provider_document_id', providerDoc).maybeSingle();
  if (!c) return json(200, { ignored: true }); // documento de outra integração
  try { return json(200, await reconcile(db, providerDoc, 'webhook', `aut:${event.event?.id ?? crypto.randomUUID()}`)); }
  catch (e) { console.error(JSON.stringify({ event: 'contract_webhook_failed', status: e instanceof HttpError ? e.status : 500 })); return json(503, { error: 'Falha temporária; reenviar.' }); }
});
