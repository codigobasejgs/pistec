import type { DemoState, Tenant, Role, Sale, SaleInput, Product, OperationalRecord, StockBalance, FinancialEntry, Settlement, EntryStatus, ProductImportRow, ImportReport, Coupon, BillingPeriod, BillingInvoice } from './types';

const fail = (message: string): never => { throw new Error(message); };
function integer(value: number, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || value < minimum) fail(`${label}: valor inteiro inválido.`);
  return value;
}
function text(value: string, label: string): string {
  if (typeof value !== 'string' || !value.trim()) fail(`${label} obrigatório.`);
  return value.trim();
}
const sum = (values: number[]) => values.reduce((total, value) => integer(total + value, 'Total'), 0);
const normalized = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
// ponytail: relógio lógico mantém o domínio determinístico; backend deve fornecer data autoritativa.
/** O seed zera o relógio para gerar dados determinísticos. */
export const domainClock = { now: () => Date.now() };
function now(state: DemoState): string {
  // Hora real, mas monotônica em relação à auditoria: operações nunca "voltam no tempo".
  return new Date(Math.max(domainClock.now(),Math.max(0, ...state.audit.map(entry => Date.parse(entry.date))) + 1)).toISOString();
}
function id(state: DemoState, prefix: string): string {
  const ids = new Set([...Object.values(state).flatMap(value => Array.isArray(value) ? value.map(row => row.id as string | undefined) : []), ...state.cashRegisters.flatMap(cash => cash.movements.map(row => row.id))]);
  let index = 1;
  while (ids.has(`${prefix}-${index}`)) index++;
  return `${prefix}-${index}`;
}
function audit(state: DemoState, tenantId: string, action: string): void {
  state.audit.push({ id: id(state, 'audit'), tenantId, date: now(state), action });
}
function atomic<T>(state: DemoState, action: (draft: DemoState) => T): T {
  const draft = structuredClone(state);
  const result = action(draft);
  Object.assign(state, draft);
  return result;
}
function tenant(state: DemoState, tenantId: string): Tenant {
  return state.tenants.find(row => row.id === tenantId) ?? fail('Empresa não encontrada.');
}
function branch(state: DemoState, tenantId: string, branchId: string): void {
  tenant(state, tenantId);
  if (!state.branches.some(row => row.id === branchId && row.tenantId === tenantId && row.active)) fail('Filial inválida ou inativa.');
}
function product(state: DemoState, tenantId: string, productId: string, active = true): Product {
  return state.products.find(row => row.id === productId && row.tenantId === tenantId && (!active || row.active)) ?? fail('Produto inválido ou inativo.');
}
function balance(state: DemoState, tenantId: string, branchId: string, productId: string): StockBalance {
  let row = state.balances.find(item => item.tenantId === tenantId && item.branchId === branchId && item.productId === productId);
  if (!row) { row = { tenantId, branchId, productId, quantity: 0, reserved: 0 }; state.balances.push(row); }
  return row;
}
function record(state: DemoState, tenantId: string, recordId: string): OperationalRecord {
  tenant(state, tenantId);
  return state.records.find(row => row.tenantId === tenantId && row.id === recordId) ?? fail('Registro não encontrado.');
}
function quantities(items: { productId: string; quantity: number }[]): Map<string, number> {
  const result = new Map<string, number>();
  for (const item of items) result.set(text(item.productId, 'Produto'), integer((result.get(item.productId) ?? 0) + integer(item.quantity, 'Quantidade', 1), 'Quantidade', 1));
  return result;
}
function movement(state: DemoState, tenantId: string, branchId: string, productId: string, quantity: number, type: string, reference: string): void {
  state.movements.push({ id: id(state, 'mov'), tenantId, branchId, productId, quantity, type, reference, date: now(state) });
}
function finance(state: DemoState, entry: Omit<FinancialEntry, 'id' | 'date' | 'settlements'> & { settlements?: Settlement[] }): FinancialEntry {
  integer(entry.amount, 'Valor financeiro');
  const created: FinancialEntry = { ...entry, id: id(state, 'fin'), date: now(state), settlements: entry.settlements ?? [] };
  state.finances.push(created);
  return created;
}
function cashTotal(cash: DemoState['cashRegisters'][number]): number {
  const total = cash.opening + cash.movements.reduce((total, row) => total + row.amount, 0);
  return integer(total, 'Saldo do caixa');
}
const cashMethods = new Set(['dinheiro', 'cash']);
const paymentMethods = new Set(['dinheiro', 'cash', 'pix', 'cartao', 'credito', 'debito', 'cartao de credito', 'cartao de debito', 'transferencia', 'boleto']);

