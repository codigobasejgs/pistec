import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileSignature } from 'lucide-react';
import { Button, PageHeader, Panel, Stat } from '../../ui';
import { supabase } from '../client';
import { call, rows, useQuery } from './data';
import { useAdmin } from './context';
import { AdvancedTable, ConfirmAction, KeyValue, Loaded, StatusBadge, Tabs } from './ui';
import { CONTRACT_STATUS } from '../../features/contracts/MyContracts';
import { brl, fillContract, type ContractBody, type ContractData } from '../../../supabase/functions/_shared/contracts/template';

type Row = { id: string; number: string; tenant_id: string; kind: string; status: string; sandbox: boolean; commercial: { planName: string; period: string; total: number }; parties: { company: { legalName: string; document: string }; representative: { name: string } };
  signature_provider: string | null; invoice_id: string | null; created_at: string; signed_at: string | null };
type Version = { id: string; code: string; title: string; status: string; body: ContractBody; legal_review_note: string; approval_evidence: string; created_at: string; submitted_at: string | null; reviewed_at: string | null; approved_at: string | null; published_at: string | null; source_file: string; source_sha256: string };
type Provider = Record<string, string> & { id: string; active: boolean; created_at: string };
const PERIOD: Record<string, string> = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };
const VSTATUS: Record<string, string> = { draft: 'Rascunho', in_review: 'Em revisão jurídica', approved: 'Aprovada', published: 'Publicada', archived: 'Arquivada' };
const fnError = async (e: unknown) => { const d = await (e as { context?: Response }).context?.json?.().catch(() => null); return d?.error ?? 'Falha na operação.'; };

/** Super Admin → Comercial → Contratos digitais (dashboard, lista, detalhe, cancelar/reenviar), modelos e versões, identidade jurídica. */
export default function Contracts() {
  const [tab, setTab] = useState('contratos');
  return <div className="page"><PageHeader title="Contratos digitais" subtitle="Contratos de assinatura SaaS, versões jurídicas e identidade da contratada. Contratos assinados são imutáveis."/>
    <Tabs label="Seções de contratos" value={tab} onChange={setTab} items={[['contratos', 'Contratos'], ['versoes', 'Modelos e versões'], ['contratada', 'Identidade jurídica']]}/>
    {tab === 'contratos' ? <List/> : tab === 'versoes' ? <Versions/> : <ProviderProfile/>}</div>;
}

