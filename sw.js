// sw.js · the service worker of the site and its phone app (js/app.js). Network first, always: a page, a script or a data
// file comes fresh from the network when there is one (the site never mixes an old script with a new page), and the last
// copy is kept so the app still opens, with its last data, without a network. Only the site's own files are kept: the
// page, its scripts, styles and images, and the data files the app reads. It also shows the alert notifications
// (scripts/alerts.py sends them through Web Push) and opens the app's Alerts tab when one is touched.
const CACHE = 'pk-v1';
const KEEP = /^\/(index\.html)?$|^\/(js|css|assets)\/|^\/data\/[^/]+\.json$|^\/data\/history\/daily\/|^\/manifest\.webmanifest$/;

self.addEventListener('install', e => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/css/site.css', '/js/app.js', '/assets/logo-header.png']).catch(() => {}))); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim())); });

self.addEventListener('fetch', e => {
  const r = e.request, u = new URL(r.url);
  if (r.method !== 'GET' || u.origin !== location.origin) return;     // the database, the Workers, other sites: untouched
  const nav = r.mode === 'navigate';
  if (!nav && !KEEP.test(u.pathname)) return;
  e.respondWith(fetch(r).then(res => {
    if (res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(CACHE).then(c => c.put(nav ? '/' : r, copy)); }
    return res;
  }).catch(() => caches.match(nav ? '/' : r, { ignoreSearch: true }).then(m => m || (nav ? caches.match('/') : Response.error()))));
});

// alert notifications (Web Push): { title, body, tag, url }
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(Promise.all([
    self.registration.showNotification(d.title || 'PowerKlock', { body: d.body || '', tag: d.tag || 'pk-alert', icon: '/assets/icon-192.png', badge: '/assets/favicon-64.png', data: { url: d.url || '/?app=1#app/alerts' } }),
    d.count && self.navigator && self.navigator.setAppBadge ? self.navigator.setAppBadge(d.count).catch(() => {}) : null,
  ]));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/?app=1#app/alerts';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(x => new URL(x.url).origin === location.origin);
    if (c) { c.focus(); return c.navigate ? c.navigate(url) : null; }
    return self.clients.openWindow(url);
  }));
});
