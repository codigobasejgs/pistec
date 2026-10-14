import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSeed, PLANS, INITIAL_SESSION } from './seed';
import { can, cancelSale, closeCash, completeSale, convertRecord, createTenant, moveStock, openCash, receivePurchase, saveProduct, transferStock, transitionRecord, validateState } from './domain';
import { createDemoStore, DemoDatabase } from './store';
import { MockAsaasAdapter, MockInfinitePayAdapter } from './services/billing';
import type { DemoState, OperationalRecord, SaleInput } from './types';

const reference = new Date('2026-10-14T12:00:00Z');
let state: DemoState;
const tenantId = INITIAL_SESSION.tenantId;
const branchId = INITIAL_SESSION.branchId;
const productId = 'product-premium-1';
const baseline = createSeed(reference);
beforeEach(() => { state = structuredClone(baseline); });
const stock = () => state.balances.find(row => row.tenantId === tenantId && row.branchId === branchId && row.productId === productId)!;
const input = (overrides: Partial<SaleInput> = {}): SaleInput => ({ tenantId, branchId, customerId: '', seller: 'Marina Costa', items: [{ productId, quantity: 1 }], discount: 0, surcharge: 0, payments: [{ method: 'Dinheiro', amount: 3490 }], requestId: 'test-sale', ...overrides });
const openRegister = () => state.cashRegisters.find(row => row.tenantId === tenantId && row.branchId === branchId && !row.closedAt)!;
function addRecord(kind: string, status: string): OperationalRecord {
  const row: OperationalRecord = { id: 'test-record', tenantId, branchId, kind, title: 'Teste', status, customerId: '', date: reference.toISOString(), amount: 3490, fields: {}, items: [{ productId, name: 'Filtro', quantity: 1, price: 3490, cost: 1850 }], history: [] };
  state.records.push(row); return row;
}
function unchanged(action: () => unknown): void {
  const before = structuredClone(state);
  expect(action).toThrow(); expect(state).toEqual(before);
}

describe('seed determinístico, integrado e preços', () => {
  it('reproduz a mesma data e mantém 30 dias completos', () => {
    expect(createSeed(reference)).toEqual(baseline);
    expect(state.tenants).toHaveLength(8); // 3 operacionais + 5 da carteira SaaS
    expect(new Set(state.tenants.map(t => t.status))).toEqual(new Set(['Ativa', 'Teste', 'Vencida', 'Suspensa', 'Cancelada']));
    expect(state.records.filter(r => r.tenantId === 'platform').every(r => r.kind.startsWith('admin-'))).toBe(true);
    expect(state.branches.filter(row => row.tenantId === tenantId)).toHaveLength(2);
    expect(new Set(state.sales.map(row => row.date.slice(0, 10))).size).toBe(30);
    expect(state.sales).toHaveLength(120);
    expect(() => validateState(state)).not.toThrow();
    expect(state.records.some(row => row.kind === 'whatsapp')).toBe(true);
    expect(state.records.some(row => row.kind === 'agenda')).toBe(true);
  });
  it('mantém preços contratuais em centavos', () => {
    expect(PLANS.slice(0, 3).map(row => [row.monthly, row.quarterly, row.annual])).toEqual([[12900, 34900, 123900], [24900, 66900, 238900], [44900, 120900, 430900]]);
    expect(PLANS[3].monthly).toBe(79900);
  });
  it('move todas as datas relativamente sem alterar identidades', () => {
    const next = createSeed(new Date('2026-10-15T12:00:00Z'));
    expect(next.products).toEqual(state.products);
    expect(Date.parse(next.sales[0].date) - Date.parse(state.sales[0].date)).toBe(86400000);
    expect(() => createSeed(new Date('invalid'))).toThrow();
  });
  it('reconcilia saldos físicos pelo histórico de movimentações', () => {
    for (const balance of state.balances) {
      const movements = state.movements.filter(row => row.tenantId === balance.tenantId && row.branchId === balance.branchId && row.productId === balance.productId);
      const quantity = movements.reduce((total, row) => total + (['Entrada', 'Recebimento', 'Estorno'].includes(row.type) ? row.quantity : ['Saída', 'Consumo OS'].includes(row.type) ? -row.quantity : 0), 0);
      expect(quantity).toBe(balance.quantity);
    }
    for (const sale of state.sales) expect(state.finances.filter(row => row.tenantId === sale.tenantId && row.reference === sale.id)).toHaveLength(1);
  });
});

