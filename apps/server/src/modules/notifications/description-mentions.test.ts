import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { SessionUser } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { addedMentions, recordDescriptionMentions } from './description-mentions.js';
import { notificationEvents } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(close);

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

async function newClient(groupId: string | null, name = 'Cleo'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  if (groupId) await addMember(db, groupId, id);
  return { id, email, name, role: 'client', finance: false };
}

const tok = (id: string) => `<@${id}>`;

async function recipients(subjectId: string): Promise<string[]> {
  const rows = await db
    .select({ userId: notificationEvents.userId, payload: notificationEvents.payload })
    .from(notificationEvents)
    .where(and(eq(notificationEvents.kind, 'description.mention')));
  return rows
    .filter((r) => (r.payload as { subjectId?: string }).subjectId === subjectId)
    .map((r) => r.userId)
    .sort();
}

describe('addedMentions', () => {
  it('lists the people named in the new text and not in the old one, never @all', () => {
    expect(addedMentions('hi <@a>', 'hi <@a> and <@b> <@all> <@b>')).toEqual(['b']);
    expect(addedMentions(null, '<@a>')).toEqual(['a']);
    expect(addedMentions('<@a>', 'none')).toEqual([]);
  });

  it('ignores mentions inside code', () => {
    expect(addedMentions('', '`<@a>`')).toEqual([]);
  });
});

describe('recordDescriptionMentions', () => {
  it('notifies the newly named clients and managers, not the actor, not outsiders', async () => {
    const group = await newGroup();
    const actor = await newAdmin();
    const manager = await newAdmin('Mona');
    await addManager(db, group.id, manager.id);
    const plainAdmin = await newAdmin('Pia');
    const client = await newClient(group.id);
    const outsider = await newClient(null, 'Otto');
    const subjectId = randomUUID();
    const ids = await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'task', id: subjectId, title: 'Budget' },
      before: '',
      after: [actor, manager, plainAdmin, client, outsider].map((p) => tok(p.id)).join(' '),
    });
    expect(ids).toHaveLength(2);
    expect(await recipients(subjectId)).toEqual([manager.id, client.id].sort());
  });

  it('records nothing for people already named before', async () => {
    const group = await newGroup();
    const actor = await newAdmin();
    const client = await newClient(group.id);
    const subjectId = randomUUID();
    const ids = await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'project', id: subjectId, title: 'Grant' },
      before: tok(client.id),
      after: `${tok(client.id)} more`,
    });
    expect(ids).toEqual([]);
  });

  it('removing a person and naming them again notifies them once per subject', async () => {
    const group = await newGroup();
    const actor = await newAdmin();
    const client = await newClient(group.id);
    const subjectId = randomUUID();
    const subject = { kind: 'task' as const, id: subjectId, title: 'Budget' };
    const save = (before: string, after: string) =>
      recordDescriptionMentions(db, { actor, groupId: group.id, subject, before, after });
    expect(await save('', tok(client.id))).toHaveLength(1);
    expect(await save(tok(client.id), 'removed')).toEqual([]);
    expect(await save('removed', `back ${tok(client.id)}`)).toEqual([]);
    expect(await recipients(subjectId)).toEqual([client.id]);
    // Another subject still notifies them.
    const other = randomUUID();
    await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'project', id: other, title: 'Grant' },
      before: '',
      after: tok(client.id),
    });
    expect(await recipients(other)).toEqual([client.id]);
  });

  it('names only admins in an admins-only subject', async () => {
    const group = await newGroup();
    const actor = await newAdmin();
    const manager = await newAdmin('Mona');
    await addManager(db, group.id, manager.id);
    const client = await newClient(group.id);
    const subjectId = randomUUID();
    await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'knowledge', id: subjectId, title: 'Notes', adminsOnly: true },
      before: '',
      after: `${tok(manager.id)} ${tok(client.id)}`,
    });
    expect(await recipients(subjectId)).toEqual([manager.id]);
  });

  it('carries what the push needs: the subject, its title and the actor', async () => {
    const group = await newGroup();
    const actor = await newAdmin('Ada');
    const client = await newClient(group.id);
    const ticketId = randomUUID();
    await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'ticket', id: ticketId, number: 12, subject: 'Login' },
      before: '',
      after: tok(client.id),
      readers: async (ids) => ids,
    });
    const [row] = await db
      .select()
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.kind, 'description.mention'),
          eq(notificationEvents.userId, client.id),
        ),
      );
    expect(row?.payload).toMatchObject({
      subjectKind: 'ticket',
      subjectId: ticketId,
      ticketId,
      number: 12,
      subject: 'Login',
      groupId: group.id,
      actorName: 'Ada',
    });
  });

  it('lets the subject drop people who cannot read it', async () => {
    const group = await newGroup();
    const actor = await newAdmin();
    const a = await newClient(group.id, 'Ana');
    const b = await newClient(group.id, 'Bea');
    const subjectId = randomUUID();
    await recordDescriptionMentions(db, {
      actor,
      groupId: group.id,
      subject: { kind: 'ticket', id: subjectId, number: 1, subject: 'X' },
      before: '',
      after: `${tok(a.id)} ${tok(b.id)}`,
      readers: async (ids) => ids.filter((id) => id === a.id),
    });
    expect(await recipients(subjectId)).toEqual([a.id]);
  });
});
