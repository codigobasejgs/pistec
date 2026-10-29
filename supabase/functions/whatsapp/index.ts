import { authenticated, body, env, HttpError, serve, service, text, uuid } from '../_shared/http.ts';
import * as evo from '../_shared/evolution.ts';

// Ações do lojista. Autorização no banco (authorize_whatsapp, JWT do usuário); a chave Evolution nunca sai do servidor.
const sha = async (s: string) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))), b => b.toString(16).padStart(2, '0')).join('');

serve(async request => {
  const { client } = await authenticated(request);
  const input = await body(request, 16000);
  const tenant = uuid(input.tenantId, 'Empresa'), action = text(input.action, 'Ação', 20);
  if (action === 'document') {
    // Documento da loja: o banco valida permissão, consentimento, telefone, instância conectada, limite e idempotência (prepare_document_whatsapp).
    // Envia texto + link seguro com validade (o PDF não fica guardado no servidor; nenhuma URL pública permanente).
    const { data: prep, error: prepError } = await client.rpc('prepare_document_whatsapp', { p_tenant: tenant, p_document: uuid(input.documentId, 'Documento'),
      p_customer: uuid(input.customerId, 'Cliente'), p_text: text(input.text, 'Mensagem', 1000), p_key: text(input.key, 'Chave', 100) });
    if (prepError) throw new HttpError(400, prepError.message);
    if (prep.duplicate) return { status: prep.status, duplicate: true };
    const link = new URL(`/d/${prep.token}`, env('APP_URL')).href;
    let id = '', failure: string | null = null;
    try { const sent = await evo.sendText(prep.instance, evo.recipient(prep.number), `${prep.text}\n\n${link}`); id = String(sent?.key?.id ?? ''); if (!id) failure = 'sem_confirmacao'; }
    catch (e) { failure = e instanceof Error ? e.message.slice(0, 120) : 'falha_envio'; }
    await service().rpc('finish_document_event', { p_event: prep.eventId, p_provider_id: id || null, p_error: failure });
    if (failure) throw new HttpError(502, 'O WhatsApp não aceitou o envio. Tente novamente em instantes.');
    // "accepted" = aceito pela Evolution; entrega/leitura não são confirmadas aqui.
    return { status: 'accepted', id };
  }
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
    // Instâncias antigas foram criadas só com MESSAGES_UPSERT/CONNECTION_UPDATE: atualiza a assinatura sem trocar a URL/token.
    await evo.syncWebhook(instance!).catch(() => null);
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
