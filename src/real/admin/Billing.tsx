import { useMemo, useState, type FormEvent } from 'react';
import { trialLabel } from '../../services/trial';
import { STATUS_LABEL, type Feature, type FeatureStatus } from '../../services/catalog';
import { useNavigate } from 'react-router-dom';
import { Download, Plus } from 'lucide-react';
import { Button, Field, Modal, PageHeader, Panel, Stat } from '../../ui';
import { exportCsv, money } from '../../lib';
import { call, periods, rows, subscriptionStatus, useQuery, type InvoiceRow, type PlanRow, type SubscriptionRow, type TenantRow } from './data';
import { useAdmin } from './context';
import { AdvancedTable, ConfirmAction, EmptyState, Loaded, StatusBadge } from './ui';

const date = (s?: string | null) => s ? new Date(s.length === 10 ? s + 'T12:00:00' : s).toLocaleDateString('pt-BR') : '—';
const cents = (v: FormDataEntryValue | null) => Math.round(Number(String(v ?? '0').replace(/\./g, '').replace(',', '.')) * 100);

export function Subscriptions() {
  const navigate = useNavigate();
  const q = useQuery(async () => {
    const [subs, tenants, plans] = await Promise.all([rows<SubscriptionRow>('subscriptions'), rows<TenantRow>('tenants', 'id,name'), rows<PlanRow>('plans', 'id,name,monthly,quarterly,annual')]);
    return subs.map(s => { const p = plans.find(x => x.id === s.plan_id); return { ...s, id: s.tenant_id, tenant: tenants.find(t => t.id === s.tenant_id)?.name ?? '—', planName: p?.name ?? s.plan_id, value: p ? p[s.period as 'monthly'] : 0 }; });
  }, []);
  const [status, setStatus] = useState('');
  const data = (q.data ?? []).filter(s => !status || s.status === status || (status === 'expiring' && ['active', 'trialing'].includes(s.status) && new Date(s.current_period_end).getTime() - Date.now() < 7 * 864e5));
  return <div className="page"><PageHeader title="Assinaturas" subtitle="Ciclo de vida de cada empresa. Ações (prorrogar, alterar plano, suspender, reativar, cancelar) ficam no perfil da empresa.">
    <select aria-label="Situação" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todas</option><option value="expiring">Vencendo em 7 dias</option>{Object.entries(subscriptionStatus).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></PageHeader>
    <Panel><Loaded q={q}>{() => <AdvancedTable caption="Assinaturas" tour="admin-subscriptions" rows={data} onRow={s => navigate(`/admin/empresas/${s.tenant_id}?aba=assinatura`)} search={s => `${s.tenant} ${s.planName}`}
      columns={[{ key: 'tenant', label: 'Empresa', sort: s => s.tenant }, { key: 'plan', label: 'Plano', render: s => s.planName }, { key: 'period', label: 'Periodicidade', render: s => periods[s.period] },
        { key: 'value', label: 'Valor', sort: s => s.value, render: s => money(s.value) }, { key: 'status', label: 'Situação', sort: s => s.status, render: s => <><StatusBadge>{subscriptionStatus[s.status] ?? s.status}</StatusBadge>{s.cancel_at_period_end && <small className="muted"> · cancela ao fim</small>}</> },
        { key: 'end', label: 'Fim do período', sort: s => s.current_period_end, render: s => date(s.current_period_end) }, { key: 'gw', label: 'Gateway', render: s => s.provider }]}/>}</Loaded></Panel></div>;
}

type CatalogData = { plans: { id: string; name: string; features: string[] }[]; features: (Pick<Feature, 'key' | 'name' | 'category' | 'status' | 'summary'> & { modules: string[] })[] };
/** Recursos comerciais (fonte única da landing, contratação e Anexo I) e sua liberação por plano, calculada dos módulos do plano. */
function FeatureMatrix({ canEdit }: { canEdit: boolean }) {
  const q = useQuery(() => call<CatalogData>('plan_catalog'), []);
  const [change, setChange] = useState<{ key: string; name: string; status: FeatureStatus } | null>(null);
  return <Panel title="Recursos e planos" className="feature-matrix">
    <p className="muted small">Mesma lista exibida em /planos, na contratação e no Anexo I do contrato. A liberação vem dos módulos de cada plano e é aplicada pelo servidor. Alterar o estado comercial não muda preços nem módulos.</p>
    <Loaded q={q}>{c => <div className="table-wrap"><table className="responsive-table"><caption>Recursos por plano</caption>
      <thead><tr><th scope="col">Recurso</th><th scope="col">Estado</th>{c.plans.map(p => <th scope="col" key={p.id}>{p.name}</th>)}</tr></thead>
      <tbody>{c.features.map(f => <tr key={f.key}>
        <td data-label="Recurso"><strong>{f.name}</strong><br/><small className="muted">{f.category} · módulos: {f.modules.join(', ')}</small></td>
        <td data-label="Estado">{canEdit ? <select aria-label={`Estado de ${f.name}`} value={f.status} onChange={e => setChange({ key: f.key, name: f.name, status: e.target.value as FeatureStatus })}>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select> : <StatusBadge>{STATUS_LABEL[f.status]}</StatusBadge>}</td>
        {c.plans.map(p => <td key={p.id} data-label={p.name}>{p.features.includes(f.key) ? 'Incluído' : '—'}</td>)}</tr>)}</tbody></table></div>}</Loaded>
    <ConfirmAction open={!!change} title={`Alterar estado de ${change?.name ?? ''}`} confirmLabel="Alterar estado" onClose={() => setChange(null)}
      description={<p>Novo estado: <strong>{change && STATUS_LABEL[change.status]}</strong>. Aparece imediatamente na landing e nos planos. Só marque “Disponível” após homologar o recurso.</p>}
      onConfirm={async reason => { await call('admin_set_feature_status', { p_key: change!.key, p_status: change!.status, p_reason: reason }); q.reload(); }}/>
  </Panel>;
}

export function Plans() {
  const { role } = useAdmin(); const q = useQuery(() => rows<PlanRow>('plans', '*', b => b.order('sort')), []);
  const usage = useQuery(() => rows<TenantRow>('tenants', 'plan_id,status'), []);
  const [edit, setEdit] = useState<PlanRow | 'new' | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const canEdit = role === 'owner' || role === 'admin'; // espelha app.require_platform_admin
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); const f = new FormData(e.currentTarget); setPending(true); setError('');
    try {
      await call('admin_save_plan', { p: { id: edit !== 'new' ? edit?.id : '', name: f.get('name'), monthly: cents(f.get('monthly')), quarterly: cents(f.get('quarterly')), annual: cents(f.get('annual')),
        users: Number(f.get('users')), branches: Number(f.get('branches')), products: Number(f.get('products')), whatsapp: Number(f.get('whatsapp')), aiMessages: Number(f.get('aiMessages')),
        trialMonths: Number(f.get('trialMonths')), sort: Number(f.get('sort')), active: f.get('active') === 'on', features: String(f.get('features')).split('\n').map(s => s.trim()).filter(Boolean) } });
      setEdit(null); q.reload();
    } catch (err) { setError(err instanceof Error ? err.message : 'Erro ao salvar.'); } finally { setPending(false); }
  };
  const p = edit && edit !== 'new' ? edit : null;
  const reais = (n?: number) => n == null ? '' : (n / 100).toFixed(2).replace('.', ',');
  return <div className="page"><PageHeader title="Planos SaaS" subtitle="Preços e limites usados na landing, no cadastro e nas faturas. Alterar preço não muda faturas já emitidas.">{canEdit && <Button variant="primary" icon={<Plus size={15}/>} onClick={() => setEdit('new')}>Novo plano</Button>}</PageHeader>
    <Loaded q={q}>{plans => <div className="grid grid-4" data-tour="admin-plans">{plans.map(pl => <Panel key={pl.id} className={pl.active ? '' : 'is-muted'} title={pl.name}>
      <p className="plan-price">{money(pl.monthly)}<small>/mês</small></p><p className="muted small">Trimestral {money(pl.quarterly)} · Anual {money(pl.annual)}</p>
      <ul className="plan-limits"><li>{pl.users} usuários</li><li>{pl.branches} filiais</li><li>{pl.products.toLocaleString('pt-BR')} produtos</li><li>{pl.whatsapp} WhatsApp</li><li>{pl.ai_messages} consultas IA/dia</li><li>{trialLabel(pl.trial_months ?? 1)}</li></ul>
      <p className="small"><StatusBadge>{pl.active ? 'Ativo' : 'Inativo'}</StatusBadge> · {usage.data?.filter(t => t.plan_id === pl.id && t.status !== 'Cancelada').length ?? '…'} empresa(s)</p>
      {canEdit && <Button onClick={() => setEdit(pl)}>Editar</Button>}</Panel>)}</div>}</Loaded>
    <FeatureMatrix canEdit={canEdit}/>
    {edit && <Modal title={p ? `Editar plano ${p.name}` : 'Novo plano'} open onClose={() => setEdit(null)} size="lg"><form className="stack" onSubmit={submit}>
      <fieldset><legend>Identificação</legend><div className="form-grid"><Field label="Nome"><input name="name" required defaultValue={p?.name} maxLength={60}/></Field><Field label="Ordem na landing"><input name="sort" type="number" min={0} defaultValue={p?.sort ?? 9}/></Field>
        <label><input type="checkbox" name="active" defaultChecked={p?.active ?? true}/> Ativo (aparece para novas contratações)</label></div></fieldset>
      <fieldset><legend>Preços (R$)</legend><div className="form-grid"><Field label="Mensal"><input name="monthly" inputMode="decimal" required defaultValue={reais(p?.monthly)}/></Field><Field label="Trimestral"><input name="quarterly" inputMode="decimal" required defaultValue={reais(p?.quarterly)}/></Field><Field label="Anual"><input name="annual" inputMode="decimal" required defaultValue={reais(p?.annual)}/></Field></div></fieldset>
      <fieldset><legend>Limites</legend><div className="form-grid">{([['users', 'Usuários', p?.users], ['branches', 'Filiais', p?.branches], ['products', 'Produtos', p?.products], ['whatsapp', 'Instâncias WhatsApp', p?.whatsapp], ['aiMessages', 'Consultas IA por dia', p?.ai_messages], ['trialMonths', 'Meses de teste grátis (0–3)', p?.trial_months ?? 1]] as const).map(([k, l, v]) =>
        <Field key={k} label={l}><input name={k} type="number" min={0} max={k === 'trialMonths' ? 3 : undefined} required defaultValue={v ?? 0}/></Field>)}</div></fieldset>
      <Field label="Destaques livres (legado, um por linha)" hint="A landing, a contratação e o contrato usam a lista “Recursos e planos”, calculada pelos módulos."><textarea name="features" rows={4} defaultValue={p?.features.join('\n')}/></Field>
      {error && <p role="alert" className="field-error">{error}</p>}<div className="toolbar"><Button onClick={() => setEdit(null)}>Cancelar</Button><Button type="submit" variant="primary" loading={pending}>Salvar plano</Button></div></form></Modal>}
  </div>;
}

