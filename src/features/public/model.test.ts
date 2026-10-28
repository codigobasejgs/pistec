import { describe, expect, test } from 'vitest';
import {
  couponValueLabel, documentDigits, email, maskDocument, maskPhone,
  percentToBps, phoneDigits, planPrice, planSavings, platformRecord, quoteView,
} from './model';
import type { Plan } from '../../types';

describe('model público e SaaS', () => {
  test('preços e economia de planos', () => {
    const plan = { monthly: 12900, quarterly: 34900, annual: 123900 } as Plan;
    expect(planPrice(plan, 'annual')).toEqual({ total: 123900, monthly: 10325 });
    expect(planPrice(plan, 'quarterly').monthly).toBe(11633);
    expect(() => planPrice({ ...plan, monthly: -1 }, 'monthly')).toThrow();
    // 123900 vs 12900 * 12 = 154800 -> 20%
    expect(planSavings(plan, 'annual')).toBe(20);
    expect(planSavings(plan, 'monthly')).toBe(0);
  });

  test('validações de contato e CEP', () => {
    expect(email(' A@B.co ')).toBe('a@b.co');
    expect(() => email('x@')).toThrow();
  });

  test('registros operacionais da plataforma', () => {
    const r = platformRecord('1', 'admin-lead', 'Ana', { email: 'a@b.co' });
    expect(r.tenantId).toBe('platform');
    expect(() => platformRecord('2', 'lead', 'x')).toThrow();
  });

  test('máscaras e validação de dígitos de documentos e telefones', () => {
    expect(maskDocument('12345678901')).toBe('123.456.789-01');
    expect(maskDocument('12345678000199')).toBe('12.345.678/0001-99');
    expect(documentDigits('12.345.678/0001-99')).toBe('12345678000199');
    expect(() => documentDigits('12345')).toThrow();

    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444');
    expect(phoneDigits('(11) 98765-4321')).toBe('11987654321');
    expect(phoneDigits('')).toBe('');
    expect(() => phoneDigits('12345')).toThrow();
  });

  test('cálculo e exibição de cupons SaaS', () => {
    expect(percentToBps('20')).toBe(2000);
    expect(percentToBps('12,5')).toBe(1250);
    expect(() => percentToBps('0')).toThrow();
    expect(() => percentToBps('101')).toThrow();

    expect(couponValueLabel({ kind: 'percent', value: 2000 })).toBe('20%');
    expect(couponValueLabel({ kind: 'percent', value: 1250 })).toBe('12,5%');
    expect(couponValueLabel({ kind: 'fixed', value: 5000 })).toContain('50,00');

    // Simulação do quoteView (como a UI exibe o cálculo do domínio: 24900 com 20% = 4980 de desconto, total 19920)
    const original = 24900;
    const bps = 2000;
    const quoteFn = () => {
      const discount = Math.round((original * bps) / 10000);
      return { original, discount, total: original - discount };
    };
    const view = quoteView(original, 'PROMO20', quoteFn);
    expect(view.ok).toBe(true);
    expect(view.original).toBe(24900);
    expect(view.discount).toBe(4980);
    expect(view.total).toBe(19920);
    expect(view.message).toContain('somente nesta fatura');

    // Sem código = valor original
    const emptyView = quoteView(original, '', quoteFn);
    expect(emptyView.ok).toBe(true);
    expect(emptyView.discount).toBe(0);
    expect(emptyView.total).toBe(24900);

    // Cupom com erro do domínio
    const failingView = quoteView(original, 'INVALIDO', () => { throw new Error('Cupom fora da vigência.'); });
    expect(failingView.ok).toBe(false);
    expect(failingView.discount).toBe(0);
    expect(failingView.total).toBe(24900);
    expect(failingView.message).toBe('Cupom fora da vigência.');
  });
});
