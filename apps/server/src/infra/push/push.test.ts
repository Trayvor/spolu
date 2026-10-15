import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PushPayload } from '@spolu/shared';
import { createFakePushSender } from './fake-push-sender.js';
import { PushSendError, type PushTarget } from './push.js';
import { createWebPushSender } from './web-push-sender.js';

const target: PushTarget = { endpoint: 'https://push.example/1', p256dh: 'pk', auth: 'au' };
const payload: PushPayload = { title: 't', body: 'b', url: '/x', tag: 'g' };
const vapid = { publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@example.com' };

describe('web-push sender', () => {
  it('answers gone on 410 and 404', async () => {
    for (const statusCode of [410, 404]) {
      const sender = createWebPushSender(vapid, vi.fn().mockRejectedValue({ statusCode }));
      expect(await sender.send(target, payload)).toBe('gone');
    }
  });

  it('throws PushSendError with the status on 500', async () => {
    const sender = createWebPushSender(vapid, vi.fn().mockRejectedValue({ statusCode: 500 }));
    const error = await sender.send(target, payload).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PushSendError);
    expect((error as PushSendError).statusCode).toBe(500);
  });

  it('passes the VAPID details and a one-day TTL', async () => {
    const send = vi.fn().mockResolvedValue({});
    const sender = createWebPushSender(vapid, send);
    expect(await sender.send(target, payload)).toBe('sent');
    expect(send).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: 'pk', auth: 'au' } },
      JSON.stringify(payload),
      { vapidDetails: vapid, TTL: 86_400, urgency: 'high' },
    );
  });
});

describe('fake push sender', () => {
  it('records sends and appends JSON lines to its file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'spolu-push-'));
    const file = join(dir, 'push.jsonl');
    const sender = createFakePushSender(file);
    await sender.send(target, payload);
    await sender.send({ ...target, endpoint: 'https://push.example/2' }, payload);
    expect(sender.sent).toEqual([
      { endpoint: target.endpoint, payload },
      { endpoint: 'https://push.example/2', payload },
    ]);
    const lines = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ endpoint: target.endpoint, payload });
    expect(typeof lines[0].at).toBe('string');
  });

  it('failNext answers once', async () => {
    const sender = createFakePushSender();
    sender.failNext(target.endpoint, 'gone');
    expect(await sender.send(target, payload)).toBe('gone');
    expect(await sender.send(target, payload)).toBe('sent');
    sender.failNext(target.endpoint, 500);
    await expect(sender.send(target, payload)).rejects.toBeInstanceOf(PushSendError);
    expect(await sender.send(target, payload)).toBe('sent');
  });
});
