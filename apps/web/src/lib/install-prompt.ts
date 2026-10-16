/**
 * Chromium fires `beforeinstallprompt` once, early, before the lazy `<AppPrompt>` exists, so
 * this module is imported eagerly by main.tsx to keep the event for the Install button.
 */
type InstallEvent = Event & { prompt(): Promise<{ outcome: 'accepted' | 'dismissed' }> };

let deferred: InstallEvent | null = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferred = event as InstallEvent;
});
window.addEventListener('appinstalled', () => (deferred = null));

export const canInstall = (): boolean => deferred !== null;

/** Call from a click. The event can be used once, so it is dropped afterwards. */
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferred;
  if (!event) return 'unavailable';
  deferred = null;
  return (await event.prompt()).outcome;
}
