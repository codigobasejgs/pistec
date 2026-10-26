import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Session as AuthSession } from '@supabase/supabase-js';
import { DemoContext, type DemoContextValue, type Remote } from '../store';
import type { Role, Session } from '../types';
import { supabase } from './client';
import { emptyState, loadRealState } from './read';
import { enrollMfa, signOut, verifyMfa } from './auth';
import AuthPage from './AuthPage';
import Layout from '../app/Layout';
import Dashboard from '../features/dashboard/Dashboard';
import Products from '../features/erp/Products';
import Inventory from '../features/erp/Inventory';
import Pos from '../features/erp/Pos';
import Finance from '../features/erp/Finance';
import SalesRecords from '../features/erp/SalesRecords';
import CustomerRecords from '../features/erp/CustomerRecords';
import Records from '../features/erp/Records';
import Reports from '../features/erp/Reports';
import BrandingPage from '../features/settings/Branding';
import RealSettings from './Settings';
import Notifications from './Notifications';
import Assistant from './Assistant';
import RealAdmin from './Admin';
import RealWhatsApp from './WhatsApp';

type Membership = { tenant_id: string; role: Role; branch_ids: string[] | null };
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Não foi possível carregar sua conta.';
const denied = () => { throw new Error('Operação demonstrativa indisponível no ambiente real.'); };

function Mfa({ refresh }: { refresh: () => void }) {
  const [factor, setFactor] = useState(''), [qr, setQr] = useState(''), [error, setError] = useState(''), [pending, setPending] = useState(false);
  useEffect(() => { let active = true; void supabase.auth.mfa.listFactors().then(({ data, error }) => {
    if (!active) return;
    if (error) setError(error.message);
    else setFactor(data.totp.find(f => f.status === 'verified')?.id ?? '');
  }); return () => { active = false; }; }, []);
  async function enroll() {
    setPending(true); setError('');
    try { const data = await enrollMfa(); setFactor(data.id); setQr(data.totp.qr_code); }
    catch (e) { setError(errorText(e)); } finally { setPending(false); }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setPending(true); setError('');
    try { await verifyMfa(factor, String(new FormData(e.currentTarget).get('code') ?? '')); refresh(); }
    catch (e) { setError(errorText(e)); } finally { setPending(false); }
  }
  return <main className="page" style={{ maxWidth: 520, margin: 'auto' }}><h1>Verificação em duas etapas</h1><p>O acesso administrativo exige um aplicativo autenticador.</p>{qr && <img src={qr} alt="QR code para cadastrar PISTEC no autenticador" width={240}/>}
    {!factor ? <button className="btn primary" disabled={pending} onClick={() => void enroll()}>Configurar autenticador</button> : <form className="stack" onSubmit={submit}><label className="field">Código de seis dígitos<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" required maxLength={6}/></label><button className="btn primary" disabled={pending}>Verificar código</button></form>}{error && <p role="alert">{error}</p>}<Link to="/">Voltar</Link></main>;
}

function Onboarding({ refresh }: { refresh: () => void }) {
  const [error, setError] = useState(''), [pending, setPending] = useState(false);
  const navigate = useNavigate();
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); const p = Object.fromEntries(new FormData(e.currentTarget)); setPending(true); setError('');
    try { const { error } = await supabase.rpc('onboard_tenant', { p }); if (error) throw error; refresh(); navigate('/', { replace: true }); }
    catch (e) { setError(errorText(e)); } finally { setPending(false); }
  }
  return <main className="page" style={{ maxWidth: 600, margin: 'auto' }}><h1>Cadastrar empresa</h1><form className="stack" onSubmit={submit}>
    {([['name', 'Nome fantasia'], ['legalName', 'Razão social'], ['owner', 'Responsável'], ['document', 'CNPJ']] as const).map(([name, label]) => <label className="field" key={name}>{label}<input name={name} required maxLength={120}/></label>)}
    <label className="field">Plano<select name="planId"><option value="essencial">Essencial</option><option value="profissional">Profissional</option><option value="premium">Premium</option><option value="enterprise">Enterprise</option></select></label>
    <p>A empresa inicia em teste, conforme as condições do plano. Nenhuma cobrança é confirmada por este cadastro.</p>{error && <p role="alert">{error}</p>}<button className="btn primary" disabled={pending}>Criar empresa</button>
  </form></main>;
}

function Invite({ refresh }: { refresh: () => void }) {
  const { token } = useParams(); const [error, setError] = useState(''), [pending, setPending] = useState(false); const navigate = useNavigate();
  return <main className="page"><h1>Convite para uma empresa</h1><p>A conta atual precisa usar o mesmo e-mail do convite.</p><button className="btn primary" disabled={pending} onClick={async () => {
    setPending(true); setError('');
    try { const { error } = await supabase.rpc('accept_invite', { p_token: token }); if (error) throw error; refresh(); navigate('/'); }
    catch (e) { setError(errorText(e)); } finally { setPending(false); }
  }}>Aceitar convite</button>{error && <p role="alert">{error}</p>}</main>;
}

