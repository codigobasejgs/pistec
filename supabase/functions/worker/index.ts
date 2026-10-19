import { env, HttpError, serve, service } from '../_shared/http.ts';

serve(async request => {
  const supplied = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${env('WORKER_TOKEN')}`;
  const hash = async (s: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)));
  const [a,b] = await Promise.all([hash(supplied),hash(expected)]);
  if (a.reduce((v,n,i)=>v|(n^b[i]),0)!==0) throw new HttpError(401,'Worker não autorizado.');
  const db = service();
  const { data: events, error } = await db.rpc('claim_outbox',{p_limit:25});
  if (error) throw new HttpError(503,'Fila indisponível.');
  let processed=0, failed=0;
  for (const event of events ?? []) {
    try {
      // Transação SQL cria notificação deduplicada + finaliza o evento.
      const { error } = await db.rpc('deliver_internal_event',{p_id:event.id});
      if (error) throw error;
      processed++;
    } catch {
      failed++;
      const { error } = await db.rpc('finish_outbox',{p_id:event.id,p_error:'internal_delivery_failed'});
      if (error) throw new HttpError(503,'Falha ao registrar retentativa.');
    }
  }
  return {processed,failed};
});
