import type { OperationalRecord, Plan } from '../../types';

export type Period = 'monthly' | 'quarterly' | 'annual';
export const periods: Record<Period, { label: string; months: number }> = {
  monthly: { label: 'Mensal', months: 1 }, quarterly: { label: 'Trimestral', months: 3 }, annual: { label: 'Anual', months: 12 },
};
export const roles = ['Proprietário', 'Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro'] as const;
export function planPrice(plan: Plan, period: Period) {
  const total = plan[period];
  if (!Number.isSafeInteger(total) || total < 0) throw new Error('Preço do plano inválido.');
  return { total, monthly: Math.round(total / periods[period].months) };
}
export function required(value: string, label: string, max = 200) {
  const text = value.trim();
  if (!text || text.length > max) throw new Error(`${label}: preencha entre 1 e ${max} caracteres.`);
  return text;
}
export function email(value: string) {
  const text = required(value, 'E-mail', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) throw new Error('Informe um e-mail válido.');
  return text;
}
export function mockCEP(value: string) {
  if (!/^\d{8}$/.test(value.replace(/\D/g, ''))) throw new Error('Informe um CEP com 8 dígitos.');
  // ponytail: consulta demonstrativa fixa; substituir por serviço de CEP no backend.
  return { street: 'Rua de Demonstração', district: 'Centro', city: 'São Paulo', region: 'SP' };
}
export function platformRecord(id: string, kind: string, title: string, fields: Record<string, string> = {}, amount = 0): OperationalRecord {
  if (!kind.startsWith('admin-')) throw new Error('Registros da plataforma devem usar o prefixo admin-.');
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Valor inválido.');
  const date = new Date().toISOString();
  return { id, tenantId: 'platform', branchId: '', kind, title: required(title, 'Título'), status: 'Aberto', customerId: '', date, amount, fields, items: [], history: [{ date, text: 'Criado na demonstração local.' }] };
}
