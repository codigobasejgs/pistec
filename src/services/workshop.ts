// PISTEC NEXT: regras determinísticas da oficina sobre o mesmo DemoState (demo = IndexedDB, real = leitura Supabase).
// Nada aqui grava ou envia; gravações passam pelas RPCs/ações existentes.
import type { DemoState, OperationalRecord, Product } from '../types';
import { cents } from '../features/erp/logic';

export interface ServicePackage { id: string; name: string; items: { productId: string; quantity: number }[]; labor: number }
export interface WorkshopSettings {
  quoteFollowupDays: number; osStaleDays: number; lowMarginPct: number; warrantyWarnDays: number; maintenanceWarnDays: number;
  hourlyCost: number; defaultLeadDays: number; demandDays: number; openHour: number; closeHour: number; slotMinutes: number;
  mode: 'informativo' | 'assistido'; dismissed: Record<string, string>; packages: ServicePackage[];
}
export const DEFAULT_WORKSHOP: WorkshopSettings = {
  quoteFollowupDays: 3, osStaleDays: 2, lowMarginPct: 20, warrantyWarnDays: 15, maintenanceWarnDays: 15,
  hourlyCost: 0, defaultLeadDays: 7, demandDays: 90, openHour: 8, closeHour: 18, slotMinutes: 30,
  mode: 'assistido', dismissed: {}, packages: [],
};
export const workshopOf = (raw: unknown): WorkshopSettings => ({ ...DEFAULT_WORKSHOP, ...(raw && typeof raw === 'object' ? raw as Partial<WorkshopSettings> : {}) });

const DAY = 86_400_000;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const money = (v: string | undefined) => { try { return v ? cents(v) : 0; } catch { return 0; } };
const lastActivity = (r: OperationalRecord) => r.history.at(-1)?.date.slice(0, 10) || r.date.slice(0, 10);
const OS_CLOSED = ['Pronta', 'Entregue', 'Cancelada'];

// ---------------------------------------------------------------- Rentabilidade (margem de contribuição, não lucro líquido)
export interface OsProfit { revenue: number; partsRevenue: number; laborRevenue: number; partsCost: number; laborCost: number; thirdParty: number; commission: number; direct: number; margin: number; marginPct: number | null; hours: number; estimatedHours: number }
export function osProfit(r: OperationalRecord, s: Pick<WorkshopSettings, 'hourlyCost'>): OsProfit {
  const partsRevenue = r.items.reduce((t, i) => t + i.price * i.quantity, 0), partsCost = r.items.reduce((t, i) => t + i.cost * i.quantity, 0);
  const laborRevenue = money(r.fields.labor), hours = Number(r.fields.hoursWorked) || 0, estimatedHours = Number(r.fields.estimatedHours) || 0;
  const laborCost = Math.round(hours * s.hourlyCost), thirdParty = money(r.fields.thirdPartyCost);
  const commission = Math.round(laborRevenue * (Number(r.fields.commissionPct) || 0) / 100);
  const direct = partsCost + laborCost + thirdParty + commission, revenue = r.amount;
  return { revenue, partsRevenue, laborRevenue, partsCost, laborCost, thirdParty, commission, direct, margin: revenue - direct, marginPct: revenue ? Math.round((revenue - direct) * 1000 / revenue) / 10 : null, hours, estimatedHours };
}

// ---------------------------------------------------------------- Estoque inteligente
export interface StockInsight { product: Product; quantity: number; reserved: number; available: number; demand: number; leadDays: number; reorderPoint: number; pendingIn: number; suggested: number; status: 'ruptura' | 'abaixo do mínimo' | 'sem giro' | 'excesso' | 'ok'; supplierId: string; lastCost: number }
export function stockInsights(state: DemoState, tenantId: string, branchId: string, s: Pick<WorkshopSettings, 'defaultLeadDays' | 'demandDays'>, today: string): StockInsight[] {
  const since = addDays(today, -s.demandDays);
  const demand = new Map<string, number>(), pendingIn = new Map<string, number>(), last = new Map<string, { supplierId: string; cost: number; date: string }>();
  for (const m of state.movements) if (m.tenantId === tenantId && m.branchId === branchId && ['Saída', 'Consumo OS'].includes(m.type) && m.date.slice(0, 10) >= since) demand.set(m.productId, (demand.get(m.productId) ?? 0) + m.quantity);
  for (const r of state.records) {
    if (r.tenantId !== tenantId || r.kind !== 'compras') continue;
    for (const i of r.items) {
      if (r.status === 'Pendente' && r.branchId === branchId) pendingIn.set(i.productId, (pendingIn.get(i.productId) ?? 0) + i.quantity);
      if (r.status === 'Recebida' && (last.get(i.productId)?.date ?? '') <= r.date) last.set(i.productId, { supplierId: r.fields.supplierId ?? '', cost: i.cost, date: r.date });
    }
  }
  return state.products.filter(p => p.tenantId === tenantId && p.active).map(product => {
    const b = state.balances.find(x => x.tenantId === tenantId && x.branchId === branchId && x.productId === product.id);
    const quantity = b?.quantity ?? 0, reserved = b?.reserved ?? 0, available = quantity - reserved, d = demand.get(product.id) ?? 0;
    const leadDays = Number(product.details.leadDays) || s.defaultLeadDays;
    // Ponto de reposição = demanda média no prazo de entrega + estoque de segurança (mínimo do produto).
    const reorderPoint = Math.ceil(d / s.demandDays * leadDays) + product.min, pin = pendingIn.get(product.id) ?? 0;
    const suggested = available + pin <= reorderPoint && (d > 0 || product.min > 0) ? Math.max(reorderPoint + 1, product.max || 0) - available - pin : 0;
    const status = available <= 0 && d > 0 ? 'ruptura' : available < product.min ? 'abaixo do mínimo' : product.max && quantity > product.max ? 'excesso' : d === 0 && quantity > 0 ? 'sem giro' : 'ok';
    const l = last.get(product.id);
    return { product, quantity, reserved, available, demand: d, leadDays, reorderPoint, pendingIn: pin, suggested: Math.max(0, suggested), status, supplierId: l?.supplierId ?? '', lastCost: l?.cost ?? product.cost };
  });
}

