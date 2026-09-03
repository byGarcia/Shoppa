// Shoppa's service worker.
//
// Cache strategy:
//   - cache-first for /_next/static/* (content-hashed, immutable)
//   - network-first for shell HTML; ONLY /login is cached (public shell)
//   - network-only for /api/* — v1 is online-only by design (spec §A):
//     authenticated data is never cached, offline shows the fallback page.

const CACHE_VERSION = "v1";
const SHELL_CACHE = `shell-${CACHE_VERSION}`;
const STATIC_CACHE = `static-${CACHE_VERSION}`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(["/manifest.json"])),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => !k.endsWith(`-${CACHE_VERSION}`)).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

// Client can ask for a shell purge on logout.
self.addEventListener("message", (event) => {
  if (!event.data || event.data.type !== "purge-shell-cache") return;
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const keys = await cache.keys();
      await Promise.all(keys.map((k) => cache.delete(k)));
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API routes or auth.
  if (url.pathname.startsWith("/api/")) return;

  // Cache-first for content-hashed Next static assets.
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const fresh = await fetch(req);
        if (fresh.ok) cache.put(req, fresh.clone());
        return fresh;
      }),
    );
    return;
  }

  // Network-first for shell HTML routes; only /login is cacheable.
  if (req.mode === "navigate" || req.headers.get("accept")?.includes("text/html")) {
    const isCacheableShell = url.pathname === "/login";
    event.respondWith(
      (async () => {
        const cache = await caches.open(SHELL_CACHE);
        try {
          const fresh = await fetch(req);
          if (fresh.ok && isCacheableShell) cache.put(req, fresh.clone());
          return fresh;
        } catch {
          if (isCacheableShell) {
            const hit = await cache.match(req);
            if (hit) return hit;
          }
          return new Response(
            "<!doctype html><html lang=\"es\"><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>Sin conexión</title><style>body{margin:0;background:#000;color:#fff;font-family:system-ui;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px}h1{font-size:18px;font-weight:600;margin:0 0 8px}p{color:#888;font-size:14px;max-width:280px}</style><body><h1>Sin conexión</h1><p>La lista necesita red. Vuelve cuando la recuperes.</p>",
            { headers: { "Content-Type": "text/html; charset=utf-8" }, status: 503 },
          );
        }
      })(),
    );
    return;
  }
});