function List() {
  const { can } = useAdmin();
  const metrics = useQuery(() => call<Record<string, number>>('admin_contract_metrics'), []);
  const q = useQuery(() => rows<Row>('tenant_contracts', 'id,number,tenant_id,kind,status,sandbox,commercial,parties,signature_provider,invoice_id,created_at,signed_at', b => b.order('created_at', { ascending: false }).limit(500)), []);
  const [status, setStatus] = useState(''), [sel, setSel] = useState<Row | null>(null), [cancel, setCancel] = useState<Row | null>(null), [msg, setMsg] = useState('');
  const detail = useQuery(() => sel ? call<ContractData & { signers: { role: string; name: string; email: string; status: string; signedAt: string | null }[]; events: { type: string; source: string; at: string }[]; invoice: { status: string } | null; documentSha256: string | null; signedSha256: string | null }>('contract_detail', { p_contract: sel.id }) : Promise.resolve(null), [sel?.id]);
  const list = (q.data ?? []).filter(r => !status || r.status === status);
  const exportCsv = () => { const head = ['numero', 'empresa', 'documento', 'representante', 'plano', 'periodicidade', 'valor', 'situacao', 'criado', 'assinado'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"`;
    const csv = [head.join(';'), ...list.map(r => [r.number, r.parties.company.legalName, r.parties.company.document, r.parties.representative.name, r.commercial.planName, PERIOD[r.commercial.period], (r.commercial.total / 100).toFixed(2), CONTRACT_STATUS[r.status], r.created_at, r.signed_at ?? ''].map(esc).join(';'))].join('\r\n');
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: 'contratos.csv' }); a.click(); };
  const act = async (id: string, action: string, extra = {}) => { setMsg(''); const { data, error } = await supabase.functions.invoke('contract-sign', { body: { action, contractId: id, ...extra } });
    if (error) setMsg(await fnError(error)); else if ((data as { url?: string }).url) window.open((data as { url: string }).url, '_blank', 'noopener'); else setMsg('Concluído.'); q.reload(); detail.reload(); };
  return <>
    <Loaded q={metrics}>{m => <div className="grid grid-4" data-tour="admin-contracts-kpis"><Stat label="Contratos gerados" value={m.total} icon={<FileSignature size={20}/>}/><Stat label="Pendentes de assinatura" value={m.pending} tone="amber"/>
      <Stat label="Assinados" value={m.signed} tone="green" hint={m.avgHoursToSign != null ? `Tempo médio: ${m.avgHoursToSign} h` : 'Sem dados de tempo ainda'}/><Stat label="Recusados / expirados" value={`${m.refused} / ${m.expired}`} tone="red"/>
      <Stat label="Aguardando pagamento" value={m.awaitingPayment} tone="purple"/><Stat label="Com assinatura ativa" value={m.activeLinked} tone="cyan"/><Stat label="Erros de integração" value={m.error} tone="red"/><Stat label="Homologação (sandbox)" value={m.sandbox}/></div>}</Loaded>
    {msg && <p className="callout" role="status">{msg}</p>}
    <Panel title="Contratos"><div className="toolbar"><label className="field-inline">Situação<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(CONTRACT_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <Button onClick={exportCsv}>Exportar CSV</Button></div>
      <Loaded q={q}>{() => <AdvancedTable caption="Contratos" tour="admin-contracts" rows={list} search={r => `${r.number} ${r.parties.company.legalName} ${r.parties.company.document} ${r.parties.representative.name} ${r.commercial.planName}`} columns={[
        { key: 'n', label: 'Número', sort: r => r.number, render: r => <button className="row-link" onClick={() => setSel(r)}>{r.number}{r.sandbox ? ' · homologação' : ''}</button> },
        { key: 'e', label: 'Empresa', render: r => <Link to={`/admin/empresas/${r.tenant_id}`}>{r.parties.company.legalName}</Link> }, { key: 'd', label: 'CNPJ/CPF', render: r => r.parties.company.document },
        { key: 'r', label: 'Representante', render: r => r.parties.representative.name }, { key: 'p', label: 'Plano', render: r => `${r.commercial.planName} · ${PERIOD[r.commercial.period]}` },
        { key: 'v', label: 'Valor', sort: r => r.commercial.total, render: r => brl(r.commercial.total) }, { key: 'c', label: 'Data', sort: r => r.created_at, render: r => new Date(r.created_at).toLocaleDateString('pt-BR') },
        { key: 's', label: 'Situação', render: r => <StatusBadge>{CONTRACT_STATUS[r.status] ?? r.status}</StatusBadge> }, { key: 'pv', label: 'Provedor', render: r => r.signature_provider ?? '—' },
        { key: 'pg', label: 'Pagamento', render: r => r.invoice_id ? 'Fatura gerada' : '—' }]}/>}</Loaded></Panel>
    {sel && <Panel title={`Contrato ${sel.number}`}><Loaded q={detail}>{d => d && <div className="stack">
      <KeyValue items={[['Situação', CONTRACT_STATUS[d.status] ?? d.status], ['Empresa', d.parties.company.legalName], ['Representante', `${d.parties.representative.name} (${d.parties.representative.role})`], ['Plano', `${d.commercial.planName} · ${PERIOD[d.commercial.period]} · ${brl(d.commercial.total)}`],
        ['Versão do contrato', `${d.version.code} (${VSTATUS[d.version.status] ?? d.version.status})`], ['Hash enviado', d.documentSha256 ?? '—'], ['Hash assinado', d.signedSha256 ?? '—'], ['Pagamento', d.invoice?.status ?? 'sem fatura']]}/>
      <h4>Signatários</h4><ul>{d.signers.map(s => <li key={s.role}>{s.role === 'customer' ? 'Contratante' : 'Contratada'}: {s.name} · {s.email} · {s.status}{s.signedAt ? ` em ${new Date(s.signedAt).toLocaleString('pt-BR')}` : ''}</li>)}</ul>
      <h4>Histórico</h4><ol className="timeline">{d.events.map((e, i) => <li key={i}>{new Date(e.at).toLocaleString('pt-BR')} · {e.type} ({e.source})</li>)}</ol>
      <div className="toolbar"><Button onClick={() => void act(sel.id, 'download', { file: 'original' })}>PDF enviado</Button>{d.status === 'signed' && <Button onClick={() => void act(sel.id, 'download', { file: 'signed' })}>PDF assinado</Button>}
        {['awaiting_customer', 'awaiting_provider', 'partially_signed'].includes(d.status) && <><Button onClick={() => void act(sel.id, 'reconcile')}>Conferir no provedor</Button><Button onClick={() => void act(sel.id, 'resend')}>Reenviar convite</Button></>}
        {can('subscriptions.manage') && !['signed', 'cancelled', 'refused', 'expired'].includes(d.status) && <Button variant="danger" onClick={() => setCancel(sel)}>Cancelar solicitação</Button>}
        <Button variant="ghost" onClick={() => setSel(null)}>Fechar</Button></div>
      <p className="muted small">Aditivos e novas versões: gere um novo contrato pela contratação da empresa; o contrato assinado permanece intacto.</p></div>}</Loaded></Panel>}
    <ConfirmAction open={!!cancel} title={`Cancelar solicitação ${cancel?.number}`} confirmLabel="Cancelar solicitação" danger onClose={() => setCancel(null)} description={<p>O pedido de assinatura é bloqueado no provedor e o contrato fica como cancelado (registro mantido).</p>}
      onConfirm={async r => { const { error } = await supabase.functions.invoke('contract-sign', { body: { action: 'cancel', contractId: cancel!.id, reason: r } }); if (error) throw new Error(await fnError(error)); q.reload(); metrics.reload(); }}/>
  </>;
}

