import { HttpError, serve, service } from '../_shared/http.ts';
import { parseConnection, parseInbound } from '../_shared/evolution.ts';

// Evolution 2.3.7 não assina webhooks: cada instância tem token próprio na URL (?i=<instância>&t=<token>), guardado só em hash.
// O nome da instância vem da URL configurada por nós, nunca do corpo do evento.
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

serve(async request => {
  const url = new URL(request.url), instance = url.searchParams.get('i') ?? '', token = url.searchParams.get('t') ?? '';
  if (!/^pistec-[a-z0-9-]{4,60}$/.test(instance) || token.length < 32) throw new HttpError(401, 'Webhook não autorizado.');
  const db = service();
  const { data: stored } = await db.rpc('whatsapp_token_hash', { p_instance: instance });
  const given = await sha(token);
  if (typeof stored !== 'string' || stored.length !== given.length || [...stored].reduce((d, c, i) => d | (c.charCodeAt(0) ^ given.charCodeAt(i)), 0) !== 0) throw new HttpError(401, 'Webhook não autorizado.');
  const raw = await request.text();
  if (raw.length > 262144) throw new HttpError(413, 'Requisição excede o limite.');
  let event: Record<string, unknown>;
  try { event = JSON.parse(raw); } catch { throw new HttpError(400, 'JSON inválido.'); }
  const state = parseConnection(event);
  if (state) { await db.rpc('whatsapp_connection', { p_instance: instance, p_state: state }); return { state }; }
  const msg = parseInbound(event);
  if (!msg) return { ignored: true };
  // Dedup por (instância, id externo) no banco: reenvio do mesmo evento não duplica mensagem nem notificação.
  const { data, error } = await db.rpc('whatsapp_inbound', { p_instance: instance, p_external_id: msg.externalId, p_remote: msg.remote, p_body: msg.body, p_from_me: msg.fromMe });
  if (error) throw new HttpError(503, 'Persistência indisponível.');
  return { status: data?.status };
});