describe('venda e cancelamento atômicos', () => {
  it('registra venda, estoque, financeiro e dinheiro exatamente uma vez', () => {
    const before = stock().quantity;
    const cashBefore = openRegister().movements.length;
    const sale = completeSale(state, input());
    expect(stock().quantity).toBe(before - 1);
    expect(openRegister().movements).toHaveLength(cashBefore + 1);
    expect(state.finances.find(row => row.reference === sale.id)?.amount).toBe(3490);
    const snapshot = structuredClone(state);
    expect(completeSale(state, input()).id).toBe(sale.id);
    expect(state).toEqual(snapshot);
    cancelSale(state, tenantId, sale.id);
    expect(stock().quantity).toBe(before);
    expect(state.finances.find(row => row.reference === `cancel:${sale.id}`)?.type).toBe('Despesa');
    const cancelled = structuredClone(state);
    cancelSale(state, tenantId, sale.id);
    expect(completeSale(state, input()).status).toBe('Cancelada');
    expect(state).toEqual(cancelled);
  });
  it('rejeita reutilização de chave com conteúdo diferente', () => {
    completeSale(state, input());
    unchanged(() => completeSale(state, input({ surcharge: 1, payments: [{ method: 'Dinheiro', amount: 3491 }] })));
    unchanged(() => completeSale(state, input({ branchId: 'branch-premium-norte' })));
  });
  it('não lança Pix ou cartão no caixa físico', () => {
    const before = structuredClone(openRegister());
    const sale = completeSale(state, input({ payments: [{ method: 'Pix', amount: 1000 }, { method: 'Crédito', amount: 2490 }] }));
    expect(openRegister()).toEqual(before);
    cancelSale(state, tenantId, sale.id);
    expect(openRegister()).toEqual(before);
  });
  it('agrega produtos repetidos sem permitir exceder estoque', () => {
    const quantity = stock().quantity;
    unchanged(() => completeSale(state, input({ items: [{ productId, quantity }, { productId, quantity: 1 }], payments: [{ method: 'Pix', amount: (quantity + 1) * 3490 }] })));
    const sale = completeSale(state, input({ items: [{ productId, quantity: 1 }, { productId, quantity: 1 }], payments: [{ method: 'Pix', amount: 6980 }] }));
    expect(sale.items).toHaveLength(1); expect(sale.items[0].quantity).toBe(2);
  });
  it.each([-1, 0, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])('rejeita quantidade %s sem efeitos parciais', quantity => {
    unchanged(() => completeSale(state, input({ items: [{ productId, quantity }] })));
  });
  it.each([-1, 0.1, NaN, Infinity, 4000])('rejeita desconto %s', discount => { unchanged(() => completeSale(state, input({ discount }))); });
  it('valida pagamento exato, método e caixa aberto', () => {
    unchanged(() => completeSale(state, input({ payments: [{ method: 'Pix', amount: 3491 }] })));
    unchanged(() => completeSale(state, input({ payments: [{ method: 'bitcoin', amount: 3490 }] })));
    closeCash(state, tenantId, openRegister().id, 20000);
    unchanged(() => completeSale(state, input()));
  });
  it('isola empresa, filial, cliente e produto', () => {
    unchanged(() => completeSale(state, input({ branchId: 'branch-oficina-matriz' })));
    unchanged(() => completeSale(state, input({ customerId: 'customer-oficina-1' })));
    unchanged(() => completeSale(state, input({ items: [{ productId: 'product-oficina-1', quantity: 1 }] })));
    const sale = completeSale(state, input());
    unchanged(() => cancelSale(state, 'tenant-oficina', sale.id));
  });
  it('não cancela dinheiro após fechamento do caixa', () => {
    const sale = completeSale(state, input());
    closeCash(state, tenantId, sale.cashId, 23490);
    unchanged(() => cancelSale(state, tenantId, sale.id));
  });
  it('não permite estorno que deixe saldo negativo', () => {
    const sale = completeSale(state, input());
    openRegister().movements.push({ id: 'withdrawal', amount: -(openRegister().opening + openRegister().movements.reduce((total, row) => total + row.amount, 0)), reason: 'Retirada', date: reference.toISOString() });
    unchanged(() => cancelSale(state, tenantId, sale.id));
  });
  it('não vende reserva de OS', () => {
    const row = addRecord('ordens-servico', 'Aberta'); row.items[0].quantity = stock().quantity;
    transitionRecord(state, tenantId, row.id, 'Em execução');
    unchanged(() => completeSale(state, input()));
  });
});

