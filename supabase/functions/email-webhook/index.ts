import { env, HttpError, serve, service } from '../_shared/http.ts';
import { verifySvix } from '../_shared/email.ts';

// Webhook Resend. Autenticidade: assinatura Svix (corpo bruto) com RESEND_WEBHOOK_SECRET; dedupe por svix-id no banco.
// Eventos tratados: email.sent/delivered/delivery_delayed/bounced/complained/failed (os sem efeito ficam só no histórico).
serve(async request => {
  const raw = await request.text();
  if (raw.length > 65536) throw new HttpError(413, 'Requisição excede o limite.');
  const id = request.headers.get('svix-id') ?? '';
  const ok = await verifySvix(env('RESEND_WEBHOOK_SECRET'), id, request.headers.get('svix-timestamp') ?? '', request.headers.get('svix-signature') ?? '', raw);
  if (!ok) throw new HttpError(401, 'Assinatura inválida.');
  let event: { type?: unknown; data?: { email_id?: unknown } };
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
  if (typeof event.type !== 'string' || typeof event.data?.email_id !== 'string' || !event.type.startsWith('email.')) return { ignored: true };
  const { data, error } = await service().rpc('email_webhook_event', { p_event_id: id, p_provider_id: event.data.email_id, p_type: event.type });
  if (error) throw new HttpError(503, 'Registro indisponível.');
  return { status: data };
});
