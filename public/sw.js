/* eslint-disable */
/**
 * Service Worker da Orium — foco em Web Push (avisos para ADMIN/OWNER) e
 * abertura da PWA na rota correta.
 *
 * Deliberadamente NÃO faz cache de HTML nem de dados (preço, estoque, pedidos):
 * nada de mostrar valor antigo como se fosse atual. Só ícones/manifest, que são
 * estáticos e versionados por nome de arquivo.
 */
/**
 * ATENÇÃO: ao trocar o ícone, gere arquivos com NOVO NOME (…-v4.png), aponte o
 * manifest para eles e suba ICONS_VERSION aqui. O cache antigo é apagado no
 * activate, então nenhum navegador continua servindo o ícone anterior.
 */
const ICONS_VERSION = "v4";
const SHELL_CACHE = `orium-static-${ICONS_VERSION}`;
const SHELL_FILES = [
  "/icons/orium-icon-192-v4.png",
  "/icons/orium-icon-512-v4.png",
  "/icons/orium-icon-1024-v4.png",
  "/icons/orium-maskable-512-v4.png",
  "/icons/apple-touch-icon-v4.png",
  "/icons/orium-favicon-64-v4.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        await cache.addAll(SHELL_FILES);
      } catch {
        /* nunca impedir a instalação por um asset */
      }
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.allSettled(
        names.filter((n) => n.startsWith("orium-static-") && n !== SHELL_CACHE).map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "orium-skip-waiting") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // O manifest NUNCA fica preso em cache: sempre rede, com revalidação.
  if (url.pathname === "/manifest.webmanifest") {
    event.respondWith(
      fetch(new Request(req, { cache: "no-cache" })).catch(() => caches.match(req)),
    );
    return;
  }
  // Ícones são versionados no nome: cache-first é seguro e some ao subir versão.
  if (!url.pathname.startsWith("/icons/")) return;
  event.respondWith(
    (async () => {
      const hit = await caches.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res && res.ok) {
        const cache = await caches.open(SHELL_CACHE);
        cache.put(req, res.clone());
      }
      return res;
    })(),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { title: "Orium", body: event.data ? event.data.text() : "" };
  }
  const title = payload.title || "Orium";
  const options = {
    body: payload.body || "",
    icon: "/icons/orium-icon-192-v4.png",
    badge: "/icons/orium-icon-192-v4.png",
    tag: payload.tag || undefined,
    renotify: !!payload.tag,
    data: { url: payload.url || "/admin" },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/admin";
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of all) {
        if (new URL(client.url).origin === self.location.origin) {
          await client.focus();
          if ("navigate" in client) {
            try {
              await client.navigate(target);
            } catch {
              /* foco já é suficiente */
            }
          }
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
