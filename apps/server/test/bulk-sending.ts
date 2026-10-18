import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { BulkAudienceSchema, type BulkBlock, type SessionUser } from '@spolu/shared';
import type { Db } from '../src/infra/db/client.js';
import type { JobOptions, JobQueue } from '../src/infra/jobs/jobs.js';
import { bulkCampaigns } from '../src/modules/bulk-email/schema.js';
import { user } from '../src/modules/users/schema.js';
import { addAdmin } from '../src/modules/users/service.js';

/** Test helpers of the bulk sending tests (Phase 23.5). */

/** A job queue that only records what was sent. */
export function createRecordingJobs(): JobQueue & {
  sent: { name: string; data: object; options?: JobOptions }[];
} {
  const sent: { name: string; data: object; options?: JobOptions }[] = [];
  return {
    sent,
    async send(name, data, options) {
      sent.push({ name, data, ...(options ? { options } : {}) });
    },
  };
}

export async function newBulkAdmin(db: Db, name = 'Sender'): Promise<SessionUser> {
  const email = `${randomUUID()}@example.com`;
  const admin = await addAdmin(db, { email, name });
  return { id: admin.id, email, name, role: 'admin', finance: false };
}

export async function newBulkPerson(
  db: Db,
  opts: { name?: string; language?: 'sk' | 'en' } = {},
): Promise<{ id: string; email: string; name: string }> {
  const id = randomUUID();
  const email = `${randomUUID()}@example.com`;
  const name = opts.name ?? 'Person';
  await db.insert(user).values({
    id,
    email,
    name,
    role: 'client',
    emailVerified: true,
    language: opts.language ?? 'sk',
  });
  return { id, email, name };
}

const readyBlocks: BulkBlock[] = [
  { id: 'b1', type: 'heading', text: 'Hello {{name}}', align: 'left' },
  { id: 'b2', type: 'button', label: 'Open', url: 'https://egrant.sk', align: 'center' },
];

/** A draft ready to send to exactly `userIds` (hand-picked). */
export async function newReadyCampaign(
  db: Db,
  actor: SessionUser,
  userIds: string[],
  over: { subject?: string; blocks?: BulkBlock[] } = {},
): Promise<string> {
  const id = randomUUID();
  await db.insert(bulkCampaigns).values({
    id,
    name: 'Campaign',
    subject: over.subject ?? 'News',
    preheader: 'What is new',
    blocks: over.blocks ?? readyBlocks,
    audience: BulkAudienceSchema.parse({ includeUserIds: userIds }),
    createdBy: actor.id,
    updatedBy: actor.id,
  });
  return id;
}

export const campaignRow = async (db: Db, id: string) =>
  (await db.select().from(bulkCampaigns).where(eq(bulkCampaigns.id, id)))[0]!;
