import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Send } from 'lucide-react';
import { Button, Field, Modal, PageHeader, Panel } from '../../ui';
import { call, rows, useQuery, type PlanRow, type RecordRow, type TenantRow } from './data';
import { AdvancedTable, ConfirmAction, EmptyState, Loaded, StatusBadge, Tabs, Timeline } from './ui';
import { supabase } from '../client';

const date = (s?: string) => s ? new Date(s).toLocaleDateString('pt-BR') : '—';

/** Registro administrativo (lead/chamado) com campos, situação, histórico e comentários. */
function RecordEditor({ kind, record, statuses, fields, onClose, onSaved, tenants }: { kind: string; record: RecordRow | null; statuses: string[]; fields: [string, string, string[]?][]; onClose: () => void; onSaved: () => void; tenants?: TenantRow[] }) {
  const [error, setError] = useState(''), [pending, setPending] = useState(false), [comment, setComment] = useState(''), [internal, setInternal] = useState(true);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as Record<string, string>; setPending(true); setError('');
    try { const { title, status, ...rest } = f; await call('admin_save_record', { p: { id: record?.id ?? '', kind, title, status, fields: { ...record?.fields, ...rest } } }); onSaved(); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setPending(false); }
  };
  const send = async () => { setError(''); try { await call('admin_record_comment', { p_id: record!.id, p_text: comment, p_internal: internal }); setComment(''); onSaved(); } catch (e) { setError(e instanceof Error ? e.message : 'Erro.'); } };
  return <Modal title={record ? record.title : kind === 'admin-ticket' ? 'Novo chamado' : 'Novo lead'} open onClose={onClose} size="lg"><div className="stack">
    <form className="stack" onSubmit={submit}><div className="form-grid">
      <Field label={kind === 'admin-ticket' ? 'Assunto' : 'Nome do contato'}><input name="title" required maxLength={200} defaultValue={record?.title}/></Field>
      <Field label="Situação"><select name="status" defaultValue={record?.status || statuses[0]}>{statuses.map(s => <option key={s}>{s}</option>)}</select></Field>
      {tenants && <Field label="Empresa"><select name="tenantId" defaultValue={record?.fields.tenantId ?? new URLSearchParams(location.search).get('novo') ?? ''}><option value="">—</option>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>}
      {fields.map(([k, l, opts]) => <Field key={k} label={l}>{opts ? <select name={k} defaultValue={record?.fields[k] ?? opts[0]}>{opts.map(o => <option key={o}>{o}</option>)}</select>
        : <input name={k} defaultValue={record?.fields[k]} type={k === 'nextContact' ? 'date' : k === 'email' ? 'email' : 'text'} maxLength={500}/>}</Field>)}
    </div><Button type="submit" variant="primary" loading={pending}>Salvar</Button></form>
    {record && <><h3>Histórico</h3><Timeline items={record.history}/>
      <Field label="Comentário"><textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={4000}/></Field>
      {kind === 'admin-ticket' && <label><input type="checkbox" checked={internal} onChange={e => setInternal(e.target.checked)}/> Nota interna (desmarque para responder à empresa: ela recebe uma notificação)</label>}
      <Button icon={<Send size={15}/>} disabled={comment.trim().length < 2} onClick={() => void send()}>{internal ? 'Adicionar nota' : 'Enviar resposta'}</Button></>}
    {error && <p role="alert" className="field-error">{error}</p>}</div></Modal>;
}

