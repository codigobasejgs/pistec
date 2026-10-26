import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader, Panel, Stat } from '../../ui';
import { call, rows, useQuery } from './data';
import { useAdmin } from './context';
import { AdvancedTable, ConfirmAction, Loaded, StatusBadge } from './ui';

type AppRow = { tenant_id: string; name: string; short_name: string; theme_color: string; status: string; suspended_reason: string | null; version: number; updated_at: string; icons: Record<string, string>; tenants: { name: string; slug: string; plan_id: string } | null };

/** Aplicativos personalizados (White Label): quais empresas publicaram, situação e suspensão com justificativa. */
export default function Apps() {
  const { can } = useAdmin(); const [target, setTarget] = useState<AppRow | null>(null);
  const q = useQuery(() => rows<AppRow>('tenant_apps', 'tenant_id,name,short_name,theme_color,status,suspended_reason,version,updated_at,icons,tenants(name,slug,plan_id)', b => b.order('updated_at', { ascending: false })), []);
  return <div className="page"><PageHeader title="Aplicativos personalizados" subtitle="Apps instaláveis com a marca de cada empresa. Endereço: /app/m/<empresa> (domínio próprio ainda não configurado)."/>
    <Loaded q={q}>{list => <>
      <div className="grid grid-3"><Stat label="Apps publicados" value={list.length}/><Stat label="Ativos" value={list.filter(a => a.status === 'active').length} tone="green"/><Stat label="Suspensos" value={list.filter(a => a.status === 'suspended').length} tone="red"/></div>
      <Panel title="Empresas com aplicativo">{list.length ? <AdvancedTable caption="Aplicativos" tour="admin-apps" rows={list.map(a => ({ ...a, id: a.tenant_id }))} search={a => `${a.name} ${a.tenants?.name ?? ''} ${a.tenants?.slug ?? ''}`} columns={[
        { key: 'icon', label: 'Ícone', render: a => a.icons?.['192'] ? <img src={a.icons['192']} alt="" width={36} height={36} style={{ borderRadius: 8, background: '#fff' }}/> : '—' },
        { key: 'name', label: 'Aplicativo', sort: a => a.name, render: a => <><strong>{a.name}</strong><br/><small className="muted">{a.short_name}</small></> },
        { key: 'tenant', label: 'Empresa', render: a => <Link to={`/admin/empresas/${a.tenant_id}`}>{a.tenants?.name ?? a.tenant_id}</Link> },
        { key: 'plan', label: 'Plano', render: a => a.tenants?.plan_id ?? '—' },
        { key: 'status', label: 'Situação', render: a => <StatusBadge>{a.status === 'active' ? 'Ativo' : 'Suspenso'}</StatusBadge> },
        { key: 'v', label: 'Versão', render: a => String(a.version) },
        { key: 'at', label: 'Atualizado', sort: a => a.updated_at, render: a => new Date(a.updated_at).toLocaleString('pt-BR') },
        { key: 'url', label: 'Endereço', render: a => a.tenants ? <code>/app/m/{a.tenants.slug}</code> : '—' },
        ...(can('tenants.edit') ? [{ key: 'a', label: 'Ação', render: (a: AppRow) => <button className="btn" onClick={() => setTarget(a)}>{a.status === 'active' ? 'Suspender' : 'Reativar'}</button> }] : [])]}/>
        : <p className="muted">Nenhuma empresa publicou aplicativo ainda. A loja publica em Personalização → Meu Aplicativo (planos Premium e Enterprise).</p>}</Panel>
      <Panel title="Como funciona"><ul><li>A empresa envia o logotipo; os ícones (192, 512, adaptável, iPhone, favicon) são gerados no navegador e validados no servidor.</li>
        <li>O manifest é servido por empresa em <code>/api/tenant-app</code>, com identificador estável <code>/app/m/&lt;empresa&gt;</code>. Mesmo service worker do PISTEC.</li>
        <li>Suspender tira a marca do ar (o endereço volta ao login padrão) sem apagar a configuração nem os dados da loja.</li>
        <li>Subdomínio por empresa (<code>empresa.seudominio</code>) exige domínio próprio e DNS curinga — ainda não configurados.</li></ul></Panel>
    </>}</Loaded>
    <ConfirmAction open={!!target} title={target?.status === 'active' ? 'Suspender aplicativo' : 'Reativar aplicativo'} confirmLabel="Confirmar" danger={target?.status === 'active'} onClose={() => setTarget(null)}
      description={<p>{target?.name} ({target?.tenants?.name}): a mudança vale imediatamente, a empresa é notificada e fica na auditoria.</p>}
      onConfirm={async r => { await call('admin_set_tenant_app', { p_tenant: target!.tenant_id, p_active: target!.status !== 'active', p_reason: r }); q.reload(); }}/>
  </div>;
}
