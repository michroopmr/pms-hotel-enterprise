const CACHE = "molly-pms-v4";

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

 // 🔹 No interferir con API o sockets
 if(request.url.includes("/tasks") ||
    request.url.includes("/auth") ||
    request.url.includes("socket.io")){
   return;
 }

 // 🔹 HTML siempre desde red
 if(request.mode === "navigate"){
  event.respondWith(
    fetch(request, { cache: "no-store" }).catch(()=>{
      return fetch("/login.html", { cache: "no-store" });
    })
  );
  return;
}

 // 🔹 Archivos estáticos
 event.respondWith(
   caches.match(request).then(response=>{
     return response || fetch(request);
   })
 );

});