function RealRoutes() {
  const location = useLocation(), navigate = useNavigate();
  const [auth, setAuth] = useState<AuthSession | null>(null), [authReady, setAuthReady] = useState(false);
  const [state, setState] = useState(emptyState), [members, setMembers] = useState<Membership[]>([]);
  const [session, setSession] = useState<Session>({ tenantId: '', branchId: '', role: 'Atendente', name: '', admin: false });
  const [loading, setLoading] = useState(true), [error, setError] = useState(''), [revision, setRevision] = useState(0), [adminEligible, setAdminEligible] = useState(false);
  const [loadedKey, setLoadedKey] = useState('');
  const epoch = useRef(0), mutationLock = useRef(false);
  const refresh = () => setRevision(r => r + 1);
  const slug = location.pathname.startsWith('/loja/') ? location.pathname.split('/')[2] : null;
  const adminRoute = location.pathname === '/admin' || location.pathname.startsWith('/admin/');
  const key = `${auth?.user.id ?? ''}:${auth?.access_token ?? ''}:${slug ?? ''}:${adminRoute}:${revision}`;
  useEffect(() => {
    let mounted = true;
    const apply = (next: AuthSession | null) => {
      if (!mounted) return;
      epoch.current++; setState(emptyState()); setLoadedKey(''); setMembers([]); setAuth(next); setAuthReady(true);
    };
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => apply(next));
    void supabase.auth.getSession().then(({ data, error }) => { if (!mounted) return; if (error) setError(error.message); apply(data.session); });
    return () => { mounted = false; subscription.unsubscribe(); };
  }, []);
  useEffect(() => {
    if (!authReady || !auth) { setLoading(false); return; }
    const request = ++epoch.current;
    setLoading(true); setError(''); setLoadedKey(''); setState(emptyState());
    void (async () => {
      const [{ data: memberships, error: membershipError }, { data: admins, error: adminError }, { data: assurance, error: assuranceError }] = await Promise.all([
        supabase.from('memberships').select('tenant_id,role,branch_ids').eq('user_id', auth.user.id).eq('active', true),
        supabase.from('platform_admins').select('user_id').eq('user_id', auth.user.id),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (membershipError || adminError || assuranceError) throw membershipError || adminError || assuranceError;
      const eligible = Boolean(admins?.length), isAdmin = eligible && assurance?.currentLevel === 'aal2';
      const scope = (memberships ?? []) as Membership[];
      const catalogue = await loadRealState(supabase, null, false);
      const tenant = catalogue.tenants.find(t => t.slug === slug);
      const membership = scope.find(m => m.tenant_id === tenant?.id);
      if (slug && (!tenant || !membership)) throw new Error('Empresa não encontrada ou acesso revogado.');
      const result = tenant ? await loadRealState(supabase, tenant.id) : adminRoute && isAdmin ? await loadRealState(supabase, null, true) : catalogue;
      if (request !== epoch.current) return;
      const branch = result.branches.find(b => b.tenantId === tenant?.id && b.active && (membership?.branch_ids == null || membership.branch_ids.includes(b.id)));
      setMembers(scope); setAdminEligible(eligible); setState(result);
      setSession({ tenantId: tenant?.id ?? '', branchId: branch?.id ?? '', role: membership?.role ?? 'Atendente', name: auth.user.email ?? 'Usuário', admin: isAdmin });
      setLoadedKey(key);
    })().catch(e => { if (request === epoch.current) { setError(errorText(e)); setState(emptyState()); } }).finally(() => { if (request === epoch.current) setLoading(false); });
  }, [key, authReady, auth, adminRoute, slug]); // Respostas de outra identidade ou escopo são descartadas.

  async function perform<T>(_demo: (draft: typeof state) => T, remote?: Remote): Promise<T> {
    if (!remote) throw new Error('Esta operação ainda não está habilitada no ambiente real. Nada foi alterado.');
    if (mutationLock.current) throw new Error('Aguarde a operação atual.');
    mutationLock.current = true;
    const request = epoch.current;
    try {
      const { data, error } = await supabase.rpc(remote.fn, remote.args);
      if (error) throw new Error(error.message);
      // Não repetir operação confirmada se apenas a atualização da leitura falhar.
      try { const next = await loadRealState(supabase, session.tenantId || null, adminRoute && session.admin); if (request === epoch.current) setState(next); }
      catch { if (request === epoch.current) setError('Operação confirmada pelo servidor. Atualização da tela falhou; recarregue antes de continuar.'); }
      return data as T;
    } finally { mutationLock.current = false; }
  }
  async function logout() {
    setState(emptyState()); setLoadedKey('');
    try { await signOut(); navigate('/login', { replace: true }); }
    catch (e) { setError(errorText(e)); }
  }
  const context: DemoContextValue = { state, session, mode: 'real', prefix: '', initialized: loadedKey === key, loading, error, failNext: false,
    setSession(next) {
      const membership = members.find(m => m.tenant_id === next.tenantId);
      if (!membership || next.tenantId !== session.tenantId || next.role !== session.role || next.admin !== session.admin || !state.branches.some(b => b.id === next.branchId && b.tenantId === next.tenantId && b.active) || (membership.branch_ids && !membership.branch_ids.includes(next.branchId))) throw new Error('Seleção de filial não autorizada.');
      setSession({ ...session, branchId: next.branchId });
    }, perform, mutate: async () => denied(), reset: async () => denied(), setFailNext: denied, logout: () => { void logout(); },
  };
  const authPages: Record<string, ReactNode> = { '/login': <AuthPage page="login"/>, '/cadastro': <AuthPage page="cadastro"/>, '/recuperar': <AuthPage page="recuperar"/>, '/nova-senha': <AuthPage page="nova-senha"/> };
  if (authPages[location.pathname]) return authPages[location.pathname];
  if (!authReady || loading) return <main className="page" role="status">Carregando sua conta…</main>;
  if (!auth) return <Navigate to="/login" replace/>;
  if (error) return <main className="page"><h1>Operação indisponível</h1><p role="alert">{error}</p><button className="btn" onClick={refresh}>Recarregar</button><button className="btn" onClick={() => void logout()}>Sair</button><Link to="/">Empresas</Link></main>;
  if (location.pathname === '/mfa') return <Mfa refresh={refresh}/>;
  if (adminRoute && !session.admin) return adminEligible ? <Navigate to="/mfa" replace/> : <main className="page"><h1>Acesso administrativo negado</h1><Link to="/">Voltar</Link></main>;
  if (slug && !session.branchId) return <main className="page"><h1>Nenhuma filial autorizada</h1><Link to="/">Voltar</Link></main>;
  return <DemoContext.Provider value={context}><Routes>
    <Route path="/" element={<main className="page"><h1>Minhas empresas</h1>{state.tenants.filter(t => members.some(m => m.tenant_id === t.id)).map(t => <p key={t.id}><Link className="btn" to={`/loja/${t.slug}/dashboard`}>{t.name}</Link></p>)}<Link className="btn primary" to="/empresa/nova">Cadastrar empresa</Link>{adminEligible && <Link className="btn" to={session.admin ? '/admin' : '/mfa'}>Administração da plataforma</Link>}<button className="btn" onClick={() => void logout()}>Sair</button><p><a href="/demonstracao">Abrir demonstração isolada</a></p></main>}/>
    <Route path="/empresa/nova" element={<Onboarding refresh={refresh}/>}/>
    <Route path="/convite/:token" element={<Invite refresh={refresh}/>}/>
    <Route path="/loja/:tenantSlug" element={<Layout/>}>
      <Route index element={<Navigate to="dashboard" replace/>}/><Route path="dashboard" element={<Dashboard/>}/><Route path="produtos" element={<Products/>}/><Route path="estoque" element={<Inventory/>}/><Route path="inventario" element={<Inventory/>}/><Route path="pdv" element={<Pos/>}/><Route path="clientes" element={<CustomerRecords/>}/><Route path="vendas" element={<SalesRecords/>}/>
      {['financeiro','contas-pagar','contas-receber','caixa'].map(p => <Route key={p} path={p} element={<Finance key={p}/>}/>)}
      <Route path="relatorios" element={<Reports/>}/><Route path="personalizacao" element={<BrandingPage/>}/>
      <Route path="notificacoes" element={<Notifications/>}/>
      <Route path="assistente" element={<Assistant/>}/>
      {['configuracoes','minha-assinatura','funcionarios','ajuda','integracoes'].map(path => <Route key={path} path={path} element={<RealSettings key={path}/>}/>)}
      <Route path="whatsapp" element={<RealWhatsApp/>}/>
      <Route path=":module" element={<Records/>}/>
      <Route path="*" element={<main className="page"><h1>Módulo em integração</h1><p>Este módulo ainda não está habilitado no ambiente real. Nenhuma operação foi simulada.</p></main>}/>
    </Route>
    <Route path="/pagamento" element={<main className="page"><h1>Pagamento em verificação</h1><p role="status">O retorno do checkout não confirma pagamento. Aguardando confirmação do servidor (awaiting).</p><Link to="/">Voltar para empresas</Link></main>}/>
    <Route path="/admin/*" element={<RealAdmin/>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></DemoContext.Provider>;
}

export default function RealApp() { return <BrowserRouter basename="/app"><RealRoutes/></BrowserRouter>; }
