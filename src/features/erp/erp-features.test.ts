import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDemoStore, DemoDatabase } from '../../store';
import { createSeed, INITIAL_SESSION } from '../../seed';
import { importProducts, settleEntry, reverseSettlement, entryBalance, entryPaid, entryStatus } from '../../domain';
import { mapImportRows, paymentSummary, sheetToRecords, type ImportMapping } from './logic';
import type { FinancialEntry, ProductImportRow } from '../../types';

describe('ERP logic & domain contract tests', () => {
  describe('paymentSummary', () => {
    it('calculates change for cash payments exceeding total', () => {
      const summary = paymentSummary(5000, [{ method: 'Dinheiro', amount: 6000 }]);
      expect(summary.received).toBe(6000);
      expect(summary.remaining).toBe(0);
      expect(summary.change).toBe(1000);
      expect(summary.error).toBe('');
    });

    it('blocks non-cash amounts exceeding total', () => {
      const summary = paymentSummary(5000, [{ method: 'Pix', amount: 6000 }]);
      expect(summary.change).toBe(0);
      expect(summary.error).toContain('Pix e cartões excedem');
    });

    it('handles mixed cash and pix correctly', () => {
      // Total 50,00: Pix 30,00 + Dinheiro 30,00 entregue -> troco de 10,00
      const summary = paymentSummary(5000, [
        { method: 'Pix', amount: 3000 },
        { method: 'Dinheiro', amount: 3000 },
      ]);
      expect(summary.received).toBe(6000);
      expect(summary.remaining).toBe(0);
      expect(summary.change).toBe(1000);
      expect(summary.error).toBe('');
    });

    it('flags insufficient payment', () => {
      const summary = paymentSummary(5000, [{ method: 'Dinheiro', amount: 4000 }]);
      expect(summary.remaining).toBe(1000);
      expect(summary.change).toBe(0);
      expect(summary.error).toContain('Pagamento insuficiente');
    });
  });

  describe('Import helpers', () => {
    it('converts sheet matrix to records keeping dates and values', () => {
      const matrix = [
        ['sku', 'name', 'price'],
        ['SKU-1', 'Item 1', '10.50'],
        ['SKU-2', 'Item 2', new Date('2026-05-10T00:00:00.000Z')],
        [null, '', '  '], // empty row should be skipped
      ];
      const records = sheetToRecords(matrix);
      expect(records).toHaveLength(2);
      expect(records[0]).toEqual({ sku: 'SKU-1', name: 'Item 1', price: '10.50' });
      expect(records[1].price).toBe('2026-05-10');
    });

    it('rejects duplicate or empty headers in sheet', () => {
      expect(() => sheetToRecords([['sku', 'sku'], ['a', 'b']])).toThrow();
      expect(() => sheetToRecords([['', 'name'], ['a', 'b']])).toThrow();
    });

    it('maps and validates import rows correctly', () => {
      const mapping: ImportMapping = {
        sku: 'codigo',
        name: 'descricao',
        price: 'venda',
        cost: 'custo',
      };
      const records = [
        { codigo: 'FLT-01', descricao: 'Filtro A', venda: '25,00', custo: '10,00' },
        { codigo: 'FLT-02', descricao: 'Filtro B', venda: '40,00', custo: '15,00' },
        { codigo: 'FLT-01', descricao: 'Filtro Duplicado', venda: '30,00', custo: '12,00' }, // repeated SKU
        { codigo: '', descricao: 'Sem SKU', venda: '10,00', custo: '0,00' }, // missing sku
      ];
      const { valid, errors } = mapImportRows(records, mapping);
      expect(valid).toHaveLength(2);
      expect(valid[0].sku).toBe('FLT-01');
      expect(valid[0].price).toBe(2500);
      expect(valid[0].cost).toBe(1000);
      expect(errors).toHaveLength(2);
      expect(errors[0].line).toBe(4); // repeated
      expect(errors[1].line).toBe(5); // empty sku
    });
  });

  describe('Financial settlement & reversal flow', () => {
    let store: ReturnType<typeof createDemoStore>;
    const session = INITIAL_SESSION;
    beforeEach(async () => {
      store = createDemoStore({ db: new DemoDatabase(`erp-fin-test-${crypto.randomUUID()}`), latency: 0, seed: () => createSeed(new Date('2026-10-14T12:00:00Z')) });
      await store.ready;
    });
    afterEach(async () => { await store.db.delete(); });

    it('performs partial settlement, reduces balance and reverses successfully', async () => {
      const entryId = 'test-fin-entry';
      await store.mutate(draft => {
        const entry: FinancialEntry = {
          id: entryId,
          tenantId: session.tenantId,
          branchId: session.branchId,
          type: 'Receita',
          category: 'Serviços',
          description: 'Serviço teste R$ 100',
          amount: 10000,
          dueDate: '2026-10-20',
          paid: false,
          settlements: [],
          reference: '',
          date: '2026-10-14',
        };
        draft.finances.push(entry);
      });

      // 1. Baixa parcial de R$ 40
      await store.mutate(draft => {
        settleEntry(draft, session.tenantId, entryId, {
          amount: 4000,
          method: 'Pix',
          date: '2026-10-14',
          user: session.name,
          note: 'Primeira parcela',
          requestId: 'req-partial-1',
        });
      });

      let snapshot = store.getSnapshot().state;
      let e = snapshot.finances.find(f => f.id === entryId)!;
      expect(entryPaid(e)).toBe(4000);
      expect(entryBalance(e)).toBe(6000);
      expect(entryStatus(e, '2026-10-14')).toBe('Parcialmente pago');
      expect(e.settlements).toHaveLength(1);

      // 2. Segunda baixa parcial de R$ 60 (quita o saldo restante)
      await store.mutate(draft => {
        settleEntry(draft, session.tenantId, entryId, {
          amount: 6000,
          method: 'Dinheiro',
          date: '2026-10-14',
          user: session.name,
          note: 'Quitação',
          requestId: 'req-partial-2',
        });
      });

      snapshot = store.getSnapshot().state;
      e = snapshot.finances.find(f => f.id === entryId)!;
      expect(entryPaid(e)).toBe(10000);
      expect(entryBalance(e)).toBe(0);
      expect(entryStatus(e, '2026-10-14')).toBe('Quitado');

      // 3. Estorno da primeira baixa de R$ 40
      const firstSettlementId = e.settlements[0].id;
      await store.mutate(draft => {
        reverseSettlement(draft, session.tenantId, entryId, firstSettlementId, session.name, 'Estorno solicitado');
      });

      snapshot = store.getSnapshot().state;
      e = snapshot.finances.find(f => f.id === entryId)!;
      expect(entryPaid(e)).toBe(6000);
      expect(entryBalance(e)).toBe(4000);
      expect(entryStatus(e, '2026-10-14')).toBe('Parcialmente pago');
      expect(e.settlements[0].reversedAt).toBeTruthy();
    });
  });

  describe('Product batch import', () => {
    let store: ReturnType<typeof createDemoStore>;
    const session = INITIAL_SESSION;
    beforeEach(async () => {
      store = createDemoStore({ db: new DemoDatabase(`erp-import-test-${crypto.randomUUID()}`), latency: 0, seed: () => createSeed(new Date('2026-10-14T12:00:00Z')) });
      await store.ready;
    });
    afterEach(async () => { await store.db.delete(); });

    it('creates new products and updates existing ones with strategy upsert', async () => {
      const existing = store.getSnapshot().state.products.find(p => p.tenantId === session.tenantId)!;
      const rows: ProductImportRow[] = [
        {
          line: 2,
          sku: existing.sku,
          name: `${existing.name} Atualizado`,
          category: existing.category,
          brand: existing.brand,
          barcode: existing.barcode,
          unit: 'UN',
          cost: existing.cost,
          price: existing.price + 500,
          min: existing.min,
          max: existing.max,
          location: 'A1-NOVO',
        },
        {
          line: 3,
          sku: 'SKU-INEDITO-XYZ',
          name: 'Produto Inédito XYZ',
          category: 'Diversos',
          brand: 'Genérica',
          barcode: '7891234567890',
          unit: 'PC',
          cost: 1500,
          price: 3500,
          min: 2,
          max: 20,
          location: 'B2-01',
        },
      ];

      await store.mutate(draft => {
        const report = importProducts(draft, session.tenantId, rows, 'upsert');
        expect(report.created).toBe(1);
        expect(report.updated).toBe(1);
        expect(report.errors).toHaveLength(0);
      });

      const snapshot = store.getSnapshot().state;
      const updated = snapshot.products.find(p => p.sku === existing.sku && p.tenantId === session.tenantId)!;
      expect(updated.name).toContain('Atualizado');
      expect(updated.price).toBe(existing.price + 500);
      expect(updated.location).toBe('A1-NOVO');

      const created = snapshot.products.find(p => p.sku === 'SKU-INEDITO-XYZ' && p.tenantId === session.tenantId)!;
      expect(created).toBeTruthy();
      expect(created.price).toBe(3500);
    });
  });
});
