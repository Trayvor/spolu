import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import type { EgrantChangeKind, ProjectSource, ProjectStatus } from '@spolu/shared';
import { foldSql } from '../../infra/db/fold.js';
import { files } from '../files/schema.js';
import { groups } from '../groups/schema.js';
import { user } from '../users/schema.js';

/**
 * A client's project (Phase 33, spec §3). `unique (id, group_id)` is the target of the composite
 * foreign keys of events, name keys, tasks and tickets: the database guarantees that a task's
 * project belongs to the task's own client.
 */
export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** `normalizeSearch(name)`; also a row of `project_name_keys`. */
    nameKey: text('name_key').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<ProjectStatus>().notNull().default('active'),
    source: text('source').$type<ProjectSource>().notNull().default('manual'),
    /** eGrant's project id, when eGrant created or linked the project (part P3). */
    egrantProjectId: text('egrant_project_id'),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    /** The project endpoint's last processed delivery (part P3): when it came, and its `sent_at`. */
    egrantDeliveredAt: timestamp('egrant_delivered_at', { withTimezone: true }),
    egrantSentAt: timestamp('egrant_sent_at', { withTimezone: true }),
    /**
     * A test project (ADR 0073): only eGrant's deliveries set it (`test`); Help has no way to
     * change it. The timeline leaves it out unless asked for (`test=1`) or chosen.
     */
    isTest: boolean('is_test').notNull().default(false),
  },
  (t) => [
    unique('projects_id_group_unique').on(t.id, t.groupId),
    check('projects_name_check', sql`char_length(${t.name}) between 1 and 200`),
    check('projects_description_check', sql`char_length(${t.description}) <= 10000`),
    check('projects_status_check', sql`${t.status} in ('active', 'archived')`),
    check('projects_source_check', sql`${t.source} in ('manual', 'egrant')`),
    check(
      'projects_egrant_id_check',
      sql`${t.egrantProjectId} is null or char_length(${t.egrantProjectId}) between 1 and 100`,
    ),
    // The pickers and the projects card (by name key), and the group's cascade.
    index('projects_group_status_name_idx').on(t.groupId, t.status, t.nameKey, t.id),
    index('projects_created_by_idx').on(t.createdBy),
    // The global search (2026-10-18): the folded name, trigram (`spolu_fold`, whose cost keeps
    // the planner on the index; a plain `like` on `name_key` read the whole table).
    index('projects_name_fold_trgm_idx').using('gin', sql`${foldSql(t.name)} gin_trgm_ops`),
  ],
);

/**
 * What identifies a project in its client (spec §5.6): its name keys (the current name and the
 * aliases of old names) and its eGrant id. The primary key gives one project per key and client:
 * `409 project_name_taken`, and concurrent eGrant deliveries cannot create two projects.
 */
export const projectNameKeys = pgTable(
  'project_name_keys',
  {
    projectId: text('project_id').notNull(),
    groupId: text('group_id').notNull(),
    kind: text('kind').$type<'name' | 'egrant_id'>().notNull(),
    key: text('key').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.kind, t.key] }),
    foreignKey({
      name: 'project_name_keys_project_fk',
      columns: [t.projectId, t.groupId],
      foreignColumns: [projects.id, projects.groupId],
    }).onDelete('cascade'),
    check('project_name_keys_kind_check', sql`${t.kind} in ('name', 'egrant_id')`),
    check('project_name_keys_key_check', sql`char_length(${t.key}) between 1 and 200`),
    index('project_name_keys_project_idx').on(t.projectId, t.groupId),
  ],
);

