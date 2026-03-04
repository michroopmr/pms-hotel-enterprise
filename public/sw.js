/* ================= MOLLYHELPERS SERVICE WORKER ================= */

/* ===== INSTALL ===== */

self.addEventListener("install", event => {
  console.log("🔥 Service Worker instalado");
  self.skipWaiting();
});

/* ===== ACTIVATE ===== */

self.addEventListener("activate", event => {
  console.log("🔥 Service Worker activo");
  event.waitUntil(self.clients.claim());
});

/* ================= PUSH EVENT ================= */

self.addEventListener("push", event => {

  console.log("📩 Push recibido");

  if (!event.data) return;

  const data = event.data.json();

  event.waitUntil(

    self.registration.showNotification(data.title || "Nueva notificación", {
      body: data.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",

      // 🔥 datos extra para deep link
      data: {
        taskId: data.taskId || null
      }

    })

  );

});

/* ================= CLICK NOTIFICATION (DEEP LINK) ================= */

self.addEventListener("notificationclick", event => {

  event.notification.close();

  const taskId = event.notification.data?.taskId;

  event.waitUntil(

    clients.matchAll({
      type: "window",
      includeUncontrolled: true
    })
    .then(clientList => {

      // buscar dashboard abierto
      for (const client of clientList) {

        if (client.url.includes("dashboard.html")) {

          client.focus();

          if (taskId) {
            client.postMessage({
              type: "OPEN_TASK",
              taskId: taskId
            });
          }

          return;
        }
      }

      // si no está abierto → abrir nuevo
      return clients.openWindow("/dashboard.html");

    })

  );

});

/* ================= MESSAGE FROM CLIENT ================= */

self.addEventListener("message", event => {

  if (event.data === "skipWaiting") {
    self.skipWaiting();
  }

});