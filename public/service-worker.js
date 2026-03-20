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

 // 🔥 ignorar externos (onrender, APIs externas)
 if (!request.url.includes("mollyhelpers.com")) {
   return;
 }

 // 🔥 ignorar APIs críticas
 if(
 request.url.includes("/tasks") ||
 request.url.includes("/auth") ||
 request.url.includes("/chat") ||
 request.url.includes("/guest") ||
 request.url.includes("/users") ||
 request.url.includes("/departments") ||
 request.url.includes("/subscribe") ||
 request.url.includes("socket.io")
){
 return;
}

 // 🔥 navegación (HTML)
 if(request.mode === "navigate"){

   event.respondWith(
     fetch(request,{ cache:"no-store" })
       .catch(()=> caches.match("/login.html"))
   );

   return;
 }

 // 🔥 cache estático (css, js, imágenes)
 event.respondWith(
   caches.match(request).then(response=>{
     return response || fetch(request);
   })
 );

});