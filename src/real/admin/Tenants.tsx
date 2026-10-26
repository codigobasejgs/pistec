import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Filter } from 'lucide-react';
import { Button, PageHeader, Panel } from '../../ui';
import { exportCsv } from '../../lib';
import { rows, tenantStatus, useQuery, daysUntil, type PlanRow, type TenantRow } from './data';
import { AdvancedTable, EmptyState, Loaded, StatusBadge } from './ui';

// Uma página, várias visões: /admin/empresas, /testes, /inadimplentes, /onboarding.
const views: Record<string, { title: string; subtitle: string; filter: (t: TenantRow & { products?: number }) => boolean }> = {
  todas: { title: 'Todas as empresas', subtitle: 'Clientes cadastrados na plataforma.', filter: () => true },
  testes: { title: 'Empresas em teste', subtitle: 'Período grátis em andamento. Prorrogue pelo perfil da empresa.', filter: t => t.status === 'Teste' },
  inadimplentes: { title: 'Inadimplentes e suspensas', subtitle: 'Assinaturas vencidas, em tolerância ou suspensas.', filter: t => ['Vencida', 'Suspensa'].includes(t.status) },
  onboarding: { title: 'Onboarding', subtitle: 'Empresas que ainda não cadastraram produtos (primeiros passos incompletos).', filter: t => (t.products ?? 0) === 0 && t.status !== 'Cancelada' },
};

export default function Tenants({ view = 'todas' }: { view?: keyof typeof views }) {
  const navigate = useNavigate(); const v = views[view];
  const [status, setStatus] = useState(''), [plan, setPlan] = useState(''), [from, setFrom] = useState(''), [showFilters, setShowFilters] = useState(false);
  const q = useQuery(async () => {
    const [tenants, plans, products] = await Promise.all([
      rows<TenantRow>('tenants', 'id,slug,name,legal_name,document,owner_name,email,phone,plan_id,status,due_date,created_at,profile', b => b.order('created_at', { ascending: false })),
      rows<PlanRow>('plans', 'id,name'),
      view === 'onboarding' ? rows<{ tenant_id: string }>('products', 'tenant_id') : Promise.resolve([]),
    ]);
    const count = new Map<string, number>(); for (const p of products) count.set(p.tenant_id, (count.get(p.tenant_id) ?? 0) + 1);
    return { tenants: tenants.map(t => ({ ...t, products: count.get(t.id) ?? 0 })), plans };
  }, [view]);
  const data = useMemo(() => q.data?.tenants.filter(v.filter).filter(t => (!status || t.status === status) && (!plan || t.plan_id === plan) && (!from || t.created_at.slice(0, 10) >= from)) ?? [], [q.data, v, status, plan, from]);
  const planName = (id: string) => q.data?.plans.find(p => p.id === id)?.name ?? id;

  return <div className="page"><PageHeader title={v.title} subtitle={v.subtitle}>
    <Button icon={<Filter size={15}/>} onClick={() => setShowFilters(s => !s)} aria-expanded={showFilters}>Filtros</Button>
    <Button icon={<Download size={15}/>} disabled={!data.length} onClick={() => exportCsv('empresas-pistec.csv', data.map(t => ({ Nome: t.name, 'Razão social': t.legal_name, CNPJ: t.document, Responsável: t.owner_name, 'E-mail': t.email, Telefone: t.phone, Plano: planName(t.plan_id), Situação: tenantStatus[t.status] ?? t.status, Vencimento: t.due_date, Cadastro: t.created_at.slice(0, 10) })))}>Exportar CSV</Button>
  </PageHeader>
    {showFilters && <Panel><div className="toolbar" data-tour="admin-filters">
      <label>Situação<select value={status} onChange={e => setStatus(e.target.value)}><option value="">Todas</option>{Object.entries(tenantStatus).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      <label>Plano<select value={plan} onChange={e => setPlan(e.target.value)}><option value="">Todos</option>{q.data?.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label>Cadastradas desde<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
      {(status || plan || from) && <Button onClick={() => { setStatus(''); setPlan(''); setFrom(''); }}>Limpar filtros</Button>}
    </div></Panel>}
    <Panel><Loaded q={q}>{() => data.length || q.data?.tenants.length ? <AdvancedTable caption={v.title} tour="admin-companies" rows={data} onRow={t => navigate(`/admin/empresas/${t.id}`)}
      search={t => [t.name, t.legal_name, t.document, t.owner_name, t.email, t.phone].join(' ')}
      columns={[
        { key: 'name', label: 'Empresa', sort: t => t.name, render: t => <><strong>{t.name}</strong><br/><small className="muted">{t.legal_name}</small></> },
        { key: 'document', label: 'CNPJ', render: t => t.document || '—' },
        { key: 'owner', label: 'Responsável', render: t => <>{t.owner_name || '—'}<br/><small className="muted">{t.email}</small></> },
        { key: 'plan', label: 'Plano', sort: t => planName(t.plan_id), render: t => planName(t.plan_id) },
        { key: 'status', label: 'Situação', sort: t => t.status, render: t => <StatusBadge>{tenantStatus[t.status] ?? t.status}</StatusBadge> },
        { key: 'due', label: 'Vencimento', sort: t => t.due_date, render: t => <>{new Date(t.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}{t.status === 'Teste' && <><br/><small className="muted">{daysUntil(t.due_date)} dia(s)</small></>}</> },
        { key: 'created', label: 'Cadastro', sort: t => t.created_at, render: t => new Date(t.created_at).toLocaleDateString('pt-BR') },
        ...(view === 'onboarding' ? [{ key: 'products', label: 'Produtos', render: (t: TenantRow & { products?: number }) => String(t.products ?? 0) }] : []),
      ]}/> : <EmptyState title="Nenhuma empresa ainda" text="As empresas aparecem aqui quando um lojista cria a conta em /app/cadastro, confirma o e-mail e cadastra a empresa. Leads da landing ficam em Leads comerciais." help="cadastrar empresa"/>}</Loaded></Panel>
  </div>;
}
