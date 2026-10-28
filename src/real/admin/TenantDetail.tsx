import { useState, type FormEvent } from 'react';
import BrazilianAddressFields from '../../features/address/BrazilianAddressFields';
import { addressErrors, hasAddress, toAddress, type Address } from '../../services/address';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Building2, CalendarPlus, Pause, Play, Repeat, XCircle } from 'lucide-react';
import { Button, Field, Modal, Panel } from '../../ui';
import { money } from '../../lib';
import { call, daysUntil, periods, rows, subscriptionStatus, tenantStatus, useQuery, type PlanRow, type RecordRow } from './data';
import { useAdmin } from './context';
import { ConfirmAction, KeyValue, Loaded, StatusBadge, Tabs, Timeline } from './ui';

type Detail = {
  tenant: { id: string; name: string; legal_name: string; document: string; owner_name: string; email: string; phone: string; whatsapp: string; address: string; address_data?: unknown; website: string; profile: string;
    plan_id: string; status: string; due_date: string; created_at: string; notes: string; logo: string | null; slug: string };
  subscription: { plan_id: string; period: string; status: string; current_period_end: string; provider: string; cancel_at_period_end: boolean; updated_at: string } | null;
  plan: { name: string; monthly: number; quarterly: number; annual: number; users: number; branches: number; products: number; whatsapp: number; ai_messages: number; features: string[]; modules: string[] } | null;
  usage: Record<'users' | 'branches' | 'products' | 'customers' | 'sales30' | 'whatsapp' | 'ai30' | 'emails30' | 'pushDevices', number>;
  members: { role: string; active: boolean; email: string; since: string; allBranches: boolean }[];
  invites: { email: string; role: string; expires: string; accepted: boolean; revoked: boolean }[];
  branches: { name: string; active: boolean; created: string }[];
  whatsappInstances: { status: string; bot: boolean; updated: string }[];
  invoices: { id: string; plan_id: string; period: string; amount: number; discount: number; coupon_code: string | null; status: string; due_date: string; paid_at: string | null; capture_method: string | null; created_at: string }[] | null;
  audit: { at: string; action: string; data: { reason?: string; before?: unknown; after?: unknown }; by: string | null }[] | null;
  tickets: { id: string; title: string; status: string; date: string }[];
  notes: { id: string; title: string; date: string; history: RecordRow['history'] }[];
};
type Tab = 'geral' | 'cadastro' | 'assinatura' | 'cobrancas' | 'usuarios' | 'filiais' | 'integracoes' | 'suporte' | 'auditoria';
type Action = null | 'extend' | 'plan' | 'suspend' | 'reactivate' | 'cancel' | 'end_trial' | 'edit';
const date = (s?: string | null) => s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—';

