import { useEffect, useSyncExternalStore } from 'react';

/** Estado do PWA compartilhado: capturado no boot, antes de qualquer tela montar. */
interface InstallPrompt extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
interface PwaState { installPrompt: InstallPrompt | null; waiting: ServiceWorker | null; online: boolean }
let state: PwaState = { installPrompt: null, waiting: null, online: typeof navigator === 'undefined' ? true : navigator.onLine };
const listeners = new Set<() => void>();
const set = (patch: Partial<PwaState>) => { state = { ...state, ...patch }; listeners.forEach(l => l()); };
export const usePwa = () => useSyncExternalStore(cb => { listeners.add(cb); return () => listeners.delete(cb); }, () => state, () => state);

export const isStandalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
/** iPhone/iPod ou iPad (iPadOS 13+ se apresenta como Mac com toque). */
export const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// Operações em andamento (modais abertos, carrinho com itens): a atualização pede confirmação antes de recarregar.
let busy = 0;
export function useBusyGuard(active: boolean) { useEffect(() => { if (!active) return; busy++; return () => { busy--; }; }, [active]); }

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const p = state.installPrompt; if (!p) return 'unavailable';
  await p.prompt(); const { outcome } = await p.userChoice; set({ installPrompt: null }); return outcome;
}

/** Ativa a versão nova só por decisão do usuário; recarrega quando ela assume o controle. */
export function applyUpdate(): boolean {
  if (!state.waiting) return false;
  if (busy > 0 && !confirm('Há uma operação em andamento (formulário aberto ou venda no carrinho). Atualizar agora vai recarregar a tela e descartar o que não foi salvo. Atualizar mesmo assim?')) return false;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  state.waiting.postMessage('SKIP_WAITING');
  return true;
}

export function initPwa() {
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); set({ installPrompt: e as InstallPrompt }); });
  addEventListener('appinstalled', () => set({ installPrompt: null }));
  const checkConnection = () => {
    if (!navigator.onLine) { set({ online: false }); return; }
    if (!import.meta.env.PROD) { set({ online: true }); return; }
    // A query exclui o arquivo do precache: verifica o servidor sem cachear dados.
    void fetch(`/manifest.webmanifest?connectivity=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      .then(r => set({ online: r.ok })).catch(() => set({ online: false }));
  };
  checkConnection();
  addEventListener('online', checkConnection);
  addEventListener('pistec:check-connection', checkConnection);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') checkConnection(); });
  addEventListener('offline', () => set({ online: false }));
  // Só em produção: no dev o SW interferiria no recarregamento de módulos.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('/sw.js').then(reg => {
    const watch = (w: ServiceWorker | null) => w?.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) set({ waiting: w }); });
    if (reg.waiting && navigator.serviceWorker.controller) set({ waiting: reg.waiting });
    watch(reg.installing);
    reg.addEventListener('updatefound', () => watch(reg.installing));
    // Verifica novas versões ao voltar para a aba (sem polling).
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void reg.update(); });
  }).catch(() => { /* PWA é opcional: o app funciona normalmente sem service worker. */ });
}
