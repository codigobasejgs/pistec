// Verificação do webhook da Autentique, sem dependências (testável no navegador/Node e no Deno).
/** HMAC-SHA256 hex do corpo bruto com o segredo do endpoint (header x-autentique-signature). Comparação em tempo constante. */
export async function verifyWebhook(raw: string, header: string | null, secret: string) {
  if (!header || !/^[0-9a-f]{64}$/i.test(header) || !secret) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const given = Uint8Array.from(header.match(/../g)!.map(h => parseInt(h, 16)));
  return given.length === mac.length && given.reduce((d, b, i) => d | (b ^ mac[i]), 0) === 0;
}

