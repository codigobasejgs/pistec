// Web Push padrão (RFC 8291 aes128gcm + RFC 8292 VAPID) só com WebCrypto: roda igual no Deno (Edge) e no Node.
// ponytail: sem biblioteca web-push (dependências Node em Deno); validado contra o push service real no teste E2E.

const enc = new TextEncoder();
export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export const fromB64url = (value: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)), c => c.charCodeAt(0));
type Bytes = Uint8Array<ArrayBuffer>;
const concat = (...parts: Uint8Array[]): Bytes => { const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out; };
async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number) {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

/** Criptografa o payload para a inscrição (registro único, rs = 4096). */
export async function encrypt(payload: Bytes, p256dh: string, auth: string) {
  const uaPublic = fromB64url(p256dh), authSecret = fromB64url(auth);
  if (uaPublic.length !== 65 || authSecret.length !== 16) throw new Error('Inscrição push inválida.');
  if (payload.length > 3800) throw new Error('Payload push excede o limite.');
  const local = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']) as CryptoKeyPair;
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', local.publicKey));
  const peer = await crypto.subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: peer }, local.privateKey, 256));
  const ikm = await hkdf(authSecret, shared, concat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(payload, new Uint8Array([2]))));
  const header = new Uint8Array(21); header.set(salt); new DataView(header.buffer).setUint32(16, 4096); header[20] = 65;
  return concat(header, asPublic, cipher);
}

/** Cabeçalho Authorization VAPID (JWT ES256, válido por 12 h). */
export async function vapidAuthorization(endpoint: string, publicKey: string, privateKey: string, subject: string) {
  const pub = fromB64url(publicKey);
  if (pub.length !== 65) throw new Error('Chave pública VAPID inválida.');
  const jwk = { kty: 'EC', crv: 'P-256', x: b64url(pub.slice(1, 33)), y: b64url(pub.slice(33, 65)), d: privateKey, ext: false };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const part = (o: unknown) => b64url(enc.encode(JSON.stringify(o)));
  const unsigned = `${part({ typ: 'JWT', alg: 'ES256' })}.${part({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject })}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(unsigned)));
  return `vapid t=${unsigned}.${b64url(signature)}, k=${publicKey}`;
}

export type PushTarget = { endpoint: string; p256dh: string; auth: string };
export type Vapid = { publicKey: string; privateKey: string; subject: string };

/** Envia e devolve o HTTP do push service (0 = falha de rede). Nunca lança. */
export async function sendPush(target: PushTarget, message: Record<string, unknown>, vapid: Vapid, ttl = 86400, fetcher: typeof fetch = fetch) {
  try {
    const url = new URL(target.endpoint);
    if (url.protocol !== 'https:') return { status: 400, error: 'endpoint_not_https' };
    const body = await encrypt(enc.encode(JSON.stringify(message)), target.p256dh, target.auth);
    const response = await fetcher(target.endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000), headers: {
      Authorization: await vapidAuthorization(target.endpoint, vapid.publicKey, vapid.privateKey, vapid.subject),
      'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String(ttl), Urgency: 'normal',
    }, body });
    return { status: response.status, error: response.ok ? null : `http_${response.status}` };
  } catch (error) {
    return { status: 0, error: error instanceof Error ? error.message.slice(0, 200) : 'network_error' };
  }
}
