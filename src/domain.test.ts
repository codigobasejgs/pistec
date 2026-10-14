import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, String(v)); },
    removeItem: (k: string) => { store.delete(k); },
    clear: () => { store.clear(); },
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size; },
  } as Storage;
}

import { createSeed, PLANS, INITIAL_SESSION } from './seed';
import { can, cancelSale, closeCash, completeSale, convertRecord, createTenant, moveStock, openCash, receivePurchase, saveProduct, transferStock, transitionRecord, validateState, settleEntry, reverseSettlement, cancelEntry, entryPaid, entryBalance, entryStatus, importProducts, saveCoupon, couponQuote, createSubscriptionInvoice } from './domain';
import { createDemoStore, DemoDatabase, persistSession, loadPersistedSession, isValidSession } from './store';
import { migrate } from './migrations';
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
    closeCash(state, tenantId, existing.id, 100, 'Ajuste de fechamento');
    const snapshot = structuredClone(state);
    closeCash(state, tenantId, existing.id, 100, 'Ajuste de fechamento'); expect(state).toEqual(snapshot);
    unchanged(() => closeCash(state, tenantId, existing.id, 101, 'Outro valor'));
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
    await store.reset(); expect(store.getSnapshot().state.version).toBe(2);
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

describe('completeSale com troco e estorno líquido', () => {
  it('venda com troco: valor entregue em dinheiro, grava aplicado + tendered + change, caixa recebe líquido', () => {
    const cashBefore = openRegister().movements.length;
    const cashBalanceBefore = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    // Venda de 3490 (preço do produto 1). Cliente entrega 5000 em dinheiro (troco 1510)
    const sale = completeSale(state, input({ payments: [{ method: 'Dinheiro', amount: 5000 }] }));
    expect(sale.total).toBe(3490);
    expect(sale.change).toBe(1510);
    expect(sale.payments).toHaveLength(1);
    expect(sale.payments[0]).toEqual({ method: 'Dinheiro', amount: 3490, tendered: 5000 });
    // Caixa recebe apenas o dinheiro líquido (3490), nunca o bruto entregue (5000)
    expect(openRegister().movements).toHaveLength(cashBefore + 1);
    const lastMov = openRegister().movements.at(-1)!;
    expect(lastMov.amount).toBe(3490);
    const cashBalanceAfter = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    expect(cashBalanceAfter).toBe(cashBalanceBefore + 3490);
    // Financeiro registra receita = total da venda (3490), com baixa integral automática
    const fin = state.finances.find(f => f.reference === sale.id)!;
    expect(fin.amount).toBe(3490);
    expect(fin.paid).toBe(true);
    expect(fin.settlements).toHaveLength(1);
    expect(fin.settlements[0].amount).toBe(3490);
  });

  it('pagamento misto com troco no dinheiro', () => {
    // Venda de 3490: 2000 no Pix + 2000 em Dinheiro (troco de 510)
    const cashBalanceBefore = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    const sale = completeSale(state, input({
      payments: [
        { method: 'Pix', amount: 2000 },
        { method: 'Dinheiro', amount: 2000 },
      ],
    }));
    expect(sale.total).toBe(3490);
    expect(sale.change).toBe(510);
    expect(sale.payments.find(p => p.method === 'Pix')).toEqual({ method: 'Pix', amount: 2000 });
    expect(sale.payments.find(p => p.method === 'Dinheiro')).toEqual({ method: 'Dinheiro', amount: 1490, tendered: 2000 });
    const cashBalanceAfter = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    expect(cashBalanceAfter).toBe(cashBalanceBefore + 1490);
  });

  it('rejeita não-dinheiro acima do total', () => {
    // Total 3490, cartão com 4000
    unchanged(() => completeSale(state, input({ payments: [{ method: 'Crédito', amount: 4000 }] })));
  });

  it('rejeita pagamento insuficiente', () => {
    // Total 3490, entrega 3000 em dinheiro
    unchanged(() => completeSale(state, input({ payments: [{ method: 'Dinheiro', amount: 3000 }] })));
  });

  it('precisão com decimais de 1 centavo (R$ 0,01)', () => {
    // Cria produto de 1 centavo
    state.products.push({
      id: 'prod-centavo', tenantId, name: 'Arruela 1 centavo', sku: 'ARR-001', barcode: 'DEMO-CENTAVO',
      category: 'Fixação', brand: 'Genérica', cost: 1, price: 1, min: 1, max: 100, location: '', active: true, details: {},
    });
    state.balances.push({ tenantId, branchId, productId: 'prod-centavo', quantity: 10, reserved: 0 });
    // Total 1 centavo, paga com 100 centavos (R$ 1,00) em dinheiro -> troco 99
    const sale = completeSale(state, input({ items: [{ productId: 'prod-centavo', quantity: 1 }], payments: [{ method: 'Dinheiro', amount: 100 }], requestId: 'sale-centavo' }));
    expect(sale.total).toBe(1);
    expect(sale.change).toBe(99);
    expect(sale.payments[0]).toEqual({ method: 'Dinheiro', amount: 1, tendered: 100 });
  });

  it('cancelSale estorna apenas o dinheiro líquido (retido), preserva idempotência', () => {
    const cashBalanceBefore = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    const sale = completeSale(state, input({ payments: [{ method: 'Dinheiro', amount: 5000 }] }));
    expect(sale.change).toBe(1510);
    // Caixa subiu 3490
    cancelSale(state, tenantId, sale.id);
    const cashBalanceAfter = openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0);
    // Caixa voltou ao valor inicial (estornou exatamente 3490 líquido, não 5000)
    expect(cashBalanceAfter).toBe(cashBalanceBefore);
    // Cancelamento repetido é no-op
    cancelSale(state, tenantId, sale.id);
    expect(openRegister().opening + openRegister().movements.reduce((t, m) => t + m.amount, 0)).toBe(cashBalanceBefore);
  });
});

