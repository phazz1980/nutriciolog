const CACHE = "my-nutritionist-shell-v8";
const SHELL = ["./", "./index.html", "./styles.css", "./app.js", "./firebase-client.js", "./pwa.js", "./photo-picker.js", "./manifest.webmanifest", "./icons/app-icon.svg", "./icons/nutritionist-logo.png"];
const SHELL_URLS = new Set(SHELL.map(path => new URL(path, self.registration.scope).href));

self.addEventListener("install", event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !SHELL_URLS.has(event.request.url)) return;
  const network = fetch(event.request).then(async response => {
    if (response.ok) {
      const cache = await caches.open(CACHE);
      await cache.put(event.request, response.clone());
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(event.request);
    if (!cached) return network;
    let timer;
    try {
      return await Promise.race([
        network.then(response => response.ok ? response : cached).catch(() => cached),
        new Promise(resolve => { timer = setTimeout(() => resolve(cached), 4000); }),
      ]);
    } finally { clearTimeout(timer); }
  })());
});