export default function TenantDetail() {
  const { id = '' } = useParams(); const [params, setParams] = useSearchParams(); const { can } = useAdmin();
  const tab = (params.get('aba') as Tab) || 'geral';
  const q = useQuery(() => call<Detail>('admin_tenant_detail', { p_tenant: id }), [id]);
  const plans = useQuery(() => rows<PlanRow>('plans', 'id,name,active,users,branches,products,whatsapp', b => b.order('sort')), []);
  const [action, setAction] = useState<Action>(null), [days, setDays] = useState(15), [planId, setPlanId] = useState(''), [status, setStatus] = useState('');
  const run = async (fn: string, args: Record<string, unknown>, ok: string) => { await call(fn, args); setStatus(ok); q.reload(); };

  return <div className="page"><Link to="/admin/empresas" className="btn ghost"><ArrowLeft size={16}/>Empresas</Link>
    <Loaded q={q}>{d => { if (!d) return <p role="alert">Empresa não encontrada.</p>; const t = d.tenant, s = d.subscription; const newEnd = s ? new Date(Math.max(new Date(s.current_period_end + 'T12:00:00').getTime(), Date.now()) + days * 864e5) : null;
      return <>
      <header className="tenant-hero" data-tour="tenant-header">
        <div className="tenant-logo">{t.logo ? <img src={t.logo} alt=""/> : <Building2 size={30}/>}</div>
        <div><h1>{t.name}</h1><p className="muted">{t.legal_name}{t.document ? ` · CNPJ ${t.document}` : ''}</p>
          <div className="toolbar"><StatusBadge>{tenantStatus[t.status] ?? t.status}</StatusBadge><span className="badge info">{d.plan?.name ?? t.plan_id}</span>
            <small className="muted">Responsável: {t.owner_name || '—'} · Cadastro {date(t.created_at)} · Vence {date(t.due_date)}{t.status === 'Teste' && ` (${daysUntil(t.due_date)} dia(s) de teste)`}</small></div></div>
        <div className="toolbar tenant-actions" data-tour="tenant-actions">
          {can('tenants.edit') && <Button onClick={() => setAction('edit')}>Editar dados</Button>}
          {can('subscriptions.manage') && <>
            {s?.status === 'trialing' && <Button icon={<CalendarPlus size={15}/>} variant="primary" onClick={() => setAction('extend')}>Prorrogar teste</Button>}
            <Button icon={<Repeat size={15}/>} onClick={() => { setPlanId(t.plan_id); setAction('plan'); }}>Alterar plano</Button>
            {['Suspensa', 'Vencida', 'Cancelada'].includes(t.status) ? <Button icon={<Play size={15}/>} variant="primary" onClick={() => setAction('reactivate')}>Reativar</Button>
              : <Button icon={<Pause size={15}/>} variant="danger" onClick={() => setAction('suspend')}>Suspender</Button>}
            {!s?.cancel_at_period_end && t.status !== 'Cancelada' && <Button icon={<XCircle size={15}/>} onClick={() => setAction('cancel')}>Cancelar assinatura</Button>}
          </>}
        </div>
      </header>
      {status && <p role="status" className="callout">{status}</p>}
      <Tabs<Tab> label="Seções da empresa" value={tab} onChange={v => setParams({ aba: v })} items={[['geral', 'Visão geral'], ['cadastro', 'Dados cadastrais'], ['assinatura', 'Plano e assinatura'],
        ...(d.invoices ? [['cobrancas', 'Cobranças'] as [Tab, string]] : []), ['usuarios', 'Usuários'], ['filiais', 'Filiais'], ['integracoes', 'Integrações e consumo'], ['suporte', 'Suporte e notas'],
        ...(d.audit ? [['auditoria', 'Auditoria'] as [Tab, string]] : [])]}/>

      {tab === 'geral' && <div className="grid grid-3">
        <Panel title="Uso x limites do plano"><KeyValue items={[['Usuários ativos', `${d.usage.users} / ${d.plan?.users ?? '—'}`], ['Filiais', `${d.usage.branches} / ${d.plan?.branches ?? '—'}`], ['Produtos', `${d.usage.products} / ${d.plan?.products ?? '—'}`], ['WhatsApp', `${d.usage.whatsapp} / ${d.plan?.whatsapp ?? '—'}`]]}/></Panel>
        <Panel title="Atividade (30 dias)"><KeyValue items={[['Vendas', d.usage.sales30], ['Clientes cadastrados', d.usage.customers], ['Consultas à IA', d.usage.ai30], ['E-mails', d.usage.emails30], ['Dispositivos com push', d.usage.pushDevices]]}/></Panel>
        <Panel title="Assinatura"><KeyValue items={[['Situação', s ? subscriptionStatus[s.status] ?? s.status : '—'], ['Periodicidade', s ? periods[s.period] : '—'], ['Fim do período', date(s?.current_period_end)], ['Cancelamento agendado', s?.cancel_at_period_end ? 'Sim, ao fim do período' : 'Não']]}/></Panel>
      </div>}
      {tab === 'cadastro' && <Panel title="Dados cadastrais"><KeyValue items={[['Nome fantasia', t.name], ['Razão social', t.legal_name], ['CNPJ', t.document], ['Responsável', t.owner_name], ['E-mail', t.email], ['Telefone', t.phone], ['WhatsApp', t.whatsapp], ['Endereço', t.address], ['Site', t.website], ['Segmento', t.profile], ['Endereço no sistema', `/loja/${t.slug}`], ['Cadastro', date(t.created_at)]]}/></Panel>}
      {tab === 'assinatura' && <div className="grid grid-2"><Panel title="Plano contratado"><KeyValue items={[['Plano', d.plan?.name], ['Mensal', d.plan ? money(d.plan.monthly) : '—'], ['Trimestral', d.plan ? money(d.plan.quarterly) : '—'], ['Anual', d.plan ? money(d.plan.annual) : '—'], ['IA por dia', d.plan?.ai_messages], ['Módulos', d.plan?.modules.includes('*') ? 'Todos' : d.plan?.modules.join(', ')]]}/>
        {d.plan?.features.length ? <ul>{d.plan.features.map(f => <li key={f}>{f}</li>)}</ul> : null}</Panel>
        <Panel title="Ciclo de vida"><KeyValue items={[['Situação', s ? subscriptionStatus[s.status] : '—'], ['Gateway', s?.provider], ['Fim do período atual', date(s?.current_period_end)], ['Última alteração', date(s?.updated_at)]]}/>
          <p className="muted small">Alterar o preço de um plano não muda faturas já emitidas: cada fatura guarda o valor no momento da emissão.</p></Panel></div>}
      {tab === 'cobrancas' && d.invoices && <Panel title="Faturas da assinatura">{d.invoices.length ? <div className="table-wrap"><table className="responsive-table"><thead><tr><th>Fatura</th><th>Plano</th><th>Valor</th><th>Vencimento</th><th>Situação</th><th>Pagamento</th></tr></thead><tbody>
        {d.invoices.map(i => <tr key={i.id}><td data-label="Fatura"><code>{i.id.slice(0, 8)}</code></td><td data-label="Plano">{i.plan_id} · {periods[i.period]}</td><td data-label="Valor">{money(i.amount)}{i.discount > 0 && <small className="muted"> (−{money(i.discount)} {i.coupon_code})</small>}</td>
          <td data-label="Vencimento">{date(i.due_date)}</td><td data-label="Situação"><StatusBadge>{i.status}</StatusBadge></td><td data-label="Pagamento">{i.paid_at ? `${date(i.paid_at)} · ${i.capture_method === 'manual' ? 'baixa manual' : i.capture_method}` : '—'}</td></tr>)}</tbody></table></div> : <p className="muted">Nenhuma fatura emitida.</p>}</Panel>}
      {tab === 'usuarios' && <div className="grid grid-2"><Panel title={`Equipe (${d.members.length})`}><ul className="list-rows">{d.members.map(m => <li key={m.email + m.role}><span>{m.email}</span><StatusBadge>{m.role}</StatusBadge><small>{m.active ? 'Ativo' : 'Inativo'} · {m.allBranches ? 'todas as filiais' : 'filiais restritas'}</small></li>)}</ul>
        <p className="muted small">Por privacidade, o painel mostra só e-mail, papel e situação dos funcionários.</p></Panel>
        <Panel title="Convites"><ul className="list-rows">{d.invites.map((i, n) => <li key={n}><span>{i.email}</span><small>{i.role} · {i.accepted ? 'Aceito' : i.revoked ? 'Revogado' : `Expira ${date(i.expires)}`}</small></li>)}</ul>{!d.invites.length && <p className="muted">Nenhum convite.</p>}</Panel></div>}
      {tab === 'filiais' && <Panel title={`Filiais (${d.branches.length} de ${d.plan?.branches ?? '—'} permitidas)`}><ul className="list-rows">{d.branches.map(b => <li key={b.name + b.created}><span>{b.name}</span><StatusBadge>{b.active ? 'Ativa' : 'Inativa'}</StatusBadge><small>desde {date(b.created)}</small></li>)}</ul></Panel>}
      {tab === 'integracoes' && <div className="grid grid-2"><Panel title="WhatsApp">{d.whatsappInstances.length ? <ul className="list-rows">{d.whatsappInstances.map((w, n) => <li key={n}><StatusBadge>{w.status === 'open' ? 'Conectado' : w.status}</StatusBadge><small>Assistente IA: {w.bot ? 'ligado' : 'desligado'} · {date(w.updated)}</small></li>)}</ul> : <p className="muted">WhatsApp não conectado.</p>}</Panel>
        <Panel title="Consumo (30 dias)"><KeyValue items={[['IA (consultas)', `${d.usage.ai30} · limite diário ${d.plan?.ai_messages ?? 0}`], ['E-mails', d.usage.emails30], ['Dispositivos com push', d.usage.pushDevices]]}/></Panel></div>}
      {tab === 'suporte' && <SupportTab tenant={t.id} tickets={d.tickets} notes={d.notes} reload={q.reload}/>}
      {tab === 'auditoria' && d.audit && <Panel title="Histórico administrativo"><ol className="timeline">{d.audit.map((a, n) => <li key={n}><time>{new Date(a.at).toLocaleString('pt-BR')}</time><p>{a.action}</p>
        <small>{a.by ?? 'sistema'}{a.data?.reason ? ` · Motivo: ${a.data.reason}` : ''}{a.data?.before !== undefined ? ` · Antes: ${JSON.stringify(a.data.before)} → Depois: ${JSON.stringify(a.data.after)}` : ''}</small></li>)}</ol>{!d.audit.length && <p className="muted">Sem registros.</p>}</Panel>}

      <ConfirmAction open={action === 'extend'} title="Prorrogar período de teste" confirmLabel="Prorrogar" onClose={() => setAction(null)} onConfirm={r => run('admin_extend_trial', { p_tenant: t.id, p_days: days, p_reason: r }, `Teste prorrogado em ${days} dias.`)}
        description={<KeyValue items={[['Término atual', date(s?.current_period_end)], ['Novo término', newEnd ? newEnd.toLocaleDateString('pt-BR') : '—']]}/>}>
        <Field label="Dias adicionais (1 a 90)"><input type="number" min={1} max={90} value={days} onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}/></Field></ConfirmAction>
      <ConfirmAction open={action === 'plan'} title="Alterar plano" confirmLabel="Alterar plano" onClose={() => setAction(null)} onConfirm={r => run('admin_change_plan', { p_tenant: t.id, p_plan: planId, p_reason: r }, 'Plano alterado.')}
        description={<p>O servidor confere se o uso atual cabe nos limites do novo plano. Nada é apagado. A próxima fatura usa o preço do novo plano; faturas emitidas não mudam.</p>}>
        <Field label="Novo plano"><select value={planId} onChange={e => setPlanId(e.target.value)}>{plans.data?.map(p => <option key={p.id} value={p.id}>{p.name}{p.active ? '' : ' (inativo)'} · {p.users} usuários · {p.branches} filiais · {p.products} produtos</option>)}</select></Field></ConfirmAction>
      <ConfirmAction open={action === 'suspend'} danger title={`Suspender ${t.name}?`} confirmLabel="Suspender empresa" onClose={() => setAction(null)} onConfirm={r => run('admin_set_subscription', { p_tenant: t.id, p_action: 'suspend', p_reason: r }, 'Empresa suspensa.')}
        description={<p>A empresa passa a ver os dados apenas para consulta (nenhum dado é apagado) até ser reativada.</p>}/>
      <ConfirmAction open={action === 'reactivate'} title={`Reativar ${t.name}`} confirmLabel="Reativar" onClose={() => setAction(null)} onConfirm={r => run('admin_set_subscription', { p_tenant: t.id, p_action: 'reactivate', p_reason: r, p_days: days }, 'Empresa reativada.')}
        description={<p>Libera o acesso completo e define um novo fim de período. Use quando o pagamento foi confirmado ou por decisão comercial.</p>}>
        <Field label="Liberar por quantos dias"><input type="number" min={1} max={365} value={days} onChange={e => setDays(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}/></Field></ConfirmAction>
      <ConfirmAction open={action === 'cancel'} danger title="Cancelar assinatura ao fim do período" confirmLabel="Agendar cancelamento" onClose={() => setAction(null)} onConfirm={r => run('admin_set_subscription', { p_tenant: t.id, p_action: 'cancel', p_reason: r }, 'Cancelamento agendado para o fim do período.')}
        description={<p>O período já pago é respeitado. A empresa é cancelada automaticamente em {date(s?.current_period_end)}. Os dados permanecem guardados.</p>}/>
      {action === 'edit' && <EditTenant tenant={t} onClose={() => setAction(null)} onSaved={() => { setStatus('Dados atualizados.'); q.reload(); }}/>}
    </>; }}</Loaded></div>;
}

