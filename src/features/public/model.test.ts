import { expect, test } from 'vitest';
import { email, mockCEP, planPrice, platformRecord } from './model';
import type { Plan } from '../../types';

test('model: preço, validação e registros platform', () => {
  const plan = { monthly: 12900, quarterly: 34900, annual: 123900 } as Plan;
  expect(planPrice(plan, 'annual')).toEqual({ total: 123900, monthly: 10325 });
  expect(planPrice(plan, 'quarterly').monthly).toBe(11633);
  expect(() => planPrice({ ...plan, monthly: -1 }, 'monthly')).toThrow();
  expect(email(' A@B.co ')).toBe('a@b.co');
  expect(() => email('x@')).toThrow();
  expect(mockCEP('01310-100').city).toBe('São Paulo');
  expect(() => mockCEP('123')).toThrow();
  const r = platformRecord('1', 'admin-lead', 'Ana', { email: 'a@b.co' });
  expect(r.tenantId).toBe('platform');
  expect(() => platformRecord('2', 'lead', 'x')).toThrow();
});
