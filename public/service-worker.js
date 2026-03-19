const CACHE = "molly-pms-v5";

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

self.addEventListener("fetch", event => {

 const request = event.request;

 // 🔥 NO interceptar HTML (MUY IMPORTANTE)
 if(request.url.endsWith(".html")){
   return;
 }

 // 🔥 ignorar APIs y sockets
 if(request.url.includes("/tasks") ||
    request.url.includes("/auth") ||
    request.url.includes("socket.io")){
   return;
 }

 // 🔥 navegación (páginas)
 if(request.mode === "navigate"){

   event.respondWith(
     fetch(request,{ cache:"no-store" })
       .catch(()=> fetch("/login.html",{ cache:"no-store" }))
   );

   return;
 }

 // 🔥 cache normal
 event.respondWith(
   caches.match(request).then(response=>{
     return response || fetch(request);
   })
 );

});