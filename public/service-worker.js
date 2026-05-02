/* ================= MOLLYHELPERS SERVICE WORKER ================= */

/* ===== VERSION ===== */
const CACHE_NAME = "molly-v31";

/* ===== ARCHIVOS BASE ===== */
const urlsToCache = [
  "/",
  "/dashboard.html",
  "/icon-192.png"
];

/* ===== INSTALL ===== */
self.addEventListener("install", event => {
  console.log("🔥 SW instalado");

  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log("📦 Cacheando app");
        return cache.addAll(urlsToCache);
      })
  );

  self.skipWaiting(); // 🔥 activa inmediatamente
});

/* ===== ACTIVATE ===== */
self.addEventListener("activate", event => {
  console.log("🔥 SW activo");

  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            console.log("🧹 Borrando cache viejo:", key);
            return caches.delete(key);
          }
        })
      );
    })
  );

  self.clients.claim(); // 🔥 toma control inmediato
});

/* ===== FETCH (NETWORK FIRST - FIX COMPLETO) ===== */
self.addEventListener("fetch", event => {

  // 🔥 SOLO MISMO ORIGEN
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  // 🔥 SOLO GET (evita errores con POST/PUT)
  if (event.request.method !== "GET") {
    return;
  }

  event.respondWith(

    fetch(event.request)
      .then(networkResponse => {

        // 🔥 VALIDAR RESPUESTA
        if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== "basic") {
          return networkResponse;
        }

        const responseClone = networkResponse.clone();

        caches.open(CACHE_NAME).then(cache => {
          cache.put(event.request, responseClone);
        });

        return networkResponse;

      })
      .catch(() => {

        return caches.match(event.request).then(response => {

          if (response) return response;

          // 🔥 fallback navegación
          if (event.request.mode === "navigate") {
            return caches.match("/dashboard.html");
          }

        });

      })

  );

});