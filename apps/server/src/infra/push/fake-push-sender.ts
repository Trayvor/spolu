import { appendFile } from 'node:fs/promises';
import type { PushPayload } from '@spolu/shared';
import { PushSendError, type PushSender, type PushTarget } from './push.js';

export type FakePushSender = PushSender & {
  sent: { endpoint: string; payload: PushPayload }[];
  /** The next send to `endpoint` answers 'gone' or throws PushSendError with that status. */
  failNext(endpoint: string, outcome: 'gone' | number): void;
};

/** Tests and e2e only: records sends, optionally appending one JSON line per send to `file`. */
export function createFakePushSender(file?: string): FakePushSender {
  const sent: FakePushSender['sent'] = [];
  const failures = new Map<string, 'gone' | number>();
  return {
    sent,
    failNext(endpoint, outcome) {
      failures.set(endpoint, outcome);
    },
    async send(target: PushTarget, payload: PushPayload) {
      const outcome = failures.get(target.endpoint);
      if (outcome !== undefined) {
        failures.delete(target.endpoint);
        if (outcome === 'gone') return 'gone';
        throw new PushSendError(`Push send failed with status ${outcome}`, outcome);
      }
      sent.push({ endpoint: target.endpoint, payload });
      if (file) {
        const line = JSON.stringify({
          endpoint: target.endpoint,
          payload,
          at: new Date().toISOString(),
        });
        await appendFile(file, `${line}\n`);
      }
      return 'sent';
    },
  };
}
