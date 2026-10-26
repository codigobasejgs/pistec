// Service Worker PISTEC. Os marcadores abaixo são preenchidos no build (vite.config.ts).
// Pré-carrega o shell e todos os chunks: qualquer tela já instalada abre offline.
// Nunca guarda respostas de outros domínios; dados de negócio ficam só no IndexedDB.
const VERSION = '__VERSION__';
const PRECACHE = [/*__PRECACHE__*/];
const CACHE = `pistec-${VERSION}`;

self.addEventListener('install', event => {
  // addAll é tudo-ou-nada: uma versão incompleta nunca é ativada.
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(PRECACHE)));
  // Sem skipWaiting automático: a troca de versão acontece só quando o usuário confirma.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pistec-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Mantém HTML e chunks na mesma versão até a atualização consentida.
    // Não cacheia HTML por URL (evita crescimento ilimitado por parâmetros/rotas).
    event.respondWith(caches.match('/index.html', { cacheName: CACHE }).then(hit => hit || fetch(request)));
    return;
  }
  event.respondWith(caches.match(request, { cacheName: CACHE, ignoreVary: PRECACHE.includes(url.pathname) }).then(hit => hit || fetch(request)));
});

self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

// Web Push (mesmo service worker do PWA). Conteúdo genérico: detalhes só após login.
// Só abre rotas internas /app/*; qualquer outra URL vira /app.
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { /* payload inválido: aviso genérico */ }
  const url = typeof data.url === 'string' && data.url.startsWith('/app/') ? data.url : '/app';
  event.waitUntil(self.registration.showNotification(typeof data.title === 'string' ? data.title.slice(0, 80) : 'PISTEC', {
    body: typeof data.body === 'string' ? data.body.slice(0, 160) : 'Abra o PISTEC para ver os detalhes.',
    icon: '/icons/icon-192x192.png', badge: '/icons/icon-96x96.png',
    tag: typeof data.tag === 'string' ? data.tag.slice(0, 60) : undefined, data: { url },
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/app', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => c.url.startsWith(self.location.origin + '/app'));
    return open ? open.navigate(url).then(c => (c || open).focus()) : self.clients.openWindow(url);
  }));
});

// Navegador renovou a inscrição: a página reenvia ao servidor na próxima abertura (usePush).
self.addEventListener('pushsubscriptionchange', () => {});
