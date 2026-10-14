import { describe, expect, it } from 'vitest';
import { cashExpected, cents, csvSafe, inPeriod, matches, parseCsv, sumItems } from './logic';
import { configs } from './record-config';

describe('ERP helpers', () => {
  it('parses BRL exactly, rejects invalid or unsafe amounts', () => {
    expect(cents('1.234,56')).toBe(123456);
    expect(cents('1234.56')).toBe(123456);
    expect(cents('0,01')).toBe(1);
    expect(cents('R$ 10,50')).toBe(1050);
    for (const value of ['-1', 'NaN', 'Infinity', '1e3', '0.001', '', '1,2,3', '900719925474099100']) expect(() => cents(value)).toThrow();
  });
  it('imports escaped quotes, delimiters, CRLF and multiline fields', () => {
    expect(parseCsv('﻿name;sku;description\r\n"Filtro; óleo";A1;"Linha 1\nLinha ""2"""\r\n')).toEqual([{ name: 'Filtro; óleo', sku: 'A1', description: 'Linha 1\nLinha "2"' }]);
    expect(parseCsv('name,sku\nÓleo,A2')).toEqual([{ name: 'Óleo', sku: 'A2' }]);
    for (const text of ['name,name\na,b', 'name,sku\n"a,b', 'name,sku\na,b,c', ',sku\na,b', 'name,sku\n"a"x,b']) expect(() => parseCsv(text)).toThrow();
  });
  it('neutralizes spreadsheet formulas without changing numeric values', () => {
    expect(csvSafe([{ formula: '=HYPERLINK("https://example.com")', tab: '\t+1', negative: -10, name: 'Filtro' }])).toEqual([{ formula: '\'=HYPERLINK("https://example.com")', tab: "'\t+1", negative: -10, name: 'Filtro' }]);
  });
  it('does not count cash payments twice', () => {
    expect(cashExpected({ id: 'cash', tenantId: 'tenant', branchId: 'branch', openedAt: '2026-10-14', opening: 10000, movements: [{ id: 'a', date: '2026-10-14', amount: 2500, reason: 'Venda' }, { id: 'b', date: '2026-10-14', amount: -1000, reason: 'Sangria' }] })).toBe(11500);
  });
  it('matches accents and inclusive date boundaries', () => {
    expect(matches('oleo', 'Óleo sintético')).toBe(true);
    expect(inPeriod('2026-10-14T14:00:00.000Z', '2026-10-14', '2026-10-14')).toBe(true);
    expect(inPeriod('2026-10-13', '2026-10-14', '')).toBe(false);
    expect(sumItems([{ productId: 'a', name: 'Filtro', quantity: 3, price: 1990, cost: 1000 }])).toBe(5970);
  });
  it('defines domain-specific forms for every operational module', () => {
    const modules = ['categorias', 'aplicacoes', 'crm', 'veiculos', 'orcamentos', 'ordens-servico', 'agenda', 'compras', 'fornecedores', 'automacoes', 'funcionarios', 'filiais', 'notificacoes', 'tarefas', 'garantias'];
    for (const module of modules) {
      expect(configs[module].fields.length).toBeGreaterThan(0);
      expect(configs[module].statuses.length).toBeGreaterThan(1);
      expect(new Set(configs[module].fields.map(field => field.key)).size).toBe(configs[module].fields.length);
    }
    expect(configs['ordens-servico'].statuses).toContain('Em execução');
    expect(configs.compras.items).toBe(true);
    expect(configs.veiculos.customer).toBe(true);
  });
});