describe('baixas parciais (settlements), estornos e cancelamento', () => {
  const entryDate = '2026-10-14';
  let testEntryId: string;

  beforeEach(() => {
    // Cria uma conta a receber de R$ 1.000,00 (100000 centavos)
    testEntryId = 'fin-test-receivable';
    state.finances.push({
      id: testEntryId, tenantId, branchId, type: 'Receita', category: 'Serviços',
      description: 'Consultoria de frotas', amount: 100000, dueDate: '2026-10-20',
      paid: false, settlements: [], reference: 'manual:test:1', date: entryDate,
    });
  });

  it('baixa parcial: amount original imutável, paid false, saldo calculado', () => {
    let entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entryStatus(entry, '2026-10-14')).toBe('Em aberto');
    expect(entryPaid(entry)).toBe(0);
    expect(entryBalance(entry)).toBe(100000);

    const s1 = settleEntry(state, tenantId, testEntryId, {
      amount: 40000, method: 'Pix', date: '2026-10-14', user: 'Carlos', note: 'Primeira parcela 40%', requestId: 'req-s1',
    });
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(s1.amount).toBe(40000);
    expect(entry.amount).toBe(100000); // Imutável!
    expect(entry.paid).toBe(false);
    expect(entryPaid(entry)).toBe(40000);
    expect(entryBalance(entry)).toBe(60000);
    expect(entryStatus(entry, '2026-10-14')).toBe('Parcialmente pago');
  });

  it('baixa integral em parcelas até quitação', () => {
    let entry = state.finances.find(f => f.id === testEntryId)!;
    settleEntry(state, tenantId, testEntryId, { amount: 60000, method: 'Pix', date: '2026-10-14', requestId: 'req-p1' });
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entry.paid).toBe(false);
    expect(entryStatus(entry, '2026-10-14')).toBe('Parcialmente pago');

    settleEntry(state, tenantId, testEntryId, { amount: 40000, method: 'Transferência', date: '2026-10-14', requestId: 'req-p2' });
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entry.paid).toBe(true);
    expect(entryPaid(entry)).toBe(100000);
    expect(entryBalance(entry)).toBe(0);
    expect(entryStatus(entry, '2026-10-14')).toBe('Quitado');
  });

  it('idempotência de baixa por requestId (mesmo conteúdo no-op; diferente erro)', () => {
    const s1 = settleEntry(state, tenantId, testEntryId, { amount: 30000, method: 'Pix', date: '2026-10-14', requestId: 'req-idem' });
    const s2 = settleEntry(state, tenantId, testEntryId, { amount: 30000, method: 'Pix', date: '2026-10-14', requestId: 'req-idem' });
    expect(s1.id).toBe(s2.id);
    expect(state.finances.find(f => f.id === testEntryId)!.settlements).toHaveLength(1);

    unchanged(() => settleEntry(state, tenantId, testEntryId, { amount: 35000, method: 'Pix', date: '2026-10-14', requestId: 'req-idem' }));
  });

  it('rejeita baixa com valor superior ao saldo', () => {
    settleEntry(state, tenantId, testEntryId, { amount: 80000, method: 'Pix', date: '2026-10-14', requestId: 'req-over-1' });
    unchanged(() => settleEntry(state, tenantId, testEntryId, { amount: 30000, method: 'Pix', date: '2026-10-14', requestId: 'req-over-2' }));
  });

  it('estorno de baixa (reverseSettlement) restaura saldo e status', () => {
    let entry = state.finances.find(f => f.id === testEntryId)!;
    const s = settleEntry(state, tenantId, testEntryId, { amount: 100000, method: 'Pix', date: '2026-10-14', requestId: 'req-full' });
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entry.paid).toBe(true);
    expect(entryStatus(entry, '2026-10-14')).toBe('Quitado');

    reverseSettlement(state, tenantId, testEntryId, s.id, 'Carlos', 'Comprovante não compensou');
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entry.paid).toBe(false);
    expect(entryPaid(entry)).toBe(0);
    expect(entryBalance(entry)).toBe(100000);
    expect(entryStatus(entry, '2026-10-14')).toBe('Em aberto');
  });

  it('cancelamento de entrada exige estorno prévio das baixas ativas', () => {
    let entry = state.finances.find(f => f.id === testEntryId)!;
    const s = settleEntry(state, tenantId, testEntryId, { amount: 30000, method: 'Pix', date: '2026-10-14', requestId: 'req-part' });
    // Tenta cancelar com baixa ativa -> erro
    unchanged(() => cancelEntry(state, tenantId, testEntryId, 'Carlos', 'Cancelando'));
    // Estorna a baixa ativa
    reverseSettlement(state, tenantId, testEntryId, s.id, 'Carlos', 'Estorno para cancelamento');
    // Agora cancela com sucesso
    cancelEntry(state, tenantId, testEntryId, 'Carlos', 'Cancelamento definitivo');
    entry = state.finances.find(f => f.id === testEntryId)!;
    expect(entry.cancelled).toBe(true);
    expect(entryStatus(entry, '2026-10-14')).toBe('Cancelado');
  });

  it('status vencido quando dueDate < today', () => {
    const entry = state.finances.find(f => f.id === testEntryId)!;
    entry.dueDate = '2026-10-10';
    expect(entryStatus(entry, '2026-10-14')).toBe('Vencido');
  });
});

