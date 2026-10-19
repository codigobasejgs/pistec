import { createClient } from '@supabase/supabase-js';

// Importado somente pelo chunk /app. A demonstração não inicializa Auth nem faz chamadas remotas.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) throw new Error('Ambiente real indisponível: configure URL e chave pública do Supabase.');
export const supabase = createClient(url, key, {
  auth: { storageKey: 'pistec-real-auth', flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function realUrl(path: string) {
  if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Destino inválido.');
  return `${window.location.origin}/app${path}`;
}
