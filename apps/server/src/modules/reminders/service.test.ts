import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, inArray } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb, type Db } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { groupMembers } from '../groups/schema.js';
import { addManager, removeManager } from '../groups/managers.js';
import { addMember, createGroup, setGroupDeactivated } from '../groups/service.js';
import { knowledgeItems } from '../knowledge/schema.js';
import { user } from '../users/schema.js';
import { addAdmin, deactivateUser, getUserNames } from '../users/service.js';
import { isAdmin } from '../users/policy.js';
import {
  AuthorRecipientError,
  InvalidRecipientError,
  InvalidReminderError,
  NoReminderSetError,
  NotReadableError,
  ReminderInPastError,
} from './errors.js';
import { insertTask } from '../../../test/tasks.js';
import { tasks } from '../tasks/schema.js';
import { reminderRecipients, reminderTimes } from './schema.js';
import {
  buildIcs,
  countUpcomingForUser,
  emptyReminderSet,
  getReminderSet,
  getSetAuthorId,
  listUpcomingForUser,
  pruneRecipientsForAdminsOnly,
  replaceReminderSet,
  subscribe,
  unsubscribe,
} from './service.js';
import { registerReminderSubject, type SubjectInfo } from './subjects.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

// A stub `knowledge` adapter over real rows: admins read everything, clients the public items of
// their own group; the author and admins edit.
beforeAll(() => {
  registerReminderSubject({
    kind: 'knowledge',
    routePrefix: 'knowledge',
    async loadMany(db: Db, ids: string[]) {
      const map = new Map<string, SubjectInfo>();
      if (ids.length === 0) return map;
      const rows = await db.select().from(knowledgeItems).where(inArray(knowledgeItems.id, ids));
      for (const row of rows) {
        const adminsOnly = row.visibility === 'admins';
        map.set(row.id, {
          groupId: row.groupId,
          title: row.title,
          body: row.body,
          adminsOnly,
          active: true,
          authorId: row.createdBy,
          link: `/groups/${row.groupId}/knowledge?k=${row.id}`,
          canRead: (actor, actorGroupIds) =>
            isAdmin(actor) || (!adminsOnly && actorGroupIds.includes(row.groupId)),
          canEdit: (actor) => isAdmin(actor) || actor.id === row.createdBy,
        });
      }
      return map;
    },
  });
});

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const inMs = (ms: number, from = new Date()) => new Date(from.getTime() + ms).toISOString();

const newGroup = () =>
  createGroup(db, {
    name: 'Firma',
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });

async function newAdmin(name = 'Ada'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  return { id: admin.id, email, name, role: 'admin', finance: false };
}

async function newClient(groupId: string, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client', finance: false };
}

async function newItem(
  groupId: string,
  author: SessionUser,
  opts: { visibility?: 'public' | 'admins'; title?: string; body?: string } = {},
) {
  const id = randomUUID();
  await db.insert(knowledgeItems).values({
    id,
    groupId,
    type: 'reminder',
    visibility: opts.visibility ?? 'public',
    title: opts.title ?? 'Submit the report',
    body: opts.body ?? 'Do it',
    createdBy: author.id,
    searchText: 'x',
  });
  return {
    kind: 'knowledge' as const,
    id,
    groupId,
    adminsOnly: opts.visibility === 'admins',
    authorId: author.id,
  };
}

type Subject = Awaited<ReturnType<typeof newItem>>;
type Input = Parameters<typeof replaceReminderSet>[2];

const replace = (subject: Subject, input: Input, actor: SessionUser, now = new Date()) =>
  db.transaction((tx) => replaceReminderSet(tx, subject, input, actor, now));

async function timesOf(subject: Subject, actor: SessionUser) {
  return (await getReminderSet(db, subject, actor))!.times;
}

/** A group with an admin and a client, and a reminder item by the admin. */
async function setup(opts: { visibility?: 'public' | 'admins' } = {}) {
  const group = await newGroup();
  const [admin, client] = await Promise.all([newAdmin(), newClient(group.id)]);
  const subject = await newItem(group.id, admin, opts);
  return { group, admin, client, subject };
}

const markFired = (timeId: string) =>
  db
    .update(reminderTimes)
    .set({ firedAt: new Date(Date.now() - MIN) })
    .where(eq(reminderTimes.id, timeId));

