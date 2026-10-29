import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Activity, CheckCircle2, CircleDashed, RefreshCw, XCircle } from 'lucide-react';
import { Button, PageHeader, Panel, Stat } from '../../ui';
import { supabase } from '../client';
import { call, rows, useQuery } from './data';
import { useAdmin } from './context';
import { AdvancedTable, ConfirmAction, KeyValue, Loaded, StatusBadge } from './ui';
import Notifications from '../Notifications';

type Health = { config: Record<string, Record<string, boolean>>; flags: { billing: boolean; ai: boolean }; metrics: Record<string, unknown>;
  connectivity?: Record<string, { ok: boolean; detail: string; ms: number }>; checkedAt: string };
async function health(probe = false): Promise<Health> {
  const { data, error } = await supabase.functions.invoke('admin-health', { body: { probe } });
  if (error) { const d = await (error as { context?: Response }).context?.json?.().catch(() => null); throw new Error(d?.error ?? 'Não foi possível consultar as integrações.'); }
  return data;
}

// Estados separados: configuração (variáveis) ≠ conectividade (respondeu) ≠ operação (uso real observado).
const services: Record<string, { name: string; purpose: string; key: string; metric?: string; real?: string; error?: string; operational?: (m: Record<string, unknown>) => boolean; docs: string[] }> = {
  infinitepay: { name: 'InfinitePay', key: 'InfinitePay', purpose: 'Cobrança das assinaturas das empresas (checkout Pix/cartão e confirmação por webhook).', metric: 'billing', real: 'billing', error: 'billingLastError',
    operational: m => Number((m.billing as Record<string, number>)?.processed ?? 0) > 0, docs: ['Webhook: /functions/v1/billing-webhook?token=… (configurado no checkout).', 'Pagamento só é confirmado após consulta payment_check no servidor.', 'A API não tem recorrência automática: a renovação gera uma fatura nova 5 dias antes.'] },
  resend: { name: 'Resend', key: 'Resend', purpose: 'E-mails transacionais (boas-vindas, convites, faturas, avisos de vencimento).', metric: 'email', real: 'email', error: 'emailLastError',
    operational: m => Number((m.email as Record<string, number>)?.sent ?? 0) + Number((m.email as Record<string, number>)?.delivered ?? 0) > 0, docs: ['Pendências comuns: EMAIL_FROM exige domínio verificado no Resend.', 'RESEND_WEBHOOK_SECRET: crie o webhook apontando para /functions/v1/email-webhook.', 'Sem EMAIL_FROM os e-mails ficam na fila, sem se perder.'] },
  evolution: { name: 'Evolution API', key: 'Evolution', purpose: 'WhatsApp de cada loja (QR Code, mensagens recebidas e enviadas, bot com IA).', metric: 'whatsapp', real: 'whatsappOut',
    operational: m => Number((m.whatsapp as Record<string, number>)?.open ?? 0) > 0, docs: ['Cada loja conecta o próprio número em WhatsApp → Conectar.', 'Webhook por instância com token próprio; a chave global fica só no servidor.'] },
  gemini: { name: 'Gemini', key: 'Gemini', purpose: 'IA: assistente interno, Mecânico por voz e bot do WhatsApp, com limite diário por empresa e plano.', metric: 'ai', real: 'ai',
    operational: m => Number((m.ai as Record<string, number>)?.requests ?? 0) > 0, docs: ['AI_ENABLED=true libera o assistente na plataforma.', 'Cada empresa ativa a IA e o limite em Configurações da loja (até o limite do plano).'] },
  push: { name: 'Web Push', key: 'WebPush', purpose: 'Notificações no celular e computador, mesmo com o PISTEC fechado.', metric: 'push', real: 'push', error: 'pushLastError',
    operational: m => Number((m.push as Record<string, number>)?.sent ?? 0) > 0, docs: ['Chaves VAPID no servidor + VITE_VAPID_PUBLIC_KEY no frontend.', 'iPhone/iPad só recebem com o app instalado na Tela de Início (iOS 16.4+).'] },
  jobs: { name: 'Filas e automações', key: 'Worker', purpose: 'Worker executado a cada minuto (pg_cron): notificações, e-mails, push e cobrança diária.', metric: 'outbox', error: 'outboxLastError',
    operational: m => Number((m.outbox as Record<string, number>)?.done ?? 0) > 0, docs: ['Eventos com falha definitiva podem ser reprocessados em Automações e filas.'] },
};
const lastReal = (h: Health, s: typeof services[string]) => { const v = s.real ? (h.metrics.lastReal as Record<string, string | null> | undefined)?.[s.real] : null; return v ? new Date(v).toLocaleString('pt-BR') : 'Nenhuma registrada'; };
const fmt = (v: unknown) => v && typeof v === 'object' ? Object.entries(v).map(([k, n]) => `${k}: ${String(n)}`).join(' · ') || 'Nenhum uso ainda' : String(v ?? 'Nenhum uso ainda');

