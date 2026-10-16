import { deletePushSubscription, savePushSubscription } from './api';

export type DeviceState = 'unsupported' | 'needs-home-screen' | 'blocked' | 'on' | 'off';

type NavLike = Pick<Navigator, 'platform' | 'maxTouchPoints'>;

/** Running as an installed app (home screen), not in a browser tab. */
export function isStandalone(): boolean {
  const iosFlag = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return iosFlag || window.matchMedia('(display-mode: standalone)').matches;
}

/** iOS or iPadOS version as 16.4, or null elsewhere. An iPad may pose as a Mac. */
export function iosVersion(ua: string = navigator.userAgent, nav: NavLike = navigator) {
  const phone = /\b(?:iPhone|iPad|iPod)\b.*?\bOS (\d+)_(\d+)/.exec(ua);
  if (phone) return Number(`${phone[1]}.${phone[2]}`);
  if (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1) {
    const safari = /\bVersion\/(\d+)\.(\d+)/.exec(ua);
    if (safari) return Number(`${safari[1]}.${safari[2]}`);
  }
  return null;
}

/** iOS only delivers web push to an app on the home screen. */
export function isIosOutsideHomeScreen(): boolean {
  return iosVersion() !== null && !isStandalone();
}

function pushSupported(): boolean {
  return (
    'serviceWorker' in navigator &&
    typeof PushManager !== 'undefined' &&
    typeof Notification !== 'undefined'
  );
}

/** `ready` never settles without a registered worker, so look the registration up instead. */
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration();
  return registration ? registration.pushManager.getSubscription() : null;
}

export async function getDeviceState(): Promise<DeviceState> {
  if (isIosOutsideHomeScreen()) return 'needs-home-screen';
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return (await currentSubscription()) ? 'on' : 'off';
}

/** VAPID keys are url-safe base64; subscribe() wants the raw bytes. */
function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const base64 = key
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .padEnd(Math.ceil(key.length / 4) * 4, '=');
  const raw = atob(base64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Call from a click: the permission prompt needs a user gesture. */
export async function subscribeThisDevice(vapidPublicKey: string): Promise<'on' | 'blocked'> {
  const permission =
    Notification.permission === 'default'
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== 'granted') return 'blocked';
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(vapidPublicKey),
  });
  await savePushSubscription(subscription.toJSON());
  return 'on';
}

/** Server first (needs the session), then the browser. */
export async function forgetThisDevice(): Promise<void> {
  if (!pushSupported()) return;
  const subscription = await currentSubscription();
  if (!subscription) return;
  try {
    await deletePushSubscription(subscription.endpoint);
  } finally {
    // Never leave the browser subscribed after logout, even if the server call failed.
    await subscription.unsubscribe();
  }
}
