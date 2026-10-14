import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoStore, DemoDatabase } from '../../store';
import { createSeed, INITIAL_SESSION } from '../../seed';
import { completeSale, convertRecord, receivePurchase, saveProduct, transitionRecord } from '../../domain';
import { cashExpected } from './logic';
import type { OperationalRecord } from '../../types';

describe('ERP persisted workflows', () => {
  let store: ReturnType<typeof createDemoStore>;
  const session = INITIAL_SESSION;
  beforeEach(async () => {
    store = createDemoStore({ db: new DemoDatabase(`erp-test-${crypto.randomUUID()}`), latency: 0, seed: () => createSeed(new Date('2026-10-14T12:00:00Z')) });
    await store.ready;
  });
  afterEach(async () => { await store.db.delete(); });
  it('suspends and completes a mixed-payment cart without an invalid record conversion', async () => {
    const product = store.getSnapshot().state.products.find(row => row.tenantId === session.tenantId)!;
    const cash = store.getSnapshot().state.cashRegisters.find(row => row.tenantId === session.tenantId && row.branchId === session.branchId && !row.closedAt)!;
    const opening = cashExpected(cash);
    const record: OperationalRecord = { id: 'test-cart', tenantId: session.tenantId, branchId: session.branchId, kind: 'cart', title: 'Carrinho teste', status: 'Suspenso', customerId: '', date: '2026-10-14', amount: product.price, fields: { requestId: 'erp-test-sale' }, items: [{ productId: product.id, name: product.name, quantity: 1, cost: product.cost, price: product.price }], history: [] };
    await store.mutate(draft => { draft.records.push(record); });
    await store.mutate(draft => {
      const sale = completeSale(draft, { tenantId: session.tenantId, branchId: session.branchId, seller: session.name, customerId: '', items: [{ productId: product.id, quantity: 1 }], discount: 0, surcharge: 0, payments: [{ method: 'Dinheiro', amount: 1000 }, { method: 'Pix', amount: product.price - 1000 }], requestId: 'erp-test-sale' });
      const saved = draft.records.find(row => row.id === record.id)!;
      saved.status = 'Concluído'; saved.fields.saleId = sale.id;
    });
    const snapshot = store.getSnapshot().state;
    expect(snapshot.records.find(row => row.id === record.id)?.fields.saleId).toBeTruthy();
    expect(cashExpected(snapshot.cashRegisters.find(row => row.id === cash.id)!)).toBe(opening + 1000);
    expect(snapshot.finances.some(row => row.reference === snapshot.records.find(row => row.id === record.id)?.fields.saleId)).toBe(true);
  });
  it('receives a purchase using item costs and generates a payable', async () => {
    const purchase = store.getSnapshot().state.records.find(row => row.tenantId === session.tenantId && row.kind === 'compras' && row.status === 'Pendente')!;
    await store.mutate(draft => receivePurchase(draft, session.tenantId, purchase.id));
    const snapshot = store.getSnapshot().state;
    expect(snapshot.records.find(row => row.id === purchase.id)?.status).toBe('Recebida');
    expect(snapshot.finances.find(row => row.reference === purchase.id)?.amount).toBe(purchase.items.reduce((sum, item) => sum + item.quantity * item.cost, 0));
  });
  it('preserves all data after a simulated import write failure, then retries', async () => {
    const original = store.getSnapshot().state.products.find(row => row.tenantId === session.tenantId)!;
    const product = { ...original, id: 'erp-import', sku: 'ERP-IMPORT', barcode: '', name: 'Produto importado' };
    store.setFailNext(true);
    await expect(store.mutate(draft => saveProduct(draft, product))).rejects.toThrow('Falha simulada');
    expect(store.getSnapshot().state.products.some(row => row.id === product.id)).toBe(false);
    await store.mutate(draft => saveProduct(draft, product));
    expect(store.getSnapshot().state.products.some(row => row.id === product.id)).toBe(true);
  });
  it('converts a CRM opportunity exactly once and cancels a pending purchase', async () => {
    const lead = store.getSnapshot().state.records.find(row => row.tenantId === session.tenantId && row.kind === 'crm' && row.status === 'Proposta')!;
    await store.mutate(draft => convertRecord(draft, session.tenantId, lead.id, 'orcamentos'));
    const convertedId = store.getSnapshot().state.records.find(row => row.id === lead.id)!.convertedId;
    await store.mutate(draft => convertRecord(draft, session.tenantId, lead.id, 'orcamentos'));
    expect(store.getSnapshot().state.records.filter(row => row.id === convertedId)).toHaveLength(1);
    const purchase = store.getSnapshot().state.records.find(row => row.tenantId === session.tenantId && row.kind === 'compras' && row.status === 'Pendente')!;
    await store.mutate(draft => transitionRecord(draft, session.tenantId, purchase.id, 'Cancelada'));
    expect(store.getSnapshot().state.records.find(row => row.id === purchase.id)?.status).toBe('Cancelada');
  });
});
