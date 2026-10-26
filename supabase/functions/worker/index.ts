import { env, HttpError, serve, service } from '../_shared/http.ts';
import { sendPush } from '../_shared/webpush.ts';
import { permanent, render } from '../_shared/email.ts';

// Disparado pelo pg_cron a cada minuto. Cada etapa é independente: falha numa não bloqueia as outras.
serve(async request => {
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env('WORKER_TOKEN')}`;
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([hash(supplied),hash(expected)]);
  if (a.reduce((v,n,i)=>v|(n^b[i]),0)!==0) throw new HttpError(401,'Worker não autorizado.');
  const db = service();
  const result: Record<string, unknown> = { outbox: await outbox(db) };
  result.push = await push(db).catch(e => ({ error: e instanceof Error ? e.message : 'push_failed' }));
  result.email = await email(db).catch(e => ({ error: e instanceof Error ? e.message : 'email_failed' }));
  return result;
});

async function outbox(db: ReturnType<typeof service>) {
  const { data: events, error } = await db.rpc('claim_outbox',{p_limit:25});
  if (error) throw new HttpError(503,'Fila indisponível.');
  let processed=0, failed=0;
  for (const event of events ?? []) {
    // Transação SQL cria notificação/e-mail deduplicados + finaliza o evento.
    const { error } = await db.rpc('deliver_internal_event',{p_id:event.id});
    if (!error) { processed++; continue; }
    failed++;
    const { error: finishError } = await db.rpc('finish_outbox',{p_id:event.id,p_error:'internal_delivery_failed'});
    if (finishError) throw new HttpError(503,'Falha ao registrar retentativa.');
  }
  return {processed,failed};
}

async function push(db: ReturnType<typeof service>) {
  const publicKey = Deno.env.get('VAPID_PUBLIC_KEY'), privateKey = Deno.env.get('VAPID_PRIVATE_KEY'), subject = Deno.env.get('VAPID_SUBJECT');
  if (!publicKey || !privateKey || !subject) return { skipped: 'vapid_not_configured' };
  const { data, error } = await db.rpc('claim_push', { p_limit: 100 });
  if (error) throw new Error('claim_push indisponível');
  const counts: Record<string, number> = {};
  for (const d of data ?? []) {
    // Conteúdo genérico (título do tipo de evento); detalhes só dentro do app após login.
    const r = await sendPush(d, { title: d.title, body: 'Abra o PISTEC para ver os detalhes.', url: d.url, tag: d.tag }, { publicKey, privateKey, subject });
    const { data: status } = await db.rpc('finish_push', { p_id: d.id, p_status: r.status, p_error: r.error });
    counts[status ?? 'unknown'] = (counts[status ?? 'unknown'] ?? 0) + 1;
  }
  return counts;
}

async function email(db: ReturnType<typeof service>) {
  const key = Deno.env.get('RESEND_API_KEY'), from = Deno.env.get('EMAIL_FROM'), appUrl = Deno.env.get('APP_URL');
  // Sem remetente de domínio verificado os e-mails ficam na fila (não são perdidos).
  if (!key || !from || !appUrl) return { skipped: 'email_not_configured' };
  const { data, error } = await db.rpc('claim_emails', { p_limit: 20 });
  if (error) throw new Error('claim_emails indisponível');
  const counts: Record<string, number> = {};
  for (const m of data ?? []) {
    let providerId: string | null = null, failure: string | null = null, perm = false;
    try {
      const { subject, html, text } = render(m.template, m.data ?? {}, appUrl);
      const r = await fetch('https://api.resend.com/emails', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': m.idempotency_key.slice(0, 256) },
        body: JSON.stringify({ from, to: [m.to_email], subject, html, text, tags: [{ name: 'template', value: m.template }] }) });
      const body = await r.json().catch(() => ({}));
      if (r.ok && typeof body.id === 'string') providerId = body.id;
      else { failure = `http_${r.status}:${String(body.name ?? '').slice(0, 60)}`; perm = permanent(r.status); }
    } catch (e) { failure = e instanceof Error ? e.message.slice(0, 200) : 'network_error'; perm = /Template desconhecido/.test(String(failure)); }
    const { data: status } = await db.rpc('finish_email', { p_id: m.id, p_provider_id: providerId, p_error: failure, p_permanent: perm });
    counts[status ?? 'unknown'] = (counts[status ?? 'unknown'] ?? 0) + 1;
  }
  return counts;
}
