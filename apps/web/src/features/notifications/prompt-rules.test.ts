import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  REPROMPT_MS,
  STORAGE_KEYS,
  choosePrompt,
  isPhone,
  readFlag,
  readTime,
  type Prompt,
  type PromptInput,
} from './prompt-rules';

const NOW = 1_800_000_000_000;
const MIN = 60 * 1000;

/** A desktop browser with push support and nothing decided yet. */
const base: PromptInput = {
  phone: false,
  standalone: false,
  ios: null,
  hasPushManager: true,
  pushWanted: true,
  vapidKey: true,
  permission: 'default',
  subscribed: false,
  installDismissedAt: null,
  enableDismissedAt: null,
  fallbackDone: false,
  now: NOW,
};
const android: Partial<PromptInput> = { phone: true };
const iphoneSafari: Partial<PromptInput> = { phone: true, ios: 17, hasPushManager: false };
const iphoneApp: Partial<PromptInput> = { phone: true, ios: 17, standalone: true };

describe('choosePrompt', () => {
  it.each<[string, Partial<PromptInput>, Prompt]>([
    ['Android phone in the browser gets install-android', android, 'install-android'],
    ['iPhone 17 in Safari gets install-ios', iphoneSafari, 'install-ios'],
    ['installed iPhone 17 with permission default gets enable', iphoneApp, 'enable'],
    [
      'installed Android with permission default gets enable',
      { ...android, standalone: true },
      'enable',
    ],
    ['desktop with permission default gets enable', {}, 'enable'],
    ['installed and subscribed gets nothing', { ...iphoneApp, subscribed: true }, null],
    ['permission denied gets nothing', { permission: 'denied' }, null],
    ['permission granted gets no card', { permission: 'granted' }, null],
    [
      'unsupported notifications get nothing',
      { permission: 'unsupported', hasPushManager: false },
      null,
    ],
    ['no group on push in the profile gets no enable prompt', { pushWanted: false }, null],
    ['no VAPID key on the server gets no enable prompt', { vapidKey: false }, null],
    [
      'phone in the browser is never asked to enable',
      { ...android, installDismissedAt: NOW },
      null,
    ],
    [
      'install dismissed 5 h 59 min ago stays hidden',
      { ...android, installDismissedAt: NOW - 6 * 60 * MIN + MIN },
      null,
    ],
    [
      'install dismissed 6 h ago shows again',
      { ...android, installDismissedAt: NOW - REPROMPT_MS },
      'install-android',
    ],
    [
      'enable dismissed 5 h 59 min ago stays hidden',
      { enableDismissedAt: NOW - REPROMPT_MS + MIN },
      null,
    ],
    ['enable dismissed 6 h ago shows again', { enableDismissedAt: NOW - REPROMPT_MS }, 'enable'],
    [
      'iOS 15.8 gets ios-unsupported',
      { phone: true, ios: 15.8, hasPushManager: false },
      'ios-unsupported',
    ],
    [
      'iOS 15.8 gets nothing once done',
      { phone: true, ios: 15.8, hasPushManager: false, fallbackDone: true },
      null,
    ],
    ['iOS 16.3 standalone gets ios-unsupported', { ...iphoneApp, ios: 16.3 }, 'ios-unsupported'],
    [
      'standalone iOS without PushManager gets ios-unsupported',
      { ...iphoneApp, hasPushManager: false },
      'ios-unsupported',
    ],
    [
      'standalone iOS without PushManager gets nothing once done',
      { ...iphoneApp, hasPushManager: false, fallbackDone: true },
      null,
    ],
    [
      'iPad Safari posing as a Mac at a desktop width gets install-ios',
      { phone: false, ios: 17.2, hasPushManager: false },
      'install-ios',
    ],
    [
      'installed iPad at a desktop width gets enable',
      { phone: false, ios: 17.2, standalone: true },
      'enable',
    ],
    [
      'missing storage values mean the prompt shows',
      { ...iphoneSafari, installDismissedAt: null },
      'install-ios',
    ],
  ])('%s', (_name, input, expected) => {
    expect(choosePrompt({ ...base, ...input })).toBe(expected);
  });
});

describe('isPhone', () => {
  const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/124.0 Mobile Safari/537.36';
  const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15';
  it.each([
    ['a touch screen below 641 px', true, 390, MAC, true],
    ['a touch screen with a mobile user agent', true, 900, ANDROID, true],
    ['a wide touch screen with a desktop user agent', true, 1024, MAC, false],
    ['a mouse on a narrow window', false, 390, ANDROID, false],
  ])('%s', (_name, coarse, width, ua, expected) => {
    const match = (q: string) => q === '(pointer: coarse)' && coarse;
    expect(isPhone(match, width, ua)).toBe(expected);
  });
});

describe('storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('reads stored values', () => {
    localStorage.setItem(STORAGE_KEYS.install, '123');
    localStorage.setItem(STORAGE_KEYS.iosFallback, '1');
    expect(readTime(STORAGE_KEYS.install)).toBe(123);
    expect(readFlag(STORAGE_KEYS.iosFallback)).toBe(true);
  });

  it('missing or garbage values count as null and false', () => {
    localStorage.setItem(STORAGE_KEYS.enable, 'soon');
    expect(readTime(STORAGE_KEYS.install)).toBeNull();
    expect(readTime(STORAGE_KEYS.enable)).toBeNull();
    expect(readFlag(STORAGE_KEYS.iosFallback)).toBe(false);
  });

  it('blocked storage counts as null and false', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readTime(STORAGE_KEYS.install)).toBeNull();
    expect(readFlag(STORAGE_KEYS.iosFallback)).toBe(false);
  });
});