export function completeSale(state: DemoState, input: SaleInput): Sale {
  return atomic(state, draft => {
    branch(draft, input.tenantId, input.branchId);
    text(input.requestId, 'Chave da venda');
    const previous = draft.sales.find(row => row.tenantId === input.tenantId && row.requestId === input.requestId);
    if (previous) {
      const expectedItems = [...quantities(previous.items)].sort(([a], [b]) => a.localeCompare(b));
      const actualItems = [...quantities(input.items)].sort(([a], [b]) => a.localeCompare(b));
      const previousPayments = previous.payments.map(p => ({ method: p.method, amount: p.tendered ?? p.amount }));
      const inputPayments = input.payments.map(p => ({ method: p.method, amount: p.amount }));
      if (previous.branchId !== input.branchId || previous.customerId !== input.customerId || previous.seller !== input.seller.trim() || previous.discount !== input.discount || previous.surcharge !== input.surcharge || JSON.stringify(expectedItems) !== JSON.stringify(actualItems) || JSON.stringify(previousPayments) !== JSON.stringify(inputPayments)) fail('Chave da venda já utilizada com outro conteúdo.');
      return previous;
    }
    if (input.customerId && !draft.customers.some(row => row.id === input.customerId && row.tenantId === input.tenantId)) fail('Cliente inválido.');
    text(input.seller, 'Vendedor');
    if (!input.items.length) fail('Adicione produtos à venda.');
    const cash = draft.cashRegisters.find(row => row.tenantId === input.tenantId && row.branchId === input.branchId && !row.closedAt) ?? fail('Abra o caixa antes de vender.');
    const items = [...quantities(input.items)].map(([productId, quantity]) => {
      const item = product(draft, input.tenantId, productId);
      const stock = balance(draft, input.tenantId, input.branchId, productId);
      if (stock.quantity - stock.reserved < quantity) fail(`Estoque disponível insuficiente: ${item.name}.`);
      return { productId, quantity, name: item.name, price: integer(item.price, 'Preço'), cost: integer(item.cost, 'Custo') };
    });
    const subtotal = sum(items.map(item => integer(item.price * item.quantity, 'Subtotal')));
    const discount = integer(input.discount, 'Desconto');
    const surcharge = integer(input.surcharge, 'Acréscimo');
    if (discount > subtotal) fail('Desconto superior ao subtotal.');
    const total = integer(subtotal - discount + surcharge, 'Total', 1);

    if (!input.payments.length) fail('Pagamento obrigatório.');
    let nonCashTotal = 0;
    let cashTendered = 0;
    for (const payment of input.payments) {
      const norm = normalized(payment.method);
      if (!paymentMethods.has(norm)) fail('Forma de pagamento inválida.');
      const amount = integer(payment.amount, 'Pagamento', 1);
      if (cashMethods.has(norm)) {
        cashTendered += amount;
      } else {
        nonCashTotal += amount;
      }
    }
    if (nonCashTotal > total) fail('Valor de formas não-dinheiro excede o total da venda.');
    const totalTendered = nonCashTotal + cashTendered;
    if (totalTendered < total) fail('Pagamento insuficiente.');

    const cashAppliedNeeded = total - nonCashTotal;
    if (cashTendered < cashAppliedNeeded) fail('Pagamento insuficiente.');
    const change = cashTendered - cashAppliedNeeded;

    const recordedPayments: { method: string; amount: number; tendered?: number }[] = [];
    for (const payment of input.payments) {
      const norm = normalized(payment.method);
      const tendered = integer(payment.amount, 'Pagamento', 1);
      if (cashMethods.has(norm)) {
        // Aloca proporcionalmente se houver múltiplas entradas de dinheiro
        const applied = cashTendered > 0 ? Math.min(tendered, Math.max(0, cashAppliedNeeded)) : 0;
        recordedPayments.push({ method: payment.method, amount: applied, tendered });
      } else {
        recordedPayments.push({ method: payment.method, amount: tendered });
      }
    }
    // Garante soma exata de applied == total ajustando eventuais resíduos em dinheiro
    const appliedSum = sum(recordedPayments.map(p => p.amount));
    if (appliedSum !== total) {
      const cashEntry = recordedPayments.find(p => cashMethods.has(normalized(p.method)));
      if (cashEntry) cashEntry.amount = integer(cashEntry.amount + (total - appliedSum), 'Ajuste dinheiro');
    }

    const sale: Sale = { id: id(draft, 'sale'), tenantId: input.tenantId, branchId: input.branchId, customerId: input.customerId, seller: input.seller.trim(), items, discount, surcharge, total, payments: recordedPayments, change, status: 'Concluída', date: now(draft), requestId: input.requestId, cashId: cash.id };
    for (const item of items) {
      balance(draft, input.tenantId, input.branchId, item.productId).quantity -= item.quantity;
      movement(draft, input.tenantId, input.branchId, item.productId, item.quantity, 'Saída', sale.id);
    }
    // Caixa físico recebe somente o dinheiro líquido (entregue - troco = dinheiro aplicado)
    if (cashAppliedNeeded > 0) {
      cash.movements.push({ id: id(draft, 'cash-mov'), amount: cashAppliedNeeded, reason: `Venda ${sale.id}`, date: sale.date });
      cashTotal(cash);
    }
    const saleDate = sale.date.slice(0, 10);
    const saleFin = finance(draft, { tenantId: sale.tenantId, branchId: sale.branchId, type: 'Receita', category: 'Vendas', description: `Venda ${sale.id}`, amount: total, dueDate: saleDate, paid: true, reference: sale.id });
    // Baixa integral da receita à vista
    saleFin.settlements.push({ id: id(draft, 'settle'), requestId: `sale:${sale.id}`, amount: total, date: sale.date, method: recordedPayments[0]?.method || 'Dinheiro', user: sale.seller, note: `Quitação automática da venda ${sale.id}` });
    draft.sales.push(sale);
    audit(draft, sale.tenantId, `Venda concluída ${sale.id}`);
    return sale;
  });
}

export function cancelSale(state: DemoState, tenantId: string, saleId: string): void {
  atomic(state, draft => {
    tenant(draft, tenantId);
    const sale = draft.sales.find(row => row.tenantId === tenantId && row.id === saleId) ?? fail('Venda não encontrada.');
    if (sale.status === 'Cancelada') return;
    // Estorno do caixa: apenas o dinheiro líquido efetivamente retido (amount aplicado em dinheiro, nunca o entregue bruto)
    const netCashAmount = sum(sale.payments.filter(row => cashMethods.has(normalized(row.method))).map(row => row.amount));
    const cash = draft.cashRegisters.find(row => row.id === sale.cashId && row.tenantId === tenantId) ?? fail('Caixa não encontrado.');
    if (netCashAmount && cash.closedAt) fail('Não é possível estornar dinheiro em caixa fechado.');
    if (cashTotal(cash) < netCashAmount) fail('Saldo insuficiente para estorno.');
    for (const item of sale.items) {
      const stock = balance(draft, tenantId, sale.branchId, item.productId);
      stock.quantity = integer(stock.quantity + item.quantity, 'Estoque');
      movement(draft, tenantId, sale.branchId, item.productId, item.quantity, 'Estorno', sale.id);
    }
    if (netCashAmount) cash.movements.push({ id: id(draft, 'cash-mov'), amount: -netCashAmount, reason: `Estorno ${sale.id}`, date: now(draft) });
    const cancelDate = now(draft).slice(0, 10);
    const cancelFin = finance(draft, { tenantId, branchId: sale.branchId, type: 'Despesa', category: 'Estornos', description: `Estorno da venda ${sale.id}`, amount: sale.total, dueDate: cancelDate, paid: true, reference: `cancel:${sale.id}` });
    cancelFin.settlements.push({ id: id(draft, 'settle'), requestId: `cancel:${sale.id}`, amount: sale.total, date: now(draft), method: 'Estorno', user: 'Sistema', note: `Estorno automático da venda ${sale.id}` });
    sale.status = 'Cancelada';
    audit(draft, tenantId, `Venda cancelada ${sale.id}`);
  });
}

export function entryPaid(entry: FinancialEntry): number {
  return sum((entry.settlements ?? []).filter(s => !s.reversedAt).map(s => s.amount));
}
export function entryBalance(entry: FinancialEntry): number {
  return Math.max(0, entry.amount - entryPaid(entry));
}
export function entryStatus(entry: FinancialEntry, today: string): EntryStatus {
  if (entry.cancelled) return 'Cancelado';
  const paid = entryPaid(entry);
  if (paid >= entry.amount && entry.amount > 0) return 'Quitado';
  if (entry.paid) return 'Quitado';
  if (paid > 0) return 'Parcialmente pago';
  if (entry.dueDate && entry.dueDate < today) return 'Vencido';
  return 'Em aberto';
}

export interface SettleEntryInput {
  amount: number;
  method: string;
  date: string;
  user?: string;
  note?: string;
  requestId: string;
}