describe('closeCash com auditoria e motivo obrigatório', () => {
  it('diferença zero não exige motivo', () => {
    const cash = openRegister();
    const expected = cash.opening + cash.movements.reduce((t, m) => t + m.amount, 0);
    closeCash(state, tenantId, cash.id, expected);
    const updated = state.cashRegisters.find(c => c.id === cash.id)!;
    expect(updated.closedAt).toBeTruthy();
    expect(updated.difference).toBe(0);
    expect(updated.closingReason).toBeUndefined();
  });

  it('diferença diferente de zero EXIGE motivo e rejeita sem motivo', () => {
    const cash = openRegister();
    const expected = cash.opening + cash.movements.reduce((t, m) => t + m.amount, 0);
    unchanged(() => closeCash(state, tenantId, cash.id, expected - 500));
    closeCash(state, tenantId, cash.id, expected - 500, 'Falta de troco comprovada', 'Carlos');
    const updated = state.cashRegisters.find(c => c.id === cash.id)!;
    expect(updated.difference).toBe(-500);
    expect(updated.closingReason).toBe('Falta de troco comprovada');
    expect(updated.closedBy).toBe('Carlos');
  });

  it('duplo fechamento com mesmo valor é no-op, com valor diferente é erro', () => {
    const cash = openRegister();
    const expected = cash.opening + cash.movements.reduce((t, m) => t + m.amount, 0);
    closeCash(state, tenantId, cash.id, expected);
    closeCash(state, tenantId, cash.id, expected);
    unchanged(() => closeCash(state, tenantId, cash.id, expected + 100));
  });
});

