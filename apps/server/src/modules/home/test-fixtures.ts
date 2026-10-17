import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { BucketKind, SessionUser } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { ensureGroupChannel } from '../chat/service.js';
import { messageMentions, messages } from '../chat/schema.js';
import { addManager } from '../groups/managers.js';
import { addMember, createGroup } from '../groups/service.js';
import { buckets, taskAssignees, tasks } from '../tasks/schema.js';
import { createBucket, ensureBoard } from '../tasks/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';

/** Test-only builders for the home module: rows written directly, for exact control. */

export async function newGroup(db: Db, name = 'Firma') {
  const group = await createGroup(db, {
    name,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk/app`,
  });
  await ensureBoard(db, group.id);
  const channel = await ensureGroupChannel(db, group.id);
  return { ...group, channelId: channel.id };
}

export async function newAdmin(db: Db, name = 'Ada', manages: string[] = []): Promise<SessionUser> {
  const row = await addAdmin(db, { email: `${randomUUID()}@example.com`, name });
  for (const groupId of manages) await addManager(db, groupId, row.id);
  return { id: row.id, email: row.email, name, role: 'admin' } as SessionUser;
}

export async function newClient(db: Db, groupId: string, name = 'Cyril'): Promise<SessionUser> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  await addMember(db, groupId, id);
  return { id, email, name, role: 'client' } as SessionUser;
}

export async function bucketOf(db: Db, groupId: string, kind: BucketKind, name = 'Step') {
  if (kind === 'custom') return (await createBucket(db, groupId, name)).id;
  const [row] = await db
    .select({ id: buckets.id })
    .from(buckets)
    .where(and(eq(buckets.groupId, groupId), eq(buckets.kind, kind)));
  return row!.id;
}

let position = 0;

/** Inserts a task directly (no permission or assignee checks). */
export async function newTask(
  db: Db,
  input: {
    groupId: string;
    createdBy: string;
    title?: string;
    bucketId?: string;
    assigneeIds?: string[];
    urgent?: boolean;
    dueDate?: string | null;
    createdAt?: Date;
    completedAt?: Date | null;
  },
) {
  const id = randomUUID();
  const bucketId = input.bucketId ?? (await bucketOf(db, input.groupId, 'todo'));
  const createdAt = input.createdAt ?? new Date();
  await db.insert(tasks).values({
    id,
    groupId: input.groupId,
    bucketId,
    position: `z${String(++position).padStart(8, '0')}${randomUUID().slice(0, 8)}`,
    title: input.title ?? 'Task',
    createdBy: input.createdBy,
    urgent: input.urgent ?? false,
    dueDate: input.dueDate ?? null,
    completedAt: input.completedAt ?? null,
    createdAt,
    updatedAt: createdAt,
  });
  const assigneeIds = input.assigneeIds ?? [];
  if (assigneeIds.length > 0) {
    await db.insert(taskAssignees).values(assigneeIds.map((userId) => ({ taskId: id, userId })));
  }
  return id;
}

/** Inserts a message directly; `mentions` are user ids written to `message_mentions`. */
export async function newMessage(
  db: Db,
  input: {
    channelId: string;
    authorId: string;
    body?: string;
    parentId?: string | null;
    mentions?: string[];
    mentionsAll?: boolean;
    createdAt?: Date;
    deletedAt?: Date | null;
  },
) {
  const id = randomUUID();
  const createdAt = input.createdAt ?? new Date();
  await db.insert(messages).values({
    id,
    channelId: input.channelId,
    authorId: input.authorId,
    parentId: input.parentId ?? null,
    body: input.body ?? 'hello',
    mentionsAll: input.mentionsAll ?? false,
    clientId: randomUUID(),
    changeSeq: 0,
    createdAt,
    deletedAt: input.deletedAt ?? null,
  });
  const mentions = input.mentions ?? [];
  if (mentions.length > 0) {
    await db
      .insert(messageMentions)
      .values(mentions.map((userId) => ({ messageId: id, userId, createdAt })));
  }
  return id;
}
