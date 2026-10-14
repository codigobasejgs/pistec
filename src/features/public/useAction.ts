import { useRef, useState, type FormEvent } from 'react';
import { useNotice } from '../../ui';
import { validateAll } from './model';

export function useAction() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const notice = useNotice();
  async function run(action: () => void | Promise<void>, message = 'Alterações salvas.') {
    if (busy.current) return;
    busy.current = true; setPending(true); setError('');
    try { await action(); notice(message); }
    catch (cause) { const text = cause instanceof Error ? cause.message : 'Não foi possível salvar. Tente novamente.'; setError(text); notice(text); }
    finally { busy.current = false; setPending(false); }
  }
  return { pending, error, run, reset: () => setError('') };
}

/** Erros por campo. check() lança para o useAction exibir o aviso geral; onInput limpa o campo editado. */
export function useFieldErrors() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  function check<T extends Record<string, () => unknown>>(rules: T) {
    const result = validateAll(rules);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) throw new Error('Revise os campos destacados.');
    return result.values;
  }
  const clear = (name: string) => setErrors(current => { if (!current[name]) return current; const next = { ...current }; delete next[name]; return next; });
  const onInput = (event: FormEvent<HTMLFormElement>) => { const name = (event.target as HTMLInputElement).name; if (name) clear(name); };
  return { errors, setErrors, check, clear, onInput, reset: () => setErrors({}) };
}
