import { Fragment, useEffect, useState, type FormEvent } from 'react';
import { trialLabel } from '../../services/trial';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Menu, ShieldCheck, X } from 'lucide-react';
import { useDemo } from '../../store';
import { createTenant } from '../../domain';
import { date, imageData, money, today, uid } from '../../lib';
import { Empty, Field } from '../../ui';
import type { Branding, Role, Tenant } from '../../types';
import {
  documentDigits, email, maskDocument, maskPhone, periods, phoneDigits,
  planPrice, planSavings, platformRecord, required, roles, type Period,
} from './model';
import { useAction } from './useAction';
import BrazilianAddressFields from '../address/BrazilianAddressFields';
import { addressErrors, emptyAddress, formatAddress, type Address } from '../../services/address';
import './public.css';
import { useCatalog } from './useCatalog';
import { STATUS_LABEL, type Feature } from '../../services/catalog';
import { JOURNEY, NEXT_SHOWCASE, SEGMENTS } from './showcase';

const modules = [
  ['pdv', 'PDV', 'Do balcão à venda concluída. Agilidade sem perder o controle.'],
  ['produtos', 'Produtos', 'Catálogo, preços e aplicações no mesmo lugar.'],
  ['estoque', 'Estoque', 'Movimentações por filial. Saiba o que comprar antes de faltar.'],
  ['ordens-servico', 'Ordens de serviço', 'Acompanhe cada etapa, do diagnóstico à entrega.'],
  ['financeiro', 'Financeiro', 'Receitas, despesas e vencimentos para decidir com clareza.'],
  ['whatsapp', 'WhatsApp', 'Atendimento pelo WhatsApp da sua loja, com histórico por cliente.'],
  ['relatorios', 'Relatórios', 'Transforme os dados da operação em próximos passos.'],
  ['personalizacao', 'Personalização', 'Sua marca, suas cores, seu jeito de trabalhar.'],
] as const;

const faq = [
  ['Quanto tempo dura o teste grátis?', 'Um mês calendário a partir do cadastro da empresa (ex.: de 29/10 a 29/11). Se o dia não existir no mês seguinte, termina no último dia desse mês. A data exata aparece em Minha assinatura.'],
  ['Preciso informar cartão?', 'Não. O cadastro e o mês grátis não pedem cartão. Pagamento só depois, ao contratar um plano pela InfinitePay (Pix ou cartão).'],
  ['O que acontece depois de um mês?', 'Você recebe avisos 7, 3 e 1 dia antes e no último dia. Para continuar, contrate o plano. Sem contratação, o acesso fica somente leitura após 5 dias de tolerância. Seus dados não são apagados.'],
  ['Posso pedir mais tempo de teste?', 'Sim, fale com o suporte. Prorrogações são concedidas pela equipe PISTEC e ficam registradas.'],
  ['Posso conhecer antes de contratar?', 'Sim. A demonstração usa dados fictícios e permite escolher empresa e perfil, sem senha ou cobrança.'],
  ['Os dados ficam onde?', 'Na conta real, em servidor na nuvem (Supabase) com isolamento por empresa. A demonstração é separada: usa dados fictícios salvos só no seu navegador e não envia nada.'],
  ['Há emissão fiscal ou pagamento real?', 'O PISTEC não emite nota fiscal. A assinatura do plano é cobrada pela InfinitePay (Pix ou cartão) somente após a contratação. Na demonstração nada é cobrado ou enviado.'],
  ['Como funciona a contratação e periodicidade?', 'Os planos têm preços totais por período (mensal, trimestral ou anual com desconto). O total e o equivalente mensal são detalhados antes do cadastro.'],
  ['Minha empresa pode ter filiais e marca própria?', 'Sim. O PISTEC suporta filiais com controle de estoque independente e personalização completa de logo, cores e tema por empresa.'],
  ['O sistema roda em nuvem?', 'Sim. A conta real funciona no navegador e como aplicativo instalável (PWA), com os dados no servidor. A venda no PDV exige conexão para ser registrada.'],
];

function Screenshot({ name, title, hero = false }: { name: string; title: string; hero?: boolean }) {
  const [failed, setFailed] = useState(false);
  return <figure className={`pub-shot ${hero ? 'pub-shot-hero' : ''}`}>
    <div className="pub-window"><span/><span/><span/><small>PISTEC / {title}</small><span className="pub-demo-label">DEMONSTRAÇÃO</span></div>
    {failed ? <div className="pub-shot-fallback"><img src="/brand/symbol.webp" alt="" width="72" height="72"/><strong>{title}</strong><p>Captura real em preparação.</p><Link to="/demonstracao">Explorar a demonstração <ArrowRight size={16}/></Link></div> :
      <img src={`/screenshots/${name}.webp`} alt={`Tela demonstrativa de ${title} no PISTEC`} loading={hero ? 'eager' : 'lazy'} fetchPriority={hero ? 'high' : 'auto'} width="1440" height="900" onError={() => setFailed(true)}/>}
  </figure>;
}

