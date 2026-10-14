import type { DemoState, Tenant, Role, Sale, SaleInput, Product, OperationalRecord, StockBalance, FinancialEntry } from './types';

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
function finance(state: DemoState, entry: Omit<FinancialEntry, 'id' | 'date'>): void {
  integer(entry.amount, 'Valor financeiro');
  state.finances.push({ ...entry, id: id(state, 'fin'), date: now(state) });
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
      const expected = [...quantities(previous.items)].sort(([a], [b]) => a.localeCompare(b));
      const actual = [...quantities(input.items)].sort(([a], [b]) => a.localeCompare(b));
      if (previous.branchId !== input.branchId || previous.customerId !== input.customerId || previous.seller !== input.seller.trim() || previous.discount !== input.discount || previous.surcharge !== input.surcharge || JSON.stringify(expected) !== JSON.stringify(actual) || JSON.stringify(previous.payments) !== JSON.stringify(input.payments)) fail('Chave da venda já utilizada com outro conteúdo.');
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
    const payments = input.payments.map(payment => {
      if (!paymentMethods.has(normalized(payment.method))) fail('Forma de pagamento inválida.');
      return { method: payment.method, amount: integer(payment.amount, 'Pagamento', 1) };
    });
    if (sum(payments.map(row => row.amount)) !== total) fail('Pagamentos devem corresponder ao total exato.');
    const sale: Sale = { id: id(draft, 'sale'), tenantId: input.tenantId, branchId: input.branchId, customerId: input.customerId, seller: input.seller.trim(), items, discount, surcharge, total, payments, status: 'Concluída', date: now(draft), requestId: input.requestId, cashId: cash.id };
    for (const item of items) {
      balance(draft, input.tenantId, input.branchId, item.productId).quantity -= item.quantity;
      movement(draft, input.tenantId, input.branchId, item.productId, item.quantity, 'Saída', sale.id);
    }
    const amount = sum(payments.filter(row => cashMethods.has(normalized(row.method))).map(row => row.amount));
    if (amount) cash.movements.push({ id: id(draft, 'cash-mov'), amount, reason: `Venda ${sale.id}`, date: sale.date });
    cashTotal(cash);
    finance(draft, { tenantId: sale.tenantId, branchId: sale.branchId, type: 'Receita', category: 'Vendas', description: `Venda ${sale.id}`, amount: total, dueDate: sale.date.slice(0, 10), paid: true, reference: sale.id });
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
    const amount = sum(sale.payments.filter(row => cashMethods.has(normalized(row.method))).map(row => row.amount));
    const cash = draft.cashRegisters.find(row => row.id === sale.cashId && row.tenantId === tenantId) ?? fail('Caixa não encontrado.');
    if (amount && cash.closedAt) fail('Não é possível estornar dinheiro em caixa fechado.');
    if (cashTotal(cash) < amount) fail('Saldo insuficiente para estorno.');
    for (const item of sale.items) {
      const stock = balance(draft, tenantId, sale.branchId, item.productId);
      stock.quantity = integer(stock.quantity + item.quantity, 'Estoque');
      movement(draft, tenantId, sale.branchId, item.productId, item.quantity, 'Estorno', sale.id);
    }
    if (amount) cash.movements.push({ id: id(draft, 'cash-mov'), amount: -amount, reason: `Estorno ${sale.id}`, date: now(draft) });
    finance(draft, { tenantId, branchId: sale.branchId, type: 'Despesa', category: 'Estornos', description: `Estorno da venda ${sale.id}`, amount: sale.total, dueDate: now(draft).slice(0, 10), paid: true, reference: `cancel:${sale.id}` });
    sale.status = 'Cancelada';
    audit(draft, tenantId, `Venda cancelada ${sale.id}`);
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
export function closeCash(state: DemoState, tenantId: string, cashId: string, counted: number): void {
  atomic(state, draft => {
    tenant(draft, tenantId); integer(counted, 'Valor contado');
    const cash = draft.cashRegisters.find(row => row.tenantId === tenantId && row.id === cashId) ?? fail('Caixa não encontrado.');
    if (cash.closedAt) { if (cash.counted !== counted) fail('Caixa já encerrado com outro valor.'); return; }
    const expected = cashTotal(cash);
    cash.counted = counted; cash.closedAt = now(draft);
    audit(draft, tenantId, `Caixa ${cashId} fechado; esperado ${expected}; contado ${counted}; diferença ${counted - expected}`);
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
      branding: input.branding ? structuredClone(input.branding) : { primary: '#2dd4bf', secondary: '#6366f1', accent: '#f59e0b', sidebar: '#0f172a', theme: 'dark', logo: '', font: 'Inter', density: 'comfortable', footer: 'Gestão com PISTEC', widgets: ['revenue', 'sales', 'stock', 'services'] },
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
  for (const collection of [state.tenants, state.plans, state.branches, state.products, state.customers, state.movements, state.sales, state.cashRegisters, state.finances, state.records, state.invoices, state.audit]) {
    if (new Set(collection.map(row => row.id)).size !== collection.length) fail('IDs duplicados.');
  }
  const owner = (tenantId: string) => tenant(state, tenantId);
  const belongs = (tenantId: string, branchId: string) => {
    owner(tenantId);
    if (!state.branches.some(row => row.tenantId === tenantId && row.id === branchId)) fail('Referência de filial inválida.');
  };
  if (new Set(state.tenants.map(row => row.slug)).size !== state.tenants.length) fail('Slug duplicado.');
  for (const row of state.tenants) {
    const plan = state.plans.find(plan => plan.id === row.planId) ?? fail('Plano inválido.');
    if (state.products.filter(item => item.tenantId === row.id && item.active).length > plan.products || state.branches.filter(item => item.tenantId === row.id && item.active).length > plan.branches || state.records.filter(item => item.tenantId === row.id && item.kind === 'funcionarios' && item.status === 'Ativo').length > plan.users || state.records.filter(item => item.tenantId === row.id && item.kind === 'instancias' && item.status === 'Conectada').length > plan.whatsapp) fail('Limite do plano excedido.');
  }
  for (const row of state.branches) owner(row.tenantId);
  const skus = new Set<string>(); const barcodes = new Set<string>();
  for (const row of state.products) {
    owner(row.tenantId); text(row.name, 'Nome'); text(row.sku, 'SKU');
    integer(row.price, 'Preço'); integer(row.cost, 'Custo'); integer(row.min, 'Mínimo'); integer(row.max, 'Máximo');
    if (row.max && row.max < row.min) fail('Máximo inferior ao mínimo.');
    const sku = `${row.tenantId}:${normalized(row.sku)}`, barcode = `${row.tenantId}:${row.barcode.trim()}`;
    if (skus.has(sku) || (row.barcode.trim() && barcodes.has(barcode))) fail('SKU ou código de barras duplicado.');
    skus.add(sku); if (row.barcode.trim()) barcodes.add(barcode);
  }
  const stockKeys = new Set<string>();
  for (const row of state.balances) {
    belongs(row.tenantId, row.branchId); product(state, row.tenantId, row.productId, false);
    integer(row.quantity, 'Estoque'); integer(row.reserved, 'Reserva');
    if (row.reserved > row.quantity) fail('Reserva superior ao estoque.');
    const key = `${row.tenantId}:${row.branchId}:${row.productId}`;
    if (stockKeys.has(key)) fail('Saldo duplicado.'); stockKeys.add(key);
    const reserved = state.records.filter(record => record.tenantId === row.tenantId && record.branchId === row.branchId && record.kind === 'ordens-servico' && record.fields.stockState === 'reserved').reduce((total, record) => total + record.items.filter(item => item.productId === row.productId).reduce((n, item) => n + item.quantity, 0), 0);
    if (reserved !== row.reserved) fail('Reservas de OS inconsistentes.');
  }
  for (const row of state.customers) owner(row.tenantId);
  const cashKeys = new Set<string>();
  for (const row of state.cashRegisters) {
    belongs(row.tenantId, row.branchId); integer(row.opening, 'Fundo de caixa');
    if (new Set(row.movements.map(item => item.id)).size !== row.movements.length) fail('Movimento de caixa duplicado.');
    for (const item of row.movements) if (!Number.isSafeInteger(item.amount)) fail('Movimento de caixa inválido.');
    cashTotal(row); if (row.counted !== undefined) integer(row.counted, 'Contagem');
    if (!row.closedAt) { const key = `${row.tenantId}:${row.branchId}`; if (cashKeys.has(key)) fail('Caixas abertos duplicados.'); cashKeys.add(key); }
  }
  const requests = new Set<string>();
  for (const row of state.sales) {
    belongs(row.tenantId, row.branchId);
    const key = `${row.tenantId}:${row.requestId}`;
    if (requests.has(key)) fail('Venda duplicada.'); requests.add(key);
    integer(row.total, 'Total', 1); integer(row.discount, 'Desconto'); integer(row.surcharge, 'Acréscimo');
    for (const item of row.items) { product(state, row.tenantId, item.productId, false); integer(item.quantity, 'Quantidade', 1); integer(item.price, 'Preço'); integer(item.cost, 'Custo'); }
    if (sum(row.items.map(item => integer(item.price * item.quantity, 'Subtotal'))) - row.discount + row.surcharge !== row.total || sum(row.payments.map(item => integer(item.amount, 'Pagamento', 1))) !== row.total) fail('Totais de venda inconsistentes.');
    if (!state.cashRegisters.some(cash => cash.id === row.cashId && cash.tenantId === row.tenantId && cash.branchId === row.branchId)) fail('Caixa da venda inválido.');
    if (row.customerId && !state.customers.some(customer => customer.id === row.customerId && customer.tenantId === row.tenantId)) fail('Cliente inválido.');
  }
  const financialReferences = new Set<string>();
  for (const row of state.finances) {
    belongs(row.tenantId, row.branchId); integer(row.amount, 'Financeiro');
    if (!['Receita', 'Despesa'].includes(row.type)) fail('Tipo financeiro inválido.');
    if (row.reference) {
      const key = `${row.tenantId}:${row.type}:${row.reference}`;
      if (financialReferences.has(key)) fail('Lançamento financeiro vinculado duplicado.');
      financialReferences.add(key);
    }
  }
  for (const row of state.invoices) { owner(row.tenantId); integer(row.amount, 'Fatura'); }
  for (const row of state.movements) { belongs(row.tenantId, row.branchId); product(state, row.tenantId, row.productId, false); integer(row.quantity, 'Movimentação'); }
  for (const row of state.records) {
    // Registros da plataforma (leads, tickets, config) não pertencem a nenhuma loja.
    if (row.tenantId === 'platform') { if (!row.kind.startsWith('admin-')) fail('Registro de plataforma inválido.'); integer(row.amount, 'Registro'); continue; }
    belongs(row.tenantId, row.branchId); integer(row.amount, 'Registro');
    if (row.customerId && !state.customers.some(customer => customer.id === row.customerId && customer.tenantId === row.tenantId)) fail('Cliente inválido.');
    for (const item of row.items) { product(state, row.tenantId, item.productId, false); integer(item.quantity, 'Quantidade', 1); integer(item.price, 'Preço'); integer(item.cost, 'Custo'); }
    if (row.convertedId && !state.records.some(target => target.id === row.convertedId && target.tenantId === row.tenantId)) fail('Conversão inválida.');
    if (row.kind === 'ordens-servico' && row.fields.stockState === 'reserved') {
      if (!['Em execução', 'Em testes'].includes(row.status)) fail('Status incompatível com reserva.');
      for (const [productId, quantity] of quantities(row.items)) {
        const stock = state.balances.find(item => item.tenantId === row.tenantId && item.branchId === row.branchId && item.productId === productId);
        if (!stock || stock.reserved < quantity) fail('Saldo reservado não encontrado.');
      }
    }
  }
  for (const row of state.audit) { owner(row.tenantId); if (!Number.isFinite(Date.parse(row.date))) fail('Data inválida.'); }
}