export function Invoices() {
  const { can } = useAdmin();
  const q = useQuery(async () => { const [inv, tenants] = await Promise.all([rows<InvoiceRow>('billing_invoices', '*', b => b.order('created_at', { ascending: false })), rows<TenantRow>('tenants', 'id,name')]);
    return inv.map(i => ({ ...i, tenant: tenants.find(t => t.id === i.tenant_id)?.name ?? '—' })); }, []);
  const [status, setStatus] = useState(''), [target, setTarget] = useState<{ id: string; action: 'Cancelada' | 'Paga' } | null>(null), [msg, setMsg] = useState('');
  const data = (q.data ?? []).filter(i => !status || i.status === status);
  return <div className="page"><PageHeader title="Faturas e cobranças" subtitle="Cobrança da assinatura PISTEC (separada das vendas das lojas). Pagamento só é confirmado pela InfinitePay ou por baixa manual com justificativa.">
    <select aria-label="Situação" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todas</option>{['Pendente', 'Vencida', 'Paga', 'Cancelada', 'Falhou'].map(s => <option key={s}>{s}</option>)}</select>
    <Button icon={<Download size={15}/>} disabled={!data.length} onClick={() => exportCsv('faturas-pistec.csv', data.map(i => ({ Fatura: i.id, Empresa: i.tenant, Plano: i.plan_id, Período: periods[i.period], Valor: money(i.amount), Vencimento: i.due_date, Situação: i.status, Pagamento: i.paid_at ?? '' })))}>Exportar</Button></PageHeader>
    {msg && <p role="status" className="callout">{msg}</p>}
    <Panel><Loaded q={q}>{() => q.data?.length ? <AdvancedTable caption="Faturas" tour="admin-billing" rows={data} search={i => `${i.id} ${i.tenant} ${i.plan_id}`} columns={[
      { key: 'id', label: 'Fatura', render: i => <code title={i.id}>{i.id.slice(0, 8)}</code> }, { key: 'tenant', label: 'Empresa', sort: i => i.tenant },
      { key: 'plan', label: 'Plano', render: i => `${i.plan_id} · ${periods[i.period]}` }, { key: 'amount', label: 'Valor', sort: i => i.amount, render: i => <>{money(i.amount)}{i.coupon_code && <small className="muted"><br/>cupom {i.coupon_code}</small>}</> },
      { key: 'due', label: 'Vencimento', sort: i => i.due_date, render: i => date(i.due_date) }, { key: 'status', label: 'Situação', sort: i => i.status, render: i => <StatusBadge>{i.status}</StatusBadge> },
      { key: 'paid', label: 'Pagamento', render: i => i.paid_at ? `${date(i.paid_at)} · ${i.capture_method === 'manual' ? 'baixa manual' : i.capture_method}` : '—' },
      ...(can('billing.manage') ? [{ key: 'act', label: 'Ações', render: (i: InvoiceRow) => ['Pendente', 'Vencida'].includes(i.status) ? <div className="toolbar"><Button onClick={e => { e.stopPropagation(); setTarget({ id: i.id, action: 'Paga' }); }}>Baixa manual</Button><Button variant="danger" onClick={e => { e.stopPropagation(); setTarget({ id: i.id, action: 'Cancelada' }); }}>Cancelar</Button></div> : '—' }] : []),
    ]}/> : <EmptyState title="Nenhuma fatura" text="Faturas são criadas quando uma empresa solicita assinatura em Minha assinatura, ou automaticamente 5 dias antes da renovação." help="cobranças vencidas"/>}</Loaded></Panel>
    <ConfirmAction open={!!target} danger={target?.action === 'Cancelada'} title={target?.action === 'Paga' ? 'Registrar baixa manual' : 'Cancelar fatura'} confirmLabel={target?.action === 'Paga' ? 'Registrar pagamento manual' : 'Cancelar fatura'}
      description={target?.action === 'Paga' ? <p>Use só com comprovante (ex.: transferência fora da InfinitePay). A transação fica marcada como <strong>manual</strong>, nunca como InfinitePay, e ativa a assinatura.</p> : <p>A fatura deixa de poder ser paga. O cupom usado volta a ficar disponível.</p>}
      onClose={() => setTarget(null)} onConfirm={async r => { await call('admin_set_invoice_status', { p_invoice: target!.id, p_status: target!.action, p_note: r }); setMsg(target!.action === 'Paga' ? 'Baixa manual registrada.' : 'Fatura cancelada.'); q.reload(); }}/>
  </div>;
}

