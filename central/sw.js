// Central Horizon runs against the VPS. Never replay old HTML, JS or CSS
// from a service-worker cache after a release. Offline status is explicit.
self.addEventListener('install',event=>event.waitUntil(self.skipWaiting()));
self.addEventListener('activate',event=>event.waitUntil(
 caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('horizon-central-ui-')).map(key=>caches.delete(key))))
 .then(()=>self.clients.claim())
));
// Deliberately no fetch handler. The browser always requests current UI.
