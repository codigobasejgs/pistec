import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { z } from 'zod';
import { rpc, useDemo } from '../store';
import { Button, Field, PageHeader, Panel } from '../ui';
import { date, money } from '../lib';
import type { Tenant } from '../types';
import { searchHelp } from '../features/settings/help';
import { supabase } from './client';
import { integer } from './read';

const noDemo = (): never => { throw new Error('Operação disponível somente no ambiente real.'); };
const roles = ['Administrador', 'Gerente', 'Vendedor', 'Caixa', 'Estoquista', 'Mecânico', 'Atendente', 'Financeiro'] as const;
const periodSchema = z.enum(['monthly', 'quarterly', 'annual']);
const periods = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };
const cents = z.union([z.number(), z.string()]).transform(integer).refine(n => n >= 0);
const subscriptionSchema = z.object({ plan_id: z.string(), period: periodSchema, status: z.string(), current_period_end: z.string(), cancel_at_period_end: z.boolean() });
const invoiceSchema = z.object({ id: z.string().uuid(), plan_id: z.string(), period: periodSchema, amount: cents, discount: cents, status: z.string(), due_date: z.string(), provider: z.string() });
const memberSchema = z.object({ id: z.string().uuid(), user_id: z.string().uuid(), role: z.string(), active: z.boolean(), branch_ids: z.array(z.string().uuid()).nullable() });
const inviteSchema = z.object({ id: z.string().uuid(), email: z.string(), role: z.string(), expires_at: z.string(), accepted_at: z.string().nullable(), revoked_at: z.string().nullable() });
const quoteSchema = z.object({ original: cents, discount: cents, total: cents });
const message = (error: unknown) => error instanceof z.ZodError ? 'Resposta inválida do servidor. Recarregue antes de continuar.' : error instanceof Error ? error.message : 'Não foi possível concluir. Tente novamente.';

// Repetições, remontagens e retorno do checkout reutilizam a mesma chave por intenção.
export function invoiceRequestId(scope: string, storage?: Storage): string {
  const key = `pistec-invoice-request:${scope}`;
  try {
    storage ??= window.sessionStorage;
    const previous = storage.getItem(key);
    if (previous) return z.string().uuid().parse(previous);
    const id = crypto.randomUUID();
    storage.setItem(key, id);
    return id;
  } catch { throw new Error('Armazenamento de sessão indisponível. Nenhuma nova fatura foi solicitada.'); }
}

export function checkoutUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Checkout sem endereço válido.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Endereço de checkout inválido.'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('O checkout exige um endereço HTTPS sem credenciais.');
  return url.href;
}

export function invitationUrl(origin: string, token: unknown): string {
  if (typeof token !== 'string' || !/^[a-f0-9]{48}$/.test(token)) throw new Error('Convite retornado sem token válido.');
  const base = new URL(checkoutUrl(origin));
  return `${base.origin}/app/convite/${token}`;
}

export async function openInvoiceCheckout(invoiceId: string): Promise<'awaiting'> {
  z.string().uuid().parse(invoiceId);
  const { data, error } = await supabase.functions.invoke('billing-checkout', { body: { invoiceId } });
  if (error) throw new Error('Checkout indisponível. A fatura permanece sem confirmação de pagamento.');
  const result = z.object({ url: z.string().nullish(), status: z.string().optional() }).parse(data);
  if (result.url) window.location.assign(checkoutUrl(result.url));
  else if (result.status !== 'awaiting') throw new Error('Checkout ainda não disponibilizou um endereço. Tente novamente mais tarde.');
  return 'awaiting'; // Retorno do navegador nunca confirma pagamento.
}

async function scopedRows<T>(table: string, columns: string, tenantId: string, schema: z.ZodType<T>): Promise<T[]> {
  const result: T[] = [];
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from(table).select(columns).eq('tenant_id', tenantId).order('id').range(offset, offset + 499);
    if (error) throw new Error(error.message);
    const page = z.array(schema).parse(data);
    result.push(...page);
    if (page.length < 500) return result;
  }
}

function useLoad<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setData(null);
    void load().then(value => { if (active) setData(value); }).catch(e => { if (active) setError(message(e)); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [load, revision]);
  return { data, error, loading, refresh: () => setRevision(n => n + 1) };
}