function stateOf(h: Health, s: typeof services[string]) {
  const vars = h.config[s.key] ?? {}; const missing = Object.entries(vars).filter(([, ok]) => !ok).map(([k]) => k);
  const conn = h.connectivity?.[s.key]; const err = s.error ? h.metrics[s.error] as Record<string, unknown> | null : null;
  const label = missing.length === Object.keys(vars).length ? 'Não configurado' : missing.length ? 'Configuração incompleta' : conn && !conn.ok ? 'Falha de conexão'
    : s.operational?.(h.metrics) ? (err ? 'Operacional com falhas recentes' : 'Operacional') : conn?.ok ? 'Conectado (sem uso registrado)' : 'Configurado (não testado)';
  return { missing, conn, err, label };
}
const Icon = ({ label }: { label: string }) => /^Operacional$/.test(label) ? <CheckCircle2 size={18} className="ok"/> : /Falha|Não config|incompleta/.test(label) ? <XCircle size={18} className="bad"/> : <CircleDashed size={18} className="warn"/>;

export function IntegrationsHub() {
  const { can } = useAdmin(); const [probe, setProbe] = useState(false);
  const q = useQuery(() => health(probe), [probe]);
  return <div className="page"><PageHeader title="Central de integrações" subtitle="Configuração, conectividade e uso real de cada serviço. Nenhuma chave é exibida.">
    {can('integrations.manage') && <Button icon={<RefreshCw size={15}/>} loading={q.loading && probe} onClick={() => { if (probe) q.reload(); else setProbe(true); }}>Testar conexões</Button>}</PageHeader>
    <Loaded q={q}>{h => <><p className="muted small">Última verificação: {new Date(h.checkedAt).toLocaleString('pt-BR')}{!h.connectivity && ' · conexões não testadas nesta visita'}</p>
      <div className="grid grid-3" data-tour="admin-integrations">{Object.entries(services).map(([slug, s]) => { const st = stateOf(h, s);
        return <Panel key={slug} className="integration-card"><div className="panel-heading"><h2><Icon label={st.label}/>{s.name}</h2><StatusBadge>{st.label}</StatusBadge></div><p className="muted small">{s.purpose}</p>
          <KeyValue items={[['Configuração', st.missing.length ? `Falta: ${st.missing.join(', ')}` : 'Completa'], ['Conectividade', st.conn ? `${st.conn.ok ? 'OK' : 'Falhou'} · ${st.conn.detail} (${st.conn.ms} ms)` : 'Não testada'],
            ['Uso registrado', fmt(h.metrics[s.metric ?? ''])], ['Última operação real', lastReal(h, s)], ['Última falha', st.err ? fmt(st.err) : 'Nenhuma']]}/>
          {slug !== 'jobs' && <Link className="btn ghost" to={`/admin/integracoes/${slug}`}>Detalhes</Link>}</Panel>; })}</div></>}</Loaded></div>;
}

