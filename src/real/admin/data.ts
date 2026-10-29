import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../client';

// Camada única de dados do Super Admin. Toda autorização é revalidada no servidor (RLS + app.require_admin).
export type AdminRole = 'owner' | 'admin' | 'finance' | 'sales' | 'support' | 'ops' | 'auditor';
export const roleLabels: Record<AdminRole, string> = {
  owner: 'Proprietário da plataforma', admin: 'Super Admin', finance: 'Administrador financeiro', sales: 'Administrador comercial',
  support: 'Suporte', ops: 'Operações', auditor: 'Auditor (somente leitura)',
};
// Espelho de app.admin_perm (SQL). Só decide o que MOSTRAR; o servidor decide o que é permitido.
export function adminCan(role: AdminRole | null, perm: string): boolean {
  if (!role) return false;
  if (role === 'owner') return true;
  if (role === 'admin') return perm !== 'admins.manage';
  const map: Record<string, string[]> = {
    finance: ['billing.read', 'billing.manage', 'coupons.manage', 'subscriptions.manage', 'audit.read'],
    sales: ['leads.manage'], support: ['support.manage', 'tenants.edit'],
    ops: ['integrations.manage', 'jobs.retry', 'broadcast', 'audit.read'], auditor: ['audit.read', 'billing.read'],
  };
  return (map[role] ?? []).includes(perm);
}

/** Mensagem amigável: erros de regra do banco (P0001/42501) já vêm em português; o resto vira texto genérico. */
export function friendly(error: unknown): string {
  const e = error as { message?: string; code?: string } | null;
  if (e?.message && (e.code === 'P0001' || e.code === '42501' || /[áéíóúãõç]/i.test(e.message))) return e.message;
  if (e?.message && /fetch|network|Failed to fetch/i.test(e.message)) return 'Sem conexão com o servidor. Verifique a internet e tente novamente.';
  return 'Não foi possível concluir. Tente novamente em instantes.';
}

export async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendly(error));
  return data as T;
}

// ponytail: builder sem tipos de schema (não há tipos gerados do banco); colunas validadas pelos testes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Builder = any;
export async function rows<T>(table: string, columns = '*', build?: (q: Builder) => Builder): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += 500) {
    let q: Builder = supabase.from(table).select(columns);
    if (build) q = build(q);
    const { data, error } = await q.range(offset, offset + 499);
    if (error) throw new Error(friendly(error));
    out.push(...(data as T[]));
    if ((data ?? []).length < 500) return out;
  }
}

/** Carregamento com estados de loading/erro/recarga. */
export function useQuery<T>(load: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true), [rev, setRev] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);
  useEffect(() => {
    let alive = true; setLoading(true); setError('');
    run().then(v => { if (alive) setData(v); }).catch(e => { if (alive) setError(friendly(e)); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [run, rev]);
  return { data, error, loading, reload: () => setRev(n => n + 1) };
}

export type TenantRow = { id: string; slug: string; name: string; legal_name: string; document: string; owner_name: string; email: string; phone: string;
  plan_id: string; status: string; due_date: string; created_at: string; profile: string };
export type PlanRow = { id: string; name: string; monthly: number; quarterly: number; annual: number; users: number; branches: number; products: number;
  whatsapp: number; ai_messages: number; trial_days: number; trial_months: number; features: string[]; modules: string[]; active: boolean; sort: number };
export type InvoiceRow = { id: string; tenant_id: string; plan_id: string; period: string; amount: number; original_amount: number; discount: number; coupon_code: string | null;
  status: string; due_date: string; provider: string; request_id: string; paid_at: string | null; paid_amount: number | null; capture_method: string | null; created_at: string };
export type RecordRow = { id: string; kind: string; title: string; status: string; date: string; fields: Record<string, string>; history: { date: string; text: string; author?: string; internal?: boolean }[] };
export type SubscriptionRow = { tenant_id: string; plan_id: string; period: string; status: string; current_period_end: string; provider: string; cancel_at_period_end: boolean; updated_at: string };

export const tenantStatus: Record<string, string> = { Teste: 'Em teste', Ativa: 'Ativa', Vencida: 'Inadimplente', Suspensa: 'Suspensa', Cancelada: 'Cancelada', Pendente: 'Pendente' };
export const subscriptionStatus: Record<string, string> = { trialing: 'Em teste', active: 'Ativa', past_due: 'Vencida (tolerância)', suspended: 'Suspensa', cancelled: 'Cancelada' };
export const periods: Record<string, string> = { monthly: 'Mensal', quarterly: 'Trimestral', annual: 'Anual' };
export const daysUntil = (iso: string) => Math.ceil((new Date(iso.slice(0, 10) + 'T12:00:00').getTime() - Date.now()) / 86400000);
