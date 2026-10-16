import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import type { ReminderSubjectKind, SessionUser } from '@spolu/shared';
import type { Server as SocketIOServer } from 'socket.io';
import type { Db } from '../../infra/db/client.js';
import { reminderSets } from './schema.js';

/** What the reminders module needs to know about one subject (a knowledge item, a task). */
export type SubjectInfo = {
  groupId: string;
  title: string;
  /** Plain text, for the calendar export. */
  body: string;
  adminsOnly: boolean;
  /** False when the subject should not remind now (Phase 19: the task is in Completed). */
  active: boolean;
  /** The subject's creator (a knowledge item's author, a task's creator). */
  authorId: string;
  /** `YYYY-MM-DD`: subjects with a deadline (tasks) export it as an all-day event. */
  dueDate?: string | null;
  /** App-relative URL of the subject, e.g. `/groups/g/knowledge?k=id`. */
  link: string;
  canRead(actor: SessionUser, actorGroupId: string | null): boolean;
  canEdit(actor: SessionUser): boolean;
};

/** The adapter an owner module registers for its kind. */
export type ReminderSubject = {
  kind: ReminderSubjectKind;
  /** The path segment of the subject's endpoints: `/api/<routePrefix>/:id/reminders`. */
  routePrefix: string;
  /** Bulk load (one query) for the fire job and the endpoints; missing ids are left out. */
  loadMany(db: Db, ids: string[]): Promise<Map<string, SubjectInfo>>;
  /**
   * The times are edited on their own through `PUT /api/<routePrefix>/:id/reminders` (tasks), not
   * as part of the subject's own form (knowledge items).
   */
  standaloneEdit?: boolean;
  /** An editor who adds a time and is not yet a recipient becomes one (`added`, by themselves). */
  addEditorsAsRecipients?: boolean;
  /**
   * Runs after a write or a firing that changed the upcoming times of these subjects committed
   * (the board's reminder bell). Errors are logged and swallowed by the caller.
   */
  onTimesChanged?: (deps: { db: Db; io: SocketIOServer }, ids: string[]) => Promise<void>;
};

export type ReminderSubjectRef = { kind: ReminderSubjectKind; id: string };

const registry = new Map<ReminderSubjectKind, ReminderSubject>();

/** Idempotent per kind: registering a kind again replaces its adapter. */
export function registerReminderSubject(subject: ReminderSubject): void {
  registry.set(subject.kind, subject);
}

export function getReminderSubject(kind: ReminderSubjectKind): ReminderSubject {
  const subject = registry.get(kind);
  if (!subject) throw new Error(`No reminder subject registered for ${kind}`);
  return subject;
}

/** The registered adapters (the fire job and the routes iterate them). */
export function listReminderSubjects(): ReminderSubject[] {
  return [...registry.values()];
}

/**
 * The foreign key column of `reminder_sets` that points at a subject of this kind, and its
 * property name for inserts.
 */
const SUBJECT_COLUMNS = {
  knowledge: { column: reminderSets.knowledgeItemId, key: 'knowledgeItemId' },
  task: { column: reminderSets.taskId, key: 'taskId' },
} as const satisfies Record<ReminderSubjectKind, { column: AnyPgColumn; key: string }>;

export function subjectColumn(kind: ReminderSubjectKind): AnyPgColumn {
  return SUBJECT_COLUMNS[kind].column;
}

export function subjectColumnKey(kind: ReminderSubjectKind) {
  return SUBJECT_COLUMNS[kind].key;
}