describe('importProducts: create, update, upsert, limites e duplicatas', () => {
  it('create: adiciona novos, pula existentes, detecta duplicata na planilha', () => {
    const report = importProducts(state, tenantId, [
      { line: 1, sku: 'NEW-001', name: 'Item Novo 1', category: 'Filtros', brand: 'Bosch', barcode: 'DEMO-NEW-1', unit: 'UN', cost: 1000, price: 2000, min: 2, max: 20, location: 'A1' },
      { line: 2, sku: 'NEW-001', name: 'Item Novo Duplicado Planilha', category: 'Filtros', brand: 'Bosch', barcode: 'DEMO-NEW-2', unit: 'UN', cost: 1000, price: 2000, min: 2, max: 20, location: 'A1' },
      { line: 3, sku: 'PRE-0001', name: 'SKU já existente na loja', category: 'Filtros', brand: 'Tecfil', barcode: '', unit: 'UN', cost: 1000, price: 2000, min: 2, max: 20, location: '' },
    ], 'create');
    expect(report.created).toBe(1);
    expect(report.skipped).toBe(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].message).toContain('duplicado na planilha');
    expect(state.products.find(p => p.sku === 'NEW-001')).toBeTruthy();
  });

  it('update: atualiza existentes, pula novos', () => {
    const report = importProducts(state, tenantId, [
      { line: 1, sku: 'PRE-0001', name: 'Filtro Atualizado via Planilha', category: 'Filtros', brand: 'Tecfil', barcode: 'DEMO-3-000001', unit: 'UN', cost: 1900, price: 3990, min: 10, max: 200, location: 'C1' },
      { line: 2, sku: 'NOT-EXIST', name: 'Não existe', category: '', brand: '', barcode: '', unit: '', cost: 100, price: 200, min: 1, max: 2, location: '' },
    ], 'update');
    expect(report.updated).toBe(1);
    expect(report.skipped).toBe(1);
    expect(state.products.find(p => p.sku === 'PRE-0001')?.name).toBe('Filtro Atualizado via Planilha');
    expect(state.products.find(p => p.sku === 'PRE-0001')?.price).toBe(3990);
  });

  it('upsert: cria e atualiza na mesma carga', () => {
    const report = importProducts(state, tenantId, [
      { line: 1, sku: 'PRE-0002', name: 'Óleo Sintético Atualizado', category: 'Lubrificantes', brand: 'Mobil', barcode: 'DEMO-3-000002', unit: 'UN', cost: 3500, price: 5990, min: 10, max: 200, location: '' },
      { line: 2, sku: 'UPSERT-NEW', name: 'Item Criado via Upsert', category: 'Geral', brand: '', barcode: '', unit: 'UN', cost: 500, price: 1500, min: 1, max: 10, location: '' },
    ], 'upsert');
    expect(report.created).toBe(1);
    expect(report.updated).toBe(1);
  });

  it('respeita limite de produtos do plano', () => {
    const plan = state.plans.find(p => p.id === 'premium')!;
    plan.products = state.products.filter(p => p.tenantId === tenantId && p.active).length; // Limite atingido
    const report = importProducts(state, tenantId, [
      { line: 1, sku: 'OVER-LIMIT', name: 'Excede limite', category: 'Geral', brand: '', barcode: '', unit: '', cost: 100, price: 200, min: 1, max: 2, location: '' },
    ], 'create');
    expect(report.created).toBe(0);
    expect(report.errors[0].message).toContain('Limite de produtos do plano');
  });

  it('rejeita valores não inteiros', () => {
    const report = importProducts(state, tenantId, [
      { line: 1, sku: 'FLOAT-VAL', name: 'Item float', category: '', brand: '', barcode: '', unit: '', cost: 10.5, price: 20, min: 1, max: 2, location: '' },
    ], 'create');
    expect(report.created).toBe(0);
    expect(report.errors[0].message.toLowerCase()).toContain('valores de custo, preço e limites devem ser inteiros');
  });
});

