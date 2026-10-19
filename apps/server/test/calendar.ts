import { randomUUID } from 'node:crypto';
import type { SessionUser, UserLanguage, Visibility } from '@spolu/shared';
import type { Db } from '../src/infra/db/client.js';
import { addManager } from '../src/modules/groups/managers.js';
import { addMember, createGroup } from '../src/modules/groups/service.js';
import { knowledgeItems, knowledgeMeetings } from '../src/modules/knowledge/schema.js';
import { projectEvents, projects } from '../src/modules/projects/schema.js';
import { teamsMeetingLinks } from '../src/modules/teams/schema.js';
import { user } from '../src/modules/users/schema.js';
import { addAdmin } from '../src/modules/users/service.js';

/** Seeding for the calendar feed tests (ADR 0051): rows straight into the tables. */

export type FeedPerson = SessionUser & { language: UserLanguage; email: string };

const newEmail = () => `${randomUUID()}@example.com`;

export async function feedGroup(db: Db, name = 'Obec Lúky') {
  return createGroup(db, {
    name,
    egrantUrl: `https://g${randomUUID().replaceAll('-', '')}.egrant.sk`,
  });
}

export async function feedAdmin(db: Db, name = 'Admin Feed', manages: string[] = []) {
  const email = newEmail();
  const row = await addAdmin(db, { email, name });
  for (const groupId of manages) await addManager(db, groupId, row.id);
  const person: FeedPerson = {
    id: row.id,
    email,
    name,
    role: 'admin',
    finance: false,
    language: 'sk',
  };
  return person;
}

export async function feedClient(db: Db, groupIds: string[], name = 'Mária Nováková') {
  const email = newEmail();
  const id = randomUUID();
  await db.insert(user).values({ id, email, name, role: 'client', emailVerified: true });
  for (const groupId of groupIds) await addMember(db, groupId, id);
  const person: FeedPerson = { id, email, name, role: 'client', finance: false, language: 'sk' };
  return person;
}

export async function feedProject(
  db: Db,
  groupId: string,
  opts: { name?: string; status?: 'active' | 'archived' } = {},
): Promise<string> {
  const id = randomUUID();
  const name = opts.name ?? 'Projekt Lúky 2026';
  await db.insert(projects).values({
    id,
    groupId,
    name,
    nameKey: `${name.toLowerCase()} ${id}`,
    status: opts.status ?? 'active',
  });
  return id;
}

export async function feedEvent(
  db: Db,
  opts: {
    projectId: string;
    groupId: string;
    occursOn: string;
    name?: string;
    description?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const name = opts.name ?? 'Odovzdanie žiadosti';
  await db.insert(projectEvents).values({
    id,
    projectId: opts.projectId,
    groupId: opts.groupId,
    name,
    nameKey: name.toLowerCase(),
    description: opts.description ?? '',
    occursOn: opts.occursOn,
  });
  return id;
}

export async function feedCall(
  db: Db,
  opts: {
    groupId: string;
    createdBy: string;
    startsAt: Date;
    title?: string;
    body?: string;
    visibility?: Visibility;
    meetingUrl?: string | null;
    transcript?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const title = opts.title ?? 'Porada';
  await db.insert(knowledgeItems).values({
    id,
    groupId: opts.groupId,
    type: 'meeting',
    visibility: opts.visibility ?? 'public',
    title,
    body: opts.body ?? '',
    createdBy: opts.createdBy,
    searchText: title.toLowerCase(),
  });
  await db.insert(knowledgeMeetings).values({
    itemId: id,
    startsAt: opts.startsAt,
    meetingUrl: opts.meetingUrl ?? null,
    transcript: opts.transcript ?? '',
  });
  return id;
}

export async function feedTeamsLink(db: Db, itemId: string, startsAt: Date, minutes: number) {
  await db.insert(teamsMeetingLinks).values({
    itemId,
    origin: 'linked',
    organizerEntraId: 'entra-1',
    joinUrl: 'https://teams.microsoft.com/l/meetup-join/x',
    startsAt,
    durationMinutes: minutes,
  });
}

/** `YYYY-MM-DD` `n` days from today (UTC, near enough for dates well inside the window). */
export const dayFromNow = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** A whole minute `days` ahead. */
export const inDays = (days: number) =>
  new Date(Math.floor((Date.now() + days * 86_400_000) / 60_000) * 60_000);

/** RFC 5545 3.1: remove every CRLF followed by one space; the content lines. */
export const icsLines = (text: string) => text.replace(/\r\n /g, '').split('\r\n');

/** The UIDs of the feed's events. */
export const uidsOf = (text: string) =>
  icsLines(text)
    .filter((l) => l.startsWith('UID:'))
    .map((l) => l.slice(4));