type Coupon = { id: string; code: string; description: string; kind: 'percent' | 'fixed'; value: number; starts_at: string; ends_at: string; max_uses: number; per_tenant: number; plan_ids: string[]; periods: string[]; active: boolean };
export function Coupons() {
  const q = useQuery(async () => { const [c, r, p] = await Promise.all([rows<Coupon>('coupons'), rows<{ coupon_id: string }>('coupon_redemptions', 'coupon_id'), rows<PlanRow>('plans', 'id,name,monthly,quarterly,annual')]); return { coupons: c.map(x => ({ ...x, uses: r.filter(y => y.coupon_id === x.id).length })), plans: p }; }, []);
  const [edit, setEdit] = useState<Coupon | 'new' | null>(null), [step, setStep] = useState(0), [draft, setDraft] = useState<Partial<Coupon>>({}), [error, setError] = useState(''), [pending, setPending] = useState(false);
  const open = (c: Coupon | 'new') => { setEdit(c); setStep(0); setError(''); setDraft(c === 'new' ? { kind: 'percent', value: 1000, starts_at: new Date().toISOString().slice(0, 10), ends_at: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10), max_uses: 0, per_tenant: 1, plan_ids: [], periods: [], active: true } : c); };
  const set = (k: keyof Coupon, v: unknown) => setDraft(d => ({ ...d, [k]: v }));
  const preview = useMemo(() => (q.data?.plans ?? []).filter(p => !draft.plan_ids?.length || draft.plan_ids.includes(p.id)).map(p => { const base = p.monthly; const off = Math.min(base, draft.kind === 'percent' ? Math.round(base * (draft.value ?? 0) / 10000) : draft.value ?? 0); return { plan: p.name, base, off }; }), [draft, q.data]);
  const save = async () => { setPending(true); setError(''); try { await call('admin_save_coupon', { p: { id: edit !== 'new' ? edit?.id : '', code: draft.code, description: draft.description, kind: draft.kind, value: draft.value, startsAt: draft.starts_at, endsAt: draft.ends_at, maxUses: draft.max_uses, perTenant: draft.per_tenant, planIds: draft.plan_ids, periods: draft.periods, active: draft.active } }); setEdit(null); q.reload(); } catch (e) { setError(e instanceof Error ? e.message : 'Erro.'); } finally { setPending(false); } };
  const steps = ['Identificação', 'Desconto', 'Elegibilidade', 'Limites', 'Revisão'];
  const valid = [!!draft.code && /^[A-Za-z0-9_-]{3,30}$/.test(draft.code) && !!draft.description, (draft.value ?? 0) >= 1 && (draft.kind !== 'percent' || (draft.value ?? 0) <= 10000), true, !!draft.starts_at && !!draft.ends_at && draft.ends_at >= draft.starts_at, true];
  return <div className="page"><PageHeader title="Cupons promocionais" subtitle="Desconto aplicado na criação da fatura. Cupons nunca alteram faturas já emitidas ou pagas."><Button variant="primary" icon={<Plus size={15}/>} onClick={() => open('new')}>Novo cupom</Button></PageHeader>
    <Panel><Loaded q={q}>{d => d.coupons.length ? <AdvancedTable caption="Cupons" tour="admin-coupons" rows={d.coupons} onRow={c => open(c)} search={c => `${c.code} ${c.description}`} columns={[
      { key: 'code', label: 'Código', sort: c => c.code, render: c => <code>{c.code}</code> }, { key: 'desc', label: 'Descrição', render: c => c.description },
      { key: 'value', label: 'Desconto', render: c => c.kind === 'percent' ? `${(c.value / 100).toLocaleString('pt-BR')}%` : money(c.value) },
      { key: 'valid', label: 'Validade', render: c => `${date(c.starts_at)} a ${date(c.ends_at)}` }, { key: 'uses', label: 'Usos', render: c => `${c.uses}${c.max_uses ? ` / ${c.max_uses}` : ''}` },
      { key: 'plans', label: 'Planos', render: c => c.plan_ids.length ? c.plan_ids.join(', ') : 'Todos' }, { key: 'status', label: 'Situação', render: c => <StatusBadge>{!c.active ? 'Inativo' : c.ends_at < new Date().toISOString().slice(0, 10) ? 'Vencido' : 'Ativo'}</StatusBadge> },
    ]}/> : <EmptyState title="Nenhum cupom" text="Crie cupons para campanhas: o lojista informa o código ao solicitar a fatura em Minha assinatura." action={<Button variant="primary" onClick={() => open('new')}>Criar primeiro cupom</Button>} help="criar cupom"/>}</Loaded></Panel>
    {edit && <Modal title={edit === 'new' ? 'Novo cupom' : `Cupom ${draft.code}`} open onClose={() => setEdit(null)} size="lg" footer={<>
      <Button disabled={step === 0} onClick={() => setStep(s => s - 1)}>Voltar</Button>
      {step < 4 ? <Button variant="primary" disabled={!valid[step]} onClick={() => setStep(s => s + 1)}>Continuar</Button> : <Button variant="primary" loading={pending} onClick={() => void save()}>Salvar cupom</Button>}</>}>
      <ol className="stepper" aria-label="Etapas">{steps.map((s, i) => <li key={s} aria-current={i === step ? 'step' : undefined} className={i < step ? 'done' : ''}>{s}</li>)}</ol>
      {step === 0 && <div className="form-grid"><Field label="Código (letras, números, - ou _)"><input value={draft.code ?? ''} onChange={e => set('code', e.target.value.toUpperCase().replace(/\s/g, ''))} maxLength={30} autoFocus/></Field><Field label="Descrição interna"><input value={draft.description ?? ''} onChange={e => set('description', e.target.value)} maxLength={200}/></Field></div>}
      {step === 1 && <div className="form-grid"><Field label="Tipo"><select value={draft.kind} onChange={e => set('kind', e.target.value)}><option value="percent">Percentual</option><option value="fixed">Valor fixo (R$)</option></select></Field>
        <Field label={draft.kind === 'percent' ? 'Percentual (%)' : 'Valor (R$)'} hint="Aplicado sobre a primeira fatura gerada com o cupom."><input inputMode="decimal" value={((draft.value ?? 0) / 100).toString().replace('.', ',')} onChange={e => set('value', Math.round(Number(e.target.value.replace(',', '.')) * 100) || 0)}/></Field></div>}
      {step === 2 && <div className="stack"><fieldset><legend>Planos elegíveis (nenhum marcado = todos)</legend>{q.data?.plans.map(p => <label key={p.id} style={{ display: 'block' }}><input type="checkbox" checked={draft.plan_ids?.includes(p.id)} onChange={e => set('plan_ids', e.target.checked ? [...(draft.plan_ids ?? []), p.id] : draft.plan_ids?.filter(x => x !== p.id))}/> {p.name}</label>)}</fieldset>
        <fieldset><legend>Periodicidades (nenhuma = todas)</legend>{Object.entries(periods).map(([k, l]) => <label key={k} style={{ display: 'block' }}><input type="checkbox" checked={draft.periods?.includes(k)} onChange={e => set('periods', e.target.checked ? [...(draft.periods ?? []), k] : draft.periods?.filter(x => x !== k))}/> {l}</label>)}</fieldset></div>}
      {step === 3 && <div className="form-grid"><Field label="Início"><input type="date" value={draft.starts_at} onChange={e => set('starts_at', e.target.value)}/></Field><Field label="Fim"><input type="date" value={draft.ends_at} min={draft.starts_at} onChange={e => set('ends_at', e.target.value)}/></Field>
        <Field label="Usos totais (0 = sem limite)"><input type="number" min={0} value={draft.max_uses} onChange={e => set('max_uses', Number(e.target.value))}/></Field><Field label="Usos por empresa (0 = sem limite)"><input type="number" min={0} value={draft.per_tenant} onChange={e => set('per_tenant', Number(e.target.value))}/></Field>
        <label><input type="checkbox" checked={draft.active} onChange={e => set('active', e.target.checked)}/> Ativo</label></div>}
      {step === 4 && <div className="stack"><p><strong>{draft.code}</strong> · {draft.description}</p><p>{draft.kind === 'percent' ? `${(draft.value ?? 0) / 100}% de desconto` : `${money(draft.value ?? 0)} de desconto`} · {date(draft.starts_at)} a {date(draft.ends_at)}</p>
        <table><caption>Prévia na mensalidade</caption><thead><tr><th>Plano</th><th>Preço</th><th>Desconto</th><th>Total</th></tr></thead><tbody>{preview.map(p => <tr key={p.plan}><td>{p.plan}</td><td>{money(p.base)}</td><td>−{money(p.off)}</td><td>{money(p.base - p.off)}</td></tr>)}</tbody></table></div>}
      {error && <p role="alert" className="field-error">{error}</p>}</Modal>}
  </div>;
}