describe('estoque e compras', () => {
  it('movimenta com chave idempotente e ajustes absolutos', () => {
    const before = stock().quantity;
    moveStock(state, tenantId, branchId, productId, 3, 'Entrada', 'manual-1');
    moveStock(state, tenantId, branchId, productId, 3, 'Entrada', 'manual-1');
    expect(stock().quantity).toBe(before + 3);
    unchanged(() => moveStock(state, tenantId, branchId, productId, 4, 'Entrada', 'manual-1'));
    moveStock(state, tenantId, branchId, productId, 0, 'Ajuste', 'adjust-1');
    expect(stock().quantity).toBe(0);
    unchanged(() => moveStock(state, tenantId, branchId, productId, 1, 'Saída', 'manual-2'));
  });
  it('transfere atomicamente com movimentos pareados', () => {
    const before = stock().quantity;
    transferStock(state, tenantId, branchId, 'branch-premium-norte', productId, 2);
    expect(stock().quantity).toBe(before - 2);
    const pair = state.movements.slice(-2);
    expect(pair[0].reference).toBe(pair[1].reference);
    unchanged(() => transferStock(state, tenantId, branchId, 'branch-oficina-matriz', productId, 2));
    unchanged(() => transferStock(state, tenantId, branchId, branchId, productId, 2));
    unchanged(() => transferStock(state, tenantId, branchId, 'branch-premium-norte', productId, 999999));
  });
  it('recebe compra uma vez e gera conta a pagar', () => {
    const row = addRecord('compras', 'Pendente'); row.amount = 1850;
    const before = stock().quantity;
    receivePurchase(state, tenantId, row.id);
    expect(stock().quantity).toBe(before + 1);
    const snapshot = structuredClone(state);
    receivePurchase(state, tenantId, row.id);
    expect(state).toEqual(snapshot);
    expect(state.finances.find(entry => entry.reference === row.id)).toMatchObject({ type: 'Despesa', amount: 1850, paid: false });
  });
  it('cancela compra pendente sem recebimento posterior', () => {
    const row = addRecord('compras', 'Pendente');
    transitionRecord(state, tenantId, row.id, 'Cancelada');
    unchanged(() => receivePurchase(state, tenantId, row.id));
  });
  it('compra inválida não modifica estoque mesmo com item inicial válido', () => {
    const row = addRecord('compras', 'Pendente'); row.amount = 3700;
    row.items.push({ ...row.items[0], productId: 'missing' });
    unchanged(() => receivePurchase(state, tenantId, row.id));
  });
  it('protege estoque reservado contra ajustes e transferências', () => {
    const row = addRecord('ordens-servico', 'Aberta'); row.items[0].quantity = stock().quantity;
    transitionRecord(state, tenantId, row.id, 'Em execução');
    unchanged(() => moveStock(state, tenantId, branchId, productId, 0, 'Ajuste', 'adjust'));
    unchanged(() => transferStock(state, tenantId, branchId, 'branch-premium-norte', productId, 1));
  });
});

