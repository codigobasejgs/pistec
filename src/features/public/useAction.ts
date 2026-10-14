import { useRef, useState } from 'react';
import { useNotice } from '../../ui';

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
  return { pending, error, run };
}
