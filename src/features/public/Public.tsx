import { useEffect, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Menu, Package, ShieldCheck, Wrench, X, Zap } from 'lucide-react';
import { useDemo } from '../../store';
import { createTenant } from '../../domain';
import { date, imageData, money, today, uid } from '../../lib';
import { Empty, Field } from '../../ui';
import type { Branding, Role, Tenant } from '../../types';
import {
  documentDigits, email, maskCEP, maskDocument, maskPhone, mockCEP, periods, phoneDigits,
  planPrice, planSavings, platformRecord, required, roles, type Period,
} from './model';
import { useAction } from './useAction';
import './public.css';

const modules = [
  ['pdv', 'PDV', 'Do balcão à venda concluída. Agilidade sem perder o controle.'],
  ['produtos', 'Produtos', 'Catálogo, preços e aplicações no mesmo lugar.'],
  ['estoque', 'Estoque', 'Movimentações por filial. Saiba o que comprar antes de faltar.'],
  ['ordens-servico', 'Ordens de serviço', 'Acompanhe cada etapa, do diagnóstico à entrega.'],
  ['financeiro', 'Financeiro', 'Receitas, despesas e vencimentos para decidir com clareza.'],
  ['whatsapp', 'WhatsApp', 'Organize o atendimento. Integração externa demonstrativa.'],
  ['relatorios', 'Relatórios', 'Transforme os dados da operação em próximos passos.'],
  ['personalizacao', 'Personalização', 'Sua marca, suas cores, seu jeito de trabalhar.'],
] as const;

const faq = [
  ['Posso conhecer antes de contratar?', 'Sim. A demonstração usa dados fictícios e permite escolher empresa e perfil, sem senha ou cobrança.'],
  ['Os dados são reais?', 'Não. Esta versão é um protótipo local com dados armazenados neste navegador (IndexedDB). Não informe dados sensíveis.'],
  ['Há emissão fiscal ou pagamento real?', 'Não. Cobranças, integrações e notificações são simulações identificadas. Nenhum pagamento é processado.'],
  ['Como funciona a contratação e periodicidade?', 'Os planos têm preços totais por período (mensal, trimestral ou anual com desconto). O total e o equivalente mensal são detalhados antes do cadastro.'],
  ['Minha empresa pode ter filiais e marca própria?', 'Sim. O PISTEC suporta filiais com controle de estoque independente e personalização completa de logo, cores e tema por empresa.'],
  ['O sistema roda em nuvem?', 'Nesta etapa, o PISTEC opera como demonstração local autônoma. O acesso em nuvem com sincronização remota é um item de roadmap para quando o backend for operacionalizado.'],
];

