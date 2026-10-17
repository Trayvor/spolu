ALTER TABLE "groups" ALTER COLUMN "egrant_url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "groups" ADD COLUMN "kind" text DEFAULT 'client' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "groups_one_admin" ON "groups" USING btree ((true)) WHERE "groups"."kind" = 'admin';--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_kind_check" CHECK ("groups"."kind" in ('client', 'admin'));--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_egrant_url_check" CHECK ("groups"."kind" = 'admin' or "groups"."egrant_url" is not null);--> statement-breakpoint
-- The one admin group "eGrant tím" (Phase 34). Its invite token is random and never shown; the
-- server's ensureAdminGroup recreates the row if it is ever missing and makes its board and chat.
INSERT INTO "groups" ("id", "name", "kind", "egrant_url", "invite_token")
VALUES (gen_random_uuid()::text, 'eGrant tím', 'admin', NULL, md5(random()::text) || md5(random()::text))
ON CONFLICT DO NOTHING;