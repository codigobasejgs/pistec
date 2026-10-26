import { env, HttpError, serve, service } from '../_shared/http.ts';
import { verifySvix } from '../_shared/email.ts';

// Webhook Resend (entregue, bounce, reclamação). Autenticidade: assinatura Svix com RESEND_WEBHOOK_SECRET.
serve(async request => {
  const raw = await request.text();
  if (raw.length > 65536) throw new HttpError(413, 'Requisição excede o limite.');
  const ok = await verifySvix(env('RESEND_WEBHOOK_SECRET'), request.headers.get('svix-id') ?? '', request.headers.get('svix-timestamp') ?? '', request.headers.get('svix-signature') ?? '', raw);
  if (!ok) throw new HttpError(401, 'Assinatura inválida.');
  let event: { type?: unknown; data?: { email_id?: unknown } };
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
  if (typeof event.type !== 'string' || typeof event.data?.email_id !== 'string') return { ignored: true };
  const { data, error } = await service().rpc('email_provider_event', { p_provider_id: event.data.email_id, p_type: event.type });
  if (error) throw new HttpError(503, 'Registro indisponível.');
  return { status: data };
});
