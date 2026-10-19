import { afterEach, describe, expect, test, vi } from 'vitest';

const { invoke, assign } = vi.hoisted(() => ({ invoke: vi.fn(), assign: vi.fn() }));
vi.mock('./client', () => ({ supabase: { functions: { invoke } } }));
import { checkoutUrl, invitationUrl, invoiceRequestId, openInvoiceCheckout } from './Settings';

const invoiceId = 'e9ed4e31-50c2-4770-b80f-8f643a36a4c3';
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });

describe('configurações reais: limites de confiança', () => {
  test('reutiliza chave da intenção após repetição; separa empresa, plano e período', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } as Storage;
    const first = invoiceRequestId('empresa-a:mensal', storage);
    expect(invoiceRequestId('empresa-a:mensal', storage)).toBe(first);
    expect(invoiceRequestId('empresa-b:mensal', storage)).not.toBe(first);
    expect(invoiceRequestId('empresa-a:anual', storage)).not.toBe(first);
  });

  test('falha fechada se não consegue persistir a chave, sem criar novas tentativas', () => {
    const storage = { getItem: () => null, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(() => invoiceRequestId('tenant', storage)).toThrow('Nenhuma nova fatura');
    vi.stubGlobal('window', Object.defineProperty({}, 'sessionStorage', { get() { throw new Error('blocked'); } }));
    expect(() => invoiceRequestId('tenant')).toThrow('Nenhuma nova fatura');
  });

  test('checkout rejeita esquemas inseguros, URLs relativas e credenciais', () => {
    expect(checkoutUrl('https://checkout.example.test/pay')).toBe('https://checkout.example.test/pay');
    for (const value of ['http://example.test', 'javascript:alert(1)', '//example.test', '/pay', 'https://user:password@example.test', null]) {
      expect(() => checkoutUrl(value)).toThrow();
    }
  });

  test('convite aceita somente token opaco válido em origem HTTPS, sem interpolação de caminho', () => {
    const token = 'a'.repeat(48);
    expect(invitationUrl('https://app.example.test', token)).toBe(`https://app.example.test/app/convite/${token}`);
    for (const bad of ['../admin', '//evil.test', `${token}?x=1`, '', null]) expect(() => invitationUrl('https://app.example.test', bad)).toThrow();
    expect(() => invitationUrl('http://app.example.test', token)).toThrow();
  });

  test('checkout só chama função explicitamente com invoiceId e retorna awaiting', async () => {
    vi.stubGlobal('window', { location: { assign } });
    expect(invoke).not.toHaveBeenCalled();
    invoke.mockResolvedValue({ data: { url: 'https://checkout.example.test/pay' }, error: null });
    await expect(openInvoiceCheckout(invoiceId)).resolves.toBe('awaiting');
    expect(invoke).toHaveBeenCalledWith('billing-checkout', { body: { invoiceId } });
    expect(assign).toHaveBeenCalledWith('https://checkout.example.test/pay');
  });

  test('awaiting não redireciona; falha e URL inválida nunca redirecionam', async () => {
    vi.stubGlobal('window', { location: { assign } });
    invoke.mockResolvedValueOnce({ data: { status: 'awaiting', url: null }, error: null });
    await expect(openInvoiceCheckout(invoiceId)).resolves.toBe('awaiting');
    invoke.mockResolvedValueOnce({ data: { url: 'javascript:alert(1)' }, error: null });
    await expect(openInvoiceCheckout(invoiceId)).rejects.toThrow();
    invoke.mockResolvedValueOnce({ data: null, error: new Error('unavailable') });
    await expect(openInvoiceCheckout(invoiceId)).rejects.toThrow('permanece sem confirmação');
    await expect(openInvoiceCheckout('invalid')).rejects.toThrow();
    expect(invoke).toHaveBeenCalledTimes(3);
    expect(assign).not.toHaveBeenCalled();
  });
});
