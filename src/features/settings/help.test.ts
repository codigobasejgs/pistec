import { describe, expect, test } from 'vitest';
import { nav } from '../../navigation';
import { articles, searchHelp } from './help';

describe('Central de ajuda', () => {
  test.each([
    ['vender', 'vender'], ['troco', 'vender'], ['peça', 'produtos'],
    ['abrir caixa', 'abrir-caixa'], ['fechar caixa', 'fechar-caixa'],
    ['baixa', 'baixa-parcial'], ['importar', 'importacao'], ['cores', 'cores'],
    ['funcionário', 'funcionario'], ['plano', 'assinatura'],
    ['orçamento', 'orcamento'], ['consertar moto', 'oficina'],
  ])('%s encontra orientação relevante', (query, id) => {
    expect(searchHelp(query).map(article => article.id)).toContain(id);
  });
  test('normaliza caixa, acentos compostos e espaços', () => {
    expect(searchHelp('  FUNCIONARIO  ')).toEqual(searchHelp('funcionário'));
    expect(searchHelp('peça')).toEqual(searchHelp('PEÇA'));
    expect(searchHelp('CONCERTAR')).toEqual([]);
    expect(searchHelp('  fechar   CAIXA ')).toEqual(searchHelp('fechar caixa'));
    expect(searchHelp('')).toEqual(articles);
    expect(searchHelp('   ')).toEqual(articles);
    expect(searchHelp('inexistente-xyz')).toEqual([]);
  });
  test('todos os artigos têm palavras-chave, IDs únicos e rotas reais', () => {
    expect(new Set(articles.map(article => article.id)).size).toBe(articles.length);
    for (const article of articles) {
      expect(article.keywords.length).toBeGreaterThan(0);
      expect(nav.some(item => item.path === article.module)).toBe(true);
      expect(article.title.trim()).not.toBe('');
      expect(article.text.trim()).not.toBe('');
    }
  });
  test('explica limitações reais de impressão, acesso e PWA', () => {
    expect(articles.find(article => article.id === 'orcamento')?.text).toContain('não oferece impressão dedicada');
    expect(articles.find(article => article.id === 'funcionario')?.text).toContain('não cria credenciais');
    expect(articles.find(article => article.id === 'pwa')?.text).toContain('Compartilhar > Adicionar à Tela de Início > Adicionar');
  });
});