const LEAD_STAGES = ['Novo', 'Primeiro contato', 'Demonstração agendada', 'Demonstração realizada', 'Em negociação', 'Teste iniciado', 'Convertido', 'Perdido'];
export function Leads() {
  const [params] = useSearchParams();
  const q = useQuery(() => rows<RecordRow>('records', 'id,kind,title,status,date,fields,history', b => b.eq('kind', 'admin-lead').is('tenant_id', null).order('date', { ascending: false })), []);
  const plans = useQuery(() => rows<PlanRow>('plans', 'id,name'), []);
  const [view, setView] = useState<'kanban' | 'tabela'>('kanban'), [edit, setEdit] = useState<RecordRow | 'new' | null>(null);
  useEffect(() => { const id = params.get('id'); if (id && q.data) setEdit(q.data.find(r => r.id === id) ?? null); }, [params, q.data]);
  const move = async (r: RecordRow, status: string) => { await call('admin_save_record', { p: { id: r.id, kind: 'admin-lead', title: r.title, status, fields: r.fields } }); q.reload(); };
  const fields: [string, string, string[]?][] = [['company', 'Empresa'], ['business', 'Tipo de negócio', ['Oficina mecânica', 'Motopeças', 'Autopeças', 'Centro automotivo', 'Outro']], ['email', 'E-mail'], ['phone', 'WhatsApp'],
    ['source', 'Origem', ['Landing page', 'Indicação', 'Instagram', 'Google', 'Evento', 'Outro']], ['plan', 'Plano pretendido', ['—', ...(plans.data?.map(p => p.name) ?? [])]], ['owner', 'Responsável'], ['nextContact', 'Próximo contato'], ['message', 'Observações']];
  const conv = q.data ? Math.round(q.data.filter(r => r.status === 'Convertido').length / Math.max(1, q.data.filter(r => ['Convertido', 'Perdido'].includes(r.status)).length) * 100) : 0;
  return <div className="page"><PageHeader title="Leads comerciais" subtitle={`CRM do PISTEC (não é o CRM das lojas). Leads da landing entram como "Novo". Conversão (fechados): ${conv}%.`}>
    <Tabs<'kanban' | 'tabela'> label="Visualização" value={view} onChange={setView} items={[['kanban', 'Funil'], ['tabela', 'Tabela']]}/><Button variant="primary" icon={<Plus size={15}/>} onClick={() => setEdit('new')}>Novo lead</Button></PageHeader>
    <Loaded q={q}>{list => !list.length ? <EmptyState title="Nenhum lead ainda" text="Contatos enviados pelo formulário da landing aparecem aqui automaticamente. Você também pode cadastrar manualmente." action={<Button variant="primary" onClick={() => setEdit('new')}>Cadastrar lead</Button>}/>
      : view === 'kanban' ? <div className="kanban" data-tour="admin-leads">{LEAD_STAGES.map(s => <section key={s} className="kanban-col" aria-label={s}><header>{s}<span className="count">{list.filter(r => r.status === s).length}</span></header>
        <div className="kanban-list">{list.filter(r => r.status === s).map(r => <article key={r.id} className="kanban-card" style={{ cursor: 'default' }}><button className="row-link" onClick={() => setEdit(r)}>{r.title}</button><small>{r.fields.company || r.fields.email}</small>
          <select aria-label={`Mover ${r.title}`} value={r.status} onChange={e => void move(r, e.target.value)}>{LEAD_STAGES.map(x => <option key={x}>{x}</option>)}</select></article>)}</div></section>)}</div>
      : <Panel><AdvancedTable caption="Leads" rows={list} onRow={setEdit} search={r => `${r.title} ${Object.values(r.fields).join(' ')}`} columns={[{ key: 'title', label: 'Contato', sort: r => r.title }, { key: 'company', label: 'Empresa', render: r => r.fields.company || '—' },
        { key: 'email', label: 'E-mail', render: r => r.fields.email || '—' }, { key: 'phone', label: 'WhatsApp', render: r => r.fields.phone || '—' }, { key: 'status', label: 'Etapa', sort: r => r.status, render: r => <StatusBadge>{r.status}</StatusBadge> },
        { key: 'next', label: 'Próximo contato', sort: r => r.fields.nextContact ?? '', render: r => r.fields.nextContact ? date(r.fields.nextContact) : '—' }, { key: 'date', label: 'Entrada', sort: r => r.date, render: r => date(r.date) }]}/></Panel>}</Loaded>
    {edit && <RecordEditor kind="admin-lead" record={edit === 'new' ? null : edit} statuses={LEAD_STAGES} fields={fields} onClose={() => setEdit(null)} onSaved={q.reload}/>}
  </div>;
}