describe('OS e conversão', () => {
  it('reserva, consome, entrega sem duplicação', () => {
    const row = addRecord('ordens-servico', 'Aberta');
    const before = stock().quantity, reserved = stock().reserved;
    transitionRecord(state, tenantId, row.id, 'Em execução');
    expect(stock()).toMatchObject({ quantity: before, reserved: reserved + 1 });
    transitionRecord(state, tenantId, row.id, 'Em execução');
    expect(stock().reserved).toBe(reserved + 1);
    transitionRecord(state, tenantId, row.id, 'Em testes');
    transitionRecord(state, tenantId, row.id, 'Em execução');
    expect(stock().reserved).toBe(reserved + 1);
    transitionRecord(state, tenantId, row.id, 'Pronta');
    transitionRecord(state, tenantId, row.id, 'Pronta');
    expect(stock()).toMatchObject({ quantity: before - 1, reserved });
    transitionRecord(state, tenantId, row.id, 'Entregue');
    expect(stock().quantity).toBe(before - 1);
    expect(state.finances.filter(entry => entry.reference === row.id)).toHaveLength(1);
    unchanged(() => transitionRecord(state, tenantId, row.id, 'Cancelada'));
  });
  it.each(['reserved', 'consumed'])('reverte estado %s uma vez', target => {
    const row = addRecord('ordens-servico', 'Aberta');
    const before = structuredClone(stock());
    transitionRecord(state, tenantId, row.id, 'Em execução');
    if (target === 'consumed') transitionRecord(state, tenantId, row.id, 'Pronta');
    transitionRecord(state, tenantId, row.id, 'Cancelada');
    transitionRecord(state, tenantId, row.id, 'Cancelada');
    expect(stock()).toEqual(before);
    expect(state.finances.filter(entry => entry.reference === row.id)).toHaveLength(0);
  });
  it('bloqueia cancelamento de OS já recebida', () => {
    const row = addRecord('ordens-servico', 'Aberta');
    transitionRecord(state, tenantId, row.id, 'Em execução'); transitionRecord(state, tenantId, row.id, 'Pronta');
    state.finances.find(entry => entry.reference === row.id)!.paid = true;
    unchanged(() => transitionRecord(state, tenantId, row.id, 'Cancelada'));
  });
  it('não reserva parcialmente com item indisponível', () => {
    const row = addRecord('ordens-servico', 'Aberta'); row.items.push({ ...row.items[0], productId: 'missing' });
    unchanged(() => transitionRecord(state, tenantId, row.id, 'Em execução'));
  });
  it('bloqueia pular reserva, retroceder conclusão e conversão inválida', () => {
    const row = addRecord('ordens-servico', 'Aberta');
    unchanged(() => transitionRecord(state, tenantId, row.id, 'Pronta'));
    unchanged(() => convertRecord(state, tenantId, row.id, 'compras'));
  });
  it.each(['crm', 'agenda'])('converte %s em orçamento exatamente uma vez', kind => {
    const row = addRecord(kind, kind === 'crm' ? 'Proposta' : 'Confirmado');
    convertRecord(state, tenantId, row.id, 'orcamentos');
    const snapshot = structuredClone(state);
    convertRecord(state, tenantId, row.id, 'orcamentos');
    expect(state).toEqual(snapshot);
    const source = state.records.find(item => item.id === row.id)!;
    expect(state.records.find(item => item.id === source.convertedId)).toMatchObject({ kind: 'orcamentos', status: 'Aberto' });
  });
  it('converte orçamento aprovado uma vez sem consumir estoque', () => {
    const row = addRecord('orcamentos', 'Rascunho');
    unchanged(() => convertRecord(state, tenantId, row.id, 'ordens-servico'));
    transitionRecord(state, tenantId, row.id, 'Aprovado');
    const before = structuredClone(stock());
    convertRecord(state, tenantId, row.id, 'ordens-servico');
    const snapshot = structuredClone(state);
    convertRecord(state, tenantId, row.id, 'ordens-servico');
    expect(state).toEqual(snapshot); expect(stock()).toEqual(before);
    expect(state.records.find(entry => entry.id === state.records.find(entry => entry.id === row.id)!.convertedId)).toMatchObject({ kind: 'ordens-servico', status: 'Aberta' });
    unchanged(() => convertRecord(state, tenantId, row.id, 'pedidos'));
  });
});

