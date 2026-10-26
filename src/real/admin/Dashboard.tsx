import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Building2, CalendarClock, CircleDollarSign, Clock, Headphones, Layers, Receipt, TrendingUp, UserPlus } from 'lucide-react';
import { PageHeader, Panel, Stat } from '../../ui';
import { money } from '../../lib';
import { call, daysUntil, rows, tenantStatus, useQuery, type TenantRow } from './data';
import { useAdmin } from './context';
import { BarSeries, Distribution, Loaded, StatusBadge } from './ui';

type Metrics = {
  tenants: { total: number; active: number; trial: number; overdue: number; suspended: number; cancelled: number; newInPeriod: number; trialEnding: number; onboardingIncomplete: number };
  plans: { id: string; name: string; tenants: number }[]; subscriptions: Record<string, number>; growth: { day: string; created: number }[];
  tickets: number; leads: number; canFinance: boolean;
  finance: null | { mrr: number; mrrByPlan: { plan: string; mrr: number }[]; received: number; receivedManual: number; pending: { count: number; amount: number }; overdue: { count: number; amount: number };
    revenueDaily: { day: string; amount: number }[]; churnPeriod: number };
};
const ranges: Record<string, [string, () => [Date, Date]]> = {
  hoje: ['Hoje', () => [new Date(), new Date()]],
  '7d': ['7 dias', () => [new Date(Date.now() - 6 * 864e5), new Date()]],
  '30d': ['30 dias', () => [new Date(Date.now() - 29 * 864e5), new Date()]],
  mes: ['Este mês', () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth(), 1), d]; }],
  anterior: ['Mês anterior', () => { const d = new Date(); return [new Date(d.getFullYear(), d.getMonth() - 1, 1), new Date(d.getFullYear(), d.getMonth(), 0)]; }],
  '12m': ['12 meses', () => [new Date(Date.now() - 364 * 864e5), new Date()]],
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const short = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const WIDGETS = ['kpis', 'charts', 'operational'] as const;

