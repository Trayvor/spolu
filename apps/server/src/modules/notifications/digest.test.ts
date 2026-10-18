import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SendMessageInput, SessionUser, UserLanguage } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { countEmailsTo, latestEmail } from '../../../test/mail.js';
import { sendMessage } from '../chat/messages.js';
import { ensureGroupChannel, markRead, type ChannelRow } from '../chat/service.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, setNotificationChannel } from '../users/service.js';
import { deliverPending } from './deliver.js';
import { digestEmail, sendDueDigests, splitByUrl } from './digest.js';
import { notificationEvents } from './schema.js';

let deps: AppDeps;
let quiet: AppDeps;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, close } = await buildTestApp());
  quiet = { ...deps, jobs: { send: async () => {} } };
});
const admins: string[] = [];
afterAll(async () => {
  for (const id of admins) await deactivateUser(deps.db, id);
  await close();
});

const later = () => new Date(Date.now() + deps.config.emailBatchDelayMs + 1000);

/** A group with an admin author ("Jana") and a client with every group on email only. */
async function setup(language: 'sk' | 'en' = 'sk') {
  const group = await createGroup(deps.db, {
    name: `Firma ${randomUUID().slice(0, 8)}`,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  const channel = await ensureGroupChannel(deps.db, group.id);
  const adminRow = await addAdmin(deps.db, { email: `${randomUUID()}@example.com`, name: 'Jana' });
  admins.push(adminRow.id);
  const admin = {
    id: adminRow.id,
    email: adminRow.email,
    name: 'Jana',
    role: 'admin',
  } as SessionUser;
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await deps.db
    .insert(user)
    .values({ id, email, name: 'Anna', role: 'client', emailVerified: true, language });
  await addMember(deps.db, group.id, id);
  for (const group of ['chat', 'tasks', 'tickets', 'knowledge'] as const) {
    await setNotificationChannel(deps.db, id, group, 'email');
  }
  return { group, channel, admin, client: { id, email } };
}

const send = async (channel: ChannelRow, author: SessionUser, body: string) =>
  (
    await sendMessage(quiet, {
      channel,
      author,
      data: { body, clientId: randomUUID() } as SendMessageInput,
    })
  ).message;

describe('digestEmail', () => {
  const chat = {
    topic: 'Firma',
    url: 'https://x/groups/g/chat',
    button: 'Open Firma',
    messages: true,
  };
  const base = { to: 'a@example.com', publicUrl: 'https://x' };
  const lines = (n: number) => Array.from({ length: n }, (_, i) => String(i + 1));
  it('messages of one place: "N new messages – <topic>", in the plural forms of the language', () => {
    const subject = (lang: UserLanguage, count: number) =>
      digestEmail({ ...base, lang, sections: [{ ...chat, lines: lines(count) }] }).subject;
    expect(subject('en', 1)).toBe('1 new message – Firma');
    expect(subject('en', 3)).toBe('3 new messages – Firma');
    expect(subject('sk', 1)).toBe('1 nová správa – Firma');
    expect(subject('sk', 3)).toBe('3 nové správy – Firma');
    expect(subject('sk', 5)).toBe('5 nových správ – Firma');
  });
  it('one other change is its own subject; several are "<topic>: N updates"', () => {
    const ticket = { topic: 'Ticket #12', url: 'https://x/tickets/t', button: 'Open ticket' };
    const one = digestEmail({
      ...base,
      lang: 'en',
      sections: [{ ...ticket, messages: false, lines: ['#12 is now Resolved: Login fails'] }],
    });
    expect(one.subject).toBe('#12 is now Resolved: Login fails');
    const two = digestEmail({
      ...base,
      lang: 'en',
      sections: [{ ...ticket, messages: false, lines: ['a', 'b'] }],
    });
    expect(two.subject).toBe('Ticket #12: 2 updates');
    expect(
      digestEmail({
        ...base,
        lang: 'en',
        sections: [{ ...ticket, messages: false, lines: ['x'.repeat(200)] }],
      }).subject,
    ).toBe(`${'x'.repeat(119)}…`);
  });
  it('shows the 5 newest lines and an Open button', () => {
    const m = digestEmail({ ...base, lang: 'en', sections: [{ ...chat, lines: lines(7) }] });
    expect(m.text).toContain(
      '7 NEW MESSAGES – FIRMA\n\n3\n\n4\n\n5\n\n6\n\n7\n\nOpen Firma: https://x/groups/g/chat\n\n---',
    );
  });
  it('several places: one email, a section with its own button each, the count of all', () => {
    const m = digestEmail({
      ...base,
      lang: 'en',
      sections: [
        { ...chat, lines: ['Jana: hi'] },
        {
          topic: 'Ticket #12',
          url: 'https://x/tickets/t',
          button: 'Open ticket',
          messages: false,
          lines: ['#12 was changed', '#12 is now Resolved'],
        },
      ],
    });
    expect(m.subject).toBe('3 updates: Firma, Ticket #12');
    const text = m.text.replaceAll('\r\n', '\n');
    expect(text).toContain('Jana: hi');
    expect(text).toContain('Open Firma: https://x/groups/g/chat');
    expect(text).toContain('Open ticket: https://x/tickets/t');
    expect(text.indexOf('Open Firma')).toBeLessThan(text.indexOf('#12 was changed'));
  });
  it('names two places in the subject and shows at most 10 sections', () => {
    const sections = Array.from({ length: 12 }, (_, i) => ({
      topic: `Ticket #${i + 1}`,
      url: `https://x/tickets/${i + 1}`,
      button: 'Open ticket',
      messages: false,
      lines: ['changed'],
    }));
    const m = digestEmail({ ...base, lang: 'en', sections });
    expect(m.subject).toBe('12 updates: Ticket #1, Ticket #2 and 10 more');
    expect(m.text).toContain('https://x/tickets/10');
    expect(m.text).not.toContain('https://x/tickets/11');
    expect(m.text).toContain('And 2 more in Help.');
  });
});

describe('sendDueDigests', () => {
  it('one email for 3 unread messages after the delay', async () => {
    const s = await setup();
    for (const body of ['Raz', 'Dva', 'Tri']) await send(s.channel, s.admin, body);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe(`3 nové správy – ${s.group.name}`);
    expect(mail.text.replaceAll('\r\n', '\n')).toContain('Jana: Raz\n\nJana: Dva\n\nJana: Tri');
    expect(mail.text).toContain(`${deps.config.publicUrl}/groups/${s.group.id}/chat`);
    expect(await countEmailsTo(s.client.email)).toBe(1);
  });

  it('nothing before the delay', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    const [row] = await deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.userId, s.client.id));
    const now = new Date(row!.emailDueAt!.getTime() - 1000);
    expect(await sendDueDigests(deps, { now, userIds: [s.client.id] })).toBe(0);
    expect(await countEmailsTo(s.client.email)).toBe(0);
  });

  it('none when the messages were read within the delay', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    await markRead(deps.db, s.client.id, s.channel.id, new Date());
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(0);
    expect(await countEmailsTo(s.client.email)).toBe(0);
  });

  it('a message read and another unread gives a digest of 1', async () => {
    const s = await setup('en');
    const old = await send(s.channel, s.admin, 'Old');
    await deliverPending(deps, { userIds: [s.client.id] });
    // Read up to (and including) the first message only, by an explicit instant.
    await markRead(deps.db, s.client.id, s.channel.id, new Date(old.createdAt));
    await send(s.channel, s.admin, 'New');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe(`1 new message – ${s.group.name}`);
    expect(mail.text).toContain('Jana: New');
    expect(mail.text).not.toContain('Old');
  });

  it('events after the first one join the same email', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    await send(s.channel, s.admin, 'Dva');
    await deliverPending(deps, { userIds: [s.client.id] });
    // The second event is not due yet at the first one's due time, but still joins.
    const [first] = await deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.userId, s.client.id))
      .orderBy(notificationEvents.emailDueAt);
    const now = new Date(first!.emailDueAt!.getTime() + 1);
    expect(await sendDueDigests(deps, { now, userIds: [s.client.id] })).toBe(1);
    expect((await latestEmail(s.client.email)).subject).toBe(`2 nové správy – ${s.group.name}`);
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(0);
    expect(await countEmailsTo(s.client.email)).toBe(1);
  });

  it('chat switched away from email before the digest sends nothing', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    await setNotificationChannel(deps.db, s.client.id, 'chat', 'push');
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(0);
    expect(await countEmailsTo(s.client.email)).toBe(0);
  });

  it('the same rows are never emailed twice', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(0);
    expect(await countEmailsTo(s.client.email)).toBe(1);
    const rows = await deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.userId, s.client.id));
    expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
  });

  it('deliverPending queues the digest job with a delay', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    const sent: { name: string; data: object; options?: object }[] = [];
    const spy = {
      ...deps,
      jobs: {
        send: async (name: string, data: object, options?: object) =>
          void sent.push({ name, data, options }),
      },
    };
    await deliverPending(spy, { userIds: [s.client.id] });
    expect(sent.filter((j) => j.name === 'notifications.email-digest')).toEqual([
      {
        name: 'notifications.email-digest',
        data: { userIds: [s.client.id] },
        options: { startAfter: Math.ceil(deps.config.emailBatchDelayMs / 1000) },
      },
    ]);
  });

  it('only the groups that still want email make lines', async () => {
    const s = await setup('en');
    await setNotificationChannel(deps.db, s.client.id, 'chat', 'push');
    await setNotificationChannel(deps.db, s.client.id, 'tasks', 'both');
    const pending = { userId: s.client.id, groupId: s.group.id, deliveredAt: new Date() };
    await deps.db.insert(notificationEvents).values([
      {
        ...pending,
        id: randomUUID(),
        kind: 'task.assigned',
        payload: { actorName: 'Jana', title: 'Plan the launch' },
        emailDueAt: new Date(),
      },
      {
        ...pending,
        id: randomUUID(),
        kind: 'task.assigned',
        // A task chat would be tasks too; a group chat event is not wanted by email now.
        payload: { actorName: 'Jana', title: 'Second' },
        emailDueAt: new Date(),
      },
    ]);
    const msg = await send(s.channel, s.admin, 'Chat line');
    await deps.db
      .update(notificationEvents)
      .set({ deliveredAt: new Date(), emailDueAt: new Date() })
      .where(eq(notificationEvents.userId, s.client.id));
    expect(msg.id).toBeTruthy();
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe(`${s.group.name}: 2 updates`);
    expect(mail.text).toContain('Plan the launch');
    expect(mail.text).not.toContain('Chat line');
  });

  it('a group switched to push after delivery: no email, rows stamped', async () => {
    const s = await setup('en');
    await deps.db.insert(notificationEvents).values({
      id: randomUUID(),
      userId: s.client.id,
      groupId: s.group.id,
      kind: 'task.assigned',
      payload: { actorName: 'Jana', title: 'Plan' },
      deliveredAt: new Date(),
      emailDueAt: new Date(),
    });
    await setNotificationChannel(deps.db, s.client.id, 'tasks', 'push');
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(0);
    const rows = await deps.db
      .select()
      .from(notificationEvents)
      .where(eq(notificationEvents.userId, s.client.id));
    expect(rows.every((r) => r.emailedAt !== null)).toBe(true);
  });

  it('a task event makes a line "<body>: <task title>"', async () => {
    const s = await setup('en');
    await deps.db.insert(notificationEvents).values({
      id: randomUUID(),
      userId: s.client.id,
      groupId: s.group.id,
      kind: 'task.assigned',
      payload: { actorName: 'Jana', title: 'Plan the launch' },
      deliveredAt: new Date(),
      emailDueAt: new Date(),
    });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe('Jana assigned you to this task: Plan the launch');
    expect(mail.text).toContain('Jana assigned you to this task: Plan the launch');
  });

  it('a reminder event becomes the line "Reminder: <title>, <time>"', async () => {
    const s = await setup('en');
    await deps.db.insert(notificationEvents).values({
      id: randomUUID(),
      userId: s.client.id,
      groupId: s.group.id,
      kind: 'reminder.due',
      payload: {
        subjectKind: 'knowledge',
        subjectId: 'k1',
        groupId: s.group.id,
        title: 'Call the bank',
        at: '2026-10-25T09:00:00Z',
      },
      deliveredAt: new Date(),
      emailDueAt: new Date(),
    });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.text).toContain('Reminder: Call the bank, Sun 25 Oct, 10:00');
  });

  it('an sk reminder digest line reads "Pripomienka: <title>, <time>"', async () => {
    const s = await setup('sk');
    await deps.db.insert(notificationEvents).values({
      id: randomUUID(),
      userId: s.client.id,
      groupId: s.group.id,
      kind: 'reminder.due',
      payload: {
        subjectKind: 'knowledge',
        subjectId: 'k1',
        groupId: s.group.id,
        title: 'Zavolať banke',
        at: '2026-10-25T09:00:00Z',
      },
      deliveredAt: new Date(),
      emailDueAt: new Date(),
    });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    expect((await latestEmail(s.client.email)).text).toContain('Pripomienka: Zavolať banke, ');
  });

  it('the sweep without userIds emails due digests', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    // The sweep emails every due digest of the database, and the shared test database holds the
    // pending digests of every other test file (each ticket without a client notifies every
    // admin, Phase 21.6) and of old runs: thousands of them on a long-lived local database. So
    // the sweep runs at a `now` in 1970 and only this test's event is made due then (due at the
    // epoch): no other row can be due that long ago, whatever the database holds.
    const epoch = new Date(0);
    await deps.db
      .update(notificationEvents)
      .set({ emailDueAt: epoch })
      .where(eq(notificationEvents.userId, s.client.id));
    expect(await sendDueDigests(deps, { now: new Date(1000) })).toBe(1);
    expect((await latestEmail(s.client.email)).subject).toBe(`1 nová správa – ${s.group.name}`);
    expect(await countEmailsTo(s.client.email)).toBe(1);
  });

  it('a digest that cannot be queued is retried by the next run', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    const broken = {
      ...deps,
      jobs: {
        send: async () => {
          throw new Error('queue down');
        },
      },
    };
    expect(await sendDueDigests(broken, { now: later(), userIds: [s.client.id] })).toBe(0);
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    expect(await countEmailsTo(s.client.email)).toBe(1);
  });

  it('one email per person and window, across groups (2026-10-18)', async () => {
    const s = await setup('en');
    const other = await createGroup(deps.db, {
      name: `Druhá ${randomUUID().slice(0, 8)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
    });
    await addMember(deps.db, other.id, s.client.id);
    const otherChannel = await ensureGroupChannel(deps.db, other.id);
    await send(s.channel, s.admin, 'First');
    await send(otherChannel, s.admin, 'Second');
    await send(otherChannel, s.admin, 'Third');
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    expect(await countEmailsTo(s.client.email)).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe(`3 updates: ${s.group.name}, ${other.name}`);
    const text = mail.text.replaceAll('\r\n', '\n');
    expect(text).toContain(`${deps.config.publicUrl}/groups/${s.group.id}/chat`);
    expect(text).toContain(`${deps.config.publicUrl}/groups/${other.id}/chat`);
    expect(text).toContain('Jana: Second\n\nJana: Third');
  });

  it('two parallel runs send one email', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    const opts = { now: later(), userIds: [s.client.id] };
    const counts = await Promise.all([sendDueDigests(deps, opts), sendDueDigests(deps, opts)]);
    expect(counts.reduce((a, b) => a + b, 0)).toBe(1);
    expect(await countEmailsTo(s.client.email)).toBe(1);
  });
});

describe('splitByUrl', () => {
  it('groups entries by url in first-seen order, keeping their rows', () => {
    const e = (line: string, url: string) => ({ line, url, button: 'Open', topic: 'Firma' });
    const groups = splitByUrl([
      { entry: e('a', '/t/1'), rowId: 'r1' },
      { entry: e('b', '/chat'), rowId: 'r2' },
      { entry: e('c', '/t/1'), rowId: 'r3' },
    ]);
    expect(groups.map((g) => [g.url, g.lines, g.rowIds])).toEqual([
      ['/t/1', ['a', 'c'], ['r1', 'r3']],
      ['/chat', ['b'], ['r2']],
    ]);
  });
});
