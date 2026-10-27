import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, Link2, Mail, MessageCircle, Printer, X } from 'lucide-react';
import { useDemo } from '../../store';
import { usePwa } from '../../pwa';
import { Badge, Button, Field, Modal, useNotice } from '../../ui';
import { uid } from '../../lib';
import { DOCS_FOR, TITLES, type DocType } from '../../../supabase/functions/_shared/documents/model';
import { PAPERS, paperOf } from '../../../supabase/functions/_shared/documents/paper';
import { DEFAULT_PAPER, demoSnapshot, download, html, paperFor, pdf, pickPrinter, printHtml, type Issued, type PrinterProfile } from './service';

type Hist = { id: string; kind: string; status: string; recipient: string; created_at: string; printer: string | null; operator: string | null; detail: string | null };
const STATUS: Record<string, string> = { prepared: 'Preparado', sent_to_browser: 'Enviado ao navegador', sent_to_connector: 'Enviado ao conector', error: 'Erro', cancelled: 'Cancelado', pending: 'Na fila', processing: 'Processando',
  accepted: 'Aceito pelo provedor', delivered: 'Entregue', failed: 'Falhou', expired: 'Expirado', done: 'Concluído' };
const KIND: Record<string, string> = { print: 'Impressão', reprint: 'Reimpressão', pdf: 'PDF', email: 'E-mail', whatsapp: 'WhatsApp', link: 'Link criado', revoke: 'Links revogados' };
const MESSAGES: Partial<Record<DocType, string>> = {
  sale: 'Olá, {nome}. Segue o comprovante da sua compra na {loja}. Obrigado pela preferência!', quote: 'Olá, {nome}. Seu orçamento da {loja} está disponível para consulta.',
  'os-entry': 'Olá, {nome}. Segue o documento referente à ordem de serviço {numero}.', 'os-done': 'Olá, {nome}. Seu veículo está pronto para retirada. Consulte as informações disponíveis.',
};

