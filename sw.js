/*
  sw.js — MyVault service worker.

  Caches the app shell (HTML/CSS/JS/icons) so MyVault opens and works
  offline. Your actual vault data never touches this cache — that lives
  in IndexedDB (see db.js), which works offline on its own regardless
  of the service worker.
*/

const CACHE_NAME = "myvault-shell-v1";
const SHELL_FILES = [
  "./",
  "./index.html",
  "./manifest.json",
  "./style.css",
  "./utils.js",
  "./db.js",
  "./auth.js",
  "./js/search.js",
  "./ai.js",
  "./backup.js",
  "./ui.js",
  "./app.js",
  "./icon-192.png",
  "./icon-512.png",
  "./apple-touch-icon.png",
  "./favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle same-origin GET requests; never intercept Firebase/API calls.
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
