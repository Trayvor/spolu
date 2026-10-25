import type { APIRequestContext } from '@playwright/test';

// Mailpit catches all dev email; its API listens on 8025. 127.0.0.1, not localhost (Node DNS issue).
const MAILPIT = 'http://127.0.0.1:8025';

/**
 * Oldest first by Mailpit's `Created`. Compared as times, not strings: Mailpit trims trailing
 * zeros of the milliseconds, so "…:54.2Z" (54.200) sorts after "…:54.213Z" as text.
 */
function byCreated(a: { Created: string }, b: { Created: string }): number {
  return Date.parse(a.Created) - Date.parse(b.Created);
}

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
    // Newest first, skipping mail without a code (an admin's "you were added" mail can land
    // after the code it was sent before).
    for (const item of [...(messages ?? [])].sort(byCreated).reverse()) {
      const message = await request.get(`${MAILPIT}/api/v1/message/${item.ID}`);
      const { Text } = (await message.json()) as { Text: string };
      const code = /\b\d{6}\b/.exec(Text)?.[0];
      if (code) return code;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No login code arrived in Mailpit for ${email}`);
}

/** The subjects of every message Mailpit holds for `email`, oldest first. */
export async function subjectsFor(request: APIRequestContext, email: string): Promise<string[]> {
  const search = await request.get(
    `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
  );
  const { messages } = (await search.json()) as {
    messages?: { Subject: string; Created: string }[];
  };
  return [...(messages ?? [])].sort(byCreated).map((m) => m.Subject);
}

/** The newest message to `email` whose subject matches; polls until one arrives. */
export async function waitForMessage(
  request: APIRequestContext,
  email: string,
  subject: RegExp,
  timeoutMs = 30_000,
): Promise<{ Subject: string; Text: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const search = await request.get(
      `${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`,
    );
    const { messages } = (await search.json()) as {
      messages?: { ID: string; Subject: string; Created: string }[];
    };
    const match = [...(messages ?? [])]
      .sort(byCreated)
      .reverse()
      .find((m) => subject.test(m.Subject));
    if (match) {
      const message = await request.get(`${MAILPIT}/api/v1/message/${match.ID}`);
      return (await message.json()) as { Subject: string; Text: string };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  throw new Error(`No message matching ${subject} arrived in Mailpit for ${email}`);
}
