import { describe, expect, it, vi } from 'vitest';
import { canInstall, promptInstall } from './install-prompt';

function fire(prompt: () => Promise<{ outcome: 'accepted' | 'dismissed' }>) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), { prompt });
  window.dispatchEvent(event);
  return event;
}

describe('install prompt', () => {
  it('keeps the event, prevents the mini-infobar and uses the event once', async () => {
    expect(canInstall()).toBe(false);
    expect(await promptInstall()).toBe('unavailable');
    const event = fire(() => Promise.resolve({ outcome: 'accepted' }));
    expect(event.defaultPrevented).toBe(true);
    expect(canInstall()).toBe(true);
    expect(await promptInstall()).toBe('accepted');
    expect(canInstall()).toBe(false);
  });

  it('appinstalled clears the event', () => {
    fire(() => Promise.resolve({ outcome: 'dismissed' }));
    window.dispatchEvent(new Event('appinstalled'));
    expect(canInstall()).toBe(false);
  });

  it('a rejected prompt() counts as unavailable', async () => {
    fire(vi.fn(() => Promise.reject(new Error('already shown'))));
    expect(await promptInstall()).toBe('unavailable');
    expect(canInstall()).toBe(false);
  });
});
