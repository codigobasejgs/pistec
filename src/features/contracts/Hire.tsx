import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Building2, Check, CreditCard, Download, FileSignature, FileText, ListChecks, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { supabase } from '../../real/client';
import { clearHire, rememberHire } from '../../real/auth';
import { uid } from '../../lib';
import { fillContract, brl, type ContractBody, type ContractData } from '../../../supabase/functions/_shared/contracts/template';
import AdminTour from '../../real/admin/AdminTour';
import { cnpjValid, cpfValid, digits, maskDoc, maskPhone } from './br';
import BrazilianAddressFields from '../address/BrazilianAddressFields';
import { addressErrors, hasAddress, toAddress, type Address } from '../../services/address';

type Plan = { id: string; name: string; monthly: number; quarterly: number; annual: number; trialDays: number; users: number; branches: number; products: number; whatsapp: number; aiMessages: number; features: string[]; modules: string[] };
type Catalog = { plans: Plan[]; provider: Record<string, string>; version: { code: string } | null; draft: { code: string; status: string } | null };
type Terms = { code: string; status: string; body: ContractBody };
type Tenant = { id: string; slug: string; name: string; legal_name: string; document: string; email: string; phone: string; address: string; address_data: unknown; status: string; due_date: string };
type Detail = ContractData & { signers: { role: string; name: string; email: string; status: string; signedAt: string | null }[]; events: { type: string; at: string }[]; invoiceId: string | null; invoice: { status: string } | null; tenantId: string; expiresAt: string; createdAt: string; documentSha256: string | null };
const PERIODS = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' } as const;
type Period = keyof typeof PERIODS;
const isPeriod = (v: string | null): v is Period => !!v && v in PERIODS;
// O plano já vem escolhido de /planos: a 1ª etapa é resumo + condições, não uma nova escolha.
const STEPS = ['Plano e condições', 'Empresa', 'Representante', 'Contrato', 'Assinatura', 'Pagamento', 'Conclusão'] as const;
const STATUS: Record<string, string> = { prepared: 'Pronto para assinatura', awaiting_customer: 'Aguardando sua assinatura', awaiting_provider: 'Aguardando assinatura da contratada', partially_signed: 'Parcialmente assinado',
  signed: 'Assinado por todos', refused: 'Recusado', expired: 'Expirado', cancelled: 'Cancelado', error: 'Erro de integração', draft: 'Rascunho', awaiting_data: 'Aguardando dados' };
const ACTIVE = ['prepared', 'awaiting_customer', 'awaiting_provider', 'partially_signed'];
const DRAFT_KEY = 'pistec-hire-draft';
const ADDRESS_KEYS: (keyof Address)[] = ['zip', 'street', 'number', 'complement', 'district', 'city', 'state'];
const pickAddress = (c: Record<string, unknown>): Address => Object.fromEntries(ADDRESS_KEYS.map(k => [k, String(c[k] ?? '')])) as Address;
const day = (iso: string | null) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR') : '—';
// Tour da contratação: cada etapa só existe na tela quando o assistente chega nela.
const HIRE_TOUR = { contratacao: { label: 'Contratação', steps: [
  { target: 'hire-plans', title: 'Seu plano', text: 'O plano e a periodicidade escolhidos em Planos já vêm selecionados. Confira valor, recursos, limites e condições do contrato.' },
  { target: 'hire-company', title: 'Preenchendo os dados da empresa', text: 'Razão social, CNPJ (ou CPF), endereço com busca de CEP, telefone e e-mail. Os dados já cadastrados da empresa são aproveitados.' },
  { target: 'hire-representative', title: 'Informando o representante', text: 'Quem assina pela empresa: nome, CPF, cargo, e-mail e telefone, e a declaração de que tem poderes para contratar.' },
  { target: 'hire-summary', title: 'Conferindo os preços', text: 'O resumo mostra plano, valor, contratada, contratante e teste. Esses valores ficam congelados no contrato.' },
  { target: 'hire-contract', title: 'Lendo o contrato', text: 'O contrato é gerado com seus dados e o seu plano. Leia até o fim e marque a concordância para liberar a assinatura.' },
  { target: 'hire-signers', title: 'Assinando', text: 'O convite chega por e-mail (Autentique). Assine lá; a contratada também assina. A situação de cada signatário aparece aqui.' },
  { target: 'hire-pay', title: 'Pagando', text: 'Depois de todas as assinaturas, a fatura InfinitePay é gerada. Sem pagamento confirmado o plano não é ativado (exceto período de teste).' },
  { target: 'hire-steps', title: 'Acompanhando a situação', text: 'As etapas mostram onde você está. Depois, acompanhe tudo em Minha assinatura > Contratos e documentos.' }] } };
const empty = { planId: '', period: 'monthly' as Period, coupon: '', company: { legalName: '', tradeName: '', document: '', zip: '', street: '', number: '', complement: '', district: '', city: '', state: '', phone: '', email: '' },
  representative: { name: '', cpf: '', role: '', email: '', phone: '', hasPowers: false } };
type Form = typeof empty;
const fnError = async (e: unknown) => { const c = (e as { context?: Response }).context; const d = await c?.json?.().catch(() => null); return d?.error ?? (e instanceof Error ? e.message : 'Falha na operação.'); };

