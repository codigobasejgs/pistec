import type { BillingInvoice } from '../types';

export interface CheckoutInput {
  tenantId: string;
  amount: number;
  reference: string;
  dueDate: string;
  returnUrl?: string;
}
export interface CheckoutResult {
  id: string;
  provider: BillingInvoice['provider'];
  url: string;
  status: 'Pendente';
  simulated: true;
  invoice: BillingInvoice;
}
export interface BillingProviderAdapter {
  readonly provider: BillingInvoice['provider'];
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  getInvoice(reference: string): Promise<BillingInvoice>;
  handleCheckoutReturn(reference: string): Promise<BillingInvoice>;
  simulateWebhook(reference: string, status: 'Paga' | 'Cancelada', eventId: string): Promise<BillingInvoice>;
}
export interface MockBillingOptions { latency?: number; failNext?: boolean }

/** Somente demonstração local: sem HTTP, credenciais, dados de cartão ou confirmação real. */
export class MockAsaasAdapter implements BillingProviderAdapter {
  readonly provider: BillingInvoice['provider'] = 'Asaas';
  private readonly invoices = new Map<string, BillingInvoice>();
  private readonly events = new Map<string, string>();
  private readonly requests = new Map<string, string>();
  private readonly latency: number;
  private failNext: boolean;
  constructor(options: MockBillingOptions = {}) {
    this.latency = options.latency ?? 200;
    if (!Number.isFinite(this.latency) || this.latency < 0) throw new Error('Latência inválida.');
    this.failNext = options.failNext ?? false;
  }
  setFailNext(value: boolean): void { this.failNext = value; }
  private async delay(): Promise<void> {
    const fail = this.failNext; this.failNext = false;
    if (this.latency) await new Promise(resolve => setTimeout(resolve, this.latency));
    if (fail) throw new Error('Falha simulada no provedor. Nenhuma cobrança real foi criada.');
  }
  private invoice(reference: string): BillingInvoice {
    const invoice = this.invoices.get(reference);
    if (!invoice) throw new Error('Fatura simulada não encontrada.');
    return invoice;
  }
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!input.tenantId?.trim() || !input.reference?.trim()) throw new Error('Empresa e referência obrigatórias.');
    if (!Number.isSafeInteger(input.amount) || input.amount <= 0) throw new Error('Valor deve ser inteiro positivo em centavos.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dueDate) || !Number.isFinite(Date.parse(input.dueDate)) || new Date(input.dueDate).toISOString().slice(0, 10) !== input.dueDate) throw new Error('Vencimento inválido.');
    if (input.returnUrl && (!input.returnUrl.startsWith('/') || input.returnUrl.startsWith('//') || /[\\\s]/.test(input.returnUrl))) throw new Error('Retorno deve ser caminho local.');
    await this.delay();
    const fingerprint = JSON.stringify([input.tenantId, input.amount, input.dueDate, input.returnUrl || '/checkout/retorno']);
    const prior = this.requests.get(input.reference);
    if (prior && prior !== fingerprint) throw new Error('Referência já utilizada por outra cobrança.');
    const invoice: BillingInvoice = this.invoices.get(input.reference) ?? { id: `demo-${this.provider.toLowerCase()}-${encodeURIComponent(input.reference)}`, tenantId: input.tenantId, amount: input.amount, status: 'Pendente', dueDate: input.dueDate, provider: this.provider, reference: input.reference };
    this.invoices.set(input.reference, invoice); this.requests.set(input.reference, fingerprint);
    const params = new URLSearchParams({ provider: this.provider, reference: input.reference, simulated: 'true' });
    const path = input.returnUrl || '/checkout/retorno';
    const separator = path.includes('?') ? '&' : '?';
    return { id: invoice.id, provider: this.provider, url: `${path}${separator}${params}`, status: 'Pendente', simulated: true, invoice: structuredClone(invoice) };
  }
  async getInvoice(reference: string): Promise<BillingInvoice> { await this.delay(); return structuredClone(this.invoice(reference)); }
  /** Retorno de navegação não prova pagamento e nunca altera status. */
  async handleCheckoutReturn(reference: string): Promise<BillingInvoice> { return this.getInvoice(reference); }
  /** Simulador local explícito; nunca expor como webhook de produção. */
  async simulateWebhook(reference: string, status: 'Paga' | 'Cancelada', eventId: string): Promise<BillingInvoice> {
    if (!eventId.trim() || !['Paga', 'Cancelada'].includes(status)) throw new Error('Evento simulado inválido.');
    await this.delay();
    const invoice = this.invoice(reference);
    const fingerprint = JSON.stringify([reference, status]);
    const previous = this.events.get(eventId);
    if (previous) {
      if (previous !== fingerprint) throw new Error('ID de evento reutilizado com outro conteúdo.');
      return structuredClone(invoice);
    }
    if (invoice.status !== 'Pendente' && invoice.status !== status) throw new Error('Fatura já encerrada; transição recusada.');
    invoice.status = status;
    this.events.set(eventId, fingerprint);
    return structuredClone(invoice);
  }
}
export class MockInfinitePayAdapter extends MockAsaasAdapter {
  override readonly provider: BillingInvoice['provider'] = 'InfinitePay';
}
