/* global self, URL, fetch */
// Push handlers, pulled into the Workbox worker with importScripts (vite.config.ts).
// Plain JS on purpose: it is served as is, not bundled.

const NOTIFICATION_ID = /^[\w-]{1,64}$/;
/** The notification event's id of a push (2026-10-19), when it is a well-formed one. */
const notificationIdOf = (v) => (typeof v === 'string' && NOTIFICATION_ID.test(v) ? v : null);

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = (event.data && event.data.json()) || {};
  } catch {
    // A malformed payload still gets a generic notification (userVisibleOnly requires one).
  }
  // N6a: the buttons (push-actions.js), when the payload has any.
  const extra = self.spoluPushActions ? self.spoluPushActions.options(payload) : null;
  const notificationId = notificationIdOf(payload.notificationId);
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
        ...(extra && { actions: extra.actions }),
        data: {
          url: payload.url,
          ...(notificationId && { notificationId }),
          ...(extra && { actions: extra.data }),
        },
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

/** The window clients of our origin. */
function ourClients() {
  return self.clients
    .matchAll({ type: 'window', includeUncontrolled: true })
    .then((clients) => clients.filter((c) => c.url.startsWith(self.location.origin)));
}

/** Shows `url` (a safe path) in an open tab of ours, or a new window. */
function openApp(url) {
  return ourClients().then((ours) => {
    // The tab the person is looking at, else a visible one, else any (N9, 2026-10-18).
    const client =
      ours.find((c) => c.focused) || ours.find((c) => c.visibilityState === 'visible') || ours[0];
    if (!client) return self.clients.openWindow(url);
    client.postMessage({ type: 'spolu:navigate', url });
    return client.focus();
  });
}

/**
 * Opening a notification reads it (2026-10-19): the worker posts it to our HTTP API with the
 * session cookie, here rather than in the page, so it holds when the app was closed and for every
 * button. After the write each open tab refetches its bell (`spolu:notifications-read`; the server
 * also tells the person's sockets). A failure (signed out, offline) leaves it unread, nothing more.
 */
function markRead(id) {
  if (!id) return Promise.resolve();
  return fetch(`/api/me/notifications/${encodeURIComponent(id)}/read`, {
    method: 'POST',
    credentials: 'same-origin',
  })
    .then((res) => {
      if (!res.ok) return undefined;
      return ourClients().then((ours) => {
        for (const c of ours) c.postMessage({ type: 'spolu:notifications-read', id });
      });
    })
    .catch(() => {});
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = safePath(data.url);
  // N6a: a button (push-actions.js); anything else opens the item.
  const action =
    event.action && self.spoluPushActions
      ? self.spoluPushActions.click(event, openApp, safePath)
      : null;
  event.waitUntil(
    Promise.all([action || openApp(url), markRead(notificationIdOf(data.notificationId))]),
  );
});
