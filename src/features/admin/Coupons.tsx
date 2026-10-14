import { useState, type FormEvent } from 'react';
import { Plus } from 'lucide-react';
import { useDemo } from '../../store';
import { couponQuote, createSubscriptionInvoice, saveCoupon } from '../../domain';
import { date, exportCsv, money, parseMoney, today, uid } from '../../lib';
import { Badge, Button, DataTable, Field, Modal, PageHeader, Panel } from '../../ui';
import type { BillingInvoice, Coupon, Tenant } from '../../types';
import { couponValueLabel, formText, isoDate, percentToBps, periods, planPrice, quoteView, required, wholeNumber, type Period } from '../public/model';
import { useAction, useFieldErrors } from '../public/useAction';
import { shiftDate } from './metrics';

export function SubscriptionInvoice({ tenant, onClose }: { tenant: Tenant; onClose: () => void }) {
  const { state, mutate } = useDemo(); const action = useAction();
  const [planId, setPlanId] = useState(tenant.planId); const [period, setPeriod] = useState<Period>('monthly');
  const [code, setCode] = useState(''); const [provider, setProvider] = useState<BillingInvoice['provider']>('Asaas');
  const [requestId] = useState(uid);
  const plan = state.plans.find(p => p.id === planId);
  const quote = quoteView(plan ? planPrice(plan, period).total : 0, code, () => couponQuote(state, tenant.id, code, planId, period, today()));
  function create(e: FormEvent) {
    e.preventDefault();
    void action.run(async () => {
      await mutate(draft => { createSubscriptionInvoice(draft, { tenantId: tenant.id, planId, period, couponCode: code, provider, requestId, today: today() }); });
      onClose();
    }, 'Fatura Pendente gerada. Aplicar cupom não confirma pagamento.');
  }
  return <Modal title={`Gerar fatura · ${tenant.name}`} open onClose={onClose} footer={<><Button onClick={onClose} disabled={action.pending}>Voltar</Button><Button variant="primary" type="submit" form="subscription-invoice" loading={action.pending} disabled={!plan || !quote.ok}>Gerar fatura Pendente</Button></>}>
    <form id="subscription-invoice" onSubmit={create} className="stack">
      <section className="form-section"><h3>Assinatura</h3><div className="form-grid">
        <Field label="Plano"><select value={planId} onChange={e => setPlanId(e.target.value)}>{state.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Periodicidade"><select value={period} onChange={e => setPeriod(e.target.value as Period)}>{Object.entries(periods).map(([key, p]) => <option key={key} value={key}>{p.label}</option>)}</select></Field>
        <Field label="Provedor (demonstração)"><select value={provider} onChange={e => setProvider(e.target.value as BillingInvoice['provider'])}><option>Asaas</option><option>InfinitePay</option></select></Field>
        <Field label="Cupom" error={quote.ok ? undefined : quote.message} hint="Opcional. Somente a primeira fatura, sem desconto recorrente."><input value={code} onChange={e => setCode(e.target.value.toUpperCase())} maxLength={30} placeholder="Ex.: BEMVINDO20" aria-invalid={!quote.ok}/></Field>
      </div></section>
      <section className="form-section" aria-live="polite"><h3>Resumo da cobrança</h3><dl className="adm-quote"><div><dt>Preço original</dt><dd>{money(quote.original)}</dd></div><div><dt>Desconto</dt><dd>− {money(quote.discount)}</dd></div><div className="adm-quote-total"><dt>Total da fatura</dt><dd>{money(quote.total)}</dd></div></dl>{quote.ok && <p className="muted">{quote.message}</p>}<p className="adm-sim"><Badge>Pendente</Badge> Vencimento imediato ({date(today())}). Aplicar cupom não confirma pagamento. Nenhuma cobrança é enviada ao provedor.</p></section>
      {action.error && <p role="alert" className="adm-error">{action.error}</p>}
    </form>
  </Modal>;
}

export function Coupons() {
  const { state, mutate } = useDemo(); const action = useAction(); const validation = useFieldErrors();
  const [search, setSearch] = useState(''); const [status, setStatus] = useState(''); const [edit, setEdit] = useState<Coupon | 'new'>();
  const [kind, setKind] = useState<Coupon['kind']>('percent');
  const current = edit === 'new' ? undefined : edit;
  const rows = state.coupons.filter(c => (!status || c.active === (status === 'Ativo')) && `${c.code} ${c.description}`.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')));
  const uses = (id: string) => state.couponRedemptions.filter(r => r.couponId === id);
  const open = (coupon: Coupon | 'new') => { validation.reset(); action.reset(); setKind(coupon === 'new' ? 'percent' : coupon.kind); setEdit(coupon); };
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const f = new FormData(event.currentTarget);
    void action.run(async () => {
      const values = validation.check({
        code: () => { const code = required(formText(f, 'code'), 'Código', 30).toUpperCase(); if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw new Error('Use 3–30 letras, números, hífen ou sublinhado.'); if (state.coupons.some(c => c.id !== current?.id && c.code === code)) throw new Error('Código já cadastrado.'); return code; },
        description: () => required(formText(f, 'description'), 'Descrição', 300),
        value: () => { const v = kind === 'percent' ? percentToBps(formText(f, 'value')) : parseMoney(formText(f, 'value')); if (v <= 0) throw new Error('Desconto deve ser maior que zero.'); return v; },
        startsAt: () => isoDate(formText(f, 'startsAt')),
        endsAt: () => { const end = isoDate(formText(f, 'endsAt')); if (end < formText(f, 'startsAt')) throw new Error('Fim da validade deve ser igual ou posterior ao início.'); return end; },
        maxUses: () => wholeNumber(formText(f, 'maxUses'), 'Limite total'),
        perTenant: () => wholeNumber(formText(f, 'perTenant'), 'Limite por empresa'),
      });
      await mutate(draft => { saveCoupon(draft, { id: current?.id ?? '', ...values, kind, planIds: f.getAll('planIds').map(String), periods: f.getAll('periods') as Period[], active: f.get('active') === 'on', scope: 'first' }); });
      setEdit(undefined);
    }, 'Cupom salvo. Faturas anteriores não foram alteradas.');
  }
  function remove(coupon: Coupon) {
    if (uses(coupon.id).length) { void action.run(() => { throw new Error('Cupom com resgates não pode ser excluído. Desative-o para preservar o histórico.'); }); return; }
    if (!window.confirm(`Excluir o cupom ${coupon.code}? Esta ação não pode ser desfeita.`)) return;
    void action.run(() => mutate(draft => { if (draft.couponRedemptions.some(r => r.couponId === coupon.id)) throw new Error('Cupom possui resgates. Desative-o.'); draft.coupons = draft.coupons.filter(c => c.id !== coupon.id); }), 'Cupom excluído.');
  }
  return <div className="stack" data-tour="admin-coupons"><PageHeader title="Cupons SaaS" subtitle="Descontos da assinatura PISTEC. Somente a primeira fatura; nunca vendas da loja."><Button variant="primary" icon={<Plus size={16}/>} onClick={() => open('new')}>Novo cupom</Button></PageHeader>
    <div className="toolbar adm-filters"><input type="search" aria-label="Buscar cupons" placeholder="Código ou descrição…" value={search} onChange={e => setSearch(e.target.value)}/><select aria-label="Status do cupom" value={status} onChange={e => setStatus(e.target.value)}><option value="">Todos os status</option><option>Ativo</option><option>Inativo</option></select><Button variant="ghost" onClick={() => exportCsv('cupons', rows.map(c => ({ codigo: c.code, descricao: c.description, desconto: couponValueLabel(c), inicio: c.startsAt, fim: c.endsAt, usos: uses(c.id).length, ativo: c.active })))}>Exportar CSV</Button></div>
    {!edit && action.error && <p role="alert" className="adm-error">{action.error}</p>}
    <DataTable rows={rows} onRow={open} columns={[
      { key: 'code', label: 'Código' }, { key: 'description', label: 'Descrição' }, { key: 'value', label: 'Desconto', render: c => couponValueLabel(c) },
      { key: 'endsAt', label: 'Vigência', render: c => `${date(c.startsAt)} – ${date(c.endsAt)}` },
      { key: 'uses', label: 'Usos', render: c => `${uses(c.id).length} / ${c.maxUses || 'sem limite'}` },
      { key: 'active', label: 'Status', render: c => <Badge>{c.active ? 'Ativo' : 'Inativo'}</Badge> },
      { key: 'actions', label: 'Ações', render: c => <span className="toolbar"><Button disabled={action.pending} onClick={e => { e.stopPropagation(); void action.run(() => mutate(d => { saveCoupon(d, { ...c, active: !c.active }); })); }}>{c.active ? 'Desativar' : 'Ativar'}</Button><Button variant="danger" disabled={action.pending || uses(c.id).length > 0} title={uses(c.id).length ? 'Preserve o histórico: desative este cupom.' : undefined} onClick={e => { e.stopPropagation(); remove(c); }}>Excluir</Button></span> },
    ]}/>
    <Modal title={current ? `Editar ${current.code}` : 'Novo cupom'} open={!!edit} onClose={() => setEdit(undefined)} size="lg" footer={<><Button onClick={() => setEdit(undefined)} disabled={action.pending}>Cancelar</Button><Button type="submit" form="coupon-form" variant="primary" loading={action.pending}>Salvar cupom</Button></>}>
      <form id="coupon-form" noValidate onSubmit={save} onInput={validation.onInput} className="stack">
        <section className="form-section"><h3>Identificação e desconto</h3><div className="form-grid"><Field label="Código" error={validation.errors.code}><input name="code" required maxLength={30} defaultValue={current?.code} autoCapitalize="characters"/></Field><Field label="Descrição" error={validation.errors.description}><input name="description" required maxLength={300} defaultValue={current?.description}/></Field><Field label="Tipo"><select value={kind} onChange={e => { setKind(e.target.value as Coupon['kind']); validation.clear('value'); }}><option value="percent">Percentual (%)</option><option value="fixed">Valor fixo (R$)</option></select></Field><Field label={kind === 'percent' ? 'Percentual (%)' : 'Valor fixo (R$)'} error={validation.errors.value}><input key={`${current?.id}-${kind}`} name="value" inputMode="decimal" required defaultValue={current && current.kind === kind ? (current.value / 100).toFixed(2).replace('.', ',') : ''}/></Field></div></section>
        <section className="form-section"><h3>Validade e limites</h3><div className="form-grid"><Field label="Válido de" error={validation.errors.startsAt}><input name="startsAt" type="date" required defaultValue={current?.startsAt ?? today()}/></Field><Field label="Válido até" error={validation.errors.endsAt}><input name="endsAt" type="date" required defaultValue={current?.endsAt ?? shiftDate(today(), 30)}/></Field><Field label="Limite total de usos" hint="0 = sem limite" error={validation.errors.maxUses}><input name="maxUses" type="number" min={0} step={1} defaultValue={current?.maxUses ?? 0}/></Field><Field label="Usos por empresa" hint="0 = sem limite" error={validation.errors.perTenant}><input name="perTenant" type="number" min={0} step={1} defaultValue={current?.perTenant ?? 1}/></Field></div></section>
        <section className="form-section"><h3>Aplicabilidade</h3><p className="muted">Nenhuma seleção significa todos os planos ou períodos.</p><div className="form-grid"><fieldset className="adm-checks"><legend>Planos</legend>{state.plans.map(p => <label key={p.id}><input name="planIds" type="checkbox" value={p.id} defaultChecked={current?.planIds.includes(p.id)}/>{p.name}</label>)}</fieldset><fieldset className="adm-checks"><legend>Períodos</legend>{Object.entries(periods).map(([key, p]) => <label key={key}><input name="periods" type="checkbox" value={key} defaultChecked={current?.periods.includes(key as Period)}/>{p.label}</label>)}</fieldset></div><label className="pub-check"><input name="active" type="checkbox" defaultChecked={current?.active ?? true}/><span>Cupom ativo</span></label><p className="adm-sim"><strong>Somente a primeira fatura.</strong> O desconto não se repete nas renovações. Edições não alteram resgates já realizados.</p></section>
        {action.error && <p role="alert" className="adm-error">{action.error}</p>}
      </form>
      {current && <Panel title="Histórico de usos"><DataTable rows={uses(current.id)} columns={[{ key: 'tenantId', label: 'Empresa', render: r => state.tenants.find(t => t.id === r.tenantId)?.name ?? r.tenantId }, { key: 'invoiceId', label: 'Fatura' }, { key: 'discount', label: 'Desconto', render: r => money(r.discount) }, { key: 'date', label: 'Data', render: r => date(r.date) }]}/></Panel>}
    </Modal>
  </div>;
}
