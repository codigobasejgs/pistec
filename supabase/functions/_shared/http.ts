import { createClient } from 'npm:@supabase/supabase-js@2';

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function env(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new HttpError(503, `Configuração ausente: ${name}`);
  return value;
}
export const service = () => createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false, autoRefreshToken: false } });
export async function authenticated(request: Request) {
  const authorization = request.headers.get('authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) throw new HttpError(401, 'Autenticação obrigatória.');
  const client = createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(authorization.slice(7));
  if (error || !data.user) throw new HttpError(401, 'Sessão inválida ou expirada.');
  return { client, user: data.user };
}
export async function body(request: Request, max = 65536): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') ?? 0) > max) throw new HttpError(413, 'Requisição excede o limite.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, 'Corpo obrigatório.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) { await reader.cancel(); throw new HttpError(413, 'Requisição excede o limite.'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
    return parsed;
  } catch { throw new HttpError(400, 'JSON inválido.'); }
}
export function text(value: unknown, label: string, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new HttpError(400, `${label} inválido.`);
  return value.trim();
}
export function uuid(value: unknown, label = 'Identificador'): string {
  const result = text(value, label, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(result)) throw new HttpError(400, `${label} inválido.`);
  return result;
}
export async function providerJson(url: string, init: RequestInit) {
  const response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new HttpError(502, `Provedor indisponível (HTTP ${response.status}).`);
  try { return await response.json(); } catch { throw new HttpError(502, 'Resposta inválida do provedor.'); }
}

export function serve(handler: (request: Request, correlation: string) => Promise<unknown>) {
  Deno.serve(async request => {
    const correlation = crypto.randomUUID();
    const origin = request.headers.get('origin');
    const allowed = (Deno.env.get('APP_ORIGINS') ?? '').split(',').map(v => v.trim()).filter(Boolean);
    const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Correlation-Id': correlation, 'Vary': 'Origin' });
    if (origin && allowed.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
    }
    if (origin && !allowed.includes(origin)) return new Response(JSON.stringify({ error: 'Origem não autorizada.', correlation }), { status: 403, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Método não permitido.', correlation }), { status: 405, headers });
    try { return new Response(JSON.stringify(await handler(request, correlation)), { status: 200, headers }); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      console.error(JSON.stringify({ correlation, status, event: 'request_failed' }));
      return new Response(JSON.stringify({ error: error instanceof HttpError ? error.message : 'Falha interna. Informe o código de atendimento ao suporte.', correlation }), { status, headers });
    }
  });
}