/**
 * Contratação iniciada em /planos (/app/contratar/:plano?periodo=...). Sem login mostra plano e condições (dados públicos);
 * com login segue empresa → representante → contrato → assinatura → pagamento. Preço, partes e cláusulas vêm do servidor.
 */
export default function Hire() {
  const { plano } = useParams(); const [params] = useSearchParams(); const navigate = useNavigate();
  const [catalog, setCatalog] = useState<Catalog | null>(null), [terms, setTerms] = useState<Terms | null>(null), [user, setUser] = useState<{ id: string; email: string } | null | undefined>(undefined);
  const [tenants, setTenants] = useState<Tenant[]>([]), [tenantId, setTenantId] = useState('');
  const [step, setStep] = useState(0), [form, setForm] = useState<Form>(() => { try { return { ...empty, ...JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? '{}') }; } catch { return empty; } });
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(''), [fail, setFail] = useState(''), [contract, setContract] = useState<Detail | null>(null);
  const [sandbox, setSandbox] = useState(false), [isAdmin, setIsAdmin] = useState(false), [read, setRead] = useState(false), [agree, setAgree] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false), [quote, setQuote] = useState<{ discount: number; total: number } | null>(null), [tour, setTour] = useState(false);
  const [showPlans, setShowPlans] = useState(false), [pdfBusy, setPdfBusy] = useState(false);
  const tenant = tenants.find(t => t.id === tenantId);
  const article = useRef<HTMLElement>(null);
  const urlPeriod = params.get('periodo'), urlCompany = useRef(params.get('empresa'));

  // Plano e periodicidade da URL (vindos de /planos) prevalecem sobre o rascunho local.
  useEffect(() => { setForm(f => ({ ...f, planId: plano ?? f.planId, period: isPeriod(urlPeriod) ? urlPeriod : f.period })); }, [plano, urlPeriod]);
  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...form, representative: { ...form.representative, cpf: '' } })); } catch { /* rascunho local opcional (sem CPF) */ } }, [form]);
  // Plano escolhido sobrevive a login, cadastro de conta e confirmação de e-mail (só o caminho, sem dados pessoais).
  useEffect(() => { if (form.planId) rememberHire(`/contratar/${form.planId}?periodo=${form.period}`); }, [form.planId, form.period]);
  useEffect(() => { void (async () => {
    const [{ data: cat }, { data: t }, { data: { user: u } }] = await Promise.all([supabase.rpc('contract_catalog'), supabase.rpc('contract_public_terms'), supabase.auth.getUser()]);
    setCatalog(cat as Catalog); setTerms(t as Terms | null);
    setUser(u ? { id: u.id, email: u.email ?? '' } : null);
    if (!u) return;
    const [{ data: ms }, { data: adm }] = await Promise.all([supabase.from('memberships').select('tenant_id,role').eq('user_id', u.id).eq('active', true).in('role', ['Proprietário', 'Administrador']),
      supabase.from('platform_admins').select('user_id').eq('user_id', u.id)]);
    setIsAdmin(!!adm?.length);
    const ids = (ms ?? []).map(m => m.tenant_id);
    if (ids.length) { const { data } = await supabase.from('tenants').select('id,slug,name,legal_name,document,email,phone,address,address_data,status,due_date').in('id', ids); setTenants((data ?? []) as Tenant[]);
      const pick = (data ?? []).find(x => x.slug === urlCompany.current) ?? data?.[0]; if (pick) setTenantId(pick.id); }
    setForm(f => ({ ...f, representative: { ...f.representative, email: f.representative.email || u.email || '' } }));
  })(); }, []);

  // Retomada: contrato em andamento desta empresa volta para a etapa em que parou (com o plano congelado nele).
  const loadContract = useCallback(async (id: string) => { const { data, error } = await supabase.rpc('contract_detail', { p_contract: id }); if (error) throw error; setContract(data as Detail); return data as Detail; }, []);
  useEffect(() => { if (!tenantId) return; void (async () => {
    const { data } = await supabase.from('tenant_contracts').select('id,status').eq('tenant_id', tenantId).in('status', ACTIVE).order('created_at', { ascending: false }).limit(1);
    const open = data?.[0]; if (!open) return;
    const d = await loadContract(open.id).catch(() => null); if (!d) return;
    setForm(f => ({ ...f, planId: d.commercial.planId, period: d.commercial.period as Period }));
    setStep(d.status === 'prepared' ? 3 : 4);
  })(); }, [tenantId, loadContract]);

  // autopreenchimento com o cadastro da empresa (sem sobrescrever o que já foi digitado)
  useEffect(() => { if (!tenant) return; setForm(f => ({ ...f, company: { ...f.company, legalName: f.company.legalName || tenant.legal_name || tenant.name, tradeName: f.company.tradeName || tenant.name,
    document: f.company.document || maskDoc(tenant.document), email: f.company.email || tenant.email, phone: f.company.phone || maskPhone(tenant.phone),
    ...(hasAddress(pickAddress(f.company)) ? {} : toAddress(tenant.address_data)) } })); }, [tenant]);
  const plan = catalog?.plans.find(p => p.id === form.planId);
  const price = plan ? plan[form.period] : 0;
  const trialLeft = tenant?.status === 'Teste' ? Math.max(0, Math.ceil((new Date(`${tenant.due_date}T12:00:00`).getTime() - Date.now()) / 864e5)) : 0;
  const set = (path: 'company' | 'representative', key: string, value: string | boolean) => { setForm(f => ({ ...f, [path]: { ...f[path], [key]: value } })); setErrors(e => { const n = { ...e }; delete n[`${path}.${key}`]; return n; }); };
  const choose = (patch: Partial<Pick<Form, 'planId' | 'period'>>) => {
    const next = { planId: patch.planId ?? form.planId, period: patch.period ?? form.period };
    setForm(f => ({ ...f, ...next })); setQuote(null); setShowPlans(false);
    navigate({ pathname: `/contratar/${next.planId}`, search: `?periodo=${next.period}` }, { replace: true });
  };

  const companyAddressErrors = Object.fromEntries(ADDRESS_KEYS.map(k => [k, errors[`company.${k}`]]).filter(([, v]) => v)) as Partial<Record<keyof Address, string>>;
  function validate(s: number) {
    const e: Record<string, string> = {}, c = form.company, r = form.representative;
    if (s === 0) { if (!plan) e.plan = 'Escolha um plano.'; if (!tenant) e.tenant = 'Selecione a empresa (ou cadastre-a).'; }
    if (s === 1) {
      if (!c.legalName.trim()) e['company.legalName'] = 'Informe a razão social.';
      const d = digits(c.document); if (!(d.length === 14 ? cnpjValid(d) : d.length === 11 && cpfValid(d))) e['company.document'] = 'CPF/CNPJ inválido.';
      for (const [k, v] of Object.entries(addressErrors(pickAddress(c)))) e[`company.${k}`] = v;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(c.email)) e['company.email'] = 'E-mail inválido.';
      if (digits(c.phone).length < 10) e['company.phone'] = 'Telefone com DDD.';
    }
    if (s === 2) {
      if (r.name.trim().split(/\s+/).length < 2) e['representative.name'] = 'Nome completo.';
      if (!cpfValid(r.cpf)) e['representative.cpf'] = 'CPF inválido.';
      if (!r.role.trim()) e['representative.role'] = 'Informe o cargo ou função.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(r.email)) e['representative.email'] = 'E-mail inválido.';
      if (digits(r.phone).length < 10) e['representative.phone'] = 'Telefone com DDD.';
      if (!r.hasPowers) e['representative.hasPowers'] = 'Confirme que tem poderes para contratar.';
    }
    setErrors(e); return !Object.keys(e).length;
  }

  async function prepare() {
    setBusy('prepare'); setFail('');
    try {
      const requestId = `${tenantId}:${form.planId}:${form.period}:${form.coupon}:${digits(form.representative.cpf)}:${uid().slice(0, 8)}`;
      const { data, error } = await supabase.rpc('prepare_contract', { p_tenant: tenantId, p: { planId: form.planId, period: form.period, coupon: form.coupon || null, requestId, sandbox,
        company: { ...form.company, document: digits(form.company.document), zip: digits(form.company.zip), phone: digits(form.company.phone) },
        representative: { ...form.representative, cpf: digits(form.representative.cpf), phone: digits(form.representative.phone) } } });
      if (error) throw error;
      // Endereço confirmado vira o cadastral da empresa; contratos existentes mantêm os dados congelados.
      void supabase.rpc('update_tenant_address', { p_tenant: tenantId, p: pickAddress(form.company) });
      await loadContract((data as { id: string }).id); setRead(false); setAgree(false); setStep(3);
    } catch (e) { setFail(e instanceof Error ? e.message : 'Não foi possível preparar o contrato.'); } finally { setBusy(''); }
  }
  // Corrigir dados ou trocar o plano: o contrato preparado (ainda não enviado) é descartado no servidor e fica no histórico.
  async function discardAnd(next: () => void) {
    if (contract?.status === 'prepared') { const { error } = await supabase.rpc('discard_prepared_contract', { p_contract: contract.id }); if (error) { setFail(error.message); return; } }
    setContract(null); setRead(false); setAgree(false); next();
  }
  async function action(name: string, extra: Record<string, unknown> = {}) {
    if (!contract) return; setBusy(name); setFail('');
    try { const { data, error } = await supabase.functions.invoke('contract-sign', { body: { action: name, contractId: contract.id, ...extra } }); if (error) throw new Error(await fnError(error));
      if (name === 'download' && (data as { url?: string }).url) window.open((data as { url: string }).url, '_blank', 'noopener');
      await loadContract(contract.id); return data;
    } catch (e) { setFail(e instanceof Error ? e.message : 'Falha.'); } finally { setBusy(''); }
  }
  async function pay() {
    if (!contract) return; setBusy('pay'); setFail('');
    try { const { data: inv, error } = await supabase.rpc('contract_invoice', { p_contract: contract.id }); if (error) throw error;
      const { data, error: e2 } = await supabase.functions.invoke('billing-checkout', { body: { invoiceId: inv } }); if (e2) throw new Error(await fnError(e2));
      window.location.assign((data as { url: string }).url);
    } catch (e) { setFail(e instanceof Error ? e.message : 'Não foi possível abrir o pagamento.'); } finally { setBusy(''); }
  }
  const checkCoupon = async () => { setFail(''); setQuote(null); if (!form.coupon.trim() || !tenantId) return;
    const { data, error } = await supabase.rpc('quote_coupon', { p_tenant: tenantId, p_code: form.coupon, p_plan: form.planId, p_period: form.period }); if (error) setErrors(e => ({ ...e, coupon: error.message })); else setQuote(data as { discount: number; total: number }); };
  const filled = useMemo(() => { try { return contract ? fillContract(contract) : null; } catch (e) { return e instanceof Error ? e.message : 'erro'; } }, [contract]);
  // PDF de conferência gerado no navegador com o mesmo código do servidor, marcado como cópia (o documento válido é o enviado para assinatura).
  async function conferencePdf() {
    if (!contract || !filled || typeof filled === 'string') return; setPdfBusy(true);
    try { const [lib, { renderContractPdf }] = await Promise.all([import('pdf-lib'), import('../../../supabase/functions/_shared/contracts/pdf')]);
      const bytes = await renderContractPdf(lib, { ...filled, draftNotice: `${filled.draftNotice ? `${filled.draftNotice} ` : ''}CÓPIA DE CONFERÊNCIA — o documento válido é o enviado para assinatura.` }, { number: contract.number, createdAt: contract.createdAt });
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'application/pdf' })), download: `${contract.number}-conferencia.pdf` }); a.click(); URL.revokeObjectURL(a.href);
    } catch (e) { setFail(e instanceof Error ? e.message : 'Não foi possível gerar o PDF.'); } finally { setPdfBusy(false); }
  }
  const signed = contract?.status === 'signed';
  const paid = contract?.invoice?.status === 'Paga';
  useEffect(() => { if (signed && step === 4) setStep(5); if (signed && paid) clearHire(); }, [signed, paid, step]);
  // Contrato curto que cabe inteiro na tela já conta como lido.
  useEffect(() => { const el = article.current; if (el && el.scrollHeight <= el.clientHeight + 40) setRead(true); }, [filled]);

  const field = (path: 'company' | 'representative', key: string, label: string, opts: { mask?: (v: string) => string; type?: string; auto?: string; hint?: string; max?: number } = {}) => {
    const v = String((form[path] as Record<string, unknown>)[key] ?? ''), err = errors[`${path}.${key}`];
    return <label className={`field ${err ? 'has-error' : ''}`}><span>{label}</span><input value={v} type={opts.type ?? 'text'} autoComplete={opts.auto} maxLength={opts.max ?? 160} aria-invalid={!!err || undefined} inputMode={opts.mask ? 'numeric' : undefined}
      onChange={e => set(path, key, opts.mask ? opts.mask(e.target.value) : e.target.value)}/>{err ? <em className="field-error" role="alert">{err}</em> : opts.hint && <small className="field-hint">{opts.hint}</small>}</label>;
  };
  if (!catalog || user === undefined) return <main className="hire" role="status"><Loader2 className="spin"/> Carregando condições comerciais…</main>;
  const unavailable = !catalog.version;
  const planLocked = !!contract && contract.status !== 'prepared';
  const k = contract?.commercial;

  const summary = <aside className={`hire-summary ${summaryOpen ? 'open' : ''}`} data-tour="hire-summary">
    <button type="button" className="hire-summary-toggle" aria-expanded={summaryOpen} onClick={() => setSummaryOpen(v => !v)}>Resumo · {plan ? `${plan.name} ${PERIODS[form.period]}` : 'escolha um plano'}{plan && <strong>{brl(quote?.total ?? price)}</strong>}</button>
    <div className="hire-summary-body">
      <h3>Resumo da contratação</h3>
      <dl><dt>Plano</dt><dd>{plan ? `${plan.name} · ${PERIODS[form.period]}` : '—'}</dd>
        <dt>Valor do período</dt><dd>{plan ? brl(price) : '—'}{quote?.discount ? <><br/><small>Desconto {brl(quote.discount)} → {brl(quote.total)}</small></> : null}</dd>
        <dt>Contratada</dt><dd>{catalog.provider.legalName}<br/><small>CNPJ {catalog.provider.document} · marca {catalog.provider.brand}</small></dd>
        <dt>Contratante</dt><dd>{form.company.legalName || '—'}{form.company.document && <><br/><small>{form.company.document}</small></>}</dd>
        <dt>Representante</dt><dd>{form.representative.name || '—'}</dd>
        <dt>Teste gratuito</dt><dd>{trialLeft ? `${trialLeft} dia(s) restantes; 1ª cobrança no fim do teste` : user ? 'Sem período de teste restante' : '1 mês grátis para empresas novas'}</dd></dl>
      {contract && <p className="muted small">Contrato {contract.number} · {STATUS[contract.status] ?? contract.status}</p>}
      {contract?.documentSha256 && <p className="muted small">SHA-256: <code>{contract.documentSha256.slice(0, 16)}…</code></p>}
      <p className="muted small">Valores e condições confirmados pelo servidor no momento da geração do contrato.</p>
    </div></aside>;

  return <main className="hire">
    <header className="hire-head"><Link to="/" className="hire-brand"><img src="/brand/logo-horizontal.webp" alt="PISTEC" width="160" height="44"/></Link>
      <div><h1>Contratação do PISTEC</h1><p>Confira seu plano e as condições, preencha os dados da empresa e assine digitalmente o contrato.</p></div>
      <div className="toolbar"><button type="button" className="btn ghost" onClick={() => setTour(true)}>Tour</button><a className="btn ghost" href="/planos">Ver planos</a></div></header>
    {tour && <AdminTour tours={HIRE_TOUR} storage="pistec-hire-tour" label="Tour da contratação" missingText="esta etapa aparece quando o assistente chegar nela" onClose={() => setTour(false)}/>}
    <ol className="hire-steps" aria-label="Etapas da contratação" data-tour="hire-steps">{STEPS.map((s, i) => <li key={s} className={i === step ? 'on' : i < step ? 'done' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step ? <Check size={14}/> : i + 1}</span>{s}</li>)}</ol>
    {unavailable && <div className="callout warning" role="alert"><strong>Contratação digital ainda não liberada.</strong> A versão {catalog.draft?.code} do contrato está em revisão jurídica e ainda não foi aprovada e publicada. Você pode conferir o plano e as condições e usar o período de teste; para contratar agora, fale com o comercial.
      {isAdmin && <label className="checkbox-row" style={{ marginTop: 8 }}><input type="checkbox" checked={sandbox} onChange={e => setSandbox(e.target.checked)}/> Homologação (Super Admin): gerar contrato de teste em sandbox, sem validade e sem cobrança</label>}</div>}
    {fail && <p className="callout warning" role="alert">{fail}</p>}
    <div className="hire-layout"><section className="panel hire-main">
      {step === 0 && <Step icon={<ListChecks/>} title="Seu plano e as condições do contrato">
        {plan ? <div className="hire-chosen" data-tour="hire-plans">
          <div className="hire-chosen-head"><div><span className="eyebrow">PLANO ESCOLHIDO</span><h3>{plan.name} · {PERIODS[form.period]}</h3></div>
            <div className="hire-price">{brl(quote?.total ?? price)}<small>/{PERIODS[form.period].toLowerCase()}</small></div></div>
          {form.period !== 'monthly' && <p className="small">Equivale a {brl(Math.round(price / (form.period === 'quarterly' ? 3 : 12)))}/mês{plan.monthly * (form.period === 'quarterly' ? 3 : 12) > price ? ` · economia de ${brl(plan.monthly * (form.period === 'quarterly' ? 3 : 12) - price)} no período` : ''}.</p>}
          <div className="pub-periods hire-periods" role="group" aria-label="Periodicidade">{(Object.keys(PERIODS) as Period[]).map(p => <button key={p} type="button" aria-pressed={form.period === p} disabled={planLocked} onClick={() => void discardAnd(() => choose({ period: p }))}>{PERIODS[p]} · {brl(plan[p])}</button>)}</div>
          <ul className="hire-features"><li>{plan.users} usuários</li><li>{plan.branches} filial(is)</li><li>{plan.products.toLocaleString('pt-BR')} produtos</li><li>{plan.whatsapp} conexão(ões) WhatsApp</li><li>{plan.aiMessages} consultas de IA/dia</li>{plan.features.map(x => <li key={x}>{x}</li>)}</ul>
          {!planLocked && <button type="button" className="btn ghost" aria-expanded={showPlans} onClick={() => setShowPlans(v => !v)}>Trocar de plano</button>}
          {showPlans && <div className="hire-plans">{catalog.plans.map(p => <button type="button" key={p.id} className={`hire-plan ${form.planId === p.id ? 'is-active' : ''}`} aria-pressed={form.planId === p.id} onClick={() => void discardAnd(() => choose({ planId: p.id }))}>
            <strong>{p.name}</strong><span className="hire-price">{brl(p[form.period])}<small>/{PERIODS[form.period].toLowerCase()}</small></span></button>)}</div>}
        </div> : <p className="callout warning" role="alert">{form.planId ? 'Este plano não está disponível para contratação online (pode ser sob proposta).' : 'Nenhum plano selecionado.'} <a href="/planos">Escolher um plano</a>{form.planId === 'enterprise' && <> · <a href="/contato">Falar com consultor</a></>}</p>}
        {errors.plan && <p className="field-error" role="alert">{errors.plan}</p>}
        <section className="hire-terms" aria-label="Condições do contrato"><h3>Condições do contrato</h3>
          <ul><li><strong>Renovação:</strong> automática ao fim de cada período, pela mesma periodicidade; a fatura de renovação é gerada 5 dias antes do vencimento.</li>
            <li><strong>Cancelamento:</strong> a qualquer momento em Minha assinatura, com efeito ao fim do período já pago, sem multa; seus dados ficam disponíveis para exportação por 30 dias.</li>
            <li><strong>Reajuste:</strong> comunicado com 30 dias de antecedência e só para períodos futuros.</li>
            <li><strong>Inadimplência:</strong> 5 dias de tolerância; depois, acesso somente leitura até regularizar, sem exclusão de dados.</li>
            <li><strong>Pagamento:</strong> InfinitePay (Pix ou cartão), gerado só depois da assinatura de todas as partes.</li></ul>
          <p className="small">Contratada: {catalog.provider.legalName} · CNPJ {catalog.provider.document} · {catalog.provider.legalNature} · marca {catalog.provider.brand}.</p>
          {terms && <details className="hire-terms-full"><summary>Ler o texto {terms.status === 'published' ? 'vigente' : 'da minuta (em revisão jurídica)'} completo · versão {terms.code}</summary>
            {terms.body.sections.map(s => <section key={s.title}><h4>{s.title}</h4>{s.paragraphs.map((x, i) => <p key={i}>{x.replace(/\{\{(\w+)\}\}/g, '[preenchido com seus dados]')}</p>)}</section>)}</details>}
          <p className="muted small">Prévia informativa. O contrato definitivo é gerado com seus dados depois do cadastro, para conferência e assinatura.</p></section>
        {user === null ? <div className="hire-auth callout"><p><strong>Para continuar, entre ou crie sua conta.</strong> O plano escolhido fica guardado e você volta para esta etapa depois do login (também após confirmar o e-mail).</p>
          <div className="toolbar"><Link className="btn primary" to={`/login?next=${encodeURIComponent(`/contratar/${form.planId}?periodo=${form.period}`)}`}>Entrar e continuar</Link><Link className="btn" to="/cadastro">Criar conta</Link></div></div>
        : <>{tenants.length > 1 && <label className="field"><span>Empresa</span><select value={tenantId} onChange={e => setTenantId(e.target.value)}>{tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select></label>}
          {!tenants.length && <p className="callout">Você ainda não tem empresa cadastrada como proprietário ou administrador. <Link to="/empresa/nova">Cadastrar empresa</Link>: depois do cadastro você volta para esta contratação.</p>}
          {errors.tenant && <p className="field-error" role="alert">{errors.tenant}</p>}
          <div className="hire-coupon"><label className={`field ${errors.coupon ? 'has-error' : ''}`}><span>Cupom (opcional)</span><input value={form.coupon} maxLength={30} disabled={!tenantId} onChange={e => { setForm(f => ({ ...f, coupon: e.target.value.toUpperCase() })); setQuote(null); setErrors(x => ({ ...x, coupon: '' })); }}/>{errors.coupon && <em className="field-error" role="alert">{errors.coupon}</em>}</label>
            <button type="button" className="btn" disabled={!form.coupon || !plan || !tenantId} onClick={() => void checkCoupon()}>Aplicar</button></div></>}
      </Step>}
      {step === 1 && <Step icon={<Building2/>} title="Dados da empresa contratante"><div className="form-grid" data-tour="hire-company">
        {field('company', 'legalName', 'Razão social', { auto: 'organization' })}{field('company', 'tradeName', 'Nome fantasia')}
        {field('company', 'document', 'CNPJ (ou CPF, se pessoa física)', { mask: maskDoc, hint: 'Validamos os dígitos; os dados não são consultados em bases externas.' })}
      </div><BrazilianAddressFields legend="Endereço da empresa" value={pickAddress(form.company)} errors={companyAddressErrors}
        onChange={a => { setForm(f => ({ ...f, company: { ...f.company, ...a } })); setErrors(e => Object.fromEntries(Object.entries(e).filter(([key]) => !key.startsWith('company.') || !ADDRESS_KEYS.includes(key.slice(8) as keyof Address)))); }}/>
        <div className="form-grid">{field('company', 'phone', 'Telefone', { mask: maskPhone, auto: 'tel' })}{field('company', 'email', 'E-mail da empresa', { type: 'email', auto: 'email' })}</div></Step>}
      {step === 2 && <Step icon={<UserRound/>} title="Representante que assina"><div className="form-grid" data-tour="hire-representative">
        {field('representative', 'name', 'Nome completo', { auto: 'name' })}{field('representative', 'cpf', 'CPF', { mask: maskDoc, hint: 'Exigido pelo provedor de assinatura para identificar o signatário.' })}
        {field('representative', 'role', 'Cargo ou função', { hint: 'Ex.: sócio-administrador, diretor, titular' })}{field('representative', 'email', 'E-mail (recebe o convite de assinatura)', { type: 'email', auto: 'email' })}
        {field('representative', 'phone', 'Telefone / WhatsApp', { mask: maskPhone, auto: 'tel' })}</div>
        <label className={`checkbox-row ${errors['representative.hasPowers'] ? 'has-error' : ''}`}><input type="checkbox" checked={form.representative.hasPowers} onChange={e => set('representative', 'hasPowers', e.target.checked)}/> Declaro que tenho poderes para contratar em nome da empresa informada.</label>
        {errors['representative.hasPowers'] && <em className="field-error" role="alert">{errors['representative.hasPowers']}</em>}
        <p className="muted small">Usamos estes dados apenas para identificar as partes, enviar o convite de assinatura e as comunicações do contrato (política de privacidade).</p></Step>}
      {step === 3 && <Step icon={<FileText/>} title="Revise o contrato">
        {!contract ? <><p>Confira o resumo. Ao gerar o contrato, o servidor confere plano, preço e cupom e congela essas condições junto com seus dados.</p>
          <button type="button" className="btn primary" disabled={!!busy || (unavailable && !sandbox)} onClick={() => void prepare()}>{busy === 'prepare' ? <Loader2 size={16} className="spin"/> : <FileText size={16}/>}Gerar contrato preenchido</button></>
        : typeof filled === 'string' ? <p className="callout warning" role="alert">Contrato incompleto: {filled}. Volte e corrija os dados.</p> : filled && k && <>
          {filled.draftNotice && <p className="callout warning">{filled.draftNotice}</p>}
          <div className="contract-doc-head"><img src="/brand/logo-horizontal.webp" alt="" width="120" height="33"/><div><strong>{filled.title}</strong><small>Documento {contract.number} · versão {contract.version.code} · gerado em {new Date(contract.createdAt).toLocaleString('pt-BR')}</small></div></div>
          <section className="contract-plan" aria-label="Seu plano contratado"><h3>SEU PLANO CONTRATADO</h3>
            <dl><div><dt>Plano</dt><dd>{k.planName}</dd></div><div><dt>Periodicidade</dt><dd>{PERIODS[k.period as Period]}</dd></div><div><dt>Valor</dt><dd>{brl(k.price)}</dd></div>
              {k.discount > 0 && <div><dt>Desconto</dt><dd>{brl(k.discount)}{k.coupon ? ` (cupom ${k.coupon})` : ''}</dd></div>}
              <div><dt>Total do período</dt><dd><strong>{brl(k.total)}</strong></dd></div><div><dt>Início</dt><dd>{day(k.startDate)}</dd></div>
              <div><dt>Teste gratuito</dt><dd>{k.trialDays ? `até ${day(k.trialEnd)} (restante do mês grátis)` : 'Não aplicável'}</dd></div><div><dt>Próximo vencimento</dt><dd>{day(k.nextDue)}</dd></div>
              <div><dt>Limites</dt><dd>{k.entitlements.users} usuários · {k.entitlements.branches} filial(is) · {k.entitlements.products.toLocaleString('pt-BR')} produtos · {k.entitlements.whatsapp} WhatsApp · {k.entitlements.aiMessagesPerDay} consultas IA/dia</dd></div></dl>
            <p className="small">Recursos: {k.entitlements.features.join(' · ')}</p></section>
          <nav className="contract-toc" aria-label="Cláusulas"><details><summary>Ir para a cláusula</summary><ol>{filled.sections.map((s, i) => <li key={s.title}><a href={`#clausula-${i}`} onClick={e => { e.preventDefault(); document.getElementById(`clausula-${i}`)?.scrollIntoView({ block: 'start' }); }}>{s.title}</a></li>)}</ol></details></nav>
          <article ref={article} className="hire-contract" data-tour="hire-contract" tabIndex={0} aria-label="Texto integral do contrato" onScroll={e => { const el = e.currentTarget; if (el.scrollTop + el.clientHeight >= el.scrollHeight - 40) setRead(true); }}>
            <h2>{filled.title}</h2><p className="muted">{filled.subtitle}</p><h3>{filled.summaryTitle}</h3>
            <dl className="hire-contract-summary">{filled.summary.map(([key, v]) => <div key={key}><dt>{key}</dt><dd>{v}</dd></div>)}</dl><p className="small">{filled.summaryNote}</p>
            {filled.sections.map((s, i) => <section key={s.title} id={`clausula-${i}`}><h4>{s.title}</h4>{s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}</section>)}
            <h4>{filled.signatureTitle}</h4>{filled.signatureBlock.map((l, i) => <p key={i}>{l}</p>)}</article>
          {!read && <p className="muted small">Role até o fim do contrato para liberar o aceite.</p>}
          <label className="checkbox-row hire-agree"><input type="checkbox" checked={agree} disabled={!read || contract.status !== 'prepared'} onChange={e => setAgree(e.target.checked)}/>
            <span>Li e concordo com o contrato {contract.number} (versão {contract.version.code}) e com as condições do plano {k.planName} {PERIODS[k.period as Period].toLowerCase()} acima. Entendo que a assinatura é feita no provedor de assinatura eletrônica e que esta marcação não é a assinatura.</span></label>
          <div className="toolbar"><button type="button" className="btn" disabled={!!busy} onClick={() => void discardAnd(() => setStep(1))}>Corrigir dados</button>
            <button type="button" className="btn" disabled={pdfBusy} onClick={() => void conferencePdf()}>{pdfBusy ? <Loader2 size={16} className="spin"/> : <Download size={16}/>}Baixar PDF de conferência</button>
            <button type="button" className="btn primary" data-tour="hire-sign" disabled={!read || !agree || !!busy || contract.status !== 'prepared'} onClick={() => void action('send').then(() => setStep(4))}>{busy === 'send' ? <Loader2 size={16} className="spin"/> : <FileSignature size={16}/>}Assinar eletronicamente</button></div>
          <p className="muted small">Corrigir dados descarta este contrato (fica registrado como não utilizado) e gera um novo.</p></>}
      </Step>}
      {step === 4 && contract && <Step icon={<FileSignature/>} title="Assinatura eletrônica"><div data-tour="hire-signers">
        <p className="callout" role="status">{STATUS[contract.status] ?? contract.status}. {contract.status === 'awaiting_customer' ? `O convite foi enviado para ${contract.signers.find(s => s.role === 'customer')?.email}. Abra o e-mail da Autentique, confira os dados e assine.` : ''}</p>
        <ul className="hire-signers">{contract.signers.map(s => <li key={s.role}><strong>{s.role === 'customer' ? 'Contratante' : 'Contratada'}</strong> {s.name} · {s.email}<span className={`badge ${s.status === 'signed' ? 'success' : s.status === 'refused' ? 'danger' : 'warning'}`}>{{ pending: 'Pendente', viewed: 'Visualizou', signed: 'Assinou', refused: 'Recusou' }[s.status] ?? s.status}</span>{s.signedAt && <small> em {new Date(s.signedAt).toLocaleString('pt-BR')}</small>}</li>)}</ul>
        <div className="toolbar"><button type="button" className="btn" disabled={!!busy} onClick={() => void action('reconcile')}>{busy === 'reconcile' && <Loader2 size={16} className="spin"/>}Atualizar situação</button>
          <button type="button" className="btn" disabled={!!busy || signed} onClick={() => void action('resend')}>Reenviar convite</button>
          <button type="button" className="btn" disabled={!!busy} onClick={() => void action('download', { file: 'original' })}>Baixar documento enviado</button></div>
        <p className="muted small">A conclusão só é registrada quando a Autentique confirma todas as assinaturas. Hash do documento enviado: <code>{contract.documentSha256?.slice(0, 16)}…</code></p></div></Step>}
      {step === 5 && contract && <Step icon={<CreditCard/>} title="Pagamento">{contract.sandbox ? <p className="callout">Contrato de homologação: não gera cobrança.</p> : !signed ? <p className="callout warning">A cobrança é liberada depois que todas as partes assinarem.</p> : <>
        <p>Valor contratado: <strong>{brl(contract.commercial.total)}</strong> ({PERIODS[contract.commercial.period as Period]}). {contract.commercial.trialDays ? `Vencimento no fim do teste (${day(contract.commercial.trialEnd)}).` : ''}</p>
        <p className="callout">{paid ? 'Pagamento confirmado pela InfinitePay.' : contract.invoice ? `Fatura: ${contract.invoice.status}. O retorno do checkout não confirma o pagamento; a confirmação vem do servidor.` : 'Gere a cobrança para pagar por Pix ou cartão.'}</p>
        <div className="toolbar">{!paid && <button type="button" className="btn primary" data-tour="hire-pay" disabled={!!busy} onClick={() => void pay()}>{busy === 'pay' && <Loader2 size={16} className="spin"/>}Pagar com InfinitePay</button>}
          <button type="button" className="btn" onClick={() => setStep(6)}>{paid ? 'Concluir' : 'Pagar depois'}</button></div></>}</Step>}
      {step === 6 && contract && <Step icon={<ShieldCheck/>} title={signed && (paid || contract.commercial.trialDays) ? 'Bem-vindo ao PISTEC!' : 'Situação da contratação'}>
        <p>{signed ? (paid ? 'Seu contrato foi formalizado e sua assinatura está ativa.' : contract.commercial.trialDays ? `Contrato assinado. Você segue no período de teste até ${day(contract.commercial.trialEnd)}; a primeira cobrança vence nessa data.` : 'Contrato assinado. O pagamento ainda não foi confirmado.') : 'A contratação ainda não foi concluída. Você pode retomar a qualquer momento por aqui ou em Minha assinatura.'}</p>
        <dl className="kv-grid"><div><dt>Empresa</dt><dd>{contract.parties.company.legalName}</dd></div><div><dt>Plano</dt><dd>{contract.commercial.planName} · {PERIODS[contract.commercial.period as Period]}</dd></div><div><dt>Início</dt><dd>{day(contract.commercial.startDate)}</dd></div>
          <div><dt>Próximo vencimento</dt><dd>{day(contract.commercial.nextDue)}</dd></div><div><dt>Contrato</dt><dd>{contract.number}</dd></div></dl>
        <div className="toolbar">{signed && <button type="button" className="btn" onClick={() => void action('download', { file: 'signed' })}>Baixar contrato assinado</button>}
          {tenant && <button type="button" className="btn primary" onClick={() => navigate(`/loja/${tenant.slug}/dashboard`)}>Acessar PISTEC</button>}
          {tenant && <button type="button" className="btn" onClick={() => navigate(`/loja/${tenant.slug}/minha-assinatura`)}>Minha assinatura</button>}</div></Step>}
      {step < 3 && user && <div className="hire-nav"><button type="button" className="btn" disabled={step === 0} onClick={() => setStep(s => s - 1)}><ArrowLeft size={16}/>Voltar</button>
        <button type="button" className="btn primary" onClick={() => { if (validate(step)) setStep(s => s + 1); }}>{step === 0 ? 'Continuar com este plano' : 'Avançar'}<ArrowRight size={16}/></button></div>}
      {step === 3 && !contract && <div className="hire-nav"><button type="button" className="btn" onClick={() => setStep(2)}><ArrowLeft size={16}/>Voltar</button></div>}
    </section>{summary}</div>
  </main>;
}

function Step({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return <div className="hire-step"><h2>{icon}{title}</h2>{children}</div>;
}