// ---------------------------------------------------------------- Cotação com fornecedores
export interface QuoteResponse { supplierId: string; prices: Record<string, number>; freight: number; leadDays: number; validUntil: string; notes: string; updatedAt: string }
export const quoteResponses = (r: OperationalRecord): QuoteResponse[] => { try { const v = JSON.parse(r.fields.responses || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
export function compareQuotes(r: OperationalRecord, today: string) {
  const rows = quoteResponses(r).map(q => {
    const complete = r.items.every(i => Number.isSafeInteger(q.prices[i.productId]));
    const total = r.items.reduce((t, i) => t + (q.prices[i.productId] ?? 0) * i.quantity, 0) + (q.freight || 0);
    return { ...q, complete, total, expired: !!q.validUntil && q.validUntil < today };
  });
  const valid = rows.filter(q => q.complete && !q.expired);
  const by = (f: (q: typeof valid[number]) => number) => valid.slice().sort((a, b) => f(a) - f(b) || a.total - b.total)[0]?.supplierId ?? '';
  return { rows, cheapest: by(q => q.total), fastest: by(q => q.leadDays), recommended: by(q => q.total) };
}

// ---------------------------------------------------------------- Orçamento com aprovação por item
export type Decision = 'approve' | 'reject';
export function approvedScope(r: Pick<OperationalRecord, 'items' | 'fields'>, decisions: Record<string, Decision>) {
  const items = r.items.filter(i => decisions[i.productId] === 'approve'), labor = money(r.fields.labor);
  const laborOk = labor > 0 && decisions.labor === 'approve';
  return { items, rejected: r.items.filter(i => decisions[i.productId] !== 'approve'), labor: laborOk ? labor : 0, total: items.reduce((t, i) => t + i.price * i.quantity, 0) + (laborOk ? labor : 0) };
}

// ---------------------------------------------------------------- Agenda inteligente
const minutes = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + (m || 0); };
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const overlaps = (a: { time: string; duration: number }, b: { time: string; duration: number }) => Math.max(minutes(a.time), minutes(b.time)) < Math.min(minutes(a.time) + a.duration, minutes(b.time) + b.duration);
/** Horários livres no dia para o responsável e/ou box informados. */
export function freeSlots(state: DemoState, tenantId: string, branchId: string, day: string, duration: number, who: { responsible?: string; box?: string }, s: Pick<WorkshopSettings, 'openHour' | 'closeHour' | 'slotMinutes'>) {
  const busy = state.records.filter(r => r.tenantId === tenantId && r.branchId === branchId && r.kind === 'agenda' && r.status !== 'Cancelado' && r.fields.scheduledDate === day && r.fields.time
    && ((who.responsible && r.fields.responsible === who.responsible) || (who.box && r.fields.box === who.box)));
  const out: string[] = [];
  for (let m = s.openHour * 60; m + duration <= s.closeHour * 60; m += s.slotMinutes)
    if (!busy.some(r => overlaps({ time: hhmm(m), duration }, { time: r.fields.time, duration: Number(r.fields.duration) || 60 }))) out.push(hhmm(m));
  return out;
}

// ---------------------------------------------------------------- Fideliza (revisões por data registrada, nunca por km presumido)
export function maintenanceDue(state: DemoState, tenantId: string, today: string, warnDays: number) {
  const limit = addDays(today, warnDays);
  return state.records.filter(r => r.tenantId === tenantId && r.kind === 'ordens-servico' && r.status === 'Entregue' && r.fields.nextServiceDate && r.fields.nextServiceDate <= limit && r.fields.nextServiceDone !== 'true')
    .map(r => ({ record: r, customer: state.customers.find(c => c.id === r.customerId && c.tenantId === tenantId), vehicle: state.records.find(v => v.id === r.fields.vehicleId && v.tenantId === tenantId), overdue: r.fields.nextServiceDate < today }))
    .sort((a, b) => a.record.fields.nextServiceDate.localeCompare(b.record.fields.nextServiceDate));
}

// ---------------------------------------------------------------- AutoPilot
export interface Alert { key: string; rule: string; severity: 'alta' | 'média' | 'baixa'; title: string; detail: string; module: string; recordId?: string }
export function autopilot(state: DemoState, tenantId: string, branchId: string, s: WorkshopSettings, today: string): Alert[] {
  const out: Alert[] = [], rec = state.records.filter(r => r.tenantId === tenantId && r.branchId === branchId);
  const add = (a: Omit<Alert, 'key'> & { recordId: string }) => out.push({ ...a, key: `${a.rule}:${a.recordId}` });
  for (const r of rec) {
    if (r.kind === 'orcamentos' && ['Aberto', 'Enviado'].includes(r.status) && lastActivity(r) <= addDays(today, -s.quoteFollowupDays))
      add({ rule: 'orcamento-sem-resposta', severity: 'média', title: `Orçamento sem resposta: ${r.title}`, detail: `Sem atualização desde ${lastActivity(r)}.`, module: 'orcamentos', recordId: r.id });
    if (r.kind === 'ordens-servico' && !OS_CLOSED.includes(r.status)) {
      if (r.fields.dueDate && r.fields.dueDate < today) add({ rule: 'os-atrasada', severity: 'alta', title: `OS atrasada: ${r.title}`, detail: `Prometida para ${r.fields.dueDate}.`, module: 'ordens-servico', recordId: r.id });
      else if (r.fields.dueDate === today) add({ rule: 'os-prazo-hoje', severity: 'média', title: `OS vence hoje: ${r.title}`, detail: `Status: ${r.status}.`, module: 'ordens-servico', recordId: r.id });
      if (r.status === 'Aguardando peças') add({ rule: 'os-aguardando-pecas', severity: 'alta', title: `Aguardando peças: ${r.title}`, detail: 'Consulte estoque ou gere cotação.', module: 'ordens-servico', recordId: r.id });
      else if (lastActivity(r) <= addDays(today, -s.osStaleDays)) add({ rule: 'os-parada', severity: 'baixa', title: `OS sem atualização: ${r.title}`, detail: `Última movimentação em ${lastActivity(r)}.`, module: 'ordens-servico', recordId: r.id });
    }
    if (r.kind === 'ordens-servico' && ['Pronta', 'Entregue'].includes(r.status) && r.amount > 0) {
      const p = osProfit(r, s);
      if (p.marginPct !== null && p.marginPct < s.lowMarginPct) add({ rule: 'os-margem-baixa', severity: 'média', title: `Margem baixa: ${r.title}`, detail: `Margem de contribuição ${p.marginPct}% (meta ${s.lowMarginPct}%).`, module: 'relatorios', recordId: r.id });
    }
    if (r.kind === 'compras' && r.status === 'Pendente' && r.fields.expectedDate && r.fields.expectedDate < today)
      add({ rule: 'compra-atrasada', severity: 'média', title: `Compra atrasada: ${r.title}`, detail: `Previsão era ${r.fields.expectedDate}.`, module: 'compras', recordId: r.id });
    if (r.kind === 'agenda' && r.status === 'Agendado' && r.fields.scheduledDate && r.fields.scheduledDate <= addDays(today, 1) && r.fields.scheduledDate >= today)
      add({ rule: 'agenda-sem-confirmacao', severity: 'média', title: `Agendamento não confirmado: ${r.title}`, detail: `${r.fields.scheduledDate} ${r.fields.time ?? ''}`, module: 'agenda', recordId: r.id });
    if (r.kind === 'garantias' && !['Concluída', 'Rejeitada'].includes(r.status))
      add({ rule: 'garantia-aberta', severity: r.fields.expiresAt && r.fields.expiresAt <= addDays(today, s.warrantyWarnDays) ? 'alta' : 'baixa', title: `Garantia em aberto: ${r.title}`, detail: r.fields.expiresAt ? `Válida até ${r.fields.expiresAt}.` : r.status, module: 'garantias', recordId: r.id });
  }
  for (const i of stockInsights(state, tenantId, branchId, s, today).filter(i => i.status === 'ruptura' || i.status === 'abaixo do mínimo'))
    add({ rule: 'estoque-minimo', severity: i.status === 'ruptura' ? 'alta' : 'média', title: `${i.status === 'ruptura' ? 'Ruptura' : 'Abaixo do mínimo'}: ${i.product.name}`, detail: `Disponível ${i.available}; mínimo ${i.product.min}; sugestão ${i.suggested}.`, module: 'estoque', recordId: i.product.id });
  for (const m of maintenanceDue(state, tenantId, today, s.maintenanceWarnDays))
    add({ rule: 'revisao-prevista', severity: 'baixa', title: `Revisão prevista: ${m.customer?.name ?? m.record.title}`, detail: `${m.record.fields.nextService || 'Retorno'} em ${m.record.fields.nextServiceDate} (data registrada na OS).`, module: 'clientes', recordId: m.record.id });
  const rank = { alta: 0, média: 1, baixa: 2 };
  return out.filter(a => !(s.dismissed[a.key] && s.dismissed[a.key] >= today)).sort((a, b) => rank[a.severity] - rank[b.severity]);
}
