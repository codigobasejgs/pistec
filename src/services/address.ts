// Consulta de CEP real: ViaCEP (principal) e BrasilAPI (só quando o ViaCEP está indisponível).
// Nunca inventa endereço: CEP inexistente no ViaCEP não cai no fallback, e campos ausentes ficam vazios.

export type Address = { zip: string; street: string; number: string; complement: string; district: string; city: string; state: string };
export type CepAddress = Pick<Address, 'zip' | 'street' | 'district' | 'city' | 'state'> & { ibge: string; note: string };
export type CepResult = { address: CepAddress; complete: boolean; source: 'viacep' | 'brasilapi' };
export class CepError extends Error {
  constructor(readonly kind: 'invalid' | 'not_found' | 'unavailable') { super(CEP_MESSAGES[kind]); this.name = 'CepError'; }
}

export const CEP_MESSAGES = {
  invalid: 'Informe um CEP com 8 números.',
  not_found: 'Não encontramos este CEP. Confira os números informados.',
  unavailable: 'Não foi possível consultar o CEP agora. Tente novamente ou preencha o endereço manualmente.',
  found: 'Endereço localizado! Confira os dados e informe o número.',
  partial: 'Localizamos a cidade e o estado. Complete as demais informações do endereço.',
} as const;

export const UFS = ['AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT', 'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO'] as const;
export const emptyAddress: Address = { zip: '', street: '', number: '', complement: '', district: '', city: '', state: '' };
export const cepDigits = (v: string) => v.replace(/\D/g, '').slice(0, 8);
export const maskCep = (v: string) => cepDigits(v).replace(/^(\d{5})(\d)/, '$1-$2');

type Fetch = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
type Provider = { name: CepResult['source']; url: (cep: string) => string; parse: (cep: string, status: number, body: unknown) => CepAddress | 'not_found' | null };

const text = (v: unknown, max = 160) => typeof v === 'string' ? v.trim().slice(0, max) : '';
// Resposta só vale se o CEP bate com o pedido e há cidade + UF válidas; senão é tratada como falha do serviço.
function valid(cep: string, a: CepAddress) { return a.zip === cep && a.city !== '' && (UFS as readonly string[]).includes(a.state) ? a : null; }

// Destinos fixos (HTTPS, sem URL vinda do usuário): só o CEP de 8 dígitos entra no caminho.
const PROVIDERS: Provider[] = [
  { name: 'viacep', url: cep => `https://viacep.com.br/ws/${cep}/json/`, parse: (cep, status, b) => {
    if (status !== 200 || !b || typeof b !== 'object') return null;
    const o = b as Record<string, unknown>;
    if (o.erro === true || o.erro === 'true') return 'not_found';
    return valid(cep, { zip: cepDigits(text(o.cep)), street: text(o.logradouro), district: text(o.bairro), city: text(o.localidade), state: text(o.uf, 2), ibge: text(o.ibge, 7), note: text(o.complemento, 120) });
  } },
  { name: 'brasilapi', url: cep => `https://brasilapi.com.br/api/cep/v2/${cep}`, parse: (cep, status, b) => {
    if (status === 404) return 'not_found';
    if (status !== 200 || !b || typeof b !== 'object') return null;
    const o = b as Record<string, unknown>, ibge = o.ibge as Record<string, unknown> | undefined;
    return valid(cep, { zip: cepDigits(text(o.cep)), street: text(o.street), district: text(o.neighborhood), city: text(o.city), state: text(o.state, 2), ibge: text(ibge?.city, 7), note: '' });
  } },
];

// ponytail: cache e limite só em memória por aba; mover para o backend se um dia houver abuso real.
const cache = new Map<string, CepResult | 'not_found'>();
const recent: number[] = [];
const LIMIT = 20, WINDOW = 60_000;

/** Consulta o CEP. Lança CepError (invalid | not_found | unavailable) ou o AbortError do chamador. */
export async function lookupCep(input: string, { signal, fetcher = fetch as unknown as Fetch, timeout = 5000 }: { signal?: AbortSignal; fetcher?: Fetch; timeout?: number } = {}): Promise<CepResult> {
  const cep = input.replace(/\D/g, '');
  if (cep.length !== 8) throw new CepError('invalid');
  const hit = cache.get(cep);
  if (hit === 'not_found') throw new CepError('not_found');
  if (hit) return hit;
  const now = Date.now(); while (recent.length && now - recent[0] > WINDOW) recent.shift();
  if (recent.length >= LIMIT) throw new CepError('unavailable');
  recent.push(now);
  for (const p of PROVIDERS) {
    const attempt = signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    let parsed: CepAddress | 'not_found' | null = null;
    try {
      const r = await fetcher(p.url(cep), { signal: attempt, headers: { Accept: 'application/json' } });
      parsed = p.parse(cep, r.status, r.status === 200 ? await r.json().catch(() => null) : null);
    } catch (e) { if (signal?.aborted) throw e; /* timeout ou rede: tenta o próximo */ }
    if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    // CEP inexistente no serviço principal é resposta definitiva: não procurar "algum" endereço no fallback.
    if (parsed === 'not_found') { cache.set(cep, 'not_found'); throw new CepError('not_found'); }
    if (parsed) { const result = { address: parsed, complete: !!(parsed.street && parsed.district), source: p.name }; cache.set(cep, result); return result; }
  }
  throw new CepError('unavailable');
}

/** Apenas para testes: limpa cache e limite. */
export function resetCepCache() { cache.clear(); recent.length = 0; }

export const hasAddress = (a: Partial<Address>) => Object.values(a).some(v => typeof v === 'string' && v.trim() !== '');

/** Erros de preenchimento (mensagens curtas, por campo). */
export function addressErrors(a: Address): Partial<Record<keyof Address, string>> {
  const e: Partial<Record<keyof Address, string>> = {};
  if (cepDigits(a.zip).length !== 8) e.zip = CEP_MESSAGES.invalid;
  if (!a.street.trim()) e.street = 'Informe o logradouro.';
  if (!a.number.trim()) e.number = 'Informe o número (ou S/N).';
  if (!a.district.trim()) e.district = 'Informe o bairro.';
  if (!a.city.trim()) e.city = 'Informe a cidade.';
  if (!(UFS as readonly string[]).includes(a.state)) e.state = 'Selecione a UF.';
  return e;
}

export function formatAddress(a: Address) {
  return `${a.street.trim()}, ${a.number.trim()}${a.complement.trim() ? `, ${a.complement.trim()}` : ''}, ${a.district.trim()}, ${a.city.trim()}/${a.state}, CEP ${maskCep(a.zip)}`;
}

/** Normaliza um objeto vindo do banco/armazenamento para Address (campos ausentes = ''). */
export function toAddress(v: unknown): Address {
  const o = v && typeof v === 'object' ? v as Record<string, unknown> : {};
  return { zip: maskCep(text(o.zip, 9)), street: text(o.street), number: text(o.number, 20), complement: text(o.complement, 80), district: text(o.district), city: text(o.city), state: text(o.state, 2).toUpperCase() };
}