const TICKET_STATUS = ['Aberto', 'Em triagem', 'Em atendimento', 'Aguardando cliente', 'Resolvido', 'Encerrado'];
const CATEGORIES = ['Acesso', 'Cadastro', 'Produtos', 'Estoque', 'PDV', 'Financeiro', 'Ordens de serviço', 'Assinaturas', 'Pagamentos', 'WhatsApp', 'Notificações', 'IA', 'Problemas técnicos', 'Outros'];
export function Support() {
  const [params] = useSearchParams();
  const q = useQuery(async () => { const [t, tenants] = await Promise.all([rows<RecordRow>('records', 'id,kind,title,status,date,fields,history', b => b.eq('kind', 'admin-ticket').is('tenant_id', null).order('date', { ascending: false })), rows<TenantRow>('tenants', 'id,name')]); return { tickets: t, tenants }; }, []);
  const [edit, setEdit] = useState<RecordRow | 'new' | null>(params.get('novo') ? 'new' : null), [filter, setFilter] = useState('abertos');
  useEffect(() => { const id = params.get('id'); if (id && q.data) setEdit(q.data.tickets.find(r => r.id === id) ?? null); }, [params, q.data]);
  const sla = (r: RecordRow) => { const h = { Crítica: 4, Alta: 24, Média: 48, Baixa: 72 }[r.fields.priority ?? 'Média'] ?? 48; const late = !['Resolvido', 'Encerrado'].includes(r.status) && Date.now() - new Date(r.date).getTime() > h * 3600e3; return late ? 'Atrasado' : `${h} h`; };
  const list = (q.data?.tickets ?? []).filter(r => filter === 'todos' || (filter === 'abertos' ? !['Resolvido', 'Encerrado'].includes(r.status) : r.status === filter));
  return <div className="page"><PageHeader title="Suporte e chamados" subtitle="Atendimento aos lojistas. Notas internas não aparecem para o cliente; respostas geram notificação na empresa.">
    <select aria-label="Filtro" value={filter} onChange={e => setFilter(e.target.value)}><option value="abertos">Em aberto</option><option value="todos">Todos</option>{TICKET_STATUS.map(s => <option key={s}>{s}</option>)}</select>
    <Button variant="primary" icon={<Plus size={15}/>} onClick={() => setEdit('new')}>Novo chamado</Button></PageHeader>
    <Panel><Loaded q={q}>{d => d.tickets.length ? <AdvancedTable caption="Chamados" tour="admin-support" rows={list} onRow={setEdit} search={r => `${r.title} ${r.fields.category ?? ''} ${d.tenants.find(t => t.id === r.fields.tenantId)?.name ?? ''}`} columns={[
      { key: 'n', label: 'Nº', render: r => <code>{r.id.slice(0, 6)}</code> }, { key: 'title', label: 'Assunto', sort: r => r.title }, { key: 'tenant', label: 'Empresa', render: r => d.tenants.find(t => t.id === r.fields.tenantId)?.name ?? '—' },
      { key: 'cat', label: 'Categoria', render: r => r.fields.category ?? '—' }, { key: 'prio', label: 'Prioridade', sort: r => ['Crítica', 'Alta', 'Média', 'Baixa'].indexOf(r.fields.priority ?? 'Média'), render: r => <StatusBadge>{r.fields.priority ?? 'Média'}</StatusBadge> },
      { key: 'status', label: 'Situação', sort: r => r.status, render: r => <StatusBadge>{r.status}</StatusBadge> }, { key: 'sla', label: 'SLA', render: sla }, { key: 'owner', label: 'Responsável', render: r => r.fields.assignee || '—' }, { key: 'date', label: 'Aberto em', sort: r => r.date, render: r => date(r.date) },
    ]}/> : <EmptyState title="Nenhum chamado" text="Registre aqui os atendimentos aos lojistas (por WhatsApp, e-mail ou telefone) para acompanhar prazo e histórico." action={<Button variant="primary" onClick={() => setEdit('new')}>Abrir chamado</Button>}/>}</Loaded></Panel>
    {edit && <RecordEditor kind="admin-ticket" record={edit === 'new' ? null : edit} statuses={TICKET_STATUS} tenants={q.data?.tenants}
      fields={[['requester', 'Solicitante'], ['category', 'Categoria', CATEGORIES], ['priority', 'Prioridade', ['Média', 'Alta', 'Crítica', 'Baixa']], ['assignee', 'Responsável'], ['description', 'Descrição']]} onClose={() => setEdit(null)} onSaved={q.reload}/>}
  </div>;
}

