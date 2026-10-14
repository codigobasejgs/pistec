import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Building2, CircleDollarSign, Download, Plus, ShieldAlert, TicketCheck, TrendingUp } from 'lucide-react';
import { useDemo } from '../../store';
import { createTenant } from '../../domain';
import { date, exportCsv, money, parseMoney, today, uid } from '../../lib';
import { Badge, DataTable, Empty, Field, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { BillingInvoice, DemoState, OperationalRecord, Plan, Tenant } from '../../types';
import { email, platformRecord, required } from '../public/model';
import { useAction } from '../public/useAction';
import '../public/public.css';

const tenantStatuses = ['Ativa', 'Teste', 'Suspensa', 'Cancelada'];
const invoiceStatuses = ['Pendente', 'Paga', 'Cancelada'];
const log = (draft: DemoState, action: string) => draft.audit.push({ id: uid(), tenantId: 'platform', date: new Date().toISOString(), action });
const invoiceStatus = (invoice: BillingInvoice) => invoice.status === 'Pendente' && invoice.dueDate < today() ? 'Vencida' : invoice.status;
const text = (form: FormData, key: string) => String(form.get(key) ?? '').trim();
const isoDate = (value: string) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Informe uma data válida.'); return value; };
const count = (value: string, label: string) => { const n = Number(value); if (!Number.isSafeInteger(n) || n < 0) throw new Error(`${label}: informe um número inteiro positivo.`); return n; };

function Filters({ search, onSearch, status, onStatus, statuses, onExport, children }: { search: string; onSearch: (v: string) => void; status: string; onStatus: (v: string) => void; statuses: string[]; onExport: () => void; children?: ReactNode }) {
  return <div className="toolbar adm-filters"><input type="search" aria-label="Buscar" placeholder="Buscar…" value={search} onChange={e => onSearch(e.target.value)}/><select aria-label="Filtrar status" value={status} onChange={e => onStatus(e.target.value)}><option value="">Todos os status</option>{statuses.map(s => <option key={s}>{s}</option>)}</select><button className="btn ghost" onClick={onExport}><Download size={16}/>Exportar CSV</button>{children}</div>;
}
const matches = (values: unknown[], search: string) => !search || values.join(' ').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));

function Dashboard() {
  const { state } = useDemo();
  const kpi = useMemo(() => {
    const plans = new Map(state.plans.map(p => [p.id, p]));
    const active = state.tenants.filter(t => t.status === 'Ativa');
    const mrr = active.reduce((sum, t) => sum + (plans.get(t.planId)?.monthly ?? 0), 0);
    const overdue = state.invoices.filter(i => invoiceStatus(i) === 'Vencida');
    const received = state.invoices.filter(i => i.status === 'Paga').reduce((s, i) => s + i.amount, 0);
    const tickets = state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-ticket' && r.status !== 'Resolvido');
    const leads = state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-lead');
    return { active: active.length, trial: state.tenants.filter(t => t.status === 'Teste').length, mrr, overdue, received, tickets: tickets.length, leads };
  }, [state]);
  return <><PageHeader title="Painel da plataforma" subtitle="Indicadores SaaS derivados das assinaturas e cobranças simuladas."/><p className="adm-sim">Ambiente simulado: nenhuma cobrança, integração ou notificação real.</p><div className="grid grid-4"><Stat label="Empresas ativas" value={kpi.active} hint={`${kpi.trial} em teste`} icon={<Building2 size={18}/>}/><Stat label="MRR simulado" value={money(kpi.mrr)} hint={`ARR ${money(kpi.mrr * 12)}`} icon={<TrendingUp size={18}/>}/><Stat label="Recebido" value={money(kpi.received)} hint={`${kpi.overdue.length} cobranças vencidas`} icon={<CircleDollarSign size={18}/>} tone={kpi.overdue.length ? 'red' : 'green'}/><Stat label="Chamados abertos" value={kpi.tickets} hint={`${kpi.leads.length} leads`} icon={<TicketCheck size={18}/>}/></div><div className="grid grid-2"><Panel title="Cobranças vencidas"><DataTable columns={[{ key: 'tenantId', label: 'Empresa', render: (i: BillingInvoice) => state.tenants.find(t => t.id === i.tenantId)?.name ?? 'Removida' }, { key: 'amount', label: 'Valor', render: (i: BillingInvoice) => money(i.amount) }, { key: 'dueDate', label: 'Vencimento', render: (i: BillingInvoice) => date(i.dueDate) }]} rows={kpi.overdue}/></Panel><Panel title="Leads recentes"><DataTable columns={[{ key: 'title', label: 'Nome' }, { key: 'email', label: 'E-mail', render: (r: OperationalRecord) => r.fields.email }, { key: 'date', label: 'Data', render: (r: OperationalRecord) => date(r.date) }]} rows={[...kpi.leads].reverse()}/></Panel></div></>;
}