function Screenshot({ name, title, hero = false }: { name: string; title: string; hero?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className={`pub-shot ${hero ? 'pub-shot-hero' : ''}`}>
    <div className="pub-window"><span/><span/><span/><small>PISTEC / {title}</small><span className="pub-demo-label">DEMONSTRAÇÃO</span></div>
    {failed ? <div className="pub-shot-fallback"><img src="/brand/symbol.webp" alt="" width="72" height="72"/><strong>{title}</strong><p>Captura real em preparação.</p><Link to="/demonstracao">Explorar a demonstração <ArrowRight size={16}/></Link></div> :
      <img src={`/screenshots/${name}.webp`} alt={`Tela demonstrativa de ${title} no PISTEC`} loading={hero ? 'eager' : 'lazy'} fetchPriority={hero ? 'high' : 'auto'} width="1440" height="900" onError={() => setFailed(true)}/>}
  </figure>;
}

function Pricing({ compact = false }: { compact?: boolean }) {
  const { state } = useDemo();
  const [period, setPeriod] = useState<Period>('monthly');
  return <section className="pub-section" id="planos">
    <div className="pub-section-heading">
      <span className="pub-eyebrow">CRESÇA NO SEU RITMO</span>
      {compact ? <h2>O próximo nível começa<br/>com o plano certo.</h2> : <h1>O próximo nível começa<br/>com o plano certo.</h1>}
      <p>Valores demonstrativos alinhados ao catálogo da plataforma. Sem cobrança real nesta versão.</p>
    </div>
    <div className="pub-periods" aria-label="Periodicidade">
      {Object.entries(periods).map(([key, value]) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key as Period)}>{value.label}</button>)}
    </div>
    <div className="pub-plan-grid">
      {state.plans.map((plan, i) => {
        const price = planPrice(plan, period);
        const savings = planSavings(plan, period);
        const isEnterprise = plan.id === 'enterprise';
        return <article className={`pub-plan ${i === 1 ? 'pub-plan-featured' : ''}`} key={plan.id}>
          {i === 1 && <span className="pub-plan-flag">MAIS ESCOLHIDO</span>}
          <h3>{plan.name}</h3>
          <p>{plan.trialDays} dias de teste demonstrativo gratuito</p>
          {isEnterprise ? <>
            <div className="pub-price"><small>Sob consulta</small></div>
            <p>A partir de {money(plan.monthly)}/mês · Implantação e limites dedicados sob medida.</p>
          </> : <>
            <div className="pub-price">{money(price.monthly)}<small>/mês</small></div>
            <p>{money(price.total)} cobrados por período {periods[period].label.toLowerCase()}</p>
            {savings > 0 && <span className="pub-plan-economy">Economia de {savings}% neste plano</span>}
          </>}
          {isEnterprise ?
            <Link className="pub-button pub-button-outline" to="/contato">Falar com consultor<ArrowRight size={16}/></Link> :
            <Link className={`pub-button ${i === 1 ? '' : 'pub-button-outline'}`} to={`/cadastro?plano=${encodeURIComponent(plan.id)}&periodo=${period}`}>Testar {plan.name} grátis<ArrowRight size={16}/></Link>}
          <ul>
            {[
              `${plan.users} ${plan.users === 1 ? 'usuário' : 'usuários'} incluídos`,
              `${plan.branches} ${plan.branches === 1 ? 'filial' : 'filiais'} com estoque independente`,
              `${plan.products.toLocaleString('pt-BR')} produtos no catálogo`,
              `${plan.whatsapp} ${plan.whatsapp === 1 ? 'instância' : 'instâncias'} WhatsApp`,
              ...plan.features,
            ].map((feature, index) => <li key={`${feature}-${index}`}><Check size={16}/>{feature}</li>)}
          </ul>
        </article>;
      })}
    </div>
    {!state.plans.length && <Empty text="Planos ainda não cadastrados."/>}
    {!compact && state.plans.length > 0 && <div className="pub-compare">
      <div className="pub-section-heading">
        <span className="pub-eyebrow">COMPARAÇÃO COMPLETA</span>
        <h3>Compare os limites e recursos</h3>
        <p>Cada plano inclui filiais, controle de catálogo e permissões por perfil sem surpresas.</p>
      </div>
      <div className="table-wrap">
        <table>
          <caption>Limites e recursos por plano SaaS</caption>
          <thead><tr><th scope="col">Recurso</th>{state.plans.map(p => <th scope="col" key={p.id}>{p.name}</th>)}</tr></thead>
          <tbody>
            {(['users', 'branches', 'products', 'whatsapp', 'trialDays'] as const).map((key, index) => <tr key={key}>
              <th scope="row">{['Usuários', 'Filiais', 'Produtos no catálogo', 'Instâncias WhatsApp', 'Dias de teste'][index]}</th>
              {state.plans.map(p => <td key={p.id}>{key === 'products' ? p[key].toLocaleString('pt-BR') : p[key]}</td>)}
            </tr>)}
            {Array.from(new Set(state.plans.flatMap(p => p.features))).map(feature => <tr key={feature}>
              <th scope="row">{feature}</th>
              {state.plans.map(p => <td key={p.id}>{p.features.includes(feature) ? 'Incluído' : '—'}</td>)}
            </tr>)}
          </tbody>
        </table>
      </div>
    </div>}
  </section>;
}

function FAQ() {
  return <section className="pub-section pub-faq">
    <div><span className="pub-eyebrow">TRANSPARÊNCIA TOTAL</span><h2>Perguntas frequentes.<br/>Respostas sem rodeios.</h2><p>Tudo o que você precisa saber sobre a demonstração, planos e arquitetura da plataforma.</p></div>
    <div>{faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </section>;
}

function LeadForm({ recovery = false }: { recovery?: boolean }) {
  const { mutate } = useDemo(); const action = useAction(); const [sent, setSent] = useState(false);
  const [phone, setPhone] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action.run(async () => {
      const contact = email(String(form.get('email') ?? ''));
      if (form.get('consent') !== 'on') throw new Error('Confirme o aviso de privacidade.');
      const name = recovery ? 'Solicitação de acesso demonstrativa' : required(String(form.get('name') ?? ''), 'Nome');
      const message = String(form.get('message') ?? '').trim();
      if (message.length > 2000) throw new Error('Mensagem limitada a 2000 caracteres.');
      const digits = phoneDigits(phone);
      await mutate(draft => {
        draft.records.push(platformRecord(uid(), recovery ? 'admin-recuperacao' : 'admin-lead', name, { email: contact, phone: digits, company: String(form.get('company') ?? ''), message, consent: new Date().toISOString(), source: window.location.pathname }));
      });
      setSent(true);
    }, recovery ? 'Solicitação registrada localmente. Nenhum e-mail foi enviado.' : 'Interesse registrado nesta demonstração. Nenhuma mensagem externa foi enviada.');
  }
  if (sent) return <div className="pub-success" role="status"><ShieldCheck size={40}/><h2>{recovery ? 'Solicitação registrada' : 'Vamos dar o próximo passo.'}</h2><p>Registro salvo apenas neste navegador. Este protótipo não envia e-mails ou mensagens externas.</p><Link className="pub-button" to="/demonstracao">Acessar demonstração<ArrowRight size={18}/></Link></div>;
  return <form className="pub-form" onSubmit={submit}>
    <p className="pub-callout">Ambiente demonstrativo. Seus dados ficam salvos apenas neste dispositivo.</p>
    {!recovery && <><Field label="Seu nome"><input name="name" required maxLength={120} autoComplete="name"/></Field><Field label="Empresa"><input name="company" maxLength={160} autoComplete="organization"/></Field></>}
    <Field label="E-mail"><input name="email" type="email" required maxLength={254} autoComplete="email"/></Field>
    {!recovery && <>
      <Field label="Telefone com DDD (opcional)" hint="Formato: (00) 00000-0000"><input name="phone" type="tel" maxLength={16} value={phone} onChange={e => setPhone(maskPhone(e.target.value))} autoComplete="tel"/></Field>
      <Field label="Como podemos ajudar sua operação?"><textarea name="message" rows={4} maxLength={2000}/></Field>
    </>}
    <label className="pub-check"><input name="consent" type="checkbox" required/><span>Li a <Link to="/privacidade">política de privacidade</Link> e entendo que o registro é local.</span></label>
    {action.error && <p role="alert" className="pub-error">{action.error}</p>}
    <button className="pub-button" disabled={action.pending}>{action.pending ? 'Salvando…' : recovery ? 'Registrar solicitação simulada' : 'Registrar meu interesse'}<ArrowRight size={18}/></button>
  </form>;
}

