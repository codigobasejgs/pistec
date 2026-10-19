import { describe, expect, test, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { emptyState, integer, loadRealState } from './read';

describe('leitura real sem snapshot demonstrativo', () => {
  test('estado inicial não contém empresas, produtos ou sessão demo', () => {
    const state = emptyState();
    for (const value of Object.values(state)) if (Array.isArray(value)) expect(value).toEqual([]);
    state.tenants.push({} as never);
    expect(emptyState().tenants).toEqual([]);
  });
  test('centavos não aceitam arredondamento silencioso', () => {
    expect(integer('9007199254740991')).toBe(Number.MAX_SAFE_INTEGER);
    expect(integer('-100')).toBe(-100);
    for (const invalid of ['9007199254740992', 1.5, null, '', true, '1.0', Infinity]) expect(() => integer(invalid)).toThrow();
  });
  test('sem tenant carrega somente catálogo e acesso, sem dados de operações', async () => {
    const tables: string[] = [];
    const client = { from: (table: string) => {
      tables.push(table);
      const builder = { select: () => builder, order: () => builder, range: vi.fn().mockResolvedValue({ data: [], error: null }) };
      return builder;
    } } as unknown as SupabaseClient;
    expect(await loadRealState(client, null)).toEqual(emptyState());
    expect(tables.sort()).toEqual(['branches','plans','tenants']);
  });
  test('erros do servidor não são substituídos por seed', async () => {
    const client = { from: () => {
      const builder = { select: () => builder, order: () => builder, range: vi.fn().mockResolvedValue({ data: null, error: { message: 'Acesso revogado' } }) };
      return builder;
    } } as unknown as SupabaseClient;
    await expect(loadRealState(client, null)).rejects.toThrow('Acesso revogado');
  });
});
