import { useState } from 'react';
import { Link2, MessageCircle, XCircle } from 'lucide-react';
import { useDemo } from '../../store';
import { useNotice } from '../../ui';
import type { OperationalRecord } from '../../types';

/** Link seguro do Portal do Cliente (token aleatório, validade, revogável). Envio por WhatsApp é manual: abre o app com o texto pronto. */
export function CustomerLinkButton({ record, scope = 'record', label = 'Link do cliente' }: { record: Pick<OperationalRecord, 'id' | 'title' | 'customerId'>; scope?: 'record' | 'customer' | 'fleet'; label?: string }) {
  const { mode, session, state } = useDemo(); const notice = useNotice();
  const [url, setUrl] = useState(''), [pending, setPending] = useState(false), [days, setDays] = useState(7);
  const phone = state.customers.find(c => c.id === record.customerId && c.tenantId === session.tenantId)?.phone.replace(/\D/g, '') ?? '';
  if (mode === 'demo') return <p className="muted small">Link do Portal do Cliente: disponível na conta real (a demonstração não publica links).</p>;
  async function call(fn: string, args: Record<string, unknown>) {
    const { supabase } = await import('../../real/client');
    const { data, error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message); return data;
  }
  async function create() {
    setPending(true);
    try { const r = await call('create_customer_link', { p_tenant: session.tenantId, p_scope: scope, p_target: record.id, p_days: days }) as { token: string }; setUrl(`${location.origin}/c/${r.token}`); notice('Link criado. Compartilhe apenas com o cliente.'); }
    catch (e) { notice((e as Error).message); } finally { setPending(false); }
  }
  async function revoke() {
    if (!window.confirm('Revogar todos os links ativos deste registro?')) return;
    try { const n = await call('revoke_customer_links', { p_tenant: session.tenantId, p_target: record.id }); setUrl(''); notice(`${n} link(s) revogado(s).`); } catch (e) { notice((e as Error).message); }
  }
  const text = encodeURIComponent(`Olá! Acompanhe "${record.title}" pelo link: ${url}`);
  return <div className="stack" data-tour="customer-link">
    <div className="toolbar"><label className="field"><span>Validade (dias)</span><input type="number" min={1} max={30} value={days} onChange={e => setDays(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} aria-label="Validade do link em dias"/></label>
      <button className="btn" disabled={pending} onClick={() => void create()}><Link2 size={16} aria-hidden="true"/>{label}</button>
      <button className="btn ghost" onClick={() => void revoke()}><XCircle size={16} aria-hidden="true"/>Revogar links</button></div>
    {url && <><input readOnly value={url} aria-label="Link gerado" onFocus={e => e.currentTarget.select()}/>
      <div className="toolbar"><button className="btn" onClick={() => void navigator.clipboard?.writeText(url).then(() => notice('Link copiado.'))}>Copiar</button>
        {phone && <a className="btn" href={`https://wa.me/55${phone}?text=${text}`} target="_blank" rel="noopener noreferrer"><MessageCircle size={16} aria-hidden="true"/>Abrir WhatsApp</a>}</div>
      <p className="muted small">O envio pelo WhatsApp é feito por você; o PISTEC não confirma entrega desta mensagem.</p></>}
  </div>;
}
