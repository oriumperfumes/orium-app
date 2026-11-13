/* eslint-disable */
/**
 * Service Worker da Orium — foco em Web Push (avisos para ADMIN/OWNER) e
 * abertura da PWA na rota correta.
 *
 * Deliberadamente NÃO faz cache de HTML nem de dados (preço, estoque, pedidos):
 * nada de mostrar valor antigo como se fosse atual. Só guarda o que nunca muda
 * com o mesmo nome: ícones, arquivos do app (/assets/<nome>-<hash>.js|css) e
 * fotos de produto (/api/public/produto-foto e negociacao-foto, nome único).
 * Assim, abrir o app de novo não baixa outra vez o que já está no aparelho.
 */
/**
 * ATENÇÃO: ao trocar o ícone, gere arquivos com NOVO NOME (…-v4.png), aponte o
 * manifest para eles e suba ICONS_VERSION aqui. O cache antigo é apagado no
 * activate, então nenhum navegador continua servindo o ícone anterior.
 */
const ICONS_VERSION = "v4";
const SHELL_CACHE = `orium-static-${ICONS_VERSION}`;
/** arquivos do app e fotos: nomes únicos, então "cache primeiro" é seguro */
const RUNTIME_CACHE = "orium-runtime-v1";
const RUNTIME_MAX = 260;
const isImmutable = (url) =>
  url.pathname.startsWith("/assets/") ||
  url.pathname === "/api/public/produto-foto" ||
  url.pathname === "/api/public/negociacao-foto";

/** mantém o cache pequeno: apaga os mais antigos quando passa do limite */
async function trimRuntime() {
  try {
    const cache = await caches.open(RUNTIME_CACHE);
    const keys = await cache.keys();
    const extra = keys.length - RUNTIME_MAX;
    for (let i = 0; i < extra; i++) await cache.delete(keys[i]);
  } catch {
    /* sem espaço: segue sem cache */
  }
}
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
        names
          .filter((n) => (n.startsWith("orium-static-") && n !== SHELL_CACHE) || (n.startsWith("orium-runtime-") && n !== RUNTIME_CACHE))
          .map((n) => caches.delete(n)),
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
  // Arquivos do app e fotos: nome único → do aparelho primeiro, rede só na 1ª vez.
  if (isImmutable(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res && res.ok && res.type === "basic") {
          event.waitUntil(cache.put(req, res.clone()).then(trimRuntime, () => undefined));
        }
        return res;
      })().catch(() => fetch(req)),
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

/* ───────────── Widget do Windows 11 (painel de widgets via Edge) ─────────────
 * O widget lê o resumo dos pedidos com a chave do aparelho, que a página
 * Admin → Widgets entrega para cá (postMessage) e fica guardada no Cache.
 * Atualiza ao instalar/voltar a aparecer e a cada ~15 min (periodicsync).
 */
const WIDGET_TAG = "orium-pedidos";
const WIDGET_CACHE = "orium-widget";
const WIDGET_KEY_URL = "/__orium-widget-key";

async function widgetKey() {
  try {
    const cache = await caches.open(WIDGET_CACHE);
    const hit = await cache.match(WIDGET_KEY_URL);
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

function brlText(n) {
  return "R$ " + Number(n || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

async function widgetData() {
  const key = await widgetKey();
  if (!key) {
    const res = await fetch("/widgets/pedidos-data.json", { cache: "no-store" });
    return await res.text();
  }
  try {
    const res = await fetch("/api/public/widget?key=" + encodeURIComponent(key), { cache: "no-store" });
    if (!res.ok) throw new Error(String(res.status));
    const s = await res.json();
    const color = { red: "Attention", gold: "Warning", green: "Good" }[s.tone] || "Accent";
    const label = s.focus === "today" ? "Hoje" : s.focus === "tomorrow" ? "Amanhã" : s.focus === "week" ? "Próxima entrega" : "Tudo em dia";
    return JSON.stringify({
      label,
      color,
      title: s.title,
      sub: s.sub,
      next: (s.next || []).slice(0, 4).map((o) => ({
        when: o.short || o.when,
        name: o.name,
        phase: o.phaseLabel,
        color: o.group === "late" ? "Attention" : o.group === "today" ? "Warning" : "Default",
      })),
      receivable: brlText(s.receivable),
      toBuy: String(s.counts.toBuy),
      open: String(s.counts.open),
    });
  } catch {
    return JSON.stringify({ label: "Orium", color: "Attention", title: "Sem conexão", sub: "Não deu para carregar os pedidos agora.", next: [], receivable: "—", toBuy: "—", open: "—" });
  }
}

async function refreshWidgets() {
  if (!self.widgets) return;
  try {
    const def = await self.widgets.getByTag(WIDGET_TAG);
    if (!def) return;
    const template = await (await fetch(def.definition.msAcTemplate || "/widgets/pedidos-template.json")).text();
    const data = await widgetData();
    await self.widgets.updateByTag(WIDGET_TAG, { template, data });
  } catch {
    /* widget é bônus: nunca quebrar o service worker */
  }
}

self.addEventListener("widgetinstall", (event) => event.waitUntil(refreshWidgets()));
self.addEventListener("widgetresume", (event) => event.waitUntil(refreshWidgets()));
self.addEventListener("widgetclick", (event) => {
  if (event.action === "abrir") event.waitUntil(self.clients.openWindow("/admin/pedidos"));
});
self.addEventListener("periodicsync", (event) => {
  if (event.tag === WIDGET_TAG) event.waitUntil(refreshWidgets());
});
self.addEventListener("message", (event) => {
  const msg = event.data;
  if (!msg || typeof msg !== "object") return;
  if (msg.type === "orium-widget-key") {
    event.waitUntil(
      (async () => {
        const cache = await caches.open(WIDGET_CACHE);
        if (msg.key) await cache.put(WIDGET_KEY_URL, new Response(String(msg.key)));
        else await cache.delete(WIDGET_KEY_URL);
        await refreshWidgets();
      })(),
    );
  }
  if (msg.type === "orium-widget-refresh") event.waitUntil(refreshWidgets());
});
