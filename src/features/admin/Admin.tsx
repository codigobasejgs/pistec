import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertCircle, Building2, CircleDollarSign, Download, FileText, Plus, ShieldAlert, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useDemo } from '../../store';
import { createTenant } from '../../domain';
import { date, exportCsv, money, parseMoney, today, uid } from '../../lib';
import { Badge, Button, ChartTooltip, DataTable, Empty, Field, Modal, PageHeader, Panel, Stat } from '../../ui';
import type { BillingInvoice, DemoState, OperationalRecord, Plan, Tenant } from '../../types';
import { email, formText, isoDate, required, wholeNumber } from '../public/model';
import { useAction, useFieldErrors } from '../public/useAction';
import { Coupons, SubscriptionInvoice } from './Coupons';
import { invoiceStatus, saasMetrics, shiftDate } from './metrics';
import '../public/public.css';

const CHART_COLORS = ['#007BFF', '#00E5FF', '#FFB020', '#10B981', '#94A3B8'];
const tenantStatuses = ['Ativa', 'Teste', 'Suspensa', 'Cancelada', 'Vencida'];
const invoiceStatuses = ['Pendente', 'Paga', 'Cancelada', 'Vencida'];
const log = (draft: DemoState, action: string) => draft.audit.push({ id: uid(), tenantId: 'platform', date: new Date().toISOString(), action });
const matches = (values: unknown[], search: string) => !search || values.join(' ').toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'));

function Filters({ search, onSearch, status, onStatus, statuses, onExport, children }: { search: string; onSearch: (v: string) => void; status: string; onStatus: (v: string) => void; statuses: string[]; onExport: () => void; children?: ReactNode }) {
  return <div className="toolbar adm-filters"><input type="search" aria-label="Buscar" placeholder="Buscar…" value={search} onChange={e => onSearch(e.target.value)}/><select aria-label="Filtrar status" value={status} onChange={e => onStatus(e.target.value)}><option value="">Todos os status</option>{statuses.map(s => <option key={s}>{s}</option>)}</select><Button variant="ghost" icon={<Download size={16}/>} onClick={onExport}>Exportar CSV</Button>{children}</div>;
}

function Dashboard() {
  const { state } = useDemo();
  const kpi = useMemo(() => saasMetrics(state, today()), [state]);
  const leads = useMemo(() => state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-lead'), [state.records]);
  const tenantName = (id: string) => state.tenants.find(t => t.id === id)?.name ?? 'Removida';

  return <div className="stack" data-tour="admin-kpis">
    <PageHeader title="Painel da plataforma" subtitle="Indicadores executivos SaaS derivados das assinaturas e faturas da plataforma."/>
    <p className="adm-sim">Ambiente de demonstração local: faturas são simuladas (Asaas/InfinitePay) e nenhum disparo externo é realizado.</p>
    <div className="grid grid-4">
      <Stat label="MRR contratado" value={money(kpi.mrr)} hint="Recorrência contratada ativa, não recebida" icon={<TrendingUp size={18}/>} tone="blue"/>
      <Stat label="ARR contratado" value={money(kpi.arr)} hint="Projeção anual (MRR × 12)" icon={<CircleDollarSign size={18}/>} tone="blue"/>
      <Stat label="Receita recebida" value={money(kpi.received)} hint="Total acumulado das faturas Pagas" icon={<CircleDollarSign size={18}/>} tone="green"/>
      <Stat label="Faturas pendentes" value={kpi.pendingCount} hint={money(kpi.pendingAmount)} icon={<AlertCircle size={18}/>} tone={kpi.overdueTenants ? 'red' : 'blue'}/>
    </div>
    <div className="grid grid-4">
      <Stat label="Empresas ativas" value={kpi.active} hint={`${kpi.trial} em teste`} icon={<Building2 size={18}/>}/>
      <Stat label="Novas (30 dias)" value={kpi.newTenants} hint="Criadas na demonstração local" icon={<Users size={18}/>}/>
      <Stat label="Inadimplentes" value={kpi.overdueTenants} hint={`${kpi.overdueInvoices.length} faturas vencidas`} icon={<AlertCircle size={18}/>} tone={kpi.overdueTenants ? 'red' : 'green'}/>
      <Stat label="Churn (30 dias)" value={kpi.churn !== null ? `${(kpi.churn * 100).toFixed(1)}%` : 'sem base suficiente'} hint={kpi.churn !== null ? `${kpi.churned} canceladas de ${kpi.churnBase} na base` : 'Exige empresas anteriores à janela de 30 dias'} icon={<TrendingDown size={18}/>} tone={kpi.churn ? 'red' : 'blue'}/>
    </div>
    <div className="charts-row">
      <Panel title="Receita recebida por mês (faturas Pagas)">
        {kpi.revenueByMonth.every(m => m.received === 0) ? <div className="chart-empty">Nenhuma fatura paga no período.</div> :
          <div className="chart-container" role="img" aria-label="Receita recebida por mês">
            <ResponsiveContainer width="100%" height={230}>
              <AreaChart data={kpi.revenueByMonth} margin={{ top: 12, right: 12, left: 0, bottom: 0 }}>
                <defs><linearGradient id="saas-rev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#007BFF" stopOpacity={0.35}/><stop offset="95%" stopColor="#007BFF" stopOpacity={0}/></linearGradient></defs>
                <CartesianGrid stroke="var(--border)" vertical={false}/>
                <XAxis dataKey="label" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false}/>
                <YAxis tickFormatter={v => `R$ ${(v / 100).toLocaleString('pt-BR', { notation: 'compact' })}`} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={64}/>
                <Tooltip content={<ChartTooltip/>}/>
                <Area name="Receita" type="monotone" dataKey="received" stroke="#007BFF" strokeWidth={2} fill="url(#saas-rev)" dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }}/>
              </AreaChart>
            </ResponsiveContainer>
          </div>}
      </Panel>
      <Panel title="Assinaturas por plano">
        {kpi.byPlan.every(p => p.value === 0) ? <div className="chart-empty">Nenhuma assinatura ativa.</div> :
          <>
            <div className="donut-wrap">
              <ResponsiveContainer width="100%" height={170}>
                <PieChart>
                  <Pie data={kpi.byPlan} dataKey="value" nameKey="name" innerRadius={48} outerRadius={70} stroke="var(--surface)" strokeWidth={2}>
                    {kpi.byPlan.map((p, i) => <Cell key={p.name} fill={CHART_COLORS[i % CHART_COLORS.length]}/>)}
                  </Pie>
                  <Tooltip content={<ChartTooltip currency={false}/>}/>
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="chart-legend">{kpi.byPlan.map((p, i) => <div key={p.name}><i style={{ background: CHART_COLORS[i % CHART_COLORS.length] }}/><span>{p.name}</span><strong>{p.value}</strong><small>{kpi.active ? Math.round(p.value / kpi.active * 100) : 0}%</small></div>)}</div>
          </>}
      </Panel>
    </div>
    <Panel title="Situação das empresas cadastradas">
      <div className="chart-container" role="img" aria-label="Distribuição de empresas por status">
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={kpi.byStatus} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" vertical={false}/>
            <XAxis dataKey="name" tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false}/>
            <YAxis allowDecimals={false} tick={{ fill: 'var(--muted)', fontSize: 11 }} axisLine={false} tickLine={false} width={36}/>
            <Tooltip content={<ChartTooltip currency={false}/>}/>
            <Bar name="Empresas" dataKey="value" fill="#00E5FF" radius={[4, 4, 0, 0]}/>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </Panel>
    <div className="grid grid-2">
      <Panel title="Cobranças com atenção imediata"><DataTable pageSize={5} columns={[{ key: 'tenantId', label: 'Empresa', render: (i: BillingInvoice) => tenantName(i.tenantId) }, { key: 'amount', label: 'Valor', render: (i: BillingInvoice) => money(i.amount) }, { key: 'dueDate', label: 'Vencimento', render: (i: BillingInvoice) => date(i.dueDate) }, { key: 'status', label: 'Status', render: (i: BillingInvoice) => <Badge>{invoiceStatus(i, today())}</Badge> }]} rows={kpi.overdueInvoices}/></Panel>
      <Panel title="Chamados e leads"><div className="chart-summary"><strong>{kpi.openTickets}</strong><span className="muted">chamados de suporte abertos · {leads.length} leads recebidos</span></div><DataTable pageSize={5} columns={[{ key: 'title', label: 'Lead' }, { key: 'email', label: 'E-mail', render: (r: OperationalRecord) => r.fields.email || '—' }, { key: 'date', label: 'Data', render: (r: OperationalRecord) => date(r.date) }]} rows={[...leads].reverse()}/></Panel>
    </div>
  </div>;
}

