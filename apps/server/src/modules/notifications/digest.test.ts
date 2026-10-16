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
import { addAdmin, deactivateUser, updateNotificationPrefs } from '../users/service.js';
import { deliverPending } from './deliver.js';
import { digestEmail, sendDueDigests } from './digest.js';
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

const DELAY = 600_000;
const later = (ms = DELAY + 1000) => new Date(Date.now() + ms);

/** A group with an admin author ("Jana") and a client with email on and push off. */
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
  await updateNotificationPrefs(deps.db, id, { emailEnabled: true, pushEnabled: false });
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
  const base = { to: 'a@example.com', groupName: 'Firma', groupUrl: 'https://x/groups/g/chat' };
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
    expect(digestEmail({ ...base, lang: 'sk', count: 1, lines: ['a'] }).text).toContain(
      'Otvoriť Firma: ',
    );
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
    await send(s.channel, s.admin, 'Old');
    await deliverPending(deps, { userIds: [s.client.id] });
    await new Promise((r) => setTimeout(r, 50));
    await markRead(deps.db, s.client.id, s.channel.id, new Date());
    await new Promise((r) => setTimeout(r, 50));
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

  it('email switched off before the digest sends nothing', async () => {
    const s = await setup();
    await send(s.channel, s.admin, 'Raz');
    await deliverPending(deps, { userIds: [s.client.id] });
    await updateNotificationPrefs(deps.db, s.client.id, { emailEnabled: false });
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
});
