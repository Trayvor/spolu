import { EmailSendError, type EmailMessage, type EmailSender } from './email.js';

const ENDPOINT = 'https://api.elasticemail.com/v4/emails/transactional';

export function createElasticSender(
  opts: { apiKey: string; from: string },
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 10_000,
): EmailSender {
  return {
    async send(msg: EmailMessage) {
      const body = {
        Recipients: { To: msg.to, CC: msg.cc ?? [] },
        Content: {
          From: opts.from,
          Subject: msg.subject,
          Body: [
            { ContentType: 'HTML', Content: msg.html },
            { ContentType: 'PlainText', Content: msg.text },
          ],
        },
      };
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-ElasticEmail-ApiKey': opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (error) {
        // Network failure or timeout; the message never includes the API key.
        const reason = error instanceof Error ? error.message : String(error);
        throw new EmailSendError(`Elastic Email request failed: ${reason}`);
      }
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new EmailSendError(`Elastic Email responded ${res.status}: ${text}`);
      }
    },
  };
}