function Companies({ subscriptions = false }: { subscriptions?: boolean }) {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<Tenant | 'new'>();
  const [invoiceTenant, setInvoiceTenant] = useState<Tenant>();
  const planName = (id: string) => state.plans.find(p => p.id === id)?.name ?? 'Sem plano';
  const rows = state.tenants.filter(t => (!status || t.status === status) && matches([t.name, t.legalName, t.document, t.owner, t.email, t.slug], search));
  const current = edit === 'new' ? undefined : edit;
  const open = (t: Tenant | 'new') => { validation.reset(); action.reset(); setEdit(t); };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const planId = formText(f, 'planId'); const st = formText(f, 'status');
      if (!state.plans.some(p => p.id === planId)) throw new Error('Selecione um plano válido.');
      if (!tenantStatuses.includes(st)) throw new Error('Status inválido.');
      const values = validation.check({
        name: () => required(formText(f, 'name'), 'Nome fantasia', 160),
        legalName: () => required(formText(f, 'legalName'), 'Razão social', 160),
        owner: () => required(formText(f, 'owner'), 'Responsável', 160),
        email: () => email(formText(f, 'email')),
        profile: () => required(formText(f, 'profile'), 'Perfil', 60),
        dueDate: () => isoDate(formText(f, 'dueDate')),
      });
      const payload = { ...values, planId, status: st, document: formText(f, 'document').replace(/\D/g, ''), notes: formText(f, 'notes').slice(0, 2000) };
      await mutate(draft => {
        if (!current) { const t = createTenant(draft, payload); log(draft, `Empresa criada: ${t.name}`); return; }
        const t = draft.tenants.find(x => x.id === current.id); if (!t) throw new Error('Empresa não encontrada.');
        const changes = [t.planId !== payload.planId && `plano ${planName(t.planId)} → ${planName(payload.planId)}`, t.status !== payload.status && `status ${t.status} → ${payload.status}`].filter(Boolean).join(', ');
        Object.assign(t, payload); log(draft, `Empresa ${t.name} atualizada${changes ? `: ${changes}` : ''}`);
      });
      setEdit(undefined);
    });
  }

  function remove(t: Tenant) {
    if (state.sales.some(s => s.tenantId === t.id) || state.invoices.some(i => i.tenantId === t.id)) { void action.run(() => { throw new Error('Empresa com vendas ou faturas não pode ser excluída. Altere o status para Cancelada.'); }); return; }
    if (!window.confirm(`Excluir ${t.name} e todos os seus dados demonstrativos? Esta ação não pode ser desfeita.`)) return;
    void action.run(() => mutate(draft => {
      const keep = <T extends { tenantId: string }>(list: T[]) => list.filter(x => x.tenantId !== t.id);
      draft.tenants = draft.tenants.filter(x => x.id !== t.id); draft.branches = keep(draft.branches); draft.products = keep(draft.products); draft.customers = keep(draft.customers); draft.balances = keep(draft.balances); draft.movements = keep(draft.movements); draft.cashRegisters = keep(draft.cashRegisters); draft.finances = keep(draft.finances); draft.records = keep(draft.records);
      log(draft, `Empresa excluída: ${t.name}`);
    }), 'Empresa excluída.');
  }

  return <div className="stack" data-tour={subscriptions ? 'admin-plans' : 'admin-companies'}>
    <PageHeader title={subscriptions ? 'Assinaturas' : 'Empresas'} subtitle={subscriptions ? 'Plano contratado, periodicidade e geração de faturas por empresa.' : 'Empresas clientes cadastradas na plataforma.'}>
      {!subscriptions && <Button variant="primary" icon={<Plus size={16}/>} onClick={() => open('new')}>Nova empresa</Button>}
    </PageHeader>
    <Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={tenantStatuses} onExport={() => exportCsv(subscriptions ? 'assinaturas' : 'empresas', rows.map(t => ({ empresa: t.name, documento: t.document, responsavel: t.owner, email: t.email, plano: planName(t.planId), status: t.status, vencimento: t.dueDate })))}/>
    {!edit && action.error && <p role="alert" className="adm-error">{action.error}</p>}
    <DataTable rows={rows} onRow={open} columns={subscriptions ? [
      { key: 'name', label: 'Empresa' }, { key: 'planId', label: 'Plano', render: t => planName(t.planId) },
      { key: 'monthly', label: 'Mensal', render: t => money(state.plans.find(p => p.id === t.planId)?.monthly ?? 0) },
      { key: 'status', label: 'Status', render: t => <Badge>{t.status}</Badge> },
      { key: 'dueDate', label: 'Vencimento', render: t => date(t.dueDate) },
      { key: 'actions', label: 'Ações', render: t => <Button icon={<FileText size={14}/>} onClick={e => { e.stopPropagation(); setInvoiceTenant(t); }}>Gerar fatura</Button> },
    ] : [
      { key: 'name', label: 'Empresa' }, { key: 'owner', label: 'Responsável' }, { key: 'profile', label: 'Perfil' },
      { key: 'planId', label: 'Plano', render: t => planName(t.planId) },
      { key: 'status', label: 'Status', render: t => <Badge>{t.status}</Badge> },
      { key: 'actions', label: 'Ações', render: t => <Button variant="danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(t); }}>Excluir</Button> },
    ]}/>
    <Modal title={current ? `Editar ${current.name}` : 'Nova empresa'} open={!!edit} onClose={() => setEdit(undefined)} size="lg" footer={<><Button onClick={() => setEdit(undefined)} disabled={action.pending}>Cancelar</Button><Button type="submit" form="company-form" variant="primary" loading={action.pending}>Salvar empresa</Button></>}>
      <form id="company-form" noValidate onSubmit={save} onInput={validation.onInput} className="stack">
        <section className="form-section"><h3>Dados principais</h3><div className="form-grid">
          <Field label="Nome fantasia" error={validation.errors.name}><input name="name" required maxLength={160} defaultValue={current?.name}/></Field>
          <Field label="Razão social" error={validation.errors.legalName}><input name="legalName" required maxLength={160} defaultValue={current?.legalName}/></Field>
          <Field label="CPF / CNPJ fictício" hint="Somente números"><input name="document" maxLength={18} defaultValue={current?.document}/></Field>
          <Field label="Responsável" error={validation.errors.owner}><input name="owner" required maxLength={160} defaultValue={current?.owner}/></Field>
          <Field label="E-mail" error={validation.errors.email}><input name="email" type="email" required maxLength={254} defaultValue={current?.email}/></Field>
          <Field label="Perfil de operação" error={validation.errors.profile}><input name="profile" required maxLength={60} defaultValue={current?.profile ?? 'Oficina e autopeças'}/></Field>
        </div></section>
        <section className="form-section"><h3>Assinatura da plataforma</h3><div className="form-grid">
          <Field label="Plano"><select name="planId" defaultValue={current?.planId ?? state.plans[0]?.id}>{state.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
          <Field label="Status"><select name="status" defaultValue={current?.status ?? 'Teste'}>{tenantStatuses.map(s => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Próximo vencimento" error={validation.errors.dueDate}><input name="dueDate" type="date" required defaultValue={current?.dueDate?.slice(0, 10) ?? shiftDate(today(), 14)}/></Field>
        </div></section>
        <section className="form-section"><h3>Observações internas</h3><Field label="Notas"><textarea name="notes" rows={3} maxLength={2000} defaultValue={current?.notes}/></Field></section>
        {action.error && <p role="alert" className="adm-error">{action.error}</p>}
      </form>
    </Modal>
    {invoiceTenant && <SubscriptionInvoice tenant={invoiceTenant} onClose={() => setInvoiceTenant(undefined)}/>}
  </div>;
}

function Plans() {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const [edit, setEdit] = useState<Plan | 'new'>();
  const current = edit === 'new' ? undefined : edit;
  const cents = (v?: number) => v === undefined ? '' : (v / 100).toFixed(2).replace('.', ',');
  const open = (plan: Plan | 'new') => { validation.reset(); action.reset(); setEdit(plan); };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const values = validation.check({
        name: () => required(formText(f, 'name'), 'Nome do plano', 60),
        monthly: () => parseMoney(formText(f, 'monthly')),
        quarterly: () => parseMoney(formText(f, 'quarterly')),
        annual: () => parseMoney(formText(f, 'annual')),
        users: () => wholeNumber(formText(f, 'users'), 'Usuários'),
        branches: () => wholeNumber(formText(f, 'branches'), 'Filiais'),
        products: () => wholeNumber(formText(f, 'products'), 'Produtos'),
        whatsapp: () => wholeNumber(formText(f, 'whatsapp'), 'Mensagens WhatsApp'),
        trialDays: () => wholeNumber(formText(f, 'trialDays'), 'Dias de teste'),
      });
      const features = formText(f, 'features').split('\n').map(x => x.trim()).filter(Boolean).slice(0, 30);
      const plan: Plan = { id: current?.id ?? uid(), ...values, features };
      await mutate(draft => {
        const i = draft.plans.findIndex(p => p.id === plan.id);
        if (i >= 0) draft.plans[i] = plan; else draft.plans.push(plan);
        log(draft, `Plano ${i >= 0 ? 'atualizado' : 'criado'}: ${plan.name}`);
      });
      setEdit(undefined);
    });
  }

  function remove(plan: Plan) {
    if (state.tenants.some(t => t.planId === plan.id)) { void action.run(() => { throw new Error('Plano em uso por empresas. Migre as assinaturas antes de excluir.'); }); return; }
    if (!window.confirm(`Excluir o plano ${plan.name}?`)) return;
    void action.run(() => mutate(draft => { draft.plans = draft.plans.filter(p => p.id !== plan.id); log(draft, `Plano excluído: ${plan.name}`); }), 'Plano excluído.');
  }

  return <div className="stack" data-tour="admin-plans">
    <PageHeader title="Planos SaaS" subtitle="Preços totais por período. O site público e a contratação usam estes mesmos valores.">
      <Link to="/admin/cobrancas?aba=cupons" className="btn ghost">Ver cupons SaaS</Link>
      <Button variant="ghost" icon={<Download size={16}/>} onClick={() => exportCsv('planos', state.plans.map(p => ({ ...p, features: p.features.join(' | ') })))}>Exportar</Button>
      <Button variant="primary" icon={<Plus size={16}/>} onClick={() => open('new')}>Novo plano</Button>
    </PageHeader>
    {!edit && action.error && <p role="alert" className="adm-error">{action.error}</p>}
    <DataTable rows={state.plans} onRow={open} columns={[
      { key: 'name', label: 'Plano' }, { key: 'monthly', label: 'Mensal', render: p => money(p.monthly) },
      { key: 'quarterly', label: 'Trimestral', render: p => money(p.quarterly) }, { key: 'annual', label: 'Anual', render: p => money(p.annual) },
      { key: 'users', label: 'Usuários' }, { key: 'branches', label: 'Filiais' },
      { key: 'tenants', label: 'Empresas', render: p => state.tenants.filter(t => t.planId === p.id).length },
      { key: 'actions', label: 'Ações', render: p => <Button variant="danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(p); }}>Excluir</Button> },
    ]}/>
    <Modal title={current ? `Editar ${current.name}` : 'Novo plano'} open={!!edit} onClose={() => setEdit(undefined)} size="lg" footer={<><Button onClick={() => setEdit(undefined)} disabled={action.pending}>Cancelar</Button><Button type="submit" form="plan-form" variant="primary" loading={action.pending}>Salvar plano</Button></>}>
      <form id="plan-form" noValidate onSubmit={save} onInput={validation.onInput} className="stack">
        <section className="form-section"><h3>Identificação e limites</h3><div className="form-grid">
          <Field label="Nome do plano" error={validation.errors.name}><input name="name" required maxLength={60} defaultValue={current?.name}/></Field>
          <Field label="Dias de teste" error={validation.errors.trialDays}><input name="trialDays" type="number" min={0} step={1} required defaultValue={current?.trialDays ?? 14}/></Field>
          <Field label="Usuários incluídos" error={validation.errors.users}><input name="users" type="number" min={0} step={1} required defaultValue={current?.users ?? 1}/></Field>
          <Field label="Filiais incluídas" error={validation.errors.branches}><input name="branches" type="number" min={0} step={1} required defaultValue={current?.branches ?? 1}/></Field>
          <Field label="Limite de produtos" error={validation.errors.products}><input name="products" type="number" min={0} step={1} required defaultValue={current?.products ?? 1000}/></Field>
          <Field label="Mensagens WhatsApp" error={validation.errors.whatsapp}><input name="whatsapp" type="number" min={0} step={1} required defaultValue={current?.whatsapp ?? 0}/></Field>
        </div></section>
        <section className="form-section"><h3>Preços por período (total cobrado)</h3><div className="form-grid">
          <Field label="Mensal (R$)" error={validation.errors.monthly}><input name="monthly" required inputMode="decimal" defaultValue={cents(current?.monthly)}/></Field>
          <Field label="Trimestral total (R$)" error={validation.errors.quarterly}><input name="quarterly" required inputMode="decimal" defaultValue={cents(current?.quarterly)}/></Field>
          <Field label="Anual total (R$)" error={validation.errors.annual}><input name="annual" required inputMode="decimal" defaultValue={cents(current?.annual)}/></Field>
        </div></section>
        <section className="form-section"><h3>Recursos para a tabela comparativa</h3><Field label="Recursos (um por linha)"><textarea name="features" rows={5} defaultValue={current?.features.join('\n')}/></Field></section>
        {action.error && <p role="alert" className="adm-error">{action.error}</p>}
      </form>
    </Modal>
  </div>;
}

function Invoices({ finance = false }: { finance?: boolean }) {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const location = useLocation();
  const tab = new URLSearchParams(location.search).get('aba') || 'faturas';
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [open, setOpen] = useState(false);
  const tenantName = (id: string) => state.tenants.find(t => t.id === id)?.name ?? 'Removida';
  const rows = [...state.invoices].reverse().filter(i => (!status || invoiceStatus(i, today()) === status) && matches([tenantName(i.tenantId), i.reference, i.provider, i.couponCode], search));

  function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const tenantId = formText(f, 'tenantId'); const provider = formText(f, 'provider') as BillingInvoice['provider'];
      if (!state.tenants.some(t => t.id === tenantId)) throw new Error('Selecione uma empresa.');
      if (provider !== 'Asaas' && provider !== 'InfinitePay') throw new Error('Provedor inválido.');
      const values = validation.check({
        reference: () => required(formText(f, 'reference'), 'Referência', 60),
        amount: () => { const a = parseMoney(formText(f, 'amount')); if (a <= 0) throw new Error('Valor deve ser maior que zero.'); return a; },
        dueDate: () => isoDate(formText(f, 'dueDate')),
      });
      const invoice: BillingInvoice = { id: uid(), tenantId, amount: values.amount, status: 'Pendente', dueDate: values.dueDate, provider, reference: values.reference };
      await mutate(draft => {
        if (draft.invoices.some(i => i.tenantId === tenantId && i.reference === values.reference && i.status !== 'Cancelada')) throw new Error('Já existe cobrança ativa com esta referência para a empresa.');
        draft.invoices.push(invoice); log(draft, `Cobrança simulada ${values.reference} criada para ${tenantName(tenantId)}`);
      });
      setOpen(false);
    }, 'Cobrança simulada criada como Pendente. Nada foi enviado ao provedor.');
  }

  const transition = (invoice: BillingInvoice, next: 'Paga' | 'Cancelada') => {
    if (next === 'Cancelada' && !window.confirm('Cancelar esta cobrança simulada?')) return;
    void action.run(() => mutate(draft => {
      const i = draft.invoices.find(x => x.id === invoice.id);
      if (!i || i.status !== 'Pendente') throw new Error('Somente cobranças pendentes podem mudar de status.');
      i.status = next; log(draft, `Cobrança ${i.reference}: ${next}`);
    }), `Cobrança marcada como ${next.toLowerCase()} (simulação).`);
  };

  const byMonth = useMemo(() => Object.entries(state.invoices.reduce<Record<string, { paid: number; pending: number; overdue: number }>>((acc, i) => {
    const m = i.dueDate.slice(0, 7); const b = acc[m] ??= { paid: 0, pending: 0, overdue: 0 };
    const s = invoiceStatus(i, today());
    if (s === 'Paga') b.paid += i.amount; else if (s === 'Vencida') b.overdue += i.amount; else if (s === 'Pendente') b.pending += i.amount;
    return acc;
  }, {})).sort(([a], [b]) => b.localeCompare(a)).map(([id, v]) => ({ id, ...v })), [state.invoices]);

  if (finance) return <div className="stack">
    <PageHeader title="Financeiro SaaS" subtitle="Receita da plataforma a partir das cobranças simuladas. Não inclui o financeiro das lojas.">
      <Button variant="ghost" icon={<Download size={16}/>} onClick={() => exportCsv('financeiro-saas', byMonth.map(m => ({ mes: m.id, recebido: money(m.paid), pendente: money(m.pending), vencido: money(m.overdue) })))}>Exportar</Button>
    </PageHeader>
    <div className="grid grid-3">
      <Stat label="Recebido" value={money(state.invoices.filter(i => i.status === 'Paga').reduce((s, i) => s + i.amount, 0))} tone="green"/>
      <Stat label="A receber" value={money(state.invoices.filter(i => invoiceStatus(i, today()) === 'Pendente').reduce((s, i) => s + i.amount, 0))}/>
      <Stat label="Vencido" value={money(state.invoices.filter(i => invoiceStatus(i, today()) === 'Vencida').reduce((s, i) => s + i.amount, 0))} tone="red"/>
    </div>
    <Panel title="Por mês de vencimento">
      <DataTable columns={[{ key: 'id', label: 'Mês' }, { key: 'paid', label: 'Recebido', render: (m: { paid: number }) => money(m.paid) }, { key: 'pending', label: 'Pendente', render: (m: { pending: number }) => money(m.pending) }, { key: 'overdue', label: 'Vencido', render: (m: { overdue: number }) => money(m.overdue) }]} rows={byMonth}/>
    </Panel>
  </div>;

  return <div className="stack" data-tour="admin-billing">
    <PageHeader title="Cobranças e Cupons SaaS" subtitle="Faturas SaaS simuladas e cupons de desconto para a primeira fatura.">
      {tab === 'faturas' && <Button variant="primary" icon={<Plus size={16}/>} disabled={!state.tenants.length} onClick={() => { validation.reset(); action.reset(); setOpen(true); }}>Nova cobrança</Button>}
    </PageHeader>
    <nav className="tabs" aria-label="Abas de cobrança">
      <Link to="/admin/cobrancas?aba=faturas" className={`btn ${tab === 'faturas' ? 'primary' : 'ghost'}`} aria-current={tab === 'faturas' ? 'page' : undefined}>Faturas SaaS</Link>
      <Link to="/admin/cobrancas?aba=cupons" className={`btn ${tab === 'cupons' ? 'primary' : 'ghost'}`} aria-current={tab === 'cupons' ? 'page' : undefined}>Cupons de desconto</Link>
    </nav>
    {tab === 'cupons' ? <Coupons/> : <>
      <Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={invoiceStatuses} onExport={() => exportCsv('cobrancas', rows.map(i => ({ empresa: tenantName(i.tenantId), referencia: i.reference, valor: money(i.amount), vencimento: i.dueDate, status: invoiceStatus(i, today()), cupom: i.couponCode ?? '', provedor: i.provider })))}/>
      {!open && action.error && <p role="alert" className="adm-error">{action.error}</p>}
      <DataTable rows={rows} columns={[
        { key: 'reference', label: 'Referência' }, { key: 'tenantId', label: 'Empresa', render: i => tenantName(i.tenantId) },
        { key: 'amount', label: 'Valor final', render: i => <span>{money(i.amount)}{i.discount ? <small className="muted"><br/>({money(i.originalAmount ?? i.amount)} − {money(i.discount)})</small> : null}</span> },
        { key: 'couponCode', label: 'Cupom', render: i => i.couponCode ? <Badge>{i.couponCode}</Badge> : '—' },
        { key: 'dueDate', label: 'Vencimento', render: i => date(i.dueDate) },
        { key: 'status', label: 'Status', render: i => <Badge>{invoiceStatus(i, today())}</Badge> },
        { key: 'provider', label: 'Provedor' },
        { key: 'actions', label: 'Ações', render: i => i.status === 'Pendente' ? <span className="toolbar"><Button disabled={action.pending} onClick={() => transition(i, 'Paga')}>Baixar</Button><Button variant="danger" disabled={action.pending} onClick={() => transition(i, 'Cancelada')}>Cancelar</Button></span> : '—' },
      ]}/>
      <Modal title="Nova cobrança simulada" open={open} onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)} disabled={action.pending}>Cancelar</Button><Button type="submit" form="manual-invoice" variant="primary" loading={action.pending}>Criar cobrança</Button></>}>
        <form id="manual-invoice" noValidate onSubmit={create} onInput={validation.onInput} className="stack">
          <section className="form-section"><h3>Destinatário e valores</h3><div className="form-grid">
            <Field label="Empresa"><select name="tenantId" required>{state.tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field>
            <Field label="Valor (R$)" error={validation.errors.amount}><input name="amount" required inputMode="decimal"/></Field>
            <Field label="Vencimento" error={validation.errors.dueDate}><input name="dueDate" type="date" required defaultValue={shiftDate(today(), 7)}/></Field>
            <Field label="Referência" error={validation.errors.reference}><input name="reference" required maxLength={60} defaultValue={today().slice(0, 7)}/></Field>
            <Field label="Provedor (simulado)"><select name="provider"><option>Asaas</option><option>InfinitePay</option></select></Field>
          </div><p className="adm-sim"><Badge>Pendente</Badge> A cobrança é criada com status Pendente e sem integração externa real.</p></section>
          {action.error && <p role="alert" className="adm-error">{action.error}</p>}
        </form>
      </Modal>
    </>}
  </div>;
}

