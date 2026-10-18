/* global self, fetch, crypto */
// Push notification buttons (N6a, ADR 0047), pulled into the Workbox worker with importScripts
// before push-sw.js (vite.config.ts), which calls `self.spoluPushActions`. Plain JS on purpose: it
// is served as is, not bundled.
//
// A button that writes calls our own HTTP API with the session cookie, like the app: same origin,
// so the CSRF guard sees `Sec-Fetch-Site: same-origin` and our Origin, and the server's policy
// functions decide. Nothing here is a credential: the payload holds ids the URL already carries.
// Whatever fails (signed out, no access, offline) opens the item in the app instead.

(function () {
  const ID = /^[\w-]{1,64}$/;
  const id = (v) => typeof v === 'string' && ID.test(v);
  const text = (v) => (typeof v === 'string' ? v.slice(0, 60) : '');

  /** The server's buttons, checked: known kinds with their ids; none when the payload has none. */
  function valid(actions) {
    if (!Array.isArray(actions)) return [];
    return actions.filter((a) => {
      if (!a || typeof a !== 'object' || !text(a.title)) return false;
      if (a.action === 'done') return id(a.taskId);
      if (a.action === 'time') return typeof a.url === 'string';
      if (a.action === 'reply') {
        return (
          id(a.channelId) && (a.parentId === null || id(a.parentId)) && typeof a.url === 'string'
        );
      }
      return false;
    });
  }

  /**
   * What push-sw.js adds to `showNotification`: the buttons, and what each needs in `data.actions`.
   * `type: 'text'` asks for an inline reply field; a browser without one shows a plain button.
   */
  function options(payload) {
    const actions = valid(payload && payload.actions);
    if (actions.length === 0) return null;
    return {
      actions: actions.map((a) =>
        a.action === 'reply'
          ? {
              action: a.action,
              title: text(a.title),
              type: 'text',
              placeholder: text(a.placeholder),
            }
          : { action: a.action, title: text(a.title) },
      ),
      data: Object.fromEntries(actions.map((a) => [a.action, a])),
    };
  }

  /** A same-origin POST with the session cookie; true when the server took it. */
  async function post(path, body) {
    try {
      const res = await fetch(path, {
        method: 'POST',
        credentials: 'same-origin',
        headers: body === undefined ? {} : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return res.ok ? res : null;
    } catch {
      return null;
    }
  }

  /**
   * A click on a button: returns the promise for `waitUntil`, or null when push-sw.js should treat
   * it as a click on the notification (no button, an unknown one). `open(path)` is push-sw.js's
   * focus-or-open, `safePath` its same-origin filter.
   */
  function click(event, open, safePath) {
    const data = (event.notification.data && event.notification.data.actions) || {};
    const action = data[event.action];
    if (!action) return null;
    const fallback = safePath(event.notification.data.url);

    if (action.action === 'time') return open(safePath(action.url));

    if (action.action === 'done') {
      return post(`/api/tasks/${encodeURIComponent(action.taskId)}/done`).then(async (res) => {
        if (!res) return open(fallback);
        // An admin assignee is asked for time, as when they tick the task in the app.
        const task = await res.json().catch(() => ({}));
        if (task && task.askTime === true) return open(withTime(fallback, safePath));
        return undefined;
      });
    }

    // Reply: the inline text where the platform gives one, else the chat with its composer.
    const reply = typeof event.reply === 'string' ? event.reply.trim() : '';
    const composer = safePath(action.url);
    if (reply === '') return open(composer);
    const body = { body: reply, clientId: crypto.randomUUID() };
    if (action.parentId) body.parentId = action.parentId;
    return post(`/api/channels/${encodeURIComponent(action.channelId)}/messages`, body).then(
      (res) => (res ? undefined : open(composer)),
    );
  }

  /** The task's URL with `time=1`: the panel opens the time dialog. */
  function withTime(path, safePath) {
    return safePath(path + (path.includes('?') ? '&' : '?') + 'time=1');
  }

  self.spoluPushActions = { options, click };
})();