function Versions() {
  const q = useQuery(() => rows<Version>('legal_contract_versions', 'id,code,title,status,body,legal_review_note,approval_evidence,created_at,submitted_at,reviewed_at,approved_at,published_at,source_file,source_sha256', b => b.order('created_at', { ascending: false })), []);
  const { role } = useAdmin(), [roleMsg, setRoleMsg] = useState(''), [draft, setDraft] = useState<{ id: string | null; code: string; title: string; json: string } | null>(null), [draftMsg, setDraftMsg] = useState('');
  const saveDraft = async () => { setDraftMsg(''); try { const body = JSON.parse(draft!.json) as ContractBody; if (!Array.isArray(body.sections) || !body.title) throw new Error('Corpo precisa de title e sections.');
    fillContract(sampleContract({ ...(sel ?? {}), code: draft!.code, title: draft!.title, status: 'draft', body } as Version));
    await call('admin_contract_version', { p_action: draft!.id ? 'edit' : 'create', p_id: draft!.id, p: { code: draft!.code, title: draft!.title, body, sourceFile: sel?.source_file ?? '', sourceSha256: sel?.source_sha256 ?? '' }, p_note: null });
    setDraft(null); setSel(null); q.reload(); } catch (e) { setDraftMsg((e as Error).message); } };
  const [sel, setSel] = useState<Version | null>(null), [cmp, setCmp] = useState(''), [target, setTarget] = useState<{ v: Version; action: string; label: string } | null>(null);
  const preview = useMemo(() => { if (!sel) return null; try { return fillContract(sampleContract(sel)); } catch (e) { return (e as Error).message; } }, [sel]);
  const vars = useMemo(() => sel ? Array.from(new Set(JSON.stringify(sel.body).match(/\{\{\w+\}\}/g) ?? [])) : [], [sel]);
  const other = (q.data ?? []).find(v => v.id === cmp);
  const diff = useMemo(() => { if (!sel || !other) return []; const flat = (v: Version) => v.body.sections.flatMap(s => [s.title, ...s.paragraphs]); const a = new Set(flat(other)), b = new Set(flat(sel));
    return [...flat(sel).filter(x => !a.has(x)).map(x => ['+', x]), ...flat(other).filter(x => !b.has(x)).map(x => ['−', x])]; }, [sel, other]);
  const actions: [string, string, string[]][] = [['submit', 'Enviar para revisão jurídica', ['draft']], ['review', 'Registrar parecer jurídico', ['in_review']], ['approve', 'Aprovar (aprovador)', ['in_review']], ['return', 'Devolver para rascunho', ['in_review', 'approved']], ['publish', 'Publicar para novas contratações', ['approved']], ['archive', 'Arquivar', ['draft', 'approved', 'published']]];
  return <><Panel title="Versões do contrato"><p className="muted small">Fluxo: editor envia → revisor jurídico registra parecer → aprovador (outra pessoa) aprova com evidência → publicador publica. Papéis atribuídos pelo proprietário em Administradores; o servidor valida cada etapa.</p>
    <Loaded q={q}>{list => <AdvancedTable caption="Versões" tour="admin-contract-versions" rows={list} columns={[{ key: 'c', label: 'Versão', render: v => <button className="row-link" onClick={() => setSel(v)}>{v.code}</button> }, { key: 't', label: 'Título', render: v => v.title },
      { key: 's', label: 'Situação', render: v => <StatusBadge>{VSTATUS[v.status] ?? v.status}</StatusBadge> }, { key: 'r', label: 'Parecer', render: v => v.legal_review_note || '—' }, { key: 'a', label: 'Aprovação', render: v => v.approval_evidence || '—' },
      { key: 'p', label: 'Publicada', render: v => v.published_at ? new Date(v.published_at).toLocaleDateString('pt-BR') : '—' }]}/>}</Loaded></Panel>
    {sel && <Panel title={`Versão ${sel.code} · ${VSTATUS[sel.status]}`}><div className="stack">
      <p className="small">Origem: {sel.source_file || '—'} · SHA-256 {sel.source_sha256 ? sel.source_sha256.slice(0, 16) + '…' : '—'}</p>
      <div className="toolbar">{actions.filter(([, , st]) => st.includes(sel.status)).map(([a, l]) => <Button key={a} variant={a === 'publish' ? 'primary' : 'secondary'} onClick={() => setTarget({ v: sel, action: a, label: l })}>{l}</Button>)}<Button onClick={() => setDraft({ id: null, code: '', title: sel.title, json: JSON.stringify(sel.body, null, 2) })}>Duplicar como novo rascunho</Button>
        {sel.status === 'draft' && <Button onClick={() => setDraft({ id: sel.id, code: sel.code, title: sel.title, json: JSON.stringify(sel.body, null, 2) })}>Editar rascunho</Button>}
        <Button variant="ghost" onClick={() => setSel(null)}>Fechar</Button></div>
      {draft && <div className="stack"><p className="small">Edição exige perfil de editor contratual. Variáveis {'{{...}}'} sem valor bloqueiam o salvamento; versões fora de rascunho não podem ser alteradas.</p>
        <div className="form-grid"><label className="field"><span>Código da versão</span><input value={draft.code} disabled={!!draft.id} onChange={e => setDraft({ ...draft, code: e.target.value })}/></label><label className="field"><span>Título</span><input value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label></div>
        <label className="field"><span>Texto (JSON: title, subtitle, summary, sections[{'{'}title, paragraphs{'}'}], signatureBlock)</span><textarea rows={18} spellCheck={false} value={draft.json} onChange={e => setDraft({ ...draft, json: e.target.value })}/></label>
        {draftMsg && <p className="callout warning" role="alert">{draftMsg}</p>}<div className="toolbar"><Button variant="primary" onClick={() => void saveDraft()}>Salvar rascunho</Button><Button variant="ghost" onClick={() => setDraft(null)}>Cancelar</Button></div></div>}
      <details><summary>Variáveis ({vars.length})</summary><p className="small">{vars.join(' ')}</p></details>
      <label className="field-inline">Comparar com<select value={cmp} onChange={e => setCmp(e.target.value)}><option value="">—</option>{(q.data ?? []).filter(v => v.id !== sel.id).map(v => <option key={v.id} value={v.id}>{v.code}</option>)}</select></label>
      {other && (diff.length ? <ul className="small">{diff.map(([s, t], i) => <li key={i} style={{ color: s === '+' ? 'var(--success)' : 'var(--danger)' }}>{s} {t}</li>)}</ul> : <p className="muted">Sem diferenças de texto.</p>)}
      <h4>Pré-visualização com dados fictícios</h4>{typeof preview === 'string' ? <p className="callout warning">Variável sem valor: {preview}</p> : preview && <article className="hire-contract"><p className="callout warning">{preview.draftNotice ?? 'Pré-visualização'} — dados fictícios.</p>
        {preview.sections.map(s => <section key={s.title}><h4>{s.title}</h4>{s.paragraphs.map((p, i) => <p key={i}>{p}</p>)}</section>)}</article>}</div></Panel>}
    {role === 'owner' && <Panel title="Papéis contratuais"><form className="toolbar" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); setRoleMsg('');
      call('admin_set_contract_roles', { p_email: f.get('email'), p_roles: f.getAll('roles') }).then(() => setRoleMsg('Papéis salvos.'), (x: Error) => setRoleMsg(x.message)); }}>
      <label className="field-inline">E-mail do administrador<input name="email" type="email" required/></label>
      {[['editor', 'Editor'], ['reviewer', 'Revisor jurídico'], ['approver', 'Aprovador'], ['publisher', 'Publicador']].map(([k, l]) => <label key={k} className="field-inline"><input type="checkbox" name="roles" value={k}/>{l}</label>)}
      <Button type="submit">Salvar papéis</Button>{roleMsg && <span role="status">{roleMsg}</span>}</form></Panel>}
    <ConfirmAction open={!!target} title={target?.label ?? ''} confirmLabel="Confirmar" onClose={() => setTarget(null)}
      description={<p>{target?.action === 'approve' ? 'Informe a evidência da aprovação jurídica (ex.: parecer nº, nome e OAB do advogado). Sem aprovação real, não aprove.' : target?.action === 'review' ? 'Registre o parecer da revisão jurídica.' : 'Informe a justificativa (fica na auditoria).'}</p>}
      onConfirm={async note => { await call('admin_contract_version', { p_action: target!.action, p_id: target!.v.id, p: {}, p_note: note }); q.reload(); setSel(null); }}/>
  </>;
}

