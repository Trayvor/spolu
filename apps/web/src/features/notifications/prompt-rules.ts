import type { NotificationChannel, NotificationPrefs } from '@spolu/shared';

/** Whether some notification group the user can see uses a channel `wants` accepts. */
export function someWant(
  prefs: Pick<NotificationPrefs, 'channels' | 'visibleCategories'>,
  wants: (channel: NotificationChannel) => boolean,
): boolean {
  return prefs.visibleCategories.some((c) => wants(prefs.channels[c]));
}

/** Which one card `<AppPrompt>` shows. Pure rules; the component gathers the input. */
export type Prompt = 'install-android' | 'install-ios' | 'enable' | 'ios-unsupported' | null;

export type PromptInput = {
  phone: boolean;
  standalone: boolean;
  /** iOS/iPadOS version (16.4), null elsewhere. */
  ios: number | null;
  hasPushManager: boolean;
  /** From the profile: some visible notification group wants push. */
  pushWanted: boolean;
  /** The server has a VAPID key. */
  vapidKey: boolean;
  permission: NotificationPermission | 'unsupported';
  subscribed: boolean;
  installDismissedAt: number | null;
  enableDismissedAt: number | null;
  fallbackDone: boolean;
  now: number;
};

/** A dismissed card comes back after 6 hours (owner: insistent by design). */
export const REPROMPT_MS = 6 * 60 * 60 * 1000;

/** Web push on iOS starts with 16.4. */
const IOS_PUSH = 16.4;

export function choosePrompt(i: PromptInput): Prompt {
  const due = (dismissedAt: number | null) =>
    dismissedAt === null || i.now - dismissedAt >= REPROMPT_MS;
  const oldIos = i.ios !== null && i.ios < IOS_PUSH;
  if (i.ios !== null && (oldIos || (i.standalone && !i.hasPushManager)) && !i.fallbackDone) {
    return 'ios-unsupported';
  }
  // Installing would not bring notifications to an old iOS, so no install card there.
  if (oldIos) return null;
  // An iPad in Safari poses as a Mac at desktop widths, so iOS counts as a phone here.
  if ((i.phone || i.ios !== null) && !i.standalone && due(i.installDismissedAt)) {
    return i.ios !== null ? 'install-ios' : 'install-android';
  }
  const enable =
    i.pushWanted &&
    i.vapidKey &&
    i.hasPushManager &&
    i.permission === 'default' &&
    !i.subscribed &&
    (i.standalone || !i.phone) &&
    due(i.enableDismissedAt);
  return enable ? 'enable' : null;
}

/** A touch screen that is narrow (< 641 px) or says it is a phone or tablet. */
export function isPhone(
  match: (query: string) => boolean = (q) => window.matchMedia(q).matches,
  width: number = window.innerWidth,
  ua: string = navigator.userAgent,
): boolean {
  return match('(pointer: coarse)') && (width < 641 || /Android|iPhone|iPad|iPod|Mobile/i.test(ua));
}

export const STORAGE_KEYS = {
  install: 'spolu.prompt.install.dismissedAt',
  enable: 'spolu.prompt.enable.dismissedAt',
  iosFallback: 'spolu.prompt.iosFallback.done',
} as const;

// Storage can be missing or throw (private mode, blocked site data). Then the value counts as
// unset, so the prompt shows again: the insistent default.
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not stored; the card stays hidden until the next page load.
  }
}

/** Stores "dismissed now" under `key` and returns that time. */
export function recordDismissal(key: string): number {
  const now = Date.now();
  write(key, String(now));
  return now;
}

export function readTime(key: string): number | null {
  const raw = read(key);
  const value = raw ? Number(raw) : NaN;
  return Number.isFinite(value) ? value : null;
}

export const readFlag = (key: string): boolean => read(key) === '1';