function DemoChooser() {
  const { state, setSession } = useDemo(); const navigate = useNavigate(); const action = useAction();
  const [tenantId, setTenantId] = useState(''); const [role, setRole] = useState<Role>('Proprietário');
  const selectedId = tenantId || state.tenants[0]?.id || '';
  function enter(admin = false) {
    void action.run(() => {
      const tenant = state.tenants.find(item => item.id === selectedId);
      const branch = state.branches.find(item => item.tenantId === selectedId && item.active);
      if (!tenant || !branch) throw new Error('Empresa sem filial ativa. Escolha outra demonstração.');
      if (admin) { setSession({ tenantId: tenant.id, branchId: branch.id, role: 'Administrador', name: 'Super Admin Demo', admin: true }); navigate('/admin'); return; }
      setSession({ tenantId: tenant.id, branchId: branch.id, role, name: `${role} Demo`, admin: false }); navigate(`/loja/${tenant.slug}/dashboard`);
    }, 'Sessão demonstrativa iniciada.');
  }
  return <section className="pub-section pub-split">
    <div>
      <span className="pub-eyebrow">EXPERIMENTE POR DENTRO</span>
      <h1>Seu próximo sistema.<br/><em>Sem adivinhação.</em></h1>
      <p>Escolha uma empresa de demonstração e explore o fluxo real de trabalho: balcão, ordens de serviço, filiais e caixa.</p>
      <p className="pub-callout">Demonstração local com dados fictícios. Os perfis simulam permissões reais de equipe sem exigir login no servidor.</p>
      <Screenshot name="dashboard" title="Visão geral"/>
    </div>
    <div className="pub-form">
      <h2>Entrar na demonstração</h2>
      <Field label="Empresa"><select value={selectedId} onChange={event => setTenantId(event.target.value)}>{!state.tenants.length && <option value="">Nenhuma empresa disponível</option>}{state.tenants.map(tenant => <option value={tenant.id} key={tenant.id}>{tenant.name} — {tenant.profile}</option>)}</select></Field>
      <Field label="Perfil de acesso"><select value={role} onChange={event => setRole(event.target.value as Role)}>{roles.map(item => <option key={item}>{item}</option>)}</select></Field>
      <button className="pub-button" disabled={action.pending || !selectedId} onClick={() => enter()}>Explorar empresa<ArrowRight size={18}/></button>
      <div className="pub-divider"/>
      <h3>Gestão da plataforma</h3>
      <p>Empresas clientes, planos, cobranças SaaS e cupons de desconto simulados, com identidade visual própria PISTEC.</p>
      <button className="pub-button pub-button-outline" disabled={action.pending || !selectedId} onClick={() => enter(true)}>Entrar como Super Admin</button>
      {action.error && <p role="alert" className="pub-error">{action.error}</p>}
      <Link to="/recuperar-acesso">Recuperar acesso</Link>
      <Link to="/cadastro">Criar uma empresa demonstrativa</Link>
    </div>
  </section>;
}

