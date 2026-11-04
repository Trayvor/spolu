ALTER TABLE "ticket_watch_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ticket_watch_settings" CASCADE;--> statement-breakpoint
DROP INDEX "tickets_unassigned_open_created_idx";--> statement-breakpoint
CREATE INDEX "tickets_open_created_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST) WHERE "tickets"."status" in ('new', 'in_progress');
--> statement-breakpoint
-- Release backfill (ticket lifecycle rework, 2026-11-04): every open ticket of a client without a
-- riešiteľ gets the client's active admin managers as riešitelia, the earliest managers first up to
-- the limit of 10 (MAX_TICKET_ASSIGNEES). No notification events, but each added riešiteľ gets the
-- audit row `ticket.assignee_added` that `addAssignee` writes, by the system actor
-- `tickets.manager-autoassign`, so the history of released tickets shows them. Idempotent: a
-- ticket that already has a riešiteľ is skipped.
-- backfill ticket managers: start
WITH "ranked" AS (
  SELECT t."id" AS "ticket_id", m."user_id",
    row_number() OVER (PARTITION BY t."id" ORDER BY m."created_at", m."user_id") AS "rank"
  FROM "tickets" t
  JOIN "group_managers" m ON m."group_id" = t."group_id"
  JOIN "user" u ON u."id" = m."user_id" AND u."disabled_at" IS NULL AND u."role" IN ('admin', 'superadmin')
  WHERE t."status" IN ('new', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM "ticket_assignees" a WHERE a."ticket_id" = t."id")
), "added" AS (
  INSERT INTO "ticket_assignees" ("ticket_id", "user_id")
  SELECT "ticket_id", "user_id" FROM "ranked" WHERE "rank" <= 10
  ON CONFLICT DO NOTHING
  RETURNING "ticket_id", "user_id"
)
INSERT INTO "audit_log" ("id", "created_at", "actor_kind", "actor_label", "entity_type", "entity_id", "entity_label", "group_id", "category", "action", "changes")
SELECT gen_random_uuid()::text, now(), 'system', 'tickets.manager-autoassign', 'ticket', t."id",
  left('#' || t."number" || CASE WHEN coalesce(t."subject", '') = '' THEN '' ELSE ' ' || t."subject" END, 200),
  t."group_id", 'general', 'assignee_added',
  jsonb_build_object('assignees', jsonb_build_object(
    'added', jsonb_build_array(jsonb_build_object('id', u."id", 'label', u."name")),
    'removed', '[]'::jsonb))
FROM "added" a
JOIN "tickets" t ON t."id" = a."ticket_id"
JOIN "user" u ON u."id" = a."user_id";
-- backfill ticket managers: end
