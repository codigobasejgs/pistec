import { useEffect, useMemo, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ChevronDown, ChevronsLeft, CircleHelp, Command, LogOut, Menu, Monitor, Moon, Search, Star, Sun, X } from 'lucide-react';
import { Modal } from '../../ui';
import { supabase } from '../client';
import { adminNav } from './nav';
import { adminCan, roleLabels, type AdminRole, type TenantRow } from './data';
import { AdminContext } from './context';
import AdminTour from './AdminTour';

type Theme = 'dark' | 'light' | 'system';
const store = { get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* preferência opcional */ } } };

export default function AdminLayout({ role, email, onLogout }: { role: AdminRole; email: string; onLogout: () => void }) {
  const location = useLocation(), navigate = useNavigate();
  const [collapsed, setCollapsed] = useState(() => store.get('pistec-admin-collapsed') === '1');
  const [theme, setTheme] = useState<Theme>(() => (store.get('pistec-admin-theme') as Theme) || 'dark');
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(store.get('pistec-admin-favs') ?? '[]'); } catch { return []; } });
  const [mobile, setMobile] = useState(false), [account, setAccount] = useState(false), [menuQuery, setMenuQuery] = useState(''), [search, setSearch] = useState(false), [tour, setTour] = useState(false);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); const h = () => setSystemDark(m.matches); m.addEventListener('change', h); return () => m.removeEventListener('change', h); }, []);
  useEffect(() => store.set('pistec-admin-collapsed', collapsed ? '1' : '0'), [collapsed]);
  useEffect(() => store.set('pistec-admin-theme', theme), [theme]);
  useEffect(() => store.set('pistec-admin-favs', JSON.stringify(favorites)), [favorites]);
  useEffect(() => { setMobile(false); setAccount(false); }, [location.pathname]);
  useEffect(() => { const h = (e: KeyboardEvent) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearch(v => !v); } if (e.key === 'Escape') { setMobile(false); setAccount(false); } }; addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, []);
  useEffect(() => { const h = () => setTour(true); addEventListener('pistec:admin-tour', h); return () => removeEventListener('pistec:admin-tour', h); }, []);

  const items = adminNav.filter(n => !n.perm || adminCan(role, n.perm));
  const filtered = items.filter(n => n.label.toLocaleLowerCase('pt-BR').includes(menuQuery.toLocaleLowerCase('pt-BR')));
  const groups = Array.from(new Set(filtered.map(n => n.group)));
  const section = location.pathname.replace(/^\/admin\/?/, '');
  const current = [...items].sort((a, b) => b.path.length - a.path.length).find(n => n.path ? section === n.path || section.startsWith(n.path + '/') : section === '');
  const dark = theme === 'dark' || (theme === 'system' && systemDark);
  const nextTheme: Record<Theme, Theme> = { dark: 'light', light: 'system', system: 'dark' };
  const toggleFav = (p: string) => setFavorites(f => f.includes(p) ? f.filter(x => x !== p) : [...f, p]);
  const link = (n: typeof items[number]) => <NavLink key={n.path} end={!n.path || n.path === 'empresas' || n.path === 'integracoes'} to={`/admin${n.path ? `/${n.path}` : ''}`} title={collapsed ? n.label : undefined} aria-label={collapsed ? n.label : undefined} data-tour={`anav-${n.path.replace('/', '-') || 'home'}`}><n.icon size={19}/><span>{n.label}</span></NavLink>;

  return <AdminContext.Provider value={{ role, email, can: (p: string) => adminCan(role, p) }}>
    <div className={`app-shell admin-shell ${collapsed ? 'is-collapsed' : ''} ${mobile ? 'mobile-open' : ''}`} data-theme={dark ? 'dark' : 'light'}>
      <a className="skip-link" href="#main">Pular para o conteúdo</a>
      {mobile && <button className="sidebar-scrim" aria-label="Fechar menu" onClick={() => setMobile(false)}/>}
      <aside className="sidebar" data-tour="admin-sidebar">
        <Link className="sidebar-brand" to="/admin"><img src={collapsed ? '/brand/symbol.webp' : '/brand/logo-horizontal.webp'} alt="PISTEC"/><span className="brand-caption">ADMINISTRAÇÃO DA PLATAFORMA</span></Link>
        <div className="sidebar-filter"><Search size={15}/><input aria-label="Buscar módulo" placeholder="Buscar módulo" value={menuQuery} onChange={e => setMenuQuery(e.target.value)}/></div>
        <nav className="sidebar-nav" aria-label="Administração da plataforma">
          {favorites.length > 0 && !menuQuery && <details open className="nav-group"><summary>Favoritos<ChevronDown size={12}/></summary>{items.filter(n => favorites.includes(n.path)).map(link)}</details>}
          {groups.map(g => <details key={g} open className="nav-group"><summary>{g}<ChevronDown size={12}/></summary>{filtered.filter(n => n.group === g).map(link)}</details>)}
        </nav>
        <div className="sidebar-bottom"><div className="store-identity"><div className="store-icon"><img src="/brand/symbol.webp" alt=""/></div><div><strong>PISTEC Platform</strong><span>{roleLabels[role]}</span></div></div>
          <a className="switch-tenant" href="/app/">Minhas empresas</a>
          <button className="collapse-toggle" onClick={() => setCollapsed(v => !v)} aria-label={collapsed ? 'Expandir menu' : 'Recolher menu'}><ChevronsLeft size={17}/><span>Recolher menu</span></button></div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <button className="icon-button mobile-menu" aria-label="Abrir menu" onClick={() => setMobile(true)}><Menu size={21}/></button>
          <button className="global-search" onClick={() => setSearch(true)} data-tour="admin-search"><Search size={18}/><span>Buscar empresa, CNPJ, e-mail, fatura, chamado…</span><kbd>Ctrl K</kbd></button>
          <div className="topbar-actions">
            <span className="badge info hide-mobile">AMBIENTE REAL</span>
            {current && <button className="icon-button hide-mobile" aria-label={favorites.includes(current.path) ? 'Remover dos favoritos' : 'Adicionar aos favoritos'} aria-pressed={favorites.includes(current.path)} onClick={() => toggleFav(current.path)}><Star size={18} fill={favorites.includes(current.path) ? 'currentColor' : 'none'}/></button>}
            <button className="icon-button" aria-label="Alertas" onClick={() => navigate('/admin/alertas')} data-tour="admin-alerts"><BellIcon/></button>
            <button className="icon-button" aria-label={`Tema: ${theme === 'dark' ? 'escuro' : theme === 'light' ? 'claro' : 'automático'}. Alternar.`} onClick={() => setTheme(t => nextTheme[t])}>{theme === 'system' ? <Monitor size={19}/> : dark ? <Sun size={19}/> : <Moon size={19}/>}</button>
            <button className="icon-button" aria-label="Ajuda" onClick={() => navigate(`/admin/ajuda?q=${encodeURIComponent(current?.label ?? '')}`)}><CircleHelp size={19}/></button>
            <div className="account-wrap" data-tour="admin-account"><button className="account-button" aria-label="Menu da conta" aria-expanded={account} onClick={() => setAccount(v => !v)}><span className="avatar">{email.slice(0, 2).toUpperCase()}</span><span><strong>{email}</strong><small>{roleLabels[role]}</small></span><ChevronDown size={14}/></button>
              {account && <div className="account-menu"><p>{roleLabels[role]}</p><button onClick={() => { setTour(true); setAccount(false); }}><CircleHelp size={16}/>Tour guiado</button><Link to="/admin/seguranca"><Command size={16}/>Segurança da conta</Link><button onClick={onLogout}><LogOut size={16}/>Sair da conta</button></div>}</div>
          </div>
        </header>
        <main id="main" className="main-content"><nav className="breadcrumbs" aria-label="Você está em">PISTEC / Plataforma<span>/ {current?.label ?? 'Detalhe'}</span></nav><Outlet/></main>
        <footer className="app-footer"><span>PISTEC · Administração da plataforma</span><span>Ações administrativas exigem conexão e ficam registradas na auditoria.</span></footer>
      </div>
      <GlobalSearch open={search} onClose={() => setSearch(false)} role={role}/>
      {tour && <AdminTour onClose={() => setTour(false)}/>}
      <button className="mobile-close" aria-label="Fechar navegação" onClick={() => setMobile(false)}><X/></button>
    </div>
  </AdminContext.Provider>;
}