const PLAN_FOR: Record<string, string> = {
  essencial: 'Gestão do dia a dia: balcão, estoque, clientes e financeiro.',
  profissional: 'Oficinas: ordens de serviço, orçamentos, agenda, compras e WhatsApp.',
  premium: 'Operação completa com CRM, automações, IA ampliada e até 3 filiais.',
  enterprise: 'Redes e operações maiores, com limites dedicados e implantação assistida.',
};
const CATEGORIES = ['Gestão comercial', 'Oficina', 'Inteligência', 'Relacionamento', 'Administração'] as const;
const qty = (n: number, one: string, many: string) => `${n.toLocaleString('pt-BR')} ${n === 1 ? one : many}`;

function FeatureBadge({ status }: { status: Feature['status'] }) {
  return status === 'disponivel' ? null : <span className={`pub-badge pub-badge-${status}`}>{STATUS_LABEL[status]}</span>;
}

function Pricing({ compact = false }: { compact?: boolean }) {
  const catalog = useCatalog();
  const [period, setPeriod] = useState<Period>('monthly');
  const [compare, setCompare] = useState<[string, string]>(['profissional', 'premium']);
  const plans = catalog.plans, feature = (key: string) => catalog.features.find(f => f.key === key);
  const added = (i: number) => plans[i].features.filter(k => i === 0 || !plans[i - 1].features.includes(k));
  return <section className="pub-section" id="planos">
    <div className="pub-section-heading">
      <span className="pub-eyebrow">PLANOS PISTEC</span>
      {compact ? <h2>Escolha o plano ideal para o seu negócio.</h2> : <h1>Escolha o plano ideal para o seu negócio.</h1>}
      <p>Comece com 1 mês grátis e escolha os recursos que acompanham o crescimento da sua empresa. O valor mostrado é o total cobrado em cada período.</p>
    </div>
    <div className="pub-periods" role="group" aria-label="Periodicidade da cobrança">
      {Object.entries(periods).map(([key, value]) => <button key={key} aria-pressed={period === key} onClick={() => setPeriod(key as Period)}>{value.label}</button>)}
    </div>
    <div className="pub-plan-grid">
      {plans.map((plan, i) => {
        const price = planPrice(plan, period), savings = planSavings(plan, period), enterprise = !plan.selfService, featured = plan.id === 'profissional';
        return <article className={`pub-plan ${featured ? 'pub-plan-featured' : ''}`} key={plan.id}>
          {featured && <span className="pub-plan-flag">RECOMENDADO PARA OFICINAS</span>}
          <h3>{plan.name}</h3>
          <p className="pub-plan-for">{PLAN_FOR[plan.id] ?? ''}</p>
          {enterprise ? <>
            <div className="pub-price"><small>Sob consulta</small></div>
            <p className="pub-plan-period">Referência: {money(plan.monthly)}/mês. Limites e implantação definidos em proposta.</p>
          </> : <>
            <div className="pub-price">{money(price.total)}<small>{period === 'monthly' ? '/mês' : period === 'quarterly' ? '/trimestre' : '/ano'}</small></div>
            <p className="pub-plan-period">{period === 'monthly' ? 'Cobrança mensal.' : `Cobrança única por ${periods[period].label.toLowerCase()} · equivale a ${money(price.monthly)}/mês.`}</p>
            {savings > 0 && <span className="pub-plan-economy">{savings}% a menos que {periods[period].months} meses no plano mensal</span>}
          </>}
          <p className="pub-plan-trial">{trialLabel(plan.trialMonths ?? 1)} para empresas novas</p>
          {enterprise ?
            <Link className="pub-button pub-button-outline" to="/contato">Falar com consultor<ArrowRight size={16}/></Link> :
            <a className={`pub-button ${featured ? '' : 'pub-button-outline'}`} href={`/app/contratar/${encodeURIComponent(plan.id)}?periodo=${period}`}>Começar com o {plan.name}<ArrowRight size={16}/></a>}
          <ul className="pub-plan-limits">
            <li><Check size={16}/>{qty(plan.users, 'usuário', 'usuários')}</li>
            <li><Check size={16}/>{qty(plan.branches, 'filial', 'filiais')} com estoque próprio</li>
            <li><Check size={16}/>{qty(plan.products, 'produto', 'produtos')} no catálogo</li>
            <li><Check size={16}/>{qty(plan.whatsapp, 'número', 'números')} de WhatsApp</li>
            <li>{plan.aiMessages ? <><Check size={16}/>{qty(plan.aiMessages, 'resposta', 'respostas')} de IA por dia</> : <><X size={16}/>Sem recursos de IA</>}</li>
          </ul>
          <p className="pub-plan-includes">{i === 0 ? 'Inclui' : added(i).length ? `Tudo do ${plans[i - 1].name}, mais` : `Todos os recursos do ${plans[i - 1].name}, com limites maiores`}</p>
          <ul>{added(i).slice(0, 8).map(k => <li key={k}><Check size={16}/>{feature(k)?.name}<FeatureBadge status={feature(k)?.status ?? 'disponivel'}/></li>)}
            {added(i).length > 8 && <li className="pub-plan-more">+ {added(i).length - 8} recursos na comparação</li>}</ul>
          {!enterprise && <small className="pub-plan-note">Você confere o contrato e o resumo antes de qualquer cobrança.</small>}
        </article>;
      })}
    </div>
    {!plans.length && <Empty text="Planos ainda não cadastrados."/>}
    {!compact && plans.length > 0 && <div className="pub-compare">
      <div className="pub-section-heading">
        <span className="pub-eyebrow">COMPARAÇÃO COMPLETA</span>
        <h2>Compare recursos e limites</h2>
        <p>Recursos marcados com “Requer configuração” dependem de você conectar o serviço (ex.: número de WhatsApp). “Em homologação” ainda não está liberado para uso.</p>
      </div>
      <div className="pub-compare-pick" role="group" aria-label="Planos comparados no celular">
        {[0, 1].map(slot => <label key={slot}><span>Plano {slot + 1}</span><select value={compare[slot]} onChange={e => setCompare(c => slot === 0 ? [e.target.value, c[1]] : [c[0], e.target.value])}>{plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
      </div>
      <div className="table-wrap pub-compare-table">
        <table>
          <caption>Recursos e limites por plano (dados do catálogo oficial)</caption>
          <thead><tr><th scope="col">Recurso</th>{plans.map(p => <th scope="col" key={p.id} data-plan={p.id} className={compare.includes(p.id) ? 'is-picked' : ''}>{p.name}</th>)}</tr></thead>
          <tbody>
            <tr className="pub-compare-group"><th scope="rowgroup" colSpan={5}>Limites</th></tr>
            {([['Usuários', 'users'], ['Filiais', 'branches'], ['Produtos no catálogo', 'products'], ['Números de WhatsApp', 'whatsapp'], ['Respostas de IA por dia', 'aiMessages']] as const).map(([label, key]) => <tr key={key}>
              <th scope="row">{label}</th>{plans.map(p => <td key={p.id} className={compare.includes(p.id) ? 'is-picked' : ''}>{p[key] ? p[key].toLocaleString('pt-BR') : '—'}</td>)}</tr>)}
            <tr><th scope="row">Teste grátis</th>{plans.map(p => <td key={p.id} className={compare.includes(p.id) ? 'is-picked' : ''}>{trialLabel(p.trialMonths ?? 1)}</td>)}</tr>
            {CATEGORIES.map(cat => <Fragment key={cat}>
              <tr className="pub-compare-group"><th scope="rowgroup" colSpan={5}>{cat}</th></tr>
              {catalog.features.filter(f => f.category === cat).map(f => <tr key={f.key}>
                <th scope="row">{f.name}<FeatureBadge status={f.status}/></th>
                {plans.map(p => <td key={p.id} className={compare.includes(p.id) ? 'is-picked' : ''}>{p.features.includes(f.key) ? <><Check size={16} aria-hidden="true"/><span className="sr-only">Incluído</span></> : <span aria-label="Não incluído">—</span>}</td>)}
              </tr>)}
            </Fragment>)}
          </tbody>
        </table>
      </div>
      <p className="pub-compare-note">Não há armazenamento, IA ou WhatsApp ilimitados: os limites acima são aplicados pelo servidor. Mudanças de plano preservam os dados da empresa.</p>
    </div>}
  </section>;
}

function FAQ() {
  return <section className="pub-section pub-faq">
    <div><span className="pub-eyebrow">TRANSPARÊNCIA TOTAL</span><h2>Perguntas frequentes.<br/>Respostas sem rodeios.</h2><p>Tudo o que você precisa saber sobre a demonstração, planos e arquitetura da plataforma.</p></div>
    <div>{faq.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div>
  </section>;
}

/** Contato comercial: enviado ao servidor (submit_lead → Super Admin). Recuperação de acesso real é feita em /app/recuperar. */
function LeadForm() {
  const action = useAction(); const [sent, setSent] = useState(false);
  const [phone, setPhone] = useState('');
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget);
    void action.run(async () => {
      const contact = email(String(form.get('email') ?? ''));
      if (form.get('consent') !== 'on') throw new Error('Confirme o aviso de privacidade.');
      const name = required(String(form.get('name') ?? ''), 'Nome');
      const message = String(form.get('message') ?? '').trim();
      if (message.length > 2000) throw new Error('Mensagem limitada a 2000 caracteres.');
      const { supabase } = await import('../../real/client');
      const { error } = await supabase.rpc('submit_lead', { p: { name, email: contact, phone: phoneDigits(phone), company: String(form.get('company') ?? ''), message } });
      if (error) throw new Error(error.message.includes('Muitas') ? error.message : 'Não foi possível enviar agora. Tente novamente ou escreva para pistec.gestao@gmail.com.');
      setSent(true);
    }, 'Mensagem enviada à equipe PISTEC.');
  }
  if (sent) return <div className="pub-success" role="status"><ShieldCheck size={40}/><h2>Vamos dar o próximo passo.</h2><p>Recebemos sua mensagem. A equipe PISTEC responde pelo e-mail ou telefone informado.</p><Link className="pub-button" to="/demonstracao">Acessar demonstração<ArrowRight size={18}/></Link></div>;
  return <form className="pub-form" onSubmit={submit}>
    <Field label="Seu nome"><input name="name" required maxLength={120} autoComplete="name"/></Field><Field label="Empresa"><input name="company" maxLength={160} autoComplete="organization"/></Field>
    <Field label="E-mail"><input name="email" type="email" required maxLength={254} autoComplete="email"/></Field>
    <Field label="Telefone com DDD (opcional)" hint="Formato: (00) 00000-0000"><input name="phone" type="tel" maxLength={16} value={phone} onChange={e => setPhone(maskPhone(e.target.value))} autoComplete="tel"/></Field>
    <Field label="Como podemos ajudar sua operação?"><textarea name="message" rows={4} maxLength={2000}/></Field>
    <label className="pub-check"><input name="consent" type="checkbox" required/><span>Li a <Link to="/privacidade">política de privacidade</Link> e autorizo o contato da equipe PISTEC.</span></label>
    {action.error && <p role="alert" className="pub-error">{action.error}</p>}
    <button className="pub-button" disabled={action.pending}>{action.pending ? 'Enviando…' : 'Enviar mensagem'}<ArrowRight size={18}/></button>
  </form>;
}

function DemoChooser() {
  const { state, setSession } = useDemo(); const navigate = useNavigate(); const action = useAction();
  const [tenantId, setTenantId] = useState(''); const [role, setRole] = useState<Role>('Proprietário');
  const selectedId = tenantId || state.tenants[0]?.id || '';
  function enter() {
    void action.run(() => {
      const tenant = state.tenants.find(item => item.id === selectedId);
      const branch = state.branches.find(item => item.tenantId === selectedId && item.active);
      if (!tenant || !branch) throw new Error('Empresa sem filial ativa. Escolha outra demonstração.');
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
      {action.error && <p role="alert" className="pub-error">{action.error}</p>}
      <a href="/app/recuperar">Esqueci a senha da conta real</a>
      <Link to="/cadastro">Criar uma empresa demonstrativa</Link>
      <a href="/app/login">Entrar em uma conta real</a>
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
    planId: params.get('plano') || '',
    period: (Object.keys(periods).includes(params.get('periodo') || '') ? params.get('periodo') : 'monthly') as Period,
    primary: '#16c7e8', secondary: '#102440', accent: '#38d4ec', logo: '',
  });
  const [address, setAddress] = useState<Address>(emptyAddress);
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
      Object.assign(errs, addressErrors(address));
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
        draft.records.push(platformRecord(uid(), 'admin-onboarding', `Cadastro: ${created.name}`, { tenantId: created.id, cep: address.zip.replace(/\D/g, ''), street: address.street, number: address.number, complement: address.complement, district: address.district, city: address.city, region: address.state, period: data.period, consent: new Date().toISOString(), termsVersion: 'demo-1', total: String(planPrice(plan, data.period).total) }));
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
        <p className="pub-callout">A consulta de CEP é real (ViaCEP, com BrasilAPI de reserva). A empresa criada aqui continua sendo uma demonstração salva só neste navegador.</p>
        <BrazilianAddressFields legend="Endereço da empresa" value={address} errors={errors} disabled={action.pending}
          onChange={next => { setAddress(next); setErrors(cur => { const n = { ...cur }; for (const k of ['zip', 'street', 'number', 'district', 'city', 'state']) delete n[k]; return n; }); }}/>
      </>}
      {step === 3 && <>
        <Field label="Plano" error={errors.planId}><select required value={plan?.id || ''} onChange={event => change('planId', event.target.value)}>{!plan && <option value="">Sem planos disponíveis</option>}{state.plans.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
        <Field label="Periodicidade"><select value={data.period} onChange={event => change('period', event.target.value)}>{Object.entries(periods).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}</select></Field>
        {plan && <p className="pub-callout">{money(planPrice(plan, data.period).total)} / período ({periods[data.period].label.toLowerCase()}) · {trialLabel(plan.trialMonths ?? 1)} (demonstração, sem cobrança).</p>}
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
          <dt>Endereço</dt><dd>{formatAddress(address)}</dd>
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
    <h1>{privacy ? 'Privacidade' : 'Termos de uso'}</h1>
    <p>Atualizado em {date(today())}. A contratação do PISTEC é regida pelo contrato aceito e assinado eletronicamente na escolha do plano; este resumo não o substitui.</p>
    {(privacy ? [
      ['Conta real', 'Os dados da empresa ficam em servidor na nuvem (Supabase), isolados por empresa e por permissão de cada usuário. A equipe PISTEC não acessa o conteúdo operacional das oficinas sem necessidade de suporte.'],
      ['Serviços utilizados', 'Hospedagem (Vercel), banco e autenticação (Supabase), e-mail (Resend), WhatsApp (Evolution API, quando a loja conecta o próprio número), IA (Google Gemini, quando habilitada, com dados mínimos), cobrança da assinatura (InfinitePay) e assinatura de contrato (Autentique).'],
      ['Clientes das oficinas', 'Mensagens só são enviadas a clientes que autorizaram o contato. Links de orçamento e acompanhamento têm validade e podem ser revogados pela oficina.'],
      ['Demonstração', 'A demonstração usa dados fictícios salvos apenas no seu navegador e não envia mensagens, e-mails ou cobranças. Não informe dados reais nela.'],
    ] : [
      ['Finalidade', 'Sistema de gestão para oficinas, motopeças e autopeças: PDV, estoque, ordens de serviço, financeiro e relacionamento, com acesso por perfil.'],
      ['Teste e cobrança', 'Novas empresas têm 1 mês grátis, sem cartão. Depois, a assinatura é cobrada pela InfinitePay conforme o plano e a periodicidade contratados.'],
      ['Responsabilidade fiscal', 'O PISTEC não emite nota fiscal; recibos e documentos gerados não têm validade fiscal.'],
      ['Demonstração', 'A demonstração é isolada da conta real e tem fins de avaliação; operações nela não têm efeito externo.'],
    ]).map(([title, text]) => <article key={title}><h2>{title}</h2><p>{text}</p></article>)}
    <Link to="/contato" className="pub-button pub-button-outline">Falar com a equipe</Link>
  </section>;
}

function PlanTag({ catalog, featureKey }: { catalog: ReturnType<typeof useCatalog>; featureKey: string }) {
  const first = catalog.plans.find(p => p.features.includes(featureKey)); const f = catalog.features.find(x => x.key === featureKey);
  return <span className="pub-plan-tag">{first ? `A partir do ${first.name}` : 'Sob consulta'}{f && f.status !== 'disponivel' && ` · ${STATUS_LABEL[f.status]}`}</span>;
}

function Marketing({ path }: { path: string }) {
  const catalog = useCatalog();
  const segment = SEGMENTS.find(s => s.path === path);
  const [active, setActive] = useState(0); const item = NEXT_SHOWCASE[active];
  return <>
    <section className="pub-hero">
      <div className="pub-hero-copy">
        <span className="pub-eyebrow"><span className="pub-status-dot"/> GESTÃO AUTOMOTIVA INTELIGENTE</span>
        <h1>{segment ? <>{segment.title}<br/><em>com gestão de verdade.</em></> : <>Sua oficina mais inteligente.<br/><em>Seu negócio sob controle.</em></>}</h1>
        <p>{segment ? segment.text : 'Vendas, estoque, ordens de serviço, clientes e financeiro em um só lugar. Ferramentas inteligentes apontam o que precisa de atenção, e a sua equipe decide.'}</p>
        <div className="pub-actions">
          <Link className="pub-button" to="/planos">Começar meu mês grátis<ArrowRight size={18}/></Link>
          <Link className="pub-button pub-button-outline" to="/demonstracao">Ver demonstração</Link>
        </div>
        <p className="pub-trial-offer">1 mês calendário grátis para empresas novas. Sem cartão no cadastro.</p>
        <ul className="pub-hero-proof" aria-label="Destaques">
          {['Gestão completa', 'AutoPilot e IA que auxiliam', 'Aprovação pelo celular', 'Computador, tablet e celular', 'Sua marca no sistema'].map(t => <li key={t}><Check size={15}/>{t}</li>)}
        </ul>
      </div>
      <div className="pub-hero-visual">
        <div className="pub-orbit"/>
        <div className="pub-hero-combo">
          <Screenshot name="dashboard" title="Dashboard" hero/>
          <div className="pub-phone-frame" aria-hidden="true"><div className="pub-phone-notch"/><div className="pub-phone-screen"><img src="/screenshots/portal-orcamento.webp" alt="" width="601" height="2000" loading="eager"/></div></div>
        </div>
      </div>
    </section>

    <section className="pub-section" aria-labelledby="para-quem">
      <div className="pub-section-heading"><span className="pub-eyebrow">PARA QUEM É O PISTEC</span><h2 id="para-quem">Um sistema. Do balcão à oficina.</h2>
        <p>Loja e oficina na mesma empresa, com o mesmo cadastro de clientes, peças e financeiro. Você usa os módulos que fazem sentido para a sua operação.</p></div>
      <div className="pub-segment-grid">{SEGMENTS.map(s => <article key={s.path} className={segment?.path === s.path ? 'is-active' : ''}>
        <h3>{s.title}</h3><p>{s.text}</p>
        <ul>{s.keys.map(k => <li key={k}><Check size={15}/>{catalog.features.find(f => f.key === k)?.name}</li>)}</ul>
        <Link to={s.path}>Ver solução para {s.title.toLowerCase()}<ChevronRight size={16}/></Link>
      </article>)}
        <article className="pub-segment-mixed"><h3>Loja e oficina juntas</h3><p>Venda no PDV, abra a OS com as mesmas peças e acompanhe tudo no mesmo financeiro. Sem dois sistemas, sem redigitar.</p><Link to="/planos">Comparar planos<ChevronRight size={16}/></Link></article>
      </div>
    </section>

    <section className="pub-section pub-next" aria-labelledby="next">
      <div className="pub-section-heading"><span className="pub-eyebrow">PISTEC NEXT</span><h2 id="next">Conheça a nova geração de gestão automotiva.</h2>
        <p>Do atendimento à entrega, o PISTEC conecta as atividades da sua empresa e ajuda sua equipe a trabalhar com mais organização.</p></div>
      <div className="pub-next-layout">
        <div className="pub-next-tabs" role="tablist" aria-label="Diferenciais PISTEC NEXT">
          {NEXT_SHOWCASE.map((s, i) => <button key={s.key} role="tab" id={`next-tab-${s.key}`} aria-selected={i === active} aria-controls="next-panel" tabIndex={i === active ? 0 : -1} onClick={() => setActive(i)}
            onKeyDown={e => { if (e.key === 'ArrowDown' || e.key === 'ArrowRight') { e.preventDefault(); setActive((active + 1) % NEXT_SHOWCASE.length); } if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') { e.preventDefault(); setActive((active + NEXT_SHOWCASE.length - 1) % NEXT_SHOWCASE.length); } }}>
            <span>{String(i + 1).padStart(2, '0')}</span>{s.title}</button>)}
        </div>
        <div className="pub-next-panel" role="tabpanel" id="next-panel" aria-labelledby={`next-tab-${item.key}`}>
          <PlanTag catalog={catalog} featureKey={item.key}/>
          <h3>{item.benefit}</h3>
          <p>{item.text}</p>
          <ol className="pub-mini-flow">{item.flow.map(step => <li key={step}>{step}</li>)}</ol>
          <Screenshot key={item.key} name={item.shot} title={item.title}/>
        </div>
      </div>
    </section>

    <section className="pub-section" aria-labelledby="jornada">
      <div className="pub-section-heading"><span className="pub-eyebrow">JORNADA COMPLETA</span><h2 id="jornada">Do primeiro atendimento à próxima revisão.</h2>
        <p>Cada etapa usa os dados da anterior. Exemplo ilustrativo de um atendimento de oficina.</p></div>
      <ol className="pub-journey">{JOURNEY.map((step, i) => <li key={step}><span>{i + 1}</span>{step}</li>)}</ol>
    </section>

    <section className="pub-section pub-split" aria-labelledby="ia">
      <div>
        <span className="pub-eyebrow">INTELIGÊNCIA ARTIFICIAL</span>
        <h2 id="ia">Inteligência que trabalha com você.</h2>
        <ul className="pub-checklist">
          <li><Check size={16}/><span><strong>AutoPilot:</strong> regras da sua empresa apontam atrasos, faltas e pendências.</span></li>
          <li><Check size={16}/><span><strong>Mecânico IA:</strong> fala vira apontamento organizado para revisão.</span></li>
          <li><Check size={16}/><span><strong>Assistente:</strong> perguntas sobre estoque, OS e vendas, somente leitura.</span></li>
        </ul>
        <p className="pub-callout">A IA auxilia; o profissional decide. Operações de estoque, valores e compras sempre pedem confirmação, e a IA não substitui avaliação técnica. Uso diário limitado por plano.</p>
      </div>
      <Screenshot name="mecanico" title="Mecânico IA"/>
    </section>

    <section className="pub-section pub-split" aria-labelledby="whats">
      <Screenshot name="whatsapp" title="WhatsApp"/>
      <div>
        <span className="pub-eyebrow">ATENDIMENTO DIGITAL</span>
        <h2 id="whats">WhatsApp da sua loja dentro do PISTEC.</h2>
        <p>Conecte o número da empresa lendo um QR Code. As conversas ficam organizadas por cliente, com atendimento pela equipe e histórico. Orçamentos e acompanhamento seguem por link seguro.</p>
        <p className="pub-callout">Requer conectar e manter o seu número ativo. A quantidade de números depende do plano. O atendente automático com IA está em homologação e ainda não é oferecido.</p>
      </div>
    </section>

    <section className="pub-section pub-split" aria-labelledby="marca">
      <div>
        <span className="pub-eyebrow">WHITE LABEL E APP</span>
        <h2 id="marca">Seu sistema. Sua marca. Em qualquer dispositivo.</h2>
        <p>Logo, cores e tema da empresa no sistema, nos documentos e no portal do cliente. O PISTEC funciona no navegador do computador, tablet e celular e pode ser instalado como aplicativo (PWA) nos navegadores compatíveis. A identidade visual da sua empresa acompanha a experiência do aplicativo.</p>
        <p className="pub-small">Não é distribuído pela App Store ou Google Play.</p>
      </div>
      <Screenshot name="personalizacao" title="Personalização"/>
    </section>

    <section className="pub-section" aria-labelledby="beneficios">
      <div className="pub-section-heading"><span className="pub-eyebrow">NA PRÁTICA</span><h2 id="beneficios">Antes e depois de organizar a operação.</h2></div>
      <div className="pub-before-after">
        <div><h3>Sem um sistema integrado</h3><ul>{['Informações espalhadas em papel e planilhas', 'Peças sem reserva para a OS', 'Orçamento aprovado por telefone, sem registro', 'Margem de cada serviço desconhecida', 'Cliente esquecido depois da entrega'].map(t => <li key={t}><X size={15}/>{t}</li>)}</ul></div>
        <div><h3>Com o PISTEC</h3><ul>{['Histórico do cliente e do veículo em um lugar', 'Peças reservadas e baixadas pelas etapas da OS', 'Aprovação por item registrada pelo cliente', 'Margem de contribuição por OS', 'Revisões previstas e lembretes'].map(t => <li key={t}><Check size={15}/>{t}</li>)}</ul></div>
      </div>
      <p className="pub-small">Cada operação é diferente; os resultados dependem do uso da ferramenta pela equipe.</p>
    </section>

    <section className="pub-section pub-gallery" aria-labelledby="telas">
      <div className="pub-section-heading"><span className="pub-eyebrow">TELAS REAIS</span><h2 id="telas">Veja o sistema por dentro.</h2><p>Capturas da demonstração, com dados fictícios.</p></div>
      <div className="pub-gallery-grid">{modules.map(([slug, title, text]) => <article key={slug}><Screenshot name={slug} title={title}/><h3>{title}</h3><p>{text}</p></article>)}</div>
    </section>

    <Pricing compact/>
    <FAQ/>

    <section className="pub-cta">
      <img src="/brand/symbol.webp" alt="" width="80" height="80" loading="lazy"/>
      <span className="pub-eyebrow">COMECE HOJE</span>
      <h2>Experimente o PISTEC por 1 mês, sem cartão.</h2>
      <div className="pub-actions" style={{ justifyContent: 'center' }}>
        <Link className="pub-button" to="/planos">Começar meu mês grátis<ArrowRight size={18}/></Link>
        <Link className="pub-button pub-button-outline" to="/demonstracao">Ver demonstração</Link>
      </div>
    </section>
  </>;
}

export default function Public() {
  const location = useLocation(); const path = location.pathname.replace(/\/+$/, '') || '/'; const [menu, setMenu] = useState(false);
  useEffect(() => {
    setMenu(false);
    const segment = SEGMENTS.find(s => s.path === path);
    document.title = `PISTEC — ${path === '/' ? 'Gestão Automotiva Inteligente' : segment ? `Sistema para ${segment.title.toLowerCase()}` : ({ '/planos': 'Planos e preços', '/funcionalidades': 'Funcionalidades', '/cadastro': 'Criar empresa', '/login': 'Acesso demonstrativo', '/demonstracao': 'Demonstração', '/contato': 'Contato', '/termos': 'Termos de uso', '/privacidade': 'Privacidade', '/licenca-perpetua': 'Licença perpétua' }[path] || 'Seu negócio à frente')}`;
    // SPA: meta por rota para buscadores que executam JS; cadastro/login/contrato ficam fora do índice.
    const meta = (sel: string, attr: string, value: string) => document.head.querySelector(sel)?.setAttribute(attr, value);
    meta('link[rel=canonical]', 'href', `https://pistec.com.br${path === '/' ? '/' : path}`);
    meta('meta[property="og:url"]', 'content', `https://pistec.com.br${path === '/' ? '/' : path}`);
    meta('meta[property="og:title"]', 'content', document.title);
    meta('meta[name=description]', 'content', segment ? `PISTEC para ${segment.title.toLowerCase()}: ${segment.text}` : path === '/planos' ? 'Planos Essencial, Profissional, Premium e Enterprise com 1 mês grátis. Compare recursos, limites e valores por período.'
      : 'Sistema de gestão para oficinas mecânicas, oficinas de motos, motopeças e autopeças: PDV, estoque, ordens de serviço, orçamentos, clientes e financeiro. 1 mês grátis.');
    let robots = document.head.querySelector('meta[name=robots]');
    if (!robots) { robots = document.createElement('meta'); robots.setAttribute('name', 'robots'); document.head.append(robots); }
    robots.setAttribute('content', ['/cadastro', '/login', '/contrato', '/recuperar-acesso'].includes(path) ? 'noindex, follow' : 'index, follow');
    window.scrollTo(0, 0);
  }, [path]);

  let content;
  if (['/login', '/demonstracao'].includes(path)) content = <DemoChooser/>;
  else if (path === '/cadastro') content = <Onboarding/>;
  else if (path === '/planos') content = <><Pricing/><FAQ/></>;
  else if (path === '/recuperar-acesso') content = <Navigate to="/contato" replace/>;
  else if (path === '/contato') content = <section className="pub-section pub-split">
    <div>
      <span className="pub-eyebrow">ATENDIMENTO COMERCIAL</span>
      <h1>O próximo capítulo<br/>da sua gestão.</h1>
      <p>Conte-nos sobre sua operação e objetivos. A mensagem chega à equipe PISTEC.</p>
      <Link to="/demonstracao" className="pub-button pub-button-outline">Abrir demonstração<ChevronRight size={16}/></Link>
    </div>
    <LeadForm/>
  </section>;
  else if (path === '/termos' || path === '/privacidade') content = <Legal privacy={path === '/privacidade'}/>;
  else if (path === '/contrato') content = <Navigate to="/planos" replace/>;
  else if (path === '/licenca-perpetua') content = <section className="pub-section pub-split">
    <div>
      <span className="pub-eyebrow">MODALIDADE CORPORATIVA</span>
      <h1>Licença perpétua.<br/><em>Vamos avaliar juntos.</em></h1>
      <p>Modalidade sob medida para redes que demandam infraestrutura proprietária ou implantação on-premise. Escopo, suporte e SLA definidos em proposta dedicada.</p>
      <Link to="/planos" className="pub-button pub-button-outline">Comparar planos SaaS</Link>
    </div>
    <LeadForm/>
  </section>;
  else if (['/', '/funcionalidades', '/oficinas', '/oficinas-de-motos', '/motopecas', '/autopecas'].includes(path)) content = <Marketing path={path}/>;
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
        {[['/funcionalidades', 'Funcionalidades'], ['/oficinas', 'Oficinas'], ['/oficinas-de-motos', 'Motos'], ['/motopecas', 'Motopeças'], ['/autopecas', 'Autopeças'], ['/planos', 'Planos'], ['/contato', 'Contato']].map(([href, title]) => <Link aria-current={path === href ? 'page' : undefined} to={href} key={href}>{title}</Link>)}
        <Link to="/login" className="pub-login">Entrar</Link>
        <Link className="pub-button pub-button-small" to="/demonstracao">Ver demonstração<ArrowRight size={15}/></Link>
      </nav>
    </header>
    <main id="public-main" tabIndex={-1}>{content}</main>
    <footer className="pub-footer">
      <div>
        <Link to="/" className="pub-brand"><img src="/brand/logo-horizontal.webp" alt="PISTEC" width="170" height="48"/></Link>
        <p>Tecnologia e controle para quem mantém o mercado automotivo em movimento.</p>
        <small>Gestão automotiva em nuvem. A demonstração usa dados fictícios no seu navegador.</small>
      </div>
      <div><h3>Produto</h3><Link to="/funcionalidades">Funcionalidades</Link><Link to="/planos">Planos SaaS</Link><Link to="/licenca-perpetua">Licença perpétua</Link><Link to="/demonstracao">Demonstração</Link></div>
      <div><h3>Soluções</h3><Link to="/oficinas">Oficinas mecânicas</Link><Link to="/oficinas-de-motos">Oficinas de motos</Link><Link to="/motopecas">Motopeças</Link><Link to="/autopecas">Autopeças</Link><Link to="/cadastro">Criar empresa</Link></div>
      <div><h3>Transparência</h3><Link to="/contato">Contato comercial</Link><Link to="/termos">Termos de uso</Link><Link to="/privacidade">Privacidade</Link></div>
      <div className="pub-footer-bottom">
        <span>© {new Date().getFullYear()} PISTEC Gestão Automotiva. Todos os direitos reservados.</span>
        <span>Tecnologia automotiva descomplicada.</span>
      </div>
    </footer>
  </div>;
}