const steps = ['Você', 'Empresa', 'Endereço', 'Plano', 'Identidade', 'Revisão'];
function Onboarding() {
  const { state, mutate, setSession } = useDemo(); const location = useLocation(); const navigate = useNavigate(); const action = useAction();
  const params = new URLSearchParams(location.search);
  const [step, setStep] = useState(0); const [accepted, setAccepted] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [data, setData] = useState({
    owner: '', email: '', name: '', legalName: '', document: '', profile: 'Oficina',
    cep: '', street: '', number: '', district: '', city: '', region: '',
    planId: params.get('plano') || '',
    period: (Object.keys(periods).includes(params.get('periodo') || '') ? params.get('periodo') : 'monthly') as Period,
    primary: '#16c7e8', secondary: '#102440', accent: '#38d4ec', logo: '',
  });
  const plan = state.plans.find(item => item.id === data.planId) || state.plans[0];
  const clearError = (field: string) => setErrors(cur => { if (!cur[field]) return cur; const next = { ...cur }; delete next[field]; return next; });
  const change = (key: keyof typeof data, value: string) => { clearError(key); setData(current => ({ ...current, [key]: value })); };

  function validateStage(stage: number): Record<string, string> {
    const errs: Record<string, string> = {};
    if (stage === 0) {
      try { required(data.owner, 'Seu nome'); } catch (e) { errs.owner = (e as Error).message; }
      try { email(data.email); } catch (e) { errs.email = (e as Error).message; }
    }
    if (stage === 1) {
      try { required(data.name, 'Nome fantasia'); } catch (e) { errs.name = (e as Error).message; }
      try { required(data.legalName, 'Razão social'); } catch (e) { errs.legalName = (e as Error).message; }
      try { documentDigits(data.document); } catch (e) { errs.document = (e as Error).message; }
    }
    if (stage === 2) {
      try { mockCEP(data.cep); } catch (e) { errs.cep = (e as Error).message; }
      try { required(data.street, 'Logradouro'); } catch (e) { errs.street = (e as Error).message; }
      try { required(data.number, 'Número'); } catch (e) { errs.number = (e as Error).message; }
      try { required(data.district, 'Bairro'); } catch (e) { errs.district = (e as Error).message; }
      try { required(data.city, 'Cidade'); } catch (e) { errs.city = (e as Error).message; }
      if (!/^[A-Z]{2}$/.test(data.region)) errs.region = 'UF deve ter duas letras.';
    }
    if (stage === 3 && !plan) errs.planId = 'Selecione um plano válido.';
    if (stage === 4 && ![data.primary, data.secondary, data.accent].every(c => /^#[\da-f]{6}$/i.test(c))) errs.colors = 'Cores hexadecimais inválidas.';
    return errs;
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stageErrors = validateStage(step);
    setErrors(stageErrors);
    if (Object.keys(stageErrors).length) return;

    if (step < 5) { setStep(cur => cur + 1); return; }
    const allErrors: Record<string, string> = {};
    for (let s = 0; s < 5; s++) Object.assign(allErrors, validateStage(s));
    if (!accepted) allErrors.accepted = 'É necessário aceitar os termos da demonstração.';
    if (!plan) allErrors.planId = 'Selecione um plano disponível.';
    setErrors(allErrors);
    if (Object.keys(allErrors).length) return;

    void action.run(async () => {
      let created: Tenant | undefined; let branchId = '';
      await mutate(draft => {
        if (!draft.plans.some(item => item.id === plan.id)) throw new Error('Plano não está mais disponível.');
        const branding: Branding = { primary: data.primary, secondary: data.secondary, accent: data.accent, sidebar: '#081427', theme: 'dark', logo: data.logo, font: 'Inter', density: 'comfortable', footer: data.name, widgets: ['revenue', 'sales', 'stock', 'services'], radius: 'default' };
        created = createTenant(draft, { owner: required(data.owner, 'Nome'), email: email(data.email), name: required(data.name, 'Empresa'), legalName: required(data.legalName, 'Razão social'), document: data.document.replace(/\D/g, ''), profile: data.profile, planId: plan.id, branding, notes: 'Cadastro demonstrativo; endereço e aceite no registro admin-onboarding.' });
        branchId = draft.branches.find(item => item.tenantId === created?.id && item.active)?.id || '';
        if (!branchId) throw new Error('Não foi possível criar a filial inicial.');
        draft.records.push(platformRecord(uid(), 'admin-onboarding', `Cadastro: ${created.name}`, { tenantId: created.id, cep: data.cep, street: data.street, number: data.number, district: data.district, city: data.city, region: data.region, period: data.period, consent: new Date().toISOString(), termsVersion: 'demo-1', total: String(planPrice(plan, data.period).total) }));
      });
      if (created) { setSession({ tenantId: created.id, branchId, role: 'Proprietário', name: created.owner, admin: false }); navigate(`/loja/${created.slug}/dashboard`); }
    }, 'Empresa demonstrativa criada.');
  }

  return <section className="pub-section pub-onboarding">
    <div className="pub-section-heading">
      <span className="pub-eyebrow">CADASTRO DEMONSTRATIVO</span>
      <h1>Monte seu espaço de trabalho.</h1>
      <p>Crie sua empresa de demonstração em 6 passos rápidos com validação inline. Sem cartão de crédito.</p>
    </div>
    <ol className="pub-steps">{steps.map((label, index) => <li key={label} aria-current={step === index ? 'step' : undefined}><span>{index + 1}</span>{label}</li>)}</ol>
    <form className="pub-form" noValidate onSubmit={submit}>
      <h2>{steps[step]}</h2>
      {step === 0 && <>
        <Field label="Seu nome" error={errors.owner}><input value={data.owner} onChange={event => change('owner', event.target.value)} required maxLength={120} autoComplete="name"/></Field>
        <Field label="E-mail" error={errors.email}><input type="email" value={data.email} onChange={event => change('email', event.target.value)} required maxLength={254} autoComplete="email"/></Field>
      </>}
      {step === 1 && <>
        <Field label="Nome fantasia" error={errors.name}><input required value={data.name} onChange={event => change('name', event.target.value)} maxLength={160}/></Field>
        <Field label="Razão social" error={errors.legalName}><input required value={data.legalName} onChange={event => change('legalName', event.target.value)} maxLength={160}/></Field>
        <Field label="CPF / CNPJ fictício" hint="11 ou 14 dígitos formatados automaticamente" error={errors.document}><input required inputMode="numeric" value={maskDocument(data.document)} onChange={event => change('document', event.target.value)} maxLength={18}/></Field>
        <Field label="Perfil da empresa"><select value={data.profile} onChange={event => change('profile', event.target.value)}>{['Oficina', 'Motopeças', 'Autopeças', 'Oficina e peças'].map(item => <option key={item}>{item}</option>)}</select></Field>
      </>}
      {step === 2 && <>
        <Field label="CEP" hint="Formato 00000-000" error={errors.cep}><input required inputMode="numeric" maxLength={9} value={maskCEP(data.cep)} onChange={event => change('cep', event.target.value)}/></Field>
        <button className="pub-button pub-button-outline" type="button" disabled={action.pending} onClick={() => {
          try {
            const cepData = mockCEP(data.cep);
            clearError('cep');
            setData(cur => ({ ...cur, ...cepData }));
          } catch (e) {
            setErrors(cur => ({ ...cur, cep: (e as Error).message }));
          }
        }}>Consultar CEP (simulado)</button>
        <div className="form-grid">
          <Field label="Logradouro" error={errors.street}><input required value={data.street} maxLength={160} onChange={event => change('street', event.target.value)}/></Field>
          <Field label="Número" error={errors.number}><input required value={data.number} maxLength={20} onChange={event => change('number', event.target.value)}/></Field>
          <Field label="Bairro" error={errors.district}><input required value={data.district} maxLength={160} onChange={event => change('district', event.target.value)}/></Field>
          <Field label="Cidade" error={errors.city}><input required value={data.city} maxLength={160} onChange={event => change('city', event.target.value)}/></Field>
          <Field label="UF" hint="2 letras" error={errors.region}><input required value={data.region} maxLength={2} onChange={event => change('region', event.target.value.toUpperCase())}/></Field>
        </div>
      </>}
      {step === 3 && <>
        <Field label="Plano" error={errors.planId}><select required value={plan?.id || ''} onChange={event => change('planId', event.target.value)}>{!plan && <option value="">Sem planos disponíveis</option>}{state.plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Periodicidade"><select value={data.period} onChange={event => change('period', event.target.value)}>{Object.entries(periods).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
        {plan && <p className="pub-callout">{money(planPrice(plan, data.period).total)} / período ({periods[data.period].label.toLowerCase()}) · {plan.trialDays} dias de teste demonstrativo sem cobrança.</p>}
      </>}
      {step === 4 && <>
        <div className="form-grid">{([['primary', 'Cor principal'], ['secondary', 'Cor secundária'], ['accent', 'Destaque']] as const).map(([key, label]) => <Field key={key} label={label}><input type="color" value={data[key]} onChange={event => change(key, event.target.value)}/></Field>)}</div>
        {errors.colors && <p role="alert" className="pub-error">{errors.colors}</p>}
        <Field label="Logo (PNG, JPEG ou WebP, até 2 MB)"><input type="file" accept="image/png,image/jpeg,image/webp" disabled={action.pending} onChange={event => { const file = event.target.files?.[0]; if (file) void action.run(async () => change('logo', await imageData(file)), 'Logo carregado.'); }}/></Field>
        {data.logo && <><img className="pub-logo-preview" src={data.logo} alt="Prévia do logo da empresa"/><button type="button" className="pub-text-button" onClick={() => change('logo', '')}>Remover logo</button></>}
      </>}
      {step === 5 && <>
        <dl className="pub-summary">
          <dt>Responsável</dt><dd>{data.owner} · {data.email}</dd>
          <dt>Empresa</dt><dd>{data.name} ({data.legalName}) · {maskDocument(data.document)} · {data.profile}</dd>
          <dt>Endereço</dt><dd>{data.street}, {data.number} — {data.district}, {data.city}/{data.region} · CEP {maskCEP(data.cep)}</dd>
          <dt>Plano</dt><dd>{plan?.name} · {periods[data.period].label} · {plan ? money(planPrice(plan, data.period).total) : 'Indisponível'}</dd>
        </dl>
        <label className="pub-check"><input type="checkbox" required checked={accepted} onChange={event => { setAccepted(event.target.checked); clearError('accepted'); }}/><span>Li os <Link to="/termos" target="_blank" rel="noopener noreferrer">termos</Link> e a <Link to="/privacidade" target="_blank" rel="noopener noreferrer">política de privacidade</Link>. Entendo que esta é uma demonstração local.</span></label>
        {errors.accepted && <p role="alert" className="pub-error">{errors.accepted}</p>}
      </>}
      {action.error && <p role="alert" className="pub-error">{action.error}</p>}
      <div className="pub-actions">
        {step > 0 && <button type="button" className="pub-button pub-button-outline" disabled={action.pending} onClick={() => setStep(current => current - 1)}>Voltar</button>}
        <button className="pub-button" disabled={action.pending}>{action.pending ? 'Salvando…' : step === 5 ? 'Criar empresa demonstrativa' : 'Continuar'}<ArrowRight size={18}/></button>
      </div>
    </form>
  </section>;
}

function Legal({ privacy }: { privacy: boolean }) {
  return <section className="pub-section pub-legal">
    <span className="pub-eyebrow">TRANSPARÊNCIA E RESPONSABILIDADE</span>
    <h1>{privacy ? 'Privacidade na demonstração' : 'Termos da demonstração'}</h1>
    <p>Versão demo-1 · {date(today())}. Este documento descreve o funcionamento do protótipo e não substitui os contratos de uma contratação corporativa real.</p>
    {(privacy ? [
      ['Armazenamento local no navegador', 'Todos os cadastros, faturas e movimentações ficam armazenados no IndexedDB deste navegador. Nenhum registro é enviado a servidores remotos nesta versão.'],
      ['Dados demonstrativos e fictícios', 'Utilize nomes, documentos e telefones fictícios. Não cadastre senhas reais, cartões de crédito ou dados protegidos.'],
      ['Exclusão total dos dados', 'Você pode redefinir o estado a qualquer momento pela tela de demonstração ou limpando os dados do site nas configurações do navegador.'],
      ['Simulação de serviços externos', 'Consultas de CEP, notificações de WhatsApp, emissão fiscal e conectores de cobrança são simulações sem transações reais.'],
    ] : [
      ['Finalidade da plataforma', 'O PISTEC é um protótipo navegável para validação de fluxos operacionais, cadastros, filiais e governança multiempresa.'],
      ['Sem cobranças reais', 'Os planos SaaS e faturas simuladas (Asaas/InfinitePay) têm propósito estritamente demonstrativo e não geram obrigações financeiras.'],
      ['Isolamento multiempresa e marca branca', 'Cada empresa opera com identidade visual própria e filiais isoladas. Na futura versão em nuvem, o isolamento será garantido por banco relacional com chaves segregadas.'],
      ['Disponibilidade e roadmap', 'Recursos como sincronização em nuvem e mensageria externa estão no roadmap de implantação da infraestrutura de backend.'],
    ]).map(([title, text]) => <article key={title}><h2>{title}</h2><p>{text}</p></article>)}
    <Link to="/contato" className="pub-button pub-button-outline">Falar sobre o projeto</Link>
  </section>;
}

function Marketing({ path }: { path: string }) {
  const segment = path === '/oficinas' ? 'oficina' : path === '/motopecas' ? 'loja de motopeças' : path === '/autopecas' ? 'loja de autopeças' : '';
  return <>
    <section className="pub-hero">
      <div className="pub-hero-copy">
        <div className="pub-hero-brand"><img src="/brand/logo-horizontal.webp" alt="PISTEC Gestão Automotiva" width="220" height="62"/></div>
        <span className="pub-eyebrow"><span className="pub-status-dot"/> GESTÃO AUTOMOTIVA INTEGRADA</span>
        <h1>{segment ? <>Sua {segment},<br/>um passo <em>à frente.</em></> : <>Menos improviso.<br/>Mais controle.<br/><em>Seu negócio à frente.</em></>}</h1>
        <p>Vendas no balcão, controle de filiais, ordens de serviço, peças e financeiro. Plataforma com sua própria marca visual e visão completa do faturamento.</p>
        <div className="pub-actions">
          <Link className="pub-button" to="/cadastro">Testar grátis por 14 dias<ArrowRight size={18}/></Link>
          <Link className="pub-button pub-button-outline" to="/demonstracao">Ver demonstração</Link>
          <Link className="pub-button pub-button-outline" to="/planos">Conhecer planos</Link>
        </div>
        <div className="pub-hero-proof">
          <span><Check size={15}/>Multiempresa com filiais</span>
          <span><Check size={15}/>Marca branca (suas cores e logo)</span>
          <span><Check size={15}/>Sem cartão na demonstração</span>
        </div>
      </div>
      <div className="pub-hero-visual">
        <div className="pub-orbit"/>
        <div className="pub-hero-combo">
          <Screenshot name="dashboard" title="Dashboard" hero/>
          <div className="pub-phone-frame" aria-hidden="true">
            <div className="pub-phone-notch"/>
            <div className="pub-phone-screen">
              <img src="/screenshots/dashboard-mobile.webp" alt="Visão móvel do dashboard" width="780" height="1688" loading="eager"/>
            </div>
          </div>
        </div>
        <div className="pub-floating-label">
          <ShieldCheck size={24}/>
          <div><strong>Uma visão. Toda a operação.</strong><small>Do balcão e da oficina até os indicadores consolidados.</small></div>
        </div>
      </div>
    </section>

    <section className="pub-segments" aria-label="Segmentos de atuação">
      <span>SEGMENTOS ATENDIDOS</span>
      <Link to="/oficinas"><Wrench size={20}/>Oficinas mecânicas</Link>
      <Link to="/motopecas"><Zap size={20}/>Motopeças</Link>
      <Link to="/autopecas"><Package size={20}/>Autopeças e centros automotivos</Link>
    </section>

    <section className="pub-section">
      <div className="pub-section-heading">
        <span className="pub-eyebrow">DIFERENCIAIS DA PLATAFORMA</span>
        <h2>Construído para a rotina automotiva real.</h2>
        <p>Desenvolvido para operações com matriz e filiais, balcão dinâmico e gestão visual orientada a resultados.</p>
      </div>
      <div className="pub-benefits">
        <article><span>01 · FILIAIS</span><h3>Multi-filiais com estoque próprio</h3><p>Cadastre matriz e filiais, consulte disponibilidade entre unidades e realize transferências sem planilhas paralelas.</p></article>
        <article><span>02 · MARCA PRÓPRIA</span><h3>Personalização visual completa</h3><p>Sua logo, suas cores primárias e temas claro ou escuro em cada empresa cliente. A experiência do seu cliente com a sua marca.</p></article>
        <article><span>03 · ORDEM DE SERVIÇO</span><h3>Do diagnóstico à entrega</h3><p>Orçamentos, peças reservadas, apontamento de mecânico, checklist e histórico de veículos com rastreabilidade total.</p></article>
        <article><span>04 · ROADMAP</span><div className="pub-roadmap-tag">Item de roadmap</div><h3>Acesso em nuvem corporativo</h3><p>A sincronização em nuvem e a redundância de servidores estão planejadas para a ativação do backend operacional.</p></article>
      </div>
    </section>

    <section className="pub-section">
      <div className="pub-section-heading">
        <span className="pub-eyebrow">DORES RESOLVIDAS</span>
        <h2>Problemas comuns.<br/>Soluções integradas.</h2>
      </div>
      <div className="pub-benefits">{[
        ['Estoque por filial', 'Saldo por unidade, ponto de pedido, curva de giro e transferências rastreáveis.'],
        ['Ordens de serviço rastreáveis', 'Etapas, veículos, mecânicos responsáveis e peças consumidas em um só lugar.'],
        ['Vendas ágeis no PDV', 'Balcão rápido com múltiplos meios de pagamento, troco calculado e baixa automática de estoque.'],
        ['Visão financeira SaaS e de loja', 'Receitas, despesas, contas a pagar/receber e margem por ordem de serviço.'],
        ['Busca rápida de peças', 'Localização por SKU, código de barras, aplicação por veículo e referência cruzada.'],
        ['CRM e histórico de clientes', 'Histórico completo de atendimentos, veículos da frota e consentimento para contato.'],
        ['Compras estruturadas', 'Pedidos de compra baseados no giro real e sugestão de reposição para evitar ruptura.'],
        ['Busca unificada (Ctrl K)', 'Acesse produtos, clientes, veículos e ordens de serviço com um único comando.'],
      ].map(([title, text], index) => <article key={title}><span>{String(index + 1).padStart(2, '0')}</span><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <section className="pub-section pub-split">
      <div>
        <span className="pub-eyebrow">ATENDIMENTO AO CLIENTE</span>
        <h2>WhatsApp no contexto da ordem de serviço.</h2>
        <p>Notifique clientes sobre orçamentos aprovados, veículos prontos e lembretes de revisão. A integração demonstrativa simula o fluxo sem disparar mensagens reais para celulares.</p>
        <div className="pub-actions"><Link to="/cadastro" className="pub-button">Experimentar na prática<ArrowRight size={16}/></Link></div>
      </div>
      <Screenshot name="whatsapp" title="WhatsApp"/>
    </section>

    <section className="pub-section pub-split">
      <Screenshot name="personalizacao" title="Personalização"/>
      <div>
        <span className="pub-eyebrow">WHITE LABEL E MULTIEMPRESA</span>
        <h2>Cada cliente no seu ambiente.<br/>E com a sua marca.</h2>
        <p>Defina logotipo, paleta de cores primárias, tema e formato de documentos por empresa. As filiais mantêm estoque e caixas segregados para total governança.</p>
      </div>
    </section>

    <section className="pub-section pub-gallery">
      <div className="pub-section-heading">
        <span className="pub-eyebrow">CAPTURAS REAIS DO SISTEMA</span>
        <h2>Ferramentas completas.<br/>Rotina mais produtiva.</h2>
        <p>Telas reais da plataforma em alta resolução. Veja como cada módulo foi desenhado para agilizar seu dia a dia.</p>
      </div>
      <div className="pub-gallery-grid">{modules.map(([slug, title, text]) => <article key={slug}><Screenshot name={slug} title={title}/><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <Pricing compact/>
    <FAQ/>

    <section className="pub-cta">
      <img src="/brand/symbol.webp" alt="" width="80" height="80"/>
      <span className="pub-eyebrow">COMECE HOJE MESMO</span>
      <h2>Mais tempo para acelerar seu negócio.<br/>Menos tempo perdido com controles manuais.</h2>
      <div className="pub-actions" style={{ justifyContent: 'center' }}>
        <Link className="pub-button" to="/cadastro">Começar teste gratuito<ArrowRight size={18}/></Link>
        <Link className="pub-button pub-button-outline" to="/demonstracao">Abrir demonstração</Link>
      </div>
    </section>
  </>;
}

export default function Public() {
  const location = useLocation(); const path = location.pathname.replace(/\/+$/, '') || '/'; const [menu, setMenu] = useState(false);
  useEffect(() => {
    setMenu(false);
    document.title = `PISTEC — ${path === '/' ? 'Gestão Automotiva Inteligente' : ({ '/planos': 'Planos SaaS', '/cadastro': 'Criar empresa', '/login': 'Acesso demonstrativo', '/demonstracao': 'Demonstração', '/contato': 'Contato' }[path] || 'Seu negócio à frente')}`;
    window.scrollTo(0, 0);
  }, [path]);

  let content;
  if (['/login', '/demonstracao'].includes(path)) content = <DemoChooser/>;
  else if (path === '/cadastro') content = <Onboarding/>;
  else if (path === '/planos') content = <><Pricing/><FAQ/></>;
  else if (path === '/contato' || path === '/recuperar-acesso') content = <section className="pub-section pub-split">
    <div>
      <span className="pub-eyebrow">ATENDIMENTO COMERCIAL</span>
      <h1>{path === '/contato' ? <>O próximo capítulo<br/>da sua gestão.</> : 'Recuperar acesso'}</h1>
      <p>{path === '/contato' ? 'Conte-nos sobre sua operação e objetivos. Os dados ficam registrados localmente nesta demonstração.' : 'Não há senhas na demonstração local. Você pode entrar diretamente pelo seletor de perfis ou registrar um pedido local.'}</p>
      <Link to="/demonstracao" className="pub-button pub-button-outline">Abrir demonstração<ChevronRight size={16}/></Link>
    </div>
    <LeadForm recovery={path === '/recuperar-acesso'}/>
  </section>;
  else if (path === '/termos' || path === '/privacidade') content = <Legal privacy={path === '/privacidade'}/>;
  else if (path === '/licenca-perpetua') content = <section className="pub-section pub-split">
    <div>
      <span className="pub-eyebrow">MODALIDADE CORPORATIVA</span>
      <h1>Licença perpétua.<br/><em>Vamos avaliar juntos.</em></h1>
      <p>Modalidade sob medida para redes que demandam infraestrutura proprietária ou implantação on-premise. Escopo, suporte e SLA definidos em proposta dedicada.</p>
      <Link to="/planos" className="pub-button pub-button-outline">Comparar planos SaaS</Link>
    </div>
    <LeadForm/>
  </section>;
  else if (['/', '/funcionalidades', '/oficinas', '/motopecas', '/autopecas'].includes(path)) content = <Marketing path={path}/>;
  else content = <section className="pub-section"><h1>Página não encontrada.</h1><Link className="pub-button" to="/">Voltar ao início</Link></section>;

  return <div className="public-site">
    <a className="pub-skip" href="#public-main">Pular para o conteúdo principal</a>
    <header className="pub-header">
      <Link className="pub-brand" to="/" aria-label="PISTEC Gestão Automotiva início">
        <img src="/brand/logo-horizontal.webp" alt="PISTEC" width="180" height="50"/>
      </Link>
      <button className="pub-menu-toggle" aria-expanded={menu} aria-controls="public-nav" aria-label={menu ? 'Fechar menu' : 'Abrir menu'} onClick={() => setMenu(value => !value)}>
        {menu ? <X/> : <Menu/>}
      </button>
      <nav id="public-nav" className={menu ? 'is-open' : ''} aria-label="Navegação principal">
        {[['/funcionalidades', 'Funcionalidades'], ['/oficinas', 'Oficinas'], ['/motopecas', 'Motopeças'], ['/autopecas', 'Autopeças'], ['/planos', 'Planos'], ['/contato', 'Contato']].map(([href, title]) => <Link aria-current={path === href ? 'page' : undefined} to={href} key={href}>{title}</Link>)}
        <Link to="/login" className="pub-login">Entrar</Link>
        <Link className="pub-button pub-button-small" to="/demonstracao">Ver demonstração<ArrowRight size={15}/></Link>
      </nav>
    </header>
    <main id="public-main" tabIndex={-1}>{content}</main>
    <footer className="pub-footer">
      <div>
        <Link to="/" className="pub-brand"><img src="/brand/logo-horizontal.webp" alt="PISTEC" width="170" height="48"/></Link>
        <p>Tecnologia e controle para quem mantém o mercado automotivo em movimento.</p>
        <small>Protótipo de demonstração local · Dados persistidos no navegador · Sem pagamentos reais</small>
      </div>
      <div><h3>Produto</h3><Link to="/funcionalidades">Funcionalidades</Link><Link to="/planos">Planos SaaS</Link><Link to="/licenca-perpetua">Licença perpétua</Link><Link to="/demonstracao">Demonstração</Link></div>
      <div><h3>Soluções</h3><Link to="/oficinas">Oficinas mecânicas</Link><Link to="/motopecas">Motopeças</Link><Link to="/autopecas">Autopeças</Link><Link to="/cadastro">Criar empresa</Link></div>
      <div><h3>Transparência</h3><Link to="/contato">Contato comercial</Link><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link></div>
      <div className="pub-footer-bottom">
        <span>© {new Date().getFullYear()} PISTEC Gestão Automotiva. Todos os direitos reservados.</span>
        <span>Tecnologia automotiva descomplicada.</span>
      </div>
    </footer>
  </div>;
}
