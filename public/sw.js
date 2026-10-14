// Service Worker PISTEC v2
// Estratégia: Cache-first para assets versionados e ícones; Network-first com fallback para SPA em navegações.
// Nunca cacheia dados de autenticação ou chamadas a APIs externas.

const CACHE_NAME = 'pistec-shell-v2';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/brand/symbol.webp',
  '/brand/logo-horizontal.webp',
  '/brand/favicon.png',
  '/brand/apple-touch-icon.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/icons/icon-maskable-192x192.png',
  '/icons/icon-maskable-512x512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      // Precache silencioso dos assets base; falhas pontuais não abortam a instalação.
      return Promise.allSettled(STATIC_ASSETS.map(url => cache.add(url)));
    }).then(() => {
      // Não força skipWaiting imediato para não derrubar venda em andamento em abas abertas.
    })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Apenas mesmo domínio
  if (url.origin !== self.location.origin) return;

  // 1. Navegação HTML (rotas SPA): Network-first com fallback para o index.html cacheado
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
        }
        return response;
      }).catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const index = await caches.match('/index.html');
        if (index) return index;
        return new Response('PISTEC Offline: abra a aplicação quando houver conexão para atualizar.', {
          status: 503,
          headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
      })
    );
    return;
  }

  // 2. Assets versionados (Vite com hash) e ícones estáticos: Cache-first
  if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname.startsWith('/brand/')) {
    event.respondWith(
      caches.match(request).then(cached => {
        if (cached) return cached;
        return fetch(request).then(response => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => cache.put(request, clone));
          }
          return response;
        });
      })
    );
    return;
  }

  // 3. Demais requisições: Network-first
  event.respondWith(
    fetch(request).catch(() => caches.match(request))
  );
});

// Mensagem para aplicar atualização quando o usuário confirmar
self.addEventListener('message', event => {
  if (event.data === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
