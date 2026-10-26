import { useCallback, useEffect, useState } from 'react';
import { useDemo } from '../store';
import { supabase } from './client';
import { Button, PageHeader, Panel } from '../ui';
import { currentSubscription, disablePush, enablePush, pushSupport, resyncPush } from './push';

type Notification = { id: string; type: string; title: string; body: string; created_at: string; read_at: string | null };
type Device = { id: string; user_agent: string; created_at: string; last_success_at: string | null; expired_at: string | null; endpoint: string };
type Delivery = { id: number; status: string; created_at: string; notifications: { title: string } | null };

// Categorias que o usuário pode silenciar (tipos de evento do outbox).
export const categories: [string, string][] = [
  ['stock.low', 'Estoque baixo'], ['sale.completed', 'Vendas concluídas'], ['sale.cancelled', 'Vendas canceladas'],
  ['record.created', 'Novos registros (OS, orçamentos, agenda)'], ['record.status', 'Mudança de status de atendimento'],
  ['cash.difference', 'Diferença no caixa'], ['whatsapp.inbound', 'Nova mensagem no WhatsApp'],
  ['invoice.created', 'Faturas da assinatura'], ['invoice.overdue', 'Fatura vencida'], ['subscription.trial_ending', 'Fim do período de teste'],
];
const supportText: Record<string, string> = {
  unsupported: 'Este navegador não oferece notificações push. Use Chrome, Edge, Firefox ou Safari atualizados.',
  'ios-install': 'No iPhone e iPad, instale o PISTEC na Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra pelo ícone para ativar notificações.',
  'no-sw': 'O aplicativo ainda não está instalado neste navegador. Recarregue a página.',
  'no-key': 'Notificações push ainda não foram configuradas pelo administrador da plataforma.',
};
const device = (ua: string) => /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'Mac' : /Linux/.test(ua) ? 'Linux' : 'Navegador';
const browser = (ua: string) => /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : '';
const when = (iso: string | null) => iso ? new Date(iso).toLocaleString('pt-BR') : '—';
const deliveryStatus: Record<string, string> = { pending: 'Na fila', processing: 'Enviando', sent: 'Entregue ao aparelho', expired: 'Dispositivo expirado', dead: 'Falhou', skipped: 'Ignorado' };

