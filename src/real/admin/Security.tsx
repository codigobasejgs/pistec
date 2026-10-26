import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button, Field, PageHeader, Panel } from '../../ui';
import { call, roleLabels, rows, useQuery, type AdminRole } from './data';
import { useAdmin } from './context';
import { AdvancedTable, ConfirmAction, KeyValue, Loaded, StatusBadge } from './ui';
import { changePassword } from '../auth';

type Admin = { userId: string; email: string; role: AdminRole; note: string; since: string; me: boolean };
export function Admins() {
  const { can } = useAdmin(); const q = useQuery(() => call<Admin[]>('admin_list_admins'), []);
  const [email, setEmail] = useState(''), [role, setRole] = useState<AdminRole>('support'), [target, setTarget] = useState<{ email: string; role: AdminRole; remove: boolean } | null>(null), [msg, setMsg] = useState('');
  const manage = can('admins.manage');
  return <div className="page"><PageHeader title="Administradores" subtitle="Pessoas com acesso à administração da plataforma. Cada perfil libera só as áreas necessárias (ver Perfis de acesso)."/>
    {msg && <p role="status" className="callout">{msg}</p>}
    {manage && <Panel title="Adicionar ou alterar administrador"><div className="toolbar" data-tour="admin-add-admin">
      <Field label="E-mail da conta (a pessoa precisa ter criado a conta em /app/cadastro)"><input type="email" value={email} onChange={e => setEmail(e.target.value)}/></Field>
      <Field label="Perfil"><select value={role} onChange={e => setRole(e.target.value as AdminRole)}>{Object.entries(roleLabels).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
      <Button variant="primary" icon={<Plus size={15}/>} disabled={!/^\S+@\S+\.\S+$/.test(email)} onClick={() => setTarget({ email, role, remove: false })}>Conceder acesso</Button></div></Panel>}
    <Panel title="Equipe administrativa"><Loaded q={q}>{list => <AdvancedTable caption="Administradores" rows={list.map(a => ({ ...a, id: a.userId }))} columns={[
      { key: 'email', label: 'E-mail', render: a => <>{a.email}{a.me && <small className="muted"> (você)</small>}</> }, { key: 'role', label: 'Perfil', render: a => <StatusBadge>{roleLabels[a.role]}</StatusBadge> },
      { key: 'since', label: 'Desde', render: a => new Date(a.since).toLocaleDateString('pt-BR') },
      ...(manage ? [{ key: 'a', label: 'Ações', render: (a: Admin) => a.me ? '—' : <Button variant="danger" onClick={() => setTarget({ email: a.email, role: a.role, remove: true })}>Remover acesso</Button> }] : [])]}/>}</Loaded>
      {!manage && <p className="muted small">Somente o proprietário da plataforma gerencia administradores.</p>}</Panel>
    <ConfirmAction open={!!target} danger={target?.remove} needReason={false} title={target?.remove ? 'Remover acesso administrativo' : 'Conceder acesso administrativo'} confirmLabel="Confirmar" onClose={() => setTarget(null)}
      description={<p>{target?.email}: {target?.remove ? 'deixa de acessar a administração imediatamente.' : `passa a ter o perfil "${target && roleLabels[target.role]}".`} A alteração fica na auditoria.</p>}
      onConfirm={async () => { await call('admin_set_admin', { p_email: target!.email, p_role: target!.role, p_remove: target!.remove }); setMsg('Acesso atualizado.'); setEmail(''); q.reload(); }}/>
  </div>;
}

// Espelho legível de app.admin_perm (SQL).
const perms: [string, string][] = [['billing.read', 'Ver faturamento e receita'], ['billing.manage', 'Baixa manual e cancelamento de faturas'], ['coupons.manage', 'Gerenciar cupons'], ['subscriptions.manage', 'Prorrogar teste, alterar plano, suspender, reativar, cancelar'],
  ['tenants.edit', 'Editar dados cadastrais e observações'], ['leads.manage', 'CRM comercial'], ['support.manage', 'Suporte e chamados'], ['broadcast', 'Publicar comunicados'],
  ['integrations.manage', 'Diagnóstico de integrações e limites de IA'], ['jobs.retry', 'Reprocessar eventos'], ['audit.read', 'Consultar auditoria'], ['admins.manage', 'Gerenciar administradores']];
export function Permissions() {
  const roles = Object.keys(roleLabels) as AdminRole[];
  const has = (r: AdminRole, p: string) => r === 'owner' || (r === 'admin' && p !== 'admins.manage') || ({ finance: ['billing.read', 'billing.manage', 'coupons.manage', 'subscriptions.manage', 'audit.read'], sales: ['leads.manage'], support: ['support.manage', 'tenants.edit'], ops: ['integrations.manage', 'jobs.retry', 'broadcast', 'audit.read'], auditor: ['audit.read', 'billing.read'] } as Record<string, string[]>)[r]?.includes(p);
  return <div className="page"><PageHeader title="Perfis de acesso" subtitle="Permissões verificadas no servidor em cada ação. Todos os perfis veem a lista de empresas e o dashboard; dados financeiros só com 'Ver faturamento'."/>
    <Panel><div className="table-wrap"><table><caption className="sr-only">Matriz de permissões</caption><thead><tr><th scope="col">Permissão</th>{roles.map(r => <th key={r} scope="col">{roleLabels[r]}</th>)}</tr></thead>
      <tbody>{perms.map(([k, l]) => <tr key={k}><th scope="row">{l}</th>{roles.map(r => <td key={r} style={{ textAlign: 'center' }}>{has(r, k) ? <span aria-label="Permitido">✓</span> : <span aria-label="Negado" className="muted">—</span>}</td>)}</tr>)}
      <tr><th scope="row">Criar/editar planos</th>{roles.map(r => <td key={r} style={{ textAlign: 'center' }}>{['owner', 'admin'].includes(r) ? '✓' : <span className="muted">—</span>}</td>)}</tr></tbody></table></div></Panel></div>;
}

type Audit = { id: number; tenant_id: string | null; user_id: string | null; action: string; entity: string; entity_id: string; data: { reason?: string; before?: unknown; after?: unknown }; correlation_id: string | null; created_at: string };
export function AuditLog({ compact = false }: { compact?: boolean }) {
  const [from, setFrom] = useState(''), [entity, setEntity] = useState(''), [platform, setPlatform] = useState(false);
  const q = useQuery(async () => {
    const [logs, tenants] = await Promise.all([rows<Audit>('audit_logs', '*', b => { let x = b.order('id', { ascending: false }).limit(compact ? 30 : 500); if (from) x = x.gte('created_at', from); if (entity) x = x.eq('entity', entity); if (platform) x = x.is('tenant_id', null); return x; }),
      rows<{ id: string; name: string }>('tenants', 'id,name')]);
    return logs.map(l => ({ ...l, id: String(l.id), tenant: tenants.find(t => t.id === l.tenant_id)?.name ?? (l.tenant_id ? '—' : 'Plataforma') }));
  }, [from, entity, platform, compact]);
  return <div className="page"><PageHeader title={compact ? 'Atividades recentes' : 'Auditoria'} subtitle="Registro imutável (sem edição ou exclusão pela interface). Data e hora do servidor.">
    {!compact && <div className="toolbar"><label>Desde<input type="date" value={from} onChange={e => setFrom(e.target.value)}/></label>
      <label>Módulo<select value={entity} onChange={e => setEntity(e.target.value)}><option value="">Todos</option>{['tenant', 'subscription', 'invoice', 'plan', 'coupon', 'record', 'platform_admin', 'outbox_event', 'notification', 'ai_settings', 'sale', 'product'].map(x => <option key={x}>{x}</option>)}</select></label>
      <label><input type="checkbox" checked={platform} onChange={e => setPlatform(e.target.checked)}/> Só ações da plataforma</label></div>}</PageHeader>
    <Panel><Loaded q={q}>{list => <AdvancedTable caption="Auditoria" tour="admin-audit" rows={list} pageSize={compact ? 30 : 25} search={l => `${l.action} ${l.tenant} ${l.entity} ${l.data?.reason ?? ''}`} columns={[
      { key: 'at', label: 'Data/hora', sort: l => l.created_at, render: l => new Date(l.created_at).toLocaleString('pt-BR') }, { key: 'action', label: 'Ação', render: l => l.action },
      { key: 'tenant', label: 'Empresa', sort: l => l.tenant, render: l => l.tenant }, { key: 'entity', label: 'Recurso', render: l => l.entity || '—' },
      { key: 'reason', label: 'Justificativa', render: l => l.data?.reason ?? '—' }, { key: 'change', label: 'Antes → depois', render: l => l.data?.before !== undefined ? <small>{JSON.stringify(l.data.before)?.slice(0, 80)} → {JSON.stringify(l.data.after)?.slice(0, 80)}</small> : '—' },
      { key: 'corr', label: 'Correlação', render: l => l.correlation_id ? <code>{l.correlation_id.slice(0, 8)}</code> : '—' }]}/>}</Loaded></Panel></div>;
}

export function SecurityPage() {
  const { email, role } = useAdmin(); const [pw, setPw] = useState(''), [pw2, setPw2] = useState(''), [msg, setMsg] = useState(''), [err, setErr] = useState(''), [pending, setPending] = useState(false);
  const save = async () => { setErr(''); setMsg(''); if (pw !== pw2) { setErr('As senhas não coincidem.'); return; } setPending(true); try { await changePassword(pw); setMsg('Senha alterada. Use a nova senha no próximo login.'); setPw(''); setPw2(''); } catch (e) { setErr(e instanceof Error ? e.message : 'Erro.'); } finally { setPending(false); } };
  return <div className="page"><PageHeader title="Segurança" subtitle="Sua conta e as regras de acesso da plataforma."/>
    <div className="grid grid-2"><Panel title="Trocar minha senha"><div className="stack" data-tour="admin-password">
      <Field label="Nova senha (mínimo 12 caracteres)"><input type="password" autoComplete="new-password" value={pw} onChange={e => setPw(e.target.value)} minLength={12}/></Field>
      <Field label="Repita a nova senha"><input type="password" autoComplete="new-password" value={pw2} onChange={e => setPw2(e.target.value)}/></Field>
      <Button variant="primary" loading={pending} disabled={pw.length < 12} onClick={() => void save()}>Alterar senha</Button>{msg && <p role="status">{msg}</p>}{err && <p role="alert" className="field-error">{err}</p>}</div></Panel>
      <Panel title="Regras em vigor"><KeyValue items={[['Conta', email], ['Perfil', roleLabels[role]], ['Acesso administrativo', 'Login e senha + cadastro em administradores (verificado no servidor a cada ação)'],
        ['Verificação em duas etapas', 'Desativada por decisão do proprietário'], ['Sessão', 'Expira em 1 hora; renovação automática enquanto o app estiver aberto'], ['Senha mínima', '12 caracteres'],
        ['Rastreabilidade', 'Ações sensíveis exigem justificativa e ficam na auditoria']]}/>
        <p className="muted small">Proteção contra abuso: limites de envio de push, e-mail e IA por empresa; webhooks autenticados por token. Alterar essas regras exige mudança no servidor, não nesta tela.</p></Panel></div></div>;
}

export function PlatformSettings() {
  const plans = useQuery(() => rows<{ id: string; name: string; trial_days: number }>('plans', 'id,name,trial_days', b => b.order('sort')), []);
  return <div className="page"><PageHeader title="Configurações" subtitle="Parâmetros vigentes da plataforma. Valores com link são editados na página indicada."/>
    <div className="grid grid-2">
      <Panel title="Identidade PISTEC"><KeyValue items={[['Nome', 'PISTEC — Tecnologia que move seu negócio'], ['Logotipo', <img key="l" src="/brand/logo-horizontal.webp" alt="Logotipo PISTEC" height={32}/>], ['Cores', 'Azul-marinho #061B3D · Azul #007BFF · Ciano #00E5FF'], ['Contato da plataforma', 'pistec.gestao@gmail.com']]}/></Panel>
      <Panel title="Comercial"><Loaded q={plans}>{p => <KeyValue items={p.map(x => [`Teste grátis · ${x.name}`, `${x.trial_days} dias`] as [string, string])}/>}</Loaded><Link className="btn ghost" to="/admin/planos">Editar nos planos</Link></Panel>
      <Panel title="Assinaturas"><KeyValue items={[['Fatura de renovação', '5 dias antes do fim do período'], ['Tolerância após vencimento', '5 dias (depois: suspensão)'], ['Suspensão', 'Acesso somente leitura; dados preservados'], ['Cancelamento', 'Ao fim do período pago'], ['Rotina de cobrança', 'Diária às 03:15 UTC (pg_cron)']]}/></Panel>
      <Panel title="Notificações"><KeyValue items={[['Canais', 'No sistema, push e e-mail (quando o Resend estiver ativo)'], ['Limite de push', '30 por usuário a cada 10 minutos'], ['Limite de e-mail', '50 por empresa por hora'], ['Processamento', 'Worker a cada minuto']]}/><Link className="btn ghost" to="/admin/integracoes">Ver integrações</Link></Panel>
      <Panel title="Sistema"><KeyValue items={[['Ambiente', 'Produção (Supabase + Vercel)'], ['Versão do app', String(import.meta.env.VITE_APP_VERSION ?? 'build atual')], ['Service worker', 'Único (PWA + push)']]}/></Panel>
    </div></div>;
}
