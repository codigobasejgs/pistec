import { describe, expect, test } from 'vitest';
import { emptyState } from '../real/read';
import type { OperationalRecord } from '../types';
import { DEFAULT_WORKSHOP, approvedScope, autopilot, compareQuotes, freeSlots, maintenanceDue, osProfit, stockInsights } from './workshop';

const T = 't1', B = 'b1', TODAY = '2026-11-10';
const rec = (p: Partial<OperationalRecord>): OperationalRecord => ({ id: crypto.randomUUID(), tenantId: T, branchId: B, kind: 'ordens-servico', title: 'R', status: 'Aberta', customerId: '', date: '2026-11-01', amount: 0, fields: {}, items: [], history: [], ...p });
function state() {
  const s = emptyState();
  s.products.push({ id: 'p1', tenantId: T, name: 'Óleo', sku: 'O1', barcode: '', category: '', brand: '', cost: 2000, price: 3500, min: 5, max: 20, location: '', active: true, details: {} });
  s.balances.push({ tenantId: T, branchId: B, productId: 'p1', quantity: 4, reserved: 1 });
  return s;
}

describe('rentabilidade por OS', () => {
  test('OS de R$ 800 com R$ 520 de custo direto = margem de contribuição R$ 280', () => {
    const r = rec({ amount: 80000, items: [{ productId: 'p1', name: 'x', quantity: 2, price: 25000, cost: 15000 }], fields: { labor: '300,00', hoursWorked: '2', thirdPartyCost: '100,00', commissionPct: '10' } });
    const p = osProfit(r, { hourlyCost: 3500 }); // 30000 peças + 7000 hora + 10000 terceiros + 3000 comissão = 50000
    expect(p.direct).toBe(50000); expect(p.margin).toBe(30000); expect(p.marginPct).toBe(37.5);
    expect(osProfit(rec({ amount: 80000, items: [{ productId: 'p1', name: 'x', quantity: 1, price: 80000, cost: 52000 }] }), { hourlyCost: 0 }).margin).toBe(28000);
  });
  test('sem receita a margem percentual não é inventada', () => expect(osProfit(rec({}), { hourlyCost: 0 }).marginPct).toBeNull());
});

describe('estoque inteligente', () => {
  test('ponto de reposição = demanda no prazo + mínimo; compra pendente reduz sugestão', () => {
    const s = state();
    for (let i = 0; i < 9; i++) s.movements.push({ id: `m${i}`, tenantId: T, branchId: B, productId: 'p1', quantity: 10, type: 'Saída', reference: '', date: '2026-10-20' });
    const [i] = stockInsights(s, T, B, { defaultLeadDays: 10, demandDays: 90 }, TODAY);
    expect(i.available).toBe(3); expect(i.demand).toBe(90); expect(i.reorderPoint).toBe(15); expect(i.status).toBe('abaixo do mínimo');
    expect(i.suggested).toBe(17); // até o máximo 20 a partir do disponível 3
    s.records.push(rec({ kind: 'compras', status: 'Pendente', items: [{ productId: 'p1', name: 'x', quantity: 10, price: 2000, cost: 2000 }] }));
    expect(stockInsights(s, T, B, { defaultLeadDays: 10, demandDays: 90 }, TODAY)[0].suggested).toBe(7);
  });
  test('demanda antiga fora da janela não conta; sem giro identificado', () => {
    const s = state(); s.balances[0] = { ...s.balances[0], quantity: 30, reserved: 0 }; s.products[0].max = 40;
    s.movements.push({ id: 'old', tenantId: T, branchId: B, productId: 'p1', quantity: 50, type: 'Saída', reference: '', date: '2025-01-01' });
    const [i] = stockInsights(s, T, B, { defaultLeadDays: 10, demandDays: 90 }, TODAY);
    expect(i.demand).toBe(0); expect(i.status).toBe('sem giro'); expect(i.suggested).toBe(0);
  });
});