export function settleEntry(state: DemoState, tenantId: string, entryId: string, input: SettleEntryInput): Settlement {
  return atomic(state, draft => {
    tenant(draft, tenantId);
    text(input.requestId, 'Chave da baixa');
    const entry = draft.finances.find(row => row.tenantId === tenantId && row.id === entryId) ?? fail('Lançamento não encontrado.');
    if (entry.cancelled) fail('Lançamento cancelado.');
    entry.settlements ??= [];

    const existing = entry.settlements.find(s => s.requestId === input.requestId);
    if (existing) {
      if (existing.amount !== input.amount || existing.method !== input.method.trim()) {
        fail('Chave da baixa já utilizada com outro conteúdo.');
      }
      return existing;
    }

    integer(input.amount, 'Valor da baixa', 1);
    const balance = entryBalance(entry);
    if (input.amount > balance) fail('Valor da baixa superior ao saldo em aberto.');
    text(input.method, 'Forma de pagamento');
    if (!paymentMethods.has(normalized(input.method))) fail('Forma de pagamento inválida.');

    const settleDate = input.date ? input.date.trim() : now(draft).slice(0, 10);
    const settlement: Settlement = {
      id: id(draft, 'settle'),
      requestId: input.requestId,
      amount: input.amount,
      date: settleDate,
      method: input.method.trim(),
      user: input.user?.trim() || 'Sistema',
      note: input.note?.trim() || '',
    };
    entry.settlements.push(settlement);
    entry.paid = entryPaid(entry) >= entry.amount;
    audit(draft, tenantId, `Baixa ${settlement.id} no valor de ${settlement.amount} em ${entry.id}`);
    return settlement;
  });
}

export function reverseSettlement(state: DemoState, tenantId: string, entryId: string, settlementId: string, user?: string, reason?: string): Settlement {
  return atomic(state, draft => {
    tenant(draft, tenantId);
    const entry = draft.finances.find(row => row.tenantId === tenantId && row.id === entryId) ?? fail('Lançamento não encontrado.');
    entry.settlements ??= [];
    const settlement = entry.settlements.find(s => s.id === settlementId) ?? fail('Baixa não encontrada.');
    if (settlement.reversedAt) return settlement;
    text(reason ?? '', 'Motivo do estorno');
    settlement.reversedAt = now(draft);
    settlement.reversedBy = user?.trim() || 'Sistema';
    settlement.reversalReason = reason?.trim();
    entry.paid = entryPaid(entry) >= entry.amount;
    audit(draft, tenantId, `Estorno da baixa ${settlement.id} em ${entry.id}`);
    return settlement;
  });
}

export function cancelEntry(state: DemoState, tenantId: string, entryId: string, user?: string, reason?: string): FinancialEntry {
  return atomic(state, draft => {
    tenant(draft, tenantId);
    const entry = draft.finances.find(row => row.tenantId === tenantId && row.id === entryId) ?? fail('Lançamento não encontrado.');
    if (entry.cancelled) return entry;
    const activeSettlements = (entry.settlements ?? []).filter(s => !s.reversedAt);
    if (activeSettlements.length > 0) fail('Não é possível cancelar lançamento com baixas ativas. Estorne as baixas primeiro.');
    text(reason ?? '', 'Motivo do cancelamento');
    entry.cancelled = true;
    entry.paid = false;
    audit(draft, tenantId, `Cancelamento do lançamento ${entry.id} por ${user?.trim() || 'Sistema'}: ${reason?.trim()}`);
    return entry;
  });
}

export function moveStock(state: DemoState, tenantId: string, branchId: string, productId: string, quantity: number, type: string, reference: string): void {
  atomic(state, draft => {
    branch(draft, tenantId, branchId);
    product(draft, tenantId, productId);
    text(reference, 'Referência');
    if (!['Entrada', 'Saída', 'Ajuste'].includes(type)) fail('Tipo de movimentação inválido.');
    integer(quantity, 'Quantidade', type === 'Ajuste' ? 0 : 1);
    const previous = draft.movements.find(row => row.tenantId === tenantId && row.branchId === branchId && row.productId === productId && row.type === type && row.reference === reference);
    if (previous) { if (previous.quantity !== quantity) fail('Referência já utilizada com outra quantidade.'); return; }
    const stock = balance(draft, tenantId, branchId, productId);
    const next = type === 'Ajuste' ? quantity : stock.quantity + (type === 'Entrada' ? quantity : -quantity);
    integer(next, 'Estoque');
    if (next < stock.reserved) fail('Movimento compromete estoque reservado.');
    stock.quantity = next;
    movement(draft, tenantId, branchId, productId, quantity, type, reference);
    audit(draft, tenantId, `${type} de estoque: ${reference}`);
  });
}

export function transferStock(state: DemoState, tenantId: string, from: string, to: string, productId: string, quantity: number): void {
  atomic(state, draft => {
    branch(draft, tenantId, from); branch(draft, tenantId, to);
    product(draft, tenantId, productId);
    integer(quantity, 'Quantidade', 1);
    if (from === to) fail('Selecione filiais diferentes.');
    const origin = balance(draft, tenantId, from, productId);
    const destination = balance(draft, tenantId, to, productId);
    if (origin.quantity - origin.reserved < quantity) fail('Estoque disponível insuficiente.');
    const next = integer(destination.quantity + quantity, 'Estoque');
    const reference = `transfer:${id(draft, 'mov')}`;
    origin.quantity -= quantity; destination.quantity = next;
    movement(draft, tenantId, from, productId, quantity, 'Transferência saída', reference);
    movement(draft, tenantId, to, productId, quantity, 'Transferência entrada', reference);
    audit(draft, tenantId, reference);
  });
}

