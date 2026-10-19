import { env, HttpError, providerJson } from './http.ts';

const base = 'https://api.checkout.infinitepay.io';
export function paymentMatches(result: unknown, expected: number): boolean {
  if (!result || typeof result !== 'object') return false;
  const r = result as Record<string, unknown>;
  return r.success === true && r.paid === true && Number.isSafeInteger(r.amount) && r.amount === expected
    && Number.isSafeInteger(r.paid_amount) && Number(r.paid_amount) >= expected
    && ['pix','credit_card'].includes(String(r.capture_method));
}
export async function checkPayment(order: string, transaction: string, slug: string) {
  return providerJson(`${base}/payment_check`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle: env('INFINITEPAY_HANDLE'), order_nsu: order, transaction_nsu: transaction, slug }) });
}
export async function createCheckout(invoice: { id: string; amount: number; description: string }) {
  if (!Number.isSafeInteger(invoice.amount) || invoice.amount <= 0) throw new HttpError(400, 'Fatura sem valor cobravel.');
  const origin = new URL(env('APP_URL'));
  if (origin.protocol !== 'https:') throw new HttpError(503, 'APP_URL deve usar HTTPS.');
  const webhook = new URL(`${env('SUPABASE_URL')}/functions/v1/billing-webhook`);
  webhook.searchParams.set('token', env('BILLING_WEBHOOK_TOKEN'));
  const response = await providerJson(`${base}/links`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    handle: env('INFINITEPAY_HANDLE'), order_nsu: invoice.id,
    items: [{ quantity: 1, price: invoice.amount, description: invoice.description }],
    redirect_url: new URL('/app/pagamento', origin).href, webhook_url: webhook.href,
  }) });
  if (typeof response?.url !== 'string') throw new HttpError(502, 'Checkout sem URL.');
  const url = new URL(response.url);
  if (url.protocol !== 'https:' || !(url.hostname === 'infinitepay.io' || url.hostname.endsWith('.infinitepay.io'))) throw new HttpError(502, 'URL de checkout inválida.');
  return url.href;
}
