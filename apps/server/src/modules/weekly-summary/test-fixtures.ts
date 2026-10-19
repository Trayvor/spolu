import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { UserLanguage, WeeklySummaryContent } from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import { addManager } from '../groups/managers.js';
import { addMembership } from '../groups/memberships.js';
import { createGroup, type GroupRow } from '../groups/service.js';
import { user } from '../users/schema.js';
import { addAdmin } from '../users/service.js';
import { weeklySummaries } from './schema.js';
import { searchText } from './search-text.js';

/** Test-only helpers of the weekly summary tests. */

export const newEmail = (): string => `${randomUUID()}@example.com`;
const host = () => `w${randomUUID().replaceAll('-', '').slice(0, 20)}`;

export async function makeGroup(db: Db, name = 'Firma'): Promise<GroupRow> {
  return createGroup(db, { name, egrantUrl: `https://${host()}.egrant.sk` });
}

export async function makeAdmin(
  db: Db,
  name = 'Jana Manažérka',
): Promise<{ id: string; email: string; name: string }> {
  const email = newEmail();
  const a = await addAdmin(db, { email, name });
  return { id: a.id, email, name };
}

export async function makeManager(
  db: Db,
  groupId: string,
  name?: string,
): Promise<{ id: string; email: string; name: string }> {
  const a = await makeAdmin(db, name);
  await addManager(db, groupId, a.id);
  return a;
}

/** A person with a membership; by default a verified, named, active client. */
export async function makeClient(
  db: Db,
  groupId: string,
  opts: {
    name?: string;
    language?: UserLanguage;
    verified?: boolean;
    role?: 'client' | 'ziadatel';
    disabled?: boolean;
  } = {},
): Promise<{ id: string; email: string; name: string }> {
  const id = randomUUID();
  const email = newEmail();
  const name = opts.name ?? 'Jana Nováková';
  await db.insert(user).values({
    id,
    email,
    name,
    role: 'client',
    emailVerified: opts.verified ?? true,
    language: opts.language ?? 'sk',
    disabledAt: opts.disabled ? new Date() : null,
  });
  await addMembership(db, id, groupId, opts.role ?? 'client');
  return { id, email, name };
}

export async function setUserName(db: Db, id: string, name: string): Promise<void> {
  await db.update(user).set({ name }).where(eq(user.id, id));
}

/** A ready-made content with one item per section. */
export function sampleContent(text = 'Podali sme žiadosť o platbu'): WeeklySummaryContent {
  return {
    intro: 'Dobrý deň',
    done: [{ id: randomUUID(), ref: null, text }],
    waiting: [],
    upcoming: [],
    closing: 'S pozdravom',
  };
}

/** Inserts a summary row straight into the table. */
export async function insertSummary(
  db: Db,
  values: {
    groupId: string;
    week: string;
    windowStart?: Date;
    windowEnd?: Date;
    status?: 'preparing' | 'draft' | 'sending' | 'sent' | 'skipped';
    content?: WeeklySummaryContent;
    searchText?: string;
    language?: UserLanguage;
    version?: number;
    sentAt?: Date | null;
    sentBy?: string | null;
    skipReason?: 'no_activity' | 'manager' | null;
    createdAt?: Date;
    updatedAt?: Date;
    source?: 'ai' | 'facts' | null;
  },
): Promise<string> {
  const id = randomUUID();
  const end = values.windowEnd ?? new Date();
  await db.insert(weeklySummaries).values({
    id,
    groupId: values.groupId,
    week: values.week,
    windowStart: values.windowStart ?? new Date(end.getTime() - 7 * 86_400_000),
    windowEnd: end,
    status: values.status ?? 'draft',
    source:
      values.source !== undefined ? values.source : values.status === 'preparing' ? null : 'facts',
    content: values.content ?? sampleContent(),
    searchText: values.searchText ?? searchText(values.content ?? sampleContent()),
    language: values.language ?? 'sk',
    version: values.version ?? 1,
    sentAt: values.sentAt ?? null,
    sentBy: values.sentBy ?? null,
    skipReason: values.skipReason ?? null,
    ...(values.createdAt ? { createdAt: values.createdAt } : {}),
    ...(values.updatedAt ? { updatedAt: values.updatedAt } : {}),
  });
  return id;
}

/** A socket spy: what was emitted to which room. */
export function socketSpy(): {
  io: import('socket.io').Server;
  emitted: { room: string; event: string; payload: unknown }[];
} {
  const emitted: { room: string; event: string; payload: unknown }[] = [];
  const io = {
    to: (room: string) => ({
      emit: (event: string, payload: unknown) => void emitted.push({ room, event, payload }),
    }),
  } as unknown as import('socket.io').Server;
  return { io, emitted };
}