const osTransitions: Record<string, string[]> = {
  Aberta: ['Em diagnóstico', 'Aguardando aprovação', 'Em execução', 'Cancelada'],
  'Em diagnóstico': ['Aguardando aprovação', 'Aguardando peças', 'Em execução', 'Cancelada'],
  'Aguardando aprovação': ['Aguardando peças', 'Em execução', 'Cancelada'],
  'Aguardando peças': ['Em execução', 'Cancelada'],
  'Em execução': ['Em testes', 'Pronta', 'Cancelada'],
  'Em testes': ['Em execução', 'Pronta', 'Cancelada'],
  Pronta: ['Entregue', 'Cancelada'], Entregue: [], Cancelada: [],
};
function osStock(state: DemoState, row: OperationalRecord, status: string): void {
  const stockState = row.fields.stockState;
  if (status === 'Em execução' && stockState !== 'reserved') {
    for (const [productId, quantity] of quantities(row.items)) {
      product(state, row.tenantId, productId);
      const stock = balance(state, row.tenantId, row.branchId, productId);
      if (stock.quantity - stock.reserved < quantity) fail('Estoque insuficiente para reservar OS.');
      stock.reserved += quantity;
      movement(state, row.tenantId, row.branchId, productId, quantity, 'Reserva OS', row.id);
    }
    row.fields.stockState = 'reserved';
  }
  if (status === 'Pronta' && stockState !== 'consumed') {
    if (stockState !== 'reserved' && row.items.length) fail('Reserve os itens antes de concluir.');
    for (const [productId, quantity] of quantities(row.items)) {
      const stock = balance(state, row.tenantId, row.branchId, productId);
      if (stock.reserved < quantity || stock.quantity < quantity) fail('Reserva inconsistente.');
      stock.reserved -= quantity; stock.quantity -= quantity;
      movement(state, row.tenantId, row.branchId, productId, quantity, 'Consumo OS', row.id);
    }
    row.fields.stockState = 'consumed';
    if (row.amount) finance(state, { tenantId: row.tenantId, branchId: row.branchId, type: 'Receita', category: 'Serviços', description: row.title, amount: row.amount, dueDate: now(state).slice(0, 10), paid: false, reference: row.id });
  }
  if (status === 'Cancelada' && (stockState === 'reserved' || stockState === 'consumed')) {
    if (state.finances.some(entry => entry.reference === row.id && entry.tenantId === row.tenantId && entry.paid)) fail('Estorne o recebimento da OS antes de cancelar.');
    for (const [productId, quantity] of quantities(row.items)) {
      const stock = balance(state, row.tenantId, row.branchId, productId);
      if (stockState === 'reserved') { if (stock.reserved < quantity) fail('Reserva inconsistente.'); stock.reserved -= quantity; }
      else stock.quantity = integer(stock.quantity + quantity, 'Estoque');
      movement(state, row.tenantId, row.branchId, productId, quantity, 'Reversão OS', row.id);
    }
    state.finances = state.finances.filter(entry => !(entry.tenantId === row.tenantId && entry.reference === row.id));
    row.fields.stockState = 'released';
  }
}
export function transitionRecord(state: DemoState, tenantId: string, recordId: string, requestedStatus: string): void {
  atomic(state, draft => {
    const row = record(draft, tenantId, recordId);
    branch(draft, tenantId, row.branchId);
    let status = text(requestedStatus, 'Status');
    if (row.kind === 'ordens-servico') {
      status = ({ 'Em andamento': 'Em execução', Concluída: 'Pronta' } as Record<string, string>)[status] ?? status;
      if (row.status === status) return;
      if (!osTransitions[row.status]?.includes(status)) fail('Transição de OS inválida.');
      integer(row.amount, 'Valor da OS');
      osStock(draft, row, status);
    } else {
      if (row.status === status) return;
      if (row.kind === 'compras' && (!['Pendente', 'Aprovada', 'Pedido', 'Enviada'].includes(row.status) || !['Cancelada', 'Cancelado'].includes(status))) fail('Receba a compra pela operação de recebimento.');
      if (row.convertedId || ['Cancelado', 'Cancelada', 'Convertido', 'Convertida', 'Rejeitado', 'Recusado'].includes(row.status)) fail('Registro encerrado.');
      if (row.kind === 'orcamentos' && !['Rascunho', 'Aberto', 'Enviado', 'Aprovado', 'Rejeitado', 'Recusado', 'Cancelado', 'Expirado'].includes(status)) fail('Status de orçamento inválido.');
    }
    row.status = status;
    row.history.push({ date: now(draft), text: `Status: ${status}` });
    audit(draft, tenantId, `${row.id}: ${status}`);
  });
}

export function convertRecord(state: DemoState, tenantId: string, recordId: string, targetKind: string): void {
  atomic(state, draft => {
    const source = record(draft, tenantId, recordId);
    if (source.convertedId) {
      const target = record(draft, tenantId, source.convertedId);
      if (target.kind !== targetKind) fail('Registro já convertido para outro tipo.');
      return;
    }
    const quoteConversion = source.kind === 'orcamentos' && ['ordens-servico', 'pedidos'].includes(targetKind);
    const leadConversion = ['crm', 'agenda'].includes(source.kind) && targetKind === 'orcamentos';
    if (!quoteConversion && !leadConversion) fail('Conversão não permitida.');
    if (quoteConversion && source.status !== 'Aprovado') fail('Aprove o orçamento antes de converter.');
    if (leadConversion && ['Cancelado', 'Cancelada', 'Perdido'].includes(source.status)) fail('Registro encerrado não pode ser convertido.');
    branch(draft, tenantId, source.branchId);
    integer(source.amount, 'Valor do orçamento');
    for (const item of source.items) { product(draft, tenantId, item.productId); integer(item.quantity, 'Quantidade', 1); integer(item.price, 'Preço'); integer(item.cost, 'Custo'); }
    const target: OperationalRecord = { ...structuredClone(source), id: id(draft, 'record'), kind: targetKind, status: targetKind === 'ordens-servico' ? 'Aberta' : targetKind === 'orcamentos' ? 'Aberto' : 'Pendente', date: now(draft), fields: { ...source.fields, sourceId: source.id }, history: [{ date: now(draft), text: `Convertido de ${source.id}` }] };
    delete target.convertedId; delete target.fields.stockState;
    draft.records.push(target);
    source.convertedId = target.id; source.status = 'Convertido';
    source.history.push({ date: now(draft), text: `Convertido para ${target.id}` });
    audit(draft, tenantId, `Conversão ${source.id} em ${target.id}`);
  });
}

export function openCash(state: DemoState, tenantId: string, branchId: string, opening: number): void {
  atomic(state, draft => {
    branch(draft, tenantId, branchId); integer(opening, 'Fundo de caixa');
    const existing = draft.cashRegisters.find(row => row.tenantId === tenantId && row.branchId === branchId && !row.closedAt);
    if (existing) { if (existing.opening !== opening) fail('Já existe caixa aberto nesta filial.'); return; }
    draft.cashRegisters.push({ id: id(draft, 'cash'), tenantId, branchId, opening, openedAt: now(draft), movements: [] });
    audit(draft, tenantId, `Caixa aberto: ${branchId}`);
  });
}
export function closeCash(state: DemoState, tenantId: string, cashId: string, counted: number, reason?: string, user?: string): void {
  atomic(state, draft => {
    tenant(draft, tenantId); integer(counted, 'Valor contado');
    const cash = draft.cashRegisters.find(row => row.tenantId === tenantId && row.id === cashId) ?? fail('Caixa não encontrado.');
    if (cash.closedAt) {
      if (cash.counted !== counted) fail('Caixa já encerrado com outro valor.');
      return;
    }
    const expected = cashTotal(cash);
    const difference = counted - expected;
    if (difference !== 0 && (!reason || !reason.trim())) {
      fail('Diferença de caixa exige motivo.');
    }
    cash.counted = counted;
    cash.expected = expected;
    cash.difference = difference;
    if (reason?.trim()) cash.closingReason = reason.trim();
    if (user?.trim()) cash.closedBy = user.trim();
    cash.closedAt = now(draft);
    audit(draft, tenantId, `Caixa ${cashId} fechado; esperado ${expected}; contado ${counted}; diferença ${difference}`);
  });
}
export function receivePurchase(state: DemoState, tenantId: string, recordId: string): void {
  atomic(state, draft => {
    const row = record(draft, tenantId, recordId);
    if (row.kind !== 'compras') fail('Registro não é uma compra.');
    if (row.status === 'Recebida') return;
    if (!['Pendente', 'Aprovada', 'Pedido', 'Enviada'].includes(row.status)) fail('Compra não pode ser recebida.');
    branch(draft, tenantId, row.branchId);
    if (!row.items.length) fail('Compra sem itens.');
    const total = sum(row.items.map(item => integer(integer(item.quantity, 'Quantidade', 1) * integer(item.cost, 'Custo'), 'Subtotal')));
    if (integer(row.amount, 'Valor da compra') !== total) fail('Total da compra difere do custo dos itens.');
    for (const [productId, quantity] of quantities(row.items)) {
      product(draft, tenantId, productId);
      const stock = balance(draft, tenantId, row.branchId, productId);
      stock.quantity = integer(stock.quantity + quantity, 'Estoque');
      movement(draft, tenantId, row.branchId, productId, quantity, 'Recebimento', row.id);
    }
    finance(draft, { tenantId, branchId: row.branchId, type: 'Despesa', category: 'Compras', description: row.title, amount: total, paid: false, dueDate: row.fields.dueDate || now(draft).slice(0, 10), reference: row.id });
    row.status = 'Recebida'; row.history.push({ date: now(draft), text: 'Mercadoria recebida; conta a pagar gerada.' });
    audit(draft, tenantId, `Compra recebida ${row.id}`);
  });
}

