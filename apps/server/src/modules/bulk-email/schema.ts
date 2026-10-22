import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import type {
  BulkAudience,
  BulkBlock,
  BulkCampaignStatus,
  BulkEventKind,
  BulkImageMime,
  BulkRecipientStatus,
  BulkSubscriptionSource,
  UserLanguage,
} from '@spolu/shared';
import { user } from '../users/schema.js';
import { languageIn } from '../../infra/db/language-check.js';

/**
 * A bulk email (Phase 23): draft → sending → sent, or sending → cancelled. `blocks` and
 * `audience` are validated by the shared zod schemas on every write; `version` is the
 * optimistic lock of two admins editing one draft. `sender` and `recipient_count` are set when
 * sending starts, `finished_at` when it became `sent` or `cancelled`.
 */
export const bulkCampaigns = pgTable(
  'bulk_campaigns',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    subject: text('subject').notNull().default(''),
    preheader: text('preheader').notNull().default(''),
    /** The desktop version, in `content_version`'s format (read through `upgradeBlocks`). */
    blocks: jsonb('blocks').$type<BulkBlock[]>().notNull().default([]),
    /** The phone version (Phase 31); null while it follows the desktop version. */
    phoneBlocks: jsonb('phone_blocks').$type<BulkBlock[]>(),
    /** 1 = Phase 23 blocks, 2 = builder v2 (`BULK_CONTENT_VERSION`); every save writes 2. */
    contentVersion: smallint('content_version').notNull().default(1),
    /** When the one-time "check the phone version" warning was shown before a send. */
    phoneCheckShownAt: timestamp('phone_check_shown_at', { withTimezone: true }),
    audience: jsonb('audience').$type<BulkAudience>().notNull(),
    status: text('status').$type<BulkCampaignStatus>().notNull().default('draft'),
    version: integer('version').notNull().default(1),
    sender: text('sender'),
    recipientCount: integer('recipient_count'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
    sentBy: text('sent_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    sendStartedAt: timestamp('send_started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'bulk_campaigns_status_check',
      sql`${t.status} in ('draft', 'sending', 'sent', 'cancelled')`,
    ),
    check('bulk_campaigns_content_version_check', sql`${t.contentVersion} in (1, 2)`),
    index('bulk_campaigns_status_updated_idx').on(t.status, t.updatedAt.desc()),
  ],
);

/**
 * The frozen recipient list of a campaign, inserted when sending starts. Email, name and
 * language are copied then, so the sent email is reproducible. The provider ids come from
 * Elastic's answer, for matching later webhook events.
 */
export const bulkRecipients = pgTable(
  'bulk_recipients',
  {
    campaignId: text('campaign_id')
      .notNull()
      .references(() => bulkCampaigns.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    name: text('name').notNull(),
    language: text('language').$type<UserLanguage>().notNull(),
    status: text('status').$type<BulkRecipientStatus>().notNull().default('queued'),
    /** Short reason of `failed` and `skipped`: `unsubscribed`, `disabled`, provider text ≤ 500. */
    error: text('error'),
    attempts: smallint('attempts').notNull().default(0),
    providerTransactionId: text('provider_transaction_id'),
    providerMessageId: text('provider_message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // The first time Elastic's webhook reported each event for this person (ADR 0070): the
    // report counts and flags read these, never `bulk_events`.
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }),
    clickedAt: timestamp('clicked_at', { withTimezone: true }),
    bouncedAt: timestamp('bounced_at', { withTimezone: true }),
    complainedAt: timestamp('complained_at', { withTimezone: true }),
  },
  (t) => [
    primaryKey({ columns: [t.campaignId, t.userId] }),
    check(
      'bulk_recipients_status_check',
      sql`${t.status} in ('queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled')`,
    ),
    check('bulk_recipients_language_check', languageIn(t.language)),
    index('bulk_recipients_campaign_status_idx').on(t.campaignId, t.status),
    // The recipient report pages by name (2026-10-18).
    index('bulk_recipients_campaign_name_idx').on(t.campaignId, t.name, t.userId),
    index('bulk_recipients_user_idx').on(t.userId),
  ],
);

/**
 * Every event Elastic's webhook reported for a recipient (ADR 0070), once: `provider_event_key`
 * is a hash of Elastic's `messageid`, `status` and `date`, so a retried or repeated event is
 * dropped. Only what the report and suppression need is kept: no address, IP, user agent or
 * clicked URL. `category` is Elastic's bounce category of an `Error` event.
 */
export const bulkEvents = pgTable(
  'bulk_events',
  {
    providerEventKey: text('provider_event_key').primaryKey(),
    campaignId: text('campaign_id').notNull(),
    userId: text('user_id').notNull(),
    kind: text('kind').$type<BulkEventKind>().notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    category: text('category'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'bulk_events_recipient_fk',
      columns: [t.campaignId, t.userId],
      foreignColumns: [bulkRecipients.campaignId, bulkRecipients.userId],
    }).onDelete('cascade'),
    check(
      'bulk_events_kind_check',
      sql`${t.kind} in ('delivered', 'opened', 'clicked', 'bounced', 'complaint', 'unsubscribed')`,
    ),
    // The cascade from a deleted recipient (person or campaign).
    index('bulk_events_recipient_idx').on(t.campaignId, t.userId),
  ],
);

/**
 * A person's bulk email setting; no row = subscribed (P4). Spolu is the source of truth (P3):
 * `provider` rows are copied from Elastic by the daily sync, which never overrides a newer
 * change made in Spolu (`changed_at`). Only bulk email reads this table (P5).
 */
export const bulkSubscriptions = pgTable(
  'bulk_subscriptions',
  {
    userId: text('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),
    subscribed: boolean('subscribed').notNull(),
    /** The address at the time of the change. */
    email: text('email').notNull(),
    /** The campaign whose link was used, when the change came from a link. */
    campaignId: text('campaign_id').references(() => bulkCampaigns.id, { onDelete: 'set null' }),
    source: text('source').$type<BulkSubscriptionSource>().notNull(),
    changedAt: timestamp('changed_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    check(
      'bulk_subscriptions_source_check',
      sql`${t.source} in ('link', 'one_click', 'profile', 'provider')`,
    ),
    // The `set null` from a deleted campaign, and the report's unsubscribed count per campaign.
    index('bulk_subscriptions_campaign_idx')
      .on(t.campaignId)
      .where(sql`${t.campaignId} is not null`),
  ],
);

/**
 * Images uploaded in the builder, served publicly by id (mail apps have no session). The id is
 * a random UUID, the only secret; the type is sniffed from the bytes.
 */
export const bulkImages = pgTable(
  'bulk_images',
  {
    id: text('id').primaryKey(),
    /** `bulk/<id>` in the existing `Storage`. */
    storageKey: text('storage_key').notNull(),
    mime: text('mime').$type<BulkImageMime>().notNull(),
    size: integer('size').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    uploadedBy: text('uploaded_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check('bulk_images_mime_check', sql`${t.mime} in ('image/png', 'image/jpeg')`)],
);
