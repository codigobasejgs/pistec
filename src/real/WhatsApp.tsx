import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useDemo } from '../store';
import { supabase } from './client';
import { Button, Field, PageHeader, Panel } from '../ui';

type Instance = { id: string; status: string; bot_enabled: boolean; phone: string };
type Contact = { id: string; remote_jid: string; name: string; assigned_to: string | null; bot_paused: boolean; last_message_at: string };
type Message = { id: string; direction: 'in' | 'out'; body: string; created_at: string; status: string };

const QUICK = ['Olá! Já vamos verificar e retornamos em instantes.', 'Seu veículo está pronto para retirada.', 'O orçamento foi enviado. Pode confirmar se aprova?'];
const phone = (jid: string) => jid.replace('@s.whatsapp.net', '');
const stateText: Record<string, string> = { open: 'Conectado', connecting: 'Aguardando leitura do QR Code', close: 'Desconectado', created: 'Criado' };

async function call(tenantId: string, action: string, extra: object = {}) {
  const { data, error } = await supabase.functions.invoke('whatsapp', { body: { tenantId, action, ...extra } });
  if (error) {
    const detail = await (error as { context?: Response }).context?.json?.().catch(() => null);
    throw new Error(detail?.error ?? 'Serviço de WhatsApp indisponível. Tente novamente em instantes.');
  }
  return data;
}