export function saveProduct(state: DemoState, value: Product): void {
  atomic(state, draft => {
    const owner = tenant(draft, value.tenantId);
    text(value.id, 'ID'); text(value.name, 'Nome'); text(value.sku, 'SKU');
    integer(value.cost, 'Custo'); integer(value.price, 'Preço'); integer(value.min, 'Mínimo'); integer(value.max, 'Máximo');
    if (value.max && value.max < value.min) fail('Máximo inferior ao mínimo.');
    const existing = draft.products.find(row => row.id === value.id);
    if (existing && existing.tenantId !== value.tenantId) fail('Produto pertence a outra empresa.');
    if (draft.products.some(row => row.tenantId === value.tenantId && row.id !== value.id && (normalized(row.sku) === normalized(value.sku) || (value.barcode.trim() && row.barcode.trim() === value.barcode.trim())))) fail('SKU ou código de barras duplicado.');
    const plan = draft.plans.find(row => row.id === owner.planId) ?? fail('Plano inválido.');
    if (value.active && !existing?.active && draft.products.filter(row => row.tenantId === value.tenantId && row.active).length >= plan.products) fail('Limite de produtos do plano atingido.');
    if (!value.active && draft.balances.some(row => row.productId === value.id && row.tenantId === value.tenantId && row.reserved)) fail('Produto com reserva não pode ser desativado.');
    const clean = { ...structuredClone(value), name: value.name.trim(), sku: value.sku.trim(), barcode: value.barcode.trim() };
    if (existing) Object.assign(existing, clean); else draft.products.push(clean);
    audit(draft, value.tenantId, `Produto salvo: ${value.name}`);
  });
}

export function importProducts(state: DemoState, tenantId: string, rows: ProductImportRow[], strategy: 'create' | 'update' | 'upsert'): ImportReport {
  return atomic(state, draft => {
    const owner = tenant(draft, tenantId);
    const plan = draft.plans.find(p => p.id === owner.planId) ?? fail('Plano inválido.');
    const report: ImportReport = { created: 0, updated: 0, skipped: 0, errors: [] };
    if (!['create', 'update', 'upsert'].includes(strategy)) fail('Estratégia de importação inválida.');

    const sheetSkus = new Set<string>();
    const sheetBarcodes = new Set<string>();

    for (const row of rows) {
      const line = row.line ?? 0;
      // Validações básicas de linha
      if (!row.name || typeof row.name !== 'string' || !row.name.trim()) {
        report.errors.push({ line, message: 'Nome do produto é obrigatório.' });
        continue;
      }
      if (!row.sku || typeof row.sku !== 'string' || !row.sku.trim()) {
        report.errors.push({ line, message: 'SKU é obrigatório.' });
        continue;
      }
      const rawSku = row.sku.trim();
      const normSku = normalized(rawSku);
      if (sheetSkus.has(normSku)) {
        report.errors.push({ line, message: `SKU duplicado na planilha: ${rawSku}.` });
        continue;
      }
      sheetSkus.add(normSku);

      const rawBarcode = (row.barcode || '').toString().trim();
      if (rawBarcode) {
        if (sheetBarcodes.has(rawBarcode)) {
          report.errors.push({ line, message: `Código de barras duplicado na planilha: ${rawBarcode}.` });
          continue;
        }
        sheetBarcodes.add(rawBarcode);
      }

      const cost = Number(row.cost);
      const price = Number(row.price);
      const min = Number(row.min ?? 0);
      const max = Number(row.max ?? 0);
      if (!Number.isSafeInteger(cost) || cost < 0 || !Number.isSafeInteger(price) || price < 0 || !Number.isSafeInteger(min) || min < 0 || !Number.isSafeInteger(max) || max < 0) {
        report.errors.push({ line, message: 'Valores de custo, preço e limites devem ser inteiros em centavos/unidades.' });
        continue;
      }
      if (max && max < min) {
        report.errors.push({ line, message: 'Estoque máximo não pode ser inferior ao mínimo.' });
        continue;
      }

      // Procura produto existente por SKU no tenant
      const existing = draft.products.find(p => p.tenantId === tenantId && normalized(p.sku) === normSku);

      // Conflito de código de barras com outro produto existente
      if (rawBarcode) {
        const barcodeConflict = draft.products.find(p => p.tenantId === tenantId && p.id !== existing?.id && p.barcode.trim() === rawBarcode);
        if (barcodeConflict) {
          report.errors.push({ line, message: `Código de barras já utilizado por outro produto: ${rawBarcode}.` });
          continue;
        }
      }

      if (strategy === 'create') {
        if (existing) {
          report.skipped++;
          continue;
        }
      } else if (strategy === 'update') {
        if (!existing) {
          report.skipped++;
          continue;
        }
      }

      if (existing) {
        // Atualização
        existing.name = row.name.trim();
        existing.barcode = rawBarcode;
        existing.category = (row.category || existing.category || 'Geral').trim();
        existing.brand = (row.brand || existing.brand || '').trim();
        existing.cost = cost;
        existing.price = price;
        existing.min = min;
        existing.max = max;
        existing.location = (row.location || existing.location || '').trim();
        if (row.unit) existing.details = { ...existing.details, unit: row.unit };
        report.updated++;
      } else {
        // Criação: valida limite do plano
        const activeCount = draft.products.filter(p => p.tenantId === tenantId && p.active).length;
        if (activeCount >= plan.products) {
          report.errors.push({ line, message: 'Limite de produtos do plano atingido.' });
          continue;
        }
        const newProduct: Product = {
          id: id(draft, 'product'),
          tenantId,
          name: row.name.trim(),
          sku: rawSku,
          barcode: rawBarcode,
          category: (row.category || 'Geral').trim(),
          brand: (row.brand || '').trim(),
          cost,
          price,
          min,
          max,
          location: (row.location || '').trim(),
          active: true,
          details: row.unit ? { unit: row.unit } : {},
        };
        draft.products.push(newProduct);
        // Cria saldo zerado em todas as filiais do tenant
        for (const b of draft.branches.filter(br => br.tenantId === tenantId)) {
          draft.balances.push({ tenantId, branchId: b.id, productId: newProduct.id, quantity: 0, reserved: 0 });
        }
        report.created++;
      }
    }

    audit(draft, tenantId, `Importação de produtos (${strategy}): ${report.created} criados, ${report.updated} atualizados, ${report.skipped} ignorados, ${report.errors.length} erros`);
    return report;
  });
}

// -------------------------------------------------------------
// Cupons SaaS e Faturas de Assinatura
// -------------------------------------------------------------