export function IntegrationDetail() {
  const { slug = '' } = useParams(); const s = services[slug]; const { can } = useAdmin();
  const q = useQuery(() => health(can('integrations.manage')), [slug]);
  if (!s) return <p role="alert">Integração desconhecida.</p>;
  return <div className="page"><Link className="btn ghost" to="/admin/integracoes">← Central de integrações</Link><PageHeader title={s.name} subtitle={s.purpose}/>
    <Loaded q={q}>{h => { const st = stateOf(h, s); return <div className="grid grid-2">
      <Panel title="Situação"><KeyValue items={[['Estado', <StatusBadge key="s">{st.label}</StatusBadge>], ['Variáveis', Object.entries(h.config[s.key] ?? {}).map(([k, ok]) => `${ok ? '✓' : '✗'} ${k}`).join('  ')],
        ['Conectividade', st.conn ? `${st.conn.ok ? 'OK' : 'Falhou'} · ${st.conn.detail}` : 'Seu perfil não executa diagnóstico'], ['Uso', fmt(h.metrics[s.metric ?? ''])], ['Última operação real', lastReal(h, s)], ...(slug === 'evolution' ? [['Respostas do bot (7 dias)', fmt(h.metrics.bot)] as [string, string]] : []), ['Última falha', st.err ? fmt(st.err) : 'Nenhuma'],
        ...(slug === 'infinitepay' ? [['Checkout', h.flags.billing ? 'Ativado' : 'Desativado (BILLING_ENABLED)'] as [string, string]] : []), ...(slug === 'gemini' ? [['Assistente', h.flags.ai ? 'Ativado' : 'Desativado (AI_ENABLED)'] as [string, string]] : [])]}/></Panel>
      <Panel title="Como configurar"><ul>{s.docs.map(d => <li key={d}>{d}</li>)}</ul><p className="muted small">Segredos são definidos só no servidor (Supabase → Edge Functions → Secrets). Nunca cole chaves em campos desta tela.</p></Panel>
      {slug === 'gemini' && <AiUsage/>}{slug === 'evolution' && <WhatsAppUsage/>}{slug === 'push' && <Panel title="Notificações deste administrador"><Link className="btn" to="/admin/notificacoes">Ativar e testar push neste dispositivo</Link></Panel>}
    </div>; }}</Loaded></div>;
}

type Usage = { ai: { id: string; name: string; enabled: boolean | null; daily_limit: number | null; plan_limit: number; requests: number; input_tokens: number; output_tokens: number; blocked: number }[];
  whatsapp: { id: string; name: string; status: string; bot_enabled: boolean; received: number; sent: number; failed: number }[] };
