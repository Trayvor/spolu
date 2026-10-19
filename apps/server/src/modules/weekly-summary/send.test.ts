import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { WeeklySummaryEvents, type WeeklySummaryDto } from '@spolu/shared';
import { buildTestApp } from '../../../test/test-app.js';
import { loginAs } from '../../../test/login.js';
import { countEmailsTo, latestEmail } from '../../../test/mail.js';
import { serverTexts } from '../../infra/i18n/index.js';
import { removeMembership } from '../groups/memberships.js';
import { setGroupDeactivated } from '../groups/service.js';
import { tickets } from '../tickets/schema.js';
import { deactivateUser } from '../users/service.js';
import { sweepStuck, WS_SEND_JOB } from './jobs.js';
import { weeklySummaries, weeklySummaryRecipients } from './schema.js';
import { sendSummary } from './send.js';
import { weeklyHarness } from './test-harness.js';
import { insertSummary, makeClient, makeGroup, makeManager } from './test-fixtures.js';
import { isoWeek, rangeText } from './week.js';

type TestApp = Awaited<ReturnType<typeof buildTestApp>>;
const DAY = 86_400_000;

describe('weekly summary send', () => {
  let test: TestApp;
  const admins: string[] = [];
  beforeAll(async () => {
    test = await buildTestApp();
  });
  afterAll(async () => {
    for (const id of admins) await deactivateUser(test.deps.db, id);
    await test.app.close();
    await test.close();
  });

  const db = () => test.deps.db;
  const send = (id: string, version: number, cookie: string) =>
    test.app.inject({
      method: 'POST',
      url: `/api/weekly-summaries/${id}/send`,
      headers: { cookie },
      payload: { version },
    });

  async function setup() {
    const g = await makeGroup(db(), 'Firma');
    const manager = await makeManager(db(), g.id);
    admins.push(manager.id);
    return { g, manager, cookie: await loginAs(test.app, manager.email) };
  }

  const rowOf = async (id: string) =>
    (await db().select().from(weeklySummaries).where(eq(weeklySummaries.id, id)))[0]!;

  it('send freezes recipients, answers 202 and each recipient gets one email in their language', async () => {
    const { g, cookie } = await setup();
    const sk = await makeClient(db(), g.id, { language: 'sk', name: 'Jana Nováková' });
    const it_ = await makeClient(db(), g.id, { language: 'it', name: 'Marco Rossi' });
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    const res = await send(id, 1, cookie);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ recipients: 2 });
    const row = await rowOf(id);
    expect(row).toMatchObject({ status: 'sent' });
    expect(row.sentAt).not.toBeNull();
    for (const [person, lang] of [
      [sk, 'sk'],
      [it_, 'it'],
    ] as const) {
      const mail = await latestEmail(person.email);
      expect(mail.subject).toBe(
        serverTexts(lang).weeklySummary.subject(
          'Firma',
          rangeText(lang, row.windowStart, row.windowEnd),
        ),
      );
      expect(mail.headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
      expect(await countEmailsTo(person.email)).toBe(1);
    }
    const frozen = await db()
      .select()
      .from(weeklySummaryRecipients)
      .where(eq(weeklySummaryRecipients.summaryId, id));
    expect(frozen.map((r) => [r.name, r.status]).sort()).toEqual([
      ['Jana Nováková', 'sent'],
      ['Marco Rossi', 'sent'],
    ]);
  });

  it('a second send with the same version is 409 and sends nothing twice', async () => {
    const { g, cookie } = await setup();
    const client = await makeClient(db(), g.id);
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    expect((await send(id, 1, cookie)).statusCode).toBe(202);
    const again = await send(id, 1, cookie);
    expect(again.statusCode).toBe(409);
    expect(await countEmailsTo(client.email)).toBe(1);
  });

  it('send drops refs that left the group', async () => {
    const { g, cookie } = await setup();
    const other = await makeGroup(db());
    const client = await makeClient(db(), g.id);
    const ticketId = randomUUID();
    const at = new Date();
    await db().insert(tickets).values({
      id: ticketId,
      groupId: g.id,
      source: 'manual',
      subject: 'Tajný tiket',
      status: 'resolved',
      resolvedAt: at,
      createdAt: at,
      updatedAt: at,
    });
    const content = {
      intro: 'Dobrý deň',
      done: [
        { id: randomUUID(), ref: { kind: 'ticket' as const, id: ticketId }, text: 'Tajný tiket' },
        { id: randomUUID(), ref: null, text: 'Vlastný bod' },
      ],
      waiting: [],
      upcoming: [],
      closing: '',
    };
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()), content });
    await db().update(tickets).set({ groupId: other.id }).where(eq(tickets.id, ticketId));
    const res = await send(id, 1, cookie);
    expect(res.statusCode).toBe(409);
    const body = res.json<{ error: string; current: WeeklySummaryDto }>();
    expect(body.error).toBe('refs_changed');
    expect(body.current.version).toBe(2);
    expect(body.current.content.done.map((i) => i.text)).toEqual(['Vlastný bod']);
    expect(await countEmailsTo(client.email)).toBe(0);
    expect((await send(id, 2, cookie)).statusCode).toBe(202);
    expect((await latestEmail(client.email)).text).not.toContain('Tajný tiket');
  });

  it('send with no recipient is 409 no_recipients; send in a deactivated group is 409 group_inactive', async () => {
    const { g, cookie } = await setup();
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    const none = await send(id, 1, cookie);
    expect(none.statusCode).toBe(409);
    expect(none.json()).toEqual({ error: 'no_recipients' });
    expect((await rowOf(id)).status).toBe('draft');
    await makeClient(db(), g.id);
    await setGroupDeactivated(db(), g.id, true);
    const inactive = await send(id, 1, cookie);
    expect(inactive.statusCode).toBe(409);
    expect(inactive.json()).toEqual({ error: 'group_inactive' });
  });

  it("an older week's draft can still be sent", async () => {
    const { g, cookie } = await setup();
    const client = await makeClient(db(), g.id);
    const old = await insertSummary(db(), {
      groupId: g.id,
      week: isoWeek(new Date(Date.now() - 7 * DAY)),
      windowEnd: new Date(Date.now() - 7 * DAY),
    });
    const current = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    const before = await rowOf(current);
    expect((await send(old, 1, cookie)).statusCode).toBe(202);
    expect((await rowOf(old)).status).toBe('sent');
    expect(await rowOf(current)).toEqual(before);
    expect(await countEmailsTo(client.email)).toBe(1);
  });

  it('recipients are taken at Send time', async () => {
    const { g, cookie } = await setup();
    const removed = await makeClient(db(), g.id);
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    await removeMembership(db(), g.id, removed.id);
    const added = await makeClient(db(), g.id);
    expect((await send(id, 1, cookie)).json()).toEqual({ recipients: 1 });
    expect(await countEmailsTo(removed.email)).toBe(0);
    expect(await countEmailsTo(added.email)).toBe(1);
  });

  it('the batch sends 20 a run and finishes with sent', async () => {
    const { g, manager } = await setup();
    const people = [];
    for (let i = 0; i < 45; i++) people.push(await makeClient(db(), g.id, { name: `Klient ${i}` }));
    const id = await insertSummary(db(), { groupId: g.id, week: isoWeek(new Date()) });
    const { deps, sent, emitted } = weeklyHarness(db());
    expect(await sendSummary({ ...deps, io: deps.io ?? null }, manager.id, id, 1)).toEqual({
      recipients: 45,
    });
    expect(sent.filter((s) => s.name === WS_SEND_JOB)).toHaveLength(3);
    const row = await rowOf(id);
    expect(row.status).toBe('sent');
    expect(row.sentAt).not.toBeNull();
    const changes = emitted.filter(
      (e) =>
        e.event === WeeklySummaryEvents.changed &&
        (e.payload as { status: string }).status === 'sent',
    );
    expect(changes).toHaveLength(1);
    for (const p of people) expect(await countEmailsTo(p.email)).toBe(1);
  });

  it('the sweep resumes a summary stuck in sending', async () => {
    const { g, manager } = await setup();
    const client = await makeClient(db(), g.id);
    const id = await insertSummary(db(), {
      groupId: g.id,
      week: isoWeek(new Date()),
      status: 'sending',
      updatedAt: new Date(Date.now() - 11 * 60_000),
    });
    await db()
      .update(weeklySummaries)
      .set({ sentBy: manager.id })
      .where(eq(weeklySummaries.id, id));
    await db().insert(weeklySummaryRecipients).values({
      summaryId: id,
      userId: client.id,
      name: client.name,
      email: client.email,
      language: 'sk',
    });
    const { deps } = weeklyHarness(db());
    await sweepStuck(deps, new Date());
    expect((await rowOf(id)).status).toBe('sent');
    expect(await countEmailsTo(client.email)).toBe(1);
    const [recipient] = await db()
      .select()
      .from(weeklySummaryRecipients)
      .where(
        and(
          eq(weeklySummaryRecipients.summaryId, id),
          eq(weeklySummaryRecipients.userId, client.id),
        ),
      );
    expect(recipient!.status).toBe('sent');
    // a second sweep finds nothing to do
    await sweepStuck(deps, new Date(Date.now() + 20 * 60_000));
    expect(await countEmailsTo(client.email)).toBe(1);
  });
});
