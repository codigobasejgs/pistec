import { authenticated, body, env, HttpError, serve, service, text, uuid } from '../_shared/http.ts';
import * as evo from '../_shared/evolution.ts';

// Ações do lojista. Autorização no banco (authorize_whatsapp, JWT do usuário); a chave Evolution nunca sai do servidor.
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

serve(async request => {
  const { client } = await authenticated(request);
  const input = await body(request, 16000);
  const tenant = uuid(input.tenantId, 'Empresa'), action = text(input.action, 'Ação', 20);
  const { data: authorized, error } = await client.rpc('authorize_whatsapp', { p_tenant: tenant, p_action: action });
  if (error) throw new HttpError(403, error.message);
  const db = service();
  if (action === 'connect') {
    let instance = authorized as string | null;
    if (!instance) {
      const name = `pistec-${tenant.slice(0, 8)}-${crypto.randomUUID().slice(0, 8)}`;
      const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
      const { data: registered, error: regError } = await db.rpc('register_whatsapp_instance', { p_tenant: tenant, p_name: name, p_token_hash: await sha(token) });
      if (regError) throw new HttpError(409, regError.message);
      instance = registered as string;
      if (instance === name) {
        const hook = new URL(`${env('SUPABASE_URL')}/functions/v1/whatsapp-webhook`);
        hook.searchParams.set('i', name); hook.searchParams.set('t', token);
        await evo.createInstance(name, hook.href);
      }
    }
    const qr = await evo.connect(instance!);
    // QR em base64 para exibição imediata; não é persistido.
    return { instance, qr: typeof qr?.base64 === 'string' && qr.base64.startsWith('data:image/') ? qr.base64 : null, pairingCode: qr?.pairingCode ?? null };
  }
  const instance = authorized as string;
  if (action === 'state') {
    const s = await evo.state(instance);
    const value = String(s?.instance?.state ?? s?.state ?? '');
    if (['open', 'close', 'connecting'].includes(value)) await db.rpc('whatsapp_connection', { p_instance: instance, p_state: value });
    return { state: value || 'unknown' };
  }
  if (action === 'logout') { await evo.logout(instance); await db.rpc('whatsapp_connection', { p_instance: instance, p_state: 'close' }); return { state: 'close' }; }
  if (action === 'send') {
    const to = evo.recipient(input.to), message = text(input.text, 'Mensagem', 4000);
    const { data: contact } = await client.from('whatsapp_contacts').select('id').eq('tenant_id', tenant).eq('remote_jid', `${to}@s.whatsapp.net`).maybeSingle();
    // Só responde conversas existentes (cliente iniciou): evita disparo em massa para números arbitrários.
    if (!contact) throw new HttpError(403, 'Só é possível responder conversas iniciadas pelo cliente.');
    const sent = await evo.sendText(instance, to, message);
    const id = String(sent?.key?.id ?? '');
    if (!id) throw new HttpError(502, 'Envio sem confirmação do WhatsApp.');
    await db.rpc('whatsapp_inbound', { p_instance: instance, p_external_id: id, p_remote: `${to}@s.whatsapp.net`, p_body: message, p_from_me: true, p_status: 'sent' });
    return { sent: true, id };
  }
  throw new HttpError(400, 'Ação inválida.');
});