function Companies({ subscriptions = false }: { subscriptions?: boolean }) {
  const { state, mutate } = useDemo(); const action = useAction();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<Tenant | 'new'>();
  const planName = (id: string) => state.plans.find(p => p.id === id)?.name ?? 'Sem plano';
  const rows = state.tenants.filter(t => (!status || t.status === status) && matches([t.name, t.legalName, t.document, t.owner, t.email, t.slug], search));
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const current = edit;
    void action.run(async () => {
      const planId = text(form, 'planId'); const st = text(form, 'status');
      if (!state.plans.some(p => p.id === planId)) throw new Error('Selecione um plano válido.');
      if (!tenantStatuses.includes(st)) throw new Error('Status inválido.');
      const values = { name: required(text(form, 'name'), 'Nome'), legalName: required(text(form, 'legalName'), 'Razão social'), document: text(form, 'document').replace(/\D/g, ''), owner: required(text(form, 'owner'), 'Responsável'), email: email(text(form, 'email')), profile: required(text(form, 'profile'), 'Perfil'), planId, status: st, dueDate: isoDate(text(form, 'dueDate')), notes: text(form, 'notes').slice(0, 2000) };
      await mutate(draft => {
        if (current === 'new') { const t = createTenant(draft, values); log(draft, `Empresa criada: ${t.name}`); return; }
        const t = draft.tenants.find(x => x.id === current?.id); if (!t) throw new Error('Empresa não encontrada.');
        const changes = [t.planId !== values.planId && `plano ${planName(t.planId)} → ${planName(values.planId)}`, t.status !== values.status && `status ${t.status} → ${values.status}`].filter(Boolean).join(', ');
        Object.assign(t, values); log(draft, `Empresa ${t.name} atualizada${changes ? `: ${changes}` : ''}`);
      });
      setEdit(undefined);
    });
  }
  function remove(t: Tenant) {
    if (state.sales.some(s => s.tenantId === t.id) || state.invoices.some(i => i.tenantId === t.id)) { void action.run(() => { throw new Error('Empresa com vendas ou cobranças não pode ser excluída. Altere o status para Cancelada.'); }); return; }
    if (!window.confirm(`Excluir ${t.name} e seus dados demonstrativos? Esta ação não pode ser desfeita.`)) return;
    void action.run(() => mutate(draft => {
      const keep = <T extends { tenantId: string }>(list: T[]) => list.filter(x => x.tenantId !== t.id);
      draft.tenants = draft.tenants.filter(x => x.id !== t.id); draft.branches = keep(draft.branches); draft.products = keep(draft.products); draft.customers = keep(draft.customers); draft.balances = keep(draft.balances); draft.movements = keep(draft.movements); draft.cashRegisters = keep(draft.cashRegisters); draft.finances = keep(draft.finances); draft.records = keep(draft.records);
      log(draft, `Empresa excluída: ${t.name}`);
    }), 'Empresa excluída.');
  }
  const form = edit === 'new' ? undefined : edit;
  return <><PageHeader title={subscriptions ? 'Assinaturas' : 'Empresas'} subtitle={subscriptions ? 'Plano, status e vencimento por empresa.' : 'Cadastro das empresas clientes da plataforma.'}>{!subscriptions && <button className="btn primary" onClick={() => setEdit('new')}><Plus size={16}/>Nova empresa</button>}</PageHeader><Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={tenantStatuses} onExport={() => exportCsv(subscriptions ? 'assinaturas' : 'empresas', rows.map(t => ({ empresa: t.name, documento: t.document, responsavel: t.owner, email: t.email, plano: planName(t.planId), status: t.status, vencimento: t.dueDate })))}/>{action.error && <p role="alert" className="adm-error">{action.error}</p>}<DataTable columns={subscriptions ? [{ key: 'name', label: 'Empresa' }, { key: 'planId', label: 'Plano', render: (t: Tenant) => planName(t.planId) }, { key: 'monthly', label: 'Mensal', render: (t: Tenant) => money(state.plans.find(p => p.id === t.planId)?.monthly ?? 0) }, { key: 'status', label: 'Status', render: (t: Tenant) => <Badge>{t.status}</Badge> }, { key: 'dueDate', label: 'Vencimento', render: (t: Tenant) => date(t.dueDate) }] : [{ key: 'name', label: 'Empresa' }, { key: 'owner', label: 'Responsável' }, { key: 'profile', label: 'Perfil' }, { key: 'planId', label: 'Plano', render: (t: Tenant) => planName(t.planId) }, { key: 'status', label: 'Status', render: (t: Tenant) => <Badge>{t.status}</Badge> }, { key: 'actions', label: 'Ações', render: (t: Tenant) => <button className="btn danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(t); }}>Excluir</button> }]} rows={rows} onRow={setEdit}/><Modal title={form ? `Editar ${form.name}` : 'Nova empresa'} open={!!edit} onClose={() => setEdit(undefined)}><form className="form-grid" onSubmit={save}>{([['name', 'Nome fantasia'], ['legalName', 'Razão social'], ['document', 'CPF/CNPJ'], ['owner', 'Responsável'], ['email', 'E-mail'], ['profile', 'Perfil']] as const).map(([key, label]) => <Field key={key} label={label}><input name={key} defaultValue={form?.[key] ?? (key === 'profile' ? 'Oficina' : '')} required={key !== 'document'} maxLength={key === 'email' ? 254 : 160} type={key === 'email' ? 'email' : 'text'}/></Field>)}<Field label="Plano"><select name="planId" defaultValue={form?.planId ?? state.plans[0]?.id}>{state.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Status"><select name="status" defaultValue={form?.status ?? 'Teste'}>{tenantStatuses.map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Vencimento"><input name="dueDate" type="date" required defaultValue={form?.dueDate?.slice(0, 10) ?? today()}/></Field><Field label="Observações internas"><textarea name="notes" rows={3} maxLength={2000} defaultValue={form?.notes}/></Field><div className="toolbar"><button className="btn primary" disabled={action.pending}>{action.pending ? 'Salvando…' : 'Salvar'}</button></div></form></Modal></>;
}

function Plans() {
  const { state, mutate } = useDemo(); const action = useAction(); const [edit, setEdit] = useState<Plan | 'new'>();
  const form = edit === 'new' ? undefined : edit;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); const current = form;
    void action.run(async () => {
      const plan: Plan = { id: current?.id ?? uid(), name: required(text(f, 'name'), 'Nome', 60), monthly: parseMoney(text(f, 'monthly')), quarterly: parseMoney(text(f, 'quarterly')), annual: parseMoney(text(f, 'annual')), users: count(text(f, 'users'), 'Usuários'), branches: count(text(f, 'branches'), 'Filiais'), products: count(text(f, 'products'), 'Produtos'), whatsapp: count(text(f, 'whatsapp'), 'WhatsApp'), trialDays: count(text(f, 'trialDays'), 'Teste'), features: text(f, 'features').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30) };
      await mutate(draft => { const i = draft.plans.findIndex(p => p.id === plan.id); if (i >= 0) draft.plans[i] = plan; else draft.plans.push(plan); log(draft, `Plano ${i >= 0 ? 'atualizado' : 'criado'}: ${plan.name}`); });
      setEdit(undefined);
    });
  }
  function remove(plan: Plan) {
    if (state.tenants.some(t => t.planId === plan.id)) { void action.run(() => { throw new Error('Plano em uso por empresas. Migre as assinaturas antes de excluir.'); }); return; }
    if (window.confirm(`Excluir o plano ${plan.name}?`)) void action.run(() => mutate(draft => { draft.plans = draft.plans.filter(p => p.id !== plan.id); log(draft, `Plano excluído: ${plan.name}`); }), 'Plano excluído.');
  }
  const cents = (v?: number) => v === undefined ? '' : (v / 100).toFixed(2).replace('.', ',');
  return <><PageHeader title="Planos" subtitle="Preços em total por período. Exibidos no site público."><button className="btn ghost" onClick={() => exportCsv('planos', state.plans.map(p => ({ ...p, features: p.features.join(' | ') })))}><Download size={16}/>Exportar</button><button className="btn primary" onClick={() => setEdit('new')}><Plus size={16}/>Novo plano</button></PageHeader>{action.error && <p role="alert" className="adm-error">{action.error}</p>}<DataTable columns={[{ key: 'name', label: 'Plano' }, { key: 'monthly', label: 'Mensal', render: (p: Plan) => money(p.monthly) }, { key: 'quarterly', label: 'Trimestral', render: (p: Plan) => money(p.quarterly) }, { key: 'annual', label: 'Anual', render: (p: Plan) => money(p.annual) }, { key: 'users', label: 'Usuários' }, { key: 'tenants', label: 'Empresas', render: (p: Plan) => state.tenants.filter(t => t.planId === p.id).length }, { key: 'actions', label: 'Ações', render: (p: Plan) => <button className="btn danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(p); }}>Excluir</button> }]} rows={state.plans} onRow={setEdit}/><Modal title={form ? `Editar ${form.name}` : 'Novo plano'} open={!!edit} onClose={() => setEdit(undefined)}><form className="form-grid" onSubmit={save}><Field label="Nome"><input name="name" required maxLength={60} defaultValue={form?.name}/></Field>{(['monthly', 'quarterly', 'annual'] as const).map((k, i) => <Field key={k} label={`Total ${['mensal', 'trimestral', 'anual'][i]} (R$)`}><input name={k} required inputMode="decimal" defaultValue={cents(form?.[k])}/></Field>)}{(['users', 'branches', 'products', 'whatsapp', 'trialDays'] as const).map((k, i) => <Field key={k} label={['Usuários', 'Filiais', 'Produtos', 'Mensagens WhatsApp', 'Dias de teste'][i]}><input name={k} type="number" min={0} step={1} required defaultValue={form?.[k] ?? 0}/></Field>)}<Field label="Recursos (um por linha)"><textarea name="features" rows={5} defaultValue={form?.features.join('\n')}/></Field><div className="toolbar"><button className="btn primary" disabled={action.pending}>{action.pending ? 'Salvando…' : 'Salvar'}</button></div></form></Modal></>;
}

function Invoices({ finance = false }: { finance?: boolean }) {
  const { state, mutate } = useDemo(); const action = useAction(); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState(false);
  const tenantName = (id: string) => state.tenants.find(t => t.id === id)?.name ?? 'Removida';
  const rows = state.invoices.filter(i => (!status || invoiceStatus(i) === status) && matches([tenantName(i.tenantId), i.reference, i.provider], search));
  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const tenantId = text(f, 'tenantId'); const provider = text(f, 'provider');
      if (!state.tenants.some(t => t.id === tenantId)) throw new Error('Selecione uma empresa.');
      if (provider !== 'Asaas' && provider !== 'InfinitePay') throw new Error('Provedor inválido.');
      const reference = required(text(f, 'reference'), 'Referência', 60);
      const invoice: BillingInvoice = { id: uid(), tenantId, amount: parseMoney(text(f, 'amount')), status: 'Pendente', dueDate: isoDate(text(f, 'dueDate')), provider, reference };
      if (invoice.amount <= 0) throw new Error('Valor deve ser maior que zero.');
      await mutate(draft => { if (draft.invoices.some(i => i.tenantId === tenantId && i.reference === reference && i.status !== 'Cancelada')) throw new Error('Já existe cobrança com esta referência para a empresa.'); draft.invoices.push(invoice); log(draft, `Cobrança simulada ${reference} criada para ${tenantName(tenantId)}`); });
      setOpen(false);
    }, 'Cobrança simulada criada. Nada foi enviado ao provedor.');
  }
  const transition = (invoice: BillingInvoice, next: string) => { if (next === 'Cancelada' && !window.confirm('Cancelar esta cobrança simulada?')) return; void action.run(() => mutate(draft => { const i = draft.invoices.find(x => x.id === invoice.id); if (!i || i.status !== 'Pendente') throw new Error('Somente cobranças pendentes podem mudar de status.'); i.status = next; log(draft, `Cobrança ${i.reference}: ${next}`); }), `Cobrança marcada como ${next.toLowerCase()} (simulação).`); };
  const sum = (list: BillingInvoice[]) => list.reduce((s, i) => s + i.amount, 0);
  const byMonth = useMemo(() => Object.entries(state.invoices.reduce<Record<string, { paid: number; pending: number; overdue: number }>>((acc, i) => { const m = i.dueDate.slice(0, 7); const b = acc[m] ??= { paid: 0, pending: 0, overdue: 0 }; const s = invoiceStatus(i); if (s === 'Paga') b.paid += i.amount; else if (s === 'Vencida') b.overdue += i.amount; else if (s === 'Pendente') b.pending += i.amount; return acc; }, {})).sort(([a], [b]) => b.localeCompare(a)).map(([id, v]) => ({ id, ...v })), [state.invoices]);
  if (finance) return <><PageHeader title="Financeiro SaaS" subtitle="Receita da plataforma a partir das cobranças simuladas. Não inclui o financeiro das lojas."><button className="btn ghost" onClick={() => exportCsv('financeiro-saas', byMonth.map(m => ({ mes: m.id, recebido: money(m.paid), pendente: money(m.pending), vencido: money(m.overdue) })))}><Download size={16}/>Exportar</button></PageHeader><div className="grid grid-3"><Stat label="Recebido" value={money(sum(state.invoices.filter(i => i.status === 'Paga')))} tone="green"/><Stat label="A receber" value={money(sum(state.invoices.filter(i => invoiceStatus(i) === 'Pendente')))}/><Stat label="Vencido" value={money(sum(state.invoices.filter(i => invoiceStatus(i) === 'Vencida')))} tone="red"/></div><Panel title="Por mês de vencimento"><DataTable columns={[{ key: 'id', label: 'Mês' }, { key: 'paid', label: 'Recebido', render: (m: { paid: number }) => money(m.paid) }, { key: 'pending', label: 'Pendente', render: (m: { pending: number }) => money(m.pending) }, { key: 'overdue', label: 'Vencido', render: (m: { overdue: number }) => money(m.overdue) }]} rows={byMonth}/></Panel></>;
  return <><PageHeader title="Cobranças" subtitle="Faturas SaaS simuladas (Asaas/InfinitePay sem conexão real)."><button className="btn primary" disabled={!state.tenants.length} onClick={() => setOpen(true)}><Plus size={16}/>Nova cobrança</button></PageHeader><Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={[...invoiceStatuses, 'Vencida']} onExport={() => exportCsv('cobrancas', rows.map(i => ({ empresa: tenantName(i.tenantId), referencia: i.reference, valor: money(i.amount), vencimento: i.dueDate, status: invoiceStatus(i), provedor: i.provider })))}/>{action.error && <p role="alert" className="adm-error">{action.error}</p>}<DataTable columns={[{ key: 'reference', label: 'Referência' }, { key: 'tenantId', label: 'Empresa', render: (i: BillingInvoice) => tenantName(i.tenantId) }, { key: 'amount', label: 'Valor', render: (i: BillingInvoice) => money(i.amount) }, { key: 'dueDate', label: 'Vencimento', render: (i: BillingInvoice) => date(i.dueDate) }, { key: 'status', label: 'Status', render: (i: BillingInvoice) => <Badge>{invoiceStatus(i)}</Badge> }, { key: 'provider', label: 'Provedor' }, { key: 'actions', label: 'Ações', render: (i: BillingInvoice) => i.status === 'Pendente' ? <span className="toolbar"><button className="btn" disabled={action.pending} onClick={() => transition(i, 'Paga')}>Baixar</button><button className="btn danger" disabled={action.pending} onClick={() => transition(i, 'Cancelada')}>Cancelar</button></span> : '—' }]} rows={rows}/><Modal title="Nova cobrança simulada" open={open} onClose={() => setOpen(false)}><form className="form-grid" onSubmit={create}><Field label="Empresa"><select name="tenantId" required>{state.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field><Field label="Valor (R$)"><input name="amount" required inputMode="decimal"/></Field><Field label="Vencimento"><input name="dueDate" type="date" required defaultValue={today()}/></Field><Field label="Referência"><input name="reference" required maxLength={60} defaultValue={today().slice(0, 7)}/></Field><Field label="Provedor (simulado)"><select name="provider"><option>Asaas</option><option>InfinitePay</option></select></Field><div className="toolbar"><button className="btn primary" disabled={action.pending}>{action.pending ? 'Salvando…' : 'Criar'}</button></div></form></Modal></>;
}

type FieldDef = { key: string; label: string; type?: string; options?: string[] };
function Records({ kind, title, subtitle, fields, statuses }: { kind: string; title: string; subtitle: string; fields: FieldDef[]; statuses: string[] }) {
  const { state, mutate } = useDemo(); const action = useAction(); const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<OperationalRecord | 'new'>();
  const rows = state.records.filter(r => r.tenantId === 'platform' && r.kind === kind && (!status || r.status === status) && matches([r.title, ...Object.values(r.fields)], search));
  const form = edit === 'new' ? undefined : edit;
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget); const current = form;
    void action.run(async () => {
      const values = Object.fromEntries(fields.map(d => { const v = text(f, d.key).slice(0, 2000); if (d.type === 'email' && v) email(v); if (d.options && !d.options.includes(v) && v !== current?.fields[d.key]) throw new Error(`${d.label}: opção inválida.`); return [d.key, v]; }));
      const name = required(text(f, 'title'), 'Título'); const st = text(f, 'status'); if (!statuses.includes(st)) throw new Error('Status inválido.');
      const amount = fields.some(d => d.key === 'amount') ? parseMoney(values.amount || '0') : 0;
      await mutate(draft => {
        if (!current) { const r = platformRecord(uid(), kind, name, values, amount); r.status = st; draft.records.push(r); log(draft, `${title}: criado ${name}`); return; }
        const r = draft.records.find(x => x.id === current.id); if (!r) throw new Error('Registro não encontrado.');
        const now = new Date().toISOString(); if (r.status !== st) r.history.push({ date: now, text: `Status ${r.status} → ${st}` });
        Object.assign(r, { title: name, status: st, fields: { ...r.fields, ...values }, amount }); log(draft, `${title}: atualizado ${name}`);
      });
      setEdit(undefined);
    });
  }
  function remove(r: OperationalRecord) { if (window.confirm(`Excluir "${r.title}"?`)) void action.run(() => mutate(draft => { draft.records = draft.records.filter(x => x.id !== r.id); log(draft, `${title}: excluído ${r.title}`); }), 'Registro excluído.'); }
  const preview = fields.slice(0, 2);
  return <Panel title={title}><p className="muted">{subtitle}</p><Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={statuses} onExport={() => exportCsv(kind, rows.map(r => ({ titulo: r.title, status: r.status, data: r.date, ...r.fields })))}><button className="btn primary" onClick={() => setEdit('new')}><Plus size={16}/>Novo</button></Filters>{action.error && <p role="alert" className="adm-error">{action.error}</p>}<DataTable columns={[{ key: 'title', label: 'Título' }, ...preview.map(d => ({ key: d.key, label: d.label, render: (r: OperationalRecord) => r.fields[d.key] || '—' })), { key: 'status', label: 'Status', render: (r: OperationalRecord) => <Badge>{r.status}</Badge> }, { key: 'date', label: 'Criado', render: (r: OperationalRecord) => date(r.date) }, { key: 'actions', label: 'Ações', render: (r: OperationalRecord) => <button className="btn danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(r); }}>Excluir</button> }]} rows={rows} onRow={setEdit}/><Modal title={form ? form.title : `Novo — ${title}`} open={!!edit} onClose={() => setEdit(undefined)}><form className="form-grid" onSubmit={save}><Field label="Título"><input name="title" required maxLength={200} defaultValue={form?.title}/></Field><Field label="Status"><select name="status" defaultValue={form?.status ?? statuses[0]}>{statuses.map(s => <option key={s}>{s}</option>)}</select></Field>{fields.map(d => <Field key={d.key} label={d.label}>{d.options ? <select name={d.key} defaultValue={form?.fields[d.key]}>{d.options.map(o => <option key={o}>{o}</option>)}</select> : d.type === 'textarea' ? <textarea name={d.key} rows={3} maxLength={2000} defaultValue={form?.fields[d.key]}/> : <input name={d.key} type={d.type ?? 'text'} maxLength={254} defaultValue={form?.fields[d.key]}/>}</Field>)}{form && form.history.length > 0 && <ol className="adm-history">{form.history.map((h, i) => <li key={i}><time>{date(h.date)}</time> {h.text}</li>)}</ol>}<div className="toolbar"><button className="btn primary" disabled={action.pending}>{action.pending ? 'Salvando…' : 'Salvar'}</button></div></form></Modal></Panel>;
}

function Reports() {
  const { state } = useDemo(); const [search, setSearch] = useState('');
  const logs = [...state.audit].filter(a => a.tenantId === 'platform' && matches([a.action], search)).reverse();
  const exports: [string, () => Record<string, unknown>[]][] = [
    ['empresas', () => state.tenants.map(t => ({ empresa: t.name, plano: state.plans.find(p => p.id === t.planId)?.name, status: t.status, vencimento: t.dueDate }))],
    ['cobrancas', () => state.invoices.map(i => ({ referencia: i.reference, empresa: state.tenants.find(t => t.id === i.tenantId)?.name, valor: money(i.amount), status: invoiceStatus(i), vencimento: i.dueDate }))],
    ['leads', () => state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-lead').map(r => ({ nome: r.title, data: r.date, ...r.fields }))],
    ['logs-plataforma', () => logs.map(a => ({ data: a.date, acao: a.action }))],
  ];
  return <><PageHeader title="Relatórios e logs" subtitle="Exportações CSV locais e trilha de auditoria da plataforma."/><div className="toolbar">{exports.map(([name, rows]) => <button key={name} className="btn ghost" onClick={() => { const data = rows(); if (!data.length) window.alert('Nada para exportar.'); else exportCsv(name, data); }}><Download size={16}/>{name}</button>)}</div><Panel title="Logs da plataforma"><input type="search" aria-label="Buscar nos logs" placeholder="Buscar ação…" value={search} onChange={e => setSearch(e.target.value)}/><DataTable columns={[{ key: 'date', label: 'Data', render: (a: { date: string }) => new Date(a.date).toLocaleString('pt-BR') }, { key: 'action', label: 'Ação' }]} rows={logs}/></Panel></>;
}

function Settings() {
  const { state, mutate } = useDemo(); const action = useAction();
  const config = state.records.find(r => r.tenantId === 'platform' && r.kind === 'admin-config');
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const fields = { supportEmail: email(text(f, 'supportEmail')), defaultTrial: String(count(text(f, 'defaultTrial'), 'Dias de teste')), graceDays: String(count(text(f, 'graceDays'), 'Carência')), maintenance: f.get('maintenance') === 'on' ? 'sim' : 'não' };
      await mutate(draft => { const r = draft.records.find(x => x.tenantId === 'platform' && x.kind === 'admin-config'); if (r) r.fields = fields; else draft.records.push(platformRecord(uid(), 'admin-config', 'Configurações da plataforma', fields)); log(draft, 'Configurações da plataforma atualizadas'); });
    });
  }
  return <><PageHeader title="Configurações" subtitle="Parâmetros da plataforma, cupons e notas internas."/><Panel title="Parâmetros gerais"><form className="form-grid" onSubmit={save}><Field label="E-mail de suporte"><input name="supportEmail" type="email" required defaultValue={config?.fields.supportEmail ?? 'suporte@pistec.demo'}/></Field><Field label="Dias de teste padrão"><input name="defaultTrial" type="number" min={0} required defaultValue={config?.fields.defaultTrial ?? '14'}/></Field><Field label="Carência após vencimento (dias)"><input name="graceDays" type="number" min={0} required defaultValue={config?.fields.graceDays ?? '5'}/></Field><label className="pub-check"><input name="maintenance" type="checkbox" defaultChecked={config?.fields.maintenance === 'sim'}/><span>Exibir aviso de manutenção (simulado)</span></label>{action.error && <p role="alert" className="adm-error">{action.error}</p>}<div className="toolbar"><button className="btn primary" disabled={action.pending}>{action.pending ? 'Salvando…' : 'Salvar'}</button></div></form></Panel><Records kind="admin-cupom" title="Cupons" subtitle="Descontos demonstrativos; não aplicados a cobranças automaticamente." statuses={['Ativo', 'Inativo']} fields={[{ key: 'code', label: 'Código' }, { key: 'discount', label: 'Desconto (%)', type: 'number' }, { key: 'validUntil', label: 'Validade', type: 'date' }]}/><Records kind="admin-nota" title="Notas internas" subtitle="Anotações da equipe da plataforma." statuses={['Ativa', 'Arquivada']} fields={[{ key: 'body', label: 'Conteúdo', type: 'textarea' }]}/></>;
}

