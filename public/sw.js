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
