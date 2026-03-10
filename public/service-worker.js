const CACHE = "molly-pms-v1";

self.addEventListener("install", event => {
 console.log("PWA instalada");
 self.skipWaiting();
});

self.addEventListener("activate", event => {
 console.log("Service Worker activo");

 event.waitUntil(
   caches.keys().then(keys=>{
     return Promise.all(
       keys
       .filter(k => k !== CACHE)
       .map(k => caches.delete(k))
     );
   })
 );

 self.clients.claim();
});