type FieldDef = { key: string; label: string; type?: string; options?: string[] };
function Records({ kind, title, subtitle, fields, statuses, tour }: { kind: string; title: string; subtitle: string; fields: FieldDef[]; statuses: string[]; tour?: string }) {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<OperationalRecord | 'new'>();
  const rows = state.records.filter(r => r.tenantId === 'platform' && r.kind === kind && (!status || r.status === status) && matches([r.title, ...Object.values(r.fields)], search));
  const current = edit === 'new' ? undefined : edit;
  const open = (r: OperationalRecord | 'new') => { validation.reset(); action.reset(); setEdit(r); };

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const values = Object.fromEntries(fields.map(d => {
        const v = formText(f, d.key).slice(0, 2000);
        if (d.type === 'email' && v) email(v);
        if (d.options && !d.options.includes(v) && v !== current?.fields[d.key]) throw new Error(`${d.label}: selecione uma opção válida.`);
        return [d.key, v];
      }));
      const name = validation.check({ title: () => required(formText(f, 'title'), 'Título', 200) }).title;
      const st = formText(f, 'status'); if (!statuses.includes(st)) throw new Error('Status inválido.');
      const amount = fields.some(d => d.key === 'amount') ? parseMoney(values.amount || '0') : 0;
      await mutate(draft => {
        if (!current) {
          const dateIso = new Date().toISOString();
          const r: OperationalRecord = { id: uid(), tenantId: 'platform', branchId: '', kind, title: name, status: st, customerId: '', date: dateIso, amount, fields: values, items: [], history: [{ date: dateIso, text: 'Criado no painel administrativo.' }] };
          draft.records.push(r); log(draft, `${title}: criado ${name}`); return;
        }
        const r = draft.records.find(x => x.id === current.id); if (!r) throw new Error('Registro não encontrado.');
        const now = new Date().toISOString(); if (r.status !== st) r.history.push({ date: now, text: `Status ${r.status} → ${st}` });
        Object.assign(r, { title: name, status: st, fields: { ...r.fields, ...values }, amount }); log(draft, `${title}: atualizado ${name}`);
      });
      setEdit(undefined);
    });
  }

  function remove(r: OperationalRecord) {
    if (!window.confirm(`Excluir "${r.title}"?`)) return;
    void action.run(() => mutate(draft => { draft.records = draft.records.filter(x => x.id !== r.id); log(draft, `${title}: excluído ${r.title}`); }), 'Registro excluído.');
  }

  return <div className="stack" data-tour={tour}>
    <Panel title={title}><p className="muted">{subtitle}</p>
      <Filters search={search} onSearch={setSearch} status={status} onStatus={setStatus} statuses={statuses} onExport={() => exportCsv(kind, rows.map(r => ({ titulo: r.title, status: r.status, data: r.date, ...r.fields })))}>
        <Button variant="primary" icon={<Plus size={16}/>} onClick={() => open('new')}>Novo</Button>
      </Filters>
      {!edit && action.error && <p role="alert" className="adm-error">{action.error}</p>}
      <DataTable rows={rows} onRow={open} columns={[
        { key: 'title', label: 'Título' },
        ...fields.slice(0, 2).map(d => ({ key: d.key, label: d.label, render: (r: OperationalRecord) => r.fields[d.key] || '—' })),
        { key: 'status', label: 'Status', render: (r: OperationalRecord) => <Badge>{r.status}</Badge> },
        { key: 'date', label: 'Criado', render: (r: OperationalRecord) => date(r.date) },
        { key: 'actions', label: 'Ações', render: (r: OperationalRecord) => <Button variant="danger" disabled={action.pending} onClick={e => { e.stopPropagation(); remove(r); }}>Excluir</Button> },
      ]}/>
      <Modal title={current ? current.title : `Novo — ${title}`} open={!!edit} onClose={() => setEdit(undefined)} size="lg" footer={<><Button onClick={() => setEdit(undefined)} disabled={action.pending}>Cancelar</Button><Button type="submit" form={`record-${kind}`} variant="primary" loading={action.pending}>Salvar</Button></>}>
        <form id={`record-${kind}`} noValidate onSubmit={save} onInput={validation.onInput} className="stack">
          <section className="form-section"><h3>Identificação e status</h3><div className="form-grid">
            <Field label="Título" error={validation.errors.title}><input name="title" required maxLength={200} defaultValue={current?.title}/></Field>
            <Field label="Status"><select name="status" defaultValue={current?.status ?? statuses[0]}>{statuses.map(s => <option key={s}>{s}</option>)}</select></Field>
          </div></section>
          <section className="form-section"><h3>Detalhes do registro</h3><div className="form-grid">
            {fields.map(d => <Field key={d.key} label={d.label}>{d.options ? <select name={d.key} defaultValue={current?.fields[d.key]}>{d.options.map(o => <option key={o}>{o}</option>)}</select> : d.type === 'textarea' ? <textarea name={d.key} rows={3} maxLength={2000} defaultValue={current?.fields[d.key]}/> : <input name={d.key} type={d.type ?? 'text'} maxLength={254} defaultValue={current?.fields[d.key]}/>}</Field>)}
          </div></section>
          {current && current.history.length > 0 && <section className="form-section"><h3>Histórico de alterações</h3><ol className="adm-history">{current.history.map((h, i) => <li key={i}><time>{date(h.date)}</time> {h.text}</li>)}</ol></section>}
          {action.error && <p role="alert" className="adm-error">{action.error}</p>}
        </form>
      </Modal>
    </Panel>
  </div>;
}

