import { useEffect, useState } from 'react';
import { Link, Navigate, Route, Routes } from 'react-router-dom';
import { supabase } from './client';
import { signOut } from './auth';
import type { AdminRole } from './admin/data';
import AdminLayout from './admin/AdminLayout';
import Dashboard from './admin/Dashboard';
import Tenants from './admin/Tenants';
import TenantDetail from './admin/TenantDetail';
import { Coupons, Finance, Invoices, Plans, Subscriptions } from './admin/Billing';
import { Alerts, Broadcasts, Leads, Support } from './admin/Operations';
import { AdminPush, IntegrationDetail, IntegrationsHub, Jobs } from './admin/Tech';
import { Admins, AuditLog, Permissions, PlatformSettings, SecurityPage } from './admin/Security';
import { HelpCenter, Tutorials } from './admin/Help';
import Apps from './admin/Apps';

/** Super Admin: o perfil vem do banco (platform_admins). Cada ação é revalidada no servidor. */
export default function RealAdmin() {
  const [me, setMe] = useState<{ role: AdminRole; email: string } | null | 'denied'>(null);
  useEffect(() => {
    void (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setMe('denied'); return; }
      const { data } = await supabase.from('platform_admins').select('role').eq('user_id', user.id).maybeSingle();
      setMe(data ? { role: data.role as AdminRole, email: user.email ?? '' } : 'denied');
    })().catch(() => setMe('denied'));
  }, []);
  if (me === null) return <main className="page" role="status">Verificando acesso administrativo…</main>;
  if (me === 'denied') return <main className="page"><h1>Acesso administrativo restrito</h1><Link to="/">Voltar</Link></main>;
  const logout = () => { void signOut().finally(() => location.assign('/app/login')); };
  return <Routes><Route element={<AdminLayout role={me.role} email={me.email} onLogout={logout}/>}>
    <Route index element={<Dashboard/>}/><Route path="dashboard" element={<Navigate to="/admin" replace/>}/>
    <Route path="analytics" element={<Dashboard analytics/>}/><Route path="atividades" element={<AuditLog compact/>}/><Route path="alertas" element={<Alerts/>}/>
    <Route path="empresas" element={<Tenants/>}/><Route path="empresas/testes" element={<Tenants view="testes"/>}/><Route path="empresas/inadimplentes" element={<Tenants view="inadimplentes"/>}/>
    <Route path="empresas/:id" element={<TenantDetail/>}/><Route path="onboarding" element={<Tenants view="onboarding"/>}/><Route path="leads" element={<Leads/>}/><Route path="aplicativos" element={<Apps/>}/>
    <Route path="planos" element={<Plans/>}/><Route path="assinaturas" element={<Subscriptions/>}/><Route path="faturas" element={<Invoices/>}/><Route path="cobrancas" element={<Navigate to="/admin/faturas" replace/>}/>
    <Route path="cupons" element={<Coupons/>}/><Route path="financeiro" element={<Finance/>}/>
    <Route path="suporte" element={<Support/>}/><Route path="comunicados" element={<Broadcasts/>}/><Route path="notificacoes" element={<AdminPush/>}/><Route path="automacoes" element={<Jobs/>}/>
    <Route path="integracoes" element={<IntegrationsHub/>}/><Route path="integracoes/webhooks" element={<Jobs/>}/><Route path="integracoes/jobs" element={<Jobs/>}/><Route path="integracoes/:slug" element={<IntegrationDetail/>}/>
    <Route path="administradores" element={<Admins/>}/><Route path="permissoes" element={<Permissions/>}/><Route path="auditoria" element={<AuditLog/>}/><Route path="seguranca" element={<SecurityPage/>}/>
    <Route path="configuracoes" element={<PlatformSettings/>}/><Route path="ajuda" element={<HelpCenter/>}/><Route path="tutoriais" element={<Tutorials/>}/>
    <Route path="*" element={<Navigate to="/admin" replace/>}/>
  </Route></Routes>;
}