/** Documento de uma operação: prévia + Imprimir | WhatsApp | E-mail | PDF | Link. Tudo registrado no histórico (modo real). */
export default function DocumentDialog({ source, types, onClose, initial }: { source: { kind: keyof typeof DOCS_FOR; id: string; customerId?: string } | null; types?: DocType[]; onClose: () => void; initial?: DocType }) {
  const { state, session, mode } = useDemo(); const notice = useNotice(); const { online } = usePwa();
  const options = types ?? (source ? DOCS_FOR[source.kind] : []);
  const [type, setType] = useState<DocType>(initial ?? options[0] ?? 'sale');
  const [issued, setIssued] = useState<Issued | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const [printers, setPrinters] = useState<PrinterProfile[]>([]), [paperId, setPaperId] = useState(''), [panel, setPanel] = useState<'' | 'email' | 'whatsapp' | 'history'>('');
  // O diálogo fica montado; ao abrir para outra origem, volta ao documento inicial dela.
  const sourceKey = source ? `${source.kind}:${source.id}:${initial ?? ''}:${(types ?? []).join()}` : '';
  const [openedFor, setOpenedFor] = useState(sourceKey);
  if (sourceKey !== openedFor) { setOpenedFor(sourceKey); if (source) { setType(initial ?? options[0] ?? 'sale'); setPaperId(''); setPanel(''); } }
  const [history, setHistory] = useState<Hist[]>([]);
  const tenant = state.tenants.find(t => t.id === session.tenantId);
  const customer = state.customers.find(c => c.tenantId === session.tenantId && c.id === source?.customerId);
  const real = mode === 'real';
  const client = useCallback(async () => (await import('../../real/client')).supabase, []);

  useEffect(() => { if (!source) return; setIssued(null); setError(''); let alive = true;
    void (async () => {
      try {
        if (!real) { setIssued(demoSnapshot(state, session, type, source.id)); return; }
        const sb = await client();
        const [{ data, error }, list] = await Promise.all([sb.rpc('issue_document', { p_tenant: session.tenantId, p_type: type, p_source: source.id }), sb.from('printer_profiles').select('*').eq('tenant_id', session.tenantId)]);
        if (error) throw new Error(error.message);
        if (alive) { setIssued(data as Issued); setPrinters((list.data ?? []) as PrinterProfile[]); }
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : 'Não foi possível gerar o documento.'); }
    })();
    return () => { alive = false; };
  }, [source, type, real, session, state, client]);

  const printer = pickPrinter(printers, type, session.branchId);
  const paper = paperId ? paperOf(paperId) : paperFor(printer, DEFAULT_PAPER[type] ?? 'a4');
  const preview = useMemo(() => issued ? html(issued, paper, printer?.calibration) : '', [issued, paper, printer]);
  const pages = paper.height ? '≈ ' + Math.max(1, Math.ceil(((issued?.snapshot.sale?.items.length ?? issued?.snapshot.record?.items.length ?? 4) * 7 + 120) / paper.height)) : 'contínuo';
  const loadHistory = async () => { if (!real || !issued) return; const { data } = await (await client()).rpc('document_history', { p_tenant: session.tenantId, p_document: issued.id, p_limit: 50 }); setHistory((data ?? []) as Hist[]); };

  async function print() {
    if (!issued) return; setBusy(true);
    try {
      let copy = issued.copies + 1;
      if (real) { const { data, error } = await (await client()).rpc('record_document_print', { p_tenant: session.tenantId, p_document: issued.id, p_kind: 'print', p_method: 'browser', p_printer: printer?.id ?? null, p_key: uid() }); if (error) throw new Error(error.message); copy = Number(data); }
      const next = { ...issued, copies: copy, snapshot: { ...issued.snapshot, copy } };
      setIssued(next);
      for (let i = 0; i < Math.max(1, printer?.copies ?? 1); i++) await printHtml(html(next, paper, printer?.calibration));
      notice(copy > 1 ? `${copy}ª via enviada para impressão. Escolha a impressora no diálogo do sistema.` : 'Documento enviado para impressão. Escolha a impressora no diálogo do sistema.');
    } catch (e) { notice(e instanceof Error ? e.message : 'Falha ao imprimir.'); } finally { setBusy(false); }
  }
  async function savePdf() {
    if (!issued) return; setBusy(true);
    try { download(await pdf(issued, paper), `${issued.number}.pdf`, 'application/pdf');
      if (real) await (await client()).rpc('record_document_print', { p_tenant: session.tenantId, p_document: issued.id, p_kind: 'pdf', p_method: 'browser', p_printer: null, p_key: uid() });
    } catch (e) { notice(e instanceof Error ? e.message : 'Falha ao gerar PDF.'); } finally { setBusy(false); }
  }
  async function link() {
    if (!issued || !real) { notice('Links de consulta só existem na conta real.'); return; }
    const { data, error } = await (await client()).rpc('create_document_link', { p_tenant: session.tenantId, p_document: issued.id, p_days: 7 });
    if (error) { notice(error.message); return; }
    const url = `${location.origin}/d/${(data as { token: string }).token}`;
    try { if (navigator.share) await navigator.share({ title: `${TITLES[type]} ${issued.number}`, url }); else { await navigator.clipboard.writeText(url); notice('Link seguro copiado (vale 7 dias).'); } }
    catch { notice(`Link (vale 7 dias): ${url}`); }
  }
  const fill = (t: string) => t.replace('{nome}', customer?.name.split(' ')[0] ?? 'cliente').replace('{loja}', tenant?.name ?? '').replace('{numero}', issued?.number ?? '');

  return <Modal title="Documento" size="xl" open={!!source} onClose={onClose}>{source && <div className="doc-dialog">
    <div className="doc-toolbar">
      {options.length > 1 && <Field label="Documento"><select value={type} onChange={e => { setType(e.target.value as DocType); setPanel(''); }}>{options.map(t => <option key={t} value={t}>{TITLES[t]}</option>)}</select></Field>}
      <Field label="Papel"><select data-tour="doc-paper" value={paperId || paper.id} onChange={e => setPaperId(e.target.value)}>{PAPERS.filter(p => p.kind !== 'label').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
      <div className="doc-meta">{issued && <><Badge>{issued.number}</Badge>{issued.version > 1 && <Badge>Versão {issued.version}</Badge>}{issued.copies > 0 && <Badge>{issued.copies} impressão(ões)</Badge>}</>}
        <small className="muted">{printer ? `Impressora: ${printer.name}` : 'Impressora escolhida no diálogo do sistema'} · {paper.height ? (paper.height > paper.width ? 'Retrato' : 'Paisagem') : 'Bobina'} · Páginas {pages}</small></div>
    </div>
    <div className="doc-actions" data-tour="doc-actions">
      <Button variant="primary" icon={<Printer size={16}/>} loading={busy} disabled={!issued} onClick={() => void print()}>{issued && issued.copies > 0 ? 'Imprimir 2ª via' : 'Imprimir'}</Button>
      <Button icon={<MessageCircle size={16}/>} disabled={!issued} onClick={() => setPanel(panel === 'whatsapp' ? '' : 'whatsapp')}>WhatsApp</Button>
      <Button icon={<Mail size={16}/>} disabled={!issued} onClick={() => setPanel(panel === 'email' ? '' : 'email')}>E-mail</Button>
      <Button icon={<Download size={16}/>} disabled={!issued || busy} onClick={() => void savePdf()}>PDF</Button>
      <Button icon={<Link2 size={16}/>} disabled={!issued} onClick={() => void link()}>Link</Button>
      {real && <Button variant="ghost" disabled={!issued} onClick={() => { setPanel(panel === 'history' ? '' : 'history'); void loadHistory(); }}>Histórico</Button>}
    </div>
    {!real && <p className="callout">Demonstração: o documento usa dados fictícios. Impressão e PDF funcionam; envio por WhatsApp, e-mail e links só na conta real.</p>}
    {panel === 'email' && issued && <Send kind="email" disabled={!real || !online} defaultTo={customer?.email ?? ''} defaultText={fill(MESSAGES[type] ?? 'Olá, {nome}. Segue o documento da {loja}.')} onClose={() => setPanel('')}
      onSend={async (to, text) => { const { data, error } = await (await client()).rpc('send_document_email', { p_tenant: session.tenantId, p_document: issued.id, p_to: to, p_message: text, p_key: uid() }); if (error) throw new Error(error.message);
        notice((data as { duplicate: boolean }).duplicate ? 'Este envio já estava registrado.' : 'E-mail colocado na fila. A situação aparece no histórico (aceito ≠ lido).'); }}/>}
    {panel === 'whatsapp' && issued && <Send kind="whatsapp" disabled={!real || !online || !customer} defaultTo={customer ? `${customer.name} · ${customer.phone}` : 'Venda sem cliente identificado'} defaultText={fill(MESSAGES[type] ?? 'Olá, {nome}. Segue o documento da {loja}.')} onClose={() => setPanel('')}
      hint={customer && !customer.consent ? 'Cliente sem consentimento de WhatsApp registrado: o envio será recusado.' : 'Vai a mensagem + link seguro do documento (válido por 7 dias).'}
      onSend={async (_to, text) => { const { data, error } = await (await client()).functions.invoke('whatsapp', { body: { tenantId: session.tenantId, action: 'document', documentId: issued.id, customerId: customer!.id, text, key: uid() } });
        if (error) { const d = await (error as { context?: Response }).context?.json?.().catch(() => null); throw new Error(d?.error ?? 'Falha ao enviar pelo WhatsApp.'); }
        notice((data as { duplicate?: boolean }).duplicate ? 'Este envio já estava registrado.' : 'Mensagem aceita pelo WhatsApp (entrega não confirmada).'); }}/>}
    {panel === 'history' && <div className="doc-history">{history.length ? <table><thead><tr><th>Quando</th><th>Ação</th><th>Situação</th><th>Detalhe</th></tr></thead><tbody>{history.map(h => <tr key={h.id}><td>{new Date(h.created_at).toLocaleString('pt-BR')}</td><td>{KIND[h.kind] ?? h.kind}</td><td>{STATUS[h.status] ?? h.status}</td><td>{[h.operator, h.printer, h.recipient, h.detail].filter(Boolean).join(' · ') || '—'}</td></tr>)}</tbody></table> : <p className="muted">Nenhuma ação registrada ainda.</p>}</div>}
    {error ? <p className="callout warning" role="alert">{error}</p> : !issued ? <p role="status">Gerando documento…</p> :
      <iframe className={`doc-preview ${paper.kind}`} title={`Prévia: ${TITLES[type]}`} sandbox="allow-same-origin allow-modals" srcDoc={preview} data-tour="doc-preview"/>}
  </div>}</Modal>;
}

