import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { eq, inArray, sql } from 'drizzle-orm';
import type { Role } from '@spolu/shared';
import { createDb } from '../../infra/db/client.js';
import { testDatabaseUrl } from '../../../test/test-config.js';
import { channels, messages } from '../chat/schema.js';
import { groupNotificationSettings } from '../notifications/schema.js';
import { buckets, taskAssignees, tasks } from '../tasks/schema.js';
import { user } from '../users/schema.js';
import { groupManagers, groups } from './schema.js';

const { db, close } = createDb(testDatabaseUrl);
afterAll(() => close());

const migrationsDir = new URL('../../infra/db/migrations/', import.meta.url);

/** The hand-written seed appended to the group_managers migration, between its markers. */
function seedSql(): string {
  const file = readdirSync(migrationsDir).find((f) => f.endsWith('_group_managers.sql'));
  if (!file) throw new Error('group_managers migration not found');
  const text = readFileSync(new URL(file, migrationsDir), 'utf8');
  const start = text.indexOf('-- seed group_managers: start');
  const end = text.indexOf('-- seed group_managers: end');
  if (start < 0 || end < start) throw new Error('seed markers not found');
  return text.slice(start, end);
}

class Rollback extends Error {}

describe('group_managers seed', () => {
  it('seeds open-task assignees and 60-day group and task chat authors who are active admins or superadmins, and no modes', async () => {
    const seed = seedSql();
    let checked = false;
    await db
      .transaction(async (tx) => {
        const groupId = randomUUID();
        await tx.insert(groups).values({
          id: groupId,
          name: 'Seed',
          egrantUrl: `https://g${groupId.replaceAll('-', '')}.egrant.sk`,
          inviteToken: randomUUID(),
        });
        const newUser = async (role: Role, disabled = false) => {
          const id = randomUUID();
          await tx.insert(user).values({
            id,
            name: 'U',
            email: `${id}@example.com`,
            role,
            disabledAt: disabled ? new Date() : null,
          });
          return id;
        };
        const openAssignee = await newUser('admin');
        const closedAssignee = await newUser('admin');
        const recentAuthor = await newUser('admin');
        const oldAuthor = await newUser('admin');
        const disabledAssignee = await newUser('admin', true);
        const deletedAuthor = await newUser('admin');
        const client = await newUser('client');
        const groupChatAuthor = await newUser('admin');
        const superAuthor = await newUser('superadmin');

        const bucketId = randomUUID();
        await tx.insert(buckets).values({ id: bucketId, groupId, kind: 'todo', position: 'a0' });
        const newTask = async (position: string, completed: boolean) => {
          const id = randomUUID();
          const now = new Date();
          await tx.insert(tasks).values({
            id,
            groupId,
            bucketId,
            position,
            title: 'T',
            createdBy: client,
            completedAt: completed ? now : null,
            createdAt: now,
            updatedAt: now,
          });
          return id;
        };
        const openTask = await newTask('a0', false);
        const closedTask = await newTask('a1', true);
        await tx.insert(taskAssignees).values([
          { taskId: openTask, userId: openAssignee },
          { taskId: closedTask, userId: closedAssignee },
          { taskId: openTask, userId: disabledAssignee },
        ]);

        const groupChannel = randomUUID();
        const taskChannel = randomUUID();
        await tx.insert(channels).values([
          { id: groupChannel, groupId, kind: 'group' },
          { id: taskChannel, groupId, kind: 'task', taskId: openTask },
        ]);
        const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
        const message = (
          channelId: string,
          authorId: string,
          createdAt: Date,
          deletedAt: Date | null = null,
        ) => ({
          id: randomUUID(),
          channelId,
          authorId,
          body: 'hi',
          clientId: randomUUID(),
          changeSeq: 1,
          createdAt,
          deletedAt,
        });
        await tx
          .insert(messages)
          .values([
            message(taskChannel, recentAuthor, daysAgo(10)),
            message(groupChannel, oldAuthor, daysAgo(61)),
            message(groupChannel, deletedAuthor, daysAgo(1), daysAgo(1)),
            message(groupChannel, client, new Date()),
            message(groupChannel, groupChatAuthor, daysAgo(5)),
            message(groupChannel, superAuthor, daysAgo(5)),
          ]);

        await tx.execute(sql.raw(seed));
        // Running it twice changes nothing.
        await tx.execute(sql.raw(seed));

        const managers = await tx
          .select({ userId: groupManagers.userId })
          .from(groupManagers)
          .where(eq(groupManagers.groupId, groupId));
        expect(managers.map((m) => m.userId).sort()).toEqual(
          [openAssignee, recentAuthor, groupChatAuthor, superAuthor].sort(),
        );
        const modes = await tx
          .select()
          .from(groupNotificationSettings)
          .where(
            inArray(groupNotificationSettings.userId, [
              openAssignee,
              closedAssignee,
              recentAuthor,
              oldAuthor,
              disabledAssignee,
              deletedAuthor,
              client,
              groupChatAuthor,
              superAuthor,
            ]),
          );
        expect(modes).toEqual([]);
        checked = true;
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
    expect(checked).toBe(true);
  });
});
