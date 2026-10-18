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
  // The app icon's badge (UX review N6b): a dot here; the open app sets the bell's number.
  const nav = self.navigator;
  const badge =
    nav && typeof nav.setAppBadge === 'function'
      ? Promise.resolve()
          .then(() => nav.setAppBadge())
          .catch(() => {})
      : Promise.resolve();
  event.waitUntil(
    badge.then(() =>
      self.registration.showNotification(payload.title || 'Help', {
        body: payload.body,
        // `renotify` needs a tag: without one the browser rejects and shows nothing. A newer event of
        // the same tag replaces the card; it sounds again only when the server asks (2026-10-18:
        // mentions, assignments, reminders, new tickets), so a stream of messages alerts once.
        tag: payload.tag || 'spolu',
        renotify: payload.renotify === true,
        icon: '/icons/icon-192.png',
        data: { url: payload.url },
      }),
    ),
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
      // The tab the person is looking at, else a visible one, else any (N9, 2026-10-18).
      const ours = clients.filter((c) => c.url.startsWith(self.location.origin));
      const client =
        ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === 'visible') || ours[0];
      if (!client) return self.clients.openWindow(url);
      client.postMessage({ type: 'spolu:navigate', url });
      return client.focus();
    }),
  );
});