function EditTenant({ tenant, onClose, onSaved }: { tenant: Detail['tenant']; onClose: () => void; onSaved: () => void }) {
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const [address, setAddress] = useState<Address>(() => toAddress(tenant.address_data)), [addrErrors, setAddrErrors] = useState<Partial<Record<keyof Address, string>>>({});
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const filled = hasAddress(address), errs = filled ? addressErrors(address) : {}; setAddrErrors(errs); if (Object.keys(errs).length) { setError('Complete o endereço ou deixe-o em branco.'); return; }
    const p = Object.fromEntries(new FormData(e.currentTarget)); setPending(true); setError('');
    try { await call('admin_save_tenant', { p: { ...p, id: tenant.id, ...(filled ? { addressData: address } : {}) } }); onSaved(); onClose(); } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setPending(false); }
  };
  const fields: [string, string, string][] = [['name', 'Nome fantasia', tenant.name], ['legalName', 'Razão social', tenant.legal_name], ['document', 'CNPJ', tenant.document], ['owner', 'Responsável', tenant.owner_name], ['email', 'E-mail', tenant.email],
    ['phone', 'Telefone', tenant.phone], ['whatsapp', 'WhatsApp', tenant.whatsapp], ['website', 'Site', tenant.website], ['profile', 'Segmento', tenant.profile]];
  return <Modal title="Editar dados cadastrais" open onClose={onClose} size="lg"><form className="stack" onSubmit={submit}><p className="muted">Plano, situação e vencimento mudam pelas ações próprias (com justificativa).</p>
    <div className="form-grid">{fields.map(([k, l, v]) => <Field key={k} label={l}><input name={k} defaultValue={v} required={k === 'name' || k === 'email'} type={k === 'email' ? 'email' : 'text'} maxLength={300}/></Field>)}</div>
    {tenant.address && !hasAddress(address) && <p className="muted small">Endereço atual (texto livre): {tenant.address}</p>}
    <BrazilianAddressFields legend="Endereço da empresa" required={false} value={address} errors={addrErrors} disabled={pending} onChange={a => { setAddress(a); setAddrErrors({}); }}/>
    {error && <p role="alert" className="field-error">{error}</p>}<div className="toolbar"><Button onClick={onClose}>Cancelar</Button><Button type="submit" variant="primary" loading={pending}>Salvar</Button></div></form></Modal>;
}

