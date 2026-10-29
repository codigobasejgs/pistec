// Parsers dos webhooks da Evolution 2.3.7 (formatos confirmados no código-fonte da versão) e resposta do bot.
import { expect, test, vi } from 'vitest';
vi.mock('../functions/_shared/http.ts', () => ({ env: () => '', providerJson: () => null, HttpError: class extends Error { constructor(public status: number, m: string) { super(m); } } }));
const { parseInbound, parseStatus, parseConnection, recipient } = await import('../functions/_shared/evolution.ts');
const { botReply, BOT_PROMPT } = await import('../functions/_shared/bot.ts');

test('messages.upsert: texto, @lid com remoteJidAlt, @lid sem alternativo, grupo ignorado', () => {
  const ev = (key: Record<string, unknown>) => ({ event: 'messages.upsert', data: { key: { id: 'A1', fromMe: false, ...key }, message: { conversation: 'Oi' }, pushName: 'Ana' } });
  expect(parseInbound(ev({ remoteJid: '5511999990000@s.whatsapp.net' }))).toMatchObject({ externalId: 'A1', remote: '5511999990000@s.whatsapp.net', body: 'Oi', fromMe: false });
  expect(parseInbound(ev({ remoteJid: '1234567890123@lid', remoteJidAlt: '5511988887777@s.whatsapp.net' }))?.remote).toBe('5511988887777@s.whatsapp.net');
  expect(parseInbound(ev({ remoteJid: '1234567890123@lid' }))?.remote).toBe('1234567890123@lid');
  expect(parseInbound(ev({ remoteJid: '120363000000@g.us' }))).toBeNull();
  expect(parseInbound({ event: 'MESSAGES_UPSERT', data: { key: { id: 'B', remoteJid: '5511999990000@s.whatsapp.net' }, message: { extendedTextMessage: { text: 'x' } } } })?.body).toBe('x');
});

test('messages.update mapeia status reais; desconhecido ignorado; connection.update', () => {
  expect(parseStatus({ event: 'messages.update', data: { keyId: 'K', status: 'DELIVERY_ACK' } })).toEqual({ externalId: 'K', status: 'delivered' });
  expect(parseStatus({ event: 'MESSAGES_UPDATE', data: { keyId: 'K', status: 'READ' } })?.status).toBe('read');
  expect(parseStatus({ event: 'messages.update', data: { keyId: 'K', status: 'ERROR' } })?.status).toBe('failed');
  expect(parseStatus({ event: 'messages.update', data: { keyId: 'K', status: 'NOVO' } })).toBeNull();
  expect(parseConnection({ event: 'connection.update', data: { state: 'open' } })).toBe('open');
  expect(parseConnection({ event: 'connection.update', data: { state: 'qualquer' } })).toBeNull();
});

test('destinatário: número, JID individual e @lid; grupo e lixo recusados', () => {
  expect(recipient('5511999990000')).toBe('5511999990000');
  expect(recipient('5511999990000@s.whatsapp.net')).toBe('5511999990000');
  expect(recipient('1234567890123@lid')).toBe('1234567890123@lid');
  for (const v of ['120363000000@g.us', 'status@broadcast', '123', 'abc']) expect(() => recipient(v)).toThrow();
});

test('bot: resposta vazia falha, longa é cortada; prompt trata cliente como dado', () => {
  expect(() => botReply('')).toThrow(); expect(() => botReply(undefined)).toThrow();
  expect(botReply('x'.repeat(5000))).toHaveLength(1200);
  expect(BOT_PROMPT('Oficina A', 'Seja simpático', [])).toMatch(/dado não confiável/);
});