export function Broadcasts() {
  const q = useQuery(async () => { const [h, plans, tenants] = await Promise.all([
    rows<{ id: number; action: string; created_at: string; data: { audience?: string } }>('audit_logs', 'id,action,created_at,data', b => b.like('action', 'Comunicado%').order('id', { ascending: false }).limit(50)).catch(() => []),
    rows<PlanRow>('plans', 'id,name'), rows<TenantRow>('tenants', 'id,name,status')]); return { history: h, plans, tenants }; }, []);
  const [title, setTitle] = useState(''), [body, setBody] = useState(''), [audience, setAudience] = useState('all'), [selected, setSelected] = useState<string[]>([]), [confirm, setConfirm] = useState(false), [msg, setMsg] = useState('');
  const target = audience === 'ids' ? `ids:${selected.join(',')}` : audience;
  const count = useMemo(() => (q.data?.tenants ?? []).filter(t => audience === 'all' || (audience === 'trial' && t.status === 'Teste') || (audience === 'active' && t.status === 'Ativa') || (audience === 'overdue' && ['Vencida', 'Suspensa'].includes(t.status)) || (audience.startsWith('plan:') && (t as TenantRow).plan_id === audience.slice(5)) || (audience === 'ids' && selected.includes(t.id))).length, [q.data, audience, selected]);
  return <div className="page"><PageHeader title="Comunicados" subtitle="Aviso dentro do sistema para as empresas escolhidas. Quem ativou notificações recebe também por push, conforme as preferências de cada usuário."/>
    {msg && <p role="status" className="callout">{msg}</p>}
    <div className="grid grid-2"><Panel title="Novo comunicado"><div className="stack" data-tour="admin-broadcast">
      <Field label="Título"><input value={title} onChange={e => setTitle(e.target.value)} maxLength={160}/></Field><Field label="Mensagem"><textarea rows={5} value={body} onChange={e => setBody(e.target.value)} maxLength={2000}/></Field>
      <Field label="Público"><select value={audience} onChange={e => setAudience(e.target.value)}><option value="all">Todas as empresas</option><option value="trial">Empresas em teste</option><option value="active">Empresas ativas</option><option value="overdue">Inadimplentes e suspensas</option>
        {q.data?.plans.map(p => <option key={p.id} value={`plan:${p.id}`}>Plano {p.name}</option>)}<option value="ids">Empresas selecionadas</option></select></Field>
      {audience === 'ids' && <fieldset className="scroll-box"><legend>Empresas</legend>{q.data?.tenants.map(t => <label key={t.id} style={{ display: 'block' }}><input type="checkbox" checked={selected.includes(t.id)} onChange={e => setSelected(s => e.target.checked ? [...s, t.id] : s.filter(x => x !== t.id))}/> {t.name}</label>)}</fieldset>}
      <p className="muted small">Canais: aviso no sistema + push (para quem ativou). E-mail e WhatsApp em massa não são enviados por aqui.</p>
      <Button variant="primary" disabled={!title.trim() || !body.trim() || !count} onClick={() => setConfirm(true)}>Revisar e publicar ({count} empresa{count === 1 ? '' : 's'})</Button></div></Panel>
      <Panel title="Prévia"><div className="notification-preview"><strong>{title || 'Título do comunicado'}</strong><p>{body || 'A mensagem aparece aqui como o lojista verá em Notificações.'}</p></div></Panel></div>
    <Panel title="Histórico"><Loaded q={q}>{d => d.history.length ? <ul className="list-rows">{d.history.map(h => <li key={h.id}><span>{h.action}</span><small>{new Date(h.created_at).toLocaleString('pt-BR')} · {h.data?.audience}</small></li>)}</ul> : <p className="muted">Nenhum comunicado publicado.</p>}</Loaded></Panel>
    <ConfirmAction open={confirm} danger title="Publicar comunicado" confirmLabel={`Publicar para ${count} empresa(s)`} needReason={false} onClose={() => setConfirm(false)}
      description={<p>O comunicado será entregue a <strong>{count}</strong> empresa(s) e não pode ser desfeito. A ação fica registrada na auditoria.</p>}
      onConfirm={async () => { const n = await call<number>('admin_broadcast', { p_title: title, p_body: body, p_audience: target }); setMsg(`Comunicado publicado para ${n} empresa(s).`); setTitle(''); setBody(''); q.reload(); }}/>
  </div>;
}

export function Alerts() {
  const q = useQuery(async () => { const { data, error } = await supabase.from('notifications').select('id,type,title,body,created_at,read_at').is('tenant_id', null).order('created_at', { ascending: false }).limit(100); if (error) throw error; return data ?? []; }, []);
  const [filter, setFilter] = useState<'unread' | 'all'>('unread');
  const markAll = async (ids: string[]) => { await call('mark_notifications_read', { p_ids: ids }); q.reload(); };
  const list = (q.data ?? []).filter(n => filter === 'all' || !n.read_at);
  return <div className="page"><PageHeader title="Alertas da plataforma" subtitle="Eventos para o Super Admin: novas empresas, pagamentos, testes terminando, cobranças vencidas, suspensões e conciliações.">
    <Tabs<'unread' | 'all'> label="Filtro" value={filter} onChange={setFilter} items={[['unread', 'Não lidos'], ['all', 'Todos']]}/>{list.some(n => !n.read_at) && <Button onClick={() => void markAll(list.filter(n => !n.read_at).map(n => n.id))}>Marcar todos como lidos</Button>}
    <Link className="btn ghost" to="/admin/notificacoes">Push e preferências</Link></PageHeader>
    <Panel><Loaded q={q}>{() => list.length ? <ul className="list-rows">{list.map(n => <li key={n.id}><span><strong>{n.title}</strong><br/><small className="muted">{n.body}</small></span><small>{new Date(n.created_at).toLocaleString('pt-BR')}</small>{!n.read_at && <Button onClick={() => void markAll([n.id])}>Lido</Button>}</li>)}</ul>
      : <p className="muted">{filter === 'unread' ? 'Nenhum alerta novo.' : 'Nenhum alerta ainda.'}</p>}</Loaded></Panel></div>;
}
