import { supabase } from './client';

// Web Push no navegador: inscrição via service worker do PWA (registrado só no build de produção).
export type PushSupport = 'ok' | 'unsupported' | 'ios-install' | 'no-sw' | 'no-key';
const vapidKey = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined' || !('Notification' in window) || !('PushManager' in window)) {
    // iPhone/iPad só têm Web Push com o app instalado na Tela de Início (iOS/iPadOS 16.4+).
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    return ios ? 'ios-install' : 'unsupported';
  }
  if (!('serviceWorker' in navigator)) return 'no-sw';
  if (!vapidKey) return 'no-key';
  return 'ok';
}

const key = (b64: string) => Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4)), c => c.charCodeAt(0));

async function registration() {
  const reg = await Promise.race([navigator.serviceWorker.ready, new Promise<null>(r => setTimeout(() => r(null), 5000))]);
  if (!reg) throw new Error('O aplicativo ainda não terminou de instalar neste navegador. Recarregue a página e tente de novo.');
  return reg;
}

export async function currentSubscription() {
  if (pushSupport() !== 'ok') return null;
  return (await registration()).pushManager.getSubscription();
}

async function save(sub: PushSubscription) {
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: sub.endpoint, p_p256dh: json.keys?.p256dh ?? '', p_auth: json.keys?.auth ?? '', p_user_agent: navigator.userAgent.slice(0, 300) });
  if (error) throw new Error('Não foi possível registrar este dispositivo. Tente novamente.');
}

/** Pede permissão (só por clique do usuário), inscreve e registra no servidor. */
export async function enablePush() {
  if (pushSupport() !== 'ok') throw new Error('Este navegador não oferece notificações push.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error(permission === 'denied'
    ? 'As notificações foram bloqueadas. Libere nas configurações do navegador (cadeado ao lado do endereço) e tente de novo.'
    : 'Permissão não concedida. Nada foi alterado.');
  const reg = await registration();
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key(vapidKey!) });
  await save(sub);
}

export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  if (error) throw new Error('Não foi possível remover este dispositivo do servidor. Tente novamente.');
  await sub.unsubscribe();
}

/** Mantém o servidor sincronizado quando o navegador renova a inscrição. */
export async function resyncPush() {
  try { if (Notification.permission === 'granted') { const sub = await currentSubscription(); if (sub) await save(sub); } } catch { /* silencioso: tentativa na próxima abertura */ }
}
