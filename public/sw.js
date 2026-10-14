/*
 * Zenith Community service worker — deliberately conservative for an auth
 * app. It NEVER intercepts the API or auth, never serves a stale app shell
 * (navigations are network-first), and only cache-firsts content-hashed,
 * immutable /assets/. Its whole job is an offline fallback + faster repeat
 * loads of immutable assets. Bump CACHE to invalidate everything.
 */
const CACHE = "zenith-community-v1";
// Cloudflare Assets serves offline.html at the extensionless /offline (it drops
// .html); use that so precaching never follows a redirect (which cache.addAll
// rejects).
const OFFLINE_URL = "/offline";
const PRECACHE = ["/offline", "/icons/icon-192.png", "/site.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return; // never touch mutations

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // let cross-origin pass through
  // Never cache or intercept the API, auth, or Cloudflare internals.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/cdn-cgi/")) return;

  // App navigations: always try the network first; fall back to offline page.
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  // Content-hashed, immutable assets: cache-first (safe — the URL changes when
  // the file does).
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((hit) =>
        hit ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
          return res;
        }),
      ),
    );
    return;
  }

  // Everything else same-origin (fonts, media, icons): network, fall back to
  // cache when offline. Never blocks on a stale copy while online.
  event.respondWith(
    fetch(request)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      })
      .catch(() => caches.match(request)),
  );
});
