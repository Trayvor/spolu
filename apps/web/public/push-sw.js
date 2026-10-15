/* global self */
// Push handlers, pulled into the Workbox worker with importScripts (vite.config.ts).
// Plain JS on purpose: it is served as is, not bundled.

self.addEventListener('push', (event) => {
  const payload = event.data ? event.data.json() : {};
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag,
      renotify: true,
      icon: '/icons/icon-192.png',
      data: { url: payload.url },
    }),
  );
});

/** Keep only a same-origin path; anything else opens the app root. */
function safePath(url) {
  return typeof url === 'string' && /^\/(?![/\\])/.test(url) ? url : '/';
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