function Reports() {
  const { state } = useDemo(); const [search, setSearch] = useState('');
  const logs = [...state.audit].filter(a => a.tenantId === 'platform' && matches([a.action], search)).reverse();
  const exports: [string, () => Record<string, unknown>[]][] = [
    ['empresas', () => state.tenants.map(t => ({ empresa: t.name, plano: state.plans.find(p => p.id === t.planId)?.name, status: t.status, vencimento: t.dueDate }))],
    ['cobrancas', () => state.invoices.map(i => ({ referencia: i.reference, empresa: state.tenants.find(t => t.id === i.tenantId)?.name, valor: money(i.amount), status: invoiceStatus(i, today()), vencimento: i.dueDate, cupom: i.couponCode ?? '' }))],
    ['cupons', () => state.coupons.map(c => ({ codigo: c.code, descricao: c.description, ativo: c.active, inicio: c.startsAt, fim: c.endsAt }))],
    ['leads', () => state.records.filter(r => r.tenantId === 'platform' && r.kind === 'admin-lead').map(r => ({ nome: r.title, data: r.date, ...r.fields }))],
    ['logs-plataforma', () => logs.map(a => ({ data: a.date, acao: a.action }))],
  ];
  return <div className="stack">
    <PageHeader title="Relatórios e auditoria" subtitle="Exportações CSV locais e trilha de auditoria administrativa da plataforma."/>
    <div className="toolbar">{exports.map(([name, rows]) => <Button key={name} variant="ghost" icon={<Download size={16}/>} onClick={() => { const data = rows(); if (!data.length) window.alert('Nada para exportar.'); else exportCsv(name, data); }}>{name}</Button>)}</div>
    <Panel title="Logs da plataforma">
      <div className="toolbar"><input type="search" aria-label="Buscar nos logs" placeholder="Buscar ação…" value={search} onChange={e => setSearch(e.target.value)}/></div>
      <DataTable columns={[{ key: 'date', label: 'Data', render: (a: { date: string }) => new Date(a.date).toLocaleString('pt-BR') }, { key: 'action', label: 'Ação' }]} rows={logs}/>
    </Panel>
  </div>;
}

