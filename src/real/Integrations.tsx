import { useCallback, useEffect, useState } from 'react';
import { supabase } from './client';
import { Badge, Button, Panel } from '../ui';

type Health = { config: Record<string, Record<string, boolean>>; flags: { billing: boolean; ai: boolean }; metrics: Record<string, unknown>; checkedAt: string };
const services: { key: string; name: string; metric?: string; error?: string }[] = [
  { key: 'InfinitePay', name: 'InfinitePay (cobrança das assinaturas)', metric: 'billing', error: 'billingLastError' },
  { key: 'Resend', name: 'Resend (e-mails)', metric: 'email', error: 'emailLastError' },
  { key: 'Evolution', name: 'Evolution API (WhatsApp)', metric: 'whatsapp' },
  { key: 'Gemini', name: 'Gemini (assistente IA)', metric: 'ai' },
  { key: 'WebPush', name: 'Web Push (notificações)', metric: 'push', error: 'pushLastError' },
  { key: 'Worker', name: 'Fila de automações', metric: 'outbox', error: 'outboxLastError' },
];
const fmt = (v: unknown) => v && typeof v === 'object' ? Object.entries(v).map(([k, n]) => `${k}: ${String(n)}`).join(' · ') || '—' : String(v ?? '—');

/** Painel do Super Admin: configuração (nomes de variáveis, nunca valores) e métricas reais do banco. */
export default function Integrations() {
  const [health, setHealth] = useState<Health | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(false);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    const { data, error } = await supabase.functions.invoke('admin-health', { body: {} });
    if (error || !data?.config) setError('Não foi possível consultar as integrações. Recarregue a página e tente de novo.');
    else setHealth(data);
    setLoading(false);
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <Panel title="Integrações da plataforma">
    <div className="toolbar"><Button loading={loading} onClick={() => void load()}>Verificar agora</Button>{health && <small>Última verificação: {new Date(health.checkedAt).toLocaleString('pt-BR')}</small>}</div>
    {error && <p role="alert">{error}</p>}
    {health && <div className="table-wrap"><table><caption>Estado real: variáveis configuradas no servidor e contadores do banco (últimos 7–30 dias)</caption>
      <thead><tr><th scope="col">Serviço</th><th scope="col">Configuração</th><th scope="col">Uso / fila</th><th scope="col">Última falha</th></tr></thead>
      <tbody>{services.map(s => { const vars = health.config[s.key] ?? {}; const missing = Object.entries(vars).filter(([, ok]) => !ok).map(([n]) => n);
        const err = s.error ? health.metrics[s.error] as Record<string, unknown> | null : null;
        return <tr key={s.key}><td>{s.name}</td>
          <td><Badge>{missing.length ? 'Pendente' : 'Configurado'}</Badge>{missing.length > 0 && <small> Falta: {missing.join(', ')}</small>}
            {s.key === 'InfinitePay' && !health.flags.billing && <small> (checkout desativado)</small>}{s.key === 'Gemini' && !health.flags.ai && <small> (IA desativada)</small>}</td>
          <td>{fmt(health.metrics[s.metric ?? ''])}{s.key === 'WebPush' && <> · Dispositivos: {String(health.metrics.pushDevices ?? 0)}</>}</td>
          <td>{err ? `${fmt(err)}` : '—'}</td></tr>; })}</tbody></table></div>}
    <p className="muted small">Nenhuma chave é exibida. Segredos ficam somente nas configurações do servidor (Supabase Secrets).</p>
  </Panel>;
}