/** A dated event of a project (spec §3). `unique (id, project_id)`: the target of tasks' and tickets' event FK. */
export const projectEvents = pgTable(
  'project_events',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id').notNull(),
    groupId: text('group_id').notNull(),
    name: text('name').notNull(),
    nameKey: text('name_key').notNull(),
    description: text('description').notNull().default(''),
    occursOn: date('occurs_on', { mode: 'string' }).notNull(),
    source: text('source').$type<ProjectSource>().notNull().default('manual'),
    /** The identity eGrant last gave the event (decision 6b, part P3); null for a person's event. */
    egrantNameKey: text('egrant_name_key'),
    egrantDate: date('egrant_date', { mode: 'string' }),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, precision: 3 }).notNull().defaultNow(),
  },
  (t) => [
    unique('project_events_id_project_unique').on(t.id, t.projectId),
    foreignKey({
      name: 'project_events_project_fk',
      columns: [t.projectId, t.groupId],
      foreignColumns: [projects.id, projects.groupId],
    }).onDelete('cascade'),
    check('project_events_name_check', sql`char_length(${t.name}) between 1 and 200`),
    check('project_events_description_check', sql`char_length(${t.description}) <= 10000`),
    check('project_events_source_check', sql`${t.source} in ('manual', 'egrant')`),
    // One project's timeline and sheet; its first two columns also serve the project FK.
    index('project_events_project_occurs_idx').on(t.projectId, t.groupId, t.occursOn, t.id),
    // The all-projects timeline, keyset both ways (part P4).
    index('project_events_group_occurs_idx').on(t.groupId, t.occursOn, t.id),
    // eGrant event pairing (part P3).
    index('project_events_egrant_idx')
      .on(t.projectId, t.egrantNameKey, t.egrantDate)
      .where(sql`${t.source} = 'egrant'`),
    index('project_events_created_by_idx').on(t.createdBy),
    // The global search (2026-10-18): the folded name, trigram.
    index('project_events_name_fold_trgm_idx').using('gin', sql`${foldSql(t.name)} gin_trgm_ops`),
  ],
);

/** Files of a project or of one of its events: ordinary group files (`canReadFile`). */
export const projectAttachments = pgTable(
  'project_attachments',
  {
    fileId: text('file_id')
      .primaryKey()
      .references(() => files.id, { onDelete: 'cascade' }),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'cascade' }),
    eventId: text('event_id').references(() => projectEvents.id, { onDelete: 'cascade' }),
  },
  (t) => [
    check('project_attachments_owner_check', sql`num_nonnulls(${t.projectId}, ${t.eventId}) = 1`),
    index('project_attachments_project_idx')
      .on(t.projectId)
      .where(sql`${t.projectId} is not null`),
    index('project_attachments_event_idx')
      .on(t.eventId)
      .where(sql`${t.eventId} is not null`),
  ],
);

/**
 * Pending and dismissed changes from eGrant on a project (part P3, spec §5.4): one row per field.
 * `value_hash` keeps a dismissed value dismissed until eGrant sends a different one.
 */
export const egrantChanges = pgTable(
  'egrant_changes',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    eventId: text('event_id').references(() => projectEvents.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<EgrantChangeKind>().notNull(),
    /** `event_add`: `'<name key>|<yyyy-mm-dd>'`. */
    eventKey: text('event_key'),
    value: jsonb('value').notNull(),
    valueHash: text('value_hash').notNull(),
    state: text('state').$type<'pending' | 'dismissed'>().notNull().default('pending'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check(
      'egrant_changes_kind_check',
      sql`${t.kind} in ('project_name', 'project_description', 'event_name', 'event_date', 'event_description', 'event_add', 'event_remove')`,
    ),
    check('egrant_changes_state_check', sql`${t.state} in ('pending', 'dismissed')`),
    // Event field changes and removals name the event; an addition names its key instead.
    check(
      'egrant_changes_target_check',
      sql`case
        when ${t.kind} in ('project_name', 'project_description') then ${t.eventId} is null and ${t.eventKey} is null
        when ${t.kind} = 'event_add' then ${t.eventId} is null and ${t.eventKey} is not null
        else ${t.eventId} is not null
      end`,
    ),
    uniqueIndex('egrant_changes_field_unique').on(
      t.projectId,
      t.kind,
      sql`coalesce(${t.eventId}, ${t.eventKey}, '')`,
    ),
    index('egrant_changes_project_pending_idx')
      .on(t.projectId)
      .where(sql`${t.state} = 'pending'`),
    // The group's pending badges, and the group FK.
    index('egrant_changes_group_state_idx').on(t.groupId, t.state),
    index('egrant_changes_event_idx').on(t.eventId),
  ],
);

/**
 * Deliveries of the project endpoint for an eGrant instance no client has yet (part P3, spec
 * §5.1): the latest per project, processed when a client with that eGrant URL appears.
 */
export const egrantProjectInbox = pgTable(
  'egrant_project_inbox',
  {
    instanceHost: text('instance_host').notNull(),
    projectId: text('project_id').notNull(),
    payload: jsonb('payload').notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.instanceHost, t.projectId] }),
    // The daily cleanup of rows older than 180 days.
    index('egrant_project_inbox_received_idx').on(t.receivedAt),
  ],
);
