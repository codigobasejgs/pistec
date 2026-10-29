// verifySvix (webhook Resend): assinatura v1 = base64(HMAC-SHA256(segredo_base64, "id.timestamp.corpo bruto")).
import { createHmac, randomBytes } from 'node:crypto';
import { expect, test, vi } from 'vitest';
vi.mock('../functions/_shared/http.ts', () => ({ env: () => '', HttpError: class extends Error {} }));
const { verifySvix } = await import('../functions/_shared/email.ts');

test('aceita assinatura válida e recusa corpo alterado, segredo errado, carimbo antigo e formato inválido', async () => {
  const key = randomBytes(24), secret = `whsec_${key.toString('base64')}`, id = 'msg_2abc', now = Date.now(), ts = String(Math.floor(now / 1000));
  const body = '{"type":"email.delivered","data":{"email_id":"RS-1"}}';
  const sig = (b: string, t = ts, k = key) => `v1,${createHmac('sha256', k).update(`${id}.${t}.${b}`).digest('base64')}`;
  expect(await verifySvix(secret, id, ts, sig(body), body, now)).toBe(true);
  expect(await verifySvix(secret, id, ts, `v1,AAAA ${sig(body)}`, body, now)).toBe(true); // várias assinaturas (rotação)
  expect(await verifySvix(secret, id, ts, sig(body), body.replace('RS-1', 'RS-2'), now)).toBe(false);
  expect(await verifySvix(secret, id, ts, sig(body, ts, randomBytes(24)), body, now)).toBe(false);
  const old = String(Math.floor(now / 1000) - 600);
  expect(await verifySvix(secret, id, old, sig(body, old), body, now)).toBe(false);
  expect(await verifySvix('sem-prefixo', id, ts, sig(body), body, now)).toBe(false);
  expect(await verifySvix(secret, '', ts, sig(body), body, now)).toBe(false);
});
