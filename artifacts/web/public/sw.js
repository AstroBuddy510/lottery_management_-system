const CACHE_NAME = "vs2000-cache-v4";
const PRECACHE_ASSETS = [
  "/manifest.json",
  "/favicon-v3.ico",
  "/company-logo-v3.png",
  "/icon-192-v3.png",
  "/icon-512-v3.png",
  "/apple-touch-icon-v3.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS);
    })
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Skip non-GET requests and API calls entirely
  if (request.method !== "GET" || request.url.includes("/api/")) {
    return;
  }

  // Cross-origin requests are handled by the browser, not by us.
  //
  // This handler used to intercept everything. Map tiles are cross-origin
  // images, so every tile went through the cache-first branch below, missed
  // (nothing cross-origin is ever cached there - see the type === "basic"
  // test), and was re-fetched through the worker. The round trip gained
  // nothing and lost two things: the browser's own HTTP cache, which would
  // have honoured the tile server's Cache-Control, and a plain network error
  // when fetch rejects, because a rejected respondWith surfaces as a failed
  // resource with no useful diagnosis. Serving tiles uncached on every pan is
  // also the behaviour a tile provider reads as scraping.
  if (new URL(request.url).origin !== self.location.origin) {
    return;
  }

  // Navigation requests (HTML pages): always network-first
  // This ensures users always get the latest index.html with correct asset hashes
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((networkResponse) => {
          // Cache the fresh HTML for offline fallback
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return networkResponse;
        })
        .catch(() => {
          // Offline fallback: serve cached HTML if available
          return caches.match(request).then((cached) => cached || caches.match("/"));
        })
    );
    return;
  }

  // Static assets (JS, CSS, images): cache-first for performance
  event.respondWith(
    caches.match(request).then((cachedResponse) => {
      if (cachedResponse) {
        return cachedResponse;
      }
      return fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === "basic") {
            const responseToCache = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(request, responseToCache);
            });
          }
          return networkResponse;
        })
        .catch((err) => {
          // Without this, a failed fetch rejects respondWith and the browser
          // reports an opaque failure that names neither the URL nor the cause.
          return caches.match(request).then((cached) => {
            if (cached) return cached;
            return new Response("", { status: 504, statusText: "Offline: " + String(err) });
          });
        });
    })
  );
});