describe('limites, caixa, permissões e validação', () => {
  it('abre e fecha caixa idempotentemente, diferença auditada', () => {
    const existing = openRegister();
    const count = state.cashRegisters.length;
    openCash(state, tenantId, branchId, existing.opening);
    expect(state.cashRegisters).toHaveLength(count);
    unchanged(() => openCash(state, tenantId, branchId, existing.opening + 1));
    closeCash(state, tenantId, existing.id, 100);
    const snapshot = structuredClone(state);
    closeCash(state, tenantId, existing.id, 100); expect(state).toEqual(snapshot);
    unchanged(() => closeCash(state, tenantId, existing.id, 101));
    expect(state.audit.at(-1)?.action).toContain('diferença');
    openCash(state, tenantId, branchId, 0);
    expect(state.cashRegisters).toHaveLength(count + 1);
  });
  it('salva produto com SKU/barcode únicos por empresa e limite do plano', () => {
    const item = structuredClone(state.products.find(row => row.id === productId)!);
    unchanged(() => saveProduct(state, { ...item, id: 'new-product' }));
    unchanged(() => saveProduct(state, { ...item, id: 'new-product', sku: 'UNIQUE', price: 0.5 }));
    const plan = state.plans.find(row => row.id === 'premium')!;
    plan.products = state.products.filter(row => row.tenantId === tenantId).length;
    unchanged(() => saveProduct(state, { ...item, id: 'new-product', sku: 'UNIQUE', barcode: '' }));
    saveProduct(state, { ...item, name: 'Novo nome' });
    expect(state.products.find(row => row.id === productId)?.name).toBe('Novo nome');
  });
  it('não desativa produto reservado', () => {
    const row = addRecord('ordens-servico', 'Aberta'); transitionRecord(state, tenantId, row.id, 'Em execução');
    unchanged(() => saveProduct(state, { ...state.products.find(row => row.id === productId)!, active: false }));
  });
  it('cria tenant isolado com trial e filial', () => {
    const created = createTenant(state, { name: 'Oficina São José', email: 'teste@example.com' });
    expect(created).toMatchObject({ slug: 'oficina-sao-jose', status: 'Teste', planId: 'essencial' });
    expect(state.branches.filter(row => row.tenantId === created.id)).toHaveLength(1);
    unchanged(() => createTenant(state, { name: 'Oficina São José', email: 'teste@example.com' }));
    unchanged(() => createTenant(state, { name: 'Outro', email: 'bad' }));
  });
  it('nega ações desconhecidas e privilégios cruzados', () => {
    expect(can('Proprietário', 'configuracoes', 'configurar')).toBe(true);
    expect(can('Mecânico', 'ordens-servico', 'editar')).toBe(true);
    expect(can('Mecânico', 'financeiro', 'visualizar')).toBe(false);
    expect(can('Vendedor', 'produtos', 'editar')).toBe(false);
    expect(can('Vendedor', 'produtos')).toBe(true);
    expect(can('Vendedor', 'vendas', 'cancelar')).toBe(false);
    expect(can('Proprietário', 'produtos', 'invalid')).toBe(false);
  });
  it('rejeita snapshots inválidos ou limites ultrapassados', () => {
    stock().quantity = -1; expect(() => validateState(state)).toThrow();
    state = structuredClone(baseline); state.balances.push({ ...stock() }); expect(() => validateState(state)).toThrow();
    state = structuredClone(baseline); state.plans.find(row => row.id === 'premium')!.branches = 1; expect(() => validateState(state)).toThrow();
    state = structuredClone(baseline); state.sales.push({ ...state.sales[0], id: 'dup' }); expect(() => validateState(state)).toThrow();
  });
});

