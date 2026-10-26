import { esc, permanent, render, templates, verifySvix } from './email.ts';
import { parseConnection, parseInbound, recipient } from './evolution.ts';
const assert = (c: unknown, m = 'Falha na verificação.') => { if (!c) throw new Error(m); };
const throws = (f: () => unknown) => { try { f(); } catch { return true; } return false; };

Deno.test('e-mail: todos os templates renderizam; dados são escapados; link só para APP_URL', () => {
  for (const name of Object.keys(templates)) {
    const r = render(name, { tenant: 'Oficina <script>alert(1)</script>', role: 'Caixa', token: 'a'.repeat(48), amount: 12990, dueDate: '2026-11-05', trialEnds: '2026-11-09', paidUntil: '2026-12-01', periodEnd: '2026-11-09' }, 'https://pistec.vercel.app');
    assert(r.subject && r.html.includes('PISTEC') && r.text, name);
    assert(!r.html.includes('<script>'), `${name}: HTML não escapado`);
    for (const href of r.html.matchAll(/href="([^"]+)"/g)) assert(href[1].startsWith('https://pistec.vercel.app/'), `${name}: link externo`);
  }
  assert(render('invoice_created', { amount: 12990, dueDate: '2026-11-05' }, 'https://x.dev').html.includes('R$'));
  assert(esc(`"'&`) === '&quot;&#39;&amp;');
  assert(throws(() => render('inexistente', {}, 'https://x.dev')));
});

Deno.test('e-mail: classificação de erro do Resend', () => {
  assert(permanent(422) && permanent(403) && !permanent(429) && !permanent(500) && !permanent(408));
});

Deno.test('e-mail: assinatura Svix válida, adulterada, antiga', async () => {
  const secretBytes = crypto.getRandomValues(new Uint8Array(24)), secret = 'whsec_' + btoa(String.fromCharCode(...secretBytes));
  const now = 1_800_000_000_000, ts = String(now / 1000), body = '{"type":"email.bounced","data":{"email_id":"x"}}';
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`msg_1.${ts}.${body}`)))));
  assert(await verifySvix(secret, 'msg_1', ts, `v1,AAAA v1,${sig}`, body, now));
  assert(!(await verifySvix(secret, 'msg_1', ts, `v1,${sig}`, body.replace('bounced', 'delivered'), now)), 'corpo adulterado');
  assert(!(await verifySvix(secret, 'msg_1', ts, `v1,${sig}`, body, now + 600_000)), 'replay antigo');
  assert(!(await verifySvix(secret, 'msg_1', ts, '', body, now)));
});

Deno.test('Evolution: parse de messages.upsert, grupos ignorados, conexão', () => {
  const ev = { event: 'messages.upsert', instance: 'qualquer', data: { key: { id: 'ABC', remoteJid: '5511999990000@s.whatsapp.net', fromMe: false }, pushName: 'João', message: { conversation: 'Tem pastilha?' } } };
  const m = parseInbound(ev)!;
  assert(m.externalId === 'ABC' && m.body === 'Tem pastilha?' && !m.fromMe && m.name === 'João');
  assert(parseInbound({ ...ev, event: 'MESSAGES_UPSERT' }) !== null);
  assert(parseInbound({ ...ev, data: { ...ev.data, key: { ...ev.data.key, remoteJid: '1203@g.us' } } }) === null, 'grupo');
  assert(parseInbound({ event: 'messages.update', data: {} }) === null);
  assert(parseInbound({ ...ev, data: { ...ev.data, message: { extendedTextMessage: { text: 'oi' } } } })!.body === 'oi');
  assert(parseConnection({ event: 'connection.update', data: { state: 'open' } }) === 'open');
  assert(parseConnection({ event: 'connection.update', data: { state: 'hack' } }) === null);
});

Deno.test('Evolution: destinatário só número individual', () => {
  assert(recipient('5511999990000') === '5511999990000' && recipient('5511999990000@s.whatsapp.net') === '5511999990000');
  for (const bad of ['1203@g.us', 'status@broadcast', '+55 11', '', null]) assert(throws(() => recipient(bad)), String(bad));
});