describe('orçamento por item e cotações', () => {
  test('total reflete só o escopo aprovado', () => {
    const r = rec({ items: [{ productId: 'a', name: 'a', quantity: 2, price: 1000, cost: 0 }, { productId: 'b', name: 'b', quantity: 1, price: 5000, cost: 0 }], fields: { labor: '100,00' } });
    expect(approvedScope(r, { a: 'approve', b: 'reject', labor: 'approve' }).total).toBe(12000);
    expect(approvedScope(r, { b: 'approve' }).total).toBe(5000);
  });
  test('menor custo total considera frete; proposta vencida ou incompleta é ignorada', () => {
    const r = rec({ kind: 'cotacoes', items: [{ productId: 'p1', name: 'x', quantity: 10, price: 0, cost: 0 }], fields: { responses: JSON.stringify([
      { supplierId: 'A', prices: { p1: 1000 }, freight: 5000, leadDays: 2, validUntil: '', notes: '', updatedAt: '' },
      { supplierId: 'B', prices: { p1: 1200 }, freight: 0, leadDays: 5, validUntil: '', notes: '', updatedAt: '' },
      { supplierId: 'C', prices: { p1: 100 }, freight: 0, leadDays: 1, validUntil: '2026-11-01', notes: '', updatedAt: '' },
      { supplierId: 'D', prices: {}, freight: 0, leadDays: 1, validUntil: '', notes: '', updatedAt: '' }]) } });
    const c = compareQuotes(r, TODAY);
    expect(c.cheapest).toBe('B'); expect(c.fastest).toBe('A'); expect(c.rows.find(x => x.supplierId === 'C')?.expired).toBe(true);
  });
});

describe('agenda, fideliza e AutoPilot', () => {
  test('horários livres respeitam ocupação do mecânico e do box', () => {
    const s = state();
    s.records.push(rec({ kind: 'agenda', status: 'Agendado', fields: { scheduledDate: TODAY, time: '09:00', duration: '60', responsible: 'Ana', box: 'Box 1' } }));
    const cfg = { openHour: 8, closeHour: 11, slotMinutes: 30 };
    expect(freeSlots(s, T, B, TODAY, 60, { responsible: 'Ana' }, cfg)).toEqual(['08:00', '10:00']);
    expect(freeSlots(s, T, B, TODAY, 60, { responsible: 'Rui' }, cfg)).toEqual(['08:00', '08:30', '09:00', '09:30', '10:00']);
    expect(freeSlots(s, T, B, TODAY, 60, { responsible: 'Rui', box: 'Box 1' }, cfg)).toEqual(['08:00', '10:00']);
  });
  test('revisão usa data registrada; concluída sai da lista', () => {
    const s = state();
    s.records.push(rec({ status: 'Entregue', fields: { nextServiceDate: '2026-11-20', nextService: 'Troca de óleo' } }), rec({ status: 'Entregue', fields: { nextServiceDate: '2026-11-12', nextServiceDone: 'true' } }));
    expect(maintenanceDue(s, T, TODAY, 15)).toHaveLength(1);
    expect(maintenanceDue(s, T, TODAY, 5)).toHaveLength(0);
  });
  test('alertas determinísticos por regra, sem duplicar e respeitando dispensa', () => {
    const s = state(), late = rec({ fields: { dueDate: '2026-11-08' }, history: [{ date: '2026-11-09T10:00:00Z', text: 'x' }] });
    s.records.push(late, rec({ kind: 'orcamentos', status: 'Enviado', date: '2026-11-01' }), rec({ id: 'w', status: 'Aguardando peças', history: [{ date: `${TODAY}T08:00:00Z`, text: 'x' }] }));
    const alerts = autopilot(s, T, B, DEFAULT_WORKSHOP, TODAY);
    expect(alerts.map(a => a.rule).sort()).toEqual(['estoque-minimo', 'orcamento-sem-resposta', 'os-aguardando-pecas', 'os-atrasada']);
    expect(new Set(alerts.map(a => a.key)).size).toBe(alerts.length);
    expect(alerts[0].severity).toBe('alta');
    const hidden = autopilot(s, T, B, { ...DEFAULT_WORKSHOP, dismissed: { [`os-atrasada:${late.id}`]: TODAY } }, TODAY);
    expect(hidden.some(a => a.rule === 'os-atrasada')).toBe(false);
    expect(autopilot(s, 'outro', B, DEFAULT_WORKSHOP, TODAY)).toEqual([]);
  });
});