const databases: DemoDatabase[] = [];
let databaseCounter = 0;
function database(name?: string) { const db = new DemoDatabase(name ?? `pistec-test-${++databaseCounter}`); databases.push(db); return db; }
afterEach(async () => { for (const db of databases.splice(0)) { db.close(); await db.delete(); } });

describe('store IndexedDB: persistir antes de publicar', () => {
  it('persiste snapshot, recarrega e reseta', async () => {
    const db = database();
    const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 });
    expect(store.getSnapshot().initialized).toBe(false);
    await store.ready;
    expect(store.getSnapshot().initialized).toBe(true);
    await store.mutate(draft => { draft.tenants[0].notes = 'persistido'; });
    expect((await db.snapshots.get('demo'))!.state.tenants[0].notes).toBe('persistido');
    const reload = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 }); await reload.ready;
    expect(reload.getSnapshot().state.tenants[0].notes).toBe('persistido');
    await reload.reset(); expect(reload.getSnapshot().state).toEqual(baseline);
  });
  it('serializa concorrência sem perder atualizações', async () => {
    const db = database(); const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 }); await store.ready;
    const initial = store.getSnapshot().state.tenants[0].notes;
    await Promise.all([store.mutate(draft => { draft.tenants[0].notes += 'A'; }), store.mutate(draft => { draft.tenants[0].notes += 'B'; })]);
    expect(store.getSnapshot().state.tenants[0].notes).toBe(`${initial}AB`);
    expect(store.getSnapshot().loading).toBe(false);
  });
  it('serializa duas instâncias pela transação IndexedDB', async () => {
    const db = database(); const seed = () => structuredClone(baseline);
    const one = createDemoStore({ db, seed, latency: 0 }), two = createDemoStore({ db, seed, latency: 0 }); await Promise.all([one.ready, two.ready]);
    await Promise.all([one.mutate(draft => { draft.tenants[0].notes += 'A'; }), two.mutate(draft => { draft.tenants[0].notes += 'B'; })]);
    expect((await db.snapshots.get('demo'))!.state.tenants[0].notes).toBe(`${baseline.tenants[0].notes}AB`);
  });
  it('falha simulada e exceção não publicam nem persistem', async () => {
    const db = database(); const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 }); await store.ready;
    const before = store.getSnapshot().state;
    store.setFailNext(true);
    await expect(store.mutate(draft => { draft.tenants[0].notes = 'não'; })).rejects.toThrow('simulada');
    expect(store.getSnapshot().state).toBe(before); expect(store.getSnapshot().failNext).toBe(false);
    await expect(store.mutate(draft => { draft.tenants[0].notes = 'não'; throw new Error('abort'); })).rejects.toThrow('abort');
    expect((await db.snapshots.get('demo'))!.state).toEqual(before);
    await store.mutate(draft => { draft.tenants[0].notes = 'sim'; });
    expect(store.getSnapshot().error).toBe('');
  });
  it('falha de persistência não publica alteração', async () => {
    const db = database(); const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 }); await store.ready;
    const before = store.getSnapshot().state;
    const rejectWrite = () => { throw new Error('disk full'); };
    db.snapshots.hook('updating', rejectWrite);
    await expect(store.mutate(draft => { draft.tenants[0].notes = 'não'; })).rejects.toThrow('disk full');
    expect(store.getSnapshot().state).toBe(before);
    expect((await db.snapshots.get('demo'))!.state).toEqual(before);
    db.snapshots.hook('updating').unsubscribe(rejectWrite);
  });
  it('não expõe estado alterado antes do commit', async () => {
    const db = database(); const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 10 }); await store.ready;
    const before = store.getSnapshot().state;
    const result = store.mutate(draft => { draft.tenants[0].notes = 'depois'; });
    expect(store.getSnapshot().state).toBe(before); expect(store.getSnapshot().loading).toBe(true);
    await result; expect(store.getSnapshot().state.tenants[0].notes).toBe('depois');
    expect(Object.isFrozen(store.getSnapshot().state.tenants[0])).toBe(true);
  });
  it('nega callbacks assíncronos e alterações inválidas', async () => {
    const db = database(); const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 }); await store.ready;
    await expect(store.mutate(async draft => { draft.tenants[0].notes = 'não'; })).rejects.toThrow('síncrono');
    await expect(store.mutate(draft => { draft.finances[0].amount = -1; })).rejects.toThrow();
    expect((await db.snapshots.get('demo'))!.state).toEqual(baseline);
  });
  it('preserva snapshot incompatível em vez de sobrescrever silenciosamente', async () => {
    const db = database(); await db.snapshots.put({ id: 'demo', state: { ...structuredClone(baseline), version: 999 } });
    const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 });
    await expect(store.ready).rejects.toThrow('incompatível');
    expect((await db.snapshots.get('demo'))!.state.version).toBe(999);
    await store.reset(); expect(store.getSnapshot().state.version).toBe(1);
  });
});

