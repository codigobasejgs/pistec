import { authenticated, body, env, HttpError, serve, service, uuid } from '../_shared/http.ts';
import { createCheckout } from '../_shared/infinitepay.ts';

serve(async request => {
  const { client, user } = await authenticated(request);
  const input = await body(request);
  const id = uuid(input.invoiceId, 'Fatura');
  // RLS primeiro; service_role nunca resolve uma fatura arbitrária do navegador.
  const { data: invoice, error } = await client.from('billing_invoices').select('id,tenant_id,amount,plan_id,period,status,checkout_url').eq('id', id).single();
  if (error || !invoice) throw new HttpError(404, 'Fatura não encontrada.');
  const { data: membership } = await client.from('memberships').select('role').eq('tenant_id', invoice.tenant_id).eq('user_id', user.id).eq('active', true).maybeSingle();
  if (!membership || !['Proprietário','Administrador'].includes(membership.role)) throw new HttpError(403, 'Seu perfil não permite gerar checkout.');
  if (!['Pendente','Vencida'].includes(invoice.status)) throw new HttpError(409, 'Fatura não está disponível para pagamento.');
  if (env('BILLING_ENABLED') !== 'true') throw new HttpError(503, 'Checkout desativado até homologação.');
  if (invoice.checkout_url) return { url: invoice.checkout_url, invoiceId: id };
  const amount = Number(invoice.amount);
  const url = await createCheckout({ id, amount, description: `Assinatura PISTEC ${invoice.plan_id} (${invoice.period})` });
  // Só o primeiro link é persistido: chamadas concorrentes recebem o mesmo checkout (evita pagamento em dobro).
  const db = service();
  const { data: saved, error: updateError } = await db.from('billing_invoices').update({ checkout_url: url }).eq('id', id).in('status', ['Pendente','Vencida']).is('checkout_url', null).select('checkout_url');
  if (updateError) throw new HttpError(503, 'Checkout gerado; persistência indisponível. Contate o suporte antes de tentar novamente.');
  if (saved?.length) return { url, invoiceId: id };
  const { data: current } = await db.from('billing_invoices').select('checkout_url').eq('id', id).in('status', ['Pendente','Vencida']).maybeSingle();
  if (!current?.checkout_url) throw new HttpError(409, 'Fatura não está mais disponível para pagamento.');
  return { url: current.checkout_url, invoiceId: id };
});
