import { useCallback, useEffect, useState } from 'react';
import { Download, FileSignature, RefreshCw } from 'lucide-react';
import { supabase } from '../../real/client';
import { Badge, Button, Empty, Panel } from '../../ui';
import { brl } from '../../../supabase/functions/_shared/contracts/template';

type Row = { id: string; number: string; kind: string; status: string; commercial: { planName: string; period: string; total: number; nextDue: string }; created_at: string; signed_at: string | null; sandbox: boolean; invoice_id: string | null };
type Detail = { id: string; number: string; status: string; documentSha256: string | null; signedSha256: string | null; signers: { role: string; name: string; email: string; status: string; signedAt: string | null; authMethod: string }[]; events: { type: string; source: string; at: string }[]; invoice: { status: string } | null };
export const CONTRACT_STATUS: Record<string, string> = { prepared: 'Pronto para assinatura', awaiting_customer: 'Aguardando assinatura do cliente', awaiting_provider: 'Aguardando assinatura da contratada', partially_signed: 'Parcialmente assinado',
  signed: 'Assinado por todos', refused: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado', error: 'Erro de integração', draft: 'Rascunho', awaiting_data: 'Aguardando dados' };
const PERIOD: Record<string, string> = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };
const EVENT: Record<string, string> = { prepared: 'Contrato gerado', sent: 'Enviado para assinatura', webhook: 'Atualização do provedor', reconcile: 'Situação conferida no provedor', completed: 'Assinado por todos', cancelled: 'Cancelado', resend: 'Convite reenviado' };