describe('cupons SaaS e criação de faturas com desconto', () => {
  it('exemplo obrigatório do contrato: Profissional mensal 24900 com 20% (2000 bps) = 19920', () => {
    // Cupom PISTEC20 existe no seed (2000 bps, planos profissional e premium, mensal/trimestral/anual)
    const quote = couponQuote(state, tenantId, 'PISTEC20', 'profissional', 'monthly', '2026-10-14');
    expect(quote.original).toBe(24900);
    expect(quote.discount).toBe(4980); // 24900 * 0.20 = 4980
    expect(quote.total).toBe(19920);

    const invoice = createSubscriptionInvoice(state, {
      tenantId,
      planId: 'profissional',
      period: 'monthly',
      couponCode: 'PISTEC20',
      provider: 'Asaas',
      requestId: 'sub-prof-20',
      today: '2026-10-14',
    });
    expect(invoice.amount).toBe(19920);
    expect(invoice.originalAmount).toBe(24900);
    expect(invoice.discount).toBe(4980);
    expect(invoice.couponCode).toBe('PISTEC20');
    expect(invoice.status).toBe('Pendente'); // NUNCA marca paga
    // Redemption registrada
    const redemption = state.couponRedemptions.find(r => r.invoiceId === invoice.id)!;
    expect(redemption.discount).toBe(4980);
    expect(redemption.tenantId).toBe(tenantId);
  });

  it('cupom com desconto fixo (BEMVINDO50 R$ 50,00 = 5000 centavos)', () => {
    const quote = couponQuote(state, tenantId, 'BEMVINDO50', 'essencial', 'monthly', '2026-10-14');
    expect(quote.original).toBe(12900);
    expect(quote.discount).toBe(5000);
    expect(quote.total).toBe(7900);
  });

  it('rejeita cupom vencido, inativo ou inexistente', () => {
    expect(() => couponQuote(state, tenantId, 'NAOEXISTE', 'profissional', 'monthly', '2026-10-14')).toThrow('inexistente');
    saveCoupon(state, { code: 'INATIVO', description: 'Inativo', kind: 'fixed', value: 1000, startsAt: '2026-01-01', endsAt: '2026-12-31', maxUses: 10, perTenant: 1, planIds: [], periods: [], active: false, scope: 'first' });
    expect(() => couponQuote(state, tenantId, 'INATIVO', 'profissional', 'monthly', '2026-10-14')).toThrow('inativo');
    saveCoupon(state, { code: 'VENCIDO', description: 'Vencido', kind: 'fixed', value: 1000, startsAt: '2025-01-01', endsAt: '2025-12-31', maxUses: 10, perTenant: 1, planIds: [], periods: [], active: true, scope: 'first' });
    expect(() => couponQuote(state, tenantId, 'VENCIDO', 'profissional', 'monthly', '2026-10-14')).toThrow('vigência');
  });

  it('respeita restrição de plano e período', () => {
    // ANUAL30 só aceita período anual
    expect(() => couponQuote(state, tenantId, 'ANUAL30', 'profissional', 'monthly', '2026-10-14')).toThrow('período');
    const valid = couponQuote(state, tenantId, 'ANUAL30', 'profissional', 'annual', '2026-10-14');
    expect(valid.total).toBe(Math.round(238900 * 0.70));
  });

  it('respeita limite por empresa e limite total de usos', () => {
    saveCoupon(state, { code: 'ONCE', description: 'Uma vez só', kind: 'fixed', value: 1000, startsAt: '2026-01-01', endsAt: '2026-12-31', maxUses: 1, perTenant: 1, planIds: [], periods: [], active: true, scope: 'first' });
    createSubscriptionInvoice(state, { tenantId, planId: 'essencial', period: 'monthly', couponCode: 'ONCE', provider: 'Asaas', requestId: 'use-once-1', today: '2026-10-14' });
    // Segunda tentativa pela mesma empresa -> erro
    expect(() => createSubscriptionInvoice(state, { tenantId, planId: 'essencial', period: 'monthly', couponCode: 'ONCE', provider: 'Asaas', requestId: 'use-once-2', today: '2026-10-14' })).toThrow();
  });
});