function Settings() {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const config = state.records.find(r => r.tenantId === 'platform' && r.kind === 'admin-config');
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const values = validation.check({
        supportEmail: () => email(formText(f, 'supportEmail')),
        defaultTrial: () => wholeNumber(formText(f, 'defaultTrial'), 'Dias de teste padrão'),
        graceDays: () => wholeNumber(formText(f, 'graceDays'), 'Carência após vencimento'),
      });
      const fields = { supportEmail: values.supportEmail, defaultTrial: String(values.defaultTrial), graceDays: String(values.graceDays), maintenance: f.get('maintenance') === 'on' ? 'sim' : 'não' };
      await mutate(draft => {
        const r = draft.records.find(x => x.tenantId === 'platform' && x.kind === 'admin-config');
        if (r) r.fields = fields;
        else {
          const dateIso = new Date().toISOString();
          draft.records.push({ id: uid(), tenantId: 'platform', branchId: '', kind: 'admin-config', title: 'Configurações da plataforma', status: 'Aberto', customerId: '', date: dateIso, amount: 0, fields, items: [], history: [{ date: dateIso, text: 'Configuração criada.' }] });
        }
        log(draft, 'Configurações da plataforma atualizadas');
      });
    }, 'Configurações salvas.');
  }

  return <div className="stack">
    <PageHeader title="Configurações gerais" subtitle="Parâmetros da plataforma e anotações internas da equipe.">
      <Link to="/admin/cobrancas?aba=cupons" className="btn ghost">Gerenciar cupons SaaS</Link>
    </PageHeader>
    <Panel title="Parâmetros gerais">
      <form noValidate onSubmit={save} onInput={validation.onInput} className="stack">
        <section className="form-section"><h3>Atendimento e prazos</h3><div className="form-grid">
          <Field label="E-mail de suporte" error={validation.errors.supportEmail}><input name="supportEmail" type="email" required defaultValue={config?.fields.supportEmail ?? 'suporte@pistec.demo'}/></Field>
          <Field label="Dias de teste padrão" error={validation.errors.defaultTrial}><input name="defaultTrial" type="number" min={0} step={1} required defaultValue={config?.fields.defaultTrial ?? '14'}/></Field>
          <Field label="Carência após vencimento (dias)" error={validation.errors.graceDays}><input name="graceDays" type="number" min={0} step={1} required defaultValue={config?.fields.graceDays ?? '5'}/></Field>
        </div><label className="pub-check"><input name="maintenance" type="checkbox" defaultChecked={config?.fields.maintenance === 'sim'}/><span>Exibir aviso de manutenção no site público (simulado)</span></label></section>
        {action.error && <p role="alert" className="adm-error">{action.error}</p>}
        <div className="toolbar"><Button type="submit" variant="primary" loading={action.pending}>Salvar configurações</Button></div>
      </form>
    </Panel>
    <Records kind="admin-nota" title="Notas internas" subtitle="Anotações privadas da equipe administrativa." statuses={['Ativa', 'Arquivada']} fields={[{ key: 'body', label: 'Conteúdo', type: 'textarea' }]}/>
  </div>;
}