function SupportTab({ tenant, tickets, notes, reload }: { tenant: string; tickets: Detail['tickets']; notes: Detail['notes']; reload: () => void }) {
  const { can } = useAdmin(); const [text, setText] = useState(''), [error, setError] = useState('');
  const addNote = async () => { setError(''); try { await call('admin_save_record', { p: { kind: 'admin-note', title: text.slice(0, 120), status: 'Registrada', fields: { tenantId: tenant, body: text } } }); setText(''); reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Erro.'); } };
  return <div className="grid grid-2"><Panel title="Chamados">{tickets.length ? <ul className="list-rows">{tickets.map(t => <li key={t.id}><Link to={`/admin/suporte?id=${t.id}`}>{t.title}</Link><StatusBadge>{t.status}</StatusBadge></li>)}</ul> : <p className="muted">Nenhum chamado.</p>}
    {can('support.manage') && <Link className="btn" to={`/admin/suporte?novo=${tenant}`}>Abrir chamado para esta empresa</Link>}</Panel>
    <Panel title="Observações internas">{notes.map(n => <div key={n.id}><strong>{n.title}</strong><Timeline items={n.history}/></div>)}{!notes.length && <p className="muted">Nenhuma observação.</p>}
      {can('tenants.edit') && <div className="stack"><Field label="Nova observação"><textarea value={text} onChange={e => setText(e.target.value)} maxLength={2000}/></Field><Button disabled={text.trim().length < 3} onClick={() => void addNote()}>Registrar</Button>{error && <p role="alert">{error}</p>}</div>}</Panel></div>;
}