function BellIcon() { return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>; }

/** Busca global no servidor (RLS + perfil): empresas por nome/CNPJ/e-mail/responsável, faturas, chamados e leads. */
function GlobalSearch({ open, onClose, role }: { open: boolean; onClose: () => void; role: AdminRole }) {
  const [q, setQ] = useState(''), [results, setResults] = useState<{ id: string; label: string; type: string; to: string }[]>([]), [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const pages = useMemo(() => adminNav.filter(n => !n.perm || adminCan(role, n.perm)), [role]);
  useEffect(() => {
    if (!open) { setQ(''); setResults([]); return; }
    const term = q.trim(); if (term.length < 2) { setResults(pages.slice(0, 8).map(p => ({ id: p.path, label: p.label, type: 'Página', to: `/admin/${p.path}` }))); return; }
    const t = setTimeout(async () => {
      setLoading(true);
      const like = `%${term.replace(/[%_,()]/g, '')}%`, digits = term.replace(/\D/g, '');
      const ors = [`name.ilike.${like}`, `legal_name.ilike.${like}`, `email.ilike.${like}`, `owner_name.ilike.${like}`, ...(digits.length >= 4 ? [`document.ilike.%${digits}%`] : [])].join(',');
      const [tenants, records, invoices] = await Promise.all([
        supabase.from('tenants').select('id,name,document,email').or(ors).limit(8),
        supabase.from('records').select('id,kind,title').is('tenant_id', null).in('kind', ['admin-ticket', 'admin-lead']).ilike('title', like).limit(6),
        // Fatura: pelo identificador completo (o mesmo enviado à InfinitePay como order_nsu).
        adminCan(role, 'billing.read') && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term) ? supabase.from('billing_invoices').select('id,tenant_id,status').eq('id', term).limit(1) : Promise.resolve({ data: [] as { id: string; tenant_id: string; status: string }[] }),
      ]);
      const out = [
        ...pages.filter(p => p.label.toLocaleLowerCase('pt-BR').includes(term.toLocaleLowerCase('pt-BR'))).map(p => ({ id: 'p' + p.path, label: p.label, type: 'Página', to: `/admin/${p.path}` })),
        ...((tenants.data ?? []) as TenantRow[]).map(t => ({ id: t.id, label: `${t.name}${t.document ? ` · ${t.document}` : ''} · ${t.email}`, type: 'Empresa', to: `/admin/empresas/${t.id}` })),
        ...((records.data ?? []) as { id: string; kind: string; title: string }[]).map(r => ({ id: r.id, label: r.title, type: r.kind === 'admin-ticket' ? 'Chamado' : 'Lead', to: r.kind === 'admin-ticket' ? `/admin/suporte?id=${r.id}` : `/admin/leads?id=${r.id}` })),
        ...((invoices.data ?? []) as { id: string; tenant_id: string; status: string }[]).map(i => ({ id: i.id, label: `Fatura ${i.id.slice(0, 8)} · ${i.status}`, type: 'Fatura', to: `/admin/empresas/${i.tenant_id}?aba=cobrancas` })),
      ];
      setResults(out); setLoading(false);
    }, 250);
    return () => clearTimeout(t);
  }, [q, open, pages, role]);
  return <Modal title="Busca global" open={open} onClose={onClose}><div className="command-input"><Command size={20}/><input autoFocus placeholder="Empresa, CNPJ, e-mail, responsável, chamado, lead ou página…" aria-label="Pesquisar na plataforma" value={q} onChange={e => setQ(e.target.value)}/></div>
    <div className="command-results" aria-live="polite">{loading && <p role="status">Buscando…</p>}{results.map(r => <button key={r.type + r.id} className="command-result" onClick={() => { navigate(r.to); onClose(); }}><Search size={16}/><span>{r.label}</span><small>{r.type}</small></button>)}
      {!loading && q.trim().length >= 2 && !results.length && <p>Nada encontrado. Tente o nome fantasia, parte do CNPJ ou o e-mail.</p>}</div></Modal>;
}
