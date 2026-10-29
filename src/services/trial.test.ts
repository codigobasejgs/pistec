import { describe, expect, test } from 'vitest';
import { saoPauloDay, trialDaysLeft, trialEndDay, trialLabel } from './trial';

// Instantes em UTC; o calendário comercial é o de São Paulo (UTC-3, sem horário de verão).
const at = (iso: string) => new Date(iso);

describe('teste gratuito: 1 mês calendário', () => {
  test.each([
    ['2026-10-29T17:00:00Z', '2026-11-29'], // exemplo da política: 29/10 14h → 29/11
    ['2026-11-10T13:00:00Z', '2026-12-10'],
    ['2026-11-01T12:00:00Z', '2026-12-01'], // dia 1
    ['2026-11-15T12:00:00Z', '2026-12-15'], // dia 15
    ['2027-01-28T12:00:00Z', '2027-02-28'], // dia 28
    ['2027-01-29T12:00:00Z', '2027-02-28'], // dia 29 → último dia de fevereiro
    ['2027-01-30T12:00:00Z', '2027-02-28'], // dia 30
    ['2027-01-31T12:00:00Z', '2027-02-28'], // dia 31, ano comum
    ['2028-01-31T12:00:00Z', '2028-02-29'], // ano bissexto
    ['2027-03-31T12:00:00Z', '2027-04-30'], // mês de 30 dias
    ['2026-12-15T12:00:00Z', '2027-01-15'], // virada de ano
    ['2026-12-31T12:00:00Z', '2027-01-31'],
  ])('início %s → termina em %s', (start, end) => expect(trialEndDay(at(start))).toBe(end));

  test('usa o dia de São Paulo, não o de UTC (23h30 em SP já é o dia seguinte em UTC)', () => {
    expect(saoPauloDay(at('2026-11-01T02:30:00Z'))).toBe('2026-10-31');
    expect(trialEndDay(at('2026-11-01T02:30:00Z'))).toBe('2026-11-30');
  });

  test('dias restantes e expiração exata', () => {
    expect(trialDaysLeft('2026-11-29', at('2026-10-29T17:00:00Z'))).toBe(31);
    expect(trialDaysLeft('2026-11-29', at('2026-11-29T23:00:00Z'))).toBe(0); // último dia ainda vale (20h em SP)
    expect(trialDaysLeft('2026-11-29', at('2026-11-30T03:30:00Z'))).toBe(-1); // 00h30 do dia seguinte em SP: encerrado
  });

  test('rótulos e entrada inválida', () => {
    expect(trialLabel(1)).toBe('1 mês grátis'); expect(trialLabel(2)).toBe('2 meses grátis'); expect(trialLabel(0)).toBe('Sem teste gratuito');
    expect(() => trialEndDay(at('2026-10-29T12:00:00Z'), -1)).toThrow();
  });
});