function AiUsage() {
  const { can } = useAdmin(); const q = useQuery(() => call<Usage>('admin_usage', { p_days: 30 }), []); const [target, setTarget] = useState<Usage['ai'][number] | null>(null);
  // Estimativa: preço público do gemini-2.5-flash (US$ por 1M tokens) pode mudar; mostrado só como ordem de grandeza.
  const usd = (i: number, o: number) => (i * 0.30 + o * 2.50) / 1e6;
  return <Panel title="Consumo de IA por empresa (30 dias)"><Loaded q={q}>{u => u.ai.length ? <AdvancedTable caption="Consumo de IA" rows={u.ai} columns={[{ key: 'name', label: 'Empresa' },
    { key: 'on', label: 'IA', render: r => <StatusBadge>{r.enabled ? 'Ativa' : 'Desligada'}</StatusBadge> }, { key: 'req', label: 'Consultas', sort: r => r.requests, render: r => String(r.requests) },
    { key: 'tok', label: 'Tokens (entrada/saída)', render: r => `${r.input_tokens} / ${r.output_tokens}` }, { key: 'usd', label: 'Custo estimado', render: r => `≈ US$ ${usd(r.input_tokens, r.output_tokens).toFixed(4)}` },
    { key: 'lim', label: 'Limite/dia', render: r => `${r.daily_limit ?? '—'} (plano ${r.plan_limit})` }, { key: 'blk', label: 'Bloqueios/erros', render: r => String(r.blocked) },
    ...(can('integrations.manage') ? [{ key: 'a', label: 'Ação', render: (r: Usage['ai'][number]) => <Button onClick={() => setTarget(r)}>{r.enabled ? 'Suspender IA' : 'Liberar IA'}</Button> }] : [])]}/> : <p className="muted">Nenhuma empresa usou ou ativou a IA nos últimos 30 dias.</p>}</Loaded>
    <p className="muted small">Custo estimado pelo preço de tabela do modelo; a cobrança real está no console do Google AI.</p>
    <ConfirmAction open={!!target} title={target?.enabled ? 'Suspender IA da empresa' : 'Liberar IA da empresa'} confirmLabel="Confirmar" danger={!!target?.enabled} onClose={() => setTarget(null)}
      description={<p>{target?.name}: a mudança vale imediatamente e fica na auditoria.</p>} onConfirm={async r => { await call('admin_set_ai', { p_tenant: target!.id, p_enabled: !target!.enabled, p_limit: target!.daily_limit, p_reason: r }); q.reload(); }}/></Panel>;
}
function WhatsAppUsage() {
  const q = useQuery(() => call<Usage>('admin_usage', { p_days: 30 }), []);
  return <Panel title="WhatsApp por empresa (30 dias)"><Loaded q={q}>{u => u.whatsapp.length ? <AdvancedTable caption="WhatsApp" rows={u.whatsapp} columns={[{ key: 'name', label: 'Empresa' }, { key: 's', label: 'Conexão', render: r => <StatusBadge>{r.status === 'open' ? 'Conectado' : r.status === 'close' ? 'Desconectado' : 'Aguardando QR'}</StatusBadge> },
    { key: 'bot', label: 'Bot IA', render: r => r.bot_enabled ? 'Ligado' : 'Desligado' }, { key: 'in', label: 'Recebidas', sort: r => r.received, render: r => String(r.received) }, { key: 'out', label: 'Enviadas', render: r => String(r.sent) }, { key: 'f', label: 'Falhas', render: r => String(r.failed) }]}/>
    : <p className="muted">Nenhuma loja conectou o WhatsApp ainda.</p>}</Loaded><p className="muted small">Conteúdo das conversas não é exibido no painel administrativo.</p></Panel>;
}

