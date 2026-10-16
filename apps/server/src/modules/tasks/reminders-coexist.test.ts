import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, inArray } from 'drizzle-orm';
import type { AppDeps } from '../../deps.js';
import type { FakePushSender } from '../../infra/push/index.js';
import { buildTestApp } from '../../../test/test-app.js';
import { insertTask } from '../../../test/tasks.js';
import { addMember, createGroup } from '../groups/service.js';
import { deliverPending } from '../notifications/deliver.js';
import { saveSubscription } from '../notifications/push-subscriptions.js';
import { notificationEvents } from '../notifications/schema.js';
import { fireDueReminders } from '../reminders/jobs.js';
import { reminderSets, reminderTimes } from '../reminders/schema.js';
import { replaceReminderSet } from '../reminders/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { bratislavaDay, recordDeadlineReminders } from './reminders.js';

let deps: AppDeps;
let push: FakePushSender;
let close: () => Promise<void>;
beforeAll(async () => {
  ({ deps, push, close } = await buildTestApp({
    config: { push: { provider: 'fake' } } as never,
  }));
});
afterAll(() => close());

/** `day` (`YYYY-MM-DD`) plus one calendar day. */
const nextDay = (day: string) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + 24 * 60 * 60_000).toISOString().slice(0, 10);

describe('automatic and custom task reminders together', () => {
  it('a deadline reminder and a custom reminder at 09:00 both deliver with tag task:<id>', async () => {
    const group = await createGroup(deps.db, {
      name: `Firma ${randomUUID().slice(0, 8)}`,
      egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
    });
    const adminEmail = `${randomUUID()}@example.com`;
    const adminRow = await addAdmin(deps.db, { email: adminEmail, name: 'Ada' });
    const admin = { id: adminRow.id, email: adminEmail, name: 'Ada', role: 'admin' as const };
    const clientId = randomUUID();
    await deps.db.insert(user).values({
      id: clientId,
      email: `${randomUUID()}@example.com`,
      name: 'Cleo',
      role: 'client',
      emailVerified: true,
      language: 'en',
    });
    await addMember(deps.db, group.id, clientId);
    await saveSubscription(deps.db, clientId, {
      endpoint: `https://push.example.test/${randomUUID()}`,
      p256dh: 'pk',
      auth: 'au',
      userAgent: null,
    });

    // One instant for both runs (the 09:00 cron and a custom time at that moment), and a task
    // due tomorrow (Bratislava) assigned to the client.
    const now = new Date();
    const today = bratislavaDay(now);
    const taskId = await insertTask(deps.db, {
      groupId: group.id,
      createdBy: admin.id,
      dueDate: nextDay(today),
      assignees: [clientId],
    });
    await deps.db.transaction((tx) =>
      replaceReminderSet(
        tx,
        { kind: 'task', id: taskId, groupId: group.id, adminsOnly: false, authorId: admin.id },
        {
          times: [{ at: new Date(now.getTime() + 60 * 60_000).toISOString() }],
          recipientIds: [clientId],
        },
        admin,
        now,
      ),
    );
    const [set] = await deps.db.select().from(reminderSets).where(eq(reminderSets.taskId, taskId));
    await deps.db.update(reminderTimes).set({ at: now }).where(eq(reminderTimes.setId, set!.id));

    await recordDeadlineReminders(deps, now);
    await fireDueReminders(deps, { now, setIds: [set!.id] });

    const events = await deps.db
      .select({ kind: notificationEvents.kind })
      .from(notificationEvents)
      .where(
        and(
          eq(notificationEvents.userId, clientId),
          inArray(notificationEvents.kind, ['task.deadline', 'reminder.due']),
        ),
      );
    expect(events.map((e) => e.kind).sort()).toEqual(['reminder.due', 'task.deadline']);

    await deliverPending(deps, { userIds: [clientId] });
    const sent = push.sent.filter((p) => p.payload.url === `/groups/${group.id}/tasks/${taskId}`);
    expect(sent).toHaveLength(2);
    expect(sent.every((p) => p.payload.tag === `task:${taskId}`)).toBe(true);
  });
});
