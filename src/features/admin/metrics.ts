import type { BillingInvoice, BillingPeriod, DemoState } from '../../types';
import { planPrice } from '../public/model';

export const invoiceStatus = (invoice: BillingInvoice, today: string) => invoice.status === 'Pendente' && invoice.dueDate < today ? 'Vencida' : invoice.status;
export const shiftDate = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const monthLabel = (ym: string) => new Intl.DateTimeFormat('pt-BR', { month: 'short', year: '2-digit', timeZone: 'UTC' }).format(new Date(`${ym}-15T12:00:00Z`)).replace('.', '');

/**
 * Indicadores SaaS derivados do estado.
 * - MRR/ARR: recorrência contratada (empresas Ativas × plano, na periodicidade da última fatura), não dinheiro recebido.
 * - Tenant não tem createdAt: entrada = auditoria "Empresa criada:" (createTenant); sem ela, a empresa é tratada como anterior ao período.
 * - Cancelamento = auditoria "→ Cancelada" da empresa; Cancelada sem data conhecida sai da base (anterior ao período).
 */
export function saasMetrics(state: DemoState, today: string, windowDays = 30) {
  const start = shiftDate(today, -windowDays);
  const plans = new Map(state.plans.map(p => [p.id, p]));
  const createdAt = new Map<string, string>(); const cancelledAt = new Map<string, string>();
  for (const a of state.audit) {
    const day = a.date.slice(0, 10);
    if (a.action.startsWith('Empresa criada:')) createdAt.set(a.tenantId, day);
    if (a.action.includes('→ Cancelada') && day > (cancelledAt.get(a.tenantId) ?? '')) cancelledAt.set(a.tenantId, day);
  }
  const lastPeriod = new Map<string, BillingPeriod>();
  for (const i of [...state.invoices].sort((a, b) => a.dueDate.localeCompare(b.dueDate))) if (i.period && i.status !== 'Cancelada') lastPeriod.set(i.tenantId, i.period);

  const active = state.tenants.filter(t => t.status === 'Ativa');
  const mrr = active.reduce((sum, t) => { const plan = plans.get(t.planId); return plan ? sum + planPrice(plan, lastPeriod.get(t.id) ?? 'monthly').monthly : sum; }, 0);
  const statusOf = (i: BillingInvoice) => invoiceStatus(i, today);
  const overdueInvoices = state.invoices.filter(i => statusOf(i) === 'Vencida');
  const pending = state.invoices.filter(i => statusOf(i) === 'Pendente');
  const overdueTenants = new Set([...overdueInvoices.map(i => i.tenantId), ...state.tenants.filter(t => t.status === 'Vencida').map(t => t.id)]);
  const base = state.tenants.filter(t => {
    if ((createdAt.get(t.id) ?? '') >= start) return false; // entrou durante o período
    if (t.status !== 'Cancelada') return true;
    const out = cancelledAt.get(t.id); return !!out && out >= start; // cancelada no período conta na base
  });
  const churned = base.filter(t => t.status === 'Cancelada').length;

  const months = Array.from({ length: 6 }, (_, k) => { const d = new Date(`${today.slice(0, 7)}-15T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 5 + k); return d.toISOString().slice(0, 7); });
  const revenueByMonth = months.map(m => ({ month: m, label: monthLabel(m), received: state.invoices.filter(i => i.status === 'Paga' && i.dueDate.startsWith(m)).reduce((s, i) => s + i.amount, 0) }));
  const byPlan = state.plans.map(p => ({ name: p.name, value: state.tenants.filter(t => t.planId === p.id && t.status !== 'Cancelada').length }));
  const byStatus = Object.entries(state.tenants.reduce<Record<string, number>>((acc, t) => { acc[t.status] = (acc[t.status] ?? 0) + 1; return acc; }, {})).map(([name, value]) => ({ name, value }));

  return {
    mrr, arr: mrr * 12, active: active.length,
    trial: state.tenants.filter(t => t.status === 'Teste').length,
    newTenants: [...createdAt.entries()].filter(([id, day]) => day >= start && state.tenants.some(t => t.id === id)).length,
    overdueTenants: overdueTenants.size, overdueInvoices,
    pendingCount: pending.length, pendingAmount: pending.reduce((s, i) => s + i.amount, 0),
    received: state.invoices.filter(i => i.status === 'Paga').reduce((s, i) => s + i.amount, 0),
    churn: base.length ? churned / base.length : null, churnBase: base.length, churned,
    openTickets: state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-ticket' && r.status !== 'Resolvido').length,
    revenueByMonth, byPlan, byStatus,
  };
}
