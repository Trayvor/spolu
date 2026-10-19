import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildTestApp } from '../../../test/test-app.js';
import { currentRecipients } from './recipients.js';
import { makeClient, makeGroup } from './test-fixtures.js';
import { signSummaryUnsubscribeToken } from './token.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;

describe('the weekly summary unsubscribe link', () => {
  let test: TestApp;
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    await test.app.close();
    await test.close();
  });
  const db = () => test.deps.db;
  let ip = 0;
  /** Each test its own IP, so the per-IP limit is only met where it is tested. */
  const from = () => `10.0.0.${++ip}`;

  async function person() {
    const g = await makeGroup(db(), 'Firma Link');
    const c = await makeClient(db(), g.id, { language: 'it' });
    return { g, c, token: signSummaryUnsubscribeToken(test.deps.config.appSecret, c.id, g.id) };
  }

  it('the unsubscribe page tells only groupName, language and subscribed', async () => {
    const { token } = await person();
    const res = await test.app.inject({
      method: 'GET',
      url: `/api/weekly-summary/unsubscribe/${token}`,
      remoteAddress: from(),
    });
    expect(res.json()).toEqual({ groupName: 'Firma Link', language: 'it', subscribed: true });
  });

  it('POST unsubscribes, a second POST is idempotent, subscribe brings it back', async () => {
    const { g, token } = await person();
    const remoteAddress = from();
    for (let i = 0; i < 2; i++) {
      const res = await test.app.inject({
        method: 'POST',
        url: `/api/weekly-summary/unsubscribe/${token}`,
        remoteAddress,
        headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ subscribed: false });
    }
    expect(await currentRecipients(db(), g.id)).toEqual([]);
    const back = await test.app.inject({
      method: 'POST',
      url: `/api/weekly-summary/subscribe/${token}`,
      remoteAddress,
    });
    expect(back.json()).toMatchObject({ subscribed: true });
  });

  it('one-click answers 200 with no body and needs no Origin', async () => {
    const { g, token } = await person();
    const res = await test.app.inject({
      method: 'POST',
      url: `/api/weekly-summary/unsubscribe/${token}/one-click`,
      remoteAddress: from(),
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'List-Unsubscribe=One-Click',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('');
    expect(await currentRecipients(db(), g.id)).toEqual([]);
  });

  it('a forged token is 404', async () => {
    const { token } = await person();
    const forged = `${token.slice(0, -2)}xx`;
    for (const t of [forged, 'a.b.c', 'nonsense']) {
      const res = await test.app.inject({
        method: 'GET',
        url: `/api/weekly-summary/unsubscribe/${t}`,
        remoteAddress: from(),
      });
      expect(res.statusCode).toBe(404);
    }
  });

  it('the 31st call in a minute from one IP is 429', async () => {
    const { token } = await person();
    const remoteAddress = '10.9.9.9';
    for (let i = 0; i < 30; i++) {
      const res = await test.app.inject({
        method: 'GET',
        url: `/api/weekly-summary/unsubscribe/${token}`,
        remoteAddress,
      });
      expect(res.statusCode).toBe(200);
    }
    const res = await test.app.inject({
      method: 'GET',
      url: `/api/weekly-summary/unsubscribe/${token}`,
      remoteAddress,
    });
    expect(res.statusCode).toBe(429);
  });
});
