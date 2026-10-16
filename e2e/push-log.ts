import { createECDH, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PushPayload } from '@spolu/shared';

/** The file the e2e server's fake push sender appends to; playwright.config.ts sets PUSH_FAKE_FILE. */
export const PUSH_FAKE_FILE = resolve('data/e2e-push.jsonl');

/**
 * A subscription the server accepts. The endpoint host must be on the server's push-service
 * allowlist (SSRF guard), so it is an FCM-looking URL with a unique path; the fake sender never
 * contacts it.
 */
export function fakeSubscription(): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/e2e-${randomUUID()}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

/** Every push the fake sender recorded for `endpoint`, oldest first. */
export function pushesFor(endpoint: string): PushPayload[] {
  if (!existsSync(PUSH_FAKE_FILE)) return [];
  const out: PushPayload[] = [];
  for (const line of readFileSync(PUSH_FAKE_FILE, 'utf8').split('\n')) {
    if (line.trim() === '') continue;
    try {
      const row = JSON.parse(line) as { endpoint: string; payload: PushPayload };
      if (row.endpoint === endpoint) out.push(row.payload);
    } catch {
      // A line still being written; the next poll sees it whole.
    }
  }
  return out;
}

export async function waitForPush(
  endpoint: string,
  match: (p: PushPayload) => boolean,
  timeoutMs = 10_000,
): Promise<PushPayload> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = pushesFor(endpoint).find(match);
    if (found) return found;
    if (Date.now() > deadline)
      throw new Error(`No matching push for ${endpoint} in ${timeoutMs} ms`);
    await new Promise((r) => setTimeout(r, 200));
  }
}
