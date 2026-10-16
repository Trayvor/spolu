import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { SendMessageInput, SessionUser } from '@spolu/shared';
import type { AppDeps } from '../../deps.js';
import { buildTestApp } from '../../../test/test-app.js';
import { countEmailsTo, latestEmail } from '../../../test/mailpit.js';
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
  const base = {
    to: 'a@example.com',
    topic: 'Firma',
    url: 'https://x/groups/g/chat',
    button: 'Open Firma',
  };
  it('uses the plural forms of the language', () => {
    const subject = (lang: 'en' | 'sk', count: number) =>
      digestEmail({ ...base, lang, count, lines: [] }).subject;
    expect(subject('en', 1)).toBe('1 new message in Firma');
    expect(subject('en', 3)).toBe('3 new messages in Firma');
    expect(subject('sk', 1)).toBe('1 nová správa v Firma');
    expect(subject('sk', 3)).toBe('3 nové správy v Firma');
    expect(subject('sk', 5)).toBe('5 nových správ v Firma');
  });
  it('shows the 5 newest lines and an Open button', () => {
    const m = digestEmail({
      ...base,
      lang: 'en',
      count: 7,
      lines: ['1', '2', '3', '4', '5', '6', '7'],
    });
    expect(m.text).toBe('3\n\n4\n\n5\n\n6\n\n7\n\nOpen Firma: https://x/groups/g/chat');
    expect(
      digestEmail({ ...base, button: 'Otvoriť tiket', lang: 'sk', count: 1, lines: ['a'] }).text,
    ).toContain('Otvoriť tiket: https://x/groups/g/chat');
  });
});

describe('sendDueDigests', () => {
  it('one email for 3 unread messages after the delay', async () => {
    const s = await setup();
    for (const body of ['Raz', 'Dva', 'Tri']) await send(s.channel, s.admin, body);
    await deliverPending(deps, { userIds: [s.client.id] });
    expect(await sendDueDigests(deps, { now: later(), userIds: [s.client.id] })).toBe(1);
    const mail = await latestEmail(s.client.email);
    expect(mail.subject).toBe(`3 nové správy v ${s.group.name}`);
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
    expect(mail.subject).toBe(`1 new message in ${s.group.name}`);
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
    expect((await latestEmail(s.client.email)).subject).toBe(`2 nové správy v ${s.group.name}`);
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
    expect(mail.subject).toBe(`2 new messages in ${s.group.name}`);
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
    expect(mail.subject).toBe(`1 new message in ${s.group.name}`);
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
    expect(await sendDueDigests(deps, { now: later() })).toBeGreaterThanOrEqual(1);
    expect((await latestEmail(s.client.email)).subject).toBe(`1 nová správa v ${s.group.name}`);
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