export default function WhatsApp() {
  const { session } = useDemo();
  const [instance, setInstance] = useState<Instance | null>(null), [contacts, setContacts] = useState<Contact[]>([]), [messages, setMessages] = useState<Message[]>([]);
  const [selected, setSelected] = useState(''), [text, setText] = useState(''), [qr, setQr] = useState<string | null>(null);
  const [error, setError] = useState(''), [status, setStatus] = useState(''), [pending, setPending] = useState(false), [loading, setLoading] = useState(true), [me, setMe] = useState<string | null>(null);
  useEffect(() => { void supabase.auth.getUser().then(({ data }) => setMe(data.user?.id ?? null)); }, []);
  const current = contacts.find(c => c.id === selected);
  const canManage = ['Proprietário', 'Administrador'].includes(session.role);

  const load = useCallback(async () => {
    const [i, c] = await Promise.all([
      supabase.from('whatsapp_instances').select('id,status,bot_enabled,phone').eq('tenant_id', session.tenantId).neq('status', 'archived').order('created_at').limit(1).maybeSingle(),
      supabase.from('whatsapp_contacts').select('id,remote_jid,name,assigned_to,bot_paused,last_message_at').eq('tenant_id', session.tenantId).order('last_message_at', { ascending: false }).limit(100),
    ]);
    if (i.error || c.error) setError('Não foi possível carregar o WhatsApp. Verifique se seu perfil tem acesso.');
    else { setInstance(i.data); setContacts(c.data ?? []); }
    setLoading(false);
  }, [session.tenantId]);

  const loadMessages = useCallback(async (contact: Contact) => {
    const { data, error } = await supabase.from('whatsapp_messages').select('id,direction,body,created_at,status').eq('tenant_id', session.tenantId).eq('remote_jid', contact.remote_jid).order('created_at').limit(200);
    if (error) setError('Não foi possível carregar a conversa.'); else setMessages(data ?? []);
  }, [session.tenantId]);

  // Nova mensagem atualiza o contato (last_message_at) → recarrega lista → recarrega a conversa aberta.
  useEffect(() => {
    void load();
    const channel = supabase.channel(`wa:${session.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'whatsapp_contacts', filter: `tenant_id=eq.${session.tenantId}` }, () => void load())
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [load, session.tenantId]);
  useEffect(() => { if (current) void loadMessages(current); }, [current, loadMessages]);

  async function run(action: () => Promise<unknown>, done: string) {
    setPending(true); setError(''); setStatus('');
    try { await action(); setStatus(done); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); }
    finally { setPending(false); }
  }
  const rpc = async (fn: string, args: object) => { const { error } = await supabase.rpc(fn, args); if (error) throw new Error(error.message); };
  async function send(e: FormEvent) {
    e.preventDefault(); if (!current || !text.trim()) return;
    await run(async () => { await call(session.tenantId, 'send', { to: phone(current.remote_jid), text: text.trim() }); setText(''); await loadMessages(current); }, 'Mensagem enviada.');
  }

  if (loading) return <div className="page"><p role="status">Carregando WhatsApp…</p></div>;
  return <div className="page"><PageHeader title="WhatsApp" subtitle="Atendimento pelo WhatsApp da loja, com histórico salvo no PISTEC."/>
    {error && <p role="alert">{error}</p>}<p role="status" aria-live="polite">{pending ? 'Processando…' : status}</p>

    <Panel title="Conexão">
      <p>Situação: <strong>{instance ? stateText[instance.status] ?? instance.status : 'Nenhum número conectado'}</strong></p>
      {canManage && <div className="toolbar">
        {instance?.status !== 'open' && <Button variant="primary" disabled={pending} onClick={() => void run(async () => { const r = await call(session.tenantId, 'connect'); setQr(r?.qr ?? null); }, 'Abra o WhatsApp no celular → Aparelhos conectados → Conectar aparelho, e leia o QR Code.')}>{instance ? 'Gerar novo QR Code' : 'Conectar WhatsApp'}</Button>}
        {instance && <Button disabled={pending} onClick={() => void run(async () => { await call(session.tenantId, 'state'); setQr(null); }, 'Situação atualizada.')}>Verificar conexão</Button>}
        {instance?.status === 'open' && <Button disabled={pending} onClick={() => { if (window.confirm('Desconectar o WhatsApp da loja? As mensagens deixam de chegar até reconectar.')) void run(() => call(session.tenantId, 'logout'), 'WhatsApp desconectado.'); }}>Desconectar</Button>}
        {instance && <label><input type="checkbox" checked={instance.bot_enabled} disabled={pending} onChange={e => void run(() => rpc('set_whatsapp_bot', { p_tenant: session.tenantId, p_instance: instance.id, p_enabled: e.target.checked }), e.target.checked ? 'Assistente automático ativado.' : 'Assistente automático desativado.')}/> Assistente automático (IA) responde clientes</label>}
      </div>}
      {qr && <img src={qr} alt="QR Code para conectar o WhatsApp da loja" width={260} height={260}/>}
      {!canManage && !instance && <p>Peça ao proprietário para conectar o WhatsApp da loja.</p>}
    </Panel>

    <div className="grid grid-2">
      <Panel title={`Conversas (${contacts.length})`}>
        {contacts.length === 0 ? <p>Nenhuma conversa ainda. Elas aparecem aqui quando um cliente envia mensagem.</p> : <ul className="stack">{contacts.map(c => <li key={c.id}>
          <button className={`btn ${c.id === selected ? 'primary' : ''}`} onClick={() => setSelected(c.id)}>{c.name || phone(c.remote_jid)}</button>
          <small> {new Date(c.last_message_at).toLocaleString('pt-BR')}{c.bot_paused && ' · atendimento humano'}</small>
        </li>)}</ul>}
      </Panel>
      <Panel title={current ? `Conversa com ${current.name || phone(current.remote_jid)}` : 'Selecione uma conversa'}>
        {current && <>
          <div className="toolbar">
            <Button disabled={pending || !me} onClick={() => void run(() => rpc('assign_whatsapp_contact', { p_tenant: session.tenantId, p_contact: current.id, p_user: current.assigned_to ? null : me, p_bot_paused: !current.assigned_to }),
              current.assigned_to ? 'Conversa liberada.' : 'Você assumiu o atendimento. O assistente automático foi pausado nesta conversa.')}>{current.assigned_to ? 'Liberar conversa' : 'Assumir atendimento'}</Button>
            {current.bot_paused && <Button disabled={pending} onClick={() => void run(() => rpc('assign_whatsapp_contact', { p_tenant: session.tenantId, p_contact: current.id, p_user: current.assigned_to, p_bot_paused: false }), 'Assistente automático reativado nesta conversa.')}>Devolver ao assistente</Button>}
          </div>
          <ol className="stack" aria-label="Mensagens" style={{ maxHeight: 420, overflowY: 'auto' }}>{messages.map(m => <li key={m.id} style={{ textAlign: m.direction === 'out' ? 'right' : 'left' }}>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{m.body || '(mídia)'}</p><small>{m.direction === 'out' ? 'Loja' : 'Cliente'} · {new Date(m.created_at).toLocaleString('pt-BR')}</small></li>)}</ol>
          <form className="stack" onSubmit={send}>
            <Field label="Resposta"><textarea required maxLength={4000} value={text} onChange={e => setText(e.target.value)}/></Field>
            <div className="toolbar">{QUICK.map(q => <Button key={q} onClick={() => setText(q)}>{q.slice(0, 28)}…</Button>)}</div>
            <Button type="submit" variant="primary" disabled={pending || instance?.status !== 'open'}>Enviar</Button>
            {instance?.status !== 'open' && <small>Conecte o WhatsApp para enviar.</small>}
          </form>
        </>}
      </Panel>
    </div>
  </div>;
}