export function saveCoupon(state: DemoState, coupon: Partial<Coupon>): Coupon {
  return atomic(state, draft => {
    const rawCode = text(coupon.code ?? '', 'Código do cupom');
    const code = rawCode.toUpperCase().replace(/\s+/g, '');
    if (!/^[A-Z0-9_-]{3,30}$/.test(code)) fail('Código do cupom inválido. Use 3 a 30 caracteres alfanuméricos.');

    const description = text(coupon.description ?? '', 'Descrição do cupom');
    const kind = coupon.kind;
    if (kind !== 'percent' && kind !== 'fixed') fail('Tipo de cupom inválido.');
    const value = integer(coupon.value ?? 0, 'Valor do cupom', 1);
    if (kind === 'percent' && (value < 1 || value > 10000)) fail('Percentual em pontos-base deve estar entre 1 e 10000.');

    const startsAt = text(coupon.startsAt ?? '', 'Data de início');
    const endsAt = text(coupon.endsAt ?? '', 'Data de término');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startsAt) || !/^\d{4}-\d{2}-\d{2}$/.test(endsAt)) fail('Datas de vigência inválidas.');
    if (startsAt > endsAt) fail('Data de início posterior ao término.');

    const maxUses = integer(coupon.maxUses ?? 0, 'Limite de usos');
    const perTenant = integer(coupon.perTenant ?? 0, 'Limite por empresa');

    const couponId = coupon.id?.trim() || id(draft, 'coupon');
    const existing = draft.coupons.find(c => c.id === couponId);
    const codeConflict = draft.coupons.find(c => c.id !== couponId && c.code === code);
    if (codeConflict) fail('Código de cupom já cadastrado.');

    const clean: Coupon = {
      id: couponId,
      code,
      description,
      kind: kind as 'percent' | 'fixed',
      value,
      startsAt,
      endsAt,
      maxUses,
      perTenant,
      planIds: Array.isArray(coupon.planIds) ? [...coupon.planIds] : [],
      periods: Array.isArray(coupon.periods) ? [...coupon.periods] : [],
      active: coupon.active ?? true,
      scope: 'first',
    };

    if (existing) {
      Object.assign(existing, clean);
    } else {
      draft.coupons.push(clean);
    }
    audit(draft, 'platform', `Cupom salvo: ${clean.code}`);
    return clean;
  });
}

export interface CouponQuoteResult {
  coupon: Coupon;
  original: number;
  discount: number;
  total: number;
}

export function couponQuote(state: DemoState, tenantId: string, code: string, planId: string, period: BillingPeriod, today: string): CouponQuoteResult {
  tenant(state, tenantId);
  const plan = state.plans.find(p => p.id === planId) ?? fail('Plano inválido.');
  const original = plan[period];
  if (!Number.isSafeInteger(original) || original <= 0) fail('Valor de plano/período inválido.');

  const normCode = (code || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!normCode) fail('Código do cupom obrigatório.');
  const coupon = state.coupons.find(c => c.code === normCode) ?? fail('Cupom inexistente.');
  if (!coupon.active) fail('Cupom inativo.');
  if (coupon.startsAt && today < coupon.startsAt) fail('Cupom fora da vigência.');
  if (coupon.endsAt && today > coupon.endsAt) fail('Cupom fora da vigência.');
  if (coupon.planIds.length > 0 && !coupon.planIds.includes(planId)) fail('Cupom não aplicável a este plano.');
  if (coupon.periods.length > 0 && !coupon.periods.includes(period)) fail('Cupom não aplicável a este período.');

  // Validação de limites
  const redemptions = state.couponRedemptions.filter(r => r.couponId === coupon.id);
  if (coupon.maxUses > 0 && redemptions.length >= coupon.maxUses) fail('Limite total de usos do cupom atingido.');
  const tenantRedemptions = redemptions.filter(r => r.tenantId === tenantId);
  if (coupon.perTenant > 0 && tenantRedemptions.length >= coupon.perTenant) fail('Limite de usos por empresa atingido.');

  let discount = 0;
  if (coupon.kind === 'percent') {
    discount = Math.round((original * coupon.value) / 10000);
  } else {
    discount = coupon.value;
  }
  discount = Math.min(original, Math.max(0, discount));
  const total = original - discount;
  return { coupon, original, discount, total };
}

export interface CreateSubscriptionInvoiceInput {
  tenantId: string;
  planId: string;
  period: BillingPeriod;
  couponCode?: string;
  provider: 'Asaas' | 'InfinitePay';
  requestId: string;
  today: string;
}

export function createSubscriptionInvoice(state: DemoState, input: CreateSubscriptionInvoiceInput): BillingInvoice {
  return atomic(state, draft => {
    tenant(draft, input.tenantId);
    text(input.requestId, 'Chave da fatura');
    const plan = draft.plans.find(p => p.id === input.planId) ?? fail('Plano inválido.');
    if (!['monthly', 'quarterly', 'annual'].includes(input.period)) fail('Período de faturamento inválido.');
    if (!['Asaas', 'InfinitePay'].includes(input.provider)) fail('Provedor de pagamento inválido.');
    const today = text(input.today, 'Data de referência');

    const expectedRef = `subscription:${input.tenantId}:${input.requestId}`;
    const previous = draft.invoices.find(i => i.tenantId === input.tenantId && i.reference === expectedRef);
    if (previous) {
      const prevCode = previous.couponCode || '';
      const inputCode = (input.couponCode || '').trim().toUpperCase().replace(/\s+/g, '');
      if (previous.planId !== input.planId || previous.period !== input.period || previous.provider !== input.provider || prevCode !== inputCode) {
        fail('Chave de fatura já utilizada com outro conteúdo.');
      }
      return previous;
    }

    const original = plan[input.period];
    let discount = 0;
    let coupon: Coupon | undefined;
    if (input.couponCode && input.couponCode.trim()) {
      const quote = couponQuote(draft, input.tenantId, input.couponCode, input.planId, input.period, today);
      coupon = quote.coupon;
      discount = quote.discount;
    }
    const finalAmount = Math.max(0, original - discount);

    // Vencimento = 7 dias a partir de today
    const dueDate = new Date(Date.parse(today) + 7 * 86400000).toISOString().slice(0, 10);
    const invoiceId = id(draft, 'invoice');

    const invoice: BillingInvoice = {
      id: invoiceId,
      tenantId: input.tenantId,
      amount: finalAmount,
      status: 'Pendente',
      dueDate,
      provider: input.provider,
      reference: expectedRef,
      planId: input.planId,
      period: input.period,
      originalAmount: original,
      discount: discount > 0 ? discount : undefined,
      couponCode: coupon ? coupon.code : undefined,
    };
    draft.invoices.push(invoice);

    if (coupon && discount > 0) {
      draft.couponRedemptions.push({
        id: id(draft, 'redemption'),
        couponId: coupon.id,
        tenantId: input.tenantId,
        invoiceId: invoice.id,
        discount,
        date: today,
      });
    }

    audit(draft, input.tenantId, `Fatura de assinatura criada: ${invoice.id} (${input.planId}/${input.period})${coupon ? ` cupom ${coupon.code}` : ''}`);
    return invoice;
  });
}