function ProviderProfile() {
  const { role } = useAdmin();
  const q = useQuery(() => rows<Provider>('legal_provider_profiles', '*', b => b.order('created_at', { ascending: false })), []);
  const [edit, setEdit] = useState<Record<string, string> | null>(null), [confirm, setConfirm] = useState(false);
  const active = (q.data ?? []).find(p => p.active);
  const official: [string, string][] = [['legal_name', 'Nome empresarial'], ['document', 'CNPJ'], ['legal_nature', 'Natureza jurídica'], ['brand', 'Marca do software'], ['street', 'Logradouro'], ['number', 'Número'], ['district', 'Bairro'], ['city', 'Município'], ['state', 'UF'], ['zip', 'CEP'], ['registry_email', 'E-mail cadastral'], ['registry_phone', 'Telefone cadastral']];
  const extra: [string, string][] = [['commercial_email', 'E-mail comercial'], ['billing_email', 'E-mail financeiro'], ['support_email', 'E-mail de suporte'], ['signer_name', 'Signatário autorizado da contratada'], ['signer_email', 'E-mail do signatário'], ['signer_cpf', 'CPF do signatário']];
  return <><Panel title="Identidade jurídica da contratada"><Loaded q={q}>{() => active ? <div className="stack" data-tour="admin-provider">
    <KeyValue items={official.map(([k, l]) => [l, active[k]] as [string, string])}/><KeyValue items={extra.map(([k, l]) => [l, active[k] || '—'] as [string, string])}/>
    <p className="small">Fonte: {active.source}. Cada alteração cria um novo registro; contratos já gerados mantêm os dados congelados.</p>
    {!active.signer_email && <p className="callout warning">Sem signatário da contratada configurado, contratos reais não podem ser gerados (o PISTEC não assina pela contratada automaticamente).</p>}
    {role === 'owner' ? <Button variant="primary" onClick={() => setEdit({})}>Alterar dados</Button> : <p className="muted small">Somente o proprietário da plataforma altera estes dados.</p>}</div> : <p>Sem cadastro ativo.</p>}</Loaded></Panel>
    {edit && <Panel title="Alterar identidade jurídica"><div className="form-grid">{[...extra, ...official].map(([k, l]) => <label key={k} className="field"><span>{l}</span><input placeholder={active?.[k] ?? ''} value={edit[k] ?? ''} onChange={e => setEdit(x => ({ ...x!, [k]: e.target.value }))}/></label>)}
      <label className="field"><span>Fonte documental (obrigatória se mudar nome ou CNPJ)</span><input value={edit.source ?? ''} onChange={e => setEdit(x => ({ ...x!, source: e.target.value }))}/></label></div>
      <div className="toolbar"><Button variant="primary" onClick={() => setConfirm(true)}>Salvar nova versão</Button><Button variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button></div></Panel>}
    <Panel title="Histórico"><Loaded q={q}>{list => <AdvancedTable caption="Histórico de identidade" rows={list} columns={[{ key: 'd', label: 'Data', render: p => new Date(p.created_at).toLocaleString('pt-BR') }, { key: 'n', label: 'Nome', render: p => p.legal_name }, { key: 's', label: 'Signatário', render: p => p.signer_name || '—' }, { key: 'r', label: 'Motivo', render: p => p.reason }, { key: 'a', label: 'Ativo', render: p => p.active ? 'Sim' : 'Não' }]}/>}</Loaded></Panel>
    <ConfirmAction open={confirm} title="Salvar identidade jurídica" confirmLabel="Salvar" onClose={() => setConfirm(false)} description={<p>Campos vazios mantêm o valor atual. A alteração fica na auditoria.</p>}
      onConfirm={async r => { const p = Object.fromEntries(Object.entries(edit ?? {}).filter(([, v]) => v.trim())); await call('admin_save_provider_profile', { p, p_reason: r }); setEdit(null); q.reload(); }}/>
  </>;
}