export default function Admin() {
  const { session, state } = useDemo(); const { pathname } = useLocation();
  const companyNames = ['—', ...state.tenants.map(t => t.name)];
  if (!session.admin) return <div className="page"><Panel><div className="adm-denied"><ShieldAlert size={40}/><h1>Acesso restrito</h1><p>Esta área exige o perfil Super Admin da demonstração.</p><Link className="btn primary" to="/demonstracao">Escolher perfil</Link></div></Panel></div>;
  const section = pathname.replace(/\/+$/, '').split('/')[2] ?? '';
  const pages: Record<string, ReactNode> = {
    '': <Dashboard/>,
    empresas: <Companies/>,
    assinaturas: <Companies subscriptions/>,
    planos: <Plans/>,
    cobrancas: <Invoices/>,
    financeiro: <Invoices finance/>,
    relatorios: <Reports/>,
    configuracoes: <Settings/>,
    suporte: <div className="stack" data-tour="admin-support">
      <PageHeader title="Central de suporte" subtitle="Chamados das empresas clientes e comunicados da plataforma."/>
      <Records kind="admin-ticket" title="Chamados de atendimento" subtitle="Tickets de suporte das oficinas e autopeças." statuses={['Aberto', 'Em atendimento', 'Aguardando cliente', 'Resolvido']} fields={[{ key: 'company', label: 'Empresa', options: companyNames }, { key: 'priority', label: 'Prioridade', options: ['Baixa', 'Normal', 'Alta', 'Urgente'] }, { key: 'description', label: 'Descrição do problema', type: 'textarea' }]}/>
      <Records kind="admin-aviso" title="Comunicados e avisos" subtitle="Mensagens exibidas no painel das empresas (simulado)." statuses={['Rascunho', 'Publicado', 'Arquivado']} fields={[{ key: 'audience', label: 'Público-alvo', options: ['Todas as empresas', 'Em teste gratuito', 'Assinaturas ativas', 'Com faturas pendentes'] }, { key: 'body', label: 'Mensagem', type: 'textarea' }]}/>
    </div>,
    integracoes: <div className="stack">
      <PageHeader title="Conectores e integrações" subtitle="Conexões demonstrativas com gateways e mensageria. Nenhuma credencial real é exigida."/>
      <Records kind="admin-integracao" title="Conectores de pagamento e mensagens" subtitle="Estado simulado de Asaas, InfinitePay, WhatsApp e SMTP." statuses={['Desconectado', 'Conectado (simulado)', 'Erro simulado']} fields={[{ key: 'provider', label: 'Provedor', options: ['Asaas (Pix e boleto)', 'InfinitePay (cartão)', 'WhatsApp API (mensagens)', 'SMTP / Transacional', 'Nota Fiscal Eletrônica'] }, { key: 'notes', label: 'Observações operacionais', type: 'textarea' }]}/>
    </div>,
    usuarios: <div className="stack">
      <PageHeader title="Administradores da plataforma" subtitle="Equipe interna de suporte, operação e financeiro PISTEC."/>
      <Records kind="admin-usuario" title="Usuários Super Admin" subtitle="Perfis administrativos locais. Autenticação real exigirá credenciais seguras no servidor." statuses={['Ativo', 'Inativo']} fields={[{ key: 'email', label: 'E-mail corporativo', type: 'email' }, { key: 'role', label: 'Função', options: ['Super Admin', 'Suporte técnico', 'Financeiro SaaS', 'Comercial'] }]}/>
    </div>,
  };
  return <div className="page">{pages[section] ?? <Empty text="Seção administrativa não encontrada."/>}</div>;
}