function useTask() {
  const lock = useRef(false), alive = useRef(true);
  const [pending, setPending] = useState(false), [error, setError] = useState(''), [status, setStatus] = useState('');
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function run(action: () => Promise<void>, success: string) {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(''); setStatus('');
    try { await action(); if (alive.current) setStatus(success); }
    catch (e) { if (alive.current) setError(message(e)); }
    finally { lock.current = false; if (alive.current) setPending(false); }
  }
  return { pending, run, feedback: <>{error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{pending ? 'Processando…' : status}</p></> };
}

function Loaded({ loading, error, refresh, children }: { loading: boolean; error: string; refresh: () => void; children: ReactNode }) {
  if (loading) return <p role="status">Carregando dados da empresa…</p>;
  if (error) return <><p role="alert">{error}</p><Button onClick={refresh}>Tentar novamente</Button></>;
  return <>{children}</>;
}

function IntegrationStatus() {
  return <Panel title="Integrações"><p role="status">Integração pendente de verificação.</p><p>Esta tela não confirma configuração, conectividade nem envio de mensagens. O checkout depende do serviço de cobrança; pagamento só é confirmado pelo servidor.</p></Panel>;
}

function Company({ tenant }: { tenant: Tenant }) {
  const { perform, session } = useDemo(), task = useTask();
  const [company, setCompany] = useState({ name: tenant.name, legalName: tenant.legalName, document: tenant.document, email: tenant.email, notes: tenant.notes });
  const allowed = ['Proprietário', 'Administrador'].includes(session.role);
  return <><PageHeader title="Configurações" subtitle="Dados reais da empresa."/><Panel title="Dados empresariais"><form className="stack" onSubmit={e => {
    e.preventDefault();
    void task.run(async () => {
      const p = { ...company, name: company.name.trim(), email: company.email.trim().toLowerCase() };
      if (!p.name || !z.string().email().safeParse(p.email).success) throw new Error('Informe nome e e-mail válidos.');
      await perform(noDemo, rpc('update_tenant_profile', { p_tenant: tenant.id, p }));
    }, 'Dados da empresa atualizados.');
  }}><fieldset disabled={!allowed || task.pending}><legend>Identificação da empresa</legend><div className="form-grid">
    {([['name', 'Nome fantasia', 120], ['legalName', 'Razão social', 160], ['document', 'CNPJ', 30], ['email', 'E-mail da empresa', 254]] as const).map(([key, label, max]) => <Field key={key} label={label}><input type={key === 'email' ? 'email' : 'text'} required={key === 'name' || key === 'email'} maxLength={max} value={company[key]} onChange={e => setCompany(c => ({ ...c, [key]: e.target.value }))}/></Field>)}
  </div><Field label="Observações operacionais"><textarea maxLength={2000} value={company.notes} onChange={e => setCompany(c => ({ ...c, notes: e.target.value }))}/></Field><Button type="submit" variant="primary" loading={task.pending}>Salvar configurações</Button></fieldset>{!allowed && <p>Somente proprietário ou administrador pode editar.</p>}{task.feedback}</form></Panel><IntegrationStatus/></>;
}

function Subscription({ tenant }: { tenant: Tenant }) {
  const { state, session, perform } = useDemo(), task = useTask();
  const [planId, setPlanId] = useState(tenant.planId), [period, setPeriod] = useState<z.infer<typeof periodSchema>>('monthly'), [coupon, setCoupon] = useState('');
  const [quote, setQuote] = useState<z.infer<typeof quoteSchema> | null>(null);
  const allowed = ['Proprietário', 'Administrador'].includes(session.role);
  const load = useCallback(async () => {
    const [subscription, invoices] = await Promise.all([
      supabase.from('subscriptions').select('plan_id,period,status,current_period_end,cancel_at_period_end').eq('tenant_id', tenant.id).maybeSingle(),
      scopedRows('billing_invoices', 'id,plan_id,period,amount,discount,status,due_date,provider', tenant.id, invoiceSchema),
    ]);
    if (subscription.error) throw new Error(subscription.error.message);
    return { subscription: subscriptionSchema.nullable().parse(subscription.data), invoices };
  }, [tenant.id]);
  const read = useLoad(load), selected = state.plans.find(p => p.id === planId);
  const code = coupon.trim().replace(/\s+/g, '').toUpperCase();
  const input = { p_tenant: tenant.id, p_plan: planId, p_period: period };
  return <><PageHeader title="Minha assinatura" subtitle="Cobrança da assinatura PISTEC, separada das vendas da loja."><Button disabled={read.loading || task.pending} onClick={read.refresh}>Atualizar status</Button></PageHeader>
    <Loaded {...read}>{read.data && <>
      <Panel title="Assinatura atual">{read.data.subscription ? <><p>Plano: {state.plans.find(p => p.id === read.data?.subscription?.plan_id)?.name ?? read.data.subscription.plan_id}</p><p>Status: {read.data.subscription.status} · {periods[read.data.subscription.period]}</p><p>Fim do período: {date(read.data.subscription.current_period_end)}</p>{read.data.subscription.cancel_at_period_end && <p>Cancelamento agendado para o fim do período.</p>}</> : <p role="status">Nenhuma assinatura encontrada para esta empresa.</p>}</Panel>
      <Panel title="Solicitar fatura"><p>Gerar uma fatura não paga nem altera o plano. A confirmação depende do servidor.</p><form className="stack" onSubmit={e => {
        e.preventDefault();
        void task.run(async () => {
          if (!selected) throw new Error('Selecione um plano disponível.');
          const scope = JSON.stringify([tenant.id, planId, period, code, read.data?.subscription?.current_period_end ?? null]);
          const id = await perform<unknown>(noDemo, rpc('request_subscription_invoice', { ...input, p_coupon: code, p_request_id: invoiceRequestId(scope) }));
          z.string().uuid().parse(id);
          read.refresh();
        }, 'Fatura solicitada. Aguardando pagamento confirmado pelo servidor.');
      }}><fieldset disabled={!allowed || task.pending}><legend>Plano e cobrança</legend><div className="form-grid">
        <Field label="Plano"><select required value={planId} onChange={e => { setPlanId(e.target.value); setQuote(null); }}><option value="">Selecione</option>{state.plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>
        <Field label="Periodicidade"><select value={period} onChange={e => { setPeriod(periodSchema.parse(e.target.value)); setQuote(null); }}>{Object.entries(periods).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        <Field label="Cupom (opcional)"><input maxLength={30} value={coupon} onChange={e => { setCoupon(e.target.value); setQuote(null); }}/></Field>
      </div>{selected ? <p>Preço de catálogo: {money(selected[period])}</p> : <p role="status">Plano não disponível no catálogo.</p>}
      <Button disabled={!selected} onClick={() => void task.run(async () => {
        setQuote(null);
        setQuote(quoteSchema.parse(await perform<unknown>(noDemo, rpc('quote_coupon', { ...input, p_code: code }))));
      }, 'Cotação consultada. O servidor revalida o desconto ao gerar a fatura.')}>Consultar desconto</Button>
      {quote && <p role="status">Original: {money(quote.original)} · Desconto: {money(quote.discount)} · Total: {money(quote.total)}</p>}
      <Button type="submit" variant="primary" disabled={!selected} loading={task.pending}>Solicitar fatura</Button></fieldset>{!allowed && <p>Somente proprietário ou administrador pode solicitar faturas.</p>}</form></Panel>
      <Panel title="Faturas"><p>O retorno do checkout não comprova pagamento. Atualize o status após concluir no provedor.</p>{read.data.invoices.length ? <div className="table-wrap"><table><caption>Faturas da empresa</caption><thead><tr><th scope="col">Fatura</th><th scope="col">Vencimento</th><th scope="col">Valor</th><th scope="col">Status</th><th scope="col">Pagamento</th></tr></thead><tbody>{read.data.invoices.map(invoice => <tr key={invoice.id}><td>{invoice.id}<br/>{state.plans.find(p => p.id === invoice.plan_id)?.name ?? invoice.plan_id} · {periods[invoice.period]} · {invoice.provider}</td><td>{date(invoice.due_date)}</td><td>{money(invoice.amount)}<br/>Desconto: {money(invoice.discount)}</td><td>{invoice.status}</td><td>{allowed && invoice.amount > 0 && ['Pendente', 'Vencida'].includes(invoice.status) ? <Button disabled={task.pending} aria-label={`Abrir checkout da fatura ${invoice.id}`} onClick={() => void task.run(async () => { await openInvoiceCheckout(invoice.id); }, 'Aguardando confirmação do servidor (awaiting).')}>Abrir checkout</Button> : '—'}</td></tr>)}</tbody></table></div> : <p role="status">Nenhuma fatura encontrada.</p>}</Panel>
    </>}</Loaded>{task.feedback}</>;
}

function Members({ tenant }: { tenant: Tenant }) {
  const { state, session, perform } = useDemo(), task = useTask();
  const [email, setEmail] = useState(''), [role, setRole] = useState<typeof roles[number]>('Atendente'), [branchId, setBranchId] = useState(session.branchId), [link, setLink] = useState('');
  const allowed = ['Proprietário', 'Administrador'].includes(session.role);
  const load = useCallback(async () => {
    const [members, invites, auth] = await Promise.all([
      scopedRows('memberships', 'id,user_id,role,active,branch_ids', tenant.id, memberSchema),
      scopedRows('invites', 'id,email,role,expires_at,accepted_at,revoked_at', tenant.id, inviteSchema),
      supabase.auth.getUser(),
    ]);
    if (auth.error || !auth.data.user) throw new Error('Sessão indisponível. Entre novamente.');
    return { members, invites, user: auth.data.user };
  }, [tenant.id]);
  const read = useLoad(load), self = read.data?.members.find(m => m.user_id === read.data?.user.id);
  const branches = state.branches.filter(b => b.tenantId === tenant.id && b.active && self && (self.branch_ids === null || self.branch_ids.includes(b.id)));
  return <><PageHeader title="Funcionários" subtitle="Membros e convites reais da empresa."><Button disabled={read.loading || task.pending} onClick={read.refresh}>Atualizar equipe</Button></PageHeader><Loaded {...read}>{read.data && <>
    <Panel title="Membros">{read.data.members.length ? <ul className="stack">{read.data.members.map(member => <li key={member.id}><p>{member.user_id === read.data?.user.id ? 'Você' : member.user_id} · {member.role} · {member.active ? 'Ativo' : 'Inativo'}</p><p>Filiais: {member.branch_ids === null ? 'Todas' : member.branch_ids.map(id => state.branches.find(b => b.id === id)?.name ?? id).join(', ') || 'Nenhuma'}</p>{allowed && member.role !== 'Proprietário' && member.user_id !== read.data?.user.id && <Button disabled={task.pending} onClick={() => {
      if (member.active && !window.confirm('Desativar o acesso deste membro à empresa?')) return;
      void task.run(async () => {
        await perform(noDemo, rpc('set_member', { p_tenant: tenant.id, p_user: member.user_id, p_role: member.role, p_active: !member.active, p_branch_ids: member.branch_ids }));
        read.refresh();
      }, 'Status do membro atualizado.');
    }}>{member.active ? 'Desativar acesso' : 'Reativar acesso'}</Button>}</li>)}</ul> : <p role="status">Nenhum membro encontrado.</p>}</Panel>
    {allowed ? <Panel title="Convidar membro"><p>Gera um link de convite. Esta tela não envia e-mail nem confirma entrega. Compartilhe somente com o destinatário.</p><form className="stack" onSubmit={e => {
      e.preventDefault();
      void task.run(async () => {
        setLink('');
        const normalized = email.trim().toLowerCase();
        if (!z.string().email().safeParse(normalized).success) throw new Error('Informe um e-mail válido.');
        if (normalized === read.data?.user.email?.toLowerCase()) throw new Error('Não convide o próprio e-mail.');
        if (!roles.includes(role) || !branches.some(b => b.id === branchId)) throw new Error('Selecione perfil e filial autorizados.');
        checkoutUrl(window.location.origin);
        const result = z.object({ token: z.string() }).parse(await perform<unknown>(noDemo, rpc('invite_member', { p_tenant: tenant.id, p_email: normalized, p_role: role, p_branch_ids: [branchId] })));
        setLink(invitationUrl(window.location.origin, result.token));
        setEmail(''); read.refresh();
      }, 'Convite criado. Compartilhe o link de forma privada.');
    }}><fieldset disabled={task.pending || !self}><legend>Acesso do convidado</legend><Field label="E-mail do destinatário"><input required type="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)}/></Field><Field label="Perfil"><select value={role} onChange={e => setRole(z.enum(roles).parse(e.target.value))}>{roles.map(value => <option key={value}>{value}</option>)}</select></Field><Field label="Filial autorizada"><select required value={branchId} onChange={e => setBranchId(e.target.value)}><option value="">Selecione</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field><Button type="submit" variant="primary" loading={task.pending} disabled={!branches.length}>Gerar convite</Button></fieldset></form></Panel> : <p>Somente proprietário ou administrador gerencia acessos.</p>}
    <Panel title="Convites">{read.data.invites.length ? <ul className="stack">{read.data.invites.map(invite => <li key={invite.id}><p>{invite.email} · {invite.role} · {invite.accepted_at ? 'Aceito' : invite.revoked_at ? 'Revogado' : new Date(invite.expires_at).getTime() <= Date.now() ? 'Expirado' : 'Pendente'} · Validade: {date(invite.expires_at)}</p>{allowed && !invite.accepted_at && !invite.revoked_at && <Button disabled={task.pending} onClick={() => void task.run(async () => {
      await perform(noDemo, rpc('revoke_invite', { p_tenant: tenant.id, p_invite: invite.id })); setLink(''); read.refresh();
    }, 'Convite revogado.')}>Revogar convite</Button>}</li>)}</ul> : <p role="status">Nenhum convite encontrado.</p>}</Panel>
  </>}</Loaded>{link && <Panel title="Link do convite"><a href={link} rel="noreferrer" referrerPolicy="no-referrer" style={{ overflowWrap: 'anywhere' }}>{link}</a><p>Visível somente nesta sessão da tela. Não publique este link.</p><Button onClick={() => setLink('')}>Ocultar link</Button></Panel>}{task.feedback}</>;
}

function Help({ tenant }: { tenant: Tenant }) {
  const [search, setSearch] = useState('');
  // Artigos específicos da demonstração não descrevem o ambiente real.
  const demoOnly = new Set(['whatsapp', 'assinatura', 'funcionario', 'pwa', 'privacidade', 'falha']);
  const articles = searchHelp(search).filter(article => !demoOnly.has(article.id));
  return <><PageHeader title="Central de ajuda" subtitle="Orientações de operação."/><Panel><Field label="Buscar ajuda"><input type="search" value={search} onChange={e => setSearch(e.target.value)}/></Field></Panel><div className="grid grid-3">{articles.map(article => <Panel key={article.id} title={article.title}><p>{article.text}</p><Link className="btn" to={`/loja/${encodeURIComponent(tenant.slug)}/${article.module}`}>Abrir módulo: {article.title}</Link></Panel>)}</div>{!articles.length && <p role="status">Nenhum artigo encontrado. Tente outro termo.</p>}<IntegrationStatus/></>;
}

export default function RealSettings() {
  const { state, session, mode, loading, error } = useDemo();
  const path = useLocation().pathname.split('/').filter(Boolean).at(-1);
  const tenant = state.tenants.find(t => t.id === session.tenantId);
  if (mode !== 'real') return <p role="alert">Esta página exige uma sessão real.</p>;
  if (loading) return <p role="status">Carregando empresa…</p>;
  if (error || !tenant) return <p role="alert">{error || 'Empresa indisponível nesta sessão.'}</p>;
  return <div className="page" key={`${tenant.id}:${session.name}:${session.role}:${path}`}>{path === 'configuracoes' ? <Company tenant={tenant}/> : path === 'minha-assinatura' ? <Subscription tenant={tenant}/> : path === 'funcionarios' ? <Members tenant={tenant}/> : path === 'ajuda' ? <Help tenant={tenant}/> : <><PageHeader title="Integrações"/><IntegrationStatus/></>}</div>;
}