export function createTenant(state: DemoState, input: Partial<Tenant>): Tenant {
  return atomic(state, draft => {
    const name = text(input.name ?? '', 'Nome');
    const slug = normalized(input.slug || name).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    if (!slug || draft.tenants.some(row => row.slug === slug)) fail('Identificador da empresa indisponível.');
    const planId = input.planId || 'essencial';
    const plan = draft.plans.find(row => row.id === planId) ?? fail('Plano inválido.');
    const email = text(input.email ?? '', 'Email');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email inválido.');
    const tenantId = input.id || id(draft, 'tenant');
    if (draft.tenants.some(row => row.id === tenantId)) fail('ID da empresa duplicado.');
    const created: Tenant = {
      id: tenantId, name, slug, legalName: input.legalName || name, document: input.document || '', owner: text(input.owner || name, 'Responsável'), email, profile: input.profile || 'Autopeças', planId, status: input.status || 'Teste', dueDate: input.dueDate || new Date(Date.parse(now(draft)) + integer(plan.trialDays, 'Dias de teste') * 86400000).toISOString().slice(0, 10), notes: input.notes || '',
      branding: input.branding ? structuredClone(input.branding) : { primary: '#2dd4bf', secondary: '#6366f1', accent: '#f59e0b', sidebar: '#0f172a', theme: 'dark', logo: '', font: 'Inter', density: 'comfortable', radius: 'default', footer: 'Gestão com PISTEC', widgets: ['revenue', 'sales', 'stock', 'services'] },
    };
    draft.tenants.push(created);
    draft.branches.push({ id: id(draft, 'branch'), tenantId, name: 'Matriz', active: true });
    audit(draft, tenantId, `Empresa criada: ${name}`);
    return created;
  });
}

const permissions: Record<Role, string[]> = {
  Proprietário: ['*'], Administrador: ['*'],
  Gerente: ['dashboard', 'pdv', 'produtos', 'estoque', 'clientes', 'ordens-servico', 'orcamentos', 'compras', 'fornecedores', 'financeiro', 'caixa', 'relatorios', 'agenda', 'veiculos', 'whatsapp', 'crm', 'tarefas', 'garantias', 'vendas', 'funcionarios'],
  Vendedor: ['dashboard', 'pdv', 'clientes', 'produtos:visualizar', 'estoque:visualizar', 'orcamentos', 'vendas:visualizar', 'crm', 'agenda'],
  Caixa: ['dashboard', 'pdv', 'caixa', 'clientes:visualizar', 'produtos:visualizar', 'vendas:visualizar'],
  Estoquista: ['dashboard', 'produtos', 'estoque', 'compras', 'fornecedores'],
  Mecânico: ['dashboard', 'ordens-servico', 'veiculos', 'agenda', 'produtos:visualizar', 'estoque:visualizar', 'garantias'],
  Atendente: ['dashboard', 'clientes', 'agenda', 'whatsapp', 'orcamentos', 'crm', 'ordens-servico:visualizar'],
  Financeiro: ['dashboard', 'financeiro', 'caixa', 'relatorios', 'compras:visualizar', 'vendas:visualizar', 'clientes:visualizar'],
};
export function can(role: Role, module: string, action = 'visualizar'): boolean {
  if (!['visualizar', 'cadastrar', 'editar', 'excluir', 'cancelar', 'exportar', 'configurar'].includes(action)) return false;
  const allowed = permissions[role];
  if (!allowed) return false;
  if (allowed.includes('*')) return true;
  if (action === 'configurar') return false;
  if (['excluir', 'cancelar'].includes(action) && !['Gerente', 'Financeiro'].includes(role)) return false;
  return allowed.includes(module) || allowed.includes(`${module}:${action}`);
}

