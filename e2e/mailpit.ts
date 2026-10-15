import type { APIRequestContext } from '@playwright/test';

// Mailpit catches all dev email; its API listens on 8025. 127.0.0.1, not localhost (Node DNS issue).
const MAILPIT = 'http://127.0.0.1:8025';

/** Delete the mail Mailpit holds for `email`, so the next code read cannot return a stale one. */
export async function clearMailFor(request: APIRequestContext, email: string): Promise<void> {
  await request.delete(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
}

/** The 6-digit login code from the newest message sent to `email`; polls until it arrives. */
export async function latestLoginCode(request: APIRequestContext, email: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const { messages } = (await search.json()) as { messages?: { ID: string; Created: string }[] };
    const newest = [...(messages ?? [])].sort((a, b) => b.Created.localeCompare(a.Created))[0];
    if (newest) {
      const message = await request.get(`${MAILPIT}/api/v1/message/${newest.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = /\b\d{6}\b/.exec(Text)?.[0];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No login code arrived in Mailpit for ${email}`);
}