describe.each([MockAsaasAdapter, MockInfinitePayAdapter])('billing mock %s', Adapter => {
  const request = { tenantId, amount: 44900, reference: 'subscription-1', dueDate: '2026-10-21' };
  it('retorno não confirma pagamento; simulação explícita é idempotente', async () => {
    const adapter = new Adapter({ latency: 0 });
    const checkout = await adapter.createCheckout(request);
    expect(checkout.url).toContain('/checkout/retorno?'); expect(checkout.simulated).toBe(true);
    expect((await adapter.handleCheckoutReturn(request.reference)).status).toBe('Pendente');
    expect(await adapter.createCheckout(request)).toEqual(checkout);
    expect((await adapter.simulateWebhook(request.reference, 'Paga', 'event-1')).status).toBe('Paga');
    expect((await adapter.simulateWebhook(request.reference, 'Paga', 'event-1')).status).toBe('Paga');
    await expect(adapter.simulateWebhook(request.reference, 'Cancelada', 'event-1')).rejects.toThrow();
    await expect(adapter.simulateWebhook(request.reference, 'Cancelada', 'event-2')).rejects.toThrow();
  });
  it('rejeita centavos inválidos, referência conflitante e URLs externas', async () => {
    const adapter = new Adapter({ latency: 0 });
    await expect(adapter.createCheckout({ ...request, amount: -1 })).rejects.toThrow();
    await expect(adapter.createCheckout({ ...request, amount: 0.5 })).rejects.toThrow();
    await expect(adapter.createCheckout({ ...request, dueDate: '2026-02-30' })).rejects.toThrow();
    await expect(adapter.createCheckout({ ...request, returnUrl: '//evil.example' })).rejects.toThrow();
    await adapter.createCheckout(request);
    await expect(adapter.createCheckout({ ...request, tenantId: 'another' })).rejects.toThrow();
  });
  it('falha simulada não cria fatura e não vaza referências mutáveis', async () => {
    const adapter = new Adapter({ latency: 0, failNext: true });
    await expect(adapter.createCheckout(request)).rejects.toThrow('simulada');
    await expect(adapter.getInvoice(request.reference)).rejects.toThrow('não encontrada');
    const checkout = await adapter.createCheckout(request); checkout.invoice.status = 'Paga';
    expect((await adapter.getInvoice(request.reference)).status).toBe('Pendente');
  });
});