/** Limite do store: rejeita snapshots inválidos mesmo em edições diretas do draft. */
export function validateState(state: DemoState): void {
  integer(state.version, 'Versão', 1);

  // Garante coleções v2 presentes
  state.coupons ??= [];
  state.couponRedemptions ??= [];

  const collections = [
    state.tenants, state.plans, state.branches, state.products, state.customers,
    state.movements, state.sales, state.cashRegisters, state.finances, state.records,
    state.invoices, state.coupons, state.couponRedemptions, state.audit,
  ];
  for (const collection of collections) {
    if (new Set(collection.map(row => row.id)).size !== collection.length) fail('IDs duplicados.');
  }

  // Lookup maps O(1)
  const tenantMap = new Map(state.tenants.map(t => [t.id, t]));
  const branchMap = new Map(state.branches.map(b => [`${b.tenantId}:${b.id}`, b]));
  const planMap = new Map(state.plans.map(p => [p.id, p]));
  const customerMap = new Map(state.customers.map(c => [`${c.tenantId}:${c.id}`, c]));
  const productMap = new Map(state.products.map(p => [`${p.tenantId}:${p.id}`, p]));
  const cashMap = new Map(state.cashRegisters.map(c => [`${c.tenantId}:${c.id}`, c]));

  const owner = (tenantId: string) => {
    const t = tenantMap.get(tenantId);
    if (!t) fail('Empresa não encontrada.');
    return t;
  };
  const belongs = (tenantId: string, branchId: string) => {
    owner(tenantId);
    if (!branchMap.has(`${tenantId}:${branchId}`)) fail('Referência de filial inválida.');
  };

  if (new Set(state.tenants.map(row => row.slug)).size !== state.tenants.length) fail('Slug duplicado.');

  // Contadores agregados em O(n)
  const activeProductsPerTenant = new Map<string, number>();
  for (const p of state.products) if (p.active) activeProductsPerTenant.set(p.tenantId, (activeProductsPerTenant.get(p.tenantId) ?? 0) + 1);
  const activeBranchesPerTenant = new Map<string, number>();
  for (const b of state.branches) if (b.active) activeBranchesPerTenant.set(b.tenantId, (activeBranchesPerTenant.get(b.tenantId) ?? 0) + 1);
  const activeUsersPerTenant = new Map<string, number>();
  const activeWhatsappPerTenant = new Map<string, number>();
  for (const r of state.records) {
    if (r.kind === 'funcionarios' && r.status === 'Ativo') activeUsersPerTenant.set(r.tenantId, (activeUsersPerTenant.get(r.tenantId) ?? 0) + 1);
    if (r.kind === 'instancias' && r.status === 'Conectada') activeWhatsappPerTenant.set(r.tenantId, (activeWhatsappPerTenant.get(r.tenantId) ?? 0) + 1);
  }

  for (const row of state.tenants) {
    const plan = planMap.get(row.planId) ?? fail('Plano inválido.');
    if ((activeProductsPerTenant.get(row.id) ?? 0) > plan.products ||
        (activeBranchesPerTenant.get(row.id) ?? 0) > plan.branches ||
        (activeUsersPerTenant.get(row.id) ?? 0) > plan.users ||
        (activeWhatsappPerTenant.get(row.id) ?? 0) > plan.whatsapp) fail('Limite do plano excedido.');
  }

  for (const row of state.branches) owner(row.tenantId);

  const skus = new Set<string>();
  const barcodes = new Set<string>();
  for (const row of state.products) {
    owner(row.tenantId); text(row.name, 'Nome'); text(row.sku, 'SKU');
    integer(row.price, 'Preço'); integer(row.cost, 'Custo'); integer(row.min, 'Mínimo'); integer(row.max, 'Máximo');
    if (row.max && row.max < row.min) fail('Máximo inferior ao mínimo.');
    const sku = `${row.tenantId}:${normalized(row.sku)}`;
    const barcode = `${row.tenantId}:${row.barcode.trim()}`;
    if (skus.has(sku) || (row.barcode.trim() && barcodes.has(barcode))) fail('SKU ou código de barras duplicado.');
    skus.add(sku);
    if (row.barcode.trim()) barcodes.add(barcode);
  }

  // Pré-computa reservas esperadas por tenant:branch:product a partir de records em O(records * items)
  const expectedReserved = new Map<string, number>();
  for (const record of state.records) {
    if (record.kind === 'ordens-servico' && record.fields.stockState === 'reserved') {
      for (const item of record.items) {
        const key = `${record.tenantId}:${record.branchId}:${item.productId}`;
        expectedReserved.set(key, (expectedReserved.get(key) ?? 0) + item.quantity);
      }
    }
  }

  const stockKeys = new Set<string>();
  for (const row of state.balances) {
    belongs(row.tenantId, row.branchId);
    if (!productMap.has(`${row.tenantId}:${row.productId}`)) fail('Produto inválido ou inativo.');
    integer(row.quantity, 'Estoque'); integer(row.reserved, 'Reserva');
    if (row.reserved > row.quantity) fail('Reserva superior ao estoque.');
    const key = `${row.tenantId}:${row.branchId}:${row.productId}`;
    if (stockKeys.has(key)) fail('Saldo duplicado.');
    stockKeys.add(key);
    const reserved = expectedReserved.get(key) ?? 0;
    if (reserved !== row.reserved) fail('Reservas de OS inconsistentes.');
  }

  for (const row of state.customers) owner(row.tenantId);

  const cashKeys = new Set<string>();
  for (const row of state.cashRegisters) {
    belongs(row.tenantId, row.branchId);
    integer(row.opening, 'Fundo de caixa');
    if (new Set(row.movements.map(item => item.id)).size !== row.movements.length) fail('Movimento de caixa duplicado.');
    for (const item of row.movements) if (!Number.isSafeInteger(item.amount)) fail('Movimento de caixa inválido.');
    cashTotal(row);
    if (row.counted !== undefined) integer(row.counted, 'Contagem');
    if (!row.closedAt) {
      const key = `${row.tenantId}:${row.branchId}`;
      if (cashKeys.has(key)) fail('Caixas abertos duplicados.');
      cashKeys.add(key);
    }
  }

  const requests = new Set<string>();
  for (const row of state.sales) {
    belongs(row.tenantId, row.branchId);
    const key = `${row.tenantId}:${row.requestId}`;
    if (requests.has(key)) fail('Venda duplicada.');
    requests.add(key);
    integer(row.total, 'Total', 1); integer(row.discount, 'Desconto'); integer(row.surcharge, 'Acréscimo');
    integer(row.change ?? 0, 'Troco');
    for (const item of row.items) {
      if (!productMap.has(`${row.tenantId}:${item.productId}`)) fail('Produto inválido ou inativo.');
      integer(item.quantity, 'Quantidade', 1); integer(item.price, 'Preço'); integer(item.cost, 'Custo');
    }
    if (sum(row.items.map(item => integer(item.price * item.quantity, 'Subtotal'))) - row.discount + row.surcharge !== row.total || sum(row.payments.map(item => integer(item.amount, 'Pagamento', 1))) !== row.total) fail('Totais de venda inconsistentes.');
    const cash = cashMap.get(`${row.tenantId}:${row.cashId}`);
    if (!cash || cash.branchId !== row.branchId) fail('Caixa da venda inválido.');
    if (row.customerId && !customerMap.has(`${row.tenantId}:${row.customerId}`)) fail('Cliente inválido.');
  }

  const financialReferences = new Set<string>();
  for (const row of state.finances) {
    belongs(row.tenantId, row.branchId);
    integer(row.amount, 'Financeiro');
    if (!['Receita', 'Despesa'].includes(row.type)) fail('Tipo financeiro inválido.');
    if (row.reference) {
      const key = `${row.tenantId}:${row.type}:${row.reference}`;
      if (financialReferences.has(key)) fail('Lançamento financeiro vinculado duplicado.');
      financialReferences.add(key);
    }
    // Valida integridade dos settlements
    row.settlements ??= [];
    const settleReqs = new Set<string>();
    for (const s of row.settlements) {
      integer(s.amount, 'Valor de baixa', 1);
      if (settleReqs.has(s.requestId)) fail('Baixa duplicada no mesmo lançamento.');
      settleReqs.add(s.requestId);
    }
  }

  for (const row of state.invoices) {
    owner(row.tenantId);
    integer(row.amount, 'Fatura');
    if (row.originalAmount !== undefined) integer(row.originalAmount, 'Valor original');
    if (row.discount !== undefined) integer(row.discount, 'Desconto fatura');
  }

  const couponMap = new Map(state.coupons.map(c => [c.id, c]));
  for (const row of state.coupons) {
    text(row.code, 'Código cupom');
    integer(row.value, 'Valor cupom', 1);
  }

  for (const row of state.couponRedemptions) {
    owner(row.tenantId);
    if (!couponMap.has(row.couponId)) fail('Cupom da redemption inválido.');
    integer(row.discount, 'Desconto redemption', 0);
  }

  for (const row of state.movements) {
    belongs(row.tenantId, row.branchId);
    if (!productMap.has(`${row.tenantId}:${row.productId}`)) fail('Produto inválido ou inativo.');
    integer(row.quantity, 'Movimentação');
  }

  const recordMap = new Map(state.records.map(r => [`${r.tenantId}:${r.id}`, r]));
  for (const row of state.records) {
    if (row.tenantId === 'platform') {
      if (!row.kind.startsWith('admin-')) fail('Registro de plataforma inválido.');
      integer(row.amount, 'Registro');
      continue;
    }
    belongs(row.tenantId, row.branchId);
    integer(row.amount, 'Registro');
    if (row.customerId && !customerMap.has(`${row.tenantId}:${row.customerId}`)) fail('Cliente inválido.');
    for (const item of row.items) {
      if (!productMap.has(`${row.tenantId}:${item.productId}`)) fail('Produto inválido ou inativo.');
      integer(item.quantity, 'Quantidade', 1); integer(item.price, 'Preço'); integer(item.cost, 'Custo');
    }
    if (row.convertedId && !recordMap.has(`${row.tenantId}:${row.convertedId}`)) fail('Conversão inválida.');
    if (row.kind === 'ordens-servico' && row.fields.stockState === 'reserved') {
      if (!['Em execução', 'Em testes'].includes(row.status)) fail('Status incompatível com reserva.');
      for (const [productId, quantity] of quantities(row.items)) {
        const stock = state.balances.find(item => item.tenantId === row.tenantId && item.branchId === row.branchId && item.productId === productId);
        if (!stock || stock.reserved < quantity) fail('Saldo reservado não encontrado.');
      }
    }
  }

  for (const row of state.audit) {
    if (row.tenantId !== 'platform') owner(row.tenantId);
    if (!Number.isFinite(Date.parse(row.date))) fail('Data inválida.');
  }
}