export function Finance() {
  const q = useQuery(() => call<{ finance: { mrr: number; received: number; receivedManual: number; pending: { count: number; amount: number }; overdue: { count: number; amount: number }; mrrByPlan: { plan: string; mrr: number }[] } | null }>('admin_metrics', { p_from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10), p_to: new Date().toISOString().slice(0, 10) }), []);
  return <div className="page"><PageHeader title="Receita e faturamento" subtitle="Mês corrente. Receita recebida = pagamentos confirmados; MRR = recorrência contratada (não é dinheiro em caixa)."/>
    <Loaded q={q}>{m => m.finance ? <><div className="grid grid-4"><Stat label="Recebido no mês" value={money(m.finance.received)} tone="green" hint="Confirmado pela InfinitePay"/><Stat label="Baixas manuais no mês" value={money(m.finance.receivedManual)} tone="amber"/>
      <Stat label="MRR" value={money(m.finance.mrr)} tone="purple"/><Stat label="A receber / vencido" value={`${money(m.finance.pending.amount)} / ${money(m.finance.overdue.amount)}`} tone="red" hint={`${m.finance.pending.count} pendente(s), ${m.finance.overdue.count} vencida(s)`}/></div>
      <Panel title="MRR por plano"><ul className="list-rows">{m.finance.mrrByPlan.map(p => <li key={p.plan}><span>{p.plan}</span><strong>{money(p.mrr)}</strong></li>)}</ul>{!m.finance.mrrByPlan.length && <p className="muted">Nenhuma assinatura paga ativa ainda.</p>}</Panel>
      <p className="muted small">Taxas da InfinitePay não são retornadas pela API de checkout; consulte o extrato no app InfinitePay.</p></> : <p role="alert">Seu perfil não tem acesso a dados financeiros.</p>}</Loaded></div>;
}