type Ev = { id: number; type: string; status: string; attempts: number; last_error: string | null; created_at: string; processed_at: string | null; tenant_id: string | null };
export function Jobs() {
  const q = useQuery(() => rows<Ev>('outbox_events', 'id,type,status,attempts,last_error,created_at,processed_at,tenant_id', b => b.order('id', { ascending: false }).limit(300)), []);
  const hooks = useQuery(() => rows<{ id: number; provider: string; status: string; error: string | null; received_at: string; processed_at: string | null }>('webhook_events', 'id,provider,status,error,received_at,processed_at', b => b.order('id', { ascending: false }).limit(100)), []);
  const [retry, setRetry] = useState<Ev | null>(null), [status, setStatus] = useState('');
  const counts = (q.data ?? []).reduce<Record<string, number>>((a, e) => ({ ...a, [e.status]: (a[e.status] ?? 0) + 1 }), {});
  const avg = (() => { const done = (q.data ?? []).filter(e => e.processed_at); return done.length ? Math.round(done.reduce((s, e) => s + (new Date(e.processed_at!).getTime() - new Date(e.created_at).getTime()), 0) / done.length / 1000) : null; })();
  return <div className="page"><PageHeader title="Automações e filas" subtitle="Eventos gerados pelas operações (vendas, cadastros, cobranças) e processados pelo worker a cada minuto. Reprocessar não duplica notificações nem e-mails."/>
    <div className="grid grid-4"><Stat label="Pendentes" value={counts.pending ?? 0} tone="amber" icon={<Activity size={20}/>}/><Stat label="Em processamento" value={counts.processing ?? 0}/><Stat label="Concluídos" value={counts.done ?? 0} tone="green"/><Stat label="Falha definitiva" value={counts.dead ?? 0} tone="red" hint={avg != null ? `Tempo médio até processar: ${avg} s` : undefined}/></div>
    {status && <p role="status" className="callout">{status}</p>}
    <Panel title="Eventos recentes (300)"><Loaded q={q}>{list => <AdvancedTable caption="Eventos" tour="admin-jobs" rows={list.map(e => ({ ...e, id: String(e.id), raw: e }))} search={e => `${e.id} ${e.type} ${e.status} ${e.last_error ?? ''}`} columns={[
      { key: 'id', label: 'ID', render: e => <code>{e.id}</code> }, { key: 'type', label: 'Tipo', sort: e => e.type }, { key: 'status', label: 'Situação', sort: e => e.status, render: e => <StatusBadge>{{ pending: 'Pendente', processing: 'Processando', done: 'Concluído', dead: 'Falha definitiva' }[e.status] ?? e.status}</StatusBadge> },
      { key: 'att', label: 'Tentativas', render: e => String(e.attempts) }, { key: 'err', label: 'Erro', render: e => e.last_error ?? '—' }, { key: 'at', label: 'Criado', sort: e => e.created_at, render: e => new Date(e.created_at).toLocaleString('pt-BR') },
      { key: 'a', label: 'Ação', render: e => e.status === 'dead' ? <Button onClick={() => setRetry(e.raw)}>Reprocessar</Button> : '—' }]}/>}</Loaded></Panel>
    <Panel title="Webhooks recebidos (InfinitePay)"><Loaded q={hooks}>{list => list.length ? <AdvancedTable caption="Webhooks" rows={list.map(w => ({ ...w, id: String(w.id) }))} columns={[{ key: 'p', label: 'Provedor', render: w => w.provider }, { key: 's', label: 'Situação', render: w => <StatusBadge>{w.status}</StatusBadge> },
      { key: 'e', label: 'Erro', render: w => w.error ?? '—' }, { key: 'r', label: 'Recebido', render: w => new Date(w.received_at).toLocaleString('pt-BR') }]}/> : <p className="muted">Nenhum webhook recebido ainda.</p>}</Loaded></Panel>
    <ConfirmAction open={!!retry} title={`Reprocessar evento ${retry?.id}`} confirmLabel="Reprocessar" onClose={() => setRetry(null)} description={<p>O evento <strong>{retry?.type}</strong> volta para a fila. Notificações e e-mails já entregues não se repetem (deduplicação no banco).</p>}
      onConfirm={async r => { await call('admin_retry_event', { p_id: retry!.id, p_reason: r }); setStatus('Evento devolvido à fila.'); q.reload(); }}/>
  </div>;
}

/** Push do próprio administrador: reaproveita a central de notificações das lojas (mesmo service worker). */
export function AdminPush() {
  return <div className="page"><PageHeader title="Notificações e push" subtitle="Ative o push neste dispositivo para receber alertas da plataforma (novas empresas, pagamentos, falhas)."/>
    <PushStats/><Notifications scope="platform"/></div>;
}
function PushStats() {
  const q = useQuery(() => health(false), []);
  return <Loaded q={q}>{h => { const p = (h.metrics.push ?? {}) as Record<string, number>; return <div className="grid grid-4"><Stat label="Dispositivos ativos" value={String(h.metrics.pushDevices ?? 0)}/><Stat label="Entregues (7 dias)" value={p.sent ?? 0} tone="green"/>
    <Stat label="Expirados (7 dias)" value={p.expired ?? 0} tone="amber"/><Stat label="Falhas (7 dias)" value={p.dead ?? 0} tone="red" hint={h.config.WebPush && Object.values(h.config.WebPush).every(Boolean) ? 'VAPID configurado' : 'VAPID incompleto'}/></div>; }}</Loaded>;
}
