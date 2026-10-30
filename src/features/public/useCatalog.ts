import { useEffect, useState } from 'react';
import { useDemo } from '../../store';
import { FEATURES, featureInPlan, type CatalogPlan, type Feature } from '../../services/catalog';

export interface Catalog { plans: (CatalogPlan & { features: string[] })[]; features: Feature[]; source: 'servidor' | 'local' }

/** Planos e recursos: do servidor (plan_catalog) quando o site público tem backend; senão do seed local (mesmos valores, verificado em catalog.test.ts). */
export function useCatalog(): Catalog {
  const { state } = useDemo();
  const local: Catalog = { source: 'local', features: FEATURES, plans: state.plans.map(p => {
    const modules = p.modules ?? ['*'];
    return { id: p.id, name: p.name, monthly: p.monthly, quarterly: p.quarterly, annual: p.annual, users: p.users, branches: p.branches, products: p.products, whatsapp: p.whatsapp,
      trialMonths: p.trialMonths, aiMessages: p.aiMessages ?? 0, modules, selfService: p.id !== 'enterprise', features: FEATURES.filter(f => featureInPlan(f, modules)).map(f => f.key) };
  }) };
  const [remote, setRemote] = useState<Catalog | null>(null);
  useEffect(() => {
    if (!import.meta.env.VITE_SUPABASE_URL || import.meta.env.MODE === 'test') return;
    let alive = true;
    // Só o catálogo público (anônimo); nenhum dado de empresa. Falha → mantém os valores locais.
    void fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/plan_catalog`, { method: 'POST', headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(6000) })
      .then(r => r.ok ? r.json() : null).then(j => { if (alive && j?.plans?.length) setRemote({ ...j, source: 'servidor' }); }).catch(() => null);
    return () => { alive = false; };
  }, []);
  return remote ?? local;
}
