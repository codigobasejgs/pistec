import type { Coupon, OperationalRecord, Plan } from '../../types';
import { money } from '../../lib';

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
/** Economia (%) do período frente a pagar o mensal pelo mesmo número de meses. */
export function planSavings(plan: Plan, period: Period) {
  const full = plan.monthly * periods[period].months;
  return full > 0 && plan[period] < full ? Math.round((1 - plan[period] / full) * 100) : 0;
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
export function platformRecord(id: string, kind: string, title: string, fields: Record<string, string> = {}, amount = 0): OperationalRecord {
  if (!kind.startsWith('admin-')) throw new Error('Registros da plataforma devem usar o prefixo admin-.');
  if (!Number.isSafeInteger(amount) || amount < 0) throw new Error('Valor inválido.');
  const date = new Date().toISOString();
  return { id, tenantId: 'platform', branchId: '', kind, title: required(title, 'Título'), status: 'Aberto', customerId: '', date, amount, fields, items: [], history: [{ date, text: 'Criado na demonstração local.' }] };
}

/* Máscaras simples: só formatam dígitos; a validação continua nas regras. */
function pattern(digits: string, mask: string) {
  let i = 0, out = '';
  for (const ch of mask) { if (i >= digits.length) break; out += ch === '0' ? digits[i++] : ch; }
  return out;
}
const onlyDigits = (value: string, max: number) => value.replace(/\D/g, '').slice(0, max);
export const maskDocument = (value: string) => { const d = onlyDigits(value, 14); return d.length <= 11 ? pattern(d, '000.000.000-00') : pattern(d, '00.000.000/0000-00'); };
export const maskPhone = (value: string) => { const d = onlyDigits(value, 11); return d.length <= 10 ? pattern(d, '(00) 0000-0000') : pattern(d, '(00) 00000-0000'); };
export function documentDigits(value: string) {
  const d = value.replace(/\D/g, '');
  if (![11, 14].includes(d.length)) throw new Error('CPF com 11 ou CNPJ com 14 dígitos (dados fictícios).');
  return d;
}
export function phoneDigits(value: string) {
  const d = value.replace(/\D/g, '');
  if (d && ![10, 11].includes(d.length)) throw new Error('Telefone com DDD: 10 ou 11 dígitos.');
  return d;
}

/** Executa todas as regras e devolve valores válidos + mensagem por campo (validação inline). */
export function validateAll<T extends Record<string, () => unknown>>(rules: T) {
  const values = {} as { [K in keyof T]: ReturnType<T[K]> };
  const errors: Record<string, string> = {};
  for (const key in rules) {
    try { values[key] = rules[key]() as ReturnType<T[typeof key]>; }
    catch (cause) { errors[key] = cause instanceof Error ? cause.message : 'Valor inválido.'; }
  }
  return { values, errors };
}
export const formText = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
export function isoDate(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.'); return value; }
export function wholeNumber(value: string, label: string) { const n = Number(value); if (value === '' || !Number.isSafeInteger(n) || n < 0) throw new Error(`${label}: informe um inteiro maior ou igual a zero.`); return n; }

/* Cupons SaaS (exibição). Cálculo oficial é do domínio (couponQuote). */
export function percentToBps(value: string) {
  const text = value.trim();
  const n = Number(text.replace(',', '.'));
  if (!/^\d+([.,]\d{1,2})?$/.test(text) || n <= 0 || n > 100) throw new Error('Percentual entre 0,01 e 100.');
  return Math.round(n * 100);
}
export const couponValueLabel = (coupon: Pick<Coupon, 'kind' | 'value'>) => coupon.kind === 'percent' ? `${(coupon.value / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : money(coupon.value);
export interface QuoteView { ok: boolean; original: number; discount: number; total: number; message: string }
/** Resumo ao vivo do cupom: sem código = valor cheio; erro do domínio vira motivo exibido. */
export function quoteView(original: number, code: string, quote: () => { original: number; discount: number; total: number }): QuoteView {
  if (!code.trim()) return { ok: true, original, discount: 0, total: original, message: 'Sem cupom: valor cheio do plano.' };
  try {
    const q = quote();
    return { ok: true, original: q.original, discount: q.discount, total: q.total, message: `Desconto de ${money(q.discount)} aplicado somente nesta fatura.` };
  } catch (cause) {
    return { ok: false, original, discount: 0, total: original, message: cause instanceof Error ? cause.message : 'Cupom inválido.' };
  }
}