/** scope 'platform': Super Admin (sem empresa): só push, dispositivos e histórico; alertas ficam em /admin/alertas. */
export default function Notifications({ scope = 'tenant' }: { scope?: 'tenant' | 'platform' }) {
  const { session } = useDemo();
  const platform = scope === 'platform';
  const [items, setItems] = useState<Notification[]>([]), [filter, setFilter] = useState<'all' | 'unread'>('unread');
  const [devices, setDevices] = useState<Device[]>([]), [history, setHistory] = useState<Delivery[]>([]), [thisEndpoint, setThisEndpoint] = useState<string | null>(null);
  const [prefs, setPrefs] = useState({ push: true, email: true, muted: [] as string[] });
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [pending, setPending] = useState(false);
  const support = pushSupport();

  const load = useCallback(async () => {
    const [n, reads, d, h, p] = await Promise.all([
      (platform ? supabase.from('notifications').select('id,type,title,body,created_at,read_at').is('tenant_id', null) : supabase.from('notifications').select('id,type,title,body,created_at,read_at').eq('tenant_id', session.tenantId)).order('created_at', { ascending: false }).limit(100),
      supabase.from('notification_reads').select('notification_id,read_at'),
      supabase.from('push_subscriptions').select('id,user_agent,created_at,last_success_at,expired_at,endpoint').order('created_at', { ascending: false }),
      supabase.from('notification_deliveries').select('id,status,created_at,notifications(title)').order('id', { ascending: false }).limit(20),
      platform ? Promise.resolve({ data: null, error: null }) : supabase.from('notification_preferences').select('push,email,muted_types').eq('tenant_id', session.tenantId).maybeSingle(),
    ]);
    if (n.error || reads.error || d.error || h.error || p.error) { setError('Não foi possível carregar as notificações. Verifique sua conexão e tente de novo.'); return; }
    const seen = new Map((reads.data ?? []).map(r => [r.notification_id, r.read_at]));
    setItems((n.data ?? []).map(x => ({ ...x, read_at: x.read_at ?? seen.get(x.id) ?? null })));
    setDevices(d.data ?? []); setHistory((h.data ?? []) as unknown as Delivery[]);
    if (p.data) setPrefs({ push: p.data.push, email: p.data.email, muted: p.data.muted_types ?? [] });
    setThisEndpoint((await currentSubscription().catch(() => null))?.endpoint ?? null);
    setError('');
  }, [session.tenantId, platform]);

  useEffect(() => {
    void load(); void resyncPush();
    if (platform) return;
    const channel = supabase.channel(`notifications:${session.tenantId}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `tenant_id=eq.${session.tenantId}` }, () => void load()).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, session.tenantId, platform]);

  async function run(action: () => Promise<unknown>, done: string) {
    setPending(true); setError(''); setStatus('');
    try { await action(); setStatus(done); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir. Tente novamente.'); }
    finally { setPending(false); }
  }
  const rpc = async (fn: string, args: object) => { const { data, error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message); return data; };
  const savePrefs = (next: typeof prefs) => run(() => rpc('save_notification_preferences', { p_tenant: session.tenantId, p: { inApp: true, push: next.push, email: next.email, mutedTypes: next.muted } }), 'Preferências salvas.');
  const shown = filter === 'unread' ? items.filter(n => !n.read_at) : items;
  const unread = items.filter(n => !n.read_at);

  return <div className="page"><PageHeader title="Notificações" subtitle="Avisos da empresa, notificações no celular e computador, e preferências."/>
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{pending ? 'Processando…' : status}</p>

    {!platform && <Panel title="Caixa de entrada">
      <div className="toolbar" role="group" aria-label="Filtro">
        <Button variant={filter === 'unread' ? 'primary' : undefined} onClick={() => setFilter('unread')}>Não lidas ({unread.length})</Button>
        <Button variant={filter === 'all' ? 'primary' : undefined} onClick={() => setFilter('all')}>Todas</Button>
        {unread.length > 0 && <Button disabled={pending} onClick={() => void run(() => rpc('mark_notifications_read', { p_ids: unread.map(n => n.id) }), 'Todas marcadas como lidas.')}>Marcar todas como lidas</Button>}
      </div>
      {shown.length === 0 ? <p>{filter === 'unread' ? 'Nenhuma notificação nova.' : 'Nenhuma notificação ainda.'}</p> : <ul className="stack">{shown.map(n => <li key={n.id}>
        <strong>{n.title}</strong><p>{n.body}</p><time dateTime={n.created_at}>{when(n.created_at)}</time>
        {!n.read_at && <Button disabled={pending} onClick={() => void run(() => rpc('mark_notifications_read', { p_ids: [n.id] }), 'Notificação marcada como lida.')}>Marcar como lida</Button>}
      </li>)}</ul>}
    </Panel>}

    <Panel title="Notificações push neste dispositivo">
      {support !== 'ok' ? <p role="status">{supportText[support]}</p> : thisEndpoint
        ? <><p>Ativadas neste dispositivo. Você recebe avisos mesmo com o PISTEC fechado. Por segurança, a tela bloqueada mostra só o tipo do aviso.</p>
            <div className="toolbar"><Button disabled={pending} onClick={() => void run(() => (platform ? rpc('send_test_push_platform', {}) : rpc('send_test_push', { p_tenant: session.tenantId })), 'Teste enviado. Deve chegar em até 1 minuto.')}>Enviar teste</Button>
            <Button disabled={pending} onClick={() => void run(disablePush, 'Notificações desativadas neste dispositivo.')}>Desativar neste dispositivo</Button></div></>
        : <><p>{typeof Notification !== 'undefined' && Notification.permission === 'denied' ? 'As notificações estão bloqueadas neste navegador. Libere nas configurações do site (ícone de cadeado) e clique em Ativar.' : 'Receba avisos de estoque baixo, novas OS, mensagens e cobranças no celular ou computador.'}</p>
            <Button variant="primary" disabled={pending} onClick={() => void run(enablePush, 'Notificações ativadas neste dispositivo.')}>Ativar notificações</Button></>}
    </Panel>

    <Panel title="Dispositivos registrados">
      {devices.length === 0 ? <p>Nenhum dispositivo registrado.</p> : <ul className="stack">{devices.map(d => <li key={d.id}>
        <strong>{device(d.user_agent)} {browser(d.user_agent)}</strong>{d.endpoint === thisEndpoint && ' (este dispositivo)'}
        <p>Registrado em {when(d.created_at)} · Última entrega: {when(d.last_success_at)}{d.expired_at && ' · Expirado: ative de novo nesse aparelho'}</p>
        <Button disabled={pending} onClick={() => void run(() => rpc('delete_push_subscription', { p_endpoint: d.endpoint }), 'Dispositivo removido.')}>Remover</Button>
      </li>)}</ul>}
    </Panel>

    {!platform && <Panel title="Preferências">
      <fieldset disabled={pending}><legend>Canais</legend>
        <label><input type="checkbox" checked={prefs.push} onChange={e => { const next = { ...prefs, push: e.target.checked }; setPrefs(next); void savePrefs(next); }}/> Notificações push</label>
        <label><input type="checkbox" checked={prefs.email} onChange={e => { const next = { ...prefs, email: e.target.checked }; setPrefs(next); void savePrefs(next); }}/> E-mail</label>
      </fieldset>
      <fieldset disabled={pending || !prefs.push}><legend>Receber push sobre</legend>
        {categories.map(([type, label]) => <label key={type} style={{ display: 'block' }}><input type="checkbox" checked={!prefs.muted.includes(type)} onChange={e => {
          const next = { ...prefs, muted: e.target.checked ? prefs.muted.filter(m => m !== type) : [...prefs.muted, type] }; setPrefs(next); void savePrefs(next);
        }}/> {label}</label>)}
        <p className="muted small">Você só recebe avisos dos módulos que seu perfil pode ver.</p>
      </fieldset>
    </Panel>}

    <Panel title="Histórico de envios push">
      {history.length === 0 ? <p>Nenhum envio ainda.</p> : <div className="table-wrap"><table><caption>Últimos 20 envios para seus dispositivos</caption>
        <thead><tr><th scope="col">Aviso</th><th scope="col">Quando</th><th scope="col">Situação</th></tr></thead>
        <tbody>{history.map(h => <tr key={h.id}><td>{h.notifications?.title ?? '—'}</td><td>{when(h.created_at)}</td><td>{deliveryStatus[h.status] ?? h.status}</td></tr>)}</tbody></table></div>}
    </Panel>
  </div>;
}
