// Interop: decifra como o navegador (lado UA, RFC 8291) e verifica a assinatura VAPID.
import { b64url, encrypt, fromB64url, sendPush, vapidAuthorization } from './webpush.ts';
const assert = (c: unknown, m = 'Falha na verificação.') => { if (!c) throw new Error(m); };
const enc = new TextEncoder();
type Bytes = Uint8Array<ArrayBuffer>;
const concat = (...p: Uint8Array[]): Bytes => { const o = new Uint8Array(p.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of p) { o.set(x, i); i += x.length; } return o; };
const hkdf = async (salt: Bytes, ikm: Bytes, info: Bytes, n: number) =>
  new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), n * 8));

async function browser() {
  const keys = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
  return { keys, pub, auth, p256dh: b64url(pub), authB64: b64url(auth) };
}
async function decrypt(body: Bytes, ua: Awaited<ReturnType<typeof browser>>) {
  const salt = body.slice(0, 16), rs = new DataView(body.buffer, body.byteOffset).getUint32(16), idlen = body[20], asPub = body.slice(21, 21 + idlen);
  assert(rs === 4096 && idlen === 65, 'cabeçalho aes128gcm');
  const peer = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, ua.keys.privateKey, 256));
  const ikm = await hkdf(ua.auth, shared, concat(enc.encode('WebPush: info\0'), ua.pub, asPub), 32);
  const key = await crypto.subtle.importKey('raw', await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16), 'AES-GCM', false, ['decrypt']);
  const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12) }, key, body.slice(21 + idlen)));
  assert(plain[plain.length - 1] === 2, 'delimitador de registro final');
  return new TextDecoder().decode(plain.slice(0, -1));
}
async function vapidKeys() {
  const k = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey('jwk', k.privateKey);
  return { publicKey: b64url(new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey))), privateKey: jwk.d!, verify: k.publicKey, subject: 'mailto:teste@pistec.invalid' };
}

Deno.test('push: payload decifrável pelo navegador (RFC 8291)', async () => {
  const ua = await browser();
  const body = await encrypt(enc.encode('{"title":"Estoque baixo"}'), ua.p256dh, ua.authB64);
  assert((await decrypt(body, ua)) === '{"title":"Estoque baixo"}');
});

Deno.test('push: JWT VAPID assinado, audiência = origem do endpoint, expira em ≤ 24 h', async () => {
  const v = await vapidKeys();
  const header = await vapidAuthorization('https://fcm.googleapis.com/fcm/send/abc', v.publicKey, v.privateKey, v.subject);
  const [, jwt, k] = header.match(/^vapid t=([^,]+), k=(.+)$/)!;
  assert(k === v.publicKey);
  const [h, p, s] = jwt.split('.');
  assert(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, v.verify, fromB64url(s), enc.encode(`${h}.${p}`)), 'assinatura');
  const claims = JSON.parse(new TextDecoder().decode(fromB64url(p)));
  assert(claims.aud === 'https://fcm.googleapis.com' && claims.exp - Date.now() / 1000 <= 86400 && claims.sub === v.subject);
});

Deno.test('push: status do push service é devolvido; rede e http recusados sem exceção', async () => {
  const ua = await browser(), v = await vapidKeys();
  const target = { endpoint: 'https://push.example/x', p256dh: ua.p256dh, auth: ua.authB64 };
  let seen: RequestInit | undefined;
  const gone = await sendPush(target, { t: 1 }, v, 60, ((_u: string, init: RequestInit) => { seen = init; return Promise.resolve(new Response(null, { status: 410 })); }) as typeof fetch);
  assert(gone.status === 410 && (seen?.headers as Record<string, string>).TTL === '60');
  assert((await sendPush(target, {}, v, 60, (() => Promise.reject(new Error('offline'))) as typeof fetch)).status === 0);
  assert((await sendPush({ ...target, endpoint: 'http://inseguro' }, {}, v)).status === 400);
  let failed = false; try { await encrypt(new Uint8Array(1), 'curta', ua.authB64); } catch { failed = true; } assert(failed, 'chave inválida');
});
