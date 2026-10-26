import { authenticated, HttpError, serve } from '../_shared/http.ts';

// Super Admin: quais integrações estão configuradas. Só nomes/booleanos; nenhum valor de segredo sai daqui.
const groups: Record<string, string[]> = {
  InfinitePay: ['INFINITEPAY_HANDLE', 'BILLING_WEBHOOK_TOKEN', 'BILLING_ENABLED'],
  Resend: ['RESEND_API_KEY', 'EMAIL_FROM', 'RESEND_WEBHOOK_SECRET'],
  Evolution: ['EVOLUTION_API_URL', 'EVOLUTION_API_KEY'],
  Gemini: ['GEMINI_API_KEY', 'AI_ENABLED'],
  WebPush: ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'],
  Worker: ['WORKER_TOKEN', 'APP_URL'],
};

serve(async request => {
  const { client } = await authenticated(request);
  const { data, error } = await client.rpc('admin_integration_summary');
  if (error) throw new HttpError(403, 'Acesso restrito ao Super Admin.');
  const config = Object.fromEntries(Object.entries(groups).map(([name, vars]) => [name, Object.fromEntries(vars.map(v => [v, Boolean(Deno.env.get(v))]))]));
  return { config, flags: { billing: Deno.env.get('BILLING_ENABLED') === 'true', ai: Deno.env.get('AI_ENABLED') === 'true' }, metrics: data, checkedAt: new Date().toISOString() };
});
