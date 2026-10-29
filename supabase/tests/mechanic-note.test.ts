import { expect, test } from 'vitest';
import { validateNote } from '../functions/_shared/mechanic';

test('Mecânico IA: descarta peças fora do catálogo, quantidades inválidas e campos excedentes', () => {
  const note = validateNote({ transcript: ' Troquei o óleo ', summary: 'Óleo trocado', servicesDone: ['Troca de óleo', 3], recommendations: ['Avaliar pastilha dianteira'],
    parts: [{ productId: 'p1', quantity: 1 }, { productId: 'fora', quantity: 1 }, { productId: 'p1', quantity: 0 }, { productId: 'p1', quantity: 1.5 }], uncertain: ['Torque citado sem fonte'], extra: 'x' },
    [{ id: 'p1', name: 'Óleo 10W30' }]);
  expect(note.parts).toEqual([{ productId: 'p1', name: 'Óleo 10W30', quantity: 1 }]);
  expect(note.servicesDone).toEqual(['Troca de óleo']);
  expect(note.transcript).toBe('Troquei o óleo');
  expect(Object.keys(note)).not.toContain('extra');
  expect(() => validateNote('texto', [])).toThrow(/formato/);
});
