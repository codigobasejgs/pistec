import { useEffect, useState, type CSSProperties } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Bell, ChevronDown, ChevronsLeft, Command, Crown, LogOut, Menu, Moon, Search, Sun, X, Building2, CircleHelp } from 'lucide-react';
import { useDemo } from '../store';
import { can } from '../domain';
import { nav, adminNav } from '../navigation';
import { Modal, useNotice } from '../ui';
import type { Role, Theme } from '../types';
import Tour from './Tour';

export default function Layout({ admin = false }: { admin?: boolean }) {
  const { state, session, setSession, mutate } = useDemo();
  const { tenantSlug } = useParams(); const location = useLocation(); const navigate = useNavigate(); const notice = useNotice();
  const tenant = state.tenants.find(t => t.slug === tenantSlug);
  const [collapsed, setCollapsed] = useState(false); const [mobile, setMobile] = useState(false); const [searchOpen, setSearchOpen] = useState(false); const [query, setQuery] = useState(''); const [menuQuery, setMenuQuery] = useState(''); const [account, setAccount] = useState(false); const [tour, setTour] = useState(false); const [adminTheme, setAdminTheme] = useState<Theme>('dark');
  const [systemDark, setSystemDark] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const handler = () => setSystemDark(media.matches); media.addEventListener('change', handler); return () => media.removeEventListener('change', handler); }, []);
  useEffect(() => { const handler = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(v => !v); } if (e.key === 'Escape') { setMobile(false); setAccount(false); } }; addEventListener('keydown', handler); return () => removeEventListener('keydown', handler); }, []);
  useEffect(() => { if (tenant && tenant.id !== session.tenantId) setSession({ ...session, tenantId: tenant.id, branchId: state.branches.find(b => b.tenantId === tenant.id && b.active)?.id ?? '', admin: false }); }, [tenant, session, setSession, state.branches]);
  useEffect(() => { setMobile(false); setAccount(false); }, [location.pathname]);
  if (admin && !session.admin) return <Navigate to="/login" replace/>;
  if (!admin && !tenant) return <div className="error-page"><h1>Empresa não encontrada</h1><p>Este endereço não corresponde a uma empresa demonstrativa.</p><Link className="btn primary" to="/demonstracao">Escolher empresa</Link></div>;
  if (!admin && tenant?.id !== session.tenantId) return <div className="skeleton-page" aria-label="Carregando empresa"/>;
  const base = admin ? '/admin' : `/loja/${tenant!.slug}`;
  const items = admin ? adminNav : nav.filter(n => can(session.role, n.path, 'visualizar'));
  const module = location.pathname.split('/').filter(Boolean).at(-1) ?? '';
  const title = items.find(n => n.path === module)?.label ?? (admin ? 'Dashboard SaaS' : 'Dashboard');
  const theme = admin ? adminTheme : tenant!.branding.theme;
  const isDark = theme === 'dark' || (theme === 'system' && systemDark);
  const style = !admin ? { '--brand': tenant!.branding.primary, '--secondary': tenant!.branding.secondary, '--accent': tenant!.branding.accent, '--sidebar': tenant!.branding.sidebar, fontFamily: `${tenant!.branding.font || 'Inter'}, "Segoe UI", system-ui, sans-serif` } as CSSProperties : undefined;
  const searchItems = [
    ...items.map(n => ({ id: `module-${n.path}`, label: n.label, type: 'Módulo', to: `${base}/${n.path}` })),
    ...(!admin ? [
      ...state.products.filter(p => p.tenantId === tenant!.id && p.active).map(p => ({ id:p.id,label:`${p.name} · ${p.sku}`,type:'Produto',to:`${base}/produtos?q=${encodeURIComponent(p.sku)}` })),
      ...state.customers.filter(p => p.tenantId === tenant!.id).map(p => ({ id:p.id,label:p.name,type:'Cliente',to:`${base}/clientes?q=${encodeURIComponent(p.name)}` })),
      ...state.records.filter(p => p.tenantId === tenant!.id && ['veiculos','ordens-servico','orcamentos','fornecedores'].includes(p.kind)).map(p => ({ id:p.id,label:p.title,type:p.kind,to:`${base}/${p.kind}?q=${encodeURIComponent(p.title)}` })),
      ...state.sales.filter(s => s.tenantId === tenant!.id).map(s => ({ id:s.id,label:`Venda ${s.id}`,type:'Venda',to:`${base}/vendas?q=${encodeURIComponent(s.id)}` })),
    ] : state.tenants.map(t => ({id:t.id,label:t.name,type:'Empresa',to:`/admin/empresas?q=${encodeURIComponent(t.name)}`}))),
  ].filter(x => x.label.toLocaleLowerCase('pt-BR').includes(query.toLocaleLowerCase('pt-BR'))).slice(0, 24);
  const groups = Array.from(new Set(items.map(n => n.group)));
  const toggleTheme = async () => { if (admin) setAdminTheme(isDark ? 'light' : 'dark'); else try { await mutate(s => { s.tenants.find(t => t.id === tenant!.id)!.branding.theme = isDark ? 'light' : 'dark'; }); } catch(e) { notice((e as Error).message); } };
  const allowed = admin || can(session.role, module, 'visualizar');
  const blocked = !admin && ['Suspensa','Cancelada'].includes(tenant!.status) && !['minha-assinatura','ajuda'].includes(module);
  return <div className={`app-shell ${collapsed ? 'is-collapsed' : ''} ${mobile ? 'mobile-open' : ''} density-${tenant?.branding.density ?? 'comfortable'}`} data-theme={isDark ? 'dark' : 'light'} style={style}>
    <a className="skip-link" href="#main">Pular para o conteúdo</a>
    {mobile && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMobile(false)}/>}
    <aside className="sidebar" data-tour="navigation"><Link className="sidebar-brand" to={admin ? '/admin' : `${base}/dashboard`}><img src={collapsed ? '/brand/symbol.webp' : '/brand/logo-horizontal.webp'} alt="PISTEC"/><span className="brand-caption">{admin ? 'CONTROLE DA PLATAFORMA' : 'GESTÃO AUTOMOTIVA'}</span></Link>
      <div className="sidebar-filter"><Search size={15}/><input aria-label="Buscar módulo" placeholder="Buscar módulo" value={menuQuery} onChange={e => setMenuQuery(e.target.value)}/></div>
      <nav className="sidebar-nav" aria-label={admin ? 'Administração da plataforma' : 'Módulos da loja'}>{groups.map((g, index) => <details key={g} open={index < 3 || Boolean(menuQuery)} className="nav-group"><summary>{g}<ChevronDown size={12}/></summary>{items.filter(n => n.group === g && n.label.toLowerCase().includes(menuQuery.toLowerCase())).map(n => <NavLink key={n.path} end to={`${base}${n.path ? `/${n.path}` : ''}`} title={n.label} data-tour={n.path === 'produtos' ? 'products' : undefined}><n.icon size={19}/><span>{n.label}</span>{n.path === 'whatsapp' && <i className="nav-dot"/>}</NavLink>)}</details>)}</nav>
      <div className="sidebar-bottom"><div className="store-identity"><div className="store-icon">{tenant?.branding.logo ? <img src={tenant.branding.logo} alt=""/> : <Building2 size={22}/>}</div><div><strong>{admin ? 'PISTEC Platform' : tenant!.name}</strong><span><Crown size={12}/>{admin ? 'Super Admin' : state.plans.find(p => p.id === tenant!.planId)?.name}</span></div></div><Link className="switch-tenant" to="/demonstracao">Trocar empresa demo</Link><button className="collapse-toggle" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}><ChevronsLeft size={17}/><span>Recolher menu</span></button></div>
    </aside>
    <div className="workspace"><header className="topbar"><button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setMobile(true)}><Menu size={21}/></button><button className="global-search" onClick={() => setSearchOpen(true)} data-tour="search"><Search size={18}/><span>Buscar produtos, clientes, ordens de serviço...</span><kbd>Ctrl K</kbd></button><div className="topbar-actions"><button className="icon-button" aria-label="Notificações" onClick={() => navigate(admin ? '/admin/suporte' : `${base}/notificacoes`)}><Bell size={19}/><i className="notification-dot"/></button><button className="icon-button" aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'} onClick={toggleTheme}>{isDark ? <Sun size={19}/> : <Moon size={19}/>}</button>{!admin && <label className="branch-select"><Building2 size={17}/><select aria-label="Filial ativa" value={session.branchId} onChange={e => setSession({...session,branchId:e.target.value})}>{state.branches.filter(b => b.tenantId === tenant!.id && b.active).map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></label>}<div className="account-wrap"><button className="account-button" aria-label="Menu da conta" aria-expanded={account} onClick={() => setAccount(v => !v)}><span className="avatar">{session.name.split(' ').map(s => s[0]).slice(0,2).join('')}</span><span><strong>{session.name}</strong><small>{admin ? 'Super Admin' : session.role}</small></span><ChevronDown size={14}/></button>{account && <div className="account-menu"><p>Perfil demonstrativo</p>{!admin && <select aria-label="Papel demonstrativo" value={session.role} onChange={e => setSession({...session,role:e.target.value as Role})}>{['Proprietário','Administrador','Gerente','Vendedor','Caixa','Estoquista','Mecânico','Atendente','Financeiro'].map(r => <option key={r}>{r}</option>)}</select>}<button onClick={() => { setTour(true); setAccount(false); }}><CircleHelp size={16}/>Tour guiado</button><Link to="/login" onClick={() => setSession({...session,admin:false})}><LogOut size={16}/>Sair da demonstração</Link></div>}</div></div></header>
    <div className="demo-strip"><span><i/>AMBIENTE DEMONSTRATIVO</span><span>Dados fictícios · operações locais · nenhuma cobrança real</span><button onClick={() => setTour(true)}>Conhecer o sistema</button></div>
    <main id="main" className="main-content"><div className="breadcrumbs">{admin ? 'PISTEC / Plataforma' : `Minha empresa / ${tenant!.name}`}<span>/ {title}</span></div>{blocked ? <div className="error-page"><Crown size={42}/><h1>Assinatura {tenant!.status.toLowerCase()}</h1><p>Os dados continuam preservados. Gerencie sua assinatura para simular uma reativação.</p><Link className="btn primary" to={`${base}/minha-assinatura`}>Gerenciar assinatura</Link></div> : allowed ? <Outlet key={`${session.tenantId}:${session.branchId}:${location.pathname}`}/> : <div className="error-page"><h1>Acesso não permitido</h1><p>O perfil demonstrativo {session.role} não tem acesso a este módulo.</p><Link to={`${base}/dashboard`}>Voltar ao dashboard</Link></div>}</main><footer className="app-footer"><span>PISTEC · Tecnologia que move seu negócio.</span><span>Demo v0.1 · Dados neste navegador</span></footer></div>
    <Modal title="Busca universal" open={searchOpen} onClose={() => setSearchOpen(false)}><div className="command-input"><Command size={20}/><input autoFocus placeholder="Produtos, clientes, veículos, OS ou módulos..." aria-label="Pesquisar no sistema" value={query} onChange={e => setQuery(e.target.value)}/></div><div className="command-results">{searchItems.map(item => <Link key={item.id} to={item.to} onClick={() => { setSearchOpen(false); setQuery(''); }}><Search size={16}/><span>{item.label}</span><small>{item.type}</small></Link>)}{!searchItems.length && <p>Nenhum resultado nesta empresa.</p>}</div></Modal>
    {tour && <Tour admin={admin} onClose={() => setTour(false)}/>}
    <button className="mobile-close" aria-label="Fechar navegação" onClick={() => setMobile(false)}><X/></button>
  </div>;
}
