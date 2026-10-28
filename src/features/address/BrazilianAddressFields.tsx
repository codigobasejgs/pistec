import { useEffect, useRef, useState } from 'react';
import { CircleCheck, CircleAlert, Loader2, MapPin, Search } from 'lucide-react';
import { Field } from '../../ui';
import { CEP_MESSAGES, CepError, cepDigits, lookupCep, maskCep, UFS, type Address, type CepAddress } from '../../services/address';

type Auto = 'street' | 'district' | 'city' | 'state';
const AUTO: Auto[] = ['street', 'district', 'city', 'state'];
type Status = { tone: 'info' | 'ok' | 'warn' | 'error'; text: string } | null;

/**
 * Endereço brasileiro com consulta real de CEP (ViaCEP → BrasilAPI).
 * Consulta sozinha ao completar 8 dígitos (com pausa), cancela consultas antigas e nunca sobrescreve
 * número, complemento ou o que a pessoa digitou: nesse caso pergunta antes de trocar.
 */
export default function BrazilianAddressFields({ value, onChange, errors = {}, disabled, required = true, legend = 'Endereço' }: {
  value: Address; onChange: (next: Address) => void; errors?: Partial<Record<keyof Address, string>>; disabled?: boolean; required?: boolean; legend?: string }) {
  const [status, setStatus] = useState<Status>(null), [loading, setLoading] = useState(false), [note, setNote] = useState('');
  const [offer, setOffer] = useState<{ fields: Partial<Address>; message: string } | null>(null);
  // Campos preenchidos pela consulta (e não alterados depois): podem ser trocados por uma nova consulta.
  const auto = useRef<Partial<Record<Auto, string>>>({});
  const latest = useRef(value); latest.current = value;
  const ctrl = useRef<AbortController | null>(null), looked = useRef('');
  const number = useRef<HTMLInputElement>(null), street = useRef<HTMLInputElement>(null);
  const cep = cepDigits(value.zip);

  const set = (key: keyof Address, v: string) => {
    if ((AUTO as string[]).includes(key) && auto.current[key as Auto] !== v) delete auto.current[key as Auto];
    onChange({ ...latest.current, [key]: v });
  };

  const apply = (found: CepAddress, complete: boolean) => {
    const cur = latest.current, next: Address = { ...cur, zip: maskCep(found.zip) }, conflicts: Partial<Address> = {};
    for (const k of AUTO) {
      const mine = cur[k].trim(), theirs = found[k];
      // Vazio ou preenchido pela consulta anterior: troca (mesmo por vazio, para não sobrar dado de outro CEP).
      if (!mine || auto.current[k] === cur[k]) { next[k] = theirs; if (theirs) auto.current[k] = theirs; else delete auto.current[k]; }
      else if (theirs && mine.toLocaleLowerCase('pt-BR') !== theirs.toLocaleLowerCase('pt-BR')) conflicts[k] = theirs;
    }
    onChange(next);
    setNote(found.note ? `Referência dos Correios: ${found.note}` : '');
    const kept = Object.keys(conflicts).length;
    if (kept) setOffer({ fields: conflicts, message: `O CEP indica ${[conflicts.street, conflicts.district, conflicts.city && `${conflicts.city}/${conflicts.state ?? next.state}`].filter(Boolean).join(', ')}. Mantivemos o que você digitou.` });
    setStatus(complete ? { tone: 'ok', text: CEP_MESSAGES.found } : { tone: 'warn', text: CEP_MESSAGES.partial });
    // Foco no próximo campo útil: logradouro se o CEP não trouxe rua; senão número (se ainda vazio).
    const focus = !next.street ? street : !next.number ? number : null;
    if (focus) requestAnimationFrame(() => focus.current?.focus());
  };

  const run = async (force = false) => {
    const target = cepDigits(latest.current.zip);
    if (target.length !== 8) { setStatus({ tone: 'error', text: CEP_MESSAGES.invalid }); return; }
    if (!force && looked.current === target) return;
    ctrl.current?.abort(); const c = new AbortController(); ctrl.current = c; looked.current = target;
    setLoading(true); setOffer(null); setStatus({ tone: 'info', text: 'Consultando CEP…' });
    try {
      const r = await lookupCep(target, { signal: c.signal });
      // Resposta de um CEP que já não é o do formulário é descartada.
      if (c.signal.aborted || cepDigits(latest.current.zip) !== target) return;
      apply(r.address, r.complete);
    } catch (e) {
      if (c.signal.aborted || cepDigits(latest.current.zip) !== target) return;
      looked.current = e instanceof CepError && e.kind === 'not_found' ? target : '';
      setStatus({ tone: 'error', text: e instanceof CepError ? e.message : CEP_MESSAGES.unavailable });
    } finally { if (ctrl.current === c) setLoading(false); }
  };
  const runRef = useRef(run); runRef.current = run;

  // Consulta automática com pausa curta após o 8º dígito; trocar o CEP cancela a anterior.
  useEffect(() => {
    if (cep.length !== 8) { ctrl.current?.abort(); setLoading(false); looked.current = ''; return; }
    const t = setTimeout(() => void runRef.current(), 450);
    return () => clearTimeout(t);
  }, [cep]);
  useEffect(() => () => ctrl.current?.abort(), []);

  const Icon = loading ? Loader2 : status?.tone === 'ok' ? CircleCheck : status?.tone === 'error' || status?.tone === 'warn' ? CircleAlert : MapPin;
  return <fieldset className="address-fields" disabled={disabled}>
    <legend>{legend}</legend>
    <div className="address-cep">
      <Field label="CEP" hint={errors.zip ? undefined : 'Digite o CEP; buscamos o endereço automaticamente.'} error={errors.zip}>
        <input value={maskCep(value.zip)} inputMode="numeric" autoComplete="postal-code" maxLength={9} required={required} placeholder="00000-000" aria-describedby="address-status"
          onChange={e => { setStatus(null); setOffer(null); set('zip', maskCep(e.target.value)); }} onBlur={() => { if (cep.length > 0 && cep.length < 8) setStatus({ tone: 'error', text: CEP_MESSAGES.invalid }); }}/>
      </Field>
      <button type="button" className="btn address-lookup" onClick={() => void run(true)} disabled={loading}>{loading ? <Loader2 size={16} className="spin" aria-hidden="true"/> : <Search size={16} aria-hidden="true"/>}Consultar endereço</button>
    </div>
    <p id="address-status" className={`address-status ${status?.tone ?? ''}`} role="status" aria-live="polite">{status && <><Icon size={16} aria-hidden="true" className={loading ? 'spin' : undefined}/>{status.text}</>}</p>
    {offer && <div className="address-offer" role="group" aria-label="Endereço sugerido pelo CEP"><span>{offer.message}</span>
      <button type="button" className="btn" onClick={() => { const n = { ...latest.current, ...offer.fields }; for (const k of AUTO) if (offer.fields[k]) auto.current[k] = offer.fields[k]; onChange(n); setOffer(null); }}>Usar endereço do CEP</button>
      <button type="button" className="btn ghost" onClick={() => setOffer(null)}>Manter o meu</button></div>}
    <div className="form-grid address-grid">
      <Field label="Logradouro" error={errors.street}><input ref={street} value={value.street} maxLength={160} required={required} autoComplete="address-line1" onChange={e => set('street', e.target.value)}/></Field>
      <Field label="Número" hint={errors.number ? undefined : 'Use S/N se não houver.'} error={errors.number}><input ref={number} value={value.number} maxLength={20} required={required} autoComplete="address-line2" onChange={e => set('number', e.target.value)}/></Field>
      <Field label="Complemento (opcional)" hint={note || undefined}><input value={value.complement} maxLength={80} onChange={e => set('complement', e.target.value)}/></Field>
      <Field label="Bairro" error={errors.district}><input value={value.district} maxLength={160} required={required} autoComplete="address-level3" onChange={e => set('district', e.target.value)}/></Field>
      <Field label="Cidade" error={errors.city}><input value={value.city} maxLength={160} required={required} autoComplete="address-level2" onChange={e => set('city', e.target.value)}/></Field>
      <Field label="UF" error={errors.state}><select value={value.state} required={required} autoComplete="address-level1" onChange={e => set('state', e.target.value)}><option value="">Selecione</option>{UFS.map(uf => <option key={uf} value={uf}>{uf}</option>)}</select></Field>
    </div>
  </fieldset>;
}
