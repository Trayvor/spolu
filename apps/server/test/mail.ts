import type { EmailMessage, EmailSender } from '../src/infra/email/index.js';

// In-memory mail capture for server tests. `buildTestApp` gives the app a sender that stores each
// message here, per recipient, instead of sending it over SMTP to Mailpit: no network hop and no
// polling of a shared server that every parallel run fills (performance.md, "Test suite speed").
// Each Vitest worker runs its test file in its own module scope, so the store is per file.
// The real SMTP path to Mailpit stays covered by `src/infra/email/email.test.ts` and the
// `realSmtp` login test in `src/modules/auth/auth.test.ts` (helpers in `test/mailpit.ts`).

export type CaughtEmail = {
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
};

/** Lowercased recipient (To and Cc) -> messages, oldest first. */
const inbox = new Map<string, CaughtEmail[]>();
const waiters = new Set<() => void>();

/** An EmailSender that stores what it is given; `buildTestApp` uses it by default. */
export function createCapturingEmailSender(): EmailSender {
  return {
    async send(msg: EmailMessage) {
      const caught = { subject: msg.subject, text: msg.text, html: msg.html, headers: msg.headers };
      for (const to of [...msg.to, ...(msg.cc ?? [])]) {
        const key = to.toLowerCase();
        inbox.set(key, [...(inbox.get(key) ?? []), caught]);
      }
      for (const wake of [...waiters]) wake();
    },
  };
}

function messagesTo(email: string): CaughtEmail[] {
  return inbox.get(email.toLowerCase()) ?? [];
}

export async function countEmailsTo(email: string): Promise<number> {
  return messagesTo(email).length;
}

/** Resolves on the next stored message or after `ms`, whichever comes first. */
function nextMessage(ms: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      waiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    waiters.add(done);
  });
}

/**
 * The newest email to `email` that `match` accepts (any email when omitted); waits until one is
 * stored or the timeout passes. The deadline is generous on purpose: the wait ends as soon as a
 * message is stored, so load only makes it longer and never fails it early.
 */
async function waitForEmail(
  email: string,
  match: (caught: CaughtEmail) => boolean,
  timeoutMs: number,
  what: string,
): Promise<CaughtEmail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const found = messagesTo(email).findLast(match);
    if (found) return found;
    const left = deadline - Date.now();
    if (left <= 0) throw new Error(`No ${what} to ${email} within ${timeoutMs} ms`);
    await nextMessage(left);
  }
}

/** The newest email to `email`; waits until one arrives (see `waitForEmail`). */
export function latestEmail(email: string, timeoutMs = 25_000): Promise<CaughtEmail> {
  return waitForEmail(email, () => true, timeoutMs, 'email');
}

/** The newest email to `email` whose subject equals or matches `subject`; waits until one arrives. */
export function emailWithSubject(
  email: string,
  subject: string | RegExp,
  timeoutMs = 25_000,
): Promise<CaughtEmail> {
  const match = (c: CaughtEmail) =>
    typeof subject === 'string' ? c.subject === subject : subject.test(c.subject);
  return waitForEmail(email, match, timeoutMs, `email "${String(subject)}"`);
}

/** The login code from the newest email to `email` (the first 6-digit number in its text). */
export async function latestLoginCode(email: string, timeoutMs = 25_000): Promise<string> {
  return loginCodeIn(email, (await latestEmail(email, timeoutMs)).text);
}

/** The first 6-digit number in `text`; throws when there is none. */
export function loginCodeIn(email: string, text: string): string {
  const code = /\b\d{6}\b/.exec(text)?.[0];
  if (!code) throw new Error(`No login code in the email to ${email}`);
  return code;
}
