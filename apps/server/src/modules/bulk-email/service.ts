import { randomUUID } from 'node:crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import {
  BULK_LIMITS,
  BulkAudienceSchema,
  type BulkAudience,
  type BulkBlock,
  type BulkCampaignCounts,
  type BulkCampaignDraft,
  type BulkCampaignDto,
  type BulkCampaignListItem,
  type BulkCampaignPage,
  type BulkCampaignStatus,
  type BulkRecipientItem,
  type BulkRecipientPage,
  type BulkRecipientStatus,
  type SessionUser,
} from '@spolu/shared';
import type { Db } from '../../infra/db/client.js';
import {
  CampaignChangedError,
  CampaignNotFoundError,
  InvalidCursorError,
  NotDraftError,
} from './errors.js';
import { bulkCampaigns } from './schema.js';

export { CampaignChangedError, CampaignNotFoundError, InvalidCursorError, NotDraftError };

/**
 * Campaigns (spec §4): drafts are created, saved with an optimistic `version`, deleted and
 * duplicated here; `listRecipients` is the report's per-person list. Sending and cancelling
 * live in `send.ts`, the batch job in `batch.ts`.
 */

const iso = (expr: SQL) =>
  sql`to_char(${expr} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/** The name suffix of a duplicate, in the language of the admin who duplicates. */
const COPY_SUFFIX = { sk: ' (kópia)', en: ' (copy)' } as const;

type CampaignRow = {
  id: string;
  name: string;
  subject: string;
  preheader: string;
  blocks?: BulkBlock[];
  audience?: BulkAudience;
  status: BulkCampaignStatus;
  version: number;
  sender: string | null;
  recipient_count: number | null;
  created_by: string | null;
  updated_by: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
  send_started_at: string | null;
  finished_at: string | null;
  updated_text: string;
  created_by_name: string | null;
  sent_by_name: string | null;
} & BulkCampaignCounts;

/**
 * The one query of a campaign page or detail: the campaigns matching `where` (on `c`), newest
 * first, with author names and counts. The counts are grouped over this page's campaigns only
 * (the `(campaign_id, status)` index), so a page is one statement whatever its size.
 */
function campaignsQuery(where: SQL, limit: number, withContent: boolean): SQL {
  const content = withContent ? sql`c.blocks, c.audience,` : sql``;
  return sql`
    with page as (
      select c.id, c.name, c.subject, c.preheader, ${content} c.status, c.version, c.sender,
        c.recipient_count, c.created_by, c.updated_by, c.sent_by, c.created_at, c.updated_at,
        c.send_started_at, c.finished_at
      from bulk_campaigns c
      where ${where}
      order by c.updated_at desc, c.id desc
      limit ${limit}
    ),
    rc as (
      select r.campaign_id,
        count(*) filter (where r.status = 'queued')::int as queued,
        count(*) filter (where r.status = 'sending')::int as sending,
        count(*) filter (where r.status = 'sent')::int as sent,
        count(*) filter (where r.status = 'failed')::int as failed,
        count(*) filter (where r.status = 'skipped')::int as skipped,
        count(*) filter (where r.status = 'cancelled')::int as cancelled
      from bulk_recipients r
      where r.campaign_id in (select id from page)
      group by r.campaign_id
    ),
    uc as (
      select s.campaign_id, count(*)::int as unsubscribed
      from bulk_subscriptions s
      where s.subscribed = false and s.campaign_id in (select id from page)
      group by s.campaign_id
    )
    select p.id, p.name, p.subject, p.preheader, ${withContent ? sql`p.blocks, p.audience,` : sql``}
      p.status, p.version, p.sender, p.recipient_count, p.created_by, p.updated_by, p.sent_by,
      ${iso(sql`p.created_at`)} as created_at, ${iso(sql`p.updated_at`)} as updated_at,
      ${iso(sql`p.send_started_at`)} as send_started_at, ${iso(sql`p.finished_at`)} as finished_at,
      p.updated_at::text as updated_text,
      cu.name as created_by_name, su.name as sent_by_name,
      coalesce(rc.queued, 0) as queued, coalesce(rc.sending, 0) as sending,
      coalesce(rc.sent, 0) as sent, coalesce(rc.failed, 0) as failed,
      coalesce(rc.skipped, 0) as skipped, coalesce(rc.cancelled, 0) as cancelled,
      coalesce(uc.unsubscribed, 0) as unsubscribed
    from page p
    left join rc on rc.campaign_id = p.id
    left join uc on uc.campaign_id = p.id
    left join "user" cu on cu.id = p.created_by
    left join "user" su on su.id = p.sent_by
    order by p.updated_at desc, p.id desc`;
}

const countsOf = (row: CampaignRow): BulkCampaignCounts => ({
  queued: row.queued,
  sending: row.sending,
  sent: row.sent,
  failed: row.failed,
  skipped: row.skipped,
  cancelled: row.cancelled,
  unsubscribed: row.unsubscribed,
});

function toListItem(row: CampaignRow): BulkCampaignListItem {
  return {
    id: row.id,
    name: row.name,
    subject: row.subject,
    status: row.status,
    recipientCount: row.recipient_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sendStartedAt: row.send_started_at,
    finishedAt: row.finished_at,
    counts: countsOf(row),
    createdByName: row.created_by_name,
    sentByName: row.sent_by_name,
  };
}

function toDto(row: CampaignRow): BulkCampaignDto {
  return {
    ...toListItem(row),
    preheader: row.preheader,
    blocks: row.blocks ?? [],
    audience: row.audience ?? BulkAudienceSchema.parse({}),
    version: row.version,
    sender: row.sender,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    sentBy: row.sent_by,
  };
}

/** The campaign with its counts and author names; null for an unknown id. */
export async function getCampaign(db: Db, id: string): Promise<BulkCampaignDto | null> {
  const [row] = await db.execute<CampaignRow>(campaignsQuery(sql`c.id = ${id}`, 1, true));
  return row ? toDto(row) : null;
}

const CURSOR_TEXT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2}){0,2}$/;

/** The cursor carries Postgres's own text of `updated_at`, so no microseconds are lost. */
function encodeCursor(row: CampaignRow): string {
  return Buffer.from(`${row.updated_text}|${row.id}`).toString('base64url');
}

function cursorWhere(cursor: string): SQL {
  const text = Buffer.from(cursor, 'base64url').toString();
  const at = text.indexOf('|');
  const updatedText = text.slice(0, at);
  const id = text.slice(at + 1);
  if (at < 0 || !CURSOR_TEXT.test(updatedText) || id.length === 0 || id.length > 100) {
    throw new InvalidCursorError();
  }
  return sql`(c.updated_at, c.id) < (${updatedText}::timestamptz, ${id})`;
}

/**
 * Every campaign, last changed first, `BULK_LIMITS.pageSize` a page (keyset on
 * `(updated_at, id)`); one query a page. The list leaves out blocks and audience.
 */
export async function listCampaigns(db: Db, cursor?: string): Promise<BulkCampaignPage> {
  const size = BULK_LIMITS.pageSize;
  const where = cursor ? cursorWhere(cursor) : sql`true`;
  const rows = [...(await db.execute<CampaignRow>(campaignsQuery(where, size + 1, false)))];
  const page = rows.slice(0, size);
  return {
    items: page.map(toListItem),
    nextCursor: rows.length > size ? encodeCursor(page[page.length - 1]!) : null,
  };
}

/** A new draft: the name only, an empty audience and no blocks. */
export async function createCampaign(
  db: Db,
  actor: SessionUser,
  name: string,
): Promise<BulkCampaignDto> {
  const id = randomUUID();
  await db.insert(bulkCampaigns).values({
    id,
    name,
    audience: BulkAudienceSchema.parse({}),
    createdBy: actor.id,
    updatedBy: actor.id,
  });
  return (await getCampaign(db, id))!;
}

/** Why a guarded write touched no row: unknown, not a draft, or (else) a stale version. */
async function explainMiss(db: Db, id: string): Promise<never> {
  const [row] = await db
    .select({ status: bulkCampaigns.status })
    .from(bulkCampaigns)
    .where(eq(bulkCampaigns.id, id));
  if (!row) throw new CampaignNotFoundError();
  if (row.status !== 'draft') throw new NotDraftError();
  throw new CampaignChangedError();
}

/**
 * Saves a draft when it is still a draft at `draft.version`, and bumps the version. Throws
 * `NotDraftError` once sending started (whatever the version), `CampaignChangedError` when
 * another admin saved since, `CampaignNotFoundError` for an unknown id.
 */
export async function saveDraft(
  db: Db,
  actor: SessionUser,
  id: string,
  draft: BulkCampaignDraft,
): Promise<BulkCampaignDto> {
  const updated = await db
    .update(bulkCampaigns)
    .set({
      name: draft.name,
      subject: draft.subject,
      preheader: draft.preheader,
      blocks: draft.blocks,
      audience: draft.audience,
      version: sql`${bulkCampaigns.version} + 1`,
      updatedBy: actor.id,
      updatedAt: sql`now()`,
    })
    .where(
      and(
        eq(bulkCampaigns.id, id),
        eq(bulkCampaigns.status, 'draft'),
        eq(bulkCampaigns.version, draft.version),
      ),
    )
    .returning({ id: bulkCampaigns.id });
  if (updated.length === 0) await explainMiss(db, id);
  return (await getCampaign(db, id))!;
}

/** Deletes a draft; `NotDraftError` for any other state, `CampaignNotFoundError` if unknown. */
export async function deleteDraft(db: Db, id: string): Promise<void> {
  const deleted = await db
    .delete(bulkCampaigns)
    .where(and(eq(bulkCampaigns.id, id), eq(bulkCampaigns.status, 'draft')))
    .returning({ id: bulkCampaigns.id });
  if (deleted.length === 0) await explainMiss(db, id);
}

/**
 * A new draft with the content and audience of any campaign, version 1, named with the suffix
 * " (kópia)" / " (copy)" in the actor's language (the name is cut to stay within its limit).
 */
export async function duplicateCampaign(
  db: Db,
  actor: SessionUser,
  id: string,
): Promise<BulkCampaignDto> {
  const newId = randomUUID();
  const suffix = sql`(case (select u.language from "user" u where u.id = ${actor.id})
    when 'en' then ${COPY_SUFFIX.en}::text else ${COPY_SUFFIX.sk}::text end)`;
  const inserted = await db.execute<{ id: string }>(sql`
    insert into bulk_campaigns (id, name, subject, preheader, blocks, audience, created_by, updated_by)
    select ${newId}, left(c.name, ${BULK_LIMITS.name} - char_length(${suffix})) || ${suffix},
      c.subject, c.preheader, c.blocks, c.audience, ${actor.id}, ${actor.id}
    from bulk_campaigns c where c.id = ${id}
    returning id`);
  if (inserted.length === 0) throw new CampaignNotFoundError();
  return (await getCampaign(db, newId))!;
}

type RecipientRow = {
  user_id: string;
  name: string;
  email: string;
  status: BulkRecipientStatus;
  error: string | null;
  sent_at: string | null;
};

function recipientCursorWhere(cursor: string): SQL {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString());
  } catch {
    throw new InvalidCursorError();
  }
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    throw new InvalidCursorError();
  }
  return sql`(r.name, r.user_id) > (${parsed[0]}, ${parsed[1]})`;
}

/**
 * The report's per-person list of a campaign (spec §6): by name, `BULK_LIMITS.pageSize` a
 * page (keyset on `(name, user_id)`), optionally one status; one query a page over the
 * `(campaign_id, status)` index or the primary key. `CampaignNotFoundError` for an unknown id.
 */
export async function listRecipients(
  db: Db,
  id: string,
  opts: { status?: BulkRecipientStatus; cursor?: string } = {},
): Promise<BulkRecipientPage> {
  const size = BULK_LIMITS.pageSize;
  const where = [sql`r.campaign_id = ${id}`];
  if (opts.status) where.push(sql`r.status = ${opts.status}`);
  if (opts.cursor) where.push(recipientCursorWhere(opts.cursor));
  const rows = [
    ...(await db.execute<RecipientRow>(sql`
      select r.user_id, r.name, r.email, r.status, r.error, ${iso(sql`r.sent_at`)} as sent_at
      from bulk_recipients r
      where ${sql.join(where, sql` and `)}
      order by r.name, r.user_id
      limit ${size + 1}`)),
  ];
  if (rows.length === 0 && !opts.cursor) {
    const [found] = await db
      .select({ id: bulkCampaigns.id })
      .from(bulkCampaigns)
      .where(eq(bulkCampaigns.id, id));
    if (!found) throw new CampaignNotFoundError();
  }
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  const items: BulkRecipientItem[] = page.map((r) => ({
    userId: r.user_id,
    name: r.name,
    email: r.email,
    status: r.status,
    error: r.error,
    sentAt: r.sent_at,
  }));
  return {
    items,
    nextCursor:
      rows.length > size && last
        ? Buffer.from(JSON.stringify([last.name, last.user_id])).toString('base64url')
        : null,
  };
}
