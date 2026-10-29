import { useCallback, useEffect, useState } from 'react';
import { useDemo } from '../../store';
import { DEFAULT_WORKSHOP, workshopOf, type WorkshopSettings } from '../../services/workshop';

const key = (tenant: string) => `pistec-workshop:${tenant}`;
/** Configurações da oficina: real = RPC workshop_settings (custo/hora oculto sem permissão); demo = localStorage do navegador. */
export function useWorkshop() {
  const { mode, session } = useDemo();
  const [settings, setSettings] = useState<WorkshopSettings>(DEFAULT_WORKSHOP), [error, setError] = useState('');
  const load = useCallback(async () => {
    if (mode === 'demo') { try { setSettings(workshopOf(JSON.parse(localStorage.getItem(key(session.tenantId)) || '{}'))); } catch { setSettings(DEFAULT_WORKSHOP); } return; }
    const { supabase } = await import('../../real/client');
    const { data, error } = await supabase.rpc('workshop_settings', { p_tenant: session.tenantId });
    if (error) setError(error.message); else setSettings(workshopOf(data));
  }, [mode, session.tenantId]);
  useEffect(() => { void load(); }, [load]);
  async function call(fn: string, args: Record<string, unknown>, demo: (s: WorkshopSettings) => WorkshopSettings) {
    if (mode === 'demo') { const next = demo(settings); try { localStorage.setItem(key(session.tenantId), JSON.stringify(next)); } catch { /* armazenamento indisponível */ } setSettings(next); return; }
    const { supabase } = await import('../../real/client');
    const { error } = await supabase.rpc(fn, { p_tenant: session.tenantId, ...args }); if (error) throw new Error(error.message);
    await load();
  }
  const { dismissed: _dismissed, ...editable } = settings; void _dismissed;
  return {
    settings, error, reload: load,
    save: (patch: Partial<WorkshopSettings>) => call('save_workshop_settings', { p: { ...editable, ...patch } }, s => ({ ...s, ...patch })),
    dismiss: (alertKey: string, until: string) => call('dismiss_alert', { p_key: alertKey, p_until: until }, s => ({ ...s, dismissed: { ...s.dismissed, [alertKey]: until } })),
  };
}
