import { body, env, HttpError, serve, service, text, uuid } from '../_shared/http.ts';
import { checkPayment, paymentMatches } from '../_shared/infinitepay.ts';

// Documentação InfinitePay (2026-10-26): webhook sem assinatura; reenvio só quando a resposta é 400.
// Por isso toda falha recuperável vira 400; 401 (token errado) não deve gerar reenvio.
serve(async request => {
  try { return await handle(request); }
  catch (error) {
    if (error instanceof HttpError && (error.status === 401 || error.status === 400)) throw error;
    throw new HttpError(400, 'Falha temporária; evento será reenviado.');
  }
});

async function handle(request: Request) {
  // Token privado de endpoint é defesa adicional; confirmação obrigatória via payment_check.
  const supplied = new URL(request.url).searchParams.get('token') ?? '';
  const expected = env('BILLING_WEBHOOK_TOKEN');
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  const [a,b] = await Promise.all([digest(supplied), digest(expected)]);
  if (a.reduce((diff,value,index) => diff | (value ^ b[index]),0) !== 0) throw new HttpError(401, 'Webhook não autorizado.');
  const input = await body(request);
  const invoiceId = uuid(input.order_nsu, 'Pedido'), transaction = text(input.transaction_nsu, 'Transação'), slug = text(input.invoice_slug, 'Fatura do provedor');
  const db = service();
  const { data: invoice, error } = await db.from('billing_invoices').select('id,amount,provider,status').eq('id', invoiceId).single();
  if (error || !invoice || invoice.provider !== 'InfinitePay') throw new HttpError(400, 'Pedido desconhecido.');
  const key = `${invoiceId}:${transaction}`;
  const { data: prior, error: priorError } = await db.from('webhook_events').select('status').eq('provider','InfinitePay').eq('event_key',key).maybeSingle();
  if (priorError) throw new HttpError(503, 'Não foi possível consultar o evento.');
  if (prior?.status === 'processed') return { received: true, duplicate: true };
  if (!prior) {
    const { error: insertError } = await db.from('webhook_events').insert({ provider: 'InfinitePay', event_key: key, payload: { order_nsu: invoiceId, transaction_nsu: transaction, invoice_slug: slug }, status: 'received' });
    if (insertError && insertError.code !== '23505') throw new HttpError(503, 'Não foi possível registrar o evento.');
  }
  const result = await checkPayment(invoiceId, transaction, slug);
  if (!paymentMatches(result, Number(invoice.amount))) {
    await db.from('webhook_events').update({ status: 'failed', error: 'Pagamento não confirmado ou valor divergente.' }).eq('provider','InfinitePay').eq('event_key',key);
    throw new HttpError(400, 'Pagamento não confirmado.');
  }
  const { data: confirmed, error: confirmError } = await db.rpc('confirm_provider_payment', {
    p_invoice: invoiceId, p_transaction: transaction, p_amount: result.amount, p_paid_amount: result.paid_amount,
    p_capture: result.capture_method, p_slug: slug,
  });
  // InfinitePay só reenvia quando a resposta é 400; falhas transitórias usam 400 para garantir nova tentativa.
  if (confirmError) throw new HttpError(400, 'Confirmação pendente; repita o evento.');
  // cancelled_invoice: transação registrada e Super Admin alertado (billing.review); reenvio não muda nada.
  if (!['paid','duplicate','already_paid','cancelled_invoice'].includes(confirmed)) throw new HttpError(400, 'Fatura não aceita este pagamento; conciliação manual necessária.');
  const { error: finishError } = await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString(), error: null }).eq('provider','InfinitePay').eq('event_key',key);
  if (finishError) throw new HttpError(503, 'Pagamento confirmado; evento aguardando finalização.');
  return { received: true };
}
