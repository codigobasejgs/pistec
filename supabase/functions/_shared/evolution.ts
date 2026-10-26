// Evolution API 2.3.7 (versão verificada em GET / em 2026-10-26). Chave global só no servidor.
import { env, HttpError, providerJson } from './http.ts';

const base = () => env('EVOLUTION_API_URL').replace(/\/$/, '');
const call = (path: string, method: string, body?: unknown) => providerJson(`${base()}${path}`, {
  method, headers: { apikey: env('EVOLUTION_API_KEY'), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

export const createInstance = (name: string, webhookUrl: string) => call('/instance/create', 'POST', {
  instanceName: name, integration: 'WHATSAPP-BAILEYS', qrcode: true, groupsIgnore: true, alwaysOnline: false, readMessages: false,
  webhook: { url: webhookUrl, byEvents: false, base64: false, events: ['MESSAGES_UPSERT', 'CONNECTION_UPDATE'] },
});
export const connect = (name: string) => call(`/instance/connect/${encodeURIComponent(name)}`, 'GET');
export const state = (name: string) => call(`/instance/connectionState/${encodeURIComponent(name)}`, 'GET');
export const logout = (name: string) => call(`/instance/logout/${encodeURIComponent(name)}`, 'DELETE');
export const sendText = (name: string, number: string, text: string) => call(`/message/sendText/${encodeURIComponent(name)}`, 'POST', { number, text });

/** Número E.164 sem '+' ou JID de contato individual; grupos e broadcast são recusados. */
export function recipient(value: unknown) {
  const v = String(value ?? '').trim();
  if (/^\d{10,15}$/.test(v)) return v;
  const m = v.match(/^(\d{10,15})@s\.whatsapp\.net$/);
  if (m) return m[1];
  throw new HttpError(400, 'Destinatário inválido.');
}

/** Extrai a mensagem de texto de um evento messages.upsert (v2). Retorna null para eventos sem texto ou de grupo. */
export function parseInbound(event: Record<string, unknown>) {
  if (String(event.event ?? '').toLowerCase().replace('_', '.') !== 'messages.upsert') return null;
  type Msg = { conversation?: string; extendedTextMessage?: { text?: string }; imageMessage?: { caption?: string }; videoMessage?: { caption?: string } };
  const data = (event.data ?? {}) as { key?: { id?: string; remoteJid?: string; fromMe?: boolean }; message?: Msg; pushName?: string };
  const key = data.key ?? {};
  const remote = String(key.remoteJid ?? '');
  if (!key.id || !remote.endsWith('@s.whatsapp.net')) return null;
  const msg = data.message ?? {};
  const text = msg.conversation ?? msg.extendedTextMessage?.text ?? msg.imageMessage?.caption ?? msg.videoMessage?.caption ?? '';
  return { externalId: String(key.id), remote, fromMe: key.fromMe === true, body: String(text).slice(0, 8000), name: String(data.pushName ?? '').slice(0, 120) };
}

export function parseConnection(event: Record<string, unknown>) {
  if (String(event.event ?? '').toLowerCase().replace('_', '.') !== 'connection.update') return null;
  const s = String((event.data as Record<string, unknown> | undefined)?.state ?? '');
  return ['open', 'close', 'connecting'].includes(s) ? s : null;
}