describe('replaceReminderSet', () => {
  it('keeps fired times, deletes missing unfired times, inserts new ones', async () => {
    const { admin, subject } = await setup();
    const [a, b, c] = [inMs(DAY), inMs(2 * DAY), inMs(3 * DAY)];
    await replace(subject, { times: [{ at: a }, { at: b }, { at: c }], recipientIds: [] }, admin);
    const before = await timesOf(subject, admin);
    expect(before.map((t) => t.at)).toEqual([a, b, c]);
    await markFired(before[0]!.id);

    const d = inMs(4 * DAY);
    const changedC = inMs(5 * DAY);
    // The fired one and b are left out, c moves, d is new.
    await replace(
      subject,
      { times: [{ id: before[2]!.id, at: changedC }, { at: d }], recipientIds: [] },
      admin,
    );
    const after = await timesOf(subject, admin);
    // Upcoming first by `at`, then fired.
    expect(after.map((t) => t.at)).toEqual([d, changedC, a]);
    expect(after[1]!.id).toBe(before[2]!.id);
    expect(after.map((t) => t.firedAt === null)).toEqual([true, true, false]);
    expect(after.some((t) => t.id === before[1]!.id)).toBe(false);
  });

  it('replaceReminderSet accepts an unchanged fired time and keeps it fired', async () => {
    const { admin, subject } = await setup();
    const a = inMs(DAY);
    await replace(subject, { times: [{ at: a }], recipientIds: [] }, admin);
    const [time] = await timesOf(subject, admin);
    await markFired(time!.id);
    const [fired] = await timesOf(subject, admin);

    // The same instant in another offset is the same time.
    const sameInOffset = new Date(a).toISOString().replace('Z', '+00:00');
    await replace(
      subject,
      { times: [{ id: time!.id, at: sameInOffset }, { at: inMs(2 * DAY) }], recipientIds: [] },
      admin,
    );
    const after = await timesOf(subject, admin);
    expect(after).toHaveLength(2);
    expect(after[1]).toEqual(fired);
  });

  it('a fired time with a changed at is invalid_reminder', async () => {
    const { admin, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    const [time] = await timesOf(subject, admin);
    await markFired(time!.id);
    await expect(
      replace(subject, { times: [{ id: time!.id, at: inMs(2 * DAY) }], recipientIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('an unknown time id is invalid_reminder', async () => {
    const { admin, subject } = await setup();
    await expect(
      replace(subject, { times: [{ id: randomUUID(), at: inMs(DAY) }], recipientIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
    // A time of another set is unknown too.
    const other = await newItem(subject.groupId, admin);
    await replace(other, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    const [foreign] = await timesOf(other, admin);
    await expect(
      replace(subject, { times: [{ id: foreign!.id, at: inMs(DAY) }], recipientIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('refuses a time under one minute ahead', async () => {
    const { admin, subject } = await setup();
    const now = new Date();
    await expect(
      replace(subject, { times: [{ at: inMs(59_000, now) }], recipientIds: [] }, admin, now),
    ).rejects.toBeInstanceOf(ReminderInPastError);
    await expect(
      replace(subject, { times: [{ at: inMs(-DAY, now) }], recipientIds: [] }, admin, now),
    ).rejects.toBeInstanceOf(ReminderInPastError);
    await replace(subject, { times: [{ at: inMs(MIN, now) }], recipientIds: [] }, admin, now);
    // Too far ahead is invalid, not past.
    await expect(
      replace(subject, { times: [{ at: inMs(6 * 365 * DAY, now) }], recipientIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('accepts a time exactly 5 years ahead and refuses one past it', async () => {
    const { admin, subject } = await setup();
    const now = new Date('2026-10-16T10:00:00.000Z');
    const max = '2031-10-16T10:00:00.000Z';
    await replace(subject, { times: [{ at: max }], recipientIds: [] }, admin, now);
    await expect(
      replace(
        subject,
        { times: [{ at: '2031-10-16T10:00:00.001Z' }], recipientIds: [] },
        admin,
        now,
      ),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('a duplicate time id is invalid_reminder', async () => {
    const { admin, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    const [time] = await timesOf(subject, admin);
    await expect(
      replace(
        subject,
        {
          times: [
            { id: time!.id, at: time!.at },
            { id: time!.id, at: inMs(2 * DAY) },
          ],
          recipientIds: [],
        },
        admin,
      ),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('a time changed to under one minute ahead is reminder_in_past', async () => {
    const { admin, subject } = await setup();
    const now = new Date();
    await replace(subject, { times: [{ at: inMs(DAY, now) }], recipientIds: [] }, admin, now);
    const [time] = await timesOf(subject, admin);
    await expect(
      replace(
        subject,
        { times: [{ id: time!.id, at: inMs(30_000, now) }], recipientIds: [] },
        admin,
        now,
      ),
    ).rejects.toBeInstanceOf(ReminderInPastError);
    // An unchanged time that has come within the minute is still accepted.
    const later = new Date(new Date(time!.at).getTime() - 30_000);
    await replace(
      subject,
      { times: [{ id: time!.id, at: time!.at }], recipientIds: [] },
      admin,
      later,
    );
  });

  it('removing an added recipient deletes their row', async () => {
    const { group, admin, client, subject } = await setup();
    const dana = await newClient(group.id, 'Dana');
    await replace(
      subject,
      { times: [{ at: inMs(DAY) }], recipientIds: [client.id, dana.id] },
      admin,
    );
    const times = await timesOf(subject, admin);
    await replace(subject, { times, recipientIds: [dana.id] }, admin);
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients.map((r) => [r.user.id, r.source])).toEqual([
      [admin.id, 'author'],
      [dana.id, 'added'],
    ]);
    expect((await getReminderSet(db, subject, client))!.subscribed).toBe(false);
  });

  it('refuses the 21st time', async () => {
    const { admin, subject } = await setup();
    const times = (n: number) => Array.from({ length: n }, (_, i) => ({ at: inMs((i + 1) * DAY) }));
    await replace(subject, { times: times(20), recipientIds: [] }, admin);
    await expect(
      replace(subject, { times: times(21), recipientIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('recipients must be group people', async () => {
    const { admin, client, subject } = await setup();
    const otherGroup = await newGroup();
    const stranger = await newClient(otherGroup.id);
    await expect(
      replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [stranger.id] }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await expect(
      replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [randomUUID()] }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    const otherAdmin = await newAdmin('Bob');
    await addManager(db, subject.groupId, otherAdmin.id);
    await replace(
      subject,
      { times: [{ at: inMs(DAY) }], recipientIds: [client.id, otherAdmin.id] },
      admin,
    );
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients.map((r) => [r.user.id, r.source])).toEqual([
      [admin.id, 'author'],
      [otherAdmin.id, 'added'],
      [client.id, 'added'],
    ]);
  });

  it('a new recipient admin must manage the client; one who stopped managing stays', async () => {
    const { admin, subject } = await setup();
    const bob = await newAdmin('Bob');
    await expect(
      replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [bob.id] }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
    await addManager(db, subject.groupId, bob.id);
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [bob.id] }, admin);
    await removeManager(db, subject.groupId, bob.id);
    // Saving again with Bob still listed keeps him: only new recipients must be pickable.
    await replace(subject, { times: await timesOf(subject, admin), recipientIds: [bob.id] }, admin);
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients.map((r) => r.user.id)).toEqual([admin.id, bob.id]);
  });

  it('an added recipient who left the group is dropped on save, not refused', async () => {
    const { admin, client, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin);
    await deactivateUser(db, client.id);
    // The form sends the recipients it loaded; the one who left must not block the save.
    await replace(
      subject,
      { times: await timesOf(subject, admin), recipientIds: [client.id] },
      admin,
    );
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients.map((r) => r.user.id)).toEqual([admin.id]);
    // Adding someone who is not a group person is still refused.
    const stranger = await newClient((await newGroup()).id);
    await expect(
      replace(
        subject,
        { times: await timesOf(subject, admin), recipientIds: [stranger.id] },
        admin,
      ),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('refuses more than 50 recipients', async () => {
    const { admin, subject } = await setup();
    const ids = Array.from({ length: 51 }, () => randomUUID());
    await expect(
      replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: ids }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('admins-only subject refuses a client recipient', async () => {
    const { admin, client, subject } = await setup({ visibility: 'admins' });
    await expect(
      replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('the author always stays', async () => {
    const { admin, client, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin);
    const times = await timesOf(subject, admin);
    // Another editor saves without the author, then removes the client.
    const editor = await newAdmin('Bob');
    await replace(subject, { times, recipientIds: [] }, editor);
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients).toEqual([{ user: { id: admin.id, name: 'Ada' }, source: 'author' }]);
    // Listing the author as a recipient keeps them the author.
    await replace(subject, { times, recipientIds: [admin.id] }, admin);
    expect((await getReminderSet(db, subject, admin))!.recipients).toEqual(set!.recipients);
  });

  it('keeps subscribed recipients', async () => {
    const { admin, client, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    await subscribe(db, subject, client);
    await replace(subject, { times: await timesOf(subject, admin), recipientIds: [] }, admin);
    const set = await getReminderSet(db, subject, client);
    expect(set!.subscribed).toBe(true);
    expect(set!.recipients.find((r) => r.user.id === client.id)!.source).toBe('subscribed');
  });
});

describe('subscription', () => {
  it('subscribe and unsubscribe; the author cannot unsubscribe', async () => {
    const { admin, client, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    expect((await getReminderSet(db, subject, client))!.subscribed).toBe(false);
    await subscribe(db, subject, client);
    await subscribe(db, subject, client);
    const set = await getReminderSet(db, subject, client);
    expect(set!.subscribed).toBe(true);
    expect(set!.canEdit).toBe(false);
    expect(set!.recipients.map((r) => r.source)).toEqual(['author', 'subscribed']);
    await unsubscribe(db, subject, client);
    expect((await getReminderSet(db, subject, client))!.subscribed).toBe(false);

    await expect(unsubscribe(db, subject, admin)).rejects.toBeInstanceOf(AuthorRecipientError);
    // Subscribing keeps the author's row as it is.
    await subscribe(db, subject, admin);
    const author = await db
      .select()
      .from(reminderRecipients)
      .where(eq(reminderRecipients.userId, admin.id));
    expect(author.map((r) => r.source)).toEqual(['author']);
  });

  it('an added recipient can opt out', async () => {
    const { admin, client, subject } = await setup();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin);
    // Subscribing an added recipient keeps them `added`.
    await subscribe(db, subject, client);
    expect((await getReminderSet(db, subject, client))!.recipients[1]!.source).toBe('added');
    await unsubscribe(db, subject, client);
    expect((await getReminderSet(db, subject, client))!.subscribed).toBe(false);
  });

  it('subscribing to a readable subject with no set is no_reminder_set', async () => {
    const { client, subject } = await setup();
    await expect(subscribe(db, subject, client)).rejects.toBeInstanceOf(NoReminderSetError);
    await expect(unsubscribe(db, subject, client)).rejects.toBeInstanceOf(NoReminderSetError);
  });

  it('a reader who cannot read the subject gets NotReadableError', async () => {
    const { admin, client, subject } = await setup({ visibility: 'admins' });
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    await expect(subscribe(db, subject, client)).rejects.toBeInstanceOf(NotReadableError);
    await expect(unsubscribe(db, subject, client)).rejects.toBeInstanceOf(NotReadableError);
    expect(await getReminderSet(db, subject, client)).toBeNull();
    // A client of another group cannot read a public item either.
    const pub = await newItem(subject.groupId, admin);
    await replace(pub, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    const stranger = await newClient((await newGroup()).id);
    await expect(subscribe(db, pub, stranger)).rejects.toBeInstanceOf(NotReadableError);
    expect(await getReminderSet(db, pub, stranger)).toBeNull();
  });
});

describe('pruneRecipientsForAdminsOnly', () => {
  it('switching pruning drops non-admins but not the author', async () => {
    const group = await newGroup();
    const [admin, client, other] = await Promise.all([
      newAdmin(),
      newClient(group.id, 'Cleo'),
      newClient(group.id, 'Dana'),
    ]);
    // A client's own reminder, later made admins-only by an admin.
    const subject = await newItem(group.id, client);
    await addManager(db, group.id, admin.id);
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [admin.id] }, client);
    await subscribe(db, subject, other);
    await db.transaction((tx) => pruneRecipientsForAdminsOnly(tx, subject));
    const set = await getReminderSet(db, subject, admin);
    expect(set!.recipients.map((r) => [r.user.id, r.source])).toEqual([
      [client.id, 'author'],
      [admin.id, 'added'],
    ]);
  });
});

describe('buildIcs', () => {
  it('buildIcs is null with no upcoming time', async () => {
    const { admin, subject } = await setup();
    expect(await buildIcs(db, subject, admin, 'https://spolu.example')).toBeNull();
    await replace(subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, admin);
    const [time] = await timesOf(subject, admin);
    await markFired(time!.id);
    expect(await buildIcs(db, subject, admin, 'https://spolu.example')).toBeNull();
  });

  it('exports the upcoming times of a readable subject', async () => {
    const { admin, client, subject } = await setup();
    const now = new Date();
    await replace(
      subject,
      { times: [{ at: inMs(DAY, now) }, { at: inMs(2 * DAY, now) }], recipientIds: [] },
      admin,
      now,
    );
    const times = await timesOf(subject, admin);
    await markFired(times[1]!.id);
    const ics = await buildIcs(db, subject, client, 'https://spolu.example/', now);
    expect(ics!.filename).toBe('submit-the-report.ics');
    const text = ics!.text.replace(/\r\n /g, '');
    expect(text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(text).toContain(`UID:reminder-${times[0]!.id}@spolu`);
    const link = `https://spolu.example/groups/${subject.groupId}/knowledge?k=${subject.id}`;
    expect(text).toContain(`URL:${link}`);
    expect(text).toContain(`DESCRIPTION:Do it\\n\\n${link}`);

    expect(text).toMatch(/LAST-MODIFIED:\d{8}T\d{6}Z/);

    // Moving a time bumps its SEQUENCE, so a calendar re-import updates the event.
    const seq = (t: string) => Number(/SEQUENCE:(\d+)/.exec(t)![1]);
    await db
      .update(reminderTimes)
      .set({ updatedAt: new Date(Date.now() - DAY) })
      .where(eq(reminderTimes.id, times[0]!.id));
    const before = seq((await buildIcs(db, subject, client, 'https://spolu.example', now))!.text);
    await replace(
      subject,
      { times: [{ id: times[0]!.id, at: inMs(3 * DAY, now) }, times[1]!], recipientIds: [] },
      admin,
      now,
    );
    const after = seq((await buildIcs(db, subject, client, 'https://spolu.example', now))!.text);
    expect(after).toBeGreaterThan(before);

    const hidden = await setup({ visibility: 'admins' });
    await replace(hidden.subject, { times: [{ at: inMs(DAY) }], recipientIds: [] }, hidden.admin);
    expect(await buildIcs(db, hidden.subject, hidden.client, 'https://x')).toBeNull();
  });
});

describe('listUpcomingForUser by group', () => {
  it('a client who moved groups does not get the old group rows, even before the limit', async () => {
    const { admin, client, subject } = await setup();
    const now = new Date();
    const old = Array.from({ length: 5 }, (_, i) => ({ at: inMs((i + 1) * MIN * 10, now) }));
    await replace(subject, { times: old, recipientIds: [client.id] }, admin);
    const newHome = await newGroup();
    await db.delete(groupMembers).where(eq(groupMembers.userId, client.id));
    await addMember(db, newHome.id, client.id);
    const item = await newItem(newHome.id, admin);
    await replace(item, { times: [{ at: inMs(DAY, now) }], recipientIds: [client.id] }, admin);
    const mine = await listUpcomingForUser(db, client, { limit: 2 });
    expect(mine.map((r) => r.groupId)).toEqual([newHome.id]);
  });
});

describe('listUpcomingForUser', () => {
  it('listUpcomingForUser lists only own sets, earliest first, after from', async () => {
    const { group, admin, client, subject } = await setup();
    const now = new Date();
    const [a, b, c] = [inMs(DAY, now), inMs(2 * DAY, now), inMs(3 * DAY, now)];
    await replace(subject, { times: [{ at: c }, { at: a }], recipientIds: [client.id] }, admin);
    const second = await newItem(group.id, admin, { title: 'Second' });
    await replace(second, { times: [{ at: b }], recipientIds: [] }, admin);
    // A set the client is not a recipient of, and an admins-only set they could not read.
    const hidden = await newItem(group.id, admin, { visibility: 'admins' });
    await replace(hidden, { times: [{ at: inMs(DAY + MIN, now) }], recipientIds: [] }, admin);

    const mine = await listUpcomingForUser(db, client, { limit: 10 });
    expect(mine.map((r) => r.at)).toEqual([a, c]);
    expect(mine[0]).toMatchObject({
      title: 'Submit the report',
      groupId: group.id,
      groupName: 'Firma',
      target: { kind: 'knowledge', itemId: subject.id },
    });

    const adminList = await listUpcomingForUser(db, admin, { limit: 10 });
    expect(adminList.map((r) => r.at)).toEqual([a, inMs(DAY + MIN, now), b, c]);
    expect(
      (await listUpcomingForUser(db, admin, { from: new Date(b), limit: 10 })).map((r) => r.at),
    ).toEqual([b, c]);
    expect((await listUpcomingForUser(db, admin, { limit: 2 })).map((r) => r.at)).toEqual([
      a,
      inMs(DAY + MIN, now),
    ]);

    // A recipient who can no longer read the subject does not see it.
    await db
      .update(knowledgeItems)
      .set({ visibility: 'admins' })
      .where(eq(knowledgeItems.id, subject.id));
    expect(await listUpcomingForUser(db, client, { limit: 10 })).toEqual([]);
  });

  it("leaves out a deactivated group's reminders, in the list and the count", async () => {
    const { group, admin, subject } = await setup();
    const now = new Date();
    await replace(subject, { times: [{ at: inMs(DAY, now) }], recipientIds: [] }, admin);
    const week = { from: now, to: new Date(now.getTime() + 7 * DAY) };
    expect(await countUpcomingForUser(db, admin, week)).toBe(1);
    await setGroupDeactivated(db, group.id, true);
    expect(await listUpcomingForUser(db, admin, { limit: 10 })).toEqual([]);
    expect(await countUpcomingForUser(db, admin, week)).toBe(0);
  });
});

describe('getUserNames', () => {
  it('maps ids to names in one call', async () => {
    const [a, b] = await Promise.all([newAdmin('Ada'), newAdmin('Bob')]);
    const names = await getUserNames(db, [a.id, b.id, randomUUID()]);
    expect(names).toEqual(
      new Map([
        [a.id, 'Ada'],
        [b.id, 'Bob'],
      ]),
    );
    expect(await getUserNames(db, [])).toEqual(new Map());
  });
});

describe('task subjects (stand-alone edits)', () => {
  // A stub `task` adapter over real rows: admins and the group's clients read and edit.
  beforeAll(() => {
    registerReminderSubject({
      kind: 'task',
      routePrefix: 'tasks',
      standaloneEdit: true,
      addEditorsAsRecipients: true,
      async loadMany(db: Db, ids: string[]) {
        const map = new Map<string, SubjectInfo>();
        if (ids.length === 0) return map;
        const rows = await db.select().from(tasks).where(inArray(tasks.id, ids));
        for (const row of rows) {
          map.set(row.id, {
            groupId: row.groupId,
            title: row.title,
            body: row.description,
            dueDate: row.dueDate,
            adminsOnly: false,
            active: row.completedAt === null,
            authorId: row.createdBy,
            link: `/groups/${row.groupId}/tasks/${row.id}`,
            canRead: (actor, actorGroupIds) =>
              isAdmin(actor) || actorGroupIds.includes(row.groupId),
            canEdit: () => true,
          });
        }
        return map;
      },
    });
  });

  async function newTask(opts: { dueDate?: string | null; description?: string } = {}) {
    const group = await newGroup();
    const [admin, client] = await Promise.all([newAdmin(), newClient(group.id)]);
    const id = await insertTask(db, {
      groupId: group.id,
      createdBy: admin.id,
      description: opts.description ?? 'Check the totals',
      dueDate: opts.dueDate ?? null,
    });
    const task = { kind: 'task' as const, id };
    return { group, admin, client, task };
  }

  type TaskRef = { kind: 'task'; id: string };
  type PutInput = {
    times: { id?: string; at: string }[];
    recipientIds?: string[];
    baseTimeIds?: string[];
  };

  /** What the route does: the set's author, or the actor on the first time. */
  const put = (task: TaskRef, input: PutInput, actor: SessionUser, now = new Date()) =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(tasks).where(eq(tasks.id, task.id));
      const authorId = (await getSetAuthorId(tx, task)) ?? actor.id;
      await replaceReminderSet(
        tx,
        { ...task, groupId: row!.groupId, adminsOnly: false, authorId },
        { baseTimeIds: [], ...input },
        actor,
        now,
      );
    });

  const recipientsOf = async (task: TaskRef, actor: SessionUser) =>
    (await getReminderSet(db, task, actor))!.recipients.map((r) => [r.user.id, r.source]);
  const upcoming = async (task: TaskRef, actor: SessionUser) =>
    (await getReminderSet(db, task, actor))!.times.filter((t) => !t.firedAt);
  /** The upcoming times as a `PUT` sends them back. */
  const asInput = (times: { id: string; at: string }[]) => times.map(({ id, at }) => ({ id, at }));

  it('the first time creates the set with the actor as author', async () => {
    const { client, task } = await newTask();
    expect(await getSetAuthorId(db, task)).toBeNull();
    await put(task, { times: [{ at: inMs(DAY) }] }, client);
    expect(await getSetAuthorId(db, task)).toBe(client.id);
    expect(await recipientsOf(task, client)).toEqual([[client.id, 'author']]);
  });

  it('a second editor who adds a time becomes added, by themselves', async () => {
    const { admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }] }, admin);
    const loaded = await upcoming(task, client);
    await put(
      task,
      {
        times: [...asInput(loaded), { at: inMs(2 * DAY) }],
        baseTimeIds: loaded.map((t) => t.id),
      },
      client,
    );
    expect(await recipientsOf(task, admin)).toEqual([
      [admin.id, 'author'],
      [client.id, 'added'],
    ]);
    const [row] = await db
      .select()
      .from(reminderRecipients)
      .where(eq(reminderRecipients.userId, client.id));
    expect(row!.addedBy).toBe(client.id);
  });

  it('an editor who only removes a time does not become a recipient', async () => {
    const { admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }, { at: inMs(2 * DAY) }] }, admin);
    const loaded = await upcoming(task, client);
    await put(
      task,
      { times: asInput(loaded.slice(1)), baseTimeIds: loaded.map((t) => t.id) },
      client,
    );
    expect(await upcoming(task, admin)).toHaveLength(1);
    expect(await recipientsOf(task, admin)).toEqual([[admin.id, 'author']]);
  });

  it('fired times are kept', async () => {
    const { admin, task } = await newTask();
    await put(
      task,
      { times: [{ at: inMs(DAY) }, { at: inMs(2 * DAY) }, { at: inMs(3 * DAY) }] },
      admin,
    );
    const [first, second, third] = await upcoming(task, admin);
    await markFired(first!.id);
    // The panel hides fired times: it sends only the upcoming ones.
    await put(
      task,
      { times: [{ id: third!.id, at: third!.at }], baseTimeIds: [second!.id, third!.id] },
      admin,
    );
    const times = (await getReminderSet(db, task, admin))!.times;
    expect(times.map((t) => t.id)).toEqual([third!.id, first!.id]);
  });

  it('removing the last upcoming time deletes the set; the next adder becomes the author', async () => {
    const { admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin);
    const loaded = await upcoming(task, admin);
    await put(task, { times: [], baseTimeIds: loaded.map((t) => t.id) }, admin);
    expect(await getSetAuthorId(db, task)).toBeNull();
    await put(task, { times: [{ at: inMs(2 * DAY) }] }, client);
    expect(await recipientsOf(task, admin)).toEqual([[client.id, 'author']]);
  });

  it('an instant someone else added meanwhile is stored once', async () => {
    const { admin, client, task } = await newTask();
    const at = inMs(DAY);
    await put(task, { times: [{ at }] }, admin);
    await put(task, { times: [{ at }] }, client);
    expect(await upcoming(task, admin)).toHaveLength(1);
  });

  it('times added concurrently by others survive a PUT that did not know them', async () => {
    const { admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }] }, admin);
    const loadedByAdmin = await upcoming(task, admin);
    // The client adds a time the admin has not loaded.
    await put(
      task,
      {
        times: [...asInput(loadedByAdmin), { at: inMs(3 * DAY) }],
        baseTimeIds: loadedByAdmin.map((t) => t.id),
      },
      client,
    );
    // The admin removes their time, from the list they loaded.
    await put(task, { times: [], baseTimeIds: loadedByAdmin.map((t) => t.id) }, admin);
    const left = await upcoming(task, admin);
    expect(left).toHaveLength(1);
    expect(left[0]!.at).not.toBe(loadedByAdmin[0]!.at);
  });

  it('a time removed by someone else is neither re-created nor an error', async () => {
    const { admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }, { at: inMs(2 * DAY) }] }, admin);
    const loaded = await upcoming(task, client);
    // The admin removes the first time.
    await put(
      task,
      { times: asInput(loaded.slice(1)), baseTimeIds: loaded.map((t) => t.id) },
      admin,
    );
    // The client, with the old list, adds a time.
    await put(
      task,
      { times: [...asInput(loaded), { at: inMs(3 * DAY) }], baseTimeIds: loaded.map((t) => t.id) },
      client,
    );
    const left = await upcoming(task, admin);
    expect(left.map((t) => t.id)).not.toContain(loaded[0]!.id);
    expect(left).toHaveLength(2);
    // An id that was never loaded and does not exist is still invalid.
    await expect(
      put(task, { times: [{ id: randomUUID(), at: inMs(DAY) }], baseTimeIds: [] }, admin),
    ).rejects.toBeInstanceOf(InvalidReminderError);
  });

  it('a PUT without recipientIds keeps the added recipients', async () => {
    const { group, admin, client, task } = await newTask();
    const other = await newClient(group.id, 'Dana');
    await put(task, { times: [{ at: inMs(DAY) }], recipientIds: [client.id, other.id] }, admin);
    const loaded = await upcoming(task, admin);
    await put(
      task,
      { times: [...asInput(loaded), { at: inMs(2 * DAY) }], baseTimeIds: loaded.map((t) => t.id) },
      admin,
    );
    expect(await recipientsOf(task, admin)).toEqual([
      [admin.id, 'author'],
      [client.id, 'added'],
      [other.id, 'added'],
    ]);
    // With recipientIds, the added list is replaced; the author stays.
    await put(task, { times: asInput(await upcoming(task, admin)), recipientIds: [] }, admin);
    expect(await recipientsOf(task, admin)).toEqual([[admin.id, 'author']]);
  });

  it('the 21st unfired time counts others times', async () => {
    const { admin, client, task } = await newTask();
    const many = Array.from({ length: 19 }, (_, i) => ({ at: inMs(DAY + i * MIN) }));
    await put(task, { times: many }, admin);
    // The client loaded nothing (an old view) and adds two: 21 unfired after the merge.
    await expect(
      put(task, { times: [{ at: inMs(2 * DAY) }, { at: inMs(3 * DAY) }] }, client),
    ).rejects.toBeInstanceOf(InvalidReminderError);
    await put(task, { times: [{ at: inMs(2 * DAY) }] }, client);
    expect(await upcoming(task, admin)).toHaveLength(20);
  });

  it('past times are refused and recipients must be group people', async () => {
    const { admin, task } = await newTask();
    await expect(put(task, { times: [{ at: inMs(-MIN) }] }, admin)).rejects.toBeInstanceOf(
      ReminderInPastError,
    );
    const stranger = await newClient((await newGroup()).id);
    await expect(
      put(task, { times: [{ at: inMs(DAY) }], recipientIds: [stranger.id] }, admin),
    ).rejects.toBeInstanceOf(InvalidRecipientError);
  });

  it('zero times on a task without a set writes nothing', async () => {
    const { admin, task } = await newTask();
    await put(task, { times: [], recipientIds: [] }, admin);
    expect(await getSetAuthorId(db, task)).toBeNull();
    expect(await getReminderSet(db, task, admin)).toBeNull();
  });

  it('knowledge without baseTimeIds still deletes missing unfired times', async () => {
    const { admin, subject } = await setup();
    await replace(
      subject,
      { times: [{ at: inMs(DAY) }, { at: inMs(2 * DAY) }], recipientIds: [] },
      admin,
    );
    const [first] = await timesOf(subject, admin);
    await replace(subject, { times: [{ id: first!.id, at: first!.at }], recipientIds: [] }, admin);
    expect((await timesOf(subject, admin)).map((t) => t.id)).toEqual([first!.id]);
  });

  it('subscribe without a set is no_reminder_set; the task creator who is not the set author can unsubscribe', async () => {
    const { admin, client, task } = await newTask();
    await expect(subscribe(db, task, client)).rejects.toBeInstanceOf(NoReminderSetError);
    // The client sets the first time: the set is theirs, not the task creator's.
    await put(task, { times: [{ at: inMs(DAY) }] }, client);
    await subscribe(db, task, admin);
    await unsubscribe(db, task, admin);
    await expect(unsubscribe(db, task, client)).rejects.toBeInstanceOf(AuthorRecipientError);
  });

  it('emptyReminderSet', () => {
    expect(emptyReminderSet(true)).toEqual({
      times: [],
      recipients: [],
      subscribed: false,
      canEdit: true,
    });
  });

  it('buildIcs for a task has the deadline event then the timed events', async () => {
    const { admin, client, task } = await newTask({ dueDate: '2030-01-15' });
    const now = new Date();
    await put(task, { times: [{ at: inMs(DAY, now) }] }, admin, now);
    const [time] = await upcoming(task, admin);
    const ics = await buildIcs(db, task, client, 'https://spolu.example', now);
    const text = ics!.text.replace(/\r\n /g, '');
    expect(ics!.filename).toBe('fix-the-budget-table.ics');
    const uids = [...text.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!.trim());
    expect(uids).toEqual([`task-${task.id}-deadline@spolu`, `reminder-${time!.id}@spolu`]);
    expect(text).toContain('DTSTART;VALUE=DATE:20300115');
    expect(text).toContain('DTEND;VALUE=DATE:20300116');
    expect(text).toContain('SUMMARY:Deadline: Fix the budget table');
    const link = `https://spolu.example/groups/${await getSetGroup(task)}/tasks/${task.id}`;
    expect(text).toContain(`DESCRIPTION:Check the totals\\n\\n${link}`);
    expect(text.match(/BEGIN:VALARM/g)).toHaveLength(1);
  });

  it('buildIcs with a deadline and no times is not null; with neither it is null', async () => {
    const withDeadline = await newTask({ dueDate: '2030-01-15' });
    const ics = await buildIcs(db, withDeadline.task, withDeadline.admin, 'https://x');
    expect(ics!.text.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    const neither = await newTask();
    expect(await buildIcs(db, neither.task, neither.admin, 'https://x')).toBeNull();
  });

  it("the deadline summary follows the requester's language", async () => {
    const { admin, task } = await newTask({ dueDate: '2030-01-15' });
    const ics = await buildIcs(db, task, admin, 'https://x', new Date(), 'sk');
    expect(ics!.text).toContain('SUMMARY:Termín: Fix the budget table');
  });

  it('listUpcomingForUser gives task targets', async () => {
    const { group, admin, client, task } = await newTask();
    await put(task, { times: [{ at: inMs(DAY) }], recipientIds: [client.id] }, admin);
    const mine = await listUpcomingForUser(db, client, { limit: 10 });
    expect(mine).toEqual([
      expect.objectContaining({
        title: 'Fix the budget table',
        groupId: group.id,
        target: { kind: 'task', taskId: task.id },
      }),
    ]);
  });

  async function getSetGroup(task: TaskRef) {
    const [row] = await db.select().from(tasks).where(eq(tasks.id, task.id));
    return row!.groupId;
  }
});