describe('migrações v1 -> v2 e persistência de sessão', () => {
  it('migrate converte snapshot v1 real preservando registros', async () => {
    const { readFileSync } = await import('node:fs');
    const v1Raw = JSON.parse(readFileSync('src/__fixtures__/state-v1.json', 'utf-8'));
    expect(v1Raw.version).toBe(1);
    const beforeSalesCount = v1Raw.sales.length;
    const beforeFinancesCount = v1Raw.finances.length;
    const beforePaidFinances = v1Raw.finances.filter((f: { paid: boolean }) => f.paid).length;

    const v2 = migrate(v1Raw);
    expect(v2.version).toBe(2);
    expect(v2.sales).toHaveLength(beforeSalesCount);
    expect(v2.finances).toHaveLength(beforeFinancesCount);
    // Vendas receberam change: 0
    expect(v2.sales.every(s => s.change === 0)).toBe(true);
    // Branding radius default
    expect(v2.tenants.every(t => t.branding.radius === 'default')).toBe(true);
    // Cupons inicializados vazios
    expect(v2.coupons).toEqual([]);
    expect(v2.couponRedemptions).toEqual([]);
    // Todas as finanças paid que estavam sem baixa receberam settlement integral
    const migratedSettled = v2.finances.filter(f => f.paid);
    expect(migratedSettled.length).toBe(beforePaidFinances);
    expect(migratedSettled.every(f => f.settlements.length === 1 && f.settlements[0].amount === f.amount)).toBe(true);
    expect(() => validateState(v2)).not.toThrow();
  });

  it('migrate é transacional: falha não sobrescreve snapshot', async () => {
    const db = new DemoDatabase('test-transact-migrate');
    const badV1 = { version: 1, tenants: 'corrompido' };
    await db.snapshots.put({ id: 'demo', state: badV1 as unknown as DemoState });
    const store = createDemoStore({ db, seed: () => structuredClone(baseline), latency: 0 });
    await expect(store.ready).rejects.toThrow();
    // Snapshot original no IndexedDB não foi corrompido ou sobrescrito
    const saved = await db.snapshots.get('demo');
    expect(saved?.state).toEqual(badV1);
  });

  it('sessão persistida no localStorage, validada e limpa no logout', () => {
    localStorage.clear();
    expect(loadPersistedSession()).toBeNull();

    const customSession = {
      tenantId: 'tenant-oficina',
      branchId: 'branch-oficina-matriz',
      role: 'Gerente' as const,
      name: 'Camila Gerente',
      admin: false,
    };
    persistSession(customSession);
    expect(loadPersistedSession()).toEqual(customSession);
    expect(isValidSession(customSession, state)).toBe(true);

    // Sessão inválida com tenant inexistente
    expect(isValidSession({ ...customSession, tenantId: 'inexistente' }, state)).toBe(false);

    // Logout limpa o localStorage
    persistSession(null);
    expect(loadPersistedSession()).toBeNull();
  });

  it('benchmark validateState: mede tempo no seed e em escala', () => {
    // Aquecimento
    for (let i = 0; i < 5; i++) validateState(state);

    const iters = 50;
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) validateState(state);
    const avgSeed = (performance.now() - t0) / iters;

    // Escala 20x de vendas, finanças, auditoria e registros operacionais não-reservados
    const scaled = structuredClone(state);
    scaled.plans.forEach(p => { p.users *= 50; p.whatsapp *= 50; p.products *= 50; p.branches *= 50; });
    const nonReservedRecords = state.records.filter(r => r.fields?.stockState !== 'reserved');
    for (let i = 0; i < 19; i++) {
      scaled.sales.push(...state.sales.map((s, idx) => ({ ...s, id: `s-scale-${i}-${idx}`, requestId: `req-scale-${i}-${idx}` })));
      scaled.finances.push(...state.finances.map((f, idx) => ({ ...f, id: `f-scale-${i}-${idx}`, reference: f.reference ? `ref-scale-${i}-${idx}` : '' })));
      scaled.audit.push(...state.audit.map((a, idx) => ({ ...a, id: `a-scale-${i}-${idx}` })));
      scaled.records.push(...nonReservedRecords.map((r, idx) => ({ ...r, id: `r-scale-${i}-${idx}` })));
    }
    const t1 = performance.now();
    for (let i = 0; i < iters; i++) validateState(scaled);
    const avgScaled = (performance.now() - t1) / iters;

    console.log(`[BENCHMARK] validateState baseline seed: ${avgSeed.toFixed(2)}ms | escala 20x: ${avgScaled.toFixed(2)}ms`);
    expect(avgSeed).toBeLessThan(5);
    expect(avgScaled).toBeLessThan(25);
  });
});