/** Contrato fictício para pré-visualização de versões (nunca usado em contrato real). */
function sampleContract(v: Version): ContractData {
  return { id: '00000000-0000-4000-8000-000000000000', number: 'PST-EXEMPLO', status: 'prepared', sandbox: true, version: { code: v.code, title: v.title, status: v.status, body: v.body },
    commercial: { planId: 'profissional', planVersion: 'exemplo', planName: 'Plano exemplo', period: 'monthly', price: 10000, discount: 0, total: 10000, coupon: null, trialDays: 0, trialEnd: null, startDate: '2026-01-01', nextDue: '2026-01-31',
      entitlements: { users: 5, branches: 1, products: 1000, whatsapp: 1, aiMessagesPerDay: 10, features: ['Exemplo'], modules: ['pdv'] }, renewal: 'Exemplo', cancellation: 'Exemplo', readjustment: 'Exemplo', grace: 'Exemplo', notification: 'Exemplo',
      support: 'Exemplo', exportDays: 'Exemplo', exportFormats: 'Exemplo', retention: 'Exemplo', integrations: 'Exemplo', billingMethod: 'Exemplo' },
    parties: { provider: { legalName: 'Contratada exemplo', document: '00.000.000/0000-00', legalNature: 'Exemplo', brand: 'PISTEC', address: 'Endereço exemplo', contact: 'contato@exemplo', signerName: 'Signatário exemplo', signerEmail: 'x@exemplo' },
      company: { legalName: 'Empresa Exemplo Ltda', tradeName: 'Exemplo', document: '00000000000000', address: 'Endereço exemplo', phone: '0000000000', email: 'x@exemplo' }, representative: { name: 'Representante Exemplo', cpf: '00000000000', role: 'Sócio', email: 'x@exemplo', phone: '0000000000' } } };
}
