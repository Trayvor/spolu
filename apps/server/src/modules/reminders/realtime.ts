import type { Server as SocketIOServer } from 'socket.io';
import type { Db } from '../../infra/db/client.js';
import { listReminderSubjects, type ReminderSubjectRef } from './subjects.js';

/**
 * The Socket.IO server the reminders module pushes through. The fire job is built before the app
 * (`deps.ts`), so `buildApp` attaches the app's server here once it exists, and detaches it on
 * close.
 */
let attached: SocketIOServer | null = null;

export function attachRemindersRealtime(io: SocketIOServer | null): void {
  attached = io;
}

/**
 * After a write or a firing that changed the upcoming times of these subjects committed: groups
 * them by kind and calls each adapter's `onTimesChanged` (tasks: the board's reminder bell). Does
 * nothing without an attached server; logs and swallows errors, since the write already succeeded.
 */
export async function notifyTimesChanged(db: Db, refs: ReminderSubjectRef[]): Promise<void> {
  const io = attached;
  if (!io || refs.length === 0) return;
  for (const subject of listReminderSubjects()) {
    if (!subject.onTimesChanged) continue;
    const ids = [...new Set(refs.filter((r) => r.kind === subject.kind).map((r) => r.id))];
    if (ids.length === 0) continue;
    try {
      await subject.onTimesChanged({ db, io }, ids);
    } catch (error) {
      console.error(`reminders: notifying ${subject.kind} changes failed`, error);
    }
  }
}
