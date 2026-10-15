// Reads mail caught by the dev Mailpit. 127.0.0.1, not localhost: Node may resolve localhost to ::1.
const MAILPIT_URL = 'http://127.0.0.1:8025';

export type CaughtEmail = { subject: string; text: string };

type SearchResult = { messages: { ID: string; Subject: string }[] };

/** Messages to `email`, newest first. */
async function search(email: string): Promise<SearchResult['messages']> {
  const query = encodeURIComponent(`to:"${email}"`);
  const res = await fetch(`${MAILPIT_URL}/api/v1/search?query=${query}`);
  if (!res.ok) throw new Error(`Mailpit search failed: ${res.status}`);
  return ((await res.json()) as SearchResult).messages;
}

export async function countEmailsTo(email: string): Promise<number> {
  return (await search(email)).length;
}

/** The newest email to `email`; polls until one arrives or the timeout passes. */
export async function latestEmail(email: string, timeoutMs = 5000): Promise<CaughtEmail> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const [newest] = await search(email);
    if (newest) {
      const res = await fetch(`${MAILPIT_URL}/api/v1/message/${newest.ID}`);
      const message = (await res.json()) as { Subject: string; Text: string };
      return { subject: message.Subject, text: message.Text };
    }
    if (Date.now() > deadline) throw new Error(`No email to ${email} within ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

/** The login code from the newest email to `email` (the first 6-digit number in its text). */
export async function latestLoginCode(email: string, timeoutMs = 5000): Promise<string> {
  const { text } = await latestEmail(email, timeoutMs);
  const code = /\b\d{6}\b/.exec(text)?.[0];
  if (!code) throw new Error(`No login code in the email to ${email}`);
  return code;
}
