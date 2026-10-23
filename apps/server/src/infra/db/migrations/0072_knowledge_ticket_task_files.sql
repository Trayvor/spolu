ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_type_check";--> statement-breakpoint
DROP INDEX "knowledge_items_group_chat_created_idx";--> statement-breakpoint
DROP INDEX "knowledge_items_root_created_idx";--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "source_ticket_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "source_task_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "source_file_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_ticket_attachment_fk" FOREIGN KEY ("source_ticket_id","source_file_id") REFERENCES "public"."ticket_attachments"("ticket_id","file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_task_attachment_fk" FOREIGN KEY ("source_task_id","source_file_id") REFERENCES "public"."task_attachments"("task_id","file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_ticket_file_unique" ON "knowledge_items" USING btree ("source_ticket_id","source_file_id") WHERE "knowledge_items"."source_ticket_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_task_file_unique" ON "knowledge_items" USING btree ("source_task_id","source_file_id") WHERE "knowledge_items"."source_task_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_items_source_file_idx" ON "knowledge_items" USING btree ("source_file_id") WHERE "knowledge_items"."source_file_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_items_group_auto_created_idx" ON "knowledge_items" USING btree ("group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "knowledge_items"."type" in ('chat_file', 'ticket_file', 'task_file');--> statement-breakpoint
CREATE INDEX "knowledge_items_root_created_idx" ON "knowledge_items" USING btree ("group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "knowledge_items"."folder_id" is null and "knowledge_items"."type" not in ('chat_file', 'ticket_file', 'task_file');--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_source_check" CHECK (("knowledge_items"."type" = 'ticket_file') = ("knowledge_items"."source_ticket_id" is not null) and ("knowledge_items"."type" = 'task_file') = ("knowledge_items"."source_task_id" is not null) and ("knowledge_items"."type" in ('ticket_file', 'task_file')) = ("knowledge_items"."source_file_id" is not null));--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_type_check" CHECK ("knowledge_items"."type" in ('note', 'file', 'link', 'reminder', 'meeting', 'chat_file', 'ticket_file', 'task_file'));--> statement-breakpoint
-- Backfill (written by hand, 2026-10-22): one "From ticket" entry per file of every ticket that
-- has a client, one "From task" entry per file on a task card, as `source-files.ts` writes them.
-- Admins-only for the admin group or an admins-only file; finance files never. The author is the
-- uploader, else the ticket's initiator or creator, else the first superadmin.
INSERT INTO "knowledge_items" ("id", "group_id", "type", "visibility", "title", "body", "url", "folder_id", "created_by", "created_at", "updated_at", "search_text", "source_ticket_id", "source_file_id")
SELECT gen_random_uuid()::text, t."group_id", 'ticket_file',
       CASE WHEN f."admins_only" OR g."kind" = 'admin' THEN 'admins' ELSE 'public' END,
       left(f."name", 200), '', NULL, NULL, w."author_id", t."created_at", t."created_at",
       btrim(regexp_replace(spolu_fold(f."name"), '\s+', ' ', 'g')), a."ticket_id", a."file_id"
FROM "ticket_attachments" a
JOIN "tickets" t ON t."id" = a."ticket_id"
JOIN "groups" g ON g."id" = t."group_id"
JOIN "files" f ON f."id" = a."file_id"
CROSS JOIN LATERAL (
  SELECT coalesce(f."uploaded_by", t."requester_user_id", t."created_by",
    (SELECT u."id" FROM "user" u WHERE u."role" = 'superadmin' ORDER BY u."created_at", u."id" LIMIT 1)) AS "author_id"
) w
WHERE NOT f."finance_only" AND w."author_id" IS NOT NULL
ON CONFLICT DO NOTHING;--> statement-breakpoint
INSERT INTO "knowledge_items" ("id", "group_id", "type", "visibility", "title", "body", "url", "folder_id", "created_by", "created_at", "updated_at", "search_text", "source_task_id", "source_file_id")
SELECT gen_random_uuid()::text, t."group_id", 'task_file',
       CASE WHEN f."admins_only" OR g."kind" = 'admin' THEN 'admins' ELSE 'public' END,
       left(f."name", 200), '', NULL, NULL, coalesce(f."uploaded_by", t."created_by"),
       coalesce(f."attached_at", t."created_at"), coalesce(f."attached_at", t."created_at"),
       btrim(regexp_replace(spolu_fold(f."name"), '\s+', ' ', 'g')), a."task_id", a."file_id"
FROM "task_attachments" a
JOIN "tasks" t ON t."id" = a."task_id"
JOIN "groups" g ON g."id" = t."group_id"
JOIN "files" f ON f."id" = a."file_id"
WHERE NOT f."finance_only"
ON CONFLICT DO NOTHING;
