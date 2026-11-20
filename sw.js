/* Service worker de souanpt.hub — volontairement MINIMAL.
 *
 * Rôle : rendre le site installable (« Ajouter un raccourci ») et afficher une
 * page hors ligne propre quand le réseau manque. Rien d'autre.
 *
 * Règle de sécurité : AUCUNE page ni réponse d'API n'est mise en cache. Le
 * dashboard affiche des données privées (clients, devis, portails) : un cache
 * partagé les rendrait lisibles par un autre compte du même appareil. Seuls
 * la page hors ligne et les icônes, publiques et statiques, sont gardées.
 */
const CACHE = 'souanpt-static-v1';
const STATIC = ['offline.html', 'icons/icon-192.png', 'icons/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('souanpt-static-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  // Seules les navigations de pages sont concernées : API, scripts, images et
  // requêtes vers d'autres sites passent par le réseau sans intervention.
  if (req.mode !== 'navigate' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(fetch(req).catch(() => caches.match('offline.html')));
});
