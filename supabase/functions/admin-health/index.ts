import { authenticated, body, HttpError, serve } from '../_shared/http.ts';

// Super Admin: configuração (nomes de variáveis), conectividade (chamada segura, sem efeito) e métricas do banco.
// Nenhum valor de segredo sai daqui. Conectividade ≠ operação: só indica que o serviço respondeu.
const groups: Record<string, string[]> = {
  InfinitePay: ['INFINITEPAY_HANDLE', 'BILLING_WEBHOOK_TOKEN', 'BILLING_ENABLED'],
  Resend: ['RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_WEBHOOK_SECRET'],
  Evolution: ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'],
  Gemini: ['GEMINI_API_KEY', 'AI_ENABLED'],
  WebPush: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
  Worker: ['WORKER_TOKEN', 'APP_URL'],
};

async function probe(name: string): Promise<{ ok: boolean; detail: string; ms: number }> {
  const t0 = Date.now(); const done = (ok: boolean, detail: string) => ({ ok, detail, ms: Date.now() - t0 });
  const get = (url: string, init: RequestInit = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(8000) });
  try {
    switch (name) {
      case 'Evolution': { const r = await get(Deno.env.get('EVOLUTION_API_URL')!.replace(/\/$/, '') + '/', { headers: { apikey: Deno.env.get('EVOLUTION_API_KEY')! } }); const j = await r.json().catch(() => ({}));
        return done(r.ok, r.ok ? `Respondeu (versão ${String(j.version ?? '?').slice(0, 12)})` : `HTTP ${r.status}`); }
      case 'Gemini': { const r = await get('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! } });
        return done(r.ok, r.ok ? 'Chave aceita (listagem de modelos)' : `HTTP ${r.status}`); }
      case 'Resend': { const r = await get('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}` } }); const j = await r.json().catch(() => ({}));
        if (r.status === 401 && j.name === 'restricted_api_key') return done(true, 'Chave válida (somente envio); domínio não verificável por esta chave');
        return done(r.ok, r.ok ? `${(j.data ?? []).filter((d: { status: string }) => d.status === 'verified').length} domínio(s) verificado(s)` : `HTTP ${r.status}`); }
      case 'InfinitePay': { const r = await get('https://api.checkout.infinitepay.io/payment_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        return done(r.status < 500, `API respondeu HTTP ${r.status} (consulta vazia, sem cobrança)`); }
      default: return done(true, 'Sem verificação externa');
    }
  } catch (e) { return done(false, e instanceof Error ? e.name === 'TimeoutError' ? 'Tempo esgotado' : 'Falha de rede' : 'Falha'); }
}

serve(async request => {
  const { client } = await authenticated(request);
  const { data, error } = await client.rpc('admin_integration_summary');
  if (error) throw new HttpError(403, 'Acesso restrito ao Super Admin.');
  const input = await body(request).catch(() => ({} as Record<string, unknown>));
  const config = Object.fromEntries(Object.entries(groups).map(([name, vars]) => [name, Object.fromEntries(vars.map(v => [v, Boolean(Deno.env.get(v))]))]));
  let connectivity: Record<string, unknown> | undefined;
  if (input.probe === true) {
    // Diagnóstico só para quem gerencia integrações.
    const { data: allowed } = await client.rpc('admin_can_check', { p_perm: 'integrations.manage' });
    if (allowed !== true) throw new HttpError(403, 'Seu perfil não pode executar diagnósticos.');
    const names = ['InfinitePay', 'Resend', 'Evolution', 'Gemini'].filter(n => Object.values(config[n]).some(Boolean));
    connectivity = Object.fromEntries(await Promise.all(names.map(async n => [n, await probe(n)])));
  }
  return { config, flags: { billing: Deno.env.get('BILLING_ENABLED') === 'true', ai: Deno.env.get('AI_ENABLED') === 'true' }, metrics: data, connectivity, checkedAt: new Date().toISOString() };
});