function Send({ kind, defaultTo, defaultText, disabled, hint, onSend, onClose }: { kind: 'email' | 'whatsapp'; defaultTo: string; defaultText: string; disabled: boolean; hint?: string; onSend: (to: string, text: string) => Promise<void>; onClose: () => void }) {
  const [to, setTo] = useState(defaultTo), [text, setText] = useState(defaultText), [pending, setPending] = useState(false), [err, setErr] = useState('');
  return <form className="doc-send" onSubmit={async e => { e.preventDefault(); setPending(true); setErr(''); try { await onSend(to.trim(), text.trim()); onClose(); } catch (x) { setErr(x instanceof Error ? x.message : 'Falha no envio.'); } finally { setPending(false); } }}>
    <div className="panel-heading"><strong>{kind === 'email' ? 'Enviar por e-mail' : 'Enviar por WhatsApp'}</strong><button type="button" className="icon-button" aria-label="Fechar envio" onClick={onClose}><X size={16}/></button></div>
    {kind === 'email' ? <Field label="E-mail do destinatário"><input type="email" required value={to} onChange={e => setTo(e.target.value)}/></Field> : <p><strong>Destinatário:</strong> {to}</p>}
    <Field label="Mensagem"><textarea maxLength={kind === 'email' ? 600 : 1000} value={text} onChange={e => setText(e.target.value)}/></Field>
    {hint && <p className="muted small">{hint}</p>}{disabled && <p className="muted small">Envio indisponível: exige conta real, conexão{kind === 'whatsapp' ? ' e cliente identificado' : ''}.</p>}
    {err && <p role="alert" className="callout warning">{err}</p>}
    <div className="toolbar"><Button type="submit" variant="primary" loading={pending} disabled={disabled}>Enviar</Button><span className="muted small">{kind === 'email' ? 'Remetente: endereço verificado do PISTEC com o nome da loja; respostas vão para o e-mail da loja.' : 'Envio pelo WhatsApp conectado da loja.'}</span></div>
  </form>;
}