export default function Admin() {
  const { session, state } = useDemo(); const { pathname } = useLocation();
  const companyNames = ['—', ...state.tenants.map(t => t.name)];
  if (!session.admin) return <div className="page"><Panel><div className="adm-denied"><ShieldAlert size={40}/><h1>Acesso restrito</h1><p>Esta área exige o perfil Super Admin da demonstração.</p><Link className="btn primary" to="/demonstracao">Escolher perfil</Link></div></Panel></div>;
  const section = pathname.replace(/\/+$/, '').split('/')[2] ?? '';
  const pages: Record<string, ReactNode> = {
    '': <Dashboard/>, empresas: <Companies/>, assinaturas: <Companies subscriptions/>, planos: <Plans/>, cobrancas: <Invoices/>, financeiro: <Invoices finance/>, relatorios: <Reports/>, configuracoes: <Settings/>,
    suporte: <><PageHeader title="Central de suporte" subtitle="Chamados e avisos para as empresas."/><Records kind="admin-ticket" title="Chamados" subtitle="Atendimento às empresas clientes." statuses={['Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido']} fields={[{ key: 'company', label: 'Empresa', options: companyNames }, { key: 'priority', label: 'Prioridade', options: ['Baixa', 'Média', 'Alta'] }, { key: 'description', label: 'Descrição', type: 'textarea' }]}/><Records kind="admin-aviso" title="Avisos" subtitle="Comunicados exibidos às empresas (simulado)." statuses={['Rascunho', 'Publicado', 'Arquivado']} fields={[{ key: 'audience', label: 'Público', options: ['Todas', 'Em teste', 'Ativas'] }, { key: 'body', label: 'Mensagem', type: 'textarea' }]}/></>,
    integracoes: <><PageHeader title="Integrações" subtitle="Conectores simulados. Credenciais não são solicitadas nem armazenadas."/><Records kind="admin-integracao" title="Conectores" subtitle="Asaas, InfinitePay, WhatsApp e outros — apenas estados demonstrativos." statuses={['Desconectado', 'Conectado (simulado)', 'Erro (simulado)']} fields={[{ key: 'provider', label: 'Provedor', options: ['Asaas', 'InfinitePay', 'WhatsApp', 'E-mail', 'Outro'] }, { key: 'notes', label: 'Observações', type: 'textarea' }]}/></>,
    usuarios: <><PageHeader title="Administradores" subtitle="Equipe da plataforma. Sem senhas: acesso real exige autenticação no servidor."/><Records kind="admin-usuario" title="Usuários da plataforma" subtitle="Perfis administrativos demonstrativos." statuses={['Ativo', 'Inativo']} fields={[{ key: 'email', label: 'E-mail', type: 'email' }, { key: 'role', label: 'Função', options: ['Super Admin', 'Suporte', 'Financeiro', 'Comercial'] }]}/></>,
  };
  return <div className="page">{pages[section] ?? <Empty text="Seção administrativa não encontrada."/>}</div>;
}
