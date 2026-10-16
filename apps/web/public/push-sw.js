/* global self, URL */
// Push handlers, pulled into the Workbox worker with importScripts (vite.config.ts).
// Plain JS on purpose: it is served as is, not bundled.

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = (event.data && event.data.json()) || {};
  } catch {
    // A malformed payload still gets a generic notification (userVisibleOnly requires one).
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || 'Spolu', {
      body: payload.body,
      tag: payload.tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

/** Keep only a same-origin path (parsed like the browser does); anything else opens the root. */
function safePath(url) {
  if (typeof url !== 'string') return '/';
  try {
    const parsed = new URL(url, self.location.origin);
    if (parsed.origin !== self.location.origin) return '/';
    return parsed.pathname + parsed.search + parsed.hash;
  } catch {
    return '/';
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safePath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      const client = clients.find((c) => c.url.startsWith(self.location.origin));
      if (!client) return self.clients.openWindow(url);
      client.postMessage({ type: 'spolu:navigate', url });
      return client.focus();
    }),
  );
});
