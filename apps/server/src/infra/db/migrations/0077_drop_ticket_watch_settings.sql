ALTER TABLE "ticket_watch_settings" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "ticket_watch_settings" CASCADE;--> statement-breakpoint
CREATE INDEX "tickets_open_created_idx" ON "tickets" USING btree ("created_at" DESC NULLS LAST) WHERE "tickets"."status" in ('new', 'in_progress');
--> statement-breakpoint
-- Release backfill (ticket lifecycle rework, 2026-11-04): every open ticket of a client without a
-- riešiteľ gets the client's active admin managers as riešitelia, the earliest managers first up to
-- the limit of 10 (MAX_TICKET_ASSIGNEES), with no notification event. Idempotent: a ticket that
-- already has a riešiteľ is skipped.
-- backfill ticket managers: start
INSERT INTO "ticket_assignees" ("ticket_id", "user_id")
SELECT r."ticket_id", r."user_id"
FROM (
  SELECT t."id" AS "ticket_id", m."user_id",
    row_number() OVER (PARTITION BY t."id" ORDER BY m."created_at", m."user_id") AS "rank"
  FROM "tickets" t
  JOIN "group_managers" m ON m."group_id" = t."group_id"
  JOIN "user" u ON u."id" = m."user_id" AND u."disabled_at" IS NULL AND u."role" IN ('admin', 'superadmin')
  WHERE t."status" IN ('new', 'in_progress')
    AND NOT EXISTS (SELECT 1 FROM "ticket_assignees" a WHERE a."ticket_id" = t."id")
) r
WHERE r."rank" <= 10
ON CONFLICT DO NOTHING;
-- backfill ticket managers: end
