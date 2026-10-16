ALTER TABLE "knowledge_items" DROP CONSTRAINT "knowledge_items_type_check";--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "chat_message_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "chat_file_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "chat_channel_id" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD COLUMN "chat_kind" text;--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_chat_attachment_fk" FOREIGN KEY ("chat_message_id","chat_file_id") REFERENCES "public"."message_attachments"("message_id","file_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "knowledge_items_chat_unique" ON "knowledge_items" USING btree ("chat_message_id","chat_file_id") WHERE "knowledge_items"."chat_message_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_items_chat_channel_idx" ON "knowledge_items" USING btree ("chat_channel_id") WHERE "knowledge_items"."chat_channel_id" is not null;--> statement-breakpoint
CREATE INDEX "knowledge_items_group_chat_created_idx" ON "knowledge_items" USING btree ("group_id","chat_kind","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "knowledge_items"."type" = 'chat_file';--> statement-breakpoint
CREATE INDEX "knowledge_items_root_created_idx" ON "knowledge_items" USING btree ("group_id","created_at" DESC NULLS FIRST,"id" DESC NULLS FIRST) WHERE "knowledge_items"."folder_id" is null and "knowledge_items"."type" <> 'chat_file';--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_chat_check" CHECK (("knowledge_items"."type" = 'chat_file') = ("knowledge_items"."chat_message_id" is not null) and ("knowledge_items"."chat_message_id" is null) = ("knowledge_items"."chat_file_id" is null) and ("knowledge_items"."chat_message_id" is null) = ("knowledge_items"."chat_channel_id" is null) and ("knowledge_items"."chat_message_id" is null) = ("knowledge_items"."chat_kind" is null));--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_chat_kind_check" CHECK ("knowledge_items"."chat_kind" is null or "knowledge_items"."chat_kind" in ('group', 'task', 'ticket'));--> statement-breakpoint
ALTER TABLE "knowledge_items" ADD CONSTRAINT "knowledge_items_type_check" CHECK ("knowledge_items"."type" in ('note', 'file', 'link', 'reminder', 'chat_file'));--> statement-breakpoint
-- Backfill (written by hand): one "From chat" entry per file of every live chat message. The
-- search text is the file name normalized as `normalizeSearch` does it (lower case, common Latin
-- diacritics removed, whitespace collapsed); new entries get it from the service.
INSERT INTO "knowledge_items" ("id", "group_id", "type", "visibility", "title", "body", "url", "folder_id", "created_by", "created_at", "updated_at", "search_text", "chat_message_id", "chat_file_id", "chat_channel_id", "chat_kind")
SELECT gen_random_uuid()::text, c."group_id", 'chat_file', 'public', left(f."name", 200), '', NULL, NULL, m."author_id", m."created_at", m."created_at",
       btrim(regexp_replace(lower(translate(f."name",
         'ÁÀÂÄÃÅĀĂĄáàâäãåāăąÇĆČçćčĎďÉÈÊËĒĖĘĚéèêëēėęěÍÌÎÏĪĮíìîïīįĹĽĺľÑŃŇñńňÓÒÔÖÕŌŐóòôöõōőŔŘŕřŚŠŞśšşŤŢťţÚÙÛÜŪŮŰŲúùûüūůűųÝŸýÿŹŻŽźżž',
         'AAAAAAAAAaaaaaaaaaCCCcccDdEEEEEEEEeeeeeeeeIIIIIIiiiiiiLLllNNNnnnOOOOOOOoooooooRRrrSSSsssTTttUUUUUUUUuuuuuuuuYYyyZZZzzz')),
         '\s+', ' ', 'g')),
       a."message_id", a."file_id", c."id", c."kind"
FROM "message_attachments" a
JOIN "messages" m ON m."id" = a."message_id"
JOIN "channels" c ON c."id" = m."channel_id"
JOIN "files" f ON f."id" = a."file_id"
WHERE m."deleted_at" IS NULL
ON CONFLICT DO NOTHING;
