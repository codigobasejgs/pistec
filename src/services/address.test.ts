import { beforeEach, describe, expect, test } from 'vitest';
import { addressErrors, CepError, formatAddress, lookupCep, maskCep, resetCepCache, toAddress } from './address';

// Respostas copiadas de consultas reais (28/10/2026) aos dois serviços.
const VIACEP_SE = { cep: '01001-000', logradouro: 'Praça da Sé', complemento: 'lado ímpar', bairro: 'Sé', localidade: 'São Paulo', uf: 'SP', ibge: '3550308' };
const VIACEP_GENERIC = { cep: '78175-000', logradouro: '', complemento: '', bairro: '', localidade: 'Poconé', uf: 'MT', ibge: '5106505' };
const BRASILAPI_SE = { cep: '01001000', state: 'SP', city: 'São Paulo', neighborhood: 'Sé', street: 'Praça da Sé', service: 'open-cep', ibge: { city: '3550308', state: '35' } };

type Reply = { status: number; body?: unknown } | 'network' | 'hang';
function fake(routes: Record<string, Reply>) {
  const calls: string[] = [];
  const fetcher = (url: string, init: { signal: AbortSignal }) => {
    calls.push(url);
    const host = new URL(url).hostname, r = routes[host] ?? 'network';
    if (r === 'network') return Promise.reject(new TypeError('Failed to fetch'));
    if (r === 'hang') return new Promise<never>((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    return Promise.resolve({ ok: r.status < 400, status: r.status, json: () => Promise.resolve(r.body) });
  };
  return { fetcher, calls };
}

beforeEach(resetCepCache);

describe('consulta de CEP', () => {
  test('CEP com e sem máscara consulta os mesmos 8 dígitos e preenche só o que veio', async () => {
    for (const input of ['01001-000', '01001000']) {
      resetCepCache();
      const { fetcher, calls } = fake({ 'viacep.com.br': { status: 200, body: VIACEP_SE } });
      const r = await lookupCep(input, { fetcher });
      expect(calls).toEqual(['https://viacep.com.br/ws/01001000/json/']);
      expect(r).toMatchObject({ source: 'viacep', complete: true, address: { zip: '01001000', street: 'Praça da Sé', district: 'Sé', city: 'São Paulo', state: 'SP', ibge: '3550308' } });
      expect(r.address).not.toHaveProperty('number');
    }
  });

  test('CEP incompleto não chama a rede', async () => {
    const { fetcher, calls } = fake({});
    await expect(lookupCep('01001', { fetcher })).rejects.toMatchObject({ kind: 'invalid' });
    expect(calls).toEqual([]);
  });

  test('CEP inexistente no ViaCEP não cai no fallback (BrasilAPI devolve endereço para 99999-999)', async () => {
    const { fetcher, calls } = fake({ 'viacep.com.br': { status: 200, body: { erro: 'true' } }, 'brasilapi.com.br': { status: 200, body: { ...BRASILAPI_SE, cep: '99999999', city: 'Sarandi', state: 'PR' } } });
    await expect(lookupCep('99999-999', { fetcher })).rejects.toMatchObject({ kind: 'not_found', message: 'Não encontramos este CEP. Confira os números informados.' });
    expect(calls).toHaveLength(1);
  });

  test('ViaCEP fora do ar: usa BrasilAPI', async () => {
    const { fetcher, calls } = fake({ 'viacep.com.br': 'network', 'brasilapi.com.br': { status: 200, body: BRASILAPI_SE } });
    const r = await lookupCep('01001000', { fetcher });
    expect(r.source).toBe('brasilapi');
    expect(r.address).toMatchObject({ street: 'Praça da Sé', city: 'São Paulo', state: 'SP' });
    expect(calls).toEqual(['https://viacep.com.br/ws/01001000/json/', 'https://brasilapi.com.br/api/cep/v2/01001000']);
  });

  test('ViaCEP com timeout ou HTTP 500 também cai na BrasilAPI', async () => {
    const hang = fake({ 'viacep.com.br': 'hang', 'brasilapi.com.br': { status: 200, body: BRASILAPI_SE } });
    expect((await lookupCep('01001000', { fetcher: hang.fetcher, timeout: 30 })).source).toBe('brasilapi');
    resetCepCache();
    const err = fake({ 'viacep.com.br': { status: 500 }, 'brasilapi.com.br': { status: 200, body: BRASILAPI_SE } });
    expect((await lookupCep('01001000', { fetcher: err.fetcher })).source).toBe('brasilapi');
  });

  test('ViaCEP fora do ar e BrasilAPI 404: CEP inexistente', async () => {
    const { fetcher } = fake({ 'viacep.com.br': 'network', 'brasilapi.com.br': { status: 404, body: { type: 'service_error' } } });
    await expect(lookupCep('99999990', { fetcher })).rejects.toMatchObject({ kind: 'not_found' });
  });

  test('os dois fora do ar: erro amigável para preencher manualmente', async () => {
    const { fetcher } = fake({});
    const e = await lookupCep('01001000', { fetcher }).catch(x => x);
    expect(e).toBeInstanceOf(CepError);
    expect(e.message).toBe('Não foi possível consultar o CEP agora. Tente novamente ou preencha o endereço manualmente.');
  });

  test('resposta inválida (CEP trocado, UF inválida, HTML) não é sucesso', async () => {
    for (const body of [{ ...VIACEP_SE, cep: '02002-000' }, { ...VIACEP_SE, uf: 'XX' }, { ...VIACEP_SE, localidade: '' }, '<html>']) {
      resetCepCache();
      const { fetcher } = fake({ 'viacep.com.br': { status: 200, body }, 'brasilapi.com.br': 'network' });
      await expect(lookupCep('01001000', { fetcher })).rejects.toMatchObject({ kind: 'unavailable' });
    }
  });

  test('CEP genérico: só cidade e UF, sem inventar logradouro ou bairro', async () => {
    const { fetcher } = fake({ 'viacep.com.br': { status: 200, body: VIACEP_GENERIC } });
    const r = await lookupCep('78175-000', { fetcher });
    expect(r.complete).toBe(false);
    expect(r.address).toMatchObject({ street: '', district: '', city: 'Poconé', state: 'MT' });
  });

  test('cancelamento pelo chamador interrompe sem tentar o fallback', async () => {
    const { fetcher, calls } = fake({ 'viacep.com.br': 'hang', 'brasilapi.com.br': { status: 200, body: BRASILAPI_SE } });
    const ctrl = new AbortController();
    const p = lookupCep('01001000', { fetcher, signal: ctrl.signal });
    ctrl.abort();
    await expect(p).rejects.toThrow();
    expect(calls).toHaveLength(1);
  });

  test('cache evita consultas repetidas; limite por minuto bloqueia excesso', async () => {
    const { fetcher, calls } = fake({ 'viacep.com.br': { status: 200, body: VIACEP_SE } });
    await lookupCep('01001000', { fetcher }); await lookupCep('01001-000', { fetcher });
    expect(calls).toHaveLength(1);
    const many = fake({ 'viacep.com.br': { status: 200, body: { erro: true } } });
    let blocked = 0;
    for (let i = 0; i < 25; i++) await lookupCep(String(10000000 + i), { fetcher: many.fetcher }).catch((e: CepError) => { if (e.kind === 'unavailable') blocked++; });
    expect(blocked).toBeGreaterThan(0);
    expect(many.calls.length).toBeLessThanOrEqual(20);
  });
});

describe('validação e formatação', () => {
  const a = { zip: '01001-000', street: 'Praça da Sé', number: '100', complement: 'Sala 2', district: 'Sé', city: 'São Paulo', state: 'SP' };
  test('endereço completo passa; faltas viram mensagens por campo', () => {
    expect(addressErrors(a)).toEqual({});
    expect(addressErrors({ ...a, zip: '0100', number: ' ', state: 'XX' })).toEqual({ zip: 'Informe um CEP com 8 números.', number: 'Informe o número (ou S/N).', state: 'Selecione a UF.' });
  });
  test('formatação e normalização', () => {
    expect(formatAddress(a)).toBe('Praça da Sé, 100, Sala 2, Sé, São Paulo/SP, CEP 01001-000');
    expect(maskCep('01001000')).toBe('01001-000');
    expect(toAddress({ zip: '01001000', street: ' Rua X ', state: 'sp' })).toEqual({ zip: '01001-000', street: 'Rua X', number: '', complement: '', district: '', city: '', state: 'SP' });
    expect(toAddress(null).zip).toBe('');
  });
});