/** Minha assinatura → Contratos e documentos (somente proprietário, administrador e financeiro veem; RLS no servidor). */
export default function MyContracts({ tenantId, slug, canSign }: { tenantId: string; slug: string; canSign: boolean }) {
  const [rows, setRows] = useState<Row[] | null>(null), [detail, setDetail] = useState<Detail | null>(null), [busy, setBusy] = useState(''), [msg, setMsg] = useState('');
  const load = useCallback(async () => { const { data } = await supabase.from('tenant_contracts').select('id,number,kind,status,commercial,created_at,signed_at,sandbox,invoice_id').eq('tenant_id', tenantId).order('created_at', { ascending: false }); setRows((data ?? []) as Row[]); }, [tenantId]);
  useEffect(() => { void load(); }, [load]);
  const open = async (id: string) => { const { data, error } = await supabase.rpc('contract_detail', { p_contract: id }); if (error) setMsg(error.message); else setDetail(data as Detail); };
  const act = async (id: string, action: string, extra: Record<string, unknown> = {}) => { setBusy(action + id); setMsg('');
    const { data, error } = await supabase.functions.invoke('contract-sign', { body: { action, contractId: id, ...extra } });
    if (error) { const d = await (error as { context?: Response }).context?.json?.().catch(() => null); setMsg(d?.error ?? 'Falha na operação.'); }
    else if ((data as { url?: string }).url) window.open((data as { url: string }).url, '_blank', 'noopener');
    setBusy(''); await load(); if (detail?.id === id) await open(id); };
  const current = rows?.find(r => r.status === 'signed' && !r.sandbox && r.kind === 'contract');
  return <Panel title="Contratos e documentos"><div className="stack" data-tour="sub-contracts">
    {current ? <p>Contrato vigente: <strong>{current.number}</strong> · {current.commercial.planName} {PERIOD[current.commercial.period]} · {brl(current.commercial.total)} · assinado em {new Date(current.signed_at!).toLocaleDateString('pt-BR')}</p>
      : <p className="muted">Nenhum contrato assinado ainda. {canSign && <a href={`/app/contratar?empresa=${encodeURIComponent(slug)}`}>Formalizar contratação</a>}</p>}
    {msg && <p className="callout warning" role="alert">{msg}</p>}
    {rows === null ? <p role="status">Carregando…</p> : rows.length ? <div className="table-wrap"><table><caption className="sr-only">Contratos</caption><thead><tr><th>Número</th><th>Plano</th><th>Valor</th><th>Data</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>{rows.map(r => <tr key={r.id}><td data-label="Número">{r.number}{r.kind === 'addendum' && ' (aditivo)'}{r.sandbox && ' · homologação'}</td><td data-label="Plano">{r.commercial.planName} · {PERIOD[r.commercial.period]}</td><td data-label="Valor">{brl(r.commercial.total)}</td>
        <td data-label="Data">{new Date(r.created_at).toLocaleDateString('pt-BR')}</td><td data-label="Situação"><Badge>{CONTRACT_STATUS[r.status] ?? r.status}</Badge></td>
        <td data-label="Ações"><div className="toolbar"><Button onClick={() => void open(r.id)}>Detalhes</Button>
          {r.status === 'signed' && <Button icon={<Download size={15}/>} loading={busy === 'download' + r.id} onClick={() => void act(r.id, 'download', { file: 'signed' })}>PDF assinado</Button>}
          {['prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed'].includes(r.status) && canSign && <a className="btn" href={`/app/contratar?empresa=${encodeURIComponent(slug)}`}><FileSignature size={15}/>Continuar</a>}</div></td></tr>)}</tbody></table></div>
      : <Empty text="Nenhum contrato gerado."/>}
    {detail && <section className="panel" aria-label={`Contrato ${detail.number}`}><div className="panel-heading"><h3>Contrato {detail.number}</h3><Badge>{CONTRACT_STATUS[detail.status] ?? detail.status}</Badge></div>
      <h4>Signatários</h4><ul>{detail.signers.map(s => <li key={s.role}>{s.role === 'customer' ? 'Contratante' : 'Contratada'}: {s.name} ({s.email}) — {{ pending: 'pendente', viewed: 'visualizou', signed: 'assinou', refused: 'recusou' }[s.status] ?? s.status}{s.signedAt ? ` em ${new Date(s.signedAt).toLocaleString('pt-BR')}` : ''} · autenticação: {s.authMethod === 'email' ? 'e-mail (Autentique)' : s.authMethod}</li>)}</ul>
      <h4>Integridade</h4><p className="small">SHA-256 do documento enviado: <code>{detail.documentSha256 ?? '—'}</code><br/>SHA-256 do documento assinado: <code>{detail.signedSha256 ?? 'disponível após a conclusão'}</code></p>
      <h4>Histórico</h4><ol className="timeline">{detail.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString('pt-BR')} · {EVENT[e.type] ?? e.type}</li>)}</ol>
      <p className="small">Pagamento: {detail.invoice ? detail.invoice.status : 'sem cobrança gerada'}.</p>
      <div className="toolbar"><Button icon={<Download size={15}/>} onClick={() => void act(detail.id, 'download', { file: 'original' })}>Documento enviado</Button>
        {detail.status === 'signed' && <Button icon={<Download size={15}/>} onClick={() => void act(detail.id, 'download', { file: 'signed' })}>Assinado + certificado</Button>}
        {/* WhatsApp: só situação real e link autenticado; nunca anexa o PDF nem dados pessoais. */}
        {detail.status === 'signed' && <a className="btn" target="_blank" rel="noopener" href={`https://wa.me/?text=${encodeURIComponent(`Contrato PISTEC ${detail.number} assinado por todas as partes. Acesse com seu login: ${location.origin}/app/loja/${slug}/minha-assinatura`)}`}>Compartilhar no WhatsApp</a>}
        {!['signed', 'cancelled', 'refused', 'expired'].includes(detail.status) && <Button icon={<RefreshCw size={15}/>} loading={busy === 'reconcile' + detail.id} onClick={() => void act(detail.id, 'reconcile')}>Atualizar situação</Button>}
        <Button variant="ghost" onClick={() => setDetail(null)}>Fechar</Button></div>
      <p className="muted small">Contratos assinados não podem ser alterados nem apagados. Mudanças de plano ou condições geram aditivo ou novo contrato. Para segunda via, use "Assinado + certificado".</p></section>}
  </div></Panel>;
}
