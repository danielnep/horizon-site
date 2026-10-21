const CACHE='horizon-control-ui-v1';
const FILES=['/central/','/central/index.html','/central/style.css','/central/app.js','/central/manifest.webmanifest','/central/icon.svg','/central/icon-192.png','/central/icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url);
 if(url.origin!==self.location.origin||!FILES.includes(url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{
   if(response.ok){const copy=response.clone();void caches.open(CACHE).then(c=>c.put(event.request,copy));}
   return response;
 }).catch(()=>caches.match(event.request)));
});