export default function Dashboard({ analytics = false }: { analytics?: boolean }) {
  const { can } = useAdmin(); const navigate = useNavigate();
  const [range, setRange] = useState('30d'), [custom, setCustom] = useState<[string, string]>([iso(new Date(Date.now() - 29 * 864e5)), iso(new Date())]);
  const [hidden, setHidden] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem('pistec-admin-widgets') ?? '[]'); } catch { return []; } });
  const [from, to] = range === 'custom' ? custom : ranges[range][1]().map(iso);
  const metrics = useQuery(() => call<Metrics>('admin_metrics', { p_from: from, p_to: to }), [from, to]);
  const recent = useQuery(() => rows<TenantRow>('tenants', 'id,name,plan_id,status,due_date,created_at,email', q => q.order('created_at', { ascending: false }).limit(6)), []);
  const toggle = (w: string) => { const next = hidden.includes(w) ? hidden.filter(x => x !== w) : [...hidden, w]; setHidden(next); try { localStorage.setItem('pistec-admin-widgets', JSON.stringify(next)); } catch { /* opcional */ } };
  const pct = (a: number, b: number) => b ? `${((a / b) * 100).toFixed(1).replace('.', ',')}%` : '—';

  return <div className="page">
    <PageHeader title={analytics ? 'Indicadores SaaS' : 'Dashboard executivo'} subtitle="Números calculados no servidor a partir das empresas, assinaturas e pagamentos reais.">
      <label className="field-inline">Período<select aria-label="Período" value={range} onChange={e => setRange(e.target.value)} data-tour="admin-period">{Object.entries(ranges).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}<option value="custom">Personalizado</option></select></label>
      {range === 'custom' && <><input type="date" aria-label="De" value={custom[0]} max={custom[1]} onChange={e => setCustom([e.target.value, custom[1]])}/><input type="date" aria-label="Até" value={custom[1]} min={custom[0]} onChange={e => setCustom([custom[0], e.target.value])}/></>}
      <details className="widget-picker"><summary className="btn ghost">Personalizar</summary><div className="account-menu">{WIDGETS.map(w => <label key={w}><input type="checkbox" checked={!hidden.includes(w)} onChange={() => toggle(w)}/> {{ kpis: 'Indicadores', charts: 'Gráficos', operational: 'Blocos operacionais' }[w]}</label>)}</div></details>
    </PageHeader>
    <Loaded q={metrics}>{m => <>
      {!hidden.includes('kpis') && <section className="grid grid-4 admin-kpis" data-tour="admin-kpis" aria-label="Indicadores principais">
        <Stat label="Empresas cadastradas" value={m.tenants.total} icon={<Building2 size={22}/>} hint={`${m.tenants.newInPeriod} nova${m.tenants.newInPeriod === 1 ? '' : 's'} no período`} action={<Link to="/admin/empresas">Ver empresas</Link>}/>
        <Stat label="Empresas ativas (pagantes)" value={m.tenants.active} tone="green" icon={<TrendingUp size={22}/>} hint={`${pct(m.tenants.active, m.tenants.total)} do total`}/>
        <Stat label="Em teste grátis" value={m.tenants.trial} tone="cyan" icon={<Clock size={22}/>} hint={`${m.tenants.trialEnding} terminam em 7 dias`} action={<Link to="/admin/empresas/testes">Ver testes</Link>}/>
        <Stat label="Inadimplentes / suspensas" value={`${m.tenants.overdue} / ${m.tenants.suspended}`} tone="red" icon={<AlertTriangle size={22}/>} action={<Link to="/admin/empresas/inadimplentes">Tratar</Link>}/>
        {m.finance && <>
          <Stat label="MRR (receita recorrente mensal)" value={money(m.finance.mrr)} tone="purple" icon={<CircleDollarSign size={22}/>} hint="Valor mensal equivalente das assinaturas ativas. Não é dinheiro recebido."/>
          <Stat label="ARR (MRR × 12)" value={money(m.finance.mrr * 12)} tone="purple" icon={<Layers size={22}/>} hint="Projeção anual, não receita realizada."/>
          <Stat label="Recebido no período" value={money(m.finance.received)} tone="green" icon={<Receipt size={22}/>} hint={m.finance.receivedManual ? `+ ${money(m.finance.receivedManual)} em baixas manuais` : 'Pagamentos confirmados pela InfinitePay'}/>
          <Stat label="Cobranças pendentes / vencidas" value={`${m.finance.pending.count} / ${m.finance.overdue.count}`} tone="amber" icon={<CalendarClock size={22}/>} hint={`${money(m.finance.pending.amount)} a receber · ${money(m.finance.overdue.amount)} vencido`} action={<Link to="/admin/faturas">Ver faturas</Link>}/>
        </>}
        <Stat label="Chamados abertos" value={m.tickets} tone="amber" icon={<Headphones size={22}/>} action={can('support.manage') ? <Link to="/admin/suporte">Abrir suporte</Link> : undefined}/>
        <Stat label="Leads em andamento" value={m.leads} icon={<UserPlus size={22}/>} action={can('leads.manage') ? <Link to="/admin/leads">Abrir CRM</Link> : undefined}/>
        <Stat label="Onboarding incompleto" value={m.tenants.onboardingIncomplete} tone="cyan" icon={<Layers size={22}/>} hint="Empresas sem nenhum produto cadastrado" action={<Link to="/admin/onboarding">Acompanhar</Link>}/>
        {m.finance && <Stat label="Cancelamentos no período" value={m.finance.churnPeriod} tone="red" icon={<TrendingUp size={22}/>} hint={m.tenants.total ? `Churn simples: ${pct(m.finance.churnPeriod, m.tenants.active + m.tenants.overdue + m.finance.churnPeriod)}` : 'Sem base para calcular churn'}/>}
      </section>}
      {!hidden.includes('charts') && <section className="grid grid-2" style={{ marginTop: 16 }} data-tour="admin-charts">
        {m.finance && <Panel title="Receita recebida por dia"><BarSeries label="Receita recebida por dia" data={m.finance.revenueDaily.map(d => ({ x: short(d.day), y: Number(d.amount) }))} format={money}/></Panel>}
        <Panel title="Novas empresas por dia"><BarSeries label="Cadastros por dia" data={m.growth.map(d => ({ x: short(d.day), y: Number(d.created) }))} format={n => String(n)}/></Panel>
        <Panel title="Empresas por plano"><Distribution items={m.plans.map(p => ({ label: p.name, value: Number(p.tenants) }))}/></Panel>
        <Panel title="Situação das assinaturas"><Distribution items={Object.entries({ trialing: 'Em teste', active: 'Ativas', past_due: 'Vencidas (tolerância)', suspended: 'Suspensas', cancelled: 'Canceladas' }).map(([k, l]) => ({ label: l, value: Number(m.subscriptions[k] ?? 0) }))}/></Panel>
        {m.finance && <Panel title="MRR por plano"><Distribution items={m.finance.mrrByPlan.map(p => ({ label: p.plan, value: Number(p.mrr) }))} format={money}/>{!m.finance.mrrByPlan.length && <p className="muted">Nenhuma assinatura paga ativa ainda.</p>}</Panel>}
      </section>}
      {!hidden.includes('operational') && <section className="grid grid-2" style={{ marginTop: 16 }} data-tour="admin-operational">
        <Panel title="Últimas empresas cadastradas"><Loaded q={recent}>{list => list.length ? <ul className="list-rows">{list.map(t => <li key={t.id}><button className="row-link" onClick={() => navigate(`/admin/empresas/${t.id}`)}>{t.name}</button><StatusBadge>{tenantStatus[t.status] ?? t.status}</StatusBadge><small>{new Date(t.created_at).toLocaleDateString('pt-BR')}</small></li>)}</ul>
          : <p className="muted">Nenhuma empresa ainda. Empresas aparecem aqui quando alguém se cadastra em /app/cadastro e cria a empresa.</p>}</Loaded></Panel>
        <Panel title="Testes terminando em 7 dias"><TrialsEnding/></Panel>
      </section>}
    </>}</Loaded>
  </div>;
}

function TrialsEnding() {
  const q = useQuery(() => rows<TenantRow>('tenants', 'id,name,due_date,plan_id', b => b.eq('status', 'Teste').lte('due_date', new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10)).order('due_date')), []);
  const navigate = useNavigate();
  return <Loaded q={q}>{list => list.length ? <ul className="list-rows">{list.map(t => <li key={t.id}><button className="row-link" onClick={() => navigate(`/admin/empresas/${t.id}`)}>{t.name}</button><span>{daysUntil(t.due_date) <= 0 ? 'Termina hoje' : `${daysUntil(t.due_date)} dia(s)`}</span></li>)}</ul> : <p className="muted">Nenhum teste termina nos próximos 7 dias.</p>}</Loaded>;
}
