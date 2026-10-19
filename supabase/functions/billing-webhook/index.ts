import { body, env, HttpError, serve, service, text, uuid } from '../_shared/http.ts';
import { checkPayment, paymentMatches } from '../_shared/infinitepay.ts';

serve(async request => {
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
  if (confirmError) throw new HttpError(503, 'Confirmação pendente; repita o evento.');
  if (!['paid','duplicate','already_paid'].includes(confirmed)) throw new HttpError(409, 'Fatura não aceita este pagamento; conciliação manual necessária.');
  const { error: finishError } = await db.from('webhook_events').update({ status: 'processed', processed_at: new Date().toISOString(), error: null }).eq('provider','InfinitePay').eq('event_key',key);
  if (finishError) throw new HttpError(503, 'Pagamento confirmado; evento aguardando finalização.');
  return { received: true };
});
