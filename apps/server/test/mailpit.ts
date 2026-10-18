// Reads mail caught by the dev Mailpit, for the few server tests that send over real SMTP
// (`buildTestApp({ realSmtp: true })`); every other test reads the in-memory capture in
// `test/mail.ts`. 127.0.0.1, not localhost: Node may resolve localhost to ::1.
import { loginCodeIn, type CaughtEmail } from './mail.js';

const MAILPIT_URL = 'http://127.0.0.1:8025';

type SearchResult = { messages: { ID: string }[] };

/**
 * The newest email to `email` in Mailpit; polls until one arrives or the timeout passes. A failed
 * request (Mailpit busy under load) is retried until the deadline instead of failing at once.
 */
async function mailpitLatestEmail(email: string, timeoutMs = 25_000): Promise<CaughtEmail> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  for (;;) {
    try {
      const query = encodeURIComponent(`to:"${email}"`);
      const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
      if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
      const [newest] = ((await res.json()) as SearchResult).messages;
      if (newest) {
        const msg = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`);
        if (!msg.ok) throw new Error(`Mailpit message ${newest.ID} fetch failed: ${msg.status}`);
        const body = (await msg.json()) as { Subject: string; Text: string; HTML: string };
        return { subject: body.Subject, text: body.Text, html: body.HTML };
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    if (Date.now() > deadline) {
      throw new Error(`No email to ${email} in Mailpit within ${timeoutMs} ms ${lastError}`.trim());
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

/** The login code from the newest Mailpit email to `email`. */
export async function mailpitLoginCode(email: string, timeoutMs = 25_000): Promise<string> {
  return loginCodeIn(email, (await mailpitLatestEmail(email, timeoutMs)).text);
